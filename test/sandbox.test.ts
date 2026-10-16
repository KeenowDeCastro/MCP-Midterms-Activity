import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tempSandbox } from "./helpers.ts";

const escapes = [
  "../secret.txt",
  "../../etc/passwd",
  "notes/../../outside.txt",
  "a/b/../../../x",
  "..\\..\\windows\\system32",
  "/etc/passwd",
  "C:/Windows/win.ini",
  "//server/share/file",
];

for (const p of escapes) {
  test(`rejects path escape: ${p}`, () => {
    const { sb, cleanup } = tempSandbox();
    try {
      assert.throws(() => sb.resolve(p), { name: "ToolError" });
    } finally {
      cleanup();
    }
  });
}

test("accepts normal relative paths and keeps them inside the root", () => {
  const { sb, cleanup } = tempSandbox();
  try {
    for (const p of ["notes.md", "src/app.ts", "./a/b/c.txt", "a/../b.txt", "..hidden-name.txt"]) {
      const abs = sb.resolve(p);
      assert.ok(abs.startsWith(sb.root + path.sep), `${p} -> ${abs}`);
    }
  } finally {
    cleanup();
  }
});

test("blocks the .git folder and null bytes", () => {
  const { sb, cleanup } = tempSandbox();
  try {
    assert.throws(() => sb.resolve(".git/config"), /protected \.git/);
    assert.throws(() => sb.resolve("src/.git/hooks/pre-commit"), /protected \.git/);
    assert.throws(() => sb.resolve("file\0.txt"), /null byte/);
  } finally {
    cleanup();
  }
});

test("root is only allowed when asked for", () => {
  const { sb, cleanup } = tempSandbox();
  try {
    assert.throws(() => sb.resolve("."), /not the workspace root/);
    assert.equal(sb.resolve(".", { allowRoot: true }), sb.root);
    assert.equal(sb.resolve("", { allowRoot: true }), sb.root);
  } finally {
    cleanup();
  }
});

test("rejects a symlink that points outside the workspace", (t) => {
  const { sb, dir, cleanup } = tempSandbox();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-outside-"));
  try {
    fs.writeFileSync(path.join(outside, "secret.txt"), "top secret");
    try {
      fs.symlinkSync(outside, path.join(dir, "escape"), "dir");
    } catch {
      t.skip("symlinks not permitted on this machine (Windows without developer mode)");
      return;
    }
    assert.throws(() => sb.resolve("escape/secret.txt"), /symlink/);
    assert.throws(() => sb.resolve("escape/new-file.txt"), /symlink/);
  } finally {
    cleanup();
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("rejects a dangling symlink", (t) => {
  const { sb, dir, cleanup } = tempSandbox();
  try {
    try {
      fs.symlinkSync("/nonexistent/target/file", path.join(dir, "dangling"));
    } catch {
      t.skip("symlinks not permitted on this machine");
      return;
    }
    assert.throws(() => sb.resolve("dangling"), /symlink/);
  } finally {
    cleanup();
  }
});
