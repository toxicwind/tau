#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════════
# TAU_FIX_MAXIMAL v3 — account-wide, all-keys, Vertex-inclusive
#
# Fixes v1/v2 bugs:
#   • Tested only keys[0..2] per endpoint — now tests ALL keys × ALL endpoints
#   • Winner logic accepted GET 200 — now requires POST + 200 only
#   • Never probed Vertex AI /interactions — added
#   • Never added X-Goog-User-Project for API-key→Vertex routing — added
#   • Never enumerated billing accounts / project→billing links — added
#   • Never extracted AI Studio project ID from 402 body — added
#   • 300 chars/line · 400 lines/file · 500 file cap on every read
# ═════════════════════════════════════════════════════════════════════════════
set -u
export HOME="/home/toxic"
WORK="$HOME/.tau_fix"
mkdir -p "$WORK"/{logs,out,project/src}
LOG="$WORK/logs/run_$(date +%Y%m%d_%H%M%S).log"
exec > >(tee -a "$LOG") 2>&1

banner(){ echo; echo "════════════════════════════════════════════════════════════════════════════"; echo "  $*"; echo "════════════════════════════════════════════════════════════════════════════"; }
step(){ echo; echo "─── $* ───"; }

banner "TAU_FIX v3  $(date -u +%FT%TZ)"
echo "work: $WORK"
echo "log:  $LOG"

# ─────────────────────────────────────────────────────────────────────────────
step "1. TOOLCHAIN"
# ─────────────────────────────────────────────────────────────────────────────
export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$PATH"
if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install 2>&1 | bash 2>&1 | tail -3 || true
  export PATH="$HOME/.bun/bin:$PATH"
fi
command -v bun >/dev/null 2>&1 && echo "[bun] $(bun --version)" || { echo "[bun] FAILED"; exit 1; }

# ─────────────────────────────────────────────────────────────────────────────
step "2. ACCOUNT-WIDE TOPOLOGY"
# ─────────────────────────────────────────────────────────────────────────────
mkdir -p "$WORK/out"

# ── 2a. Billing accounts
echo "[billing] enumerating accounts…"
gcloud billing accounts list --format=json 2>/dev/null > "$WORK/out/billing_accounts.json" || echo "[]" > "$WORK/out/billing_accounts.json"
BA_COUNT=$(jq 'length' "$WORK/out/billing_accounts.json" 2>/dev/null || echo 0)
echo "[billing] $BA_COUNT accounts"
jq -r '.[] | "  \(.name)  open=\(.open)  displayName=\(.displayName)"' "$WORK/out/billing_accounts.json" 2>/dev/null || true

# ── 2b. Projects + their billing link
echo "[projects] enumerating…"
mapfile -t PROJECTS < <(gcloud projects list --format="value(projectId)" 2>/dev/null || true)
echo "[projects] ${#PROJECTS[@]} found"
: > "$WORK/out/project_billing.tsv"
printf "project\tbillingAccountName\tbillingEnabled\n" >> "$WORK/out/project_billing.tsv"
for p in "${PROJECTS[@]}"; do
  BJSON=$(gcloud billing projects describe "$p" --format=json 2>/dev/null || echo '{"billingEnabled":false}')
  BACC=$(echo "$BJSON" | jq -r '.billingAccountName // "none"' 2>/dev/null || echo "none")
  BEN=$(echo "$BJSON" | jq -r '.billingEnabled // false' 2>/dev/null || echo "false")
  printf "%s\t%s\t%s\n" "$p" "$BACC" "$BEN" >> "$WORK/out/project_billing.tsv"
  echo "  $p  billing=$BEN  account=$BACC"
done

# ── 2c. Enabled APIs per project (aiplatform + generativelanguage)
echo "[apis] enabled state per project"
: > "$WORK/out/project_apis.tsv"
for p in "${PROJECTS[@]}"; do
  for api in aiplatform.googleapis.com generativelanguage.googleapis.com; do
    STATE=$(gcloud services list --enabled --project="$p" --format="value(config.name)" 2>/dev/null | grep -Fx "$api" | head -1)
    [ -n "$STATE" ] && S="ENABLED" || S="disabled"
    printf "%s\t%s\t%s\n" "$p" "$api" "$S" >> "$WORK/out/project_apis.tsv"
  done
