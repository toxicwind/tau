#!/usr/bin/env bash
# tau_one_maximal.sh — one shot, everything, no ceremony.
set -uo pipefail
export ESTATE_AUTO_JJ=0

TAU="$HOME/estate/ranch/tau"
EXT="$HOME/estate/work/tau-extensions"
PLUG="$HOME/.tau/plugins"
BIN="$HOME/.local/bin/tau"
STAMP=$(date +%Y%m%d_%H%M%S)

banner(){ printf '\n═══ %s ═══\n' "$*"; }
say(){ printf '  %-8s %s\n' "$1" "$2"; }

# ─────────────────────────────────────────────────────────────────────────
banner "1. FIX STARSHIP NEWLINE (cosmetic prompt concatenation)"
if [ -f "$HOME/.config/starship.toml" ]; then
  grep -q '^add_newline' "$HOME/.config/starship.toml" \
    || echo 'add_newline = true' >> "$HOME/.config/starship.toml"
  say OK "starship add_newline = true"
else
  say SKIP "no starship.toml"
fi

# ─────────────────────────────────────────────────────────────────────────
banner "2. FIND WHO PINS THE WRONG tau VERSION"
say FIND "scanning node_modules + lockfiles"
declare -a REQUESTERS
while IFS= read -r f; do
  REQUESTERS+=("$f")
  say HIT "$f"
  grep -H '"tau"' "$f" 2>/dev/null | sed 's|^|         |' | head -3
done < <(find "$EXT" "$PLUG" -name package.json -not -path '*/node_modules/*/node_modules/*' 2>/dev/null \
         | xargs grep -lE '"tau"\s*:\s*"\^?(18|17|15|0\.84)' 2>/dev/null | head -20)

# ─────────────────────────────────────────────────────────────────────────
banner "3. NUKE STALE LOCKS + NODE_MODULES IN EXTENSION WORKSPACE"
cd "$EXT" || { say FAIL "cannot cd $EXT"; exit 1; }
for f in bun.lock bun.lockb package-lock.json yarn.lock pnpm-lock.yaml; do
  [ -f "$f" ] && { cp "$f" "$f.bak.$STAMP"; rm -f "$f"; say OK "removed lockfile: $f (backup .bak.$STAMP)"; }
done
[ -d node_modules ] && { say OK "removing node_modules"; rm -rf node_modules; }

# ─────────────────────────────────────────────────────────────────────────
banner "4. FORCE ALL 'tau' SPECIFIERS TO THE LOCAL WORKSPACE"
say EDIT "root package.json — inject overrides"
python3 - "$EXT/package.json" << 'PYEOF'
import json, sys, pathlib
p = pathlib.Path(sys.argv[1])
j = json.loads(p.read_text())
tau_path = pathlib.Path.home() / "estate/ranch/tau/packages/coding-agent"
j.setdefault("overrides", {})
j["overrides"]["tau"] = f"link:{tau_path}"
j.setdefault("resolutions", {})
j["resolutions"]["tau"] = f"link:{tau_path}"
p.write_text(json.dumps(j, indent=2) + "\n")
print(f"  OK  overrides + resolutions → link:{tau_path}")
PYEOF

