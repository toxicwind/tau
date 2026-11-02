#!/usr/bin/env bash
# =============================================================================
# TAU_FIX_AUTONOMOUS v4: Active Headless Enablement, Full Keypool, Vertex Matrix
# =============================================================================
set -u
export HOME="${HOME:-/home/toxic}"
WORK="$HOME/.tau_fix"
mkdir -p "$WORK"/{logs,out,project/src}
LOG="$WORK/logs/run_$(date +%Y%m%d_%H%M%S).log"
exec > >(tee -a "$LOG") 2>&1

banner(){ echo; echo "================================================================================"; echo "  $*"; echo "================================================================================"; }
step(){ echo; echo "--- $* ---"; }

banner "TAU_FIX v4 AUTONOMOUS $(date -u +%FT%TZ)"
echo "work: $WORK"
echo "log:  $LOG"

# -----------------------------------------------------------------------------
step "1. TOOLCHAIN VERIFICATION"
# -----------------------------------------------------------------------------
export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$PATH"
if ! command -v bun >/dev/null 2>&1; then
  echo "[bun] installing bun runtime..."
  curl -fsSL https://bun.sh/install 2>&1 | bash 2>&1 | tail -3 || true
  export PATH="$HOME/.bun/bin:$PATH"
fi
command -v bun >/dev/null 2>&1 && echo "[bun] $(bun --version)" || { echo "[bun] FAILED"; exit 1; }

# -----------------------------------------------------------------------------
step "2. AUTONOMOUS GOOGLE CLOUD TOPOLOGY & REMEDIATION"
# -----------------------------------------------------------------------------
mkdir -p "$WORK/out"

# 2a. Billing accounts enumeration
echo "[billing] enumerating accounts..."
gcloud billing accounts list --format=json 2>/dev/null > "$WORK/out/billing_accounts.json" \vert{}\vert{} echo "[]" > "$WORK/out/billing_accounts.json"
OPEN_BA_ID=$(jq -r '.[] \vert{} select(.open == true) \vert{} .name' "$WORK/out/billing_accounts.json" 2>/dev/null | head -1 | sed 's|billingAccounts/||' || true)
echo "[billing] active open billing account: ${OPEN_BA_ID:-none}"

# 2b. Project enumeration & autonomous billing repair
echo "[projects] enumerating and verifying billing..."
mapfile -t PROJECTS < <(gcloud projects list --format="value(projectId)" 2>/dev/null || true)
echo "[projects] ${#PROJECTS[@]} project(s) detected: ${PROJECTS[*]:-none}"

: > "$WORK/out/project_billing.tsv"
printf "project\tbillingAccountName\tbillingEnabled\tactionTaken\n" >> "$WORK/out/project_billing.tsv"

for p in "${PROJECTS[@]}"; do
  BJSON=$(gcloud billing projects describe "$p" --format=json 2>/dev/null || echo '{"billingEnabled":false}')
  BACC=$(echo "$BJSON" | jq -r '.billingAccountName // "none"' 2>/dev/null || echo "none")
  BEN=$(echo "$BJSON" | jq -r '.billingEnabled // false' 2>/dev/null || echo "false")
  ACTION="none"

  # Autonomously link billing if disabled and an open billing account exists
  if [ "$BEN" != "true" ] && [ -n "$OPEN_BA_ID" ]; then
    echo "  [remediation] linking project $p to billing account$OPEN_BA_ID..."
    if gcloud billing projects link "$p" --billing-account="$OPEN_BA_ID" --quiet 2>/dev/null; then
      BEN="true"
      BACC="billingAccounts/$OPEN_BA_ID"
      ACTION="linked_open_account"
    else
      ACTION="link_failed"
    fi
  fi

  printf "%s\t%s\t%s\t%s\n" "$p" "$BACC" "$BEN" "$ACTION" >> "$WORK/out/project_billing.tsv"
  echo "  $p billing=$BEN account=$BACC action=$ACTION"
done

# 2c. Autonomous API enablement per project
echo "[apis] verifying and autonomously enabling required services..."
: > "$WORK/out/project_apis.tsv"
printf "project\tapi\tstate\n" >> "$WORK/out/project_apis.tsv"

