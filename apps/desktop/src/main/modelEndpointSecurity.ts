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
  signal?: AbortSignal;
}

export type SecureModelJsonRequester = (
  url: string,
  apiLabel: string,
  options: SecureModelJsonRequestOptions,
  timeoutMs?: number
) => Promise<unknown>;

export interface SecureModelStreamResponse {
  contentType: string;
}

export type SecureModelStreamRequester = (
  url: string,
  apiLabel: string,
  options: SecureModelJsonRequestOptions,
  onChunk: (chunk: string) => void,
  timeoutMs?: number
) => Promise<SecureModelStreamResponse>;

export type ModelHttpsRequestFactory = (
  url: URL,
  options: RequestOptions,
  onResponse: (response: IncomingMessage) => void
) => ClientRequest;

const MAX_MODEL_RESPONSE_BYTES = 2 * 1024 * 1024;

function modelHttpError(statusCode: number, apiLabel: string): Error {
  if (statusCode === 401) return new Error(`HTTP 401：${apiLabel} 认证失败，请检查 API Key。`);
  if (statusCode === 403) return new Error(`HTTP 403：当前账号无权使用 ${apiLabel} 或所选模型。`);
  if (statusCode === 404) return new Error(`HTTP 404：${apiLabel} 或所选模型不存在。`);
  if (statusCode === 429) return new Error(`HTTP 429：${apiLabel} 请求过于频繁或额度不足，请稍后重试。`);
  if (statusCode === 500 || statusCode === 502 || statusCode === 503 || statusCode === 504) {
    return new Error(`HTTP ${statusCode}：模型服务暂时不可用，${apiLabel} 请求未完成。`);
  }
  return new Error(`HTTP ${statusCode}：${apiLabel} 请求失败。`);
}

export function createSecureModelJsonRequester(
  resolver: ModelAddressResolver = resolveModelAddresses,
  requestFactory: ModelHttpsRequestFactory = httpsRequest
): SecureModelJsonRequester {
  return async (url, apiLabel, options, timeoutMs = 15000) => {
  if (options.signal?.aborted) throw cancelledModelRequestError(apiLabel);
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
      signal: options.signal,
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
          finishReject(modelHttpError(statusCode, apiLabel));
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
      const code = caught && typeof caught === "object" && "code" in caught ? String((caught as NodeJS.ErrnoException).code ?? "") : "";
      if (code === "ABORT_ERR" || (caught instanceof Error && caught.name === "AbortError")) {
        finishReject(cancelledModelRequestError(apiLabel));
        return;
      }
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

export function createSecureModelStreamRequester(
  resolver: ModelAddressResolver = resolveModelAddresses,
  requestFactory: ModelHttpsRequestFactory = httpsRequest
): SecureModelStreamRequester {
  return async (url, apiLabel, options, onChunk, timeoutMs = 120000) => {
    if (options.signal?.aborted) throw cancelledModelRequestError(apiLabel);
    const parsed = new URL(url);
    const addresses = await resolvePublicModelAddresses(parsed.origin, resolver);
    const selected = addresses[0];
    if (!selected) {
      throw new Error(`${apiLabel} 不能使用演示地址执行真实网络请求。`);
    }

    return new Promise<SecureModelStreamResponse>((resolve, reject) => {
      let settled = false;
      let totalBytes = 0;
      const finishReject = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const request = requestFactory(parsed, {
        method: options.method ?? "GET",
        headers: options.headers,
        servername: parsed.hostname,
        signal: options.signal,
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
        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          finishReject(modelHttpError(statusCode, apiLabel));
          return;
        }

        const contentType = String(response.headers["content-type"] ?? "");
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          totalBytes += Buffer.byteLength(chunk);
          if (totalBytes > MAX_MODEL_RESPONSE_BYTES) {
            request.destroy(new Error(`${apiLabel} 返回内容超过 2 MB，已停止读取。`));
            return;
          }
          try {
            onChunk(chunk);
          } catch (caught) {
            const message = caught instanceof Error && caught.message ? caught.message : `${apiLabel} 流式响应处理失败。`;
            request.destroy(new Error(message));
          }
        });
        response.on("end", () => {
          if (settled) return;
          settled = true;
          resolve({ contentType });
        });
      });

      request.setTimeout(timeoutMs, () => {
        request.destroy(new Error(`${apiLabel} 流式请求超时（${timeoutMs}ms）。`));
      });
      request.on("error", (caught) => {
        const message = caught instanceof Error ? caught.message : "";
        const code = caught && typeof caught === "object" && "code" in caught ? String((caught as NodeJS.ErrnoException).code ?? "") : "";
        const safeNetworkMessage = code === "ABORT_ERR" || (caught instanceof Error && caught.name === "AbortError")
          ? cancelledModelRequestError(apiLabel).message
          : code === "ECONNRESET"
          ? `${apiLabel} 流式连接重置。`
          : code === "ETIMEDOUT"
            ? `${apiLabel} 流式请求超时。`
            : `${apiLabel} 流式网络连接失败。`;
        finishReject(message.startsWith(apiLabel) || message.startsWith("HTTP ") ? new Error(message) : new Error(safeNetworkMessage));
      });
      if (options.body) request.write(options.body);
      request.end();
    });
  };
}

export const secureModelStreamRequest = createSecureModelStreamRequester();

function cancelledModelRequestError(apiLabel: string): Error {
  const error = new Error(`${apiLabel} 已取消。`);
  error.name = "AbortError";
  return error;
}