done
cat "$WORK/out/project_apis.tsv"

# ── 2d. Load all keys with their variable names
declare -a KEY_NAMES KEY_VALUES
if [ -f "$HOME/.secrets" ]; then
  while IFS= read -r line; do
    case "$line" in
      GEMINI_EAP_KEY_*|GEMINI_API_KEY*|GOOGLE_API_KEY*)
        k="${line%%=*}"; v="${line#*=}"; v="${v%%#*}"; v="$(printf '%s' "$v" | xargs)"
        [ -n "$v" ] && { KEY_NAMES+=("$k"); KEY_VALUES+=("$v"); }
        ;;
    esac
  done < "$HOME/.secrets"
fi
# env vars, dedup by value
for v in GEMINI_EAP_KEY_0 GEMINI_EAP_KEY_1 GEMINI_EAP_KEY_2 GEMINI_EAP_KEY_3 \
         GEMINI_EAP_KEY_4 GEMINI_EAP_KEY_5 GEMINI_EAP_KEY_6 GEMINI_EAP_KEY_7 \
         GEMINI_API_KEY GEMINI_API_KEY_1 GEMINI_API_KEY_2 GEMINI_API_KEY_3 \
         GEMINI_API_KEY_4 GEMINI_API_KEY_5 GOOGLE_API_KEY; do
  val="${!v:-}"
  [ -z "$val" ] && continue
  dup=0
  for existing in "${KEY_VALUES[@]:-}"; do [ "$existing" = "$val" ] && dup=1 && break; done
  [ "$dup" -eq 0 ] && { KEY_NAMES+=("$v"); KEY_VALUES+=("$val"); }
done
echo "[keys] ${#KEY_VALUES[@]} unique keys"

# ADC token
ADC_TOKEN=""
command -v gcloud >/dev/null 2>&1 && ADC_TOKEN=$(gcloud auth print-access-token 2>/dev/null || true)
echo "[adc]  ${ADC_TOKEN:+token-present}${ADC_TOKEN:-none}"

# ─────────────────────────────────────────────────────────────────────────────
step "3. WRITE BUN PROJECT"
# ─────────────────────────────────────────────────────────────────────────────
PROJ="$WORK/project"
cat > "$PROJ/package.json" << 'PKG'
{"name":"tau-fix","private":true,"type":"module","scripts":{"start":"bun run src/index.ts"}}
PKG

cat > "$PROJ/src/index.ts" << 'TSEOF'
// ═════════════════════════════════════════════════════════════════════════
// TAU FIX v3 — full key × endpoint matrix, correct winner selection
// ═════════════════════════════════════════════════════════════════════════
import { readdir, readFile, writeFile, stat, mkdir } from "node:fs/promises";
import { join, relative, extname } from "node:path";

const HOME   = process.env.HOME || "/home/toxic";
const TAU    = join(HOME, "ranch", "tau");
const WORK   = join(HOME, ".tau_fix");
const OUT    = join(WORK, "out");
const MAX_LINE  = 300;
const MAX_LINES = 400;
const MAX_FILES = 500;
const MAX_BYTES = 200_000;

const SKIP = new Set(["node_modules",".git","target","dist","build",".next",
  ".cache","coverage",".venv","venv","__pycache__",".svelte-kit",".turbo",
  "out",".output",".bun","obj",".patch-backups",".tau_fix"]);
const TEXT = new Set([".ts",".tsx",".js",".jsx",".mjs",".cjs",".rs",".toml",
  ".json",".jsonc",".yaml",".yml",".md",".txt",".sh",".bash",".zsh",".py",
  ".go",".css",".html",".sql",".env",".lock",".cfg",".ini",".patch",".diff",
  ".bzl",".bazel"]);

