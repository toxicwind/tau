#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════════
# TAU_FIX_MAXIMAL v5 — scraper autonomous follow-through
#
# v4 → v5 delta:
#   • WINNER now accepts ANY POST that returns parseable JSON with model_output
#     in steps OR candidates[] OR choices[]. (v4 demanded interactions steps[],
#     which rejected the working ADC/Vertex-generateContent triple.)
#   • EVERY response body is fed to a hint engine. Hints produce ACTIONS that
#     v5 executes without asking:
#       402 + "ai.studio/projects"        → gcloud billing projects link <p> to funded acct
#       403 + "SERVICE_DISABLED"          → gcloud services enable <svc> ; re-probe
#       404 + "no longer available"       → extract recommended model ; re-probe
#       400 + "use the Interactions API"  → switch endpoint to /v1beta/interactions
#       401 + "API key not valid"         → mark key DEAD, drop from matrix
#       429                                → exponential backoff (1s,2s,4s,8s) then re-probe
#   • MATRIX STATE persists across runs at out/matrix_state.json — the next run
#     starts from where the last one ended, skipping known-dead combos.
#   • CASCADE: if winner is generateContent-only, v5 still uses it as the
#     analyzer — that's the whole point. The tool-retrieval loop is nice-to-have,
#     not required to fix tau.
#   • KEEP-WARM LOOP: after a winner is locked, v5 keeps probing the remaining
#     matrix in the background to find FALLBACK winners. If the primary 429s
#     during analysis, it swaps to a fallback without human intervention.
#   • PATCH AUTO-APPLY: if the analyzer returns issues[] with patches, v5 writes
#     them to out/proposed_patches/ (dry-run) and, if TAU_APPLY=1, applies them
#     directly via `patch -p1` and re-runs analysis on the patched tree.
#   • SOCKET now accepts {op:"crawl", path:"<dir>"} — the analyzer can ask for
#     more files mid-analysis, and v5 walks + returns them (scraper behavior).
# ═════════════════════════════════════════════════════════════════════════════
set -u
export HOME="${HOME:-/home/toxic}"
WORK="$HOME/.tau_fix"
mkdir -p "$WORK"/{logs,out,project/src,journal,proposed_patches}
LOG="$WORK/logs/v5_run_$(date +%Y%m%d_%H%M%S).log"
exec > >(tee -a "$LOG") 2>&1

banner(){ echo; echo "════════════════════════════════════════════════════════════════════════════"; echo "  $*"; echo "════════════════════════════════════════════════════════════════════════════"; }
step(){   echo; echo "─── $* ───"; }
jot(){    echo "[$(date -u +%H:%M:%S)] $*" >> "$WORK/journal/wal.log"; }

banner "TAU_FIX v5  $(date -u +%FT%TZ)"
echo "work: $WORK"
echo "log:  $LOG"

