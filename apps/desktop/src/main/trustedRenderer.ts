import type { IpcMainInvokeEvent } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";

const TRUSTED_RENDERER_LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function isTrustedRendererUrl(rawUrl: string, appRoot: string, developmentRendererUrl = process.env.ELECTRON_RENDERER_URL): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === "file:") {
      const rendererRoot = pathToFileURL(`${path.join(appRoot, "dist", "renderer")}${path.sep}`).href;
      return parsed.href.startsWith(rendererRoot);
    }

    if (parsed.protocol !== "http:" || !developmentRendererUrl) return false;
    const developmentUrl = new URL(developmentRendererUrl);
    if (developmentUrl.protocol !== "http:" || !TRUSTED_RENDERER_LOCAL_HOSTS.has(developmentUrl.hostname)) {
      return false;
    }
    return parsed.origin === developmentUrl.origin;
  } catch {
    return false;
  }
}

export function assertTrustedRendererEvent(event: IpcMainInvokeEvent, appRoot: string): void {
  const senderUrl = event.senderFrame?.url || event.sender.getURL();
  if (!isTrustedRendererUrl(senderUrl, appRoot)) {
    throw new Error("已阻止非可信页面调用本地工作台接口。");
  }
}