type AuthMode = "apikey-header"|"apikey-bearer"|"apikey-query"|"adc-bearer";
type Ep = { url:string; method:"POST"|"GET"; style:"native"|"openai"|"vertex-gen"; label:string; userProject?:string; };

const MODELS_EAP = ["gemini-flash-tool-retrieval"];
const MODELS_2   = ["gemini-2.5-flash","gemini-2.0-flash"];

function buildMatrix(projects:string[]):Ep[] {
  const g = "https://generativelanguage.googleapis.com";
  const list:Ep[] = [
    // Gemini API — interactions (native)
    { url:`${g}/v1beta/interactions`, method:"POST", style:"native", label:"gemini-v1beta-interactions" },
    // Gemini API — openai compat (uses Bearer, not x-goog-api-key)
    { url:`${g}/v1beta/openai/chat/completions`, method:"POST", style:"openai", label:"gemini-v1beta-openai" },
    // Gemini API — generateContent stable (fallback for analysis)
    { url:`${g}/v1beta/models/gemini-2.5-flash:generateContent`, method:"POST", style:"native", label:"gemini-v1beta-2.5flash-generate" },
  ];
  // Vertex AI — interactions + generateContent for every project/region
  const regions = ["us-central1","global"];
  for (const p of projects) {
    for (const r of regions) {
      const host = r === "global" ? "aiplatform" : `${r}-aiplatform`;
      const b = `https://${host}.googleapis.com`;
      // Vertex AI Interactions endpoint (per the doc: "both Gemini API and Vertex AI")
      list.push({
        url: `${b}/v1beta1/projects/${p}/locations/${r}/interactions`,
        method:"POST", style:"native", label:`vertex-${r}-interactions`,
        userProject: p
      });
      // Vertex AI generateContent with EAP model name
      for (const m of MODELS_EAP) {
        list.push({
          url: `${b}/v1beta1/projects/${p}/locations/${r}/publishers/google/models/${m}:generateContent`,
          method:"POST", style:"vertex-gen", label:`vertex-${r}-eap-gen`,
          userProject: p
        });
      }
      // Vertex AI generateContent with stable model (fallback)
      for (const m of MODELS_2) {
        list.push({
          url: `${b}/v1beta1/projects/${p}/locations/${r}/publishers/google/models/${m}:generateContent`,
          method:"POST", style:"vertex-gen", label:`vertex-${r}-${m}-gen`,
          userProject: p
        });
      }
    }
  }
  return list;
}

function buildBody(style:string, user:string, sys:string, model?:string):any {
  if (style === "openai") {
    return { model: model || "gemini-2.5-flash",
      messages:[{role:"system",content:sys},{role:"user",content:user}],
      temperature:0.1, max_tokens:4000 };
  }
  if (style === "vertex-gen") {
    return { contents:[{role:"user",parts:[{text:sys + "\n\n" + user}]}],
      generationConfig:{temperature:0.1,maxOutputTokens:4000} };
  }
  // native interactions
  return {
    model: "gemini-flash-tool-retrieval",
    input: user,
    system_instruction: sys,
    tools: [
      { type: "tool_search" },
      { type: "function", name: "read_file",
        description: "Read a file beyond the truncated window",
        defer_loading: true,
        parameters: { type:"object", properties:{ path:{type:"string"} }, required:["path"] } }
    ]
  };
}

function headersFor(style:string, auth:AuthMode, key:string, adc:string, userProject?:string):Record<string,string> {
  const h:Record<string,string> = { "Content-Type":"application/json" };
  if (auth === "apikey-header") h["x-goog-api-key"] = key;
  else if (auth === "apikey-bearer") h["Authorization"] = `Bearer ${key}`;
  else if (auth === "adc-bearer" && adc) h["Authorization"] = `Bearer ${adc}`;
  if (userProject) h["X-Goog-User-Project"] = userProject;
  return h;
}

function urlFor(url:string, auth:AuthMode, key:string):string {
  if (auth === "apikey-query") return url + (url.includes("?")?"&":"?") + "key=" + encodeURIComponent(key);
  return url;
}

