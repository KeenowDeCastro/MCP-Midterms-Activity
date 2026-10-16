import { createHash, timingSafeEqual } from "node:crypto";

export const MIN_TOKEN_LENGTH = 24;

/**
 * Parse AUTH_TOKENS="builder=abc...,reviewer=def..." into a token -> role map.
 * Each role gets its own token, so the server knows who is calling and can
 * give each agent only the tools its role needs.
 */
export function parseTokens(spec: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const pair of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const eq = pair.indexOf("=");
    if (eq <= 0) throw new Error(`AUTH_TOKENS entry "${pair.slice(0, 12)}…" must look like role=token`);
    const role = pair.slice(0, eq).trim();
    const token = pair.slice(eq + 1).trim();
    if (token.length < MIN_TOKEN_LENGTH || /REPLACE_ME/.test(token)) {
      throw new Error(`Token for role "${role}" is too short or still a placeholder. Generate one with: npm run token`);
    }
    if (map.has(token)) throw new Error("Two roles share the same token; give each role its own.");
    map.set(token, role);
  }
  return map;
}

/** Compare hashes in constant time so response timing does not leak how much of a token was right. */
export function roleForToken(tokens: Map<string, string>, presented: string | undefined): string | undefined {
  if (!presented) return undefined;
  const p = createHash("sha256").update(presented).digest();
  let found: string | undefined;
  for (const [token, role] of tokens) {
    const t = createHash("sha256").update(token).digest();
    if (timingSafeEqual(p, t)) found = role;
  }
  return found;
}

/** Token comes from "Authorization: Bearer <token>" or, for clients that cannot set headers, the URL path /mcp/<token>. */
export function extractToken(authHeader: string | undefined, pathToken: string | undefined): string | undefined {
  if (authHeader) {
    const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    if (m) return m[1].trim();
  }
  return pathToken || undefined;
}
