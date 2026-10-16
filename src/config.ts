import fs from "node:fs";
import path from "node:path";
import { parseTokens } from "./auth.ts";

export interface Config {
  port: number;
  host: string;
  workspaceRoot: string;
  logDir: string;
  tokens: Map<string, string>;
  allowNoAuth: boolean;
  allowDelete: boolean;
  roles: Record<string, string[]>;
  git: { name: string; email: string };
}

const bool = (v: string | undefined, fallback: boolean) => (v === undefined ? fallback : /^(1|true|yes)$/i.test(v.trim()));

/** Load roles.json: { "roleName": ["tool_a", "tool_b"] } — "*" means every tool. */
export function loadRoles(file: string): Record<string, string[]> {
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  if (typeof raw !== "object" || raw === null) throw new Error(`${file} must be a JSON object`);
  const roles: Record<string, string[]> = {};
  for (const [role, tools] of Object.entries(raw as Record<string, unknown>)) {
    if (role.startsWith("_")) continue; // allow "_comment" keys
    if (!Array.isArray(tools) || !tools.every((t) => typeof t === "string")) {
      throw new Error(`Role "${role}" in ${file} must be a list of tool names`);
    }
    roles[role] = tools;
  }
  return roles;
}

/** All settings come from environment variables (.env), so no secret or path is hard-coded. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const tokens = parseTokens(env.AUTH_TOKENS ?? "");
  const roles = loadRoles(path.resolve(env.ROLES_FILE ?? "config/roles.json"));
  for (const role of tokens.values()) {
    if (!roles[role]) throw new Error(`AUTH_TOKENS uses role "${role}" but config/roles.json does not define it`);
  }
  const allowNoAuth = bool(env.ALLOW_NO_AUTH, false);
  if (tokens.size === 0 && !allowNoAuth) {
    throw new Error("No AUTH_TOKENS configured. Add tokens to .env (or set ALLOW_NO_AUTH=true for local-only testing).");
  }
  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? "127.0.0.1",
    workspaceRoot: path.resolve(env.WORKSPACE_ROOT ?? "./workspace"),
    logDir: path.resolve(env.LOG_DIR ?? "./logs"),
    tokens,
    allowNoAuth,
    allowDelete: bool(env.ALLOW_DELETE, false),
    roles,
    git: { name: env.GIT_AUTHOR_NAME ?? "MCP Agent", email: env.GIT_AUTHOR_EMAIL ?? "agent@example.com" },
  };
}
