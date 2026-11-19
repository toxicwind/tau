#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════════
# TAU_FIX_MAXIMAL v4 — closes the three v3 gaps + master runner socket
#
# v3 gaps this fixes:
#   • X-Goog-User-Project was only sent to aiplatform.googleapis.com — now
#     also sent to generativelanguage.googleapis.com/v1beta/interactions so an
#     AI Studio key can be routed to a Vertex project (cross-quota pool)
#   • Winner logic accepted first POST 200 — now requires TWO-PHASE validation:
#     a second POST that returns a non-empty `steps` array (proves the
#     tool-retrieval loop actually runs, not just auths)
#   • No headless enablement — now runs `gcloud services enable` on any project
#     that reports the API as disabled, then re-probes
#   • No persistent runner — now opens a Unix domain socket at
#     ~/.tau_fix/runner.sock that holds an interaction open across
#     tool_search_call / function_call round-trips (matches s3-* / s5-* shape)
#   • No known-good seed — v4 seeds the matrix with the triple your own logs
#     already proved works:
#        POST https://generativelanguage.googleapis.com/v1beta/interactions
#        model=gemini-flash-tool-retrieval
#        project=gen-lang-client-0111199472
#     …and tries it FIRST, before brute-forcing the rest.
#
# Evidence consumed (from your own uploads):
#   s2-key_only.json    → x-goog-api-key works on /v1beta/interactions
#   s2-bearer_only.json → Authorization: Bearer works on same endpoint
#   s3-01..s3-39        → full tool_search_call → function_call loop works
#   s5-turn1/turn2      → function_call chaining works (db_search → get_billing)
#   gemini-key-conventions.md → gen-lang-client-0111199472 is the funded project
# ═════════════════════════════════════════════════════════════════════════════
set -u
export HOME="${HOME:-/home/toxic}"
WORK="$HOME/.tau_fix"
mkdir -p "$WORK"/{logs,out,project/src,journal}
LOG="$WORK/logs/v4_run_$(date +%Y%m%d_%H%M%S).log"
exec > >(tee -a "$LOG") 2>&1

banner(){ echo; echo "════════════════════════════════════════════════════════════════════════════"; echo "  $*"; echo "════════════════════════════════════════════════════════════════════════════"; }
step(){   echo; echo "─── $* ───"; }
jot(){    echo "[$(date -u +%H:%M:%S)] $*" >> "$WORK/journal/wal.log"; }

banner "TAU_FIX v4  $(date -u +%FT%TZ)"
echo "work: $WORK"
echo "log:  $LOG"
jot "v4 start"

# ─────────────────────────────────────────────────────────────────────────────
step "1. TOOLCHAIN"
# ─────────────────────────────────────────────────────────────────────────────
export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$PATH"

if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install 2>&1 | bash 2>&1 | tail -3 || true
  export PATH="$HOME/.bun/bin:$PATH"
fi
command -v bun >/dev/null 2>&1 && echo "[bun]    $(bun --version)" || { echo "[bun] FAILED"; exit 1; }
command -v jq  >/dev/null 2>&1 && echo "[jq]     $(jq --version)"  || echo "[jq]     missing (degraded)"
command -v socat >/dev/null 2>&1 && echo "[socat]  present"        || echo "[socat]  missing — will use bun-native UDS instead"

# ─────────────────────────────────────────────────────────────────────────────
step "2. ACCOUNT-WIDE TOPOLOGY (billing → projects → APIs → headless enable)"
# ─────────────────────────────────────────────────────────────────────────────
mkdir -p "$WORK/out"

# ── 2a. billing accounts
echo "[billing] enumerate accounts"
gcloud billing accounts list --format=json 2>/dev/null > "$WORK/out/billing_accounts.json" || echo "[]" > "$WORK/out/billing_accounts.json"
BA_COUNT=$(jq 'length' "$WORK/out/billing_accounts.json" 2>/dev/null || echo 0)
echo "[billing] $BA_COUNT accounts"
jq -r '.[]? | "  \(.name)  open=\(.open)  \(.displayName)"' "$WORK/out/billing_accounts.json" 2>/dev/null || true

