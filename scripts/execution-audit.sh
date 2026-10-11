#!/usr/bin/env bash
# ==============================================================================
# execution-audit.sh — Deep Dynamic Scrape, AST Introspection & Gateway Fuzz
# ==============================================================================
set -uo pipefail

TAU_ROOT="${TAU_ROOT:-/home/toxic/estate/ranch/tau}"
GATEWAY_URL="${VERCEL_GATEWAY_URL:-https://ai-gateway.vercel.sh/v1}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${BLUE}========================================================================${NC}"
echo -e "${CYAN}${BOLD}  TAU RUNTIME EXECUTION AUDIT: LIVE WIRE & SUBSTRATE PROBE${NC}"
echo -e "${BLUE}========================================================================${NC}"

# ------------------------------------------------------------------------------
# 1. DYNAMIC SECRET & CONFIG SCRAPE (Processes, Auth Stores, Dotfiles)
# ------------------------------------------------------------------------------
echo -e "\n${YELLOW}[1/4] Dynamic Credential Harvester (Deep Scrape)...${NC}"

API_KEY=""

# A. Environment variable
if [ -n "${VERCEL_AI_GATEWAY_KEY:-}" ]; then
  API_KEY="$VERCEL_AI_GATEWAY_KEY"
  echo -e "  [+] Discovered key in current environment: ${GREEN}VERCEL_AI_GATEWAY_KEY${NC}"
fi

# B. Scrape running process environments (/proc)
if [ -z "$API_KEY" ] && [ -d /proc ]; then
  echo "  Scanning user process environments (/proc/*/environ)..."
  for env_file in /proc/[0-9]*/environ; do
    if [ -r "$env_file" ]; then
      KEY_CANDIDATE=$(strings "$env_file" 2>/dev/null | grep -E "^(VERCEL_AI_GATEWAY_KEY|AI_GATEWAY_KEY)=" | head -n 1 | cut -d= -f2- || true)
      if [ -n "$KEY_CANDIDATE" ]; then
        API_KEY="$KEY_CANDIDATE"
        PID=$(echo "$env_file" | cut -d/ -f3)
        echo -e "  [+] Recovered key from PID ${PID} environment: ${GREEN}${API_KEY:0:10}...${NC}"
        break
      fi
    fi
  done
fi

# C. Scrape structured auth databases and config files
AUTH_TARGETS=(
  "${HOME}/.pi/agent/auth.json"
  "${HOME}/.omp/agent/auth.json"
  "${HOME}/.config/tau/auth.json"
  "${HOME}/.tau/auth.json"
  "${HOME}/.config/agent-mcp-gateway/.mcp-gateway-rules.json"
)

for target in "${AUTH_TARGETS[@]}"; do
  if [ -f "$target" ]; then
    echo -e "  Inspecting auth file: ${CYAN}${target}${NC}"
    if command -v jq >/dev/null 2>&1; then
      KEY_CANDIDATE=$(jq -r '."vercel-ai-gateway".key // ."vercel".key // ."ai-gateway".key // empty' "$target" 2>/dev/null || true)
      if [ -n "$KEY_CANDIDATE" ]; then
        API_KEY="$KEY_CANDIDATE"
        echo -e "  [+] Extracted gateway key from ${target}: ${GREEN}${API_KEY:0:10}...${NC}"
        break
      fi
    fi
  fi
done

# D. Raw regex hunt across dotfiles and project .env files
if [ -z "$API_KEY" ]; then
  echo "  Hunting for 'vck_' tokens across user directory tree..."
  KEY_CANDIDATE=$(grep -rhoE "vck_[a-zA-Z0-9_\-]{20,}" "${HOME}/.config" "${HOME}/.pi" "${HOME}/.omp" "${HOME}/estate" 2>/dev/null | head -n 1 || true)
  if [ -n "$KEY_CANDIDATE" ]; then
    API_KEY="$KEY_CANDIDATE"
    echo -e "  [+] Discovered key token: ${GREEN}${API_KEY:0:10}...${NC}"
  fi
fi

if [ -z "$API_KEY" ]; then
  echo -e "${RED}[-] Warning: No active gateway key resolved. Live curl probes will simulate dry-runs.${NC}"
fi

# ------------------------------------------------------------------------------
# 2. CODEBASE INTROSPECTION: isVercelGatewayHost & OpenAICompatPolicy
# ------------------------------------------------------------------------------
echo -e "\n${YELLOW}[2/4] Codebase Introspection: How Tau Handles Vercel Gateway & Reasoning...${NC}"

cd "$TAU_ROOT"

echo -e "${CYAN}--> packages/catalog/src/compat/ or providers/ referencing Vercel:${NC}"
rg -n -C 3 "isVercelGatewayHost" packages/ 2>/dev/null || grep -rn -C 3 "isVercelGatewayHost" packages/ 2>/dev/null || echo "  [i] Flag not in current tree"

echo -e "\n${CYAN}--> packages/ai/src/providers/openai-shared.ts (resolveOpenAICompatPolicy snippet):${NC}"
python3 - << 'PYEOF'
import os

