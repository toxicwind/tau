// bun run ./tau-doctor.ts        (DEEP=1 also runs cuttinggate bun test + flock-proxy cargo check)
// Read-only except it sends a few tiny chat requests. Never prints secrets: fingerprints only.
import { Database } from "bun:sqlite";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

const HOME = homedir(), DEEP = process.env.DEEP === "1", PER_PROVIDER = Number(process.env.K ?? 2);
const fp = (v: string) => v ? `${v.slice(0, 4)}…${v.slice(-2)}#${createHash("sha256").update(v).digest("hex").slice(0, 6)}` : "(empty)";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const out: string[] = [], findings: { sev: "BAD" | "WARN" | "OK"; msg: string }[] = [];
const say = (s = "") => { console.log(s); out.push(s); };
const hdr = (s: string) => say(`\n== ${s}`);
const find = (sev: "BAD" | "WARN" | "OK", msg: string) => { findings.push({ sev, msg }); say(`  [${sev}] ${msg}`); };

async function http(method: string, url: string, headers: Record<string, string> = {}, body?: any, ms = 45_000) {
  const t = performance.now();
  try {
    const r = await fetch(url, { method, headers: { "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(ms) });
    const text = await r.text();
    return { status: r.status, ms: Math.round(performance.now() - t), text };
  } catch (e: any) { return { status: 0, ms: Math.round(performance.now() - t), text: String(e?.code ?? e?.message ?? e) }; }
}
async function sh(cmd: string[], cwd: string, ms: number) {
  const p = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => p.kill(), ms);
  const [o, e] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  await p.exited; clearTimeout(timer);
  return { code: p.exitCode, text: (o + e).trim().split("\n").slice(-15).join("\n") };
}
const bearer = (k: string) => (k ? { authorization: `Bearer ${k}` } : {});

// ── 1. services ──────────────────────────────────────────────────────────
hdr("1. services");
const svc: [string, string][] = [["cuttinggate", "http://127.0.0.1:25200/health"], ["flock", "http://127.0.0.1:25193/health"], ["vansrouter", "http://127.0.0.1:20128/api/health"], ["omniroute", "http://127.0.0.1:20130/api/health"]];
for (const [n, u] of svc) { const r = await http("GET", u, {}, undefined, 8000); r.status === 200 ? find("OK", `${n} up (${r.ms}ms)`) : find(n === "omniroute" ? "WARN" : "BAD", `${n} ${u} → ${r.status} ${r.text.slice(0, 60)}`); }
const cg = await http("GET", "http://127.0.0.1:25200/status", {}, undefined, 8000); say(`  cuttinggate /status: ${cg.status} ${cg.text.replace(/\s+/g, " ").slice(0, 300)}`);

// ── 2. key drift ─────────────────────────────────────────────────────────
hdr("2. flock key sources (fingerprints)");
const envKey = process.env.FLOCK_API_KEY ?? "";
let dotenvKey = ""; for (const f of [`${HOME}/estate/config/tau/.env`, `${HOME}/estate/.env`]) if (existsSync(f)) { const m = readFileSync(f, "utf8").match(/^\s*(?:export\s+)?FLOCK_API_KEY\s*=\s*["']?([^"'\n#]+)/m); if (m) { dotenvKey = m[1].trim(); say(`  ${f.replace(HOME, "~")}: ${fp(dotenvKey)}`); break; } }
say(`  shell env: ${fp(envKey)}`);

// ── 3. models.yml → test every configured provider end to end ────────────
hdr("3. ~/.tau/agent/models.yml providers (live /models + tiny tool-call chat)");
const ECHO = { type: "function", function: { name: "echo", description: "echo an integer", parameters: { type: "object", properties: { x: { type: "integer" } }, required: ["x"] } } };
const resolveKey = (v: any) => typeof v !== "string" ? "" : /^[A-Z][A-Z0-9_]{3,}$/.test(v) ? (process.env[v] ?? "") : v.startsWith("$") ? (process.env[v.replace(/[${}]/g, "")] ?? "") : v.startsWith("!") ? "" : v;
const myml = `${HOME}/.tau/agent/models.yml`;
if (!existsSync(myml)) find("WARN", "models.yml not found");
else {
  const YAML = (Bun as any).YAML;
  let doc: any = null;
  try { doc = YAML.parse(readFileSync(myml, "utf8")); } catch (e: any) { find("BAD", `models.yml unparsable: ${e.message}`); }
  const providers = doc?.providers ?? doc ?? {};
  for (const [name, p] of Object.entries<any>(providers)) {
    if (!p || typeof p !== "object" || !p.baseUrl) continue;
    const base = String(p.baseUrl).replace(/\/$/, ""), key = resolveKey(p.apiKey);
    say(`  ── ${name}  ${base}  key=${key ? fp(key) : "(none/dynamic)"}${p.apiKey && /^[A-Z][A-Z0-9_]{3,}$/.test(String(p.apiKey)) ? ` (env ref ${p.apiKey})` : ""}`);
    if (name === "flock" && key && envKey && key !== envKey) find("BAD", `flock apiKey in models.yml (${fp(key)}) differs from env FLOCK_API_KEY (${fp(envKey)}) — tau may send the stale one`);
    if (name === "flock" && key && dotenvKey && key !== dotenvKey) find("WARN", `flock apiKey in models.yml differs from estate .env (${fp(dotenvKey)})`);
    const lm = await http("GET", `${base}/models`, bearer(key), undefined, 15_000);
    let ids: string[] = []; try { ids = (JSON.parse(lm.text).data ?? []).map((m: any) => m.id); } catch {}
    const cfgIds: string[] = (p.models ?? []).map((m: any) => typeof m === "string" ? m : m.id).filter(Boolean);
    say(`     GET /models → ${lm.status} ${lm.ms}ms, live=${ids.length} configured=${cfgIds.length}`);
    if (lm.status === 401 || lm.status === 403) { find("BAD", `${name}: key rejected on /models (${lm.status})`); continue; }
    if (lm.status !== 200) { find("BAD", `${name}: /models → ${lm.status} ${lm.text.slice(0, 80)}`); continue; }
    const missing = cfgIds.filter(i => ids.length && !ids.includes(i)); if (missing.length) find("WARN", `${name}: ${missing.length} configured model(s) not served upstream: ${missing.slice(0, 5).join(", ")}`);
    const pick = (cfgIds.length ? cfgIds : ids).slice(0, PER_PROVIDER);
    for (const model of pick) {
      await sleep(1500);
      const r = await http("POST", `${base}/chat/completions`, bearer(key), { model, messages: [{ role: "user", content: "call the echo tool with x=1" }], tools: [ECHO], tool_choice: "auto", max_tokens: 512 });
      let j: any = {}; try { j = JSON.parse(r.text); } catch {}
      const tc = j.choices?.[0]?.message?.tool_calls?.length ?? 0, fin = j.choices?.[0]?.finish_reason, err = j.error ? JSON.stringify(j.error).slice(0, 160) : "";
      const ok = r.status === 200 && !err && (tc > 0 || fin === "stop");
      find(ok ? "OK" : "BAD", `${name}/${model}: http=${r.status} ${r.ms}ms fin=${fin ?? "-"} tool_calls=${tc} ${err || (r.status !== 200 ? r.text.slice(0, 160).replace(/\s+/g, " ") : "")}`);
    }
  }
}

// ── 4. cuttinggate custom/dots route + the unverified agent edits ────────
hdr("4. cuttinggate custom/dots + files from the earlier edit batch");
const dr = await http("POST", "http://127.0.0.1:25200/v1/chat/completions", {}, { model: "custom/dots", messages: [{ role: "user", content: "say hi" }], max_tokens: 256 }, 60_000);
(dr.status === 200 ? find : (s: any, m: string) => find("WARN", m))("OK", `custom/dots via cuttinggate → ${dr.status} ${dr.ms}ms ${dr.text.slice(0, 120).replace(/\s+/g, " ")}`);
const P = `${HOME}/estate/ranch/mesh/proxy`;
for (const f of ["cuttinggate/src/dots.ts", "cuttinggate/tests/dots.test.ts", "flock-proxy/src/dots.rs"]) existsSync(`${P}/${f}`) ? find("OK", `exists ${f}`) : find("BAD", `MISSING ${f} (router.ts/proxy.rs import it → build will fail)`);
if (DEEP) {
  const t = await sh(["bun", "test"], `${P}/cuttinggate`, 180_000); find(t.code === 0 ? "OK" : "BAD", `cuttinggate bun test exit=${t.code}`); say(t.text.replace(/^/gm, "     "));
  const c = await sh(["cargo", "check", "--quiet"], `${P}/flock-proxy`, 600_000); find(c.code === 0 ? "OK" : "BAD", `flock-proxy cargo check exit=${c.code}`); say(c.text.replace(/^/gm, "     "));
} else say("  (DEEP=1 to run bun test + cargo check)");

// ── 5. auth store: expiry / blocked credentials (no secret columns) ──────
hdr("5. ~/.tau/agent/agent.db credentials (non-secret columns only)");
try {
  const db = new Database(`${HOME}/.tau/agent/agent.db`, { readonly: true });
  for (const table of ["auth_credentials", "auth_credential_blocks"]) {
    const cols = (db.query(`PRAGMA table_info(${table})`).all() as any[]).map(c => c.name);
    const safe = cols.filter(c => !/key|token|secret|data|value|cred|blob|payload/i.test(c) || /^(credential_?id|id)$/i.test(c));
    say(`  ${table} columns: ${cols.join(", ")}`);
    if (!safe.length) continue;
    const rows = db.query(`SELECT ${safe.map(c => `"${c}"`).join(",")} FROM ${table} LIMIT 25`).all() as any[];
    for (const r of rows) say("    " + Object.entries(r).map(([k, v]) => `${k}=${typeof v === "number" && /expire|until|at$|time/i.test(k) && v > 1e9 ? new Date(v < 1e12 ? v * 1000 : v).toISOString() : String(v).slice(0, 40)}`).join(" "));
    if (table === "auth_credential_blocks" && rows.length) find("WARN", `${rows.length} credential block(s) recorded — blocked credentials are skipped by the router`);
  }
  db.close();
} catch (e: any) { find("WARN", `agent.db unreadable: ${e.message}`); }

// ── 6. tau log digest + process list ─────────────────────────────────────
hdr("6. newest tau log digest (last 4000 lines, grouped)");
const ld = `${HOME}/.tau/logs`;
if (existsSync(ld)) {
  const newest = readdirSync(ld).filter(f => f.endsWith(".log")).map(f => ({ f, t: statSync(`${ld}/${f}`).mtimeMs })).sort((a, b) => b.t - a.t)[0];
  if (newest) {
    const lines = readFileSync(`${ld}/${newest.f}`, "utf8").split("\n").slice(-4000), g = new Map<string, number>();
    for (const l of lines) { try { const j = JSON.parse(l); if (j.level === "debug" || j.level === "info") continue; const k = `${j.level} ${String(j.message).replace(/\s+/g, " ").slice(0, 90)} ${j.provider ?? ""}`; g.set(k, (g.get(k) ?? 0) + 1); } catch {} }
    say(`  ${newest.f}`); [...g].sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, n]) => say(`   ${String(n).padStart(5)}×  ${k}`));
    const spam = [...g].filter(([k, n]) => n > 100); if (spam.length) find("WARN", `log spam: ${spam.map(([k, n]) => `${n}× ${k.slice(0, 50)}`).join("; ")}`);
  }
}
const ps = await sh(["bash", "-c", "ps -eo pid,etimes,rss,args | grep -E '[t]au( |$)|tau_worker|tau-worker' | cut -c1-110"], HOME, 8000); say("\n  tau processes (pid, age s, rss KB):\n" + ps.text.replace(/^/gm, "    "));

// ── verdict ──────────────────────────────────────────────────────────────
hdr("VERDICT");
for (const s of ["BAD", "WARN"] as const) for (const f of findings.filter(x => x.sev === s)) say(`  ${s}  ${f.msg}`);
say(`  ${findings.filter(f => f.sev === "OK").length} checks OK, ${findings.filter(f => f.sev === "WARN").length} warnings, ${findings.filter(f => f.sev === "BAD").length} failures`);
writeFileSync("tau-doctor-report.txt", out.join("\n"));