# same treatment for every sub-package that pins tau directly
for pj in "$EXT"/packages/*/package.json; do
  [ -f "$pj" ] || continue
  python3 - "$pj" << 'PYEOF'
import json, sys, pathlib
p = pathlib.Path(sys.argv[1])
j = json.loads(p.read_text())
changed = False
for section in ("dependencies", "devDependencies", "peerDependencies"):
    if section in j and "tau" in j[section]:
        j[section]["tau"] = "workspace:*"
        changed = True
# peer deps on a local workspace pkg are usually wrong — drop them
if "peerDependencies" in j and "tau" in j["peerDependencies"]:
    del j["peerDependencies"]["tau"]
    if not j["peerDependencies"]: del j["peerDependencies"]
    changed = True
if changed:
    p.write_text(json.dumps(j, indent=2) + "\n")
    print(f"  EDIT  {p.relative_to(p.parents[2])} → tau = workspace:*")
PYEOF
done

# ─────────────────────────────────────────────────────────────────────────
banner "5. FALLBACK SYMLINKS (survive bun install failures)"
for target in "$EXT/node_modules/tau" "$PLUG/node_modules/tau"; do
  mkdir -p "$(dirname "$target")"
  rm -rf "$target"
  ln -sfn "$TAU/packages/coding-agent" "$target"
  say OK "symlink $target → $TAU/packages/coding-agent"
done

# ─────────────────────────────────────────────────────────────────────────
banner "6. INSTALL"
cd "$EXT"
if bun install 2>&1 | tee /tmp/tau_install.log | tail -5; then
  say OK "bun install completed"
else
  say WARN "bun install threw — reading log"
  grep -E 'error|No version matching' /tmp/tau_install.log | head -10 | sed 's|^|         |'
fi

# ─────────────────────────────────────────────────────────────────────────
banner "7. KILL THE FAILING PLUGIN IF IT STILL WON'T RESOLVE"
PLUGIN="$PLUG/node_modules/@cakriwut/omp-model-router"
if [ -e "$PLUGIN" ]; then
  if ! ( cd "$EXT" && bun -e "import('tau').then(()=>process.exit(0)).catch(()=>process.exit(1))" 2>/dev/null ); then
    say WARN "tau still won't resolve from $EXT — disabling plugin"
    mv "$PLUGIN" "$PLUGIN.disabled.$STAMP" 2>/dev/null && say OK "disabled: $PLUGIN → .disabled.$STAMP"
  else
    say OK "tau resolves from extension workspace"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────
banner "8. REBUILD TAU BINARY"
[ -x "$BIN" ] && { cp "$BIN" "$BIN.bak.$STAMP"; say OK "binary backup → $BIN.bak.$STAMP"; }
cd "$TAU" || { say FAIL "cannot cd $TAU"; exit 1; }
if bun run build 2>&1 | tail -20; then
  say OK "build finished"
else
  say FAIL "build failed — restoring backup"
  [ -f "$BIN.bak.$STAMP" ] && cp "$BIN.bak.$STAMP" "$BIN"
  exit 1
fi

# try to locate and install the fresh binary
for cand in "$TAU/dist/tau" "$TAU/bin/tau" "$TAU/packages/coding-agent/dist/tau" "$TAU/packages/coding-agent/bin/tau"; do
  if [ -f "$cand" ]; then
    cp "$cand" "$BIN.new" && mv "$BIN.new" "$BIN" && chmod +x "$BIN"
    say OK "installed $cand → $BIN"
    break
  fi
done

# ─────────────────────────────────────────────────────────────────────────
banner "9. VERIFY"
SMOKE=/tmp/tau_smoke_$STAMP.log
if timeout 45 tau -p "reply with only: ok" > "$SMOKE" 2>&1; then
  if grep -qiE '\bok\b' "$SMOKE"; then
    say OK "tau responds"
  else
    say WARN "tau ran but no 'ok' — inspect $SMOKE"
  fi
else
  say WARN "tau -p exited non-zero — inspect $SMOKE"
fi
say TAIL "$SMOKE"
tail -15 "$SMOKE" 2>/dev/null | sed 's|^|         |'

# ─────────────────────────────────────────────────────────────────────────
banner "DONE"
cat << EOF

  artifacts:
    install log:  /tmp/tau_install.log
    smoke log:    $SMOKE
    binary backup: $BIN.bak.$STAMP (if existed)
    lock backups:  $EXT/*.bak.$STAMP (if existed)

  if the plugin was disabled:
    $PLUG/node_modules/@cakriwut/omp-model-router.disabled.$STAMP

  re-enable extension deps when fixed:
    mv <disabled> <original>  && cd $EXT && bun install

  kill jj auto-colocate permanently for this dir:
    echo 'export ESTATE_AUTO_JJ=0' >> ~/.bashrc.local

EOF