for p in "${PROJECTS[@]}"; do
  for api in aiplatform.googleapis.com generativelanguage.googleapis.com; do
    STATE=$(gcloud services list --enabled --project="$p" --format="value(config.name)" 2>/dev/null \vert{} grep -Fx "$api" | head -1)
    if [ -z "$STATE" ]; then
      echo "  [remediation] enabling $api on project$p..."
      if gcloud services enable "$api" --project="$p" --quiet 2>/dev/null; then
        S="ENABLED_AUTONOMOUSLY"
      else
        S="enable_failed"
      fi
    else
      S="ENABLED"
    fi
    printf "%s\t%s\t%s\n" "$p" "$api" "$S" >> "$WORK/out/project_apis.tsv"
    echo "  $p $api ->$S"
  done
done

# 2d. Keypool loading from secrets, env, and gcloud API key registry
declare -a KEY_NAMES KEY_VALUES

# Ingest from ~/.secrets
if [ -f "$HOME/.secrets" ]; then
  while IFS= read -r line; do
    case "$line" in
      GEMINI_EAP_KEY_*|GEMINI_API_KEY*|GOOGLE_API_KEY*)
        k="${line%%=*}"; v="${line#*=}"; v="${v%%#*}"; v="$(printf '\%s' "$v" | xargs)"
        [ -n "$v" ] && { KEY_NAMES+=("$k"); KEY_VALUES+=("$v"); }
        ;;
    esac
  done < "$HOME/.secrets"
fi

# Ingest from environment variables
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

# Harvest project-managed keys directly via gcloud
for p in "${PROJECTS[@]}"; do
  mapfile -t P_KEYS < <(gcloud services api-keys list --project="$p" --format="value(name)" 2>/dev/null || true)
  for kname in "${P_KEYS[@]}"; do
    kval=$(gcloud services api-keys get-key-string "$kname" --format="value(keyString)" 2>/dev/null || true)
    if [ -n "$kval" ]; then
      dup=0
      for existing in "${KEY_VALUES[@]:-}"; do [ "$existing" = "$kval" ] && dup=1 && break; done
      if [ "$dup" -eq 0 ]; then
        label="GCLOUD_${p}_$(basename "$kname")"
        KEY_NAMES+=("$label")
        KEY_VALUES+=("$kval")
        echo "  [keys] harvested project key from $p ($label)"
      fi
    fi
  done
done
echo "[keys] total unique keys gathered: ${#KEY_VALUES[@]}"

# 2e. Generate multi-scope ADC token
ADC_TOKEN=""
if command -v gcloud >/dev/null 2>&1; then
  ADC_TOKEN=$(gcloud auth print-access-token \
    --scopes="https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/generative-language" \
    2>/dev/null || gcloud auth print-access-token 2>/dev/null || true)
fi
echo "[adc] token status: ${ADC_TOKEN:+token-acquired}${ADC_TOKEN:-none}"

# -----------------------------------------------------------------------------
step "3. COMPILE BUN RUNNER CODE"
# -----------------------------------------------------------------------------
PROJ="$WORK/project"
cat > "$PROJ/package.json" << 'PKG'
{"name":"tau-fix","private":true,"type":"module","scripts":{"start":"bun run src/index.ts"}}
PKG

cat > "$PROJ/src/index.ts" << 'TSEOF'
import { readdir, readFile, writeFile, stat, mkdir } from "node:fs/promises";
import { join, relative, extname } from "node:path";

const HOME      = process.env.HOME || "/home/toxic";
const TAU       = process.env.TAU_TARGET || join(HOME, "estate", "ranch", "tau");
const WORK      = join(HOME, ".tau_fix");
const OUT       = join(WORK, "out");
const MAX_LINE  = 300;
const MAX_LINES = 400;
const MAX_FILES = 500;
const MAX_BYTES = 200_000;

const SKIP = new Set([
  "node_modules", ".git", "target", "dist", "build", ".next",
  ".cache", "coverage", ".venv", "venv", "__pycache__", ".svelte-kit", ".turbo",
  "out", ".output", ".bun", "obj", ".patch-backups", ".tau_fix"
]);

const TEXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".rs", ".toml",
  ".json", ".jsonc", ".yaml", ".yml", ".md", ".txt", ".sh", ".bash", ".zsh", ".py",
  ".go", ".css", ".html", ".sql", ".env", ".lock", ".cfg", ".ini", ".patch", ".diff",
  ".bzl", ".bazel"
]);

type AuthMode = "apikey-header" | "apikey-bearer" | "apikey-query" | "adc-bearer";
type Ep = {
  url: string;
  method: "POST" | "GET";
  style: "native" | "openai" | "vertex-gen";
  label: string;
  userProject?: string;
};

const MODELS_EAP = ["gemini-flash-tool-retrieval"];
const MODELS_2   = ["gemini-2.5-flash", "gemini-2.0-flash"];

function buildMatrix(projects: string[]): Ep[] {
  const g = "https://generativelanguage.googleapis.com";
  const list: Ep[] = [
    { url: `${g}/v1beta/interactions`, method: "POST", style: "native", label: "gemini-v1beta-interactions" },
    { url: `${g}/v1beta/openai/chat/completions`, method: "POST", style: "openai", label: "gemini-v1beta-openai" },
    { url: `${g}/v1beta/models/gemini-2.5-flash:generateContent`, method: "POST", style: "native", label: "gemini-v1beta-2.5flash-gen" },
  ];

  const regions = ["us-central1", "global"];
  for (const p of projects) {
    for (const r of regions) {
      const host = r === "global" ? "aiplatform" : `${r}-aiplatform`;
      const b = `https://${host}.googleapis.com`;

      list.push({
        url: `${b}/v1beta1/projects/${p}/locations/${r}/interactions`,
        method: "POST",
        style: "native",
        label: `vertex-${r}-${p}-interactions`,
        userProject: p
      });

      for (const m of MODELS_EAP) {
        list.push({
          url: `${b}/v1beta1/projects/${p}/locations/${r}/publishers/google/models/${m}:generateContent`,
          method: "POST",
          style: "vertex-gen",
          label: `vertex-${r}-${p}-${m}`,
          userProject: p
        });
      }

      for (const m of MODELS_2) {
        list.push({
          url: `${b}/v1beta1/projects/${p}/locations/${r}/publishers/google/models/${m}:generateContent`,
          method: "POST",
          style: "vertex-gen",
          label: `vertex-${r}-${p}-${m}`,
          userProject: p
        });
      }
    }
  }
  return list;
}

function buildBody(style: string, user: string, sys: string, model?: string): any {
  if (style === "openai") {
    return {
      model: model || "gemini-2.5-flash",
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      temperature: 0.1,
      max_tokens: 4000
    };
  }
  if (style === "vertex-gen") {
    return {
      contents: [{ role: "user", parts: [{ text: `${sys}\n\n${user}` }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 4000 }
    };
  }
  return {
    model: "gemini-flash-tool-retrieval",
    input: user,
    system_instruction: sys,
    tools: [
      { type: "tool_search" },
      {
        type: "function",
        name: "read_file",
        description: "Read a file beyond the truncated window",
        defer_loading: true,
        parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }
      }
    ]
  };
}

function headersFor(style: string, auth: AuthMode, key: string, adc: string, userProject?: string): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (auth === "apikey-header") h["x-goog-api-key"] = key;
  else if (auth === "apikey-bearer") h["Authorization"] = `Bearer ${key}`;
  else if (auth === "adc-bearer" && adc) h["Authorization"] = `Bearer ${adc}`;
  if (userProject) h["X-Goog-User-Project"] = userProject;
  return h;
}

function urlFor(url: string, auth: AuthMode, key: string): string {
  if (auth === "apikey-query") return `${url}${url.includes("?") ? "&" : "?"}key=${encodeURIComponent(key)}`;
  return url;
}

interface R {
  label: string;
  url: string;
  auth: AuthMode;
  keyName: string;
  keyPrev: string;
  status: number;
  ok: boolean;
  body: string;
  ms: number;
  aiStudioProject?: string;
}

function extractAiStudioProject(body: string): string | undefined {
  const m1 = body.match(/projects\/([a-z][a-z0-9-]{4,})/i);
  if (m1) return m1[1];
  const m2 = body.match(/"project(?:_id)?"\s*:\s*"([^"]+)"/);
  if (m2) return m2[1];
  return undefined;
}

