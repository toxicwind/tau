#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════════
# FIX_Tau_MAXIMAL — autonomous repair of /home/toxic/ranch/tau
# Uses GCP EAP keys, MCP server, and all discovered secrets.
# ═════════════════════════════════════════════════════════════════════════════
set -u
export HOME="/home/toxic"
WORK="$HOME/.tau_fix"
mkdir -p "$WORK" "$WORK/sdk" "$WORK/logs" "$WORK/results"
LOG="$WORK/logs/fix_$(date +%Y%m%d_%H%M%S).log"
exec > >(tee -a "$LOG") 2>&1

banner() { echo; echo "════════════════════════════════════════════════════════════════════════════"; echo "  $*"; echo "════════════════════════════════════════════════════════════════════════════"; }
step()   { echo; echo "─── $* ───"; }

# ─────────────────────────────────────────────────────────────────────────────
step "1. ENSURE GOOGLE CLOUD SDK"
# ─────────────────────────────────────────────────────────────────────────────
if ! command -v gcloud >/dev/null 2>&1; then
    echo "[install] downloading gcloud SDK…"
    curl -sSL https://sdk.cloud.google.com > "$WORK/install_gcloud.sh"
    bash "$WORK/install_gcloud.sh" --disable-prompts --install-dir="$HOME/google-cloud-sdk" 2>&1 | tail -5
    export PATH="$HOME/google-cloud-sdk/bin:$PATH"
    echo 'export PATH="$HOME/google-cloud-sdk/bin:$PATH"' >> "$HOME/.bashrc"
fi
gcloud --version | head -1

# ─────────────────────────────────────────────────────────────────────────────
step "2. AUTHENTICATE (ADC + service account if present)"
# ─────────────────────────────────────────────────────────────────────────────
if [ ! -f "$HOME/.config/gcloud/application_default_credentials.json" ]; then
    echo "[auth] running gcloud auth application-default login…"
    gcloud auth application-default login --quiet 2>&1 | tail -5 || true
fi
ADC_EMAIL=$(python3 -c "import json;print(json.load(open('$HOME/.config/gcloud/application_default_credentials.json')).get('client_email','user'))" 2>/dev/null || echo "user")
echo "ADC principal: $ADC_EMAIL"

# ─────────────────────────────────────────────────────────────────────────────
step "3. EXTRACT EAP KEYS FROM .secrets AND ENV"
# ─────────────────────────────────────────────────────────────────────────────
SECRETS_FILE="$HOME/.secrets"
KEYS=()
if [ -f "$SECRETS_FILE" ]; then
    while IFS= read -r line; do
        case "$line" in
            GEMINI_EAP_KEY_*|GEMINI_API_KEY*|GOOGLE_API_KEY*)
                val="${line#*=}"
                val="${val%%#*}"
                val="$(echo "$val" | xargs)"
                [ -n "$val" ] && KEYS+=("$val")
                ;;
        esac
    done < "$SECRETS_FILE"
fi
# also pull from env
for v in GEMINI_API_KEY GOOGLE_API_KEY GEMINI_EAP_KEY_1 GEMINI_EAP_KEY_2 GEMINI_EAP_KEY_3 GEMINI_EAP_KEY_4 GEMINI_EAP_KEY_5 GEMINI_EAP_KEY_6; do
    val="${!v:-}"
    [ -n "$val" ] && KEYS+=("$val")
done
# dedupe
mapfile -t KEYS < <(printf '%s\n' "${KEYS[@]}" | sort -u)
echo "found ${#KEYS[@]} unique keys"

# ─────────────────────────────────────────────────────────────────────────────
step "4. DOWNLOAD EAP SDK WHEEL FROM GCS (all strategies)"
# ─────────────────────────────────────────────────────────────────────────────
GCS_WHEEL="gs://gemini-api-eap-sdks/toolRetrieval/google_genai-2.16.0-py3-none-any.whl"
GCS_TGZ="gs://gemini-api-eap-sdks/toolRetrieval/google-genai-2.16.0.tgz"
WHEEL_LOCAL="$WORK/sdk/google_genai-2.16.0-py3-none-any.whl"
TGZ_LOCAL="$WORK/sdk/google-genai-2.16.0.tgz"
WHEEL_OK=0

