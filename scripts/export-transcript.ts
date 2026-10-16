/**
 * Turns logs/tool-calls.jsonl into evidence/transcript.md: every call in order,
 * plus the numbers the rubric's "agent efficiency" criterion looks at
 * (calls per role, errors, average result size, repeated identical calls).
 *
 *   npm run transcript                 # all calls
 *   SINCE=2026-10-20 npm run transcript   # only calls on/after a date
 */
import fs from "node:fs";
import path from "node:path";

const logFile = path.join(path.resolve(process.env.LOG_DIR ?? "./logs"), "tool-calls.jsonl");
if (!fs.existsSync(logFile)) {
  console.error(`No log at ${logFile}. Run the server and make some tool calls first.`);
  process.exit(1);
}
const since = process.env.SINCE ?? "";
type Entry = { ts: string; role: string; tool: string; args: Record<string, unknown>; ok: boolean; ms: number; resultChars: number; error?: string };
const entries: Entry[] = fs
  .readFileSync(logFile, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Entry)
  .filter((e) => e.ts >= since);

const byRole = new Map<string, number>();
const byTool = new Map<string, number>();
const seen = new Map<string, number>();
let errors = 0;
let chars = 0;
for (const e of entries) {
  byRole.set(e.role, (byRole.get(e.role) ?? 0) + 1);
  byTool.set(e.tool, (byTool.get(e.tool) ?? 0) + 1);
  const key = `${e.role}|${e.tool}|${JSON.stringify(e.args)}`;
  seen.set(key, (seen.get(key) ?? 0) + 1);
  if (!e.ok) errors++;
  chars += e.resultChars ?? 0;
}
const repeats = [...seen.values()].filter((n) => n > 1).reduce((a, n) => a + n - 1, 0);
const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

const md: string[] = [
  "# Tool-call transcript",
  "",
  `Generated ${new Date().toISOString()} from \`${path.basename(logFile)}\`${since ? ` (since ${since})` : ""}.`,
  "",
  "## Summary",
  "",
  `- Total calls: **${entries.length}**`,
  `- Errors returned to agents: **${errors}**`,
  `- Identical repeated calls: **${repeats}**`,
  `- Average result size: **${entries.length ? Math.round(chars / entries.length) : 0} characters**`,
  `- Calls by role: ${[...byRole].map(([r, n]) => `${r} ${n}`).join(", ")}`,
  `- Calls by tool: ${[...byTool].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(", ")}`,
  "",
  "## Calls",
  "",
  "| # | Time (UTC) | Role | Tool | Arguments | Result |",
  "|---|---|---|---|---|---|",
  ...entries.map(
    (e, i) =>
      `| ${i + 1} | ${e.ts.slice(0, 19).replace("T", " ")} | ${e.role} | ${e.tool} | \`${esc(JSON.stringify(e.args))}\` | ${
        e.ok ? `ok, ${e.resultChars} chars, ${e.ms} ms` : `**error:** ${esc(e.error ?? "")}`
      } |`,
  ),
];

fs.mkdirSync("evidence", { recursive: true });
fs.writeFileSync("evidence/transcript.md", md.join("\n") + "\n");
console.log(`Wrote evidence/transcript.md (${entries.length} calls, ${errors} errors, ${repeats} repeats).`);