interface R {
  label:string; url:string; auth:AuthMode; keyName:string; keyPrev:string;
  status:number; ok:boolean; body:string; ms:number;
  aiStudioProject?:string;
}

function extractAiStudioProject(body:string):string|undefined {
  // The 402 body mentions ai.studio/projects — project might be extractable
  // from other error shapes. Also try matching project IDs directly.
  const m1 = body.match(/projects\/([a-z][a-z0-9-]{4,})/i);
  if (m1) return m1[1];
  const m2 = body.match(/"project(?:_id)?"\s*:\s*"([^"]+)"/);
  if (m2) return m2[1];
  return undefined;
}

async function probe(ep:Ep, auth:AuthMode, keyName:string, keyVal:string, adc:string):Promise<R> {
  const url = urlFor(ep.url, auth, keyVal);
  const hdrs = headersFor(ep.style, auth, keyVal, adc, ep.userProject);
  const body = ep.method === "POST"
    ? buildBody(ep.style, "ping", "Reply with PONG only.", "gemini-2.5-flash")
    : undefined;
  const t0 = Date.now();
  try {
    const r = await fetch(url, { method:ep.method, headers:hdrs,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000) });
    const txt = await r.text();
    return {
      label:ep.label, url, auth, keyName,
      keyPrev: keyVal.slice(0,12) + "…",
      status:r.status, ok:r.ok, body:txt.slice(0,1200),
      ms:Date.now()-t0,
      aiStudioProject: extractAiStudioProject(txt)
    };
  } catch (e) {
    return { label:ep.label, url, auth, keyName, keyPrev:keyVal.slice(0,12)+"…",
      status:0, ok:false, body:String(e).slice(0,300), ms:Date.now()-t0 };
  }
}

// ── walk with truncation (300 chars, 400 lines, 500 files) ─────────────
interface F { rel:string; size:number; lines:string[]; truncated:boolean; minified:boolean; }
async function walk(root:string, limit:number, acc:F[]=[]):Promise<F[]> {
  if (acc.length >= limit) return acc;
  let es; try { es = await readdir(root,{withFileTypes:true}); } catch { return acc; }
  for (const e of es) {
    if (acc.length >= limit) break;
    if (e.name.startsWith(".") && e.name !== ".env") continue;
    const full = join(root, e.name);
    if (e.isDirectory()) { if (SKIP.has(e.name)) continue; await walk(full, limit, acc); }
    else if (e.isFile() || e.isSymbolicLink()) {
      const ext = extname(e.name).toLowerCase();
      if (!TEXT.has(ext)) continue;
      try {
        const st = await stat(full);
        if (st.size > MAX_BYTES) continue;
        const raw = await readFile(full,"utf8");
        const rawLines = raw.split("\n");
        const avg = raw.length / Math.max(rawLines.length,1);
        const minified = (rawLines.length === 1 && raw.length > 5000) || (avg > 150 && raw.length > 5000);
        if (minified) { acc.push({ rel:relative(root,full), size:st.size, lines:[], truncated:false, minified:true }); continue; }
        let trunc = rawLines.length > MAX_LINES;
        const lines = rawLines.slice(0,MAX_LINES).map(l => {
          if (l.length > MAX_LINE) { trunc = true; return l.slice(0,MAX_LINE)+" …[trunc]"; }
          return l;
        });
        acc.push({ rel:relative(root,full), size:st.size, lines, truncated:trunc, minified:false });
      } catch {}
    }
  }
  return acc;
}