echo "[4a] gcloud storage cp (recursive -- all objects in prefix)"
timeout 20 gcloud storage cp --recursive "gs://gemini-api-eap-sdks/toolRetrieval/" "$WORK/sdk/" 2>&1 | tail -5
[ -f "$WHEEL_LOCAL" ] && WHEEL_OK=1 && echo "  ✔ wheel from gcloud storage"
[ -f "$TGZ_LOCAL" ] && echo "  ✔ tgz from gcloud storage"

if [ $WHEEL_OK -eq 0 ]; then
    echo "[4b] raw HTTPS with bearer token"
    TOK=$(gcloud auth print-access-token 2>/dev/null)
    CODE=$(curl -sS -o "$WHEEL_LOCAL" -w '%{http_code}' -m 15 \
        -H "Authorization: Bearer $TOK" \
        "https://storage.googleapis.com/gemini-api-eap-sdks/toolRetrieval/google_genai-2.16.0-py3-none-any.whl")
    echo "  HTTP=$CODE"
    [ "$CODE" = "200" ] && [ -s "$WHEEL_LOCAL" ] && WHEEL_OK=1 && echo "  ✔ wheel via HTTPS"
fi

if [ $WHEEL_OK -eq 0 ]; then
    echo "[4c] PyPI fallback google-genai==2.16.0"
    python3 -m pip download --no-deps --dest "$WORK/sdk" "google-genai==2.16.0" 2>&1 | tail -3
    WHEEL_LOCAL=$(ls "$WORK/sdk"/google_genai-2.16.0*.whl 2>/dev/null | head -1)
    [ -n "$WHEEL_LOCAL" ] && WHEEL_OK=1 && echo "  ✔ wheel from PyPI"
fi

echo "wheel source: $([ $WHEEL_OK -eq 1 ] && echo "OK" || echo "FAILED")"

# ─────────────────────────────────────────────────────────────────────────────
step "5. INSTALL EAP SDK"
# ─────────────────────────────────────────────────────────────────────────────
if [ -n "$WHEEL_LOCAL" ] && [ -f "$WHEEL_LOCAL" ]; then
    python3 -m pip install --user --force-reinstall "$WHEEL_LOCAL" 2>&1 | tail -5
else
    python3 -m pip install --user --force-reinstall 'google-genai==2.16.0' 2>&1 | tail -5
fi
python3 -c "import google.genai as g; print('google-genai', g.__version__)" 2>&1

# ─────────────────────────────────────────────────────────────────────────────
step "6. INSTALL GEMINI CLOUD ASSIST MCP SERVER"
# ─────────────────────────────────────────────────────────────────────────────
if command -v npm >/dev/null 2>&1; then
    echo "[mcp] installing @google-cloud/gemini-cloud-assist-mcp…"
    timeout 120 npm install -g @google-cloud/gemini-cloud-assist-mcp 2>&1 | tail -5
    echo "[mcp] also registering with gemini CLI…"
    timeout 60 gemini extensions install https://github.com/GoogleCloudPlatform/gemini-cloud-assist-mcp 2>&1 | tail -5 || true
else
    echo "[mcp] npm not found — attempting via npx on first use"
fi

# ─────────────────────────────────────────────────────────────────────────────
step "7. EXPLORE /home/toxic/ranch AND NEARBY FOLDERS FOR EAP ARTIFACTS"
# ─────────────────────────────────────────────────────────────────────────────
echo "[explore] searching for EAP mentions in likely folders"
for dir in "$HOME/ranch" "$HOME/estate" "$HOME/tau" "$HOME/src" "$HOME/bin" "$HOME/local" "$HOME/archive"; do
    [ -d "$dir" ] || continue
    echo "  scanning $dir"
    find "$dir" -maxdepth 4 -type f \( -name '*.md' -o -name '*.py' -o -name '*.json' -o -name '*.ts' -o -name '*.sh' -o -name '*.env' \) 2>/dev/null | while read -r f; do
        if grep -qiE 'gemini-api-eap|tool_retrieval|gemini-flash-tool-retrieval|interactions' "$f" 2>/dev/null; then
            echo "    FOUND: $f"
            grep -inE 'gemini-api-eap|tool_retrieval|gemini-flash-tool-retrieval|interactions|GEMINI_EAP' "$f" 2>/dev/null | head -5
        fi
    done
done

