/**
 * Creates the sandbox workspace, copies in the four handoff files (without
 * overwriting existing ones), and makes the workspace its own git repository.
 * Safe to run more than once.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ensureRepo } from "../src/gitOps.ts";

const root = path.resolve(process.env.WORKSPACE_ROOT ?? "./workspace");
const templates = path.resolve("templates/handoff");
const ident = { name: process.env.GIT_AUTHOR_NAME ?? "MCP Agent", email: process.env.GIT_AUTHOR_EMAIL ?? "agent@example.com" };

fs.mkdirSync(root, { recursive: true });
for (const name of fs.readdirSync(templates)) {
  const dest = path.join(root, name);
  if (fs.existsSync(dest)) {
    console.log(`kept     ${name} (already exists)`);
  } else {
    fs.copyFileSync(path.join(templates, name), dest);
    console.log(`created  ${name}`);
  }
}

const created = await ensureRepo(root, ident);
console.log(created ? "git      initialised workspace repository" : "git      workspace repository already exists");

const status = execFileSync("git", ["status", "--porcelain"], { cwd: root }).toString().trim();
if (status) {
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["-c", `user.name=${ident.name}`, "-c", `user.email=${ident.email}`, "commit", "-m", "Initialise handoff files"], { cwd: root });
  console.log("git      committed handoff files");
}
console.log(`\nWorkspace ready at ${root}`);
