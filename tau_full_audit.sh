#!/usr/bin/env bash
set -u
TAU="$HOME/estate/ranch/tau"
TOOLS="$TAU/packages/coding-agent/src/tools"
BIN="$(command -v tau || echo "$HOME/.local/bin/tau")"
OUT="$HOME/.tau_fix/audit/full_$(date +%Y%m%d_%H%M%S).log"
mkdir -p "$(dirname "$OUT")"

row(){ printf '%-10s %-55s %s\n' "$1" "$2" "$3"; }

{
echo "════════════════════════════════════════════════════════════════════"
echo "  FULL AUDIT  $(date -u +%FT%TZ)"
echo "════════════════════════════════════════════════════════════════════"

echo; echo "── 1. IMPORTS (every consumer, no filtering) ──"
check(){
  local f="$TOOLS/$1" sym="$2" present="MISSING"
  [ ! -f "$f" ] && { row "NOFILE" "$1" "want { $sym }"; return; }
  grep -qE "import[^;]*\{[^}]*\b$sym\b[^}]*\}[^;]*from" "$f" && present="present"
  # does the file USE the symbol at all?
  local used="no"
  grep -qE "\b$sym\s*\(" "$f" && used="yes"
  row "$present" "$1" "want { $sym }  uses=$used"
}
check browser/launch.ts                    join
check browser/launch.ts                    resolve
check browser/aria/aria-snapshot.ts        resolve
check browser/aria/aria-snapshot.ts        readFileSync
check browser/attach.ts                    join
check browser/downloads.ts                 join
check browser/tab-worker.ts                join
check browser/tab-supervisor.ts            join
check browser/cmux/socket-client.ts        join
check bash-skill-urls.ts                   resolve
check computer/supervisor.ts               resolve
check computer/worker.ts                   resolve
check computer/hyprland.ts                 resolve
check browser/prelude-definition.ts        readFileSync
check computer/prelude-definition.ts       readFileSync

echo; echo "── 2. TYPOS ──"
for typo in declTextaration  declataion  funtcion  improt  exprot; do
  hits=$(grep -rl "$typo" "$TOOLS" 2>/dev/null || true)
  if [ -n "$hits" ]; then
    row "FOUND" "typo: $typo" "$(printf '%s' "$hits" | wc -l) files"
    printf '%s\n' "$hits" | sed 's|^|           |'
  else
    row "clean" "typo: $typo" "-"
  fi
done

echo; echo "── 3. EXTENSIONS (all locations) ──"
for p in \
  "$HOME/.tau/plugins/node_modules/@cakriwut/omp-model-router/src" \
  "$HOME/.tau/plugins" \
  "$HOME/estate/work" \
  "$HOME/estate/work/tau-extension" \
  "$HOME/estate/plugins"; do
  if [ -d "$p" ]; then
    row "found" "$p" "exists"
    bad=$(grep -rnE 'from ["'"'"']tau["'"'"']' "$p" 2>/dev/null | head -20 || true)
    [ -n "$bad" ] && printf '%s\n' "$bad" | sed 's|^|           |'
  else
    row "absent" "$p" "-"
  fi
done
# where does tau actually load extensions from?
echo "  tau plugin dirs:"
for d in "$HOME/.tau/plugins" "$HOME/.tau/plugins/node_modules"; do
  [ -d "$d" ] && find "$d" -maxdepth 3 -name 'package.json' 2>/dev/null | sed 's|^|    |'
done

echo; echo "── 4. .js FILES UNDER src/ (unfiltered) ──"
find "$TAU/packages/coding-agent/src" -type f -name '*.js' 2>/dev/null \
  | while IFS= read -r f; do
    size=$(stat -c %s "$f")
    head=$(head -c 120 "$f" | tr -d '\n' | head -c 100)
    row "js" "${f#$TAU/packages/coding-agent/src/}" "${size}b  ${head}"
  done

echo; echo "── 5. BINARY vs SOURCE ──"
if [ -x "$BIN" ]; then
  bm=$(stat -c %Y "$BIN")
  echo "  binary:  $(date -d @$bm -u +%FT%TZ)  $BIN"
  echo "  newest 5 modified under src/:"
  find "$TAU/packages/coding-agent/src" -type f -printf '%T@ %TY-%Tm-%TdT%TH:%TM:%TS %p\n' 2>/dev/null \
    | sort -rn | head -5 | sed 's|^|    |'
fi

echo; echo "── 6. trusted-local REFERENCES (all, unfiltered) ──"
# use while-read so paths with spaces work
find "$HOME/.config" "$HOME/.tau" "$HOME/estate" -type f \
  \( -name '*.json' -o -name '*.jsonc' -o -name '*.toml' -o -name '*.yaml' -o -name '*.yml' -o -name '*.env' \) \
  -not -path '*/node_modules/*' -not -path '*/logs/*' -not -path '*/.git/*' \
  2>/dev/null | while IFS= read -r f; do
    if grep -q 'trusted-local' "$f" 2>/dev/null; then
      echo "  $f"
      grep -n -B1 -A3 'trusted-local' "$f" | sed 's|^|      |'
    fi
  done

echo; echo "── 7. ENV VARS (trusted-local, MCP, tau) ──"
env | grep -iE 'trusted|mcp|tau_|pi_' | sed 's|^|  |' || echo "  (none)"

echo; echo "── 8. SHELL INIT REFERENCES ──"
for f in ~/.bashrc ~/.bashrc.env ~/.bashrc.local ~/.profile; do
  [ -f "$f" ] && {
    hit=$(grep -n 'trusted-local\|mcp' "$f" 2>/dev/null || true)
    [ -n "$hit" ] && { echo "  $f:"; printf '%s\n' "$hit" | sed 's|^|      |'; }
  }
done

echo
echo "════════════════════════════════════════════════════════════════════"
echo "  END"
echo "════════════════════════════════════════════════════════════════════"
} 2>&1 | tee "$OUT"
echo
echo "saved: $OUT"