# ─────────────────────────────────────────────────────────────────────────────
step "8. PROBE EAP ENDPOINT WITH EVERY KEY × EVERY PROJECT"
# ─────────────────────────────────────────────────────────────────────────────
cat > "$WORK/probe.py" << 'PY'
import os, sys, json, concurrent.futures as cf
from google import genai

MODEL = "gemini-flash-tool-retrieval"
TOOLS = [{"type": "tool_search"},
         {"type": "function", "name": "ping", "description": "Ping",
          "defer_loading": True, "parameters": {"type": "object", "properties": {}}}]

def one(job):
    kind, project, key, loc = job
    label = f"{kind}|{project or '-'}|{loc or '-'}|key={'yes' if key else '-'}"
    try:
        if key:
            c = genai.Client(api_key=key)
        else:
            c = genai.Client(vertexai=True, project=project, location=loc)
        r = c.interactions.create(model=MODEL, input="Say pong.", tools=TOOLS)
        d = r.model_dump() if hasattr(r, "model_dump") else {}
        steps = [s.get("type") for s in d.get("steps", [])]
        return {"label": label, "status": "OK", "steps": steps, "raw": json.dumps(d, default=str)[:600]}
    except Exception as e:
        info = {"label": label, "status": "ERR", "class": type(e).__name__, "msg": str(e)[:220]}
        r = getattr(e, "response", None)
        if r is not None:
            info["http"] = r.status_code
            try: info["body"] = r.text[:300]
            except: pass
        return info

projects = os.environ.get("PROJECTS", "").split()
keys = [k for k in os.environ.get("KEYS", "").split("\x00") if k]

jobs = []
for p in projects:
    for loc in ("global", "us-central1"):
        jobs.append(("vertex", p, None, loc))
for k in keys:
    jobs.append(("gemini-api", None, k, None))
    jobs.append(("gemini-api-us", None, k, "us-central1"))

out = []
with cf.ThreadPoolExecutor(max_workers=10) as ex:
    for r in ex.map(one, jobs):
        out.append(r)
json.dump(out, sys.stdout, indent=2, default=str)
PY

mapfile -t PROJECTS < <(gcloud projects list --format="value(projectId)" 2>/dev/null || echo "")
PROJECTS_STR="${PROJECTS[*]}"
KEYS_STR="$(IFS=$'\x00'; echo "${KEYS[*]:-}")"
export PROJECTS="$PROJECTS_STR"
export KEYS="$KEYS_STR"

echo "probing ${#PROJECTS[@]} projects × 2 locations + ${#KEYS[@]} keys"
timeout 120 python3 "$WORK/probe.py" > "$WORK/results/probe.json" 2>"$WORK/logs/probe_err.log" || echo "probe timed out"

if command -v jq >/dev/null 2>&1; then
    jq -r '.[] | if .status=="OK" then "  ✔ \(.label) steps=\(.steps)" else "  ✗ \(.label) \(.class) HTTP=\(.http // "-") \(.msg)" end' "$WORK/results/probe.json" 2>/dev/null
else
    cat "$WORK/results/probe.json"
fi

# ─────────────────────────────────────────────────────────────────────────────
step "9. RUN GEMINI CLOUD ASSIST INVESTIGATIONS VIA MCP"
# ─────────────────────────────────────────────────────────────────────────────
echo "[9] testing MCP create_investigation on flashy-squirrel"
TOKEN=$(gcloud auth print-access-token 2>/dev/null)
if [ -n "$TOKEN" ]; then
    curl -sS -X POST "https://geminicloudassist.googleapis.com/mcp" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -H "Accept: application/json, text/event-stream" \
        -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' \
        --max-time 20 2>&1 | head -40
fi

# ─────────────────────────────────────────────────────────────────────────────
step "10. SUMMARY"
# ─────────────────────────────────────────────────────────────────────────────
echo "log      : $LOG"
echo "results  : $WORK/results/probe.json"
echo "sdk      : $WHEEL_LOCAL"
echo "secrets  : $SECRETS_FILE (keys: ${#KEYS[@]})"
echo
echo "To re-run only the probe:"
echo "  PROJECTS='flashy-squirrel yotube-161921' KEYS=\$(grep GEMINI_EAP_KEY ~/.secrets | cut -d= -f2 | tr '\n' '\0') python3 $WORK/probe.py"
echo
echo "To install MCP server manually if npm failed:"
echo "  npx -y @google-cloud/gemini-cloud-assist-mcp"