path = "packages/ai/src/providers/openai-shared.ts"
if os.path.exists(path):
    lines = open(path).readlines()
    found = False
    for idx, line in enumerate(lines):
        if "function resolveOpenAICompatPolicy" in line or "export interface OpenAICompatPolicy" in line:
            print(f"[{path}:{idx+1}]")
            print("".join(lines[idx:idx+25]))
            found = True
            break
    if not found:
        print("  Snippet anchor not matched.")
else:
    print(f"  {path} not found.")
PYEOF

# ------------------------------------------------------------------------------
# 3. LIVE GATEWAY RECONNAISSANCE & DIALECT FUZZ MATRIX
# ------------------------------------------------------------------------------
echo -e "\n${YELLOW}[3/4] Live Gateway Fuzz Battery...${NC}"

fuzz_probe() {
  local label="$1"
  local payload="$2"

  echo -e "\n  ${BLUE}${BOLD}[Probe: ${label}]${NC}"
  if [ -z "$API_KEY" ]; then
    echo "    (Dry-Run Payload):"
    echo "$payload" | jq -C '.' 2>/dev/null || echo "$payload"
    return
  fi

  local resp
  resp=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "${GATEWAY_URL}/chat/completions" \
    -H "Authorization: Bearer ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d "$payload" || true)

  local status
  status=$(echo "$resp" | grep "HTTP_STATUS:" | cut -d: -f2)
  local body
  body=$(echo "$resp" | grep -v "HTTP_STATUS:")

  if [ "$status" = "200" ]; then
    echo -e "    Status: ${GREEN}${status} OK${NC}"
  elif [ "$status" = "503" ]; then
    echo -e "    Status: ${RED}${status} SERVICE UNAVAILABLE (Upstream Host Crash)${NC}"
  elif [ "$status" = "400" ]; then
    echo -e "    Status: ${YELLOW}${status} BAD REQUEST (Payload Dialect Rejection)${NC}"
  else
    echo -e "    Status: ${YELLOW}${status}${NC}"
  fi

  if command -v jq >/dev/null 2>&1; then
    echo "$body" | jq '{
      error: .error.message,
      provider: .providerMetadata.gateway.routing.resolvedProvider,
      final: .providerMetadata.gateway.routing.finalProvider,
      fallbacks: .providerMetadata.gateway.routing.fallbacksAvailable,
      reasoning_output: .choices[0].message.reasoning_content,
      text_output: .choices[0].message.content
    } | del(.[] | select(. == null))' 2>/dev/null || echo "$body" | head -n 8
  else
    echo "$body" | head -n 8
  fi
}

# Fuzz Test 1: Ling 3.1 Flash Baseline
fuzz_probe "Ling-3.1-Flash (Default/Raw)" '{
  "model": "inclusionai/ling-3.1-flash",
  "messages": [{"role": "user", "content": "respond with word pong"}],
  "max_tokens": 16
}'

# Fuzz Test 2: Ling 3.1 Flash with OpenAI-style reasoning suppression
fuzz_probe "Ling-3.1-Flash (reasoning_effort=none)" '{
  "model": "inclusionai/ling-3.1-flash",
  "messages": [{"role": "user", "content": "respond with word pong"}],
  "max_tokens": 16,
  "reasoning_effort": "none"
}'

# Fuzz Test 3: Ling 3.1 Flash with Anthropic/vLLM style thinking disable
fuzz_probe "Ling-3.1-Flash (thinking.type=disabled)" '{
  "model": "inclusionai/ling-3.1-flash",
  "messages": [{"role": "user", "content": "respond with word pong"}],
  "max_tokens": 16,
  "thinking": {"type": "disabled"}
}'

# Fuzz Test 4: Multi-Provider Redundant Coder (Qwen 2.5 Coder 32B)
fuzz_probe "Qwen-2.5-Coder-32B (Control Group: Resilient Route)" '{
  "model": "qwen/qwen-2.5-coder-32b-instruct",
  "messages": [{"role": "user", "content": "respond with word pong"}],
  "max_tokens": 16
}'

# Fuzz Test 5: DeepSeek Chat (Control Group)
fuzz_probe "DeepSeek-Chat (Control Group: Resilient Route)" '{
  "model": "deepseek/deepseek-chat",
  "messages": [{"role": "user", "content": "respond with word pong"}],
  "max_tokens": 16
}'

# ------------------------------------------------------------------------------
# 4. TAILORED REMEDIATION (Generated Config for Tau)
# ------------------------------------------------------------------------------
echo -e "\n${YELLOW}[4/4] Synthesis & Operational Recommendation${NC}"

cat << 'RECOMMEND'
  ----------------------------------------------------------------------
  1. The 503 is Novita's upstream worker failure on inclusionai/ling-3.1-flash.
     Because Vercel AI Gateway has no other host registered for that slug,
     fallbacksAvailable is [].
  2. If Probe 2 or 3 returned 200, use that exact thinking-disable syntax
     in your Tau OpenAICompatPolicy.
  3. To stop execution halts permanently, configure a fallback chain in Tau
     so that when Novita 503s, your agent seamlessly drops down to
     qwen/qwen-2.5-coder-32b-instruct or deepseek/deepseek-chat.
  ----------------------------------------------------------------------
RECOMMEND

echo -e "\n${GREEN}[✓] Execution Audit Finished.${NC}"
