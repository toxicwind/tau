#!/usr/bin/env bash
set -uo pipefail
TAU="$HOME/estate/ranch/tau"
CA="$TAU/packages/coding-agent"
TOOLS="$CA/src/tools"
BIN="$(command -v tau || echo "$HOME/.local/bin/tau")"

hr(){ printf '\n═══ %s ═══\n' "$*"; }
say(){ printf '  %-8s %s\n' "$1" "$2"; }

hr "A. SOURCE — browser-surface-macro.ts"
echo "  path: $TOOLS/browser/browser-surface-macro.ts"
echo "  lines: $(wc -l < "$TOOLS/browser/browser-surface-macro.ts" 2>/dev/null)"
echo "  imports from ./surface/ :"
grep -nE '^\s*import\s+\w+\s+from\s+"\./surface/' "$TOOLS/browser/browser-surface-macro.ts" 2>/dev/null | sed 's|^|      |'
echo "  fs walker sites (should be 0):"
grep -nE 'readdirSync|readFileSync|SURFACE_DIR' "$TOOLS/browser/browser-surface-macro.ts" 2>/dev/null | sed 's|^|      |' || echo "      (none)"

hr "B. SOURCE — prelude-definition.ts (browser + computer)"
for f in browser/prelude-definition.ts computer/prelude-definition.ts; do
  echo "  $f"
  grep -nE 'import .*with \{ type: "text" \}|from "node:fs"|from "node:path"' "$TOOLS/$f" 2>/dev/null | sed 's|^|      |'
done

hr "C. SOURCE — every remaining import.meta.dir FS read in src/tools/"
grep -rnE 'readFileSync\(.*import\.meta\.dir|readdirSync\(.*import\.meta\.dir|SURFACE_DIR' "$TOOLS" 2>/dev/null | grep -vE '\.bak\.' | sed "s|$TOOLS/||" | sed 's|^|      |' || echo "      (none)"

hr "D. SOURCE — assets[] in compile-binary.ts"
if grep -q 'assets: \[' "$CA/scripts/compile-binary.ts"; then
  echo "  present:"
  sed -n '/assets: \[/,/\],/p' "$CA/scripts/compile-binary.ts" | sed 's|^|      |'
else
  say MISS "no assets[] in compile-binary.ts"
fi

hr "E. BINARY — actual on-disk tau"
if [ -x "$BIN" ]; then
  say OK "found: $BIN"
  ls -la "$BIN" | sed 's|^|      |'
  file "$BIN" | sed 's|^|      |'
  say INFO "size: $(du -h "$BIN" | cut -f1)"
else
  say FAIL "$BIN not found"
fi

hr "F. BINARY — is the old surface walker still embedded?"
if strings "$BIN" 2>/dev/null | grep -qE 'readdirSync.*SURFACE_DIR|SURFACE_DIR.*readdirSync'; then
  say FAIL "old SURFACE_DIR readdirSync present in binary"
else
  say OK "no SURFACE_DIR readdirSync in binary strings"
fi
echo "  occurrences of the string 'surface/' in binary:"
strings "$BIN" 2>/dev/null | grep -c '/surface/' | sed 's|^|      |'
echo "  occurrences of 'element.json'/'frame.json'/'tab.json':"
for n in element.json frame.json tab.json; do
  c=$(strings "$BIN" 2>/dev/null | grep -c "$n" || echo 0)
  echo "      $n: $c"
done

hr "G. RUNTIME — tau --version (proves the binary executes at all)"
timeout 15 tau --version 2>&1 | head -5 | sed 's|^|      |' || echo "      (nonzero)"

hr "H. RUNTIME — tau -p WITH extensions disabled (isolates the prelude chain)"
S="/tmp/tau_ro_$RANDOM.log"
if timeout 60 tau --no-extensions -p "reply with only: ok" > "$S" 2>&1; then
  say OK "exit 0"
else
  say FAIL "nonzero exit"
fi
echo "  --- full output (no truncation) ---"
cat "$S" | sed 's|^|      |'
echo "  --- end ---"

hr "I. RUNTIME — tau -p WITH extensions (baseline for comparison)"
S2="/tmp/tau_ro_ext_$RANDOM.log"
if timeout 60 tau -p "reply with only: ok" > "$S2" 2>&1; then
  say OK "exit 0"
else
  say FAIL "nonzero exit"
fi
echo "  --- full output (no truncation) ---"
cat "$S2" | sed 's|^|      |'
echo "  --- end ---"

hr "DONE"
echo "  logs:"
echo "    no-ext: $S"
echo "    ext:    $S2"
