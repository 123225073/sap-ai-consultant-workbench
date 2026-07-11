import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ALLOWED_FIELD_NAMES = new Set([
  "errorCode",
  "errorName",
  "exitCode",
  "isMainFrame",
  "lockAcquired",
  "method",
  "minimized",
  "platform",
  "reason",
  "recoveryOffered",
  "recoveryUsed",
  "source",
  "windowCount"
]);

type LifecycleFieldValue = boolean | number | string | null | undefined;
export type LifecycleLogFields = Record<string, LifecycleFieldValue>;

function safeEventName(value: string): string {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(value) ? value : "invalid-event";
}

function safeFieldValue(value: LifecycleFieldValue): boolean | number | string | null {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return null;

  // Lifecycle strings are deliberately token-like. Free-form text, URLs, paths,
  // exception messages, customer content, and credentials are never persisted.
  return /^[A-Za-z0-9_.:-]{1,80}$/.test(value) ? value : "[redacted]";
}

function safeFields(fields: LifecycleLogFields): Record<string, boolean | number | string | null> {
  const sanitized: Record<string, boolean | number | string | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED_FIELD_NAMES.has(key) || value === undefined) continue;
    sanitized[key] = safeFieldValue(value);
  }
  return sanitized;
}

export class AppLifecycleLogger {
  private readonly logDirectory: string;
  private readonly activeSessionPath: string;
  private readonly now: () => Date;

  constructor(userDataPath: string, now: () => Date = () => new Date()) {
    this.logDirectory = path.join(userDataPath, "logs");
    this.activeSessionPath = path.join(this.logDirectory, ".active-session");
    this.now = now;
  }

  write(event: string, fields: LifecycleLogFields = {}): void {
    try {
      const timestamp = this.now();
      const fileName = `lifecycle-${timestamp.toISOString().slice(0, 10)}.log`;
      const entry = {
        timestamp: timestamp.toISOString(),
        event: safeEventName(event),
        ...safeFields(fields)
      };
      mkdirSync(this.logDirectory, { recursive: true });
      appendFileSync(path.join(this.logDirectory, fileName), `${JSON.stringify(entry)}\n`, { encoding: "utf8" });
    } catch {
      // Logging must never prevent the desktop application from starting or closing.
    }
  }

  beginSession(): void {
    try {
      mkdirSync(this.logDirectory, { recursive: true });
      if (existsSync(this.activeSessionPath) && readFileSync(this.activeSessionPath, "utf8").trim() === "active") {
        this.write("previous-session-unclean");
      }
      writeFileSync(this.activeSessionPath, "active\n", { encoding: "utf8" });
      this.write("session-started");
    } catch {
      // Session diagnostics must not prevent startup.
    }
  }

  endSession(): void {
    try {
      writeFileSync(this.activeSessionPath, "ended\n", { encoding: "utf8" });
      this.write("session-ended");
    } catch {
      // Session diagnostics must not prevent shutdown.
    }
  }
}

export function createAppLifecycleLogger(userDataPath: string): AppLifecycleLogger {
  return new AppLifecycleLogger(userDataPath);
}