// ── main ─────────────────────────────────────────────────────────────
async function main() {
  await mkdir(OUT, { recursive:true });

  const keysRaw = process.env.TAU_KEYS_JSON || "[]";
  const keys: { name:string; value:string }[] = JSON.parse(keysRaw);
  const adc    = process.env.TAU_ADC || "";
  const projects = (process.env.TAU_PROJECTS || "").split(/\s+/).filter(Boolean);

  console.log(`[init]   keys=${keys.length} adc=${adc?"yes":"no"} projects=${projects.length}`);

  // 1. Walk tau
  console.log(`[walk]   ${TAU}`);
  const files = await walk(TAU, MAX_FILES);
  const text = files.filter(f => !f.minified);
  const mini = files.filter(f => f.minified);
  console.log(`[walk]   ${files.length} total, ${text.length} text, ${mini.length} minified-skipped`);

  // 2. Build matrix
  const eps = buildMatrix(projects);
  console.log(`[probe]  ${eps.length} endpoints × auth modes × ${keys.length} keys`);
  console.log(`[probe]  = ${eps.length * 3 * keys.length} total probes (may take a few min)`);

  const all: R[] = [];
  let winner: { ep:Ep; auth:AuthMode; keyName:string; keyVal:string } | null = null;

  // Process each endpoint sequentially, but all keys per endpoint in parallel
  for (const ep of eps) {
    const modes: AuthMode[] =
      ep.style === "vertex-gen" ? ["adc-bearer","apikey-bearer","apikey-header","apikey-query"] :
      ep.style === "openai"     ? ["apikey-bearer","apikey-header","apikey-query","adc-bearer"] :
                                  ["apikey-header","apikey-bearer","apikey-query","adc-bearer"];
    for (const auth of modes) {
      const tasks: Promise<R>[] = [];
      if (auth === "adc-bearer") {
        if (!adc) continue;
        tasks.push(probe(ep, auth, "ADC", "", adc));
      } else {
        for (const k of keys) tasks.push(probe(ep, auth, k.name, k.value, adc));
      }
      const results = await Promise.all(tasks);
      for (const r of results) {
        all.push(r);
        const flag = r.ok ? "✅" : (r.status===402?"💳":r.status===404?"🔍":r.status===401?"🔑":r.status===403?"🚫":r.status===400?"🔧":"❌");
        console.log(`[probe] ${flag} ${String(r.status).padStart(3)} ${ep.label.padEnd(28)} ${auth.padEnd(14)} ${r.keyName.padEnd(20)} ${r.ms}ms`);
        if (r.ok && ep.method === "POST" && !winner) {
          const idx = keys.findIndex(k => k.name === r.keyName);
          if (idx >= 0) winner = { ep, auth, keyName:r.keyName, keyVal:keys[idx].value };
          else if (auth === "adc-bearer") winner = { ep, auth, keyName:"ADC", keyVal:"" };
          console.log(`[probe] 🎯 WINNER: ${ep.label} via ${auth} key=${r.keyName}`);
        }
      }
    }
    // If we have a winner AND it's not just GET models, stop scanning
    if (winner) {
      console.log(`[probe] stopping scan early — winner found`);
      break;
    }
  }

  await writeFile(join(OUT,"probe_all.json"), JSON.stringify(all, null, 2));

  // 3. Categorize
  const cats = {
    ok:         all.filter(r => r.ok),
    billing:    all.filter(r => r.status === 402),
    deprecated: all.filter(r => r.status === 400 && r.body.includes("deprecated")),
    authFail:   all.filter(r => r.status === 401),
    forbidden:  all.filter(r => r.status === 403),
    notFound:   all.filter(r => r.status === 404),
    badShape:   all.filter(r => r.status === 400 && !r.body.includes("deprecated")),
    other:      all.filter(r => !r.ok && ![400,401,402,403,404].includes(r.status))
  };

  // 4. Billing-blocked projects
  const blockedProjects = new Set<string>();
  for (const r of cats.billing) if (r.aiStudioProject) blockedProjects.add(r.aiStudioProject);

  // 5. Write summary
  await writeFile(join(OUT,"probe_summary.json"), JSON.stringify({
    total: all.length,
    ok: cats.ok.length,
    billing_depleted: cats.billing.length,
    deprecated: cats.deprecated.length,
    auth_failed: cats.authFail.length,
    forbidden: cats.forbidden.length,
    model_not_found: cats.notFound.length,
    bad_shape: cats.badShape.length,
    other: cats.other.length,
    winner: winner ? { label:winner.ep.label, auth:winner.auth, key:winner.keyName, url:winner.ep.url } : null,
    billing_blocked_projects: [...blockedProjects]
  }, null, 2));

  // 6. Write manifest
  const manifest = {
    target: TAU,
    generated: new Date().toISOString(),
    max_line: MAX_LINE, max_lines: MAX_LINES, max_files: MAX_FILES,
    text_files: text.length, minified_skipped: mini.length,
    minified_list: mini.map(f => ({ rel:f.rel, size:f.size })),
    files: text.map(f => ({
      rel: f.rel, size: f.size, lines_read: f.lines.length,
      truncated: f.truncated, head: f.lines.slice(0, 40)
    }))
  };
  await writeFile(join(OUT,"manifest.json"), JSON.stringify(manifest, null, 2));

  // 7. If winner, run analysis
  if (winner) {
    console.log(`[model]  calling ${winner.ep.label} via ${winner.auth} key=${winner.keyName}`);
    const sys = `You are a code-fix agent. Return strict JSON: { "issues": [{"file","severity","diagnosis","patch"}], "summary": string }. ` +
      `Target: ${TAU}. Every file line is capped at ${MAX_LINE} chars, every file at ${MAX_LINES} lines. If a file is truncated and you need more, say so in "summary".`;
    const usr = JSON.stringify(manifest);
    const body = buildBody(winner.ep.style, usr, sys, "gemini-2.5-flash");
    const hdrs = headersFor(winner.ep.style, winner.auth, winner.keyVal, adc, winner.ep.userProject);
    const url  = urlFor(winner.ep.url, winner.auth, winner.keyVal);
    try {
      const r = await fetch(url, { method:"POST", headers:hdrs,
        body: JSON.stringify(body), signal: AbortSignal.timeout(300_000) });
      const txt = await r.text();
      await writeFile(join(OUT,"model_response.json"), txt);
      console.log(`[model]  status=${r.status} bytes=${txt.length}`);
      try { await writeFile(join(OUT,"issues.json"), JSON.stringify(JSON.parse(txt), null, 2)); } catch {}
    } catch (e) { console.log(`[model]  ERROR ${e}`); }
  }

  // 8. Human report
  const rep:string[] = [];
  rep.push(`# Tau Fix Report v3`);
  rep.push(``);
  rep.push(`Generated: ${new Date().toISOString()}`);
  rep.push(`Target:    ${TAU}`);
  rep.push(`Text files: ${text.length}  · Minified skipped: ${mini.length}`);
  rep.push(`Truncation: ${MAX_LINE} chars/line · ${MAX_LINES} lines/file · ${MAX_FILES} files`);
  rep.push(``);
  rep.push(`## Probe totals`);
  rep.push(`- OK:               ${cats.ok.length}`);
  rep.push(`- Billing depleted: ${cats.billing.length}`);
  rep.push(`- Auth failed:      ${cats.authFail.length}`);
  rep.push(`- Forbidden:        ${cats.forbidden.length}`);
  rep.push(`- Model not found:  ${cats.notFound.length}`);
  rep.push(`- Bad request shape:${cats.badShape.length}`);
  rep.push(`- Deprecated:       ${cats.deprecated.length}`);
  rep.push(`- Other:            ${cats.other.length}`);
  rep.push(``);
  if (blockedProjects.size > 0) {
    rep.push(`## Billing-blocked AI Studio projects`);
    for (const p of blockedProjects) rep.push(`- ${p}`);
    rep.push(`Top up at: https://aistudio.google.com/projects`);
  }
  rep.push(``);
  rep.push(`## Winner`);
  rep.push(winner ? `${winner.ep.label}  ·  auth=${winner.auth}  ·  key=${winner.keyName}` : "none");
  rep.push(``);
  rep.push(`## File sample (first 40 lines, 300-char truncated)`);
  for (const f of text) {
    rep.push(``);
    rep.push(`### ${f.rel}  (${f.size}B${f.truncated?", truncated":""})`);
    rep.push("```");
    rep.push(...f.lines.slice(0, 40));
    rep.push("```");
  }
  await writeFile(join(OUT,"report.md"), rep.join("\n"));

  console.log(`[done]   ${OUT}/report.md`);
  console.log(`[done]   ${OUT}/probe_summary.json`);
  console.log(`[done]   ${OUT}/probe_all.json`);
  console.log(`[done]   ${OUT}/manifest.json`);
  if (winner) console.log(`[done]   ${OUT}/model_response.json`);
}