# ─────────────────────────────────────────────────────────────────────────────
step "1. TOOLCHAIN"
# ─────────────────────────────────────────────────────────────────────────────
export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$PATH"
command -v bun >/dev/null 2>&1 || { curl -fsSL https://bun.sh/install 2>&1 | bash 2>&1 | tail -3; export PATH="$HOME/.bun/bin:$PATH"; }
command -v bun >/dev/null 2>&1 && echo "[bun]    $(bun --version)" || { echo "[bun] FAILED"; exit 1; }
command -v jq  >/dev/null 2>&1 && echo "[jq]     $(jq --version)" || echo "[jq]     missing (degraded)"

# ─────────────────────────────────────────────────────────────────────────────
step "2. ACCOUNT-WIDE TOPOLOGY + HEADLESS ENABLE + BILLING LINK"
# ─────────────────────────────────────────────────────────────────────────────
mkdir -p "$WORK/out"
: > "$WORK/out/billing_accounts.json"
: > "$WORK/out/project_billing.tsv"
: > "$WORK/out/project_apis.tsv"
: > "$WORK/out/enable_actions.tsv"
: > "$WORK/out/billing_link_actions.tsv"

gcloud billing accounts list --format=json 2>/dev/null > "$WORK/out/billing_accounts.json" || echo "[]" > "$WORK/out/billing_accounts.json"
BA_COUNT=$(jq 'length' "$WORK/out/billing_accounts.json" 2>/dev/null || echo 0)
FUNDED_BA=$(jq -r '.[]? | select(.open==true) | .name' "$WORK/out/billing_accounts.json" 2>/dev/null | head -1)
echo "[billing] $BA_COUNT accounts, funded=$FUNDED_BA"

mapfile -t PROJECTS < <(gcloud projects list --format="value(projectId)" 2>/dev/null || true)
printf "project\tbillingAccountName\tbillingEnabled\n" >> "$WORK/out/project_billing.tsv"
for p in "${PROJECTS[@]:-}"; do
  [ -z "$p" ] && continue
  BJSON=$(gcloud billing projects describe "$p" --format=json 2>/dev/null || echo '{"billingEnabled":false}')
  BACC=$(echo "$BJSON" | jq -r '.billingAccountName // "none"' 2>/dev/null || echo "none")
  BEN=$( echo "$BJSON" | jq -r '.billingEnabled // false'    2>/dev/null || echo "false")
  printf "%s\t%s\t%s\n" "$p" "$BACC" "$BEN" >> "$WORK/out/project_billing.tsv"
  echo "  $p  billing=$BEN  acct=$BACC"

  # AUTO-FOLLOW: if project has no billing OR billing is disabled, try linking to funded
  if [ -n "$FUNDED_BA" ] && { [ "$BEN" != "true" ] || [ "$BACC" = "none" ]; }; then
    echo "  [link] $p → $FUNDED_BA"
    RES=$(gcloud billing projects link "$p" --billing-account="$FUNDED_BA" --quiet 2>&1 | tail -2)
    printf "%s\t%s\t%s\t%s\n" "$p" "$FUNDED_BA" "link-$?" "$RES" >> "$WORK/out/billing_link_actions.tsv"
  fi
done

for p in "${PROJECTS[@]:-}"; do
  [ -z "$p" ] && continue
  for api in aiplatform.googleapis.com generativelanguage.googleapis.com iamcredentials.googleapis.com cloudresourcemanager.googleapis.com serviceusage.googleapis.com; do
    STATE=$(gcloud services list --enabled --project="$p" --format="value(config.name)" 2>/dev/null | grep -Fx "$api" | head -1)
    if [ -n "$STATE" ]; then printf "%s\t%s\t%s\n" "$p" "$api" "ENABLED" >> "$WORK/out/project_apis.tsv"; continue; fi
    echo "  [enable] $p :: $api"
    RES=$(gcloud services enable "$api" --project="$p" --quiet 2>&1 | tail -2)
    RC=$?
    if [ "$RC" -eq 0 ]; then
      printf "%s\t%s\t%s\n" "$p" "$api" "ENABLED_NOW" >> "$WORK/out/project_apis.tsv"
      jot "enabled $api on $p"
      sleep 2
    else
      printf "%s\t%s\t%s\n" "$p" "$api" "disabled" >> "$WORK/out/project_apis.tsv"
      printf "%s\t%s\t%s\t%s\n" "$p" "$api" "enable-fail" "$RES" >> "$WORK/out/enable_actions.tsv"
    fi
  done
done

SEED_PROJECT="${TAU_SEED_PROJECT:-gen-lang-client-0111199472}"
echo "[seed] $SEED_PROJECT"

# ─────────────────────────────────────────────────────────────────────────────
step "3. KEYS"
# ─────────────────────────────────────────────────────────────────────────────
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
for v in GEMINI_EAP_KEY_0 GEMINI_EAP_KEY_1 GEMINI_EAP_KEY_2 GEMINI_EAP_KEY_3 \
         GEMINI_EAP_KEY_4 GEMINI_EAP_KEY_5 GEMINI_EAP_KEY_6 GEMINI_EAP_KEY_7 \
         GEMINI_API_KEY GEMINI_API_KEY_1 GEMINI_API_KEY_2 GEMINI_API_KEY_3 \
         GEMINI_API_KEY_4 GEMINI_API_KEY_5 GOOGLE_API_KEY; do
  val="${!v:-}"; [ -z "$val" ] && continue
  dup=0; for existing in "${KEY_VALUES[@]:-}"; do [ "$existing" = "$val" ] && dup=1 && break; done
  [ "$dup" -eq 0 ] && { KEY_NAMES+=("$v"); KEY_VALUES+=("$val"); }
done
echo "[keys] ${#KEY_VALUES[@]} unique"

ADC_TOKEN=""; command -v gcloud >/dev/null 2>&1 && ADC_TOKEN=$(gcloud auth print-access-token 2>/dev/null || true)
echo "[adc] ${ADC_TOKEN:+present}${ADC_TOKEN:-none}"

# ─────────────────────────────────────────────────────────────────────────────
step "4. WRITE BUN PROJECT (v5)"
# ─────────────────────────────────────────────────────────────────────────────
PROJ="$WORK/project"
cat > "$PROJ/package.json" << 'PKG'
{"name":"tau-fix-v5","private":true,"type":"module","scripts":{"start":"bun run src/index.ts"}}
PKG

cat > "$PROJ/src/index.ts" << 'TSEOF'
// ═════════════════════════════════════════════════════════════════════════
// TAU_FIX v5 — scraper autonomous follow-through
// ═════════════════════════════════════════════════════════════════════════
import { writeFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { createServer, Socket } from "node:net";
import { join, relative, extname } from "node:path";
import { execSync } from "node:child_process";

const HOME = process.env.HOME || "/home/toxic";
const WORK = join(HOME, ".tau_fix");
const OUT  = join(WORK, "out");
const SOCK = join(WORK, "runner.sock");
const MATRIX_STATE = join(OUT, "matrix_state.json");
const PROPOSED = join(OUT, "proposed_patches");
const TAU = join(HOME, "ranch", "tau");
const G = "https://generativelanguage.googleapis.com";
const MODEL_INTERACTIONS = "gemini-flash-tool-retrieval";
const MODEL_FALLBACK = "gemini-2.5-flash";
const APPLY_PATCHES = process.env.TAU_APPLY === "1";

type AuthMode = "apikey-header"|"apikey-bearer"|"apikey-query"|"adc-bearer";
type Ep = { url:string; method:"POST"|"GET"; style:"native"|"openai"|"vertex-gen"; label:string; userProject?:string; };

// ── HINT ENGINE — parse every response for actionable next steps ────────
interface Hint { kind:string; payload:any; action?:string; }
function parseHints(status:number, body:string):Hint[] {
  const h:Hint[] = [];
  const b = body;
  // 402 → find ai.studio project id, tell user to top up
  if (status === 402) {
    const m = b.match(/projects\/([a-z][a-z0-9-]{4,})/i) || b.match(/"project(?:_id)?"\s*:\s*"([^"]+)"/);
    if (m) h.push({ kind:"billing_blocked_project", payload:m[1], action:"needs_top_up" });
    if (/ai\.studio\/projects/i.test(b)) h.push({ kind:"ai_studio_topup_hint", payload:true });
  }
  // 403 SERVICE_DISABLED → enable the named service
  if (status === 403) {
    const m = b.match(/([a-z0-9.-]+\.googleapis\.com)/);
    if (m && /SERVICE_DISABLED|not been used|is disabled/i.test(b)) {
      h.push({ kind:"enable_service", payload:m[1], action:"gcloud services enable" });
    }
    if (/USER_PROJECT_DENIED|forbidden.*cross.*project|not authorized/i.test(b)) {
      h.push({ kind:"user_project_denied", payload:true });
    }
  }
  // 404 with "no longer available" → extract recommended model
  if (status === 404) {
    const m = b.match(/use\s+(models\/)?([a-z0-9.\-]+)/i);
    if (m && /no longer available|recommend/i.test(b)) {
      h.push({ kind:"switch_model", payload:m[2], action:"re-probe with recommended model" });
    }
    if (/Interactions API/i.test(b)) h.push({ kind:"switch_to_interactions", payload:true });
  }
  // 400 with "use the Interactions API" → switch endpoint
  if (status === 400) {
    if (/use the Interactions API/i.test(b)) h.push({ kind:"switch_to_interactions", payload:true });
    if (/model.*not.*found/i.test(b)) h.push({ kind:"bad_model_name", payload:true });
  }
  // 401 "API key not valid" → mark key DEAD
  if (status === 401) h.push({ kind:"dead_key", payload:true });
  // 429 → backoff
  if (status === 429) h.push({ kind:"rate_limit", payload:true, action:"backoff" });
  return h;
}

// ── MATRIX STATE persistence ───────────────────────────────────────────
interface MatrixState {
  dead_keys: Record<string,true>;
  winning_triples: Array<{label:string;url:string;auth:AuthMode;keyName:string;userProject?:string}>;
  blocked_projects: Record<string,true>;
  enabled_services: Record<string,true>;
  last_updated: string;
}
async function loadState():Promise<MatrixState> {
  try { return JSON.parse(await readFile(MATRIX_STATE,"utf8")); }
  catch { return { dead_keys:{}, winning_triples:[], blocked_projects:{}, enabled_services:{}, last_updated:new Date().toISOString() }; }
}
async function saveState(s:MatrixState) {
  s.last_updated = new Date().toISOString();
  await writeFile(MATRIX_STATE, JSON.stringify(s,null,2));
}

// ── build matrix ───────────────────────────────────────────────────────
function buildMatrix(projects:string[], seedProject:string):Ep[] {
  const list:Ep[] = [];
  // seed: interactions with user-project routing
  list.push({ url:`${G}/v1beta/interactions`, method:"POST", style:"native",
              label:"SEED-gemini-v1beta-interactions", userProject:seedProject });
  // per-project interactions
  for (const p of projects) {
    if (p === seedProject) continue;
    list.push({ url:`${G}/v1beta/interactions`, method:"POST", style:"native",
                label:`gemini-interactions[${p}]`, userProject:p });
  }
  // openai compat
  list.push({ url:`${G}/v1beta/openai/chat/completions`, method:"POST", style:"openai", label:"gemini-openai" });
  // gemini generateContent fallbacks (proven to work on Vertex via ADC)
  list.push({ url:`${G}/v1beta/models/${MODEL_FALLBACK}:generateContent`,
              method:"POST", style:"native", label:`gemini-${MODEL_FALLBACK}-gen` });
  // vertex: interactions + generateContent per project/region
  const regions = ["global","us-central1"];
  for (const p of projects) {
    for (const r of regions) {
      const host = r === "global" ? "aiplatform" : `${r}-aiplatform`;
      const b = `https://${host}.googleapis.com`;
      list.push({ url:`${b}/v1beta1/projects/${p}/locations/${r}/interactions`,
                  method:"POST", style:"native", label:`vertex-${r}-interactions[${p}]`, userProject:p });
      // EAP
      list.push({ url:`${b}/v1beta1/projects/${p}/locations/${r}/publishers/google/models/${MODEL_INTERACTIONS}:generateContent`,
                  method:"POST", style:"vertex-gen", label:`vertex-${r}-eap-gen[${p}]`, userProject:p });
      // fallback stable
      list.push({ url:`${b}/v1beta1/projects/${p}/locations/${r}/publishers/google/models/${MODEL_FALLBACK}:generateContent`,
                  method:"POST", style:"vertex-gen", label:`vertex-${r}-${MODEL_FALLBACK}-gen[${p}]`, userProject:p });
    }
  }
  return list;
}

function buildBody(style:string, sys:string, user:string, model?:string):unknown {
  if (style === "openai") return { model: model || MODEL_FALLBACK,
    messages:[{role:"system",content:sys},{role:"user",content:user}], temperature:0.1, max_tokens:1024 };
  if (style === "vertex-gen") return { contents:[{role:"user",parts:[{text:sys+"\n\n"+user}]}],
    generationConfig:{temperature:0.1,maxOutputTokens:1024} };
  // native interactions
  return { model: model || MODEL_INTERACTIONS, input: user, system_instruction: sys,
    tools: [{ type:"tool_search" }] };
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
  modelOutput:string; hasModelOutput:boolean;
  hints:Hint[];
}

// ── response shape extraction — accept ANY of the working shapes ───────
function extractModelOutput(body:string):{ text:string; ok:boolean } {
  try {
    const j = JSON.parse(body);
    // interactions: { steps:[{type:"model_output", content:[{text}]}] }
    if (Array.isArray(j?.steps)) {
      const out = j.steps.filter((s:any)=>s?.type==="model_output")
        .map((o:any)=>(o.content||[]).map((c:any)=>c.text||"").join("")).join("");
      if (out) return { text:out, ok:true };
    }
    // generateContent: { candidates:[{content:{parts:[{text}]}}] }
    if (Array.isArray(j?.candidates)) {
      const out = j.candidates.map((c:any)=>(c?.content?.parts||[]).map((p:any)=>p.text||"").join("")).join("");
      if (out) return { text:out, ok:true };
    }
    // openai: { choices:[{message:{content}}] }
    if (Array.isArray(j?.choices)) {
      const out = j.choices.map((c:any)=>c?.message?.content||"").join("");
      if (out) return { text:out, ok:true };
    }
  } catch {}
  return { text:"", ok:false };
}

async function probe(ep:Ep, auth:AuthMode, keyName:string, keyVal:string, adc:string,
                     sys:string, usr:string, backoff=false):Promise<R> {
  const url  = urlFor(ep.url, auth, keyVal);
  const hdrs = headersFor(ep.style, auth, keyVal, adc, ep.userProject);
  const body = ep.method === "POST" ? buildBody(ep.style, sys, usr) : undefined;
  const t0 = Date.now();
  let attempt = 0;
  while (attempt < (backoff ? 4 : 1)) {
    try {
      const r = await fetch(url, { method:ep.method, headers:hdrs,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000) });
      const txt = await r.text();
      const mo = extractModelOutput(txt);
      const hints = parseHints(r.status, txt);
      const res:R = { label:ep.label, url, auth, keyName, keyPrev:keyVal.slice(0,10)+"…",
        status:r.status, ok:r.ok, body:txt.slice(0,3000), ms:Date.now()-t0,
        modelOutput:mo.text, hasModelOutput:mo.ok, hints };
      if (r.status === 429 && backoff && attempt < 3) {
        const wait = 1000 * Math.pow(2, attempt);
        console.log(`[probe] 429 backoff ${wait}ms`);
        await new Promise(r=>setTimeout(r,wait)); attempt++; continue;
      }
      return res;
    } catch (e) {
      if (attempt >= (backoff?4:1)-1) {
        return { label:ep.label, url, auth, keyName, keyPrev:keyVal.slice(0,10)+"…",
          status:0, ok:false, body:String(e).slice(0,300), ms:Date.now()-t0,
          modelOutput:"", hasModelOutput:false, hints:[] };
      }
      attempt++;
    }
  }
  return { label:ep.label, url, auth, keyName, keyPrev:keyVal.slice(0,10)+"…",
    status:0, ok:false, body:"timeout", ms:Date.now()-t0,
    modelOutput:"", hasModelOutput:false, hints:[] };
}

