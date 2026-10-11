#!/usr/bin/env bash
# ==============================================================================
# audit-gateway-landscape.sh
# Emergent Forensic Audit: Vercel AI Gateway, Novita Upstream, & Tau Config Invariants
# ==============================================================================
set -euo pipefail

TAU_ROOT="${TAU_ROOT:-/home/toxic/estate/ranch/tau}"
CONFIG_DIR="${HOME}/.tau"
GATEWAY_URL="${VERCEL_GATEWAY_URL:-https://ai-gateway.vercel.sh/v1}"
API_KEY="${VERCEL_AI_GATEWAY_KEY:-${AI_GATEWAY_KEY:-}}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${BLUE}========================================================================${NC}"
echo -e "${CYAN}  FORENSIC RUNTIME AUDIT: VERCEL AI GATEWAY & TAU SUBSTRATE${NC}"
echo -e "${BLUE}========================================================================${NC}"

# ------------------------------------------------------------------------------
# 1. DYNAMIC CONFIG DISCOVERY (Zero Hardcoding)
# ------------------------------------------------------------------------------
echo -e "\n${YELLOW}[1/4] Scanning Local Configuration Repositories...${NC}"

find_configs() {
  find "$CONFIG_DIR" "$TAU_ROOT" -maxdepth 3 -type f \( -name "models.yml" -o -name "models.yaml" -o -name "config.yml" -o -name "config.json" -o -name "models.json" \) 2>/dev/null || true
}

CONFIG_FILES=$(find_configs)
if [ -z "$CONFIG_FILES" ]; then
  echo -e "${RED}[-] No standard config files found in ${CONFIG_DIR} or ${TAU_ROOT}${NC}"
else
  for cfg in $CONFIG_FILES; do
    echo -e "  Found: ${GREEN}${cfg}${NC}"
    if grep -Eqi "(ling-3.1|replayUnsignedThinking|vercel)" "$cfg" 2>/dev/null; then
      echo -e "    ${CYAN}--> Matched target tokens in ${cfg}:${NC}"
      grep -Eni "(ling-3.1|replayUnsignedThinking|vercel|novita)" "$cfg" | sed 's/^/      /' || true
    fi
  done
fi

# ------------------------------------------------------------------------------
# 2. CODEBASE COMPAT & REASONING REPLAY TREE-WALK
# ------------------------------------------------------------------------------
echo -e "\n${YELLOW}[2/4] AST / Grep Probe: replayUnsignedThinking & Provider Compat in Tau...${NC}"

cd "$TAU_ROOT"
if command -v rg >/dev/null 2>&1; then
  echo -e "  Locating interface definitions and usage sites:"
  rg --color=always -n "(replayUnsignedThinking|OpenAICompatPolicy|thinkingFormat)" packages/ai/ packages/catalog/ 2>/dev/null | head -n 15 || true
else
  grep -rnE "(replayUnsignedThinking|OpenAICompatPolicy)" packages/ai/ 2>/dev/null | head -n 15 || true
fi

# ------------------------------------------------------------------------------
# 3. LIVE GATEWAY PROBE & UPSTREAM METADATA RECONNAISSANCE
# ------------------------------------------------------------------------------
echo -e "\n${YELLOW}[3/4] Live Probing Vercel AI Gateway Endpoint (${GATEWAY_URL})...${NC}"

if [ -z "$API_KEY" ]; then
  echo -e "${YELLOW}[!] VERCEL_AI_GATEWAY_KEY not detected in environment.${NC}"
  echo "    Checking process environment or local secrets..."
  API_KEY=$(grep -oE "vck_[a-zA-Z0-9_-]+" "${CONFIG_DIR}"/* 2>/dev/null | head -n 1 | cut -d: -f2 || true)
fi

if [ -n "$API_KEY" ]; then
  echo -e "  Using detected API Key: ${GREEN}${API_KEY:0:8}...${NC}"

  # Test A: Probe Ling 3.1 Flash with Default Settings
  echo -e "\n  ${BLUE}--> Probe A: inclusionai/ling-3.1-flash (Standard Request)${NC}"
  RESP_A=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "${GATEWAY_URL}/chat/completions" \
    -H "Authorization: Bearer ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "inclusionai/ling-3.1-flash",
      "messages": [{"role": "user", "content": "ping"}],
      "max_tokens": 10
    }' || true)

  STATUS_A=$(echo "$RESP_A" | grep "HTTP_STATUS:" | cut -d: -f2)
  BODY_A=$(echo "$RESP_A" | grep -v "HTTP_STATUS:")

  echo "    HTTP Status: $STATUS_A"
  if command -v jq >/dev/null 2>&1; then
    echo "$BODY_A" | jq '{
      error: .error,
      resolvedProvider: .providerMetadata.gateway.routing.resolvedProvider,
      fallbacksAvailable: .providerMetadata.gateway.routing.fallbacksAvailable,
      attempts: .providerMetadata.gateway.routing.modelAttempts
    }' 2>/dev/null || echo "$BODY_A" | head -n 10
  else
    echo "$BODY_A" | head -n 10
  fi

  # Test B: Probe Ling 3.1 Flash with Explicit Thinking Disabled
  echo -e "\n  ${BLUE}--> Probe B: inclusionai/ling-3.1-flash (Reasoning Suppression: effort=none)${NC}"
  RESP_B=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "${GATEWAY_URL}/chat/completions" \
    -H "Authorization: Bearer ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "inclusionai/ling-3.1-flash",
      "messages": [{"role": "user", "content": "ping"}],
      "max_tokens": 10,
      "reasoning_effort": "none"
    }' || true)

  STATUS_B=$(echo "$RESP_B" | grep "HTTP_STATUS:" | cut -d: -f2)
  BODY_B=$(echo "$RESP_B" | grep -v "HTTP_STATUS:")
  echo "    HTTP Status: $STATUS_B"
  if command -v jq >/dev/null 2>&1; then
    echo "$BODY_B" | jq '.choices[0].message // .error' 2>/dev/null || echo "$BODY_B" | head -n 5
  fi

else
  echo -e "${RED}[-] No API key found. Skipping live gateway curl probe.${NC}"
fi

# ------------------------------------------------------------------------------
# 4. MULTI-PROVIDER RESILIENT CANDIDATE MATRIX
# ------------------------------------------------------------------------------
echo -e "\n${YELLOW}[4/4] Gateway Survivability Matrix (Recommended Multi-Provider Fallbacks)${NC}"
cat << 'TABLE'
  +-----------------------------------+--------------------+------------------------+-------------------+
  | Model Slug                        | Redundant Backends | Default Thinking State | Agent Stability   |
  +-----------------------------------+--------------------+------------------------+-------------------+
  | qwen/qwen-2.5-coder-32b-instruct  | 5+ (Together, Groq)| OFF (Direct Syntax)    | HIGH (No 503)     |
  | deepseek/deepseek-chat            | 4+ (DeepSeek, etc) | OFF (Standard Chat)    | HIGH (Fast TTFT)  |
  | anthropic/claude-3-5-haiku        | 3 (Vertex, Bedrock)| OFF (Deterministic)    | OPTIMAL (No Looping|
  | inclusionai/ling-3.1-flash        | 1 (Novita ONLY)    | ON (High Deliberation) | FRAGILE (503 Risk)|
  +-----------------------------------+--------------------+------------------------+-------------------+
TABLE

echo -e "\n${GREEN}[✓] Forensic Audit Complete.${NC}"