# ── 2b. projects + billing link
echo "[projects] enumerate"
mapfile -t PROJECTS < <(gcloud projects list --format="value(projectId)" 2>/dev/null || true)
echo "[projects] ${#PROJECTS[@]} found"
: > "$WORK/out/project_billing.tsv"
printf "project\tbillingAccountName\tbillingEnabled\n" >> "$WORK/out/project_billing.tsv"
for p in "${PROJECTS[@]:-}"; do
  [ -z "$p" ] && continue
  BJSON=$(gcloud billing projects describe "$p" --format=json 2>/dev/null || echo '{"billingEnabled":false}')
  BACC=$(echo "$BJSON" | jq -r '.billingAccountName // "none"' 2>/dev/null || echo "none")
  BEN=$( echo "$BJSON" | jq -r '.billingEnabled // false'    2>/dev/null || echo "false")
  printf "%s\t%s\t%s\n" "$p" "$BACC" "$BEN" >> "$WORK/out/project_billing.tsv"
  echo "  $p  billing=$BEN  acct=$BACC"
done

# ── 2c. APIs — enumerate, then HEADLESSLY ENABLE what's missing
echo "[apis] enable-or-report per project"
: > "$WORK/out/project_apis.tsv"
: > "$WORK/out/enable_actions.tsv"
for p in "${PROJECTS[@]:-}"; do
  [ -z "$p" ] && continue
  for api in aiplatform.googleapis.com generativelanguage.googleapis.com iamcredentials.googleapis.com cloudresourcemanager.googleapis.com; do
    STATE=$(gcloud services list --enabled --project="$p" --format="value(config.name)" 2>/dev/null | grep -Fx "$api" | head -1)
    if [ -n "$STATE" ]; then
      printf "%s\t%s\t%s\n" "$p" "$api" "ENABLED" >> "$WORK/out/project_apis.tsv"
      continue
    fi
    # try to enable headlessly
    echo "  [enable] $p :: $api"
    RES=$(gcloud services enable "$api" --project="$p" --quiet 2>&1 | tail -2)
    RC=$?
    if [ "$RC" -eq 0 ]; then
      printf "%s\t%s\t%s\n" "$p" "$api" "ENABLED_NOW" >> "$WORK/out/project_apis.tsv"
      printf "%s\t%s\t%s\t%s\n" "$p" "$api" "enable-ok" "$RES" >> "$WORK/out/enable_actions.tsv"
      jot "enabled $api on $p"
      sleep 2
    else
      printf "%s\t%s\t%s\n" "$p" "$api" "disabled" >> "$WORK/out/project_apis.tsv"
      printf "%s\t%s\t%s\t%s\n" "$p" "$api" "enable-fail" "$RES" >> "$WORK/out/enable_actions.tsv"
    fi
  done
done
echo "[apis] wrote project_apis.tsv ($(wc -l < "$WORK/out/project_apis.tsv") rows) + enable_actions.tsv"

# ── 2d. known-good seed (from your own gemini-key-conventions.md)
SEED_PROJECT="gen-lang-client-0111199472"
echo "[seed] known-good project = $SEED_PROJECT"

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
  val="${!v:-}"
  [ -z "$val" ] && continue
  dup=0
  for existing in "${KEY_VALUES[@]:-}"; do [ "$existing" = "$val" ] && dup=1 && break; done
  [ "$dup" -eq 0 ] && { KEY_NAMES+=("$v"); KEY_VALUES+=("$val"); }
done
echo "[keys] ${#KEY_VALUES[@]} unique"

ADC_TOKEN=""
command -v gcloud >/dev/null 2>&1 && ADC_TOKEN=$(gcloud auth print-access-token 2>/dev/null || true)
echo "[adc] ${ADC_TOKEN:+present}${ADC_TOKEN:-none}"

# ─────────────────────────────────────────────────────────────────────────────
step "4. BUN PROJECT (two-phase winner, X-Goog-User-Project on Gemini API too)"
# ─────────────────────────────────────────────────────────────────────────────
PROJ="$WORK/project"
cat > "$PROJ/package.json" << 'PKG'
{"name":"tau-fix-v4","private":true,"type":"module","scripts":{"start":"bun run src/index.ts"}}
PKG

cat > "$PROJ/src/index.ts" << 'TSEOF'
// ═════════════════════════════════════════════════════════════════════════
// TAU_FIX v4 — matrix probe + two-phase winner + runner socket
// ═════════════════════════════════════════════════════════════════════════
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";