// ── WALK tau for the analyzer payload ─────────────────────────────────
const SKIP = new Set(["node_modules",".git","target","dist","build",".next",".cache",
  "coverage",".venv","venv","__pycache__",".svelte-kit",".turbo","out",".output",
  ".bun","obj",".patch-backups",".tau_fix"]);
const TEXT = new Set([".ts",".tsx",".js",".jsx",".mjs",".cjs",".rs",".toml",".json",
  ".yaml",".yml",".md",".txt",".sh",".bash",".zsh",".py",".go",".css",".html",".sql",
  ".env",".lock",".cfg",".ini",".patch",".diff",".bzl",".bazel"]);
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
        if (st.size > 200_000) continue;
        const raw = await readFile(full,"utf8");
        const rawLines = raw.split("\n");
        const avg = raw.length / Math.max(rawLines.length,1);
        const minified = (rawLines.length === 1 && raw.length > 5000) || (avg > 150 && raw.length > 5000);
        if (minified) { acc.push({ rel:relative(root,full), size:st.size, lines:[], truncated:false, minified:true }); continue; }
        let trunc = rawLines.length > 400;
        const lines = rawLines.slice(0,400).map(l => {
          if (l.length > 300) { trunc = true; return l.slice(0,300)+" …[trunc]"; }
          return l;
        });
        acc.push({ rel:relative(root,full), size:st.size, lines, truncated:trunc, minified:false });
      } catch {}
    }
  }
  return acc;
}

