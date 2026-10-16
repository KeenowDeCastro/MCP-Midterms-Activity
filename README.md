# MCP File Server

A sandboxed [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that gives AI agents a shared workspace: 13 file and git tools, per-role access, version-checked edits, call logging, and a four-file handoff protocol so work carries across agent sessions.

Built for CS 3A/3B Midterms Pt 1 (Week 6: Model Context Protocol).

## How it works

```
Claude chat (claude.ai)
      │  HTTPS (custom connector)
      ▼
ngrok tunnel   https://<NGROK_DOMAIN>
      ▼
Express server (src/server.ts, port 8787, kept alive by pm2)
      │  1. token in the URL or header is checked (constant-time)
      │  2. the token selects a role: admin | builder | planner | reviewer
      │  3. every tool path goes through the sandbox
      ▼
workspace/   <- the only folder agents can touch (its own git repo)
```

## What it does

| Area | Tools |
|---|---|
| Read | `list_files`, `read_file` (chunked; a negative `start_line` reads the tail), `file_info`, `search_code`, `repo_map` |
| Write | `write_file` (needs `if_version` to overwrite), `str_replace` (exactly one match), `append_file`, `delete_file` (needs `confirm=true`) |
| Git-lite | `git_status`, `git_log`, `git_diff`, `git_commit` |

Also: one **resource** (`workspace://PROJECT_STATE.md`) and two **prompts** (`start_session`, `end_session`). The server also sends the handoff rules to every client in its `instructions`.

## Requirements

- Node.js 20.12 or newer (`node -v`)
- git (`git --version`)
- An ngrok account with a free static domain, and ngrok **3.20.0 or newer** (older versions are rejected for free accounts: error `ERR_NGROK_121`)
- pm2: `npm install -g pm2`

## Setup

```bash
git clone https://github.com/KeenowDeCastro/MCP-Midterms-Activity.git
cd MCP-Midterms-Activity
npm install
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env
npm run token                 # run once per role, paste each into AUTH_TOKENS in .env
npm run init:workspace        # creates workspace/ with the handoff files and its own git repo
npm test                      # 30 unit tests: sandbox, file ops, git, auth
```

### Settings (`.env`)

| Variable | Meaning |
|---|---|
| `PORT`, `HOST` | Where the server listens. Keep `HOST=127.0.0.1` so only the tunnel can reach it. |
| `WORKSPACE_ROOT` | The sandbox folder. Every path an agent sends is resolved inside it. |
| `LOG_DIR` | Where `tool-calls.jsonl` is written (outside the workspace). |
| `AUTH_TOKENS` | `role=token,role=token`, for example `builder=...,planner=...,reviewer=...`. No spaces, no quotes. |
| `ALLOW_NO_AUTH` | `false` always, except for quick local tests. Never `true` while the tunnel is up. |
| `ALLOW_DELETE` | Gate for the `delete_file` tool. |
| `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL` | Identity on commits made through `git_commit`. |
| `NGROK_DOMAIN` | Your free ngrok domain, without `https://`. |
| `NGROK_PATH` | Windows only: full path to `ngrok.exe` with forward slashes, so pm2 can start the tunnel. |

Never commit `.env`. It is listed in `.gitignore`.

## Run

Development:

```bash
npm run dev       # auto-restarts on code changes
npm run smoke     # in a second terminal: end-to-end JSON-RPC checks
```

Production (restarts itself after a crash):

```bash
ngrok config add-authtoken <your-ngrok-authtoken>
npm run build
pm2 start ecosystem.config.cjs     # starts the server and the ngrok tunnel
pm2 status                         # both should be "online"
pm2 save
pm2 startup                        # macOS/Linux only. On Windows run `pm2 resurrect` after a reboot.
```

Check it:

```bash
curl https://<NGROK_DOMAIN>/health
SMOKE_URL=https://<NGROK_DOMAIN>/mcp npm run smoke     # PowerShell: $env:SMOKE_URL="https://<NGROK_DOMAIN>/mcp"; npm run smoke
```

## Connect a client

**MCP Inspector:** `npm run inspector`, then choose *Streamable HTTP* with the URL `http://127.0.0.1:8787/mcp/<token>`. (The Inspector 2.x server form has no header field, so the token goes in the URL. Older versions can use the header `Authorization: Bearer <token>` instead.)

**Claude on the web (tested):** *Customize → Connectors → Add custom connector*. Name `mcp-file-server`, URL `https://<NGROK_DOMAIN>/mcp/<token>`, authentication *No sign in*. Then start a chat, click **+ → Connectors**, and switch the connector on.

The token in the URL selects the role. Treat that URL like a password.

## Roles

Defined in `config/roles.json`. Each token in `AUTH_TOKENS` maps to one role, and a role only *sees* the tools it is given.

| Role | Tools | Can do |
|---|---|---|
| admin | 13 | everything |
| builder | 13 | read, write, delete, git commit |
| planner | 10 | read, edit files, git status and log (no delete, no commit) |
| reviewer | 9 | read, append notes, git status/log/diff (no writes, no commit) |

## Handoff protocol

Agents never talk to each other. They hand off through four files at the workspace root:

| File | Rule |
|---|---|
| `PROJECT_STATE.md` | Current truth: goal, status, next step. Edited in place with `if_version`. |
| `PLAN_LOG.md` | Append-only. Plan before acting, result after. |
| `CHECKPOINTS.md` | Append-only. Verified milestones with commit hashes. |
| `DECISIONS.md` | One entry per design decision and its reason. |

The four files cannot be deleted. The workspace is its own git repository (separate from this one), so every agent commit is a recoverable checkpoint.

## Security

- Every path is resolved against `WORKSPACE_ROOT`. `..`, absolute paths, `.git/`, null bytes, and symlinks that leave the workspace are rejected.
- Every request needs a token (Bearer header or secret path). Tokens are compared in constant time.
- The server binds to `127.0.0.1`, so only the tunnel reaches it.
- Git runs through `execFile` (no shell) with hooks disabled, and only inside the workspace's own repository.
- Destructive actions are gated: `delete_file` needs `ALLOW_DELETE=true`, a role that has it, and `confirm=true`. Overwriting needs the file's current version.
- Every tool call is logged to `logs/tool-calls.jsonl`.

Known limitations:

- A token in the URL path can appear in logs of tools that record URLs. Prefer the `Authorization` header where the client supports it.
- The error for a blind `write_file` overwrite includes the file's current version, so an agent can retry without reading the file. Git history is the backup.
- There is no rate limiting.
- Claude's free plan allows one custom connector, so the reviewer role is demonstrated in MCP Inspector, and the Claude sessions share one connector.

## Demo task

Four agent sessions, each in a new chat, built a cut/fill earthworks volume calculator (`earthworks.py`, average end area method) using only the handoff files to carry context.

| Session | Role | Result |
|---|---|---|
| 1 | Planner | Spec, hand-checked test cases, decisions |
| 2 | Builder | `earthworks.py` and `test_earthworks.py` |
| 3 | Reviewer | Found a decision note that described tests that did not exist |
| 4 | Builder | Added the missing tests and fixed a huge-integer overflow |

The agents cannot run code, so I ran the tests myself: `python -m unittest test_earthworks -v` gave 10 tests, OK. Details are in `evidence/` (`transcript.md`, the four handoff files, `workspace-history.txt`) and `docs/REPORT.md`.

## Course requirements

| # | Requirement | Where |
|---|---|---|
| 1 | Sandboxed workspace, escapes rejected | `src/sandbox.ts` and `test/sandbox.test.ts` |
| 2 | At least 8 tools | 13 tools (file, search, git-lite) |
| 3 | HTTPS through a tunnel, kept alive by a process manager | ngrok and pm2 (`ecosystem.config.cjs`) |
| 4 | Handoff protocol | `PROJECT_STATE.md`, `PLAN_LOG.md`, `CHECKPOINTS.md`, `DECISIONS.md` in `workspace/` |
| 5 | Real MCP client, multi-step task across 2+ sessions | Claude on the web, see `evidence/` |
| 6 | Short report | `docs/REPORT.md` |

## Evidence

```bash
npm run transcript                  # writes evidence/transcript.md from the call log
SINCE=2026-10-16 npm run transcript # only calls from a given date
```

Copy `workspace/PLAN_LOG.md` and `workspace/CHECKPOINTS.md` into `evidence/` before submitting.

## Windows notes

- Two symlink tests are skipped unless Windows Developer Mode is on (Settings → System → For developers).
- `pm2 startup` is not supported on Windows. Run `pm2 resurrect` after a reboot.
- pm2 may not find `ngrok` on its own: set `NGROK_PATH` in `.env`.
- Git prints `LF will be replaced by CRLF` warnings. They are harmless.

## Project layout

```
src/
  server.ts      HTTP endpoint, auth, MCP server, resource and prompts
  tools.ts       tool names, descriptions and zod schemas; logging wrapper
  sandbox.ts     path resolution and escape protection
  fileOps.ts     file tool logic (no MCP dependency, unit-tested)
  gitOps.ts      git-lite tool logic
  versioning.ts  content versions and per-file locks
  auth.ts        token parsing and checking
  config.ts      settings from environment variables
  logger.ts      JSONL call log
config/roles.json  tools per role
templates/handoff  starting handoff files
scripts/           init-workspace, smoke-test, export-transcript
test/              unit tests
```