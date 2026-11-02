#!/usr/bin/env bash
# tau_audit.sh — read-only health audit. No mutations. Persists to disk.
set -u
export HOME="${HOME:-/home/toxic}"
STAMP="$(date +%Y%m%d_%H%M%S)"
OUT="$HOME/.tau_fix/audit/tau_audit_${STAMP}.log"
mkdir -p "$(dirname "$OUT")"

TAU="$HOME/estate/ranch/tau"
BIN="$(command -v tau || echo "$HOME/.local/bin/tau")"
EXT="$HOME/.tau/plugins/node_modules/@cakriwut/omp-model-router"

pass(){ printf '  [PASS] %s\n' "$*"; }
fail(){ printf '  [FAIL] %s\n' "$*"; }
warn(){ printf '  [WARN] %s\n' "$*"; }
info(){ printf '  [info] %s\n' "$*"; }

{
printf '════════════════════════════════════════════════════════════════════════\n'
printf '  TAU AUDIT  %s\n' "$STAMP"
printf '  target:   %s\n' "$TAU"
printf '  binary:   %s\n' "$BIN"
printf '  output:   %s\n' "$OUT"
printf '════════════════════════════════════════════════════════════════════════\n\n'

# ── 1. TOOLCHAIN ────────────────────────────────────────────────────────
printf '─── 1. TOOLCHAIN ───\n'
for t in bun jq ffs; do
  if command -v "$t" >/dev/null 2>&1; then
    v=$("$t" --version 2>/dev/null | head -1)
    pass "$t present  ($v)"
  else
    fail "$t MISSING"
  fi
done
printf '\n'

# ── 2. TAU SOURCE INTEGRITY ─────────────────────────────────────────────
printf '─── 2. TAU SOURCE INTEGRITY ───\n'
cd "$TAU" 2>/dev/null || { fail "cannot cd $TAU"; }

check_import() {
  local f="$1" symbol="$2"
  if [ ! -f "$f" ]; then fail "missing file: $f"; return; fi
  if grep -qE "import[^;]*\{[^}]*\b${symbol}\b[^}]*\}[^;]*from" "$f"; then
    pass "import { $symbol } present: $f"
  else
    fail "import { $symbol } MISSING: $f"
  fi
}

printf '  browser/launch.ts:\n'
check_import "$TAU/packages/coding-agent/src/tools/browser/launch.ts" join
check_import "$TAU/packages/coding-agent/src/tools/browser/launch.ts" resolve

printf '  browser/aria/aria-snapshot.ts:\n'
check_import "$TAU/packages/coding-agent/src/tools/browser/aria/aria-snapshot.ts" resolve
check_import "$TAU/packages/coding-agent/src/tools/browser/aria/aria-snapshot.ts" readFileSync

printf '  browser/prelude-definition.ts:\n'
for f in \
  "$TAU/packages/coding-agent/src/tools/browser/prelude-definition.ts" \
  "$TAU/packages/coding-agent/src/tools/computer/prelude-definition.ts"; do
  if [ -f "$f" ]; then
    grep -q 'readFileSync' "$f" && pass "readFileSync present: $f" || fail "readFileSync MISSING: $f"
  else
    fail "missing file: $f"
  fi
done

printf '  other { join } consumers:\n'
for f in \
  browser/attach.ts browser/downloads.ts browser/tab-worker.ts \
  browser/tab-supervisor.ts browser/cmux/socket-client.ts; do
  check_import "$TAU/packages/coding-agent/src/tools/$f" join
done

printf '  other { resolve } consumers:\n'
for f in bash-skill-urls.ts computer/supervisor.ts computer/worker.ts computer/hyprland.ts; do
  check_import "$TAU/packages/coding-agent/src/tools/$f" resolve
done

printf '  guest templates must NOT import node builtins:\n'
for f in browser/prelude.js browser/prelude.py; do
  full="$TAU/packages/coding-agent/src/tools/$f"
  [ ! -f "$full" ] && { warn "missing: $f"; continue; }
  if grep -qE 'from "node:(fs|path|os)"' "$full"; then
    fail "node import in guest asset: $f"
  else
    pass "clean guest asset: $f"
  fi
done

printf '  declaration files must NOT contain fake default export:\n'
for f in browser/declarations.d.ts computer/declarations.d.ts; do
  full="$TAU/packages/coding-agent/src/tools/$f"
  [ ! -f "$full" ] && { warn "missing: $f"; continue; }
  if grep -qE '^\s*export default declarations;' "$full"; then
    fail "fake default export present: $f"
  else
    pass "no fake default export: $f"
  fi
done

printf '  typo sweep (declTextaration):\n'
hits=$(grep -rl 'declTextaration' "$TAU/packages/coding-agent/src/tools" 2>/dev/null || true)
if [ -z "$hits" ]; then pass "no declTextaration typos"; else
  fail "typo present in:"; printf '%s\n' "$hits" | sed 's/^/        /'
fi

printf '  stale .js shadows next to .ts sources:\n'
shadows=$(find "$TAU/packages/coding-agent/src" -type f -name '*.js' \
  -not -path '*/node_modules/*' 2>/dev/null | head -20 || true)
if [ -z "$shadows" ]; then pass "no stray .js in src/"; else
  warn "unexpected .js files:"; printf '%s\n' "$shadows" | sed 's/^/        /'
fi
printf '\n'

# ── 3. BINARY vs SOURCE ─────────────────────────────────────────────────
printf '─── 3. BINARY vs SOURCE STALENESS ───\n'
if [ -x "$BIN" ]; then
  bin_m=$(stat -c %Y "$BIN" 2>/dev/null || echo 0)
  bin_h=$(date -d "@$bin_m" -u +%FT%TZ 2>/dev/null || echo "?")
  info "binary mtime: $bin_h  ($BIN)"
  newest=$(find "$TAU/packages/coding-agent/src" -type f \
    \( -name '*.ts' -o -name '*.js' \) -printf '%T@ %p\n' 2>/dev/null \
    | sort -rn | head -1)
  if [ -n "$newest" ]; then
    nsrc_m="${newest%% *}"
    nsrc_p="${newest#* }"
    nsrc_h=$(date -d "@${nsrc_m%.*}" -u +%FT%TZ 2>/dev/null || echo "?")
    info "newest src : $nsrc_h  ($nsrc_p)"
    if [ "${nsrc_m%.*}" -gt "$bin_m" ]; then
      fail "source NEWER than binary → rebuild required"
    else
      pass "binary is newer than or equal to source"
    fi
  else
    warn "no source files found under $TAU/packages/coding-agent/src"
  fi
else
  fail "tau binary not found at $BIN"
fi
printf '\n'

# ── 4. EXTENSION IMPORT SWEEP ───────────────────────────────────────────
printf '─── 4. EXTENSION: @cakriwut/omp-model-router ───\n'
if [ -d "$EXT" ]; then
  info "extension present: $EXT"
  bad=$(grep -rnE 'from ["'"'"']tau["'"'"']' "$EXT/src" 2>/dev/null || true)
  if [ -z "$bad" ]; then
    pass "no bare 'tau' imports"
  else
    fail "bare 'tau' imports found:"
    printf '%s\n' "$bad" | sed 's/^/        /'
    printf '        → rewrite to @tau/tau-utils or @tau/tau-tui, or disable plugin\n'
  fi
else
  warn "extension not found at $EXT (already disabled or never installed)"
fi
printf '\n'

# ── 5. MCP CONFIG: trusted-local ────────────────────────────────────────
printf '─── 5. MCP CONFIG: trusted-local ───\n'
conf_hits=$(grep -rl 'trusted-local' \
  "$HOME/.config" "$HOME/.tau" "$HOME/estate" 2>/dev/null | head -10 || true)
if [ -z "$conf_hits" ]; then
  warn "no 'trusted-local' reference found in ~/.config, ~/.tau, ~/estate"
else
  pass "trusted-local declared in:"
  printf '%s\n' "$conf_hits" | sed 's/^/        /'
  for cf in $conf_hits; do
    printf '        %s:\n' "$cf"
    grep -n -A3 -B1 'trusted-local' "$cf" | sed 's/^/          /'
  done
  port=$(grep -rhoE 'https?://[^"'"'"' ]*:([0-9]{2,5})' $conf_hits 2>/dev/null \
    | grep -oE ':[0-9]{2,5}$' | tr -d ':' | sort -u | head -3 || true)
  if [ -n "$port" ]; then
    info "candidate ports referenced: $(echo $port | tr '\n' ' ')"
    for p in $port; do
      hit=$(ss -ltnp 2>/dev/null | grep ":$p " || true)
      if [ -z "$hit" ]; then
        warn "nothing listening on :$p"
      else
        fail "port :$p occupied by:"
        printf '          %s\n' "$hit"
      fi
    done
  fi
fi
printf '\n'

# ── 6. SUMMARY ──────────────────────────────────────────────────────────
printf '════════════════════════════════════════════════════════════════════════\n'
printf '  AUDIT COMPLETE\n'
printf '  full log: %s\n' "$OUT"
printf '════════════════════════════════════════════════════════════════════════\n'
} 2>&1 | tee "$OUT"

printf '\n[audit] saved → %s\n' "$OUT"
printf '[audit] grep FAIL:  grep -n "\\[FAIL\\]" %s\n' "$OUT"
printf '[audit] grep WARN:  grep -n "\\[WARN\\]" %s\n' "$OUT"