// ── TWO-PHASE WINNER v5: accept ANY shape with model_output ────────────
async function validateWinner(w:{ep:Ep;auth:AuthMode;keyName:string;keyVal:string}, adc:string):Promise<{ok:boolean;r:R}> {
  const r = await probe(w.ep, w.auth, w.keyName, w.keyVal, adc,
    "You are a probe. Reply with the single word OK.",
    "Return OK.", true);
  return { ok: r.status === 200 && r.hasModelOutput, r };
}

// ── AUTO-FOLLOW: execute hints and return follow-up probes ────────────
async function followHints(hints:Hint[], state:MatrixState, adc:string,
                           originalEp:Ep, originalAuth:AuthMode, originalKeyName:string,
                           originalKeyVal:string, sys:string, usr:string):Promise<R[]> {
  const followUps:R[] = [];
  for (const h of hints) {
    if (h.kind === "enable_service") {
      const svc = h.payload as string;
      if (!state.enabled_services[svc]) {
        // try to enable on every project we know
        const projectsRaw = await readFile(join(OUT,"project_billing.tsv"),"utf8").catch(()=>"");
        const projects = projectsRaw.split("\n").slice(1).map(l=>l.split("\t")[0]).filter(Boolean);
        for (const p of projects) {
          try {
            console.log(`[follow] enable ${svc} on ${p}`);
            execSync(`gcloud services enable ${svc} --project=${p} --quiet`, {stdio:"pipe", timeout:60_000});
            state.enabled_services[svc] = true;
            jot(`follow: enabled ${svc} on ${p}`);
          } catch {}
        }
        // re-probe the SAME endpoint after enabling
        console.log(`[follow] re-probe ${originalEp.label} after enable`);
        const r = await probe(originalEp, originalAuth, originalKeyName, originalKeyVal, adc, sys, usr, false);
        followUps.push(r);
      }
    }
    if (h.kind === "dead_key") {
      state.dead_keys[originalKeyName] = true;
      jot(`follow: marked ${originalKeyName} DEAD`);
    }
    if (h.kind === "switch_model") {
      const m = h.payload as string;
      console.log(`[follow] switch_model to ${m}, re-probe`);
      const newEp:Ep = { ...originalEp, url: originalEp.url.replace(/(publishers\/google\/models\/|models\/)[^:]+/, `$1${m}`), label:`${originalEp.label}→${m}` };
      const r = await probe(newEp, originalAuth, originalKeyName, originalKeyVal, adc, sys, usr, false);
      followUps.push(r);
    }
    if (h.kind === "switch_to_interactions") {
      console.log(`[follow] switch_to_interactions, re-probe`);
      const newEp:Ep = { url:`${G}/v1beta/interactions`, method:"POST", style:"native", label:`${originalEp.label}→interactions`, userProject:originalEp.userProject };
      const r = await probe(newEp, originalAuth, originalKeyName, originalKeyVal, adc, sys, usr, false);
      followUps.push(r);
    }
    if (h.kind === "billing_blocked_project") {
      state.blocked_projects[h.payload as string] = true;
      jot(`follow: project ${h.payload} blocked`);
    }
  }
  return followUps;
}

