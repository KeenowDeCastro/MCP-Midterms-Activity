import fs from "node:fs";
import path from "node:path";
import express from "express";
import type { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { loadConfig } from "./config.ts";
import { createSandbox } from "./sandbox.ts";
import { createLogger } from "./logger.ts";
import { extractToken, roleForToken } from "./auth.ts";
import { registerTools } from "./tools.ts";

const config = loadConfig();
const sandbox = createSandbox(config.workspaceRoot);
const logger = createLogger(config.logDir);

/** Sent to every client on connect. This is how a fresh agent learns the handoff protocol. */
const INSTRUCTIONS = `This server is a shared workspace for several agent sessions. Agents do not talk to each other; they hand off through four files at the workspace root.

Start of every session:
1. read_file PROJECT_STATE.md (the current truth: goal, status, next step).
2. read_file PLAN_LOG.md with start_line=-40 (only the recent entries).
3. Append a short plan for this session to PLAN_LOG.md before changing anything.

While working: read before you edit, use str_replace for small changes, pass if_version, prefer search_code and repo_map over reading whole files, and batch independent calls.

End of every session:
1. Update PROJECT_STATE.md (status, next step, blockers) with str_replace or write_file + if_version.
2. Append what you did and the result to PLAN_LOG.md.
3. If a milestone is verified, append it to CHECKPOINTS.md and git_commit with a clear message.
4. Record any design choice with its reason in DECISIONS.md.`;

function buildServer(role: string): McpServer {
  const server = new McpServer({ name: "mcp-file-server", version: "1.0.0" }, { instructions: INSTRUCTIONS });
  registerTools(server, { sandbox, config, logger, role });

  // RESOURCE (application-controlled): the host can attach the current project state without a tool call.
  server.registerResource(
    "project-state",
    "workspace://PROJECT_STATE.md",
    { title: "Project state", description: "Current goal, status and next step of the shared project.", mimeType: "text/markdown" },
    async (uri) => {
      const file = path.join(sandbox.root, "PROJECT_STATE.md");
      const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "PROJECT_STATE.md does not exist yet. Run npm run init:workspace.";
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
    },
  );

  // PROMPTS (user-controlled): repeatable start/end-of-session workflows, shown as slash commands in many clients.
  server.registerPrompt(
    "start_session",
    {
      title: "Start a session",
      description: "Load the handoff files and plan this session.",
      argsSchema: { role: z.string().describe("Your role this session, e.g. planner, builder, reviewer") },
    },
    ({ role: r }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `You are the ${r} for this session. Read PROJECT_STATE.md and the last 40 lines of PLAN_LOG.md, then append a dated entry to PLAN_LOG.md headed "## <date> · ${r}" with your plan (3-6 steps) before doing any other work.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "end_session",
    { title: "End a session", description: "Write the handoff so the next agent can continue." },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "Wrap up: update PROJECT_STATE.md (status, next step, blockers), append Did/Result to your PLAN_LOG.md entry, add a CHECKPOINTS.md entry if something was verified, record decisions in DECISIONS.md, then git_commit.",
          },
        },
      ],
    }),
  );

  return server;
}

function authenticate(req: Request): string | undefined {
  if (config.tokens.size === 0 && config.allowNoAuth) return "admin";
  const pathToken = typeof req.params?.token === "string" ? req.params.token : undefined;
  return roleForToken(config.tokens, extractToken(req.headers.authorization, pathToken));
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

// Health check for you and pm2. Reveals nothing about the workspace.
app.get("/health", (_req, res) => {
  res.json({ ok: true, uptimeSeconds: Math.round(process.uptime()) });
});

/**
 * Stateless Streamable HTTP: each POST gets a fresh McpServer + transport.
 * Nothing is kept in memory between requests, so restarts lose nothing and
 * the role is re-checked on every single call.
 */
async function handleMcp(req: Request, res: Response): Promise<void> {
  const role = authenticate(req);
  if (!role) {
    res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized: missing or invalid token" }, id: null });
    return;
  }
  const server = buildServer(role);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request failed", err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
}

function methodNotAllowed(_req: Request, res: Response): void {
  res
    .status(405)
    .set("Allow", "POST")
    .json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed: this server is stateless, use POST" }, id: null });
}

app.post("/mcp", handleMcp);
app.post("/mcp/:token", handleMcp);
for (const route of ["/mcp", "/mcp/:token"]) {
  app.get(route, methodNotAllowed);
  app.delete(route, methodNotAllowed);
}

app.listen(config.port, config.host, () => {
  const roles = [...new Set(config.tokens.values())].join(", ") || "(no auth — local testing only)";
  console.log(`MCP file server on http://${config.host}:${config.port}/mcp`);
  console.log(`Workspace: ${sandbox.root}`);
  console.log(`Roles with tokens: ${roles} · delete ${config.allowDelete ? "enabled" : "disabled"} · log: ${logger.file}`);
});