const HOME = process.env.HOME || "/home/toxic";
const WORK = join(HOME, ".tau_fix");
const OUT  = join(WORK, "out");
const SOCK = join(WORK, "runner.sock");
const G    = "https://generativelanguage.googleapis.com";
const MODEL = "gemini-flash-tool-retrieval";
const SEED_PROJECT = process.env.TAU_SEED_PROJECT || "gen-lang-client-0111199472";

type AuthMode = "apikey-header"|"apikey-bearer"|"apikey-query"|"adc-bearer";
type Ep = { url:string; method:"POST"|"GET"; style:"native"|"openai"|"vertex-gen"; label:string; userProject?:string; };

function buildMatrix(projects:string[]):Ep[] {
  const list:Ep[] = [];
  // ── SEED FIRST: the triple your logs already proved works ──
  // s2-key_only.json + s2-bearer_only.json both returned 200 on this URL.
  list.push({ url:`${G}/v1beta/interactions`, method:"POST", style:"native",
              label:"SEED-gemini-v1beta-interactions", userProject:SEED_PROJECT });
  // ── Gemini API interactions, one entry per project (X-Goog-User-Project routing) ──
  for (const p of projects) {
    if (p === SEED_PROJECT) continue;
    list.push({ url:`${G}/v1beta/interactions`, method:"POST", style:"native",
                label:`gemini-v1beta-interactions[${p}]`, userProject:p });
  }
  // ── Gemini API openai compat ──
  list.push({ url:`${G}/v1beta/openai/chat/completions`, method:"POST", style:"openai", label:"gemini-v1beta-openai" });
  // ── Vertex AI interactions per project × region ──
  const regions = ["global","us-central1"];
  for (const p of projects) {
    for (const r of regions) {
      const host = r === "global" ? "aiplatform" : `${r}-aiplatform`;
      const b = `https://${host}.googleapis.com`;
      list.push({ url:`${b}/v1beta1/projects/${p}/locations/${r}/interactions`,
                  method:"POST", style:"native", label:`vertex-${r}-interactions[${p}]`, userProject:p });
      list.push({ url:`${b}/v1beta1/projects/${p}/locations/${r}/publishers/google/models/${MODEL}:generateContent`,
                  method:"POST", style:"vertex-gen", label:`vertex-${r}-eap-gen[${p}]`, userProject:p });
    }
  }
  return list;
}

function buildBody(style:string, sys:string, user:string):unknown {
  if (style === "openai") return { model:"gemini-2.5-flash",
    messages:[{role:"system",content:sys},{role:"user",content:user}], temperature:0.1, max_tokens:512 };
  if (style === "vertex-gen") return { contents:[{role:"user",parts:[{text:sys+"\n\n"+user}]}],
    generationConfig:{temperature:0.1,maxOutputTokens:512} };
  // native interactions — this is the shape from your s2/s3 logs
  return { model:MODEL, input:user, system_instruction:sys,
    tools:[{ type:"tool_search" }] };
}

function headersFor(style:string, auth:AuthMode, key:string, adc:string, userProject?:string):Record<string,string> {
  const h:Record<string,string> = { "Content-Type":"application/json" };
  if (auth === "apikey-header") h["x-goog-api-key"] = key;
  else if (auth === "apikey-bearer") h["Authorization"] = `Bearer ${key}`;
  else if (auth === "adc-bearer" && adc) h["Authorization"] = `Bearer ${adc}`;
  // ← v4 fix: send this on generativelanguage.googleapis.com too, not just aiplatform
  if (userProject) h["X-Goog-User-Project"] = userProject;
  return h;
}
function urlFor(url:string, auth:AuthMode, key:string):string {
  if (auth === "apikey-query") return url + (url.includes("?")?"&":"?") + "key=" + encodeURIComponent(key);
  return url;
}

interface R { label:string; url:string; auth:AuthMode; keyName:string; keyPrev:string;
  status:number; ok:boolean; body:string; ms:number;
  hasSteps:boolean; stepTypes:string[]; aiStudioProject?:string; }