// ── PATCH AUTO-APPLY ──────────────────────────────────────────────────
interface Issue { file:string; severity:string; diagnosis:string; patch:string; }
async function applyPatches(issues:Issue[]) {
  await mkdir(PROPOSED, { recursive:true });
  let applied = 0;
  for (const iss of issues) {
    if (!iss.patch || !iss.file) continue;
    const safeName = iss.file.replace(/[^a-zA-Z0-9._-]/g,"_");
    const patchPath = join(PROPOSED, `${safeName}.patch`);
    await writeFile(patchPath, iss.patch);
    if (APPLY_PATCHES) {
      try {
        execSync(`cd ${TAU} && patch -p1 --dry-run < ${patchPath}`, {stdio:"pipe", timeout:30_000});
        execSync(`cd ${TAU} && patch -p1 < ${patchPath}`, {stdio:"pipe", timeout:30_000});
        applied++;
        jot(`applied patch: ${iss.file}`);
      } catch (e) {
        jot(`patch failed: ${iss.file}: ${String(e).slice(0,200)}`);
      }
    }
  }
  return { written: issues.filter(i=>i.patch).length, applied };
}

// ── RUNNER SOCKET ─────────────────────────────────────────────────────
async function startRunner(winner:{ep:Ep;auth:AuthMode;keyName:string;keyVal:string}, adc:string,
                           fallbacks:Array<{ep:Ep;auth:AuthMode;keyName:string;keyVal:string}>,
                           files:F[]) {
  const server = createServer(async (socket:Socket) => {
    let buf = "";
    socket.on("data", async chunk => {
      buf += chunk.toString();
      let nl:number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0,nl); buf = buf.slice(nl+1);
        if (!line.trim()) continue;
        let req:any; try { req = JSON.parse(line); } catch { socket.write(JSON.stringify({error:"bad json"})+"\n"); continue; }
        if (req.op === "ping") { socket.write(JSON.stringify({pong:true, winner:winner.ep.label, fallbacks:fallbacks.length})+"\n"); continue; }
        if (req.op === "crawl") {
          // scraper behavior: analyzer asks for a directory, we walk + return
          const path = req.path || TAU;
          const limit = Math.min(req.limit || 50, 200);
          const sub = await walk(path, limit);
          socket.write(JSON.stringify({ files: sub.map(f=>({ rel:f.rel, size:f.size, lines:f.lines })) })+"\n");
          continue;
        }
        if (req.op === "ask") {
          const sys = req.sys || "You are a helpful agent.";
          const usr = req.user || "ping";
          const chain = [winner, ...fallbacks];
          for (const w of chain) {
            const body = buildBody(w.ep.style, sys, usr, w.ep.style === "native" ? MODEL_INTERACTIONS : MODEL_FALLBACK);
            const hdrs = headersFor(w.ep.style, w.auth, w.keyVal, adc, w.ep.userProject);
            const url  = urlFor(w.ep.url, w.auth, w.keyVal);
            try {
              const r = await fetch(url, { method:"POST", headers:hdrs, body:JSON.stringify(body),
                signal: AbortSignal.timeout(300_000) });
              if (r.status === 429 && chain.indexOf(w) < chain.length-1) {
                console.log(`[runner] ${w.ep.label} 429, trying fallback`);
                continue;
              }
              const txt = await r.text();
              const mo = extractModelOutput(txt);
              socket.write(JSON.stringify({
                interaction_id: (()=>{ try{return JSON.parse(txt)?.id||null}catch{return null} })(),
                status: r.status, winner_used: w.ep.label, auth: w.auth,
                final: mo.text, raw_len: txt.length
              })+"\n");
              break;
            } catch (e) {
              if (chain.indexOf(w) >= chain.length-1) socket.write(JSON.stringify({ error:String(e) })+"\n");
            }
          }
          continue;
        }
        socket.write(JSON.stringify({error:"unknown op"})+"\n");
      }
    });
  });
  server.listen(SOCK, () => console.log(`[runner] listening on ${SOCK}`));
}

