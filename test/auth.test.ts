import { test } from "node:test";
import assert from "node:assert/strict";
import { extractToken, parseTokens, roleForToken } from "../src/auth.ts";

const A = "a".repeat(32);
const B = "b".repeat(32);

test("parses role=token pairs", () => {
  const m = parseTokens(`builder=${A}, reviewer=${B}`);
  assert.equal(m.get(A), "builder");
  assert.equal(m.get(B), "reviewer");
  assert.equal(parseTokens("").size, 0);
});

test("rejects weak, placeholder, malformed and duplicate tokens", () => {
  assert.throws(() => parseTokens("builder=short"), /too short/);
  assert.throws(() => parseTokens("builder=REPLACE_ME_WITH_A_LONG_RANDOM_TOKEN"), /placeholder/);
  assert.throws(() => parseTokens(A), /role=token/);
  assert.throws(() => parseTokens(`x=${A},y=${A}`), /same token/);
});

test("matches a presented token to its role", () => {
  const m = parseTokens(`builder=${A},reviewer=${B}`);
  assert.equal(roleForToken(m, A), "builder");
  assert.equal(roleForToken(m, B), "reviewer");
  assert.equal(roleForToken(m, "wrong"), undefined);
  assert.equal(roleForToken(m, undefined), undefined);
});

test("reads the token from a Bearer header or the URL path", () => {
  assert.equal(extractToken(`Bearer ${A}`, undefined), A);
  assert.equal(extractToken(`bearer   ${A} `, undefined), A);
  assert.equal(extractToken(undefined, B), B);
  assert.equal(extractToken("Basic xyz", undefined), undefined);
});
