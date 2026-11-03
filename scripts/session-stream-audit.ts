#!/usr/bin/env bun
/**
 * session-stream-audit.ts — durable helper (2026-11-03).
 *
 * Fuse a tau session's message transcript + tool timings + stream timing into
 * one timeline, and surface the "stranded first token / inter-token stall"
 * signature (TTST) that tau does NOT record anywhere in the session log.
 *
 * Usage:
 *   bun scripts/session-stream-audit.ts <session.jsonl>            # full fuse
 *   bun scripts/session-stream-audit.ts <session.jsonl> --around "A stranded"
 *   bun scripts/session-stream-audit.ts <session.jsonl> --gaps     # max inter-token gaps
 *
 * The session log is EVENT-shaped ({"type":"message"...} etc), not
 * message-shaped. USER turns live at type=message role=user; tool calls at
 * type=custom customType=tool_execution_start. Stream transport events (SSE
 * socket connect/latency) are NOT persisted — that is the measurement gap.
 */
import { readFileSync } from "node:fs";

const file = process.argv[2];
const around = (() => {
  const a = process.argv.indexOf("--around");
  return a >= 0 ? process.argv[a + 1] : undefined;
})();
const gapsOnly = process.argv.includes("--gaps");

const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
const events = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

interface Row { at: string; role: string; text: string; }
const rows: Row[] = [];
for (const d of events) {
  if (d.type === "message") {
    const m = d.message ?? {};
    let txt: string | undefined;
    const c = m.content;
    if (typeof c === "string") txt = c;
    else if (Array.isArray(c)) txt = c.map((x) => (x && typeof x.text === "string" ? x.text : "")).join("");
    rows.push({ at: d.timestamp ?? "", role: String(m.role ?? "?"), text: txt ?? "" });
  } else if (d.type === "custom" && d.customType === "tool_execution_start") {
    const data = d.data ?? {};
    rows.push({
      at: d.timestamp ?? "",
      role: "tool_start",
      text: `tool=${data.toolName} intent=${String(data.intent ?? "").slice(0, 60)} args=${JSON.stringify(data.args ?? {}).slice(0, 80)}`,
    });
  } else if (d.type === "custom") {
    rows.push({ at: d.timestamp ?? "", role: `custom:${d.customType}`, text: JSON.stringify(d.data ?? d.custom ?? {}).slice(0, 80) });
  }
}

if (gapsOnly) {
  // Approximate inter-token stalls from tool_start timestamps (the only
  // per-turn latency the log keeps). A long tool_start → tool_result gap is a
  // provider-turn stall proxy. Exact token gaps need the missing TTST record.
  let prevToolAt: string | undefined;
  let maxGap = 0;
  let worstStart = "";
  for (const r of rows) {
    if (r.role === "tool_start") {
      prevToolAt = r.at;
    } else if (r.role === "tool_result") {
      if (prevToolAt) {
        const g = new Date(r.at).getTime() - new Date(prevToolAt).getTime();
        if (g > maxGap && g > 0) { maxGap = g; worstStart = prevToolAt; }
      }
      prevToolAt = undefined;
    }
  }
  console.log(JSON.stringify({ maxToolGapMs: maxGap, worstStart }, null, 2));
  process.exit(0);
}

const idxAround = around
  ? rows.findIndex((r) => r.text.includes(around))
  : -1;

if (around && idxAround < 0) {
  console.log(`--around "${around}" matched nothing. Sample roles:`, [...new Set(rows.map((r) => r.role))].join(", "));
  process.exit(1);
}

const start = around ? Math.max(0, idxAround - 3) : 0;
const end = around ? Math.min(rows.length, idxAround + 12) : rows.length;
for (let i = start; i < end; i++) {
  const r = rows[i];
  const t = r.text.length > 120 ? r.text.slice(0, 120) + "…" : r.text;
  console.log(`${r.at}  ${(r.role + ":").padEnd(12)} ${t.replace(/\n/g, " ")}`);
}
void gapsOnly;