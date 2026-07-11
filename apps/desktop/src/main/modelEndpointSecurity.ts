import { lookup } from "node:dns/promises";
import { request as httpsRequest, type RequestOptions } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { isIP } from "node:net";
import * as ipaddr from "ipaddr.js";

export interface ModelResolvedAddress {
  address: string;
  family?: number;
}

export type ModelAddressResolver = (hostname: string) => Promise<readonly ModelResolvedAddress[]>;

function normalizedHostname(value: string): string {
  return value.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
}

export function isDemoModelHost(hostname: string): boolean {
  const host = normalizedHostname(hostname);
  return host === "api-demo.example.com" || host === "fake-models.local" || host === "fake-models.test";
}

export function isUnsafeModelHost(hostname: string): boolean {
  const host = normalizedHostname(hostname);
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "metadata.google.internal" || host === "metadata.google" || host === "metadata") return true;
  if (!ipaddr.isValid(host)) return host.includes(":");
  const address = ipaddr.parse(host);
  if (address.kind() === "ipv6" && host.startsWith("::")) return true;
  return address.range() !== "unicast";
}

async function resolveModelAddresses(hostname: string): Promise<readonly ModelResolvedAddress[]> {
  return lookup(hostname, { all: true, verbatim: true });
}

async function resolvePublicModelAddresses(baseUrl: string, resolver: ModelAddressResolver): Promise<readonly ModelResolvedAddress[]> {
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "https:") {
    throw new Error("模型服务 Base URL 必须使用 HTTPS。");
  }
  if (isDemoModelHost(parsed.hostname)) return [];
  if (isUnsafeModelHost(parsed.hostname)) {
    throw new Error("模型服务地址指向本机、内网或云元数据地址，已阻止连接。");
  }

  let addresses: readonly ModelResolvedAddress[];
  try {
    addresses = await resolver(parsed.hostname);
  } catch {
    throw new Error("模型服务域名无法解析，请检查 Base URL、网络或 DNS 设置。");
  }
  if (addresses.length === 0) {
    throw new Error("模型服务域名没有返回可用地址，请检查 Base URL 或 DNS 设置。");
  }
  if (addresses.some((item) => isUnsafeModelHost(item.address))) {
    throw new Error("模型服务域名解析到了本机、内网或云元数据地址，已阻止连接。");
  }
  return addresses;
}

export async function assertPublicModelEndpoint(baseUrl: string, resolver: ModelAddressResolver = resolveModelAddresses): Promise<void> {
  await resolvePublicModelAddresses(baseUrl, resolver);
}

export interface SecureModelJsonRequestOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
}

export type SecureModelJsonRequester = (
  url: string,
  apiLabel: string,
  options: SecureModelJsonRequestOptions,
  timeoutMs?: number
) => Promise<unknown>;

export type ModelHttpsRequestFactory = (
  url: URL,
  options: RequestOptions,
  onResponse: (response: IncomingMessage) => void
) => ClientRequest;

const MAX_MODEL_RESPONSE_BYTES = 2 * 1024 * 1024;

export function createSecureModelJsonRequester(
  resolver: ModelAddressResolver = resolveModelAddresses,
  requestFactory: ModelHttpsRequestFactory = httpsRequest
): SecureModelJsonRequester {
  return async (url, apiLabel, options, timeoutMs = 15000) => {
  const parsed = new URL(url);
  const addresses = await resolvePublicModelAddresses(parsed.origin, resolver);
  const selected = addresses[0];
  if (!selected) {
    throw new Error(`${apiLabel} 不能使用演示地址执行真实网络请求。`);
  }

  return new Promise<unknown>((resolve, reject) => {
    let settled = false;
    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const request = requestFactory(parsed, {
      method: options.method ?? "GET",
      headers: options.headers,
      servername: parsed.hostname,
      lookup: ((_hostname: string, lookupOptions: { all?: boolean } | undefined, callback: (...args: unknown[]) => void) => {
        const family = selected.family ?? isIP(selected.address);
        if (lookupOptions?.all) {
          callback(null, [{ address: selected.address, family }]);
          return;
        }
        callback(null, selected.address, family);
      }) as never
    }, (response) => {
      const statusCode = response.statusCode ?? 0;
      if (statusCode >= 300 && statusCode < 400) {
        response.resume();
        finishReject(new Error(`${apiLabel} 返回了重定向，已阻止跳转。`));
        return;
      }

      const chunks: Buffer[] = [];
      let totalBytes = 0;
      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buffer.length;
        if (totalBytes > MAX_MODEL_RESPONSE_BYTES) {
          request.destroy(new Error(`${apiLabel} 返回内容超过 2 MB，已停止读取。`));
          return;
        }
        chunks.push(buffer);
      });
      response.on("end", () => {
        if (settled) return;
        if (statusCode < 200 || statusCode >= 300) {
          finishReject(new Error(`HTTP ${statusCode}：${apiLabel} 请求失败。`));
          return;
        }
        try {
          const body = Buffer.concat(chunks).toString("utf8");
          const parsedBody = JSON.parse(body) as unknown;
          settled = true;
          resolve(parsedBody);
        } catch {
          finishReject(new Error(`${apiLabel} 返回的不是有效 JSON。`));
        }
      });
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`${apiLabel} 请求超时（${timeoutMs}ms）。`));
    });
    request.on("error", (caught) => {
      const message = caught instanceof Error ? caught.message : "";
      finishReject(message.startsWith(apiLabel) || message.startsWith("HTTP ")
        ? new Error(message)
        : new Error(`${apiLabel} 网络连接失败。`));
    });
    if (options.body) request.write(options.body);
    request.end();
  });
  };
}

export const secureModelJsonRequest = createSecureModelJsonRequester();
