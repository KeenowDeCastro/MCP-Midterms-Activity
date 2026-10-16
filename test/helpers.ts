import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSandbox } from "../src/sandbox.ts";

/** A fresh temporary workspace for each test, so tests never touch real files. */
export function tempSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-ws-"));
  const sb = createSandbox(dir);
  return { sb, dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
