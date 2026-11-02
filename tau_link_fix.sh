#!/usr/bin/env bash
set -uo pipefail
EXT="$HOME/estate/work/tau-extensions"
PLUG="$HOME/.tau/plugins"
TAU_PKG="$HOME/estate/ranch/tau/packages/coding-agent"
BIN="$HOME/.local/bin/tau"
STAMP=$(date +%Y%m%d_%H%M%S)

say(){ printf '  %-8s %s\n' "$1" "$2"; }
banner(){ printf '\n═══ %s ═══\n' "$*"; }

# ─────────────────────────────────────────────────────────────────────────
banner "1. workspace:* → link: (works regardless of workspace membership)"
FIX_ONE='
import json, sys, pathlib
p = pathlib.Path(sys.argv[1])
LINK = sys.argv[2]
j = json.loads(p.read_text())
n = 0
for section in ("dependencies", "devDependencies", "peerDependencies"):
    if section in j and "tau" in j[section]:
        if j[section]["tau"] != f"link:{LINK}":
            j[section]["tau"] = f"link:{LINK}"
            n += 1
if n:
    p.write_text(json.dumps(j, indent=2) + "\n")
    print(f"  EDIT  {p}  ({n} slot[s])")
'
for pj in "$EXT/package.json" "$EXT"/packages/*/package.json; do
  [ -f "$pj" ] || continue
  python3 -c "$FIX_ONE" "$pj" "$TAU_PKG"
done

# same treatment for the plugins root + any pinned sub-packages there
for pj in "$PLUG/package.json" "$PLUG"/node_modules/*/package.json "$PLUG"/node_modules/@*/*/package.json; do
  [ -f "$pj" ] || continue
  python3 -c "$FIX_ONE" "$pj" "$TAU_PKG" 2>/dev/null || true
done

# ─────────────────────────────────────────────────────────────────────────
banner "2. Force-resolve overrides at the extension root"
python3 - "$EXT/package.json" "$TAU_PKG" << 'PY'
import json, sys, pathlib
p = pathlib.Path(sys.argv[1]); link = sys.argv[2]
j = json.loads(p.read_text())
j.setdefault("overrides", {})["tau"]  = f"link:{link}"
j.setdefault("resolutions", {})["tau"] = f"link:{link}"
p.write_text(json.dumps(j, indent=2) + "\n")
print(f"  OK  overrides + resolutions → link:{link}")
PY

# ─────────────────────────────────────────────────────────────────────────
banner "3. Reinstall"
cd "$EXT" || exit 1
[ -d node_modules ] && rm -rf node_modules
bun install 2>&1 | tee /tmp/tau_install2.log | tail -8
if grep -qE 'error:' /tmp/tau_install2.log; then
  say WARN "still errors — see /tmp/tau_install2.log"
  grep -E 'error' /tmp/tau_install2.log | sort -u | head -10 | sed 's|^|         |'
else
  say OK "bun install clean"
fi

# ─────────────────────────────────────────────────────────────────────────
banner "4. Reinstall plugins (symlinks must survive or be re-created)"
# drop the symlinks that install may have clobbered, then re-create
for t in "$EXT/node_modules/tau" "$PLUG/node_modules/tau"; do
  mkdir -p "$(dirname "$t")"
  if [ ! -e "$t" ] || [ ! -L "$t" ]; then
    rm -rf "$t"; ln -sfn "$TAU_PKG" "$t"; say OK "symlink $t"
  else
    say KEEP "symlink $t"
  fi
done

# ─────────────────────────────────────────────────────────────────────────
banner "5. Runtime check — does tau actually load from the plugin dir?"
if ( cd "$PLUG" && bun -e 'import("tau").then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1)})' 2>&1 | tail -3 ); then
  say OK "tau loads from $PLUG"
else
  say WARN "tau still won't load from $PLUG — see above"
fi

# ─────────────────────────────────────────────────────────────────────────
banner "6. Build state check"
if pgrep -f 'bun.*run.*build' >/dev/null; then
  say RUN "build already running — waiting"
  while pgrep -f 'bun.*run.*build' >/dev/null; do sleep 3; done
  say OK "build finished"
fi

NEWER=$(find "$HOME/.local/bin" -maxdepth 1 -name 'tau' -newer "$BIN.bak.$STAMP" 2>/dev/null | head -1)
if [ -z "$NEWER" ]; then
  say REBUILD "no newer binary found — running build"
  cd "$HOME/estate/ranch/tau" || exit 1
  if bun run build 2>&1 | tail -15; then
    # try common install locations
    for cand in dist/tau bin/tau packages/coding-agent/dist/tau packages/coding-agent/bin/tau; do
      [ -f "$cand" ] && { cp "$cand" "$BIN.new" && mv "$BIN.new" "$BIN" && chmod +x "$BIN"; say OK "installed $cand → $BIN"; break; }
    done
  else
    say FAIL "build failed"
  fi
else
  say OK "binary already refreshed: $(ls -la "$BIN" | awk '{print $6,$7,$8}')"
fi

# ─────────────────────────────────────────────────────────────────────────
banner "7. Smoke test"
SMOKE=/tmp/tau_smoke_link.log
if timeout 45 tau -p "reply with only: ok" > "$SMOKE" 2>&1; then
  grep -qiE '\bok\b' "$SMOKE" && say OK "tau responds" || say WARN "tau ran, no 'ok' — see $SMOKE"
else
  say WARN "tau -p nonzero — see $SMOKE"
fi
tail -12 "$SMOKE" | sed 's|^|         |'

banner DONE
echo "  install log: /tmp/tau_install2.log"
echo "  smoke log:   $SMOKE"
echo "  binary:      $BIN   (backup: $BIN.bak.*)"
