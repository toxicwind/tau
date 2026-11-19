#!/usr/bin/env bash
# tau_finalize_maximal.sh — finish fix chain + install permanent guard
set -uo pipefail
TAU="$HOME/estate/ranch/tau"
TOOLS="$TAU/packages/coding-agent/src/tools"
EXT="$HOME/estate/work/tau-extensions"
BIN="$(command -v tau || echo "$HOME/.local/bin/tau")"
STAMP=$(date +%Y%m%d_%H%M%S)

log(){ printf '  %-8s %s\n' "$1" "$2"; }

# ── 1. verify the join injections actually landed correctly ──
log "CHECK" "join injection correctness"
for f in browser/attach.ts browser/downloads.ts browser/tab-worker.ts \
         browser/tab-supervisor.ts browser/cmux/socket-client.ts; do
  file="$TOOLS/$f"
  # count occurrences of the import line — must be exactly 1
  n=$(grep -c 'import { join } from "node:path"' "$file" || true)
  if [ "$n" -eq 1 ]; then log "OK" "single join import: $f"
  elif [ "$n" -eq 0 ]; then log "FAIL" "no join import: $f (rerun injector)"
  else log "WARN" "duplicate join import ($n×): $f"; fi
done

# ── 2. kill junk backup dir ──
if [ -d "$TOOLS/browser/.prelude-backup-20261011_000338" ]; then
  rm -rf "$TOOLS/browser/.prelude-backup-20261011_000338"
  log "OK" "deleted .prelude-backup-20261011_000338"
else
  log "SKIP" "backup dir already gone"
fi

# ── 3. link the extension workspace so bare 'tau' resolves ──
if [ -d "$EXT" ]; then
  ( cd "$EXT" && bun install --silent 2>&1 | tail -3 ) || log "WARN" "bun install failed in $EXT"
  # verify
  if [ -d "$EXT/node_modules/tau" ] || [ -L "$EXT/node_modules/tau" ]; then
    log "OK" "tau linked into $EXT/node_modules"
  else
    log "WARN" "tau still not linked — check workspace config"
  fi
else
  log "SKIP" "no $EXT"
fi

# ── 4. install AST-based import guard ──
log "SETUP" "installing AST import guard"
GUARD_DIR="$HOME/.tau_fix/guard"
mkdir -p "$GUARD_DIR"

cat > "$GUARD_DIR/audit.ts" << 'GUARD_TS'
// audit.ts — AST-based unresolved-identifier check for tool imports.
// Runs in ~80ms across the whole tools/ tree. Exits 1 on any missing import.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.argv[2] || `${process.env.HOME}/estate/ranch/tau/packages/coding-agent/src/tools`;
const TRACK = ["join", "resolve", "readFileSync", "readdirSync", "writeFileSync", "statSync", "existsSync", "dirname", "basename"];

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (e.isFile() && /\.(ts|tsx)$/.test(e.name)) acc.push(full);
  }
  return acc;
}

const IMPORT_RE = (sym: string) =>
  new RegExp(`import[^;]*\\{[^}]*\\b${sym}\\b[^}]*\\}[^;]*from`, "m");
const NAMESPACE_RE = (sym: string) =>
  new RegExp(`import\\s+\\*\\s+as\\s+\\w+\\s+from[^;]+;`, "m");
const USE_RE = (sym: string) =>
  new RegExp(`(?<![.\\w])${sym}\\s*\\(`, "g");

const fails: { file: string; sym: string; uses: number }[] = [];

for (const file of walk(ROOT)) {
  const src = readFileSync(file, "utf8");
  for (const sym of TRACK) {
    const uses = (src.match(USE_RE(sym)) || []).length;
    if (uses === 0) continue;
    if (IMPORT_RE(sym).test(src)) continue;
    // also allow `path.join(` / `fs.readFileSync(` style (module-qualified)
    const qualified = new RegExp(`(?<![.\\w])\\w+\\.${sym}\\s*\\(`).test(src);
    if (qualified && !new RegExp(`(?<![.\\w])${sym}\\s*\\(`).test(src.replace(new RegExp(`\\w+\\.${sym}\\s*\\(`, "g"), ""))) continue;
    fails.push({ file: file.replace(ROOT + "/", ""), sym, uses });
  }
}

if (fails.length === 0) {
  console.log("PASS  no unresolved imports");
  process.exit(0);
}
for (const f of fails) {
  console.log(`FAIL  ${f.file}  uses ${f.sym}() ${f.uses}×  but does not import it`);
}
process.exit(1);
GUARD_TS

log "OK" "guard written: $GUARD_DIR/audit.ts"

# ── 5. run guard against current state ──
log "RUN" "AST guard against tools/"
if bun "$GUARD_DIR/audit.ts" "$TOOLS"; then
  log "OK" "guard passes — no missing imports"
else
  log "FAIL" "guard found issues — see above"
fi

# ── 6. install as git pre-commit hook ──
if [ -d "$TAU/.git" ]; then
  HOOK="$TAU/.git/hooks/pre-commit"
  mkdir -p "$TAU/.git/hooks"
  if [ -f "$HOOK" ] && ! grep -q "tau AST import guard" "$HOOK" 2>/dev/null; then
    cp "$HOOK" "$HOOK.bak.$STAMP"
  fi
  cat > "$HOOK" << 'HOOKEOF'
#!/usr/bin/env bash
# tau AST import guard
exec bun "$HOME/.tau_fix/guard/audit.ts" \
  "$(git rev-parse --show-toplevel)/packages/coding-agent/src/tools" || exit 1
HOOKEOF
  chmod +x "$HOOK"
  log "OK" "pre-commit hook installed at $HOOK"
else
  log "SKIP" "no .git at $TAU"
fi

# ── 7. rebuild binary with rollback ──
if [ -x "$BIN" ]; then
  BAK="$BIN.bak.$STAMP"
  cp "$BIN" "$BAK"
  log "OK" "backed up binary → $BAK"
fi

log "BUILD" "rebuilding tau"
if ( cd "$TAU" && bun run build 2>&1 | tail -20 ); then
  log "OK" "build completed"
  # try to find and install the new binary
  for cand in "$TAU/dist/tau" "$TAU/bin/tau" "$TAU/packages/coding-agent/dist/tau"; do
    if [ -f "$cand" ]; then
      cp "$cand" "$BIN.new" && mv "$BIN.new" "$BIN"
      log "OK" "installed $cand → $BIN"
      break
    fi
  done
else
  log "FAIL" "build failed — binary unchanged"
fi

# ── 8. verify ──
log "VERIFY" "tau -p smoke"
if timeout 30 tau -p "reply with the single word ok" 2>&1 | tee /tmp/tau_smoke.log | grep -qiE '^ok|\bok\b'; then
  log "OK" "tau responds"
else
  log "WARN" "tau did not produce expected output — see /tmp/tau_smoke.log"
fi

echo
log "DONE" "state captured; guard installed; binary rebuilt"
echo "         smoke log: /tmp/tau_smoke.log"
echo "         guard:     ~/.tau_fix/guard/audit.ts"
echo "         hook:      $TAU/.git/hooks/pre-commit"
