import fs from "node:fs/promises";
import type { Dirent, Stats } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { Sandbox } from "./sandbox.ts";
import { ToolError } from "./errors.ts";
import { versionOf, withFileLock } from "./versioning.ts";

/** Hard limits that keep tool results small and the server safe. */
export const LIMITS = {
  maxFileBytes: 2_000_000, // largest file we will read or append to
  maxWriteBytes: 1_000_000, // largest single write
  defaultLines: 200, // read_file chunk size
  maxLines: 1000,
  maxListEntries: 1000,
  maxSearchResults: 200,
  maxSearchFileBytes: 1_000_000,
  maxLineChars: 240, // long lines are cut in search/map output
  maxMapLines: 400,
};

/** Never walked by list/search/map. */
const SKIP_DIRS = new Set([".git", "node_modules"]);

/** The handoff files at the workspace root cannot be deleted. */
export const PROTECTED_FILES = new Set(["PROJECT_STATE.md", "PLAN_LOG.md", "CHECKPOINTS.md", "DECISIONS.md"]);

// ---------- helpers ----------

async function statOrNull(abs: string): Promise<Stats | null> {
  try {
    return await fs.stat(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function readRaw(abs: string, rel: string): Promise<Buffer> {
  const st = await statOrNull(abs);
  if (!st) throw new ToolError(`File not found: "${rel}". Use list_files or search_code to find the right path.`);
  if (st.isDirectory()) throw new ToolError(`"${rel}" is a directory. Use list_files to see what is inside.`);
  if (st.size > LIMITS.maxFileBytes) {
    throw new ToolError(`"${rel}" is ${formatSize(st.size)}, over the ${formatSize(LIMITS.maxFileBytes)} limit.`);
  }
  return fs.readFile(abs);
}

async function readText(abs: string, rel: string): Promise<{ text: string; version: string }> {
  const buf = await readRaw(abs, rel);
  if (buf.includes(0)) throw new ToolError(`"${rel}" looks like a binary file; only text files are supported.`);
  return { text: buf.toString("utf8"), version: versionOf(buf) };
}

/** Write to a temp file in the same folder, then rename: readers never see a half-written file. */
async function atomicWrite(abs: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  await fs.writeFile(tmp, content, "utf8");
  try {
    await fs.rename(tmp, abs);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (text.endsWith("\n")) lines.pop();
  return lines;
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let pos = haystack.indexOf(needle);
  while (pos !== -1) {
    count++;
    pos = haystack.indexOf(needle, pos + 1); // +1 so overlapping matches also count as ambiguous
  }
  return count;
}

function conflict(rel: string, given: string, actual: string): ToolError {
  return new ToolError(
    `Version conflict on "${rel}": you passed if_version="${given}" but the file is now version "${actual}". ` +
      `Someone changed it since you read it. Call read_file again and redo your edit on the new content.`,
  );
}

function clip(line: string): string {
  const t = line.trim();
  return t.length > LIMITS.maxLineChars ? t.slice(0, LIMITS.maxLineChars) + "…" : t;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function sortedEntries(dirAbs: string): Promise<Dirent[]> {
  const items = await fs.readdir(dirAbs, { withFileTypes: true });
  return items
    .filter((d) => !(d.isDirectory() && SKIP_DIRS.has(d.name)))
    .filter((d) => !d.name.endsWith(".tmp"))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
}

// ---------- tools ----------

export async function listFiles(sb: Sandbox, p = ".", recursive = false, maxEntries = 200): Promise<string> {
  const abs = sb.resolve(p, { allowRoot: true });
  const rel = sb.relative(abs);
  const st = await statOrNull(abs);
  if (!st) throw new ToolError(`Folder not found: "${rel}".`);
  if (!st.isDirectory()) throw new ToolError(`"${rel}" is a file, not a folder. Use read_file or file_info.`);

  const limit = Math.min(Math.max(1, maxEntries), LIMITS.maxListEntries);
  const out: string[] = [];
  let truncated = false;

  async function walk(dirAbs: string): Promise<void> {
    for (const d of await sortedEntries(dirAbs)) {
      if (out.length >= limit) {
        truncated = true;
        return;
      }
      const childAbs = path.join(dirAbs, d.name);
      const childRel = sb.relative(childAbs);
      if (d.isSymbolicLink()) {
        out.push(`${childRel} -> (symlink, not followed)`);
      } else if (d.isDirectory()) {
        out.push(`${childRel}/`);
        if (recursive) await walk(childAbs);
      } else {
        const s = await fs.stat(childAbs);
        out.push(`${childRel}  (${formatSize(s.size)})`);
      }
    }
  }
  await walk(abs);

  if (out.length === 0) return `"${rel}" is empty.`;
  const note = truncated ? `, truncated at ${limit} — narrow the path or raise max_entries` : "";
  return `Contents of ${rel}${recursive ? " (recursive)" : ""} — ${out.length} entries${note}\n${out.join("\n")}`;
}

export async function readFile(sb: Sandbox, p: string, startLine = 1, maxLines = LIMITS.defaultLines): Promise<string> {
  const abs = sb.resolve(p);
  const rel = sb.relative(abs);
  const { text, version } = await readText(abs, rel);
  const lines = splitLines(text);
  const total = lines.length;

  // Negative start_line counts from the end: -20 means "the last 20 lines".
  let start = startLine < 0 ? Math.max(1, total + startLine + 1) : Math.max(1, startLine);
  if (total === 0) start = 1;
  if (total > 0 && start > total) {
    throw new ToolError(`start_line ${startLine} is past the end of "${rel}", which has ${total} lines.`);
  }
  const count = Math.min(Math.max(1, maxLines), LIMITS.maxLines);
  const end = Math.min(total, start + count - 1);
  const more = end < total ? ` · more: call again with start_line=${end + 1}` : "";
  const header = `[${rel} · version ${version} · lines ${total === 0 ? 0 : start}-${end} of ${total}${more}]`;
  return `${header}\n${lines.slice(start - 1, end).join("\n")}`;
}

export async function writeFile(sb: Sandbox, p: string, content: string, ifVersion?: string): Promise<string> {
  const abs = sb.resolve(p);
  const rel = sb.relative(abs);
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > LIMITS.maxWriteBytes) {
    throw new ToolError(`Content is ${formatSize(bytes)}, over the ${formatSize(LIMITS.maxWriteBytes)} write limit. Split it into smaller files.`);
  }

  return withFileLock(abs, async () => {
    const st = await statOrNull(abs);
    if (st?.isDirectory()) throw new ToolError(`"${rel}" is a directory; choose a file path.`);
    if (st) {
      const current = versionOf(await readRaw(abs, rel));
      if (!ifVersion || ifVersion === "new") {
        throw new ToolError(
          `"${rel}" already exists (version ${current}). To overwrite it, read it first and pass if_version="${current}". ` +
            `For a small change, use str_replace instead.`,
        );
      }
      if (ifVersion !== current) throw conflict(rel, ifVersion, current);
    } else if (ifVersion && ifVersion !== "new") {
      throw new ToolError(`"${rel}" does not exist, but if_version="${ifVersion}" was given. Omit if_version (or pass "new") to create it.`);
    }
    await atomicWrite(abs, content);
    return `${st ? "Updated" : "Created"} ${rel} (${formatSize(bytes)}, ${splitLines(content).length} lines) · new version ${versionOf(content)}`;
  });
}

export async function strReplace(sb: Sandbox, p: string, oldStr: string, newStr: string, ifVersion?: string): Promise<string> {
  if (oldStr.length === 0) throw new ToolError("old_str is empty. Copy the exact text you want to replace from read_file.");
  if (oldStr === newStr) throw new ToolError("old_str and new_str are identical, so there is nothing to change.");
  const abs = sb.resolve(p);
  const rel = sb.relative(abs);

  return withFileLock(abs, async () => {
    const { text, version } = await readText(abs, rel);
    if (ifVersion && ifVersion !== version) throw conflict(rel, ifVersion, version);

    const count = countOccurrences(text, oldStr);
    if (count === 0) {
      const crlf = text.includes("\r\n") && !oldStr.includes("\r") ? " Note: this file uses Windows (CRLF) line endings." : "";
      throw new ToolError(
        `old_str was not found in "${rel}". Re-read the file and copy the exact text, including whitespace and indentation.${crlf}`,
      );
    }
    if (count > 1) {
      throw new ToolError(`old_str matches ${count} places in "${rel}"; it must match exactly one. Add surrounding lines to old_str so it is unique.`);
    }
    const idx = text.indexOf(oldStr);
    // Plain slicing on purpose: String.replace would treat "$&", "$1" etc. in new_str as patterns.
    const updated = text.slice(0, idx) + newStr + text.slice(idx + oldStr.length);
    if (Buffer.byteLength(updated, "utf8") > LIMITS.maxWriteBytes) throw new ToolError("The edited file would exceed the write limit.");
    await atomicWrite(abs, updated);
    const line = text.slice(0, idx).split("\n").length;
    return `Replaced 1 occurrence in ${rel} at line ${line} · new version ${versionOf(updated)}`;
  });
}

export async function appendFile(sb: Sandbox, p: string, content: string, ifVersion?: string): Promise<string> {
  if (content.length === 0) throw new ToolError("content is empty; nothing to append.");
  const abs = sb.resolve(p);
  const rel = sb.relative(abs);

  return withFileLock(abs, async () => {
    const st = await statOrNull(abs);
    let existing = "";
    if (st) {
      const cur = await readText(abs, rel);
      if (ifVersion && ifVersion !== cur.version) throw conflict(rel, ifVersion, cur.version);
      existing = cur.text;
    }
    const sep = existing === "" || existing.endsWith("\n") ? "" : "\n";
    const updated = existing + sep + content + (content.endsWith("\n") ? "" : "\n");
    if (Buffer.byteLength(updated, "utf8") > LIMITS.maxFileBytes) {
      throw new ToolError(`Appending would make "${rel}" larger than ${formatSize(LIMITS.maxFileBytes)}. Summarise or archive old entries first.`);
    }
    await atomicWrite(abs, updated);
    return `Appended ${splitLines(content).length} line(s) to ${rel}${st ? "" : " (created)"} · new version ${versionOf(updated)}`;
  });
}

export async function deleteFile(sb: Sandbox, p: string, confirm: boolean, allowDelete: boolean): Promise<string> {
  if (!allowDelete) throw new ToolError("Deleting is disabled on this server (ALLOW_DELETE=false).");
  if (confirm !== true) throw new ToolError("delete_file is destructive. Call it again with confirm=true if you really mean to delete this file.");
  const abs = sb.resolve(p);
  const rel = sb.relative(abs);
  if (PROTECTED_FILES.has(rel)) {
    throw new ToolError(`"${rel}" is a handoff file and cannot be deleted. Edit it with str_replace or write_file instead.`);
  }
  return withFileLock(abs, async () => {
    const st = await statOrNull(abs);
    if (!st) throw new ToolError(`File not found: "${rel}".`);
    if (st.isDirectory()) throw new ToolError(`"${rel}" is a directory. delete_file only removes single files.`);
    await fs.unlink(abs);
    return `Deleted ${rel}. If it was committed, git can restore it.`;
  });
}

export interface SearchOptions {
  path?: string;
  regex?: boolean;
  caseSensitive?: boolean;
  maxResults?: number;
  extensions?: string[];
}

export async function searchCode(sb: Sandbox, query: string, opts: SearchOptions = {}): Promise<string> {
  if (!query) throw new ToolError("query is empty.");
  const caseSensitive = opts.caseSensitive ?? false;
  let matches: (line: string) => boolean;
  if (opts.regex) {
    let re: RegExp;
    try {
      re = new RegExp(query, caseSensitive ? "" : "i");
    } catch (err) {
      throw new ToolError(`Invalid regular expression: ${(err as Error).message}`);
    }
    matches = (line) => re.test(line.slice(0, 2000)); // cap line length to limit slow-regex cost
  } else {
    const needle = caseSensitive ? query : query.toLowerCase();
    matches = (line) => (caseSensitive ? line : line.toLowerCase()).includes(needle);
  }
  const exts = (opts.extensions ?? []).map((e) => (e.startsWith(".") ? e : "." + e).toLowerCase());
  const limit = Math.min(Math.max(1, opts.maxResults ?? 50), LIMITS.maxSearchResults);

  const startAbs = sb.resolve(opts.path ?? ".", { allowRoot: true });
  const results: string[] = [];
  let filesScanned = 0;
  let truncated = false;

  async function scanFile(abs: string): Promise<void> {
    if (exts.length && !exts.includes(path.extname(abs).toLowerCase())) return;
    const st = await fs.stat(abs);
    if (st.size > LIMITS.maxSearchFileBytes) return;
    const buf = await fs.readFile(abs);
    if (buf.includes(0)) return;
    filesScanned++;
    const lines = buf.toString("utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (matches(lines[i])) {
        if (results.length >= limit) {
          truncated = true;
          return;
        }
        results.push(`${sb.relative(abs)}:${i + 1}: ${clip(lines[i])}`);
      }
    }
  }
  async function walk(dirAbs: string): Promise<void> {
    for (const d of await sortedEntries(dirAbs)) {
      if (truncated) return;
      if (d.isSymbolicLink()) continue;
      const child = path.join(dirAbs, d.name);
      if (d.isDirectory()) await walk(child);
      else if (d.isFile()) await scanFile(child);
    }
  }

  const st = await statOrNull(startAbs);
  if (!st) throw new ToolError(`Path not found: "${sb.relative(startAbs)}".`);
  if (st.isDirectory()) await walk(startAbs);
  else await scanFile(startAbs);

  if (results.length === 0) return `No matches for ${JSON.stringify(query)} in ${filesScanned} file(s).`;
  const note = truncated ? ` (stopped at ${limit}; narrow path or extensions to see the rest)` : "";
  return `${results.length} match(es) for ${JSON.stringify(query)} in ${filesScanned} file(s) scanned${note}\n${results.join("\n")}`;
}

export async function fileInfo(sb: Sandbox, p: string): Promise<string> {
  const abs = sb.resolve(p, { allowRoot: true });
  const rel = sb.relative(abs);
  const st = await statOrNull(abs);
  if (!st) throw new ToolError(`Not found: "${rel}".`);
  if (st.isDirectory()) {
    const n = (await sortedEntries(abs)).length;
    return `${rel}/ · folder · ${n} entries · modified ${st.mtime.toISOString()}`;
  }
  if (st.size > LIMITS.maxFileBytes) return `${rel} · file · ${formatSize(st.size)} · too large to version`;
  const buf = await fs.readFile(abs);
  const binary = buf.includes(0);
  const lines = binary ? "binary" : `${splitLines(buf.toString("utf8")).length} lines`;
  return `${rel} · file · ${formatSize(st.size)} · ${lines} · version ${versionOf(buf)} · modified ${st.mtime.toISOString()}`;
}

const CODE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py"]);
const SYMBOL_RE =
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?\s+([A-Za-z_$][\w$]*)|class\s+([A-Za-z_$][\w$]*)|interface\s+([A-Za-z_$][\w$]*)|type\s+([A-Za-z_$][\w$]*)\s*=|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>|def\s+([A-Za-z_]\w*))/;

function symbolsOf(text: string, max = 6): string[] {
  const found: string[] = [];
  for (const line of text.split("\n")) {
    const m = SYMBOL_RE.exec(line);
    if (m) {
      const name = m.slice(1).find(Boolean);
      if (name && !found.includes(name)) found.push(name);
      if (found.length >= max) break;
    }
  }
  return found;
}

export async function repoMap(sb: Sandbox, p = ".", maxDepth = 3): Promise<string> {
  const abs = sb.resolve(p, { allowRoot: true });
  const st = await statOrNull(abs);
  if (!st || !st.isDirectory()) throw new ToolError(`"${sb.relative(abs)}" is not a folder.`);
  const depthLimit = Math.min(Math.max(1, maxDepth), 6);
  const out: string[] = [`${sb.relative(abs)}/`];
  let truncated = false;

  async function walk(dirAbs: string, depth: number): Promise<void> {
    for (const d of await sortedEntries(dirAbs)) {
      if (out.length >= LIMITS.maxMapLines) {
        truncated = true;
        return;
      }
      const indent = "  ".repeat(depth);
      const child = path.join(dirAbs, d.name);
      if (d.isSymbolicLink()) continue;
      if (d.isDirectory()) {
        if (depth >= depthLimit) {
          out.push(`${indent}${d.name}/ (${(await sortedEntries(child)).length} items, not expanded)`);
        } else {
          out.push(`${indent}${d.name}/`);
          await walk(child, depth + 1);
        }
      } else {
        const s = await fs.stat(child);
        let detail = formatSize(s.size);
        if (s.size <= LIMITS.maxSearchFileBytes) {
          const buf = await fs.readFile(child);
          if (!buf.includes(0)) {
            const text = buf.toString("utf8");
            detail = `${splitLines(text).length} lines`;
            if (CODE_EXTS.has(path.extname(d.name).toLowerCase())) {
              const syms = symbolsOf(text);
              if (syms.length) detail += ` · ${syms.join(", ")}`;
            }
          }
        }
        out.push(`${indent}${d.name} (${detail})`);
      }
    }
  }
  await walk(abs, 1);
  if (truncated) out.push(`… map truncated at ${LIMITS.maxMapLines} lines; call repo_map on a subfolder for more.`);
  return out.join("\n");
}