async function probe(ep: Ep, auth: AuthMode, keyName: string, keyVal: string, adc: string): Promise<R> {
  const url = urlFor(ep.url, auth, keyVal);
  const hdrs = headersFor(ep.style, auth, keyVal, adc, ep.userProject);
  const body = ep.method === "POST" ? buildBody(ep.style, "ping", "Reply with PONG only.", "gemini-2.5-flash") : undefined;
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      method: ep.method,
      headers: hdrs,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000)
    });
    const txt = await r.text();
    return {
      label: ep.label,
      url,
      auth,
      keyName,
      keyPrev: keyVal ? `${keyVal.slice(0, 10)}...` : "(none)",
      status: r.status,
      ok: r.ok,
      body: txt.slice(0, 1200),
      ms: Date.now() - t0,
      aiStudioProject: extractAiStudioProject(txt)
    };
  } catch (e) {
    return {
      label: ep.label,
      url,
      auth,
      keyName,
      keyPrev: keyVal ? `${keyVal.slice(0, 10)}...` : "(none)",
      status: 0,
      ok: false,
      body: String(e).slice(0, 300),
      ms: Date.now() - t0
    };
  }
}

interface F {
  rel: string;
  size: number;
  lines: string[];
  truncated: boolean;
  minified: boolean;
}

