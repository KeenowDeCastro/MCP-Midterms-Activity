import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Sandbox } from "./sandbox.ts";
import type { Config } from "./config.ts";
import type { Logger } from "./logger.ts";
import { summarizeArgs } from "./logger.ts";
import { ToolError } from "./errors.ts";
import * as files from "./fileOps.ts";
import * as gitops from "./gitOps.ts";

export interface ToolContext {
  sandbox: Sandbox;
  config: Config;
  logger: Logger;
  role: string;
}

interface Annotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
}

type Handler = (args: any) => Promise<string>;

// Reusable schema pieces, so every tool describes the same field the same way.
const pathArg = z.string().min(1).describe('Path relative to the workspace root, e.g. "src/app.ts". Never absolute.');
const ifVersionArg = z
  .string()
  .regex(/^([0-9a-f]{12}|new)$/)
  .optional()
  .describe('The 12-character version from your last read_file/file_info of this file, or "new" when creating a file.');

/** Registers every tool this role is allowed to use. Returns the names that were registered. */
export function registerTools(server: McpServer, ctx: ToolContext): string[] {
  const { sandbox: sb, config, logger, role } = ctx;
  const allowed = config.roles[role] ?? [];
  const registered: string[] = [];

  // One wrapper for every tool: role check, logging, timing, and turning errors into isError results.
  // registerTool's generic types are very deep; we cast once here so each tool below stays readable.
  const register = server.registerTool.bind(server) as unknown as (
    name: string,
    config: { title: string; description: string; inputSchema: z.ZodRawShape; annotations: Annotations },
    cb: (args: Record<string, unknown>) => Promise<CallToolResult>,
  ) => void;

  function tool(name: string, title: string, description: string, shape: z.ZodRawShape, annotations: Annotations, handler: Handler): void {
    if (!allowed.includes("*") && !allowed.includes(name)) return;
    registered.push(name);
    register(name, { title, description, inputSchema: shape, annotations }, async (args) => {
      const started = Date.now();
      let text: string;
      let isError = false;
      let error: string | undefined;
      try {
        text = await handler(args);
      } catch (err) {
        isError = true;
        if (err instanceof ToolError) {
          text = err.message;
        } else {
          console.error(`[${name}] unexpected error`, err);
          text = `Internal error in ${name}: ${(err as Error).message}. This is a server bug, not your input.`;
        }
        error = text.slice(0, 200);
      }
      logger.log({
        ts: new Date().toISOString(),
        role,
        tool: name,
        args: summarizeArgs(args),
        ok: !isError,
        ms: Date.now() - started,
        resultChars: text.length,
        error,
      });
      return { content: [{ type: "text" as const, text }], isError };
    });
  }

  const READ: Annotations = { readOnlyHint: true, idempotentHint: true };

  // ---------------- file tools ----------------

  tool(
    "list_files",
    "List files",
    "List the files and folders at a path in the workspace. Folders end with '/'. Use recursive=true only on small folders; " +
      "for an overview of a whole project prefer repo_map. Skips .git and node_modules.",
    {
      path: z.string().default(".").describe('Folder to list, relative to the workspace root. "." is the root.'),
      recursive: z.boolean().default(false).describe("Also list everything inside subfolders."),
      max_entries: z.number().int().min(1).max(1000).default(200).describe("Stop after this many entries."),
    },
    READ,
    (a) => files.listFiles(sb, a.path, a.recursive, a.max_entries),
  );

  tool(
    "read_file",
    "Read a file",
    "Read a text file in chunks. Returns a header with the file's version (needed for safe edits) and which lines you got. " +
      "Reads 200 lines by default; use start_line to page, or a negative start_line for the end of the file " +
      "(start_line=-20 gives the last 20 lines, handy for PLAN_LOG.md). Read before you edit.",
    {
      path: pathArg,
      start_line: z.number().int().default(1).describe("1-based first line. Negative counts from the end."),
      max_lines: z.number().int().min(1).max(1000).default(200).describe("How many lines to return."),
    },
    READ,
    (a) => files.readFile(sb, a.path, a.start_line, a.max_lines),
  );

  tool(
    "write_file",
    "Write a whole file",
    "Create a new file, or replace an existing file's entire content. Creating: omit if_version. Overwriting: you MUST pass " +
      "if_version from your latest read, or the call fails, so you never overwrite changes you have not seen. " +
      "For small edits to an existing file use str_replace instead. Parent folders are created automatically.",
    {
      path: pathArg,
      content: z.string().describe("The complete new file content."),
      if_version: ifVersionArg,
    },
    { destructiveHint: true },
    (a) => files.writeFile(sb, a.path, a.content, a.if_version),
  );

  tool(
    "str_replace",
    "Replace text in a file",
    "Replace one exact occurrence of old_str with new_str in a file. old_str must appear exactly once, or the call fails; " +
      "if it is not unique, widen it with surrounding lines. Whitespace and indentation must match exactly. " +
      "Pass if_version to make sure the file has not changed since you read it.",
    {
      path: pathArg,
      old_str: z.string().min(1).describe("Exact text currently in the file. Must match exactly one place."),
      new_str: z.string().describe("Replacement text. Use an empty string to delete old_str."),
      if_version: ifVersionArg,
    },
    { destructiveHint: true },
    (a) => files.strReplace(sb, a.path, a.old_str, a.new_str, a.if_version),
  );

  tool(
    "append_file",
    "Append to a file",
    "Add text to the end of a file (creating it if missing) without resending the whole file. " +
      "Use this for logs such as PLAN_LOG.md and CHECKPOINTS.md. A newline is added between old and new content when needed.",
    {
      path: pathArg,
      content: z.string().min(1).describe("Text to add at the end."),
      if_version: ifVersionArg,
    },
    { destructiveHint: false },
    (a) => files.appendFile(sb, a.path, a.content, a.if_version),
  );

  tool(
    "delete_file",
    "Delete a file",
    "Permanently delete one file (not folders). Destructive: you must pass confirm=true. The four handoff files " +
      "(PROJECT_STATE, PLAN_LOG, CHECKPOINTS, DECISIONS) can never be deleted. Committed files can be restored with git.",
    {
      path: pathArg,
      confirm: z.boolean().describe("Must be true. Forces a deliberate decision before deleting."),
    },
    { destructiveHint: true },
    (a) => files.deleteFile(sb, a.path, a.confirm, config.allowDelete),
  );

  tool(
    "search_code",
    "Search file contents",
    "Find lines containing text (or a regular expression) across the workspace. Returns file:line: text, so you can read " +
      "just the part you need instead of whole files. Narrow with path or extensions on big projects.",
    {
      query: z.string().min(1).describe("Text to look for. Plain text unless regex=true."),
      path: z.string().default(".").describe("Folder or file to search in."),
      regex: z.boolean().default(false).describe("Treat query as a JavaScript regular expression."),
      case_sensitive: z.boolean().default(false),
      extensions: z.array(z.string()).optional().describe('Only these file types, e.g. [".ts", ".md"].'),
      max_results: z.number().int().min(1).max(200).default(50),
    },
    READ,
    (a) =>
      files.searchCode(sb, a.query, {
        path: a.path,
        regex: a.regex,
        caseSensitive: a.case_sensitive,
        extensions: a.extensions,
        maxResults: a.max_results,
      }),
  );

  tool(
    "file_info",
    "File info",
    "Get size, line count, version and modified time of a file (or entry count of a folder) without reading its content. " +
      "Use it to get a version for if_version, or to check if something changed.",
    { path: z.string().default(".").describe("File or folder path.") },
    READ,
    (a) => files.fileInfo(sb, a.path),
  );

  tool(
    "repo_map",
    "Map the project",
    "Show the folder tree with line counts and the main functions/classes in each code file. " +
      "Use this first on an unfamiliar project: it is far cheaper than reading every file.",
    {
      path: z.string().default(".").describe("Folder to map."),
      max_depth: z.number().int().min(1).max(6).default(3).describe("How many folder levels to expand."),
    },
    READ,
    (a) => files.repoMap(sb, a.path, a.max_depth),
  );

  // ---------------- git-lite tools ----------------

  tool(
    "git_status",
    "Git status",
    "Show the current branch and which files are new, modified or deleted since the last commit.",
    {},
    READ,
    () => gitops.gitStatus(sb),
  );

  tool(
    "git_log",
    "Git log",
    "Show recent commits (short hash, date, message), newest first.",
    { limit: z.number().int().min(1).max(100).default(10) },
    READ,
    (a) => gitops.gitLog(sb, a.limit),
  );

  tool(
    "git_diff",
    "Git diff",
    "Show uncommitted changes as a unified diff, with a summary first. Pass path to see one file. " +
      "Use it to review work before git_commit.",
    {
      path: z.string().optional().describe("Limit the diff to this file or folder."),
      staged: z.boolean().default(false).describe("Show staged changes instead of unstaged ones."),
      max_lines: z.number().int().min(20).max(2000).default(300),
    },
    READ,
    (a) => gitops.gitDiff(sb, a.path, a.staged, a.max_lines),
  );

  tool(
    "git_commit",
    "Git commit",
    "Stage and commit changes in the workspace with a message. By default commits everything; pass paths to commit only " +
      "some files. Commit at each checkpoint so work can be reviewed and rolled back.",
    {
      message: z.string().min(1).max(2000).describe("What changed and why, e.g. 'Add input validation to parser'."),
      paths: z.array(z.string()).optional().describe("Only commit these paths."),
    },
    { destructiveHint: false },
    (a) => gitops.gitCommit(sb, a.message, config.git, a.paths),
  );

  return registered;
}