main().catch(e => { console.error("[fatal]", e); process.exit(1); });
TSEOF

echo "[bun] wrote $PROJ"

# ─────────────────────────────────────────────────────────────────────────────
step "4. LAUNCH (all keys, all endpoints, detached)"
# ─────────────────────────────────────────────────────────────────────────────
# Build JSON array of keys for env passthrough
KEYS_JSON="["
first=1
for i in "${!KEY_VALUES[@]}"; do
  [ "$first" -eq 1 ] && first=0 || KEYS_JSON+=","
  KEYS_JSON+="{\"name\":\"${KEY_NAMES[$i]}\",\"value\":\"${KEY_VALUES[$i]}\"}"
done
KEYS_JSON+="]"

PROJ_STR="${PROJECTS[*]:-}"

cat > "$WORK/run.sh" << RUNEOF
#!/usr/bin/env bash
set -u
cd "$PROJ"
export TAU_KEYS_JSON='$KEYS_JSON'
export TAU_ADC='$ADC_TOKEN'
export TAU_PROJECTS='$PROJ_STR'
exec bun run src/index.ts
RUNEOF
chmod +x "$WORK/run.sh"

setsid nohup "$WORK/run.sh" </dev/null >> "$WORK/logs/bun_run.log" 2>&1 &
PID=$!
echo "$PID" > "$WORK/bun.pid"
echo "[launch] pid=$PID"