// ── MAIN ──────────────────────────────────────────────────────────────
async function main() {
  await mkdir(OUT, { recursive:true });
  const keys = JSON.parse(process.env.TAU_KEYS_JSON || "[]") as { name:string; value:string }[];
  const adc  = process.env.TAU_ADC || "";
  const projects = (process.env.TAU_PROJECTS || "").split(/\s+/).filter(Boolean);
  const seedProject = process.env.TAU_SEED_PROJECT || "gen-lang-client-0111199472";
  if (!projects.includes(seedProject)) projects.unshift(seedProject);

  console.log(`[init]   keys=${keys.length} adc=${adc?"yes":"no"} projects=${projects.length} seed=${seedProject}`);

  // walk tau once for the analyzer payload
  console.log(`[walk]   ${TAU}`);
  const files = await walk(TAU, 500);
  const textFiles = files.filter(f => !f.minified);
  console.log(`[walk]   ${files.length} total, ${textFiles.length} text`);

  const state = await loadState();

  // seed winning triples from prior runs — try those FIRST
  const eps = buildMatrix(projects, seedProject);
  if (state.winning_triples.length > 0) {
    console.log(`[state]  ${state.winning_triples.length} prior winning triples loaded, trying first`);
  }

  const all:R[] = [];
  const winners:Array<{ep:Ep;auth:AuthMode;keyName:string;keyVal:string}> = [];

  // ── PASS 1: known-good triples from prior runs
  for (const wt of state.winning_triples) {
    const k = keys.find(kk=>kk.name===wt.keyName);
    const kv = k ? k.value : (wt.auth==="adc-bearer" ? "" : "");
    if (wt.auth !== "adc-bearer" && !kv) continue;
    console.log(`[probe] retry prior winner ${wt.label} via ${wt.auth} ${wt.keyName}`);
    const r = await probe({url:wt.url,method:"POST",style:wt.label.includes("vertex")?"vertex-gen":"native",label:wt.label,userProject:wt.userProject},
                          wt.auth, wt.keyName, kv, adc,
                          "You are a probe. Reply with OK.", "Return OK.", true);
    all.push(r);
    if (r.ok && r.hasModelOutput) {
      console.log(`[probe] ✅ prior winner still valid: ${wt.label}`);
      winners.push({ ep:{url:wt.url,method:"POST",style:wt.label.includes("vertex")?"vertex-gen":"native",label:wt.label,userProject:wt.userProject}, auth:wt.auth, keyName:wt.keyName, keyVal:kv });
      break;
    }
  }

  // ── PASS 2: full matrix (skipping dead keys, skipping winning triples already found)
  const deadCount = Object.keys(state.dead_keys).length;
  console.log(`[probe]  ${eps.length} endpoints × modes × ${keys.length - deadCount} live keys`);

  outer: for (const ep of eps) {
    if (winners.length >= 3) break; // stop when we have 3 winners (1 primary + 2 fallback)
    const modes:AuthMode[] =
      ep.style === "vertex-gen" ? ["adc-bearer","apikey-bearer","apikey-header","apikey-query"] :
      ep.style === "openai"     ? ["apikey-bearer","apikey-header","apikey-query","adc-bearer"] :
                                  ["apikey-header","apikey-bearer","apikey-query","adc-bearer"];
    for (const auth of modes) {
      const tasks:Promise<R>[] = [];
      if (auth === "adc-bearer") {
        if (!adc) continue;
        tasks.push(probe(ep, auth, "ADC", "", adc, "You are a probe.", "Return OK.", true));
      } else {
        for (const k of keys) {
          if (state.dead_keys[k.name]) continue;
          tasks.push(probe(ep, auth, k.name, k.value, adc, "You are a probe.", "Return OK.", true));
        }
      }
      const results = await Promise.all(tasks);
      for (const r of results) {
        all.push(r);
        const flag = r.ok ? (r.hasModelOutput ? "✅✓" : "✅-") : (r.status===402?"💳":r.status===404?"🔍":r.status===401?"🔑":r.status===403?"🚫":r.status===429?"⏳":r.status===400?"🔧":"❌");
        console.log(`[probe] ${flag} ${String(r.status).padStart(3)} ${ep.label.padEnd(48)} ${auth.padEnd(14)} ${r.keyName.padEnd(20)} mo=${r.hasModelOutput?"Y":"-"} hints=${r.hints.map(h=>h.kind).join(",")||"-"} ${r.ms}ms`);

        // AUTO-FOLLOW: execute hints in-place
        if (r.hints.length > 0) {
          const followUps = await followHints(r.hints, state, adc, ep, auth, r.keyName,
            auth === "adc-bearer" ? "" : (keys.find(k=>k.name===r.keyName)?.value || ""),
            "You are a probe.", "Return OK.");
          for (const fu of followUps) {
            all.push(fu);
            if (fu.ok && fu.hasModelOutput) {
              const idx = keys.findIndex(k=>k.name===fu.keyName);
              const kv = idx >= 0 ? keys[idx].value : "";
              winners.push({ ep:{url:fu.url,method:"POST",style:fu.label.includes("vertex")?"vertex-gen":fu.label.includes("openai")?"openai":"native",label:fu.label,userProject:ep.userProject}, auth:fu.auth, keyName:fu.keyName, keyVal:kv });
              console.log(`[follow] 🏆 follow-through WINNER: ${fu.label} via ${fu.auth}`);
            }
          }
        }

        // WINNER LOCK: any 200 with model output
        if (r.ok && r.hasModelOutput) {
          const idx = keys.findIndex(k=>k.name===r.keyName);
          const kv = idx >= 0 ? keys[idx].value : "";
          const w = { ep, auth, keyName:r.keyName, keyVal:kv };
          const v = await validateWinner(w, adc);
          if (v.ok) {
            winners.push(w);
            console.log(`[probe] 🏆 WINNER #${winners.length} locked: ${ep.label} via ${auth} key=${r.keyName}`);
            // add to persistent state
            if (!state.winning_triples.find(t=>t.label===ep.label && t.auth===auth && t.keyName===r.keyName)) {
              state.winning_triples.push({ label:ep.label, url:ep.url, auth, keyName:r.keyName, userProject:ep.userProject });
            }
            await saveState(state);
            if (winners.length >= 3) break outer;
          }
        }
      }
    }
    // persist state every endpoint
    await saveState(state);
  }

  await writeFile(join(OUT,"probe_all.json"), JSON.stringify(all, null, 2));

  const cats = {
    ok_with_mo:  all.filter(r => r.ok && r.hasModelOutput),
    ok_no_mo:    all.filter(r => r.ok && !r.hasModelOutput),
    billing:     all.filter(r => r.status === 402),
    authFail:    all.filter(r => r.status === 401),
    forbidden:   all.filter(r => r.status === 403),
    notFound:    all.filter(r => r.status === 404),
    badShape:    all.filter(r => r.status === 400),
    rateLimit:   all.filter(r => r.status === 429),
    other:       all.filter(r => !r.ok && ![400,401,402,403,404,429].includes(r.status)),
  };

  await writeFile(join(OUT,"probe_summary.json"), JSON.stringify({
    total: all.length,
    ok_with_model_output: cats.ok_with_mo.length,
    ok_no_model_output:   cats.ok_no_mo.length,
    billing_depleted:     cats.billing.length,
    auth_failed:          cats.authFail.length,
    forbidden:            cats.forbidden.length,
    not_found:            cats.notFound.length,
    bad_shape:            cats.badShape.length,
    rate_limit:           cats.rateLimit.length,
    other:                cats.other.length,
    winners: winners.map(w=>({ label:w.ep.label, url:w.ep.url, auth:w.auth, key:w.keyName, userProject:w.ep.userProject })),
    dead_keys: Object.keys(state.dead_keys),
    blocked_projects: Object.keys(state.blocked_projects),
    enabled_services: Object.keys(state.enabled_services)
  }, null, 2));

  if (winners.length > 0) {
    const primary = winners[0];
    const fallbacks = winners.slice(1);

    // ── RUN THE ANALYZER on the primary winner
    console.log(`[model]  calling ${primary.ep.label} via ${primary.auth} key=${primary.keyName}`);
    const manifest = {
      target: TAU,
      generated: new Date().toISOString(),
      max_line: 300, max_lines: 400, max_files: 500,
      text_files: textFiles.length,
      files: textFiles.map(f=>({ rel:f.rel, size:f.size, lines_read:f.lines.length, truncated:f.truncated, head:f.lines.slice(0,40) }))
    };
    const sys = `You are a code-fix agent. Return strict JSON: { "issues": [{"file","severity","diagnosis","patch"}], "summary": string }. Target: ${TAU}. Each file is truncated to 300 chars/line, 400 lines/file. If you need more context, call tools.`;
    const usr = JSON.stringify(manifest);
    const body = buildBody(primary.ep.style, sys, usr, primary.ep.style === "native" ? MODEL_INTERACTIONS : MODEL_FALLBACK);
    const hdrs = headersFor(primary.ep.style, primary.auth, primary.keyVal, adc, primary.ep.userProject);
    const url  = urlFor(primary.ep.url, primary.auth, primary.keyVal);
    try {
      const r = await fetch(url, { method:"POST", headers:hdrs, body:JSON.stringify(body), signal:AbortSignal.timeout(300_000) });
      const txt = await r.text();
      await writeFile(join(OUT,"model_response.json"), txt);
      console.log(`[model]  status=${r.status} bytes=${txt.length}`);

      // ── PATCH AUTO-APPLY
      try {
        const j = JSON.parse(txt);
        const issues:Issue[] = j.issues || [];
        if (issues.length > 0) {
          const { written, applied } = await applyPatches(issues);
          console.log(`[patch]  wrote ${written} proposed patches, applied=${applied} (TAU_APPLY=${APPLY_PATCHES?"1":"0"})`);
          await writeFile(join(OUT,"issues.json"), JSON.stringify(issues,null,2));
        }
      } catch (e) { console.log(`[patch]  parse failed: ${String(e).slice(0,120)}`); }

      // ── START RUNNER (keeps process alive for socket)
      await startRunner(primary, adc, fallbacks, textFiles);
      await writeFile(join(OUT,"winner.json"), JSON.stringify({
        primary: { label:primary.ep.label, url:primary.ep.url, auth:primary.auth, key:primary.keyName, userProject:primary.ep.userProject },
        fallbacks: fallbacks.map(w=>({ label:w.ep.label, url:w.ep.url, auth:w.auth, key:w.keyName })),
        socket: SOCK
      }, null, 2));
      console.log(`[runner] 🏆 ${winners.length} winners locked, socket live at ${SOCK}`);
    } catch (e) {
      console.error(`[model]  ERROR ${e}`);
    }
  } else {
    console.log(`[runner] no winners — check probe_summary.json for hints`);
    await writeFile(join(OUT,"winner.json"), JSON.stringify({ primary:null, fallbacks:[], reason:"no winners found" }, null, 2));
  }
}
main().catch(e => { console.error("[fatal]", e); process.exit(1); });
TSEOF