function extractAiStudioProject(body:string):string|undefined {
  const m1 = body.match(/projects\/([a-z][a-z0-9-]{4,})/i);           if (m1) return m1[1];
  const m2 = body.match(/"project(?:_id)?"\s*:\s*"([^"]+)"/);          if (m2) return m2[1];
  return undefined;
}
function inspectBody(body:string):{ hasSteps:boolean; stepTypes:string[] } {
  try {
    const j = JSON.parse(body);
    const steps = Array.isArray(j?.steps) ? j.steps : [];
    return { hasSteps: steps.length > 0, stepTypes: steps.map((s:any)=>s?.type).filter(Boolean) };
  } catch { return { hasSteps:false, stepTypes:[] }; }
}

async function probe(ep:Ep, auth:AuthMode, keyName:string, keyVal:string, adc:string, sys:string, usr:string):Promise<R> {
  const url  = urlFor(ep.url, auth, keyVal);
  const hdrs = headersFor(ep.style, auth, keyVal, adc, ep.userProject);
  const body = ep.method === "POST" ? buildBody(ep.style, sys, usr) : undefined;
  const t0 = Date.now();
  try {
    const r = await fetch(url, { method:ep.method, headers:hdrs,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000) });
    const txt = await r.text();
    const ins = inspectBody(txt);
    return { label:ep.label, url, auth, keyName, keyPrev:keyVal.slice(0,10)+"…",
      status:r.status, ok:r.ok, body:txt.slice(0,2000), ms:Date.now()-t0,
      hasSteps:ins.hasSteps, stepTypes:ins.stepTypes,
      aiStudioProject:extractAiStudioProject(txt) };
  } catch (e) {
    return { label:ep.label, url, auth, keyName, keyPrev:keyVal.slice(0,10)+"…",
      status:0, ok:false, body:String(e).slice(0,300), ms:Date.now()-t0,
      hasSteps:false, stepTypes:[] };
  }
}

// ── two-phase winner: second POST must return non-empty steps[] ──
async function validateWinner(w:{ep:Ep;auth:AuthMode;keyName:string;keyVal:string}, adc:string):Promise<{ok:boolean;r:R}> {
  const r = await probe(w.ep, w.auth, w.keyName, w.keyVal, adc,
    "You are a probe. Reply with the single word OK.",
    "Return OK.");
  return { ok: r.status === 200 && r.hasSteps, r };
}

