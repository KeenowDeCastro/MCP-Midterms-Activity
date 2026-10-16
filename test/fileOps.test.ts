import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tempSandbox } from "./helpers.ts";
import * as f from "../src/fileOps.ts";
import { versionOf } from "../src/versioning.ts";

function withWs(fn: (ctx: ReturnType<typeof tempSandbox>) => Promise<void>) {
  return async () => {
    const ctx = tempSandbox();
    try {
      await fn(ctx);
    } finally {
      ctx.cleanup();
    }
  };
}

const versionIn = (text: string) => /version ([0-9a-f]{12})/.exec(text)![1];

test("write -> read round trip, with version in the header", withWs(async ({ sb }) => {
  const w = await f.writeFile(sb, "notes/a.md", "one\ntwo\nthree\n");
  assert.match(w, /Created notes\/a\.md/);
  const r = await f.readFile(sb, "notes/a.md");
  assert.match(r, /lines 1-3 of 3/);
  assert.equal(versionIn(r), versionOf("one\ntwo\nthree\n"));
  assert.ok(r.endsWith("one\ntwo\nthree"));
}));

test("read_file pages and reads the tail", withWs(async ({ sb }) => {
  const body = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
  await f.writeFile(sb, "big.txt", body);
  const first = await f.readFile(sb, "big.txt", 1, 10);
  assert.match(first, /lines 1-10 of 50 · more: call again with start_line=11/);
  const tail = await f.readFile(sb, "big.txt", -5);
  assert.match(tail, /lines 46-50 of 50/);
  assert.ok(tail.endsWith("line 50"));
  await assert.rejects(f.readFile(sb, "big.txt", 99), /past the end/);
}));

test("write_file refuses to overwrite without the right version", withWs(async ({ sb }) => {
  const w = await f.writeFile(sb, "a.txt", "v1");
  await assert.rejects(f.writeFile(sb, "a.txt", "v2"), /already exists/);
  await assert.rejects(f.writeFile(sb, "a.txt", "v2", "000000000000"), /Version conflict/);
  const ok = await f.writeFile(sb, "a.txt", "v2", versionIn(w));
  assert.match(ok, /Updated a\.txt/);
  await assert.rejects(f.writeFile(sb, "missing.txt", "x", "abcdefabcdef"), /does not exist/);
}));

test("str_replace: exactly one match, literal replacement", withWs(async ({ sb }) => {
  await f.writeFile(sb, "c.js", "let a = 1;\nlet b = 1;\n");
  await assert.rejects(f.strReplace(sb, "c.js", "= 1;", "= 2;"), /matches 2 places/);
  await assert.rejects(f.strReplace(sb, "c.js", "let z", "x"), /not found/);
  await assert.rejects(f.strReplace(sb, "c.js", "", "x"), /empty/);
  const r = await f.strReplace(sb, "c.js", "let b = 1;", "let b = '$&$1';");
  assert.match(r, /at line 2/);
  assert.equal(fs.readFileSync(path.join(sb.root, "c.js"), "utf8"), "let a = 1;\nlet b = '$&$1';\n");
}));

test("str_replace honours if_version", withWs(async ({ sb }) => {
  await f.writeFile(sb, "d.txt", "alpha beta");
  await assert.rejects(f.strReplace(sb, "d.txt", "alpha", "ALPHA", "111111111111"), /Version conflict/);
}));

test("two concurrent edits with the same version: only one wins", withWs(async ({ sb }) => {
  const w = await f.writeFile(sb, "race.txt", "count=0\n");
  const v = versionIn(w);
  const results = await Promise.allSettled([
    f.strReplace(sb, "race.txt", "count=0", "count=A", v),
    f.strReplace(sb, "race.txt", "count=0", "count=B", v),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
}));

test("append_file adds a newline between entries", withWs(async ({ sb }) => {
  await f.appendFile(sb, "PLAN_LOG.md", "## entry 1");
  await f.appendFile(sb, "PLAN_LOG.md", "## entry 2\n");
  assert.equal(fs.readFileSync(path.join(sb.root, "PLAN_LOG.md"), "utf8"), "## entry 1\n## entry 2\n");
}));

test("delete_file is gated three ways", withWs(async ({ sb }) => {
  await f.writeFile(sb, "tmp.txt", "x");
  await f.writeFile(sb, "PROJECT_STATE.md", "state");
  await assert.rejects(f.deleteFile(sb, "tmp.txt", true, false), /disabled/);
  await assert.rejects(f.deleteFile(sb, "tmp.txt", false, true), /confirm=true/);
  await assert.rejects(f.deleteFile(sb, "PROJECT_STATE.md", true, true), /handoff file/);
  assert.match(await f.deleteFile(sb, "tmp.txt", true, true), /Deleted tmp\.txt/);
  await assert.rejects(f.deleteFile(sb, "tmp.txt", true, true), /not found/);
}));

test("list_files and repo_map skip .git and node_modules", withWs(async ({ sb, dir }) => {
  fs.mkdirSync(path.join(dir, ".git"));
  fs.mkdirSync(path.join(dir, "node_modules/pkg"), { recursive: true });
  await f.writeFile(sb, "src/app.ts", "export function start() {}\nexport class Server {}\n");
  const ls = await f.listFiles(sb, ".", true);
  assert.match(ls, /src\//);
  assert.match(ls, /src\/app\.ts/);
  assert.doesNotMatch(ls, /node_modules|\.git/);
  const map = await f.repoMap(sb);
  assert.match(map, /app\.ts \(2 lines · start, Server\)/);
}));

test("search_code finds lines, supports regex and extension filters", withWs(async ({ sb }) => {
  await f.writeFile(sb, "a.ts", "const TODO = 1;\n// todo: fix\n");
  await f.writeFile(sb, "b.md", "TODO list\n");
  const all = await f.searchCode(sb, "todo");
  assert.match(all, /3 match/);
  const tsOnly = await f.searchCode(sb, "todo", { extensions: ["ts"] });
  assert.match(tsOnly, /2 match/);
  const re = await f.searchCode(sb, "^const\\s+\\w+", { regex: true });
  assert.match(re, /a\.ts:1:/);
  await assert.rejects(f.searchCode(sb, "(", { regex: true }), /Invalid regular expression/);
  assert.match(await f.searchCode(sb, "nothing-here"), /No matches/);
}));

test("binary files are refused, file_info reports versions", withWs(async ({ sb, dir }) => {
  fs.writeFileSync(path.join(dir, "img.bin"), Buffer.from([1, 2, 0, 3]));
  await assert.rejects(f.readFile(sb, "img.bin"), /binary/);
  await f.writeFile(sb, "x.txt", "hello\n");
  assert.match(await f.fileInfo(sb, "x.txt"), new RegExp(`version ${versionOf("hello\n")}`));
}));