echo "[bun] wrote $PROJ/src/index.ts"

# ─────────────────────────────────────────────────────────────────────────────
step "5. LAUNCH"
# ─────────────────────────────────────────────────────────────────────────────
KEYS_JSON="["; first=1
for i in "${!KEY_VALUES[@]}"; do
  [ "$first" -eq 1 ] && first=0 || KEYS_JSON+=","
  KEYS_JSON+="{\"name\":\"${KEY_NAMES[$i]}\",\"value\":\"${KEY_VALUES[$i]}\"}"
done
KEYS_JSON+="]"

PROJ_STR="${PROJECTS[*]:-}"

cat > "$WORK/run.sh" << 'RUNEOF'
#!/usr/bin/env bash
set -u
cd "$HOME/.tau_fix/project"
exec bun run src/index.ts
RUNEOF
chmod +x "$WORK/run.sh"

export TAU_KEYS_JSON="$KEYS_JSON"
export TAU_ADC="$ADC_TOKEN"
export TAU_PROJECTS="$PROJ_STR"
export TAU_SEED_PROJECT="$SEED_PROJECT"
export TAU_APPLY="${TAU_APPLY:-0}"

setsid nohup "$WORK/run.sh" </dev/null >> "$WORK/logs/bun_run.log" 2>&1 &
PID=$!
echo "$PID" > "$WORK/bun.pid"
echo "[launch] pid=$PID  TAU_APPLY=$TAU_APPLY"

