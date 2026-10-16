import fs from "node:fs";
import path from "node:path";

export interface CallLog {
  ts: string;
  role: string;
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  ms: number;
  resultChars: number;
  error?: string;
}

export interface Logger {
  file: string;
  log(entry: CallLog): void;
}

/** Long strings (file contents, edits) are shortened so the log stays readable. */
export function summarizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args ?? {})) {
    out[k] = typeof v === "string" && v.length > 120 ? `${v.slice(0, 120)}… (${v.length} chars)` : v;
  }
  return out;
}

/** One JSON object per line (JSONL) in LOG_DIR/tool-calls.jsonl: easy to append, easy to analyse. */
export function createLogger(logDir: string): Logger {
  fs.mkdirSync(logDir, { recursive: true });
  const file = path.join(logDir, "tool-calls.jsonl");
  return {
    file,
    log(entry) {
      fs.appendFileSync(file, JSON.stringify(entry) + "\n");
      const status = entry.ok ? "ok" : `ERROR ${entry.error ?? ""}`.trim();
      console.log(`${entry.ts} [${entry.role}] ${entry.tool} ${status} (${entry.ms}ms, ${entry.resultChars} chars)`);
    },
  };
}
