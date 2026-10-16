import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Sandbox } from "./sandbox.ts";
import { ToolError } from "./errors.ts";

const run = promisify(execFile);

export interface GitIdentity {
  name: string;
  email: string;
}

/**
 * Run git inside the workspace. execFile (not exec) means no shell is involved,
 * so nothing an agent sends can be interpreted as a shell command.
 * Hooks are disabled so a planted .git/hooks script can never run.
 */
async function git(root: string, args: string[]): Promise<string> {
  const safety = ["-c", "core.hooksPath=/dev/null", "-c", "core.quotepath=false", "-c", "color.ui=false"];
  try {
    const { stdout } = await run("git", [...safety, ...args], {
      cwd: root,
      timeout: 15_000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return stdout.trimEnd();
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
    if (e.code === "ENOENT") throw new ToolError("git is not installed on the server machine.");
    const msg = String(e.stderr || e.stdout || e.message).trim();
    if (/not a git repository/i.test(msg)) {
      throw new ToolError("The workspace is not a git repository yet. Run `npm run init:workspace` on the server.");
    }
    throw new ToolError(`git ${args[0]} failed: ${msg.split("\n").slice(0, 4).join(" ")}`);
  }
}

export async function ensureRepo(root: string, ident: GitIdentity): Promise<boolean> {
  try {
    await git(root, ["rev-parse", "--is-inside-work-tree"]);
    return false;
  } catch {
    await git(root, ["init", "-b", "main"]);
    await git(root, ["config", "user.name", ident.name]);
    await git(root, ["config", "user.email", ident.email]);
    return true;
  }
}

export async function gitStatus(sb: Sandbox): Promise<string> {
  const out = await git(sb.root, ["status", "--short", "--branch"]);
  const lines = out.split("\n");
  return lines.length <= 1 ? `${out}\n(clean: no uncommitted changes)` : out;
}

export async function gitLog(sb: Sandbox, limit = 10): Promise<string> {
  const n = Math.min(Math.max(1, limit), 100);
  try {
    return await git(sb.root, ["log", `-n${n}`, "--date=short", "--format=%h %ad %s"]);
  } catch (err) {
    if (err instanceof ToolError && /does not have any commits/i.test(err.message)) return "No commits yet.";
    throw err;
  }
}

export async function gitDiff(sb: Sandbox, p?: string, staged = false, maxLines = 300): Promise<string> {
  const scope = p ? ["--", sb.relative(sb.resolve(p, { allowRoot: true }))] : [];
  const mode = staged ? ["--cached"] : [];
  const stat = await git(sb.root, ["diff", ...mode, "--stat", ...scope]);
  if (!stat) return staged ? "No staged changes." : "No unstaged changes. (New untracked files only show in git_status.)";
  const body = (await git(sb.root, ["diff", ...mode, ...scope])).split("\n");
  const limit = Math.min(Math.max(20, maxLines), 2000);
  const shown = body.slice(0, limit).join("\n");
  const more = body.length > limit ? `\n… diff truncated (${body.length - limit} more lines). Pass a path to narrow it.` : "";
  return `${stat}\n\n${shown}${more}`;
}

export async function gitCommit(sb: Sandbox, message: string, ident: GitIdentity, paths?: string[]): Promise<string> {
  const msg = message.trim();
  if (!msg) throw new ToolError("Commit message is empty. Describe what changed, e.g. 'Add parser for CSV input'.");
  const rels = paths && paths.length ? paths.map((x) => sb.relative(sb.resolve(x, { allowRoot: true }))) : ["."];
  await git(sb.root, ["add", "-A", "--", ...rels]);
  const staged = await git(sb.root, ["diff", "--cached", "--name-only"]);
  if (!staged) throw new ToolError("Nothing to commit: no changes since the last commit.");
  await git(sb.root, ["-c", `user.name=${ident.name}`, "-c", `user.email=${ident.email}`, "commit", "-m", msg]);
  const head = await git(sb.root, ["log", "-1", "--format=%h"]);
  const files = staged.split("\n");
  return `Committed ${head}: ${msg.split("\n")[0]}\n${files.length} file(s): ${files.slice(0, 20).join(", ")}${files.length > 20 ? ", …" : ""}`;
}