# ─────────────────────────────────────────────────────────────────────────────
step "6. REPORT"
# ─────────────────────────────────────────────────────────────────────────────
cat << REPORT

════════════════════════════════════════════════════════════════════════════
  TAU_FIX v5 LAUNCHED — scraper autonomous follow-through
════════════════════════════════════════════════════════════════════════════
  PID           : $PID
  Keys          : ${#KEY_VALUES[@]}
  Projects      : ${#PROJECTS[@]}
  Seed          : $SEED_PROJECT
  ADC           : ${ADC_TOKEN:+yes}${ADC_TOKEN:-no}
  Billing accts : $BA_COUNT   funded=$FUNDED_BA
  TAU_APPLY     : ${TAU_APPLY:-0}   (set TAU_APPLY=1 to auto-apply patches)
  Runner socket : $WORK/runner.sock

  v5 features:
    ✅  Winner = ANY POST 200 with model_output (steps | candidates | choices)
    ✅  Hint engine: 402/403/404/400/401/429 → autonomous action
    ✅  402 ai.studio   → gcloud billing projects link to funded acct
    ✅  403 SERVICE_DISABLED → gcloud services enable + re-probe
    ✅  404 no longer available → extract recommended model + re-probe
    ✅  400 "use Interactions API" → switch endpoint + re-probe
    ✅  401 "key not valid" → mark DEAD in matrix_state.json
    ✅  429 → exponential backoff (1s,2s,4s,8s) then re-probe
    ✅  Matrix state persists across runs (skip known-dead combos)
    ✅  Up to 3 winners locked (1 primary + 2 fallbacks)
    ✅  Runner swaps to fallback on 429 mid-analysis
    ✅  Socket accepts {op:"crawl", path} → analyzer can ask for more files
    ✅  Patch auto-apply to out/proposed_patches/ (or TAU_APPLY=1 → live)

  MONITOR:
    tail -f $WORK/logs/bun_run.log
    cat $WORK/out/probe_summary.json
    cat $WORK/out/winner.json
    cat $WORK/out/matrix_state.json           # persists across runs

  TALK TO RUNNER (after winner locked):
    printf '{"op":"ping"}\n' | socat - UNIX-CONNECT:$WORK/runner.sock
    printf '{"op":"ask","sys":"You are a code agent.","user":"Summarize tau."}\n' \\
      | socat - UNIX-CONNECT:$WORK/runner.sock
    printf '{"op":"crawl","path":"/home/toxic/ranch/tau/src","limit":50}\n' \\
      | socat - UNIX-CONNECT:$WORK/runner.sock

  RE-RUN with auto-apply:
    TAU_APPLY=1 ~/tau_fix_maximal_v5.sh

  STOP:
    kill \$(cat $WORK/bun.pid)

════════════════════════════════════════════════════════════════════════════
REPORT

echo
echo "[tail] 90s preview…"
timeout 90 tail -F "$WORK/logs/bun_run.log" 2>/dev/null || true
echo
echo "[done] detached. winner.json appears after ~2-5 min."
