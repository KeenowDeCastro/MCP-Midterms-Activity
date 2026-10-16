import { test } from "node:test";
import assert from "node:assert/strict";
import { tempSandbox } from "./helpers.ts";
import * as g from "../src/gitOps.ts";
import { writeFile } from "../src/fileOps.ts";

const ident = { name: "Test Agent", email: "test@example.com" };

test("git-lite: init, status, commit, log, diff", async () => {
  const { sb, cleanup } = tempSandbox();
  try {
    assert.equal(await g.ensureRepo(sb.root, ident), true);
    assert.equal(await g.ensureRepo(sb.root, ident), false);
    assert.equal(await g.gitLog(sb), "No commits yet.");

    const w = await writeFile(sb, "README.md", "hello\n");
    assert.match(await g.gitStatus(sb), /\?\? README\.md/);
    assert.match(await g.gitCommit(sb, "Add readme", ident), /Committed [0-9a-f]+: Add readme/);
    assert.match(await g.gitStatus(sb), /clean/);
    await assert.rejects(g.gitCommit(sb, "again", ident), /Nothing to commit/);

    await writeFile(sb, "README.md", "hello world\n", /version ([0-9a-f]{12})/.exec(w)![1]);
    const diff = await g.gitDiff(sb, "README.md");
    assert.match(diff, /\+hello world/);
    assert.match(await g.gitLog(sb, 5), /Add readme/);
    await assert.rejects(g.gitDiff(sb, "../outside"), /outside the workspace/);
  } finally {
    cleanup();
  }
});
