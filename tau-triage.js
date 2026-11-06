// bun run ./tau-triage.ts   — read-only; writes models.yml.proposed + triage-report.json. Fingerprints only.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
const HOME = homedir(), sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fp = (v) => v ? `${v.slice(0, 4)}…${v.slice(-2)}#${createHash("sha256").update(v).digest("hex").slice(0, 6)}` : "(none)";
async function http(method, url, key = "", body) {
    try {
        const r = await fetch(url, { method, headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
        return { status: r.status, text: await r.text() };
    }
    catch (e) {
        return { status: 0, text: String(e?.code ?? e?.message ?? e) };
    }
}
const readEnvFile = (f) => { const o = {}; if (existsSync(f))
    for (const l of readFileSync(f, "utf8").split("\n")) {
        const m = l.match(/^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*["']?([^"'\n#]*)/);
        if (m)
            o[m[1]] = m[2].trim();
    } return o; };
// 1. which candidate keys does each local gateway accept?
console.log("== 1. local gateway keys (which candidate works where)");
const envs = { ...readEnvFile(`${HOME}/estate/.env`), ...readEnvFile(`${HOME}/estate/config/tau/.env`) };
const cand = new Map(); // fingerprint -> "NAME(source)"
const add = (n, v, s = "env") => { if (v && v.length > 8)
    cand.set(v, `${n}(${s})`); };
for (const [k, v] of Object.entries(process.env))
    if (/(FLOCK|CUTTINGGATE|VANS|PROXY|GATEWAY).*(KEY|TOKEN)/i.test(k))
        add(k, v);
for (const [k, v] of Object.entries(envs))
    if (/(FLOCK|CUTTINGGATE|VANS|PROXY|GATEWAY).*(KEY|TOKEN)/i.test(k))
        add(k, v, "dotenv");
const gws = [["flock GET /v1/models", "http://127.0.0.1:25193/v1/models"], ["vans GET /v1/models", "http://127.0.0.1:20128/v1/models"], ["cuttinggate POST custom/dots", "http://127.0.0.1:25200/v1/chat/completions", { model: "custom/dots", messages: [{ role: "user", content: "hi" }], max_tokens: 8 }]];
for (const [label, url, body] of gws) {
    const nokey = await http(body ? "POST" : "GET", url, "", body);
    console.log(`  ${label}: no key → ${nokey.status}`);
    for (const [v, name] of cand) {
        const r = await http(body ? "POST" : "GET", url, v, body);
        console.log(`     ${fp(v)} ${name} → ${r.status} ${r.status !== 200 ? r.text.slice(0, 70).replace(/\s+/g, " ") : ""}`);
        await sleep(400);
    }
}
// 2. classify every provider in models.yml
console.log("\n== 2. provider triage");
const path = `${HOME}/.tau/agent/models.yml`, YAML = Bun.YAML, doc = YAML.parse(readFileSync(path, "utf8"));
const providers = doc.providers ?? doc;
const resolveKey = (v) => typeof v !== "string" ? "" : /^[A-Z][A-Z0-9_]{3,}$/.test(v) ? (process.env[v] ?? "") : /^[!$]/.test(v) ? "" : v;
const SKIP_MODEL = /(vision|embed|rerank|guard|aya|whisper|tts|image|moderation|safety)/i, PREFER = /(instruct|chat|gpt|llama|qwen|deepseek|kimi|flash|pro|mistral|glm)/i;
const tool = { type: "function", function: { name: "echo", description: "echo", parameters: { type: "object", properties: { x: { type: "integer" } }, required: ["x"] } } };
const report = [], drop = new Set();
for (const [name, p] of Object.entries(providers)) {
    if (!p?.baseUrl)
        continue;
    const base = String(p.baseUrl).replace(/\/$/, ""), key = resolveKey(p.apiKey);
    let v = "UNKNOWN", note = "";
    if (!key && /^[!$]/.test(String(p.apiKey ?? ""))) {
        v = "DYNAMIC-KEY";
        note = "key is a command/ref; not executed";
    }
    else {
        const lm = await http("GET", `${base}/models`, key);
        let ids = [];
        try {
            ids = (JSON.parse(lm.text).data ?? []).map((m) => m.id);
        }
        catch { }
        if (lm.status === 0) {
            v = "DEAD";
            note = lm.text;
        }
        else if (lm.status === 404) {
            v = "DEAD";
            note = "/models 404 (wrong baseUrl?)";
        }
        else if (lm.status === 401 || lm.status === 403) {
            v = "AUTH";
            note = lm.text.slice(0, 80);
        }
        else {
            const model = ids.find(i => PREFER.test(i) && !SKIP_MODEL.test(i)) ?? ids.find(i => !SKIP_MODEL.test(i)) ?? "";
            if (!model) {
                v = lm.status === 200 ? "OK" : "UNKNOWN";
                note = "no listable model to probe";
            }
            else {
                const r = await http("POST", `${base}/chat/completions`, key, { model, messages: [{ role: "user", content: "call echo with x=1" }], tools: [tool], tool_choice: "auto", max_tokens: 256 });
                const t = r.text.replace(/\s+/g, " ");
                v = r.status === 200 ? "OK" : /insufficient|suspended|balance|billing|payment|quota/i.test(t) || r.status === 402 ? "BILLING" : /free tier|only be used/i.test(t) ? "POLICY" : /TOOL_USE_NOT_SUPPORTED/.test(t) ? "NOTOOLS" : r.status === 404 ? "NOMODEL" : r.status === 429 ? "RATE" : r.status === 401 ? "AUTH" : "UNKNOWN";
                note = `${model}: ${r.status} ${r.status === 200 ? "" : t.slice(0, 90)}`;
                await sleep(1200);
            }
        }
    }
    if (["DEAD", "AUTH", "BILLING", "POLICY"].includes(v))
        drop.add(name);
    report.push({ provider: name, verdict: v, key: fp(key), note });
    console.log(`  ${v.padEnd(11)} ${name.padEnd(12)} ${fp(key).padEnd(18)} ${note}`);
}
writeFileSync("triage-report.json", JSON.stringify(report, null, 2));
const proposed = structuredClone(doc), tgt = proposed.providers ?? proposed;
for (const n of drop)
    delete tgt[n];
writeFileSync("models.yml.proposed", YAML.stringify(proposed, null, 2));
console.log(`\nwrote triage-report.json and models.yml.proposed (removes: ${[...drop].join(", ") || "nothing"}). Your real models.yml was NOT modified.`);
console.log(`review: diff -u ${path} models.yml.proposed   (YAML rewrite drops comments; apply by hand if you prefer)`);