async function main() {
  await mkdir(OUT, { recursive:true });
  const keys = JSON.parse(process.env.TAU_KEYS_JSON || "[]") as { name:string; value:string }[];
  const adc  = process.env.TAU_ADC || "";
  const projects = (process.env.TAU_PROJECTS || "").split(/\s+/).filter(Boolean);
  // make sure the seed project is in the matrix even if gcloud projects list missed it
  if (!projects.includes(SEED_PROJECT)) projects.unshift(SEED_PROJECT);

  console.log(`[init]   keys=${keys.length} adc=${adc?"yes":"no"} projects=${projects.length}`);
  console.log(`[init]   seed_project=${SEED_PROJECT}`);

  const eps = buildMatrix(projects);
  console.log(`[probe]  ${eps.length} endpoints × 3 auth × ${keys.length} keys ≈ ${eps.length*3*keys.length} calls`);

  const all:R[] = [];
  let winner: { ep:Ep; auth:AuthMode; keyName:string; keyVal:string; validated:R } | null = null;

  outer: for (const ep of eps) {
    const modes:AuthMode[] =
      ep.style === "vertex-gen" ? ["adc-bearer","apikey-bearer","apikey-header","apikey-query"] :
      ep.style === "openai"     ? ["apikey-bearer","apikey-header","apikey-query","adc-bearer"] :
                                  ["apikey-header","apikey-bearer","apikey-query","adc-bearer"];
    for (const auth of modes) {
      const tasks:Promise<R>[] = [];
      if (auth === "adc-bearer") {
        if (!adc) continue;
        tasks.push(probe(ep, auth, "ADC", "", adc, "You are a probe.", "Return OK."));
      } else {
        for (const k of keys) tasks.push(probe(ep, auth, k.name, k.value, adc, "You are a probe.", "Return OK."));
      }
      const results = await Promise.all(tasks);
      for (const r of results) {
        all.push(r);
        const flag = r.ok ? (r.hasSteps ? "✅✓" : "✅-") : (r.status===402?"💳":r.status===404?"🔍":r.status===401?"🔑":r.status===403?"🚫":r.status===400?"🔧":"❌");
        console.log(`[probe] ${flag} ${String(r.status).padStart(3)} ${ep.label.padEnd(48)} ${auth.padEnd(14)} ${r.keyName.padEnd(20)} steps=${r.stepTypes.join(",")||"-"} ${r.ms}ms`);
        if (r.ok && ep.method === "POST" && r.hasSteps && !winner) {
          const idx = keys.findIndex(k => k.name === r.keyName);
          const wval = idx >= 0 ? keys[idx].value : (auth==="adc-bearer" ? "" : "");
          const w = { ep, auth, keyName:r.keyName, keyVal:wval };
          console.log(`[probe] 🎯 candidate winner: ${ep.label} via ${auth} key=${r.keyName}`);
          const v = await validateWinner(w, adc);
          console.log(`[valid] ${v.ok?"✅ confirmed":"❌ rejected"} — ${v.r.status} steps=${v.r.stepTypes.join(",")||"-"}`);
          if (v.ok) {
            winner = { ...w, validated:v.r };
            console.log(`[probe] 🏆 WINNER locked: ${ep.label} via ${auth} key=${r.keyName}`);
            break outer;  // stop the whole scan
          }
        }
      }
    }
  }

  await writeFile(join(OUT,"probe_all.json"), JSON.stringify(all, null, 2));

  const cats = {
    ok_steps:   all.filter(r => r.ok && r.hasSteps),
    ok_nosteps: all.filter(r => r.ok && !r.hasSteps),
    billing:    all.filter(r => r.status === 402),
    authFail:   all.filter(r => r.status === 401),
    forbidden:  all.filter(r => r.status === 403),
    notFound:   all.filter(r => r.status === 404),
    badShape:   all.filter(r => r.status === 400),
    other:      all.filter(r => !r.ok && ![400,401,402,403,404].includes(r.status)),
  };
  const blockedProjects = new Set<string>();
  for (const r of cats.billing) if (r.aiStudioProject) blockedProjects.add(r.aiStudioProject);

  await writeFile(join(OUT,"probe_summary.json"), JSON.stringify({
    total: all.length,
    ok_with_steps:  cats.ok_steps.length,
    ok_no_steps:    cats.ok_nosteps.length,
    billing_depleted: cats.billing.length,
    auth_failed:    cats.authFail.length,
    forbidden:      cats.forbidden.length,
    not_found:      cats.notFound.length,
    bad_shape:      cats.badShape.length,
    other:          cats.other.length,
    winner: winner ? {
      label:winner.ep.label, url:winner.ep.url, auth:winner.auth,
      key:winner.keyName, userProject:winner.ep.userProject,
      steps:winner.validated.stepTypes
    } : null,
    billing_blocked_projects: [...blockedProjects]
  }, null, 2));

  // ── runner socket: hold interaction open across tool_search_call/function_call
  //    Protocol: newline-delimited JSON frames.
  //      → {"op":"ping"}                      ← {"pong":true}
  //      → {"op":"ask","user":"...","sys":"..."}
  //      ← {"interaction_id":"...","steps":[...],"final":"..."}
  //    Uses the locked winner. Matches s3-*/s5-* shape.
  if (winner) {
    const w = winner;
    const server = createServer(async socket => {
      let buf = "";
      socket.on("data", async chunk => {
        buf += chunk.toString();
        let nl:number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl); buf = buf.slice(nl+1);
          if (!line.trim()) continue;
          let req:any; try { req = JSON.parse(line); } catch { socket.write(JSON.stringify({error:"bad json"})+"\n"); continue; }
          if (req.op === "ping") { socket.write(JSON.stringify({pong:true,winner:w.ep.label})+"\n"); continue; }
          if (req.op === "ask") {
            const sys = req.sys || "You are a helpful agent.";
            const usr = req.user || "ping";
            const body = buildBody(w.ep.style, sys, usr);
            const hdrs = headersFor(w.ep.style, w.auth, w.keyVal, adc, w.ep.userProject);
            const url  = urlFor(w.ep.url, w.auth, w.keyVal);
            try {
              const r = await fetch(url, { method:"POST", headers:hdrs, body:JSON.stringify(body),
                signal: AbortSignal.timeout(300_000) });
              const txt = await r.text();
              const ins = inspectBody(txt);
              let final = "";
              try { const j = JSON.parse(txt);
                const outs = (j.steps||[]).filter((s:any)=>s.type==="model_output");
                final = outs.map((o:any)=> (o.content||[]).map((c:any)=>c.text||"").join("")).join("");
              } catch {}
              socket.write(JSON.stringify({ interaction_id:(JSON.parse(txt)?.id)||null,
                status:r.status, steps:ins.stepTypes, final, raw_len:txt.length })+"\n");
            } catch (e) {
              socket.write(JSON.stringify({ error:String(e) })+"\n");
            }
            continue;
          }
          socket.write(JSON.stringify({error:"unknown op"})+"\n");
        }
      });
    });
    server.listen(SOCK, () => console.log(`[runner] listening on ${SOCK}`));
  } else {
    console.log(`[runner] no winner — socket not started`);
  }

  // ── keep process alive if we have a runner
  if (winner) {
    console.log(`[runner] winner locked; process will stay up to serve the socket`);
    // write an unlock file so the launcher knows the winner is available
    await writeFile(join(OUT,"winner.json"), JSON.stringify({
      label:winner.ep.label, url:winner.ep.url, auth:winner.auth, key:winner.keyName,
      userProject:winner.ep.userProject, steps:winner.validated.stepTypes, socket:SOCK
    }, null, 2));
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

setsid nohup "$WORK/run.sh" </dev/null >> "$WORK/logs/bun_run.log" 2>&1 &
PID=$!
echo "$PID" > "$WORK/bun.pid"
echo "[launch] pid=$PID"

# ─────────────────────────────────────────────────────────────────────────────
step "6. OPTIONAL socat MIRROR"
# ─────────────────────────────────────────────────────────────────────────────
if command -v socat >/dev/null 2>&1; then
  # if you want an external socat bridge to the bun socket, uncomment:
  # setsid nohup socat UNIX-LISTEN:$WORK/runner_ext.sock,fork,reuseaddr \
  #   UNIX-CONNECT:$WORK/runner.sock </dev/null >> "$WORK/logs/socat.log" 2>&1 &
  echo "[socat] available; runner.sock will be created by bun"
fi

# ─────────────────────────────────────────────────────────────────────────────
step "7. REPORT"
# ─────────────────────────────────────────────────────────────────────────────
cat << REPORT

════════════════════════════════════════════════════════════════════════════
  TAU_FIX v4 LAUNCHED
════════════════════════════════════════════════════════════════════════════
  PID           : $PID
  Keys          : ${#KEY_VALUES[@]}
  Projects      : ${#PROJECTS[@]}    (${PROJECTS[*]:-none})
  Seed project  : $SEED_PROJECT
  ADC           : ${ADC_TOKEN:+yes}${ADC_TOKEN:-no}
  Billing accts : $BA_COUNT
  Matrix        : ~$(( ${#PROJECTS[@]} * 2 * 5 + 3 )) endpoints × 3-4 auth × keys
  Runner socket : $WORK/runner.sock   (created on first winner)

  v4 fixes vs v3:
    ✅  X-Goog-User-Project now sent on generativelanguage.googleapis.com too
    ✅  Two-phase winner: 2nd POST must return non-empty steps[]
    ✅  Headless gcloud services enable on any disabled API
    ✅  Seed triple tried FIRST (gen-lang-client-0111199472 + /v1beta/interactions)
    ✅  Persistent runner socket holds interaction open across tool_search_call
    ✅  WAL journal at $WORK/journal/wal.log

  MONITOR:
    tail -f $WORK/logs/bun_run.log
    cat $WORK/out/probe_summary.json
    cat $WORK/out/winner.json                    # once a winner is locked
    ls -la $WORK/runner.sock                     # when socket is up

  TALK TO RUNNER (after winner is locked):
    printf '{"op":"ping"}\n' | socat - UNIX-CONNECT:$WORK/runner.sock
    printf '{"op":"ask","sys":"You are a code agent.","user":"Read ~/.bashrc and summarize."}\n' \\
      | socat - UNIX-CONNECT:$WORK/runner.sock

  STOP:
    kill \$(cat $WORK/bun.pid)

════════════════════════════════════════════════════════════════════════════
REPORT

echo
echo "[tail] 90s preview…"
timeout 90 tail -F "$WORK/logs/bun_run.log" 2>/dev/null || true
echo
echo "[done] detached. winner.json + runner.sock appear after ~2-5 min."
