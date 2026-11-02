#!/usr/bin/env bash
set -uo pipefail
TAU="$HOME/estate/ranch/tau"
CA="$TAU/packages/coding-agent"
TOOLS="$CA/src/tools"
BIN="$HOME/.local/bin/tau"
STAMP=$(date +%Y%m%d_%H%M%S)
say(){ printf '  %-6s %s\n' "$1" "$2"; }

echo "── 1. CONFIRM macro source is the rewritten static version ──"
if grep -q 'import elementManifest from "./surface/element.json"' "$TOOLS/browser/browser-surface-macro.ts"; then
  say OK "macro uses static JSON imports"
else
  say FAIL "macro still has readdirSync — rewrite lost"
  exit 1
fi
grep -cE 'readdirSync|readFileSync' "$TOOLS/browser/browser-surface-macro.ts" | \
  xargs -I{} sh -c 'test {} -eq 0 && echo "  OK      no fs walkers" || echo "  FAIL    {} fs walkers remain"'

echo "── 2. NUKE BUILD CACHE + dist/tau ──"
rm -rf "$CA/node_modules/.cache" "$TAU/node_modules/.cache" 2>/dev/null
rm -f "$CA/dist/tau" "$TAU/dist/tau" 2>/dev/null
say OK "cleared .cache and dist/tau"

echo "── 3. FIX compile-binary.ts path check (in case of future audit) ──"
# verify assets[] block is well-formed before rebuilding
if grep -q 'assets: \[' "$CA/scripts/compile-binary.ts"; then
  say OK "assets[] present"
else
  say WARN "assets[] missing — will rely on static imports alone"
fi

echo "── 4. REBUILD (full) ──"
[ -x "$BIN" ] && cp "$BIN" "$BIN.bak.$STAMP"
cd "$TAU" || exit 1
bun run build 2>&1 | tail -30
for c in "$CA/dist/tau" "$TAU/dist/tau" "$TAU/bin/tau"; do
  [ -f "$c" ] && { cp "$c" "$BIN.new" && mv "$BIN.new" "$BIN" && chmod +x "$BIN"; say OK "installed $c"; break; }
done

echo "── 5. PROVE the compiled binary no longer walks surface/ ──"
# grep the binary itself for the string that indicates the walker is gone
if strings "$BIN" | grep -q 'readdirSync.*SURFACE_DIR'; then
  say FAIL "binary still contains SURFACE_DIR readdirSync — rewrite didn't embed"
elif strings "$BIN" | grep -qE '^\s*return readdirSync7'; then
  say FAIL "binary contains old macro"
else
  say OK "binary no longer references SURFACE_DIR walker"
fi

echo "── 6. SMOKE ──"
S="/tmp/tau_smoke_clean_$STAMP.log"
if timeout 90 tau -p "reply with only: ok" > "$S" 2>&1; then
  if grep -qiE '(^|\s)ok(\s|$)' "$S"; then
    say OK "SMOKE OK"
  else
    say WARN "ran, no 'ok'"
    tail -15 "$S" | sed 's|^|        |'
  fi
else
  say FAIL "nonzero"
  tail -25 "$S" | sed 's|^|        |'
fi
echo
echo "  smoke:  $S"
echo "  binary: $BIN  (backup $BIN.bak.$STAMP)"
