#!/usr/bin/env bash
set -uo pipefail

echo "=== FIX nim-token-scan issues on home toxic ==="

echo ""
echo "--- 1. Clean plaintext token lines from ~/.bash_history ---"
if [ -f ~/.bash_history ]; then
  before=$(wc -l < ~/.bash_history)
  # Remove lines containing nvapi-, nvcf-, or bak- tokens
  grep -vE 'nvapi-|nvcf-|bak-' ~/.bash_history > ~/.bash_history.clean 2>/dev/null || true
  mv ~/.bash_history.clean ~/.bash_history
  chmod 600 ~/.bash_history
  after=$(wc -l < ~/.bash_history)
  echo "bash_history: $before -> $after lines (token lines removed)"
else
  echo "No ~/.bash_history found"
fi

echo ""
echo "--- 2. Check kilo config for literal tokens ---"
KILO_CFG="${XDG_CONFIG_HOME:-$HOME/.config}/kilo/config.json"
if [ -f "$KILO_CFG" ]; then
  echo "kilo config exists at $KILO_CFG"
  # Check if it contains literal nvapi- or bak- tokens
  if grep -qE 'nvapi-|bak-' "$KILO_CFG" 2>/dev/null; then
    echo "WARNING: kilo config contains literal tokens - this is expected (kilo merge stores API key)"
    echo "Consider sourcing NGC_API_KEY from environment instead of hardcoding"
  else
    echo "kilo config: no literal tokens found"
  fi
else
  echo "No kilo config found yet (will be created on first nim-kilo run)"
fi

echo ""
echo "--- 3. Verify NVCF_API_KEY is active in environment ---"
bash -ic 'echo "NVCF_API_KEY set: $([ -n "${NVCF_API_KEY}" ] && echo YES || echo NO)"; echo "NGC_API_KEY set: $([ -n "${NGC_API_KEY}" ] && echo YES || echo NO)"' 2>&1 | grep -E "set:"

echo ""
echo "--- 4. Run nim-token-scan to confirm clean ==="
bash -ic "nim-token-scan" 2>&1 | grep -v "omnibus loaded\|kilo providers synced\|cannot set terminal\|no job control\|stty" | sed -n "1,10p"

echo ""
echo "FIX-DONE"