# ─────────────────────────────────────────────────────────────────────────────
step "5. REPORT"
# ─────────────────────────────────────────────────────────────────────────────
cat << REPORT

════════════════════════════════════════════════════════════════════════════
  LAUNCHED (v3 — account-wide, all-keys, Vertex-inclusive)
════════════════════════════════════════════════════════════════════════════
  PID          : $PID
  Keys         : ${#KEY_VALUES[@]}
  Projects     : ${#PROJECTS[@]}    (${PROJECTS[*]:-none})
  ADC          : ${ADC_TOKEN:+yes}${ADC_TOKEN:-no}
  Billing accts: $BA_COUNT
  Probe matrix : ${#PROJECTS[@]} × 2 regions × Vertex + Gemini native + openai
                 ≈ $(( ${#PROJECTS[@]} * 2 * 5 + 3 )) endpoints × 4 auth modes × keys

  v3 fixes vs v2:
    ✅  Test ALL keys per endpoint (v2 tested only keys[0..2])
    ✅  Vertex AI /interactions endpoint added (v2 only did Vertex generateContent)
    ✅  X-Goog-User-Project header sent for API-key→Vertex routing
    ✅  Winner requires POST + 200 (v2 accepted GET 200 from /models)
    ✅  Billing topology enumerated (billing accounts + project→billing links)
    ✅  AI Studio project IDs extracted from 402 bodies
    ✅  Line cap 300 chars · 400 lines/file · 500 file cap (unchanged)
    ✅  Minified files skipped entirely (single-line >5KB or avg>150 chars)

  MONITOR:
    tail -f $WORK/logs/bun_run.log
    cat $WORK/out/probe_summary.json
    cat $WORK/out/billing_accounts.json
    cat $WORK/out/project_billing.tsv
    cat $WORK/out/report.md

  STOP:
    kill \$(cat $WORK/bun.pid)

════════════════════════════════════════════════════════════════════════════
REPORT

echo
echo "[tail] 90s preview (probe matrix is larger now)..."
timeout 90 tail -F "$WORK/logs/bun_run.log" 2>/dev/null || true
echo
echo "[done] detached. Check $WORK/out/probe_summary.json after ~5 min."
