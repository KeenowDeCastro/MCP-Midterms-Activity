import fs from "node:fs";
import path from "node:path";
import { ToolError } from "./errors.ts";

/** Folders the file tools may never touch. .git is managed only by the git_* tools. */
const BLOCKED_SEGMENTS = new Set([".git"]);

export interface Sandbox {
  /** Absolute, symlink-free path of the workspace root. */
  root: string;
  /** Turn an agent-supplied relative path into a safe absolute path, or throw. */
  resolve(userPath: string, opts?: { allowRoot?: boolean }): string;
  /** Turn an absolute path inside the root back into a display path like "src/app.ts". */
  relative(absPath: string): string;
}

function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  if (rel === "") return true;
  return rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel);
}

/**
 * Find the real location of a path that may not exist yet (e.g. a file we are
 * about to create). We walk up to the nearest ancestor that exists, resolve
 * symlinks on that, then re-attach the missing tail.
 */
function realpathOfNearestExisting(target: string): string {
  let current = target;
  const missingTail: string[] = [];
  for (;;) {
    try {
      const real = fs.realpathSync(current);
      return path.join(real, ...missingTail.reverse());
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw err;
      // A dangling symlink makes realpath fail with ENOENT, but writing to it
      // would follow the link. Refuse it instead of walking past it.
      let isLink = false;
      try {
        isLink = fs.lstatSync(current).isSymbolicLink();
      } catch {
        /* does not exist at all: keep walking up */
      }
      if (isLink) throw new ToolError("Path goes through a broken symlink; refusing to follow it.");
      const parent = path.dirname(current);
      if (parent === current) return target;
      missingTail.push(path.basename(current));
      current = parent;
    }
  }
}

export function createSandbox(rootInput: string): Sandbox {
  fs.mkdirSync(rootInput, { recursive: true });
  const root = fs.realpathSync(path.resolve(rootInput));

  function resolve(userPath: string, opts: { allowRoot?: boolean } = {}): string {
    if (typeof userPath !== "string") throw new ToolError("Path must be a string.");
    if (userPath.includes("\0")) throw new ToolError("Path contains a null byte.");

    const cleaned = userPath.trim() === "" ? "." : userPath.trim().replace(/\\/g, "/");
    if (path.isAbsolute(cleaned) || /^[a-zA-Z]:\//.test(cleaned) || cleaned.startsWith("//")) {
      throw new ToolError(
        `Absolute paths are not allowed ("${userPath}"). Use a path relative to the workspace root, e.g. "notes/todo.md".`,
      );
    }

    const abs = path.resolve(root, cleaned);
    if (!isInside(root, abs)) {
      throw new ToolError(`"${userPath}" points outside the workspace. Paths must stay inside the workspace root.`);
    }
    if (abs === root && !opts.allowRoot) {
      throw new ToolError("This tool needs a file path, not the workspace root.");
    }

    const segments = path.relative(root, abs).split(path.sep);
    if (segments.some((s) => BLOCKED_SEGMENTS.has(s))) {
      throw new ToolError(`"${userPath}" is inside the protected .git folder. Use the git_* tools instead.`);
    }

    // Second line of defence: a symlink inside the workspace could point outside it.
    const real = realpathOfNearestExisting(abs);
    if (!isInside(root, real)) {
      throw new ToolError(`"${userPath}" resolves through a symlink to a location outside the workspace.`);
    }
    return abs;
  }

  function relative(absPath: string): string {
    const rel = path.relative(root, absPath).split(path.sep).join("/");
    return rel === "" ? "." : rel;
  }

  return { root, resolve, relative };
}
