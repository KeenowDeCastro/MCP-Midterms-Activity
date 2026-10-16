# MCP File Server: Project Report

CS 3A/3B Midterms Pt 1 · Keeno De Castro

## 1. What I built

An MCP (Model Context Protocol) server that lets AI agents work in one sandboxed folder. It has 13 tools (file, search and git-lite), four roles with different permissions (admin, builder, planner, reviewer), token authentication, a call log, and a four-file handoff protocol (`PROJECT_STATE.md`, `PLAN_LOG.md`, `CHECKPOINTS.md`, `DECISIONS.md`) so a new agent session can continue where the last one stopped. It runs on my laptop, is exposed over HTTPS through an ngrok tunnel, and is kept alive by pm2. I connected it to Claude on the web as a custom connector.

## 2. Stack and why

- **Node.js + TypeScript:** types catch mistakes in the tool inputs early, and the official MCP SDK is written for it.
- **MCP SDK with Streamable HTTP:** this is the transport remote clients use. The server is stateless, so each request gets a fresh server object and nothing is shared between calls.
- **express:** a small, familiar way to handle the `/mcp` routes and `/health`.
- **zod:** every tool input is validated before any logic runs, so bad input is refused with a clear message.
- **ngrok:** gives the local server a free, fixed HTTPS address.
- **pm2:** restarts the server and the tunnel after a crash.

## 3. Tool design

I kept the tools small and gave each one a guard against a specific mistake:

- `write_file` needs `if_version` to overwrite an existing file. The version is a short hash of the content, so an agent can't silently overwrite work another session did.
- `str_replace` only works if the text matches exactly once. That avoids edits in the wrong place.
- `delete_file` needs `confirm=true`, `ALLOW_DELETE=true` and a role that has it. The four handoff files cannot be deleted at all.
- `read_file` reads in chunks, and `search_code` and `repo_map` help an agent find things without loading whole files into its context.
- Roles only register the tools they are allowed to use. A reviewer doesn't get a refused `write_file`; it never sees one.

## 4. Security trade-offs

**What is protected:** every path is resolved against the workspace root. I tested `../.env`, `/etc/passwd`, `..\..\secret.txt` and `.git/config`, and the server refused all of them. Symlinks that point outside the workspace are rejected too. Tokens are compared in constant time, the server only listens on `127.0.0.1`, and git runs without a shell and with hooks disabled.

**Trade-offs I accepted:**
- The Claude connector needs the token in the URL path, because the free custom connector has no header field. That is convenient, but a URL can end up in logs, so I treat it like a password.
- The error for a blind overwrite shows the file's current version, so an agent can retry without reading the file. It is a weakness in the guard. Git history is the backup.
- There is no rate limiting.

## 5. What went wrong and how I fixed it

- **Nested git repo.** `npm run init:workspace` made a commit in my project repo instead of the workspace repo, because the `workspace/` folder sits inside the project and git used the parent repository. I undid it with `git reset HEAD~1`. The fix checks that the workspace has its own `.git` folder before any git command runs, and I added a test for it (commit `87af4b4`).
- **ngrok version.** The tunnel failed with `ERR_NGROK_121`. My ngrok agent (3.3.1) was too old for free accounts, so I updated it. I also first typed a placeholder domain into the dashboard; the free domain is assigned to you.
- **Exposed tokens.** I showed tokens in a chat message and a screenshot. I regenerated all of them before opening the tunnel, and now I check my evidence files for token text before committing.
- **Connector 401.** The first connector attempt returned 401 because it had no token. A connector can't be edited, so I removed it and added it again with the token in the URL.
- **Write guard.** When I tested the overwrite guard on `PROJECT_STATE.md`, the write succeeded because the agent already held a valid version. I restored the file with `git restore` from the workspace history. That is exactly why the workspace is a git repository.

## 6. The demo task

The task was a cut/fill earthworks calculator using the average end area method, built over four separate sessions.

| Session | Role | Result |
|---|---|---|
| 1 | Planner | Wrote the spec, hand-checked test cases and decisions (commit `524cb38`) |
| 2 | Builder | Wrote `earthworks.py` and `test_earthworks.py` (`bc98866`) |
| 3 | Reviewer | Found one must-fix: a decision note described tests that did not exist |
| 4 | Builder | Added the missing tests and fixed a huge-integer overflow (`8a42591`) |

The agents can't run code, so I ran the tests myself: `python -m unittest test_earthworks -v` gave 10 tests, OK. The verified checkpoint (commit `a0a91a5`) was recorded after that run, and the project was closed out in `4875e39`. Each session started in a new chat and recovered its context only from the handoff files. During Session 4 one server error occurred while appending to the plan log; the agent checked that nothing had been written before retrying, so no entry was duplicated.

The tool-call log has 146 calls and 40 errors. Most errors are deliberate security and smoke tests (path escapes, blind overwrites, delete without confirmation) from earlier milestones, which the server refused as designed.

**Free-plan limit:** a free Claude account allows one custom connector, so all four sessions used the builder token. The roles in those sessions were enforced by the prompts only. I demonstrated server-side enforcement separately in MCP Inspector, where the reviewer token does not list `write_file` or `delete_file`.

## 7. What I would improve

- Stop the overwrite error from revealing the current file version.
- Add per-role path rules, so a role can only write to certain folders.
- Add a rate limit and a way to send the token in a header instead of the URL.