/**
 * End-to-end check of a running server using raw JSON-RPC over HTTP —
 * exactly the messages an MCP client sends (slide 7: initialize -> tools/list -> tools/call).
 *
 *   npm run smoke                                  # local server, first token in .env
 *   SMOKE_URL=https://you.ngrok-free.app/mcp npm run smoke   # through the tunnel
 */
const url = process.env.SMOKE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 8787}/mcp`;
const firstPair = (process.env.AUTH_TOKENS ?? "").split(",")[0] ?? "";
const token = process.env.SMOKE_TOKEN ?? firstPair.slice(firstPair.indexOf("=") + 1);

let id = 0;
let failures = 0;

async function rpc(method: string, params: unknown = {}, auth = true, notification = false) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  const body = notification ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: ++id, method, params };
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function call(name: string, args: Record<string, unknown>) {
  const r = await rpc("tools/call", { name, arguments: args });
  const text: string = r.json?.result?.content?.[0]?.text ?? JSON.stringify(r.json);
  return { isError: Boolean(r.json?.result?.isError), text };
}

console.log(`Smoke test against ${url}\n`);

const noAuth = await rpc("tools/list", {}, false);
check("request without token is rejected", noAuth.status === 401, `HTTP ${noAuth.status}`);

const init = await rpc("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "smoke-test", version: "1.0.0" },
});
check("initialize", Boolean(init.json?.result?.serverInfo), init.json?.result?.serverInfo?.name);

const initialized = await rpc("notifications/initialized", {}, true, true);
check("notifications/initialized accepted", initialized.status === 202, `HTTP ${initialized.status}`);

const list = await rpc("tools/list");
const names: string[] = (list.json?.result?.tools ?? []).map((t: { name: string }) => t.name);
check("tools/list returns at least 8 tools", names.length >= 8, `${names.length}: ${names.join(", ")}`);

const ls = await call("list_files", { path: "." });
check("list_files on workspace root", !ls.isError, ls.text.split("\n")[0]);

const state = await call("read_file", { path: "PROJECT_STATE.md", max_lines: 5 });
check("read_file PROJECT_STATE.md", !state.isError, state.text.split("\n")[0]);

for (const evil of ["../.env", "/etc/passwd", "..\\..\\secret.txt", "notes/../../outside.txt", ".git/config"]) {
  const r = await call("read_file", { path: evil });
  check(`sandbox blocks ${JSON.stringify(evil)}`, r.isError, r.text.slice(0, 80));
}

if (names.includes("write_file")) {
  const path = `smoke/hello-${Date.now()}.md`;
  const w = await call("write_file", { path, content: "hello\nworld\n" });
  check("write_file creates a file", !w.isError, w.text);
  const again = await call("write_file", { path, content: "overwrite blindly" });
  check("write_file refuses blind overwrite", again.isError, again.text.slice(0, 80));
  const rep = await call("str_replace", { path, old_str: "world", new_str: "MCP" });
  check("str_replace edits one match", !rep.isError, rep.text);
  if (names.includes("delete_file")) {
    const noConfirm = await call("delete_file", { path, confirm: false });
    check("delete_file without confirm is refused", noConfirm.isError);
    const del = await call("delete_file", { path, confirm: true });
    check("delete_file with confirm", !del.isError, del.text);
  }
}

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
