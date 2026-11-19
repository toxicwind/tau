#!/usr/bin/env bun
/**
 * session-stream-audit.ts — durable helper (2026-11-03).
 *
 * Fuse a tau session's message transcript + tool timings into one timeline,
 * and surface the "stranded first token / inter-token stall" signature (TTST)
 * that tau does NOT record in the session log.
 *
 * NEVER truncates. Every text/JSON payload is printed in full.
 *
 * Usage:
 *   bun scripts/session-stream-audit.ts <session.jsonl>                  # full fuse
 *   bun scripts/session-stream-audit.ts <session.jsonl> --around "<sub>" # window
 *   bun scripts/session-stream-audit.ts <session.jsonl> --gaps           # max tool gaps
 *   bun scripts/session-stream-audit.ts <session.jsonl> --full           # raw JSON lines
 */
import { readFileSync } from "node:fs";

const file = process.argv[2];
const around = (() => { const a = process.argv.indexOf("--around"); return a >= 0 ? process.argv[a + 1] : undefined; })();
const gapsOnly = process.argv.includes("--gaps");
const full = process.argv.includes("--full");

const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
const events = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

function contentText(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((x) => {
        if (!x || typeof x !== "object") return "";
        const o = x as Record<string, unknown>;
        const t = typeof o.text === "string" ? o.text : "";
        const th = typeof o.thinking === "string" ? o.thinking : "";
        const ar = typeof o.arguments === "string" ? o.arguments : typeof o.arguments === "object" ? JSON.stringify(o.arguments) : "";
        return [t, th ? `[thinking] ${th}` : "", ar ? `[args] ${ar}` : ""].filter(Boolean).join(" ");
      })
      .join("\n");
  }
  return "";
}

if (full) {
  // Raw, completely untruncated JSON lines (optionally filtered around a marker).
  const targetIdx = around
    ? events.findIndex((d) => JSON.stringify(d).includes(around))
    : -1;
  if (around && targetIdx < 0) {
    console.log(`--around "${around}" not found in any raw line`);
    process.exit(1);
  }
  const start = around ? Math.max(0, targetIdx - 3) : 0;
  const end = around ? Math.min(events.length, targetIdx + 12) : events.length;
  for (let i = start; i < end; i++) {
    console.log(`[line${i}] ${JSON.stringify(events[i])}`);
  }
  process.exit(0);
}

interface Row { at: string; role: string; text: string; }
const rows: Row[] = [];
const rawIdx = new Map<number, number>(); // rows index -> original event line (for --full linkage)
let lineNo = -1;
for (const d of events) {
  lineNo++;
  if (d.type === "message") {
    const m = d.message ?? {};
    const text = contentText(m.content);
    rows.push({ at: String(d.timestamp ?? ""), role: String(m.role ?? "?"), text });
    rawIdx.set(rows.length - 1, lineNo);
  } else if (d.type === "custom" && d.customType?.startsWith("tool_")) {
    const data = d.data ?? {};
    rows.push({
      at: String(d.timestamp ?? ""),
      role: String(d.customType),
      text: `tool=${data.toolName} ${d.customType === "tool_execution_start" ? `intent=${JSON.stringify(data.intent ?? "")} args=${JSON.stringify(data.args ?? {})}` : ""}`,
    });
    rawIdx.set(rows.length - 1, lineNo);
  } else {
    rows.push({ at: String(d.timestamp ?? ""), role: `type:${d.type}`, text: JSON.stringify(d) });
    rawIdx.set(rows.length - 1, lineNo);
  }
}

if (gapsOnly) {
  let prevToolAt: string | undefined;
  let maxGap = 0;
  let worstStart = "";
  for (const r of rows) {
    if (r.role === "tool_execution_start") prevToolAt = r.at;
  }
  const starts = rows.filter((r) => r.role === "tool_execution_start").map((r) => r.at);
  const results: Array<{ start: string; maxGapMs?: number }> = [];
  for (let i = 0; i < starts.length; i++) {
    const next = rows.findIndex((r) => r.role === "tool_result" && r.at >= starts[i] && r.text.includes("wallTimeMs"));
    if (next >= 0) {
      const g = new Date(rows[next].at).getTime() - new Date(starts[i]!).getTime();
      if (g > maxGap) { maxGap = g; worstStart = starts[i]!; }
      results.push({ start: starts[i]!, maxGapMs: g });
    }
  }
  console.log(JSON.stringify({ maxToolGapMs: maxGap, worstStart, gaps: results.slice(-5) }, null, 2));
  process.exit(0);
}

const idxAround = around ? rows.findIndex((r) => r.text.includes(around)) : -1;
if (around && idxAround < 0) {
  console.log(`--around "${around}" matched nothing. Roles: ${[...new Set(rows.map((r) => r.role))].join(", ")}`);
  process.exit(1);
}
const start = around ? Math.max(0, idxAround - 3) : 0;
const end = around ? Math.min(rows.length, idxAround + 12) : rows.length;
for (let i = start; i < end; i++) {
  const r = rows[i];
  const rolePad = (r.role + ":").padEnd(16);
  const body = r.text ? `\n${r.text}` : "";
  console.log(`${r.at}  ${rolePad}${body}`);
}
void gapsOnly;