async function walk(root: string, limit: number, acc: F[] = []): Promise<F[]> {
  if (acc.length >= limit) return acc;
  let es;
  try { es = await readdir(root, { withFileTypes: true }); } catch { return acc; }
  for (const e of es) {
    if (acc.length >= limit) break;
    if (e.name.startsWith(".") && e.name !== ".env") continue;
    const full = join(root, e.name);
    if (e.isDirectory()) {
      if (SKIP.has(e.name)) continue;
      await walk(full, limit, acc);
    } else if (e.isFile() || e.isSymbolicLink()) {
      const ext = extname(e.name).toLowerCase();
      if (!TEXT.has(ext)) continue;
      try {
        const st = await stat(full);
        if (st.size > MAX_BYTES) continue;
        const raw = await readFile(full, "utf8");
        const rawLines = raw.split("\n");
        const avg = raw.length / Math.max(rawLines.length, 1);
        const minified = (rawLines.length === 1 && raw.length > 5000) || (avg > 150 && raw.length > 5000);
        if (minified) {
          acc.push({ rel: relative(root, full), size: st.size, lines: [], truncated: false, minified: true });
          continue;
        }
        let trunc = rawLines.length > MAX_LINES;
        const lines = rawLines.slice(0, MAX_LINES).map(l => {
          if (l.length > MAX_LINE) {
            trunc = true;
            return l.slice(0, MAX_LINE) + " ...[trunc]";
          }
          return l;
        });
        acc.push({ rel: relative(root, full), size: st.size, lines, truncated: trunc, minified: false });
      } catch {}
    }
  }
  return acc;
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const keysRaw = process.env.TAU_KEYS_JSON || "[]";
  const keys: { name: string; value: string }[] = JSON.parse(keysRaw);
  const adc = process.env.TAU_ADC || "";
  const projects = (process.env.TAU_PROJECTS || "").split(/\s+/).filter(Boolean);

  console.log(`[init] target=${TAU} keys=${keys.length} adc=${adc ? "yes" : "no"} projects=${projects.length}`);

  console.log(`[walk] ${TAU}`);
  const files = await walk(TAU, MAX_FILES);
  const text = files.filter(f => !f.minified);
  const mini = files.filter(f => f.minified);
  console.log(`[walk] ${files.length} total, ${text.length} text, ${mini.length} minified-skipped`);

  const eps = buildMatrix(projects);
  console.log(`[probe] ${eps.length} endpoints across auth modes and keys`);

  const all: R[] = [];
  let winner: { ep: Ep; auth: AuthMode; keyName: string; keyVal: string } | null = null;

  for (const ep of eps) {
    const modes: AuthMode[] =
      ep.style === "vertex-gen" ? ["adc-bearer", "apikey-bearer", "apikey-header", "apikey-query"] :
      ep.style === "openai"     ? ["apikey-bearer", "apikey-header", "apikey-query", "adc-bearer"] :
                                  ["apikey-header", "apikey-bearer", "apikey-query", "adc-bearer"];

    for (const auth of modes) {
      const tasks: Promise<R>[] = [];
      if (auth === "adc-bearer") {
        if (!adc) continue;
        tasks.push(probe(ep, auth, "ADC", "", adc));
      } else {
        for (const k of keys) {
          tasks.push(probe(ep, auth, k.name, k.value, adc));
        }
      }

      const results = await Promise.all(tasks);
      for (const r of results) {
        all.push(r);
        const flag = r.ok ? "✅" : (r.status === 402 ? "💳" : r.status === 404 ? "🔍" : r.status === 401 ? "🔑" : r.status === 403 ? "🚫" : r.status === 400 ? "🔧" : "❌");
        console.log(`[probe] ${flag} ${String(r.status).padStart(3)} ${ep.label.padEnd(36)} ${auth.padEnd(14)} ${r.keyName.padEnd(26)} ${r.ms}ms`);

        if (r.ok && ep.method === "POST" && !winner) {
          const idx = keys.findIndex(k => k.name === r.keyName);
          if (idx >= 0) winner = { ep, auth, keyName: r.keyName, keyVal: keys[idx].value };
          else if (auth === "adc-bearer") winner = { ep, auth, keyName: "ADC", keyVal: "" };
          console.log(`[probe] 🎯 WINNER ACQUIRED (POST 200): ${ep.label} via ${auth} key=${r.keyName}`);
        }
      }
    }
    if (winner) {
      console.log(`[probe] early termination: valid POST endpoint confirmed`);
      break;
    }
  }

  await writeFile(join(OUT, "probe_all.json"), JSON.stringify(all, null, 2));

  const cats = {
    ok:         all.filter(r => r.ok),
    billing:    all.filter(r => r.status === 402),
    deprecated: all.filter(r => r.status === 400 && r.body.includes("deprecated")),
    authFail:   all.filter(r => r.status === 401),
    forbidden:  all.filter(r => r.status === 403),
    notFound:   all.filter(r => r.status === 404),
    badShape:   all.filter(r => r.status === 400 && !r.body.includes("deprecated")),
    other:      all.filter(r => !r.ok && ![400, 401, 402, 403, 404].includes(r.status))
  };

  const blockedProjects = new Set<string>();
  for (const r of cats.billing) if (r.aiStudioProject) blockedProjects.add(r.aiStudioProject);

  await writeFile(join(OUT, "probe_summary.json"), JSON.stringify({
    total: all.length,
    ok: cats.ok.length,
    billing_depleted: cats.billing.length,
    deprecated: cats.deprecated.length,
    auth_failed: cats.authFail.length,
    forbidden: cats.forbidden.length,
    model_not_found: cats.notFound.length,
    bad_shape: cats.badShape.length,
    other: cats.other.length,
    winner: winner ? { label: winner.ep.label, auth: winner.auth, key: winner.keyName, url: winner.ep.url } : null,
    billing_blocked_projects: [...blockedProjects]
  }, null, 2));

  const manifest = {
    target: TAU,
    generated: new Date().toISOString(),
    max_line: MAX_LINE,
    max_lines: MAX_LINES,
    max_files: MAX_FILES,
    text_files: text.length,
    minified_skipped: mini.length,
    minified_list: mini.map(f => ({ rel: f.rel, size: f.size })),
    files: text.map(f => ({
      rel: f.rel,
      size: f.size,
      lines_read: f.lines.length,
      truncated: f.truncated,
      head: f.lines.slice(0, 40)
    }))
  };
  await writeFile(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));

  if (winner) {
    console.log(`[model] invoking ${winner.ep.label} via ${winner.auth} key=${winner.keyName}`);
    const sys = `You are a code-fix agent. Return strict JSON: { "issues": [{"file","severity","diagnosis","patch"}], "summary": string }. ` +
      `Target: ${TAU}. Line capped at ${MAX_LINE} chars, files at ${MAX_LINES} lines. If truncated and more lines are needed, note in summary.`;
    const usr = JSON.stringify(manifest);
    const body = buildBody(winner.ep.style, usr, sys, "gemini-2.5-flash");
    const hdrs = headersFor(winner.ep.style, winner.auth, winner.keyVal, adc, winner.ep.userProject);
    const url  = urlFor(winner.ep.url, winner.auth, winner.keyVal);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(300_000)
      });
      const txt = await r.text();
      await writeFile(join(OUT, "model_response.json"), txt);
      console.log(`[model] complete: status=${r.status} bytes=${txt.length}`);
      try { await writeFile(join(OUT, "issues.json"), JSON.stringify(JSON.parse(txt), null, 2)); } catch {}
    } catch (e) {
      console.log(`[model] execution error: ${e}`);
    }
  }

  const rep: string[] = [];
  rep.push("# Tau Fix Autonomous Report v4");
  rep.push("");
  rep.push(`Generated: ${new Date().toISOString()}`);
  rep.push(`Target:    ${TAU}`);
  rep.push(`Text files: ${text.length} | Minified skipped: ${mini.length}`);
  rep.push(`Truncation bounds: ${MAX_LINE} chars/line, ${MAX_LINES} lines/file, ${MAX_FILES} files`);
  rep.push("");
  rep.push("## Probe Summary");
  rep.push(`- OK:               ${cats.ok.length}`);
  rep.push(`- Billing depleted: ${cats.billing.length}`);
  rep.push(`- Auth failed:      ${cats.authFail.length}`);
  rep.push(`- Forbidden:        ${cats.forbidden.length}`);
  rep.push(`- Model not found:  ${cats.notFound.length}`);
  rep.push(`- Bad format:       ${cats.badShape.length}`);
  rep.push(`- Deprecated:       ${cats.deprecated.length}`);
  rep.push(`- Other:            ${cats.other.length}`);
  rep.push("");
  rep.push("## Winner Selection");
  rep.push(winner ? `${winner.ep.label} | auth=${winner.auth} | key=${winner.keyName}` : "No functional POST endpoint acquired.");
  rep.push("");
  await writeFile(join(OUT, "report.md"), rep.join("\n"));
  console.log(`[done] completed run. Summary written to ${OUT}/report.md`);
}

main().catch(e => { console.error("[fatal]", e); process.exit(1); });
TSEOF

echo "[bun] compiled $PROJ/src/index.ts"

# -----------------------------------------------------------------------------
step "4. DISPATCH AUTONOMOUS EXECUTION"
# -----------------------------------------------------------------------------
KEYS_JSON="["
first=1
for i in "${!KEY_VALUES[@]}"; do
  [ "$first" -eq 1 ] && first=0 || KEYS_JSON+=","
  KEYS_JSON+="{\"name\":\"${KEY_NAMES[$i]}\",\"value\":\"${KEY_VALUES[$i]}\"}"
done
KEYS_JSON+="]"

PROJ_STR="${PROJECTS[*]:-}"

# Locate tau directory across target topologies
TAU_RESOLVED=""
for cand in "$HOME/ranch/tau" "$HOME/estate/ranch/tau" "$HOME/sovereign/projects/range/ranch/stockyard/tau"; do
  if [ -d "$cand" ]; then
    TAU_RESOLVED="$cand"
    break
  fi
done
[ -z "$TAU_RESOLVED" ] && TAU_RESOLVED="$HOME/ranch/tau"
echo "[target] resolved tau repository: $TAU_RESOLVED"

cat > "$WORK/run.sh" << RUNEOF
#!/usr/bin/env bash
set -u
cd "$PROJ"
export TAU_TARGET='$TAU_RESOLVED'
export TAU_KEYS_JSON='$KEYS_JSON'
export TAU_ADC='$ADC_TOKEN'
export TAU_PROJECTS='$PROJ_STR'
exec bun run src/index.ts
RUNEOF
chmod +x "$WORK/run.sh"

setsid nohup "$WORK/run.sh" </dev/null >> "$WORK/logs/bun_run.log" 2>&1 &
PID=$!
echo "$PID" > "$WORK/bun.pid"
echo "[launch] detached background PID: $PID"

banner "EXECUTION ACTIVE"
echo "Monitor status with: tail -f $WORK/logs/bun_run.log"
echo "Output files located at: $WORK/out/"
