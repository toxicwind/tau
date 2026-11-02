#!/usr/bin/env bash
set -uo pipefail
EXT="$HOME/estate/work/tau-extensions"
PLUG="$HOME/.tau/plugins"
REAL="$HOME/estate/ranch/tau/packages/coding-agent"
SHIM="$EXT/packages/tau-shim"
STAMP=$(date +%Y%m%d_%H%M%S)

say(){ printf '  %-8s %s\n' "$1" "$2"; }
banner(){ printf '\n═══ %s ═══\n' "$*"; }

# ─────────────────────────────────────────────────────────────────────────
banner "1. CLEAN PREVIOUS FAILED ATTEMPTS"
rm -f "$EXT/node_modules/tau" "$PLUG/node_modules/tau"
say OK "removed stray symlinks"
# revert every workspace:* / link: back to a clean state first
python3 - "$EXT" << 'PY'
import json, pathlib, sys
root = pathlib.Path(sys.argv[1])
for pj in [root/"package.json", *sorted((root/"packages").glob("*/package.json"))]:
    if not pj.exists(): continue
    j = json.loads(pj.read_text())
    changed = False
    for section in ("dependencies", "devDependencies", "peerDependencies"):
        if section in j and "tau" in j[section]:
            v = j[section]["tau"]
            if isinstance(v, str) and (v.startswith("link:") or v.startswith("workspace:") or v.startswith("file:")):
                j[section]["tau"] = "workspace:*"
                changed = True
    if changed:
        pj.write_text(json.dumps(j, indent=2) + "\n")
        print(f"  reset  {pj.relative_to(root)}")
PY

# ─────────────────────────────────────────────────────────────────────────
banner "2. CREATE tau-shim WORKSPACE MEMBER"
mkdir -p "$SHIM"
rm -rf "$SHIM/src"
ln -sfn "$REAL/src" "$SHIM/src"     # shim/src IS real/src via symlink
say OK "shim/src → $REAL/src"

cat > "$SHIM/package.json" << 'JSON'
{
  "name": "tau",
  "version": "1.0.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./src/default-bridge.ts"
    },
    "./*": "./src/*"
  }
}
JSON
say OK "shim/package.json written (name=tau, links to real code via src symlink)"

# ─────────────────────────────────────────────────────────────────────────
banner "3. POINT EVERY EXTENSION AT workspace:* (shim satisfies it)"
python3 - "$EXT" << 'PY'
import json, pathlib, sys
root = pathlib.Path(sys.argv[1])
touched = 0
for pj in [root/"package.json", *sorted((root/"packages").glob("*/package.json"))]:
    if not pj.exists() or pj.parent.name == "tau-shim": continue
    j = json.loads(pj.read_text())
    for section in ("dependencies", "devDependencies", "peerDependencies"):
        if section in j and "tau" in j[section]:
            j[section]["tau"] = "workspace:*"
            touched += 1
    pj.write_text(json.dumps(j, indent=2) + "\n")
print(f"  {touched} slot[s] pointed at workspace:*")
PY
say OK "rewritten"

# ─────────────────────────────────────────────────────────────────────────
banner "4. NUKE LOCK + INSTALL"
cd "$EXT" || exit 1
for f in bun.lock bun.lockb; do [ -f "$f" ] && { cp "$f" "$f.bak.$STAMP"; rm -f "$f"; }; done
[ -d node_modules ] && rm -rf node_modules
bun install 2>&1 | tee /tmp/tau_shim_install.log | tail -12
if grep -qE '^error:' /tmp/tau_shim_install.log; then
  say FAIL "still failing — see /tmp/tau_shim_install.log"
  grep -E '^error:' /tmp/tau_shim_install.log | sort -u | head -10 | sed 's|^|         |'
else
  say OK "bun install clean"
fi

# ─────────────────────────────────────────────────────────────────────────
banner "5. VERIFY RESOLUTION"
for check in "$EXT/node_modules/tau" "$PLUG/node_modules/tau"; do
  if [ -e "$check" ]; then
    tgt=$(readlink -f "$check")
    say OK "$check → $tgt"
  else
    say WARN "$check missing — recreating symlink"
    mkdir -p "$(dirname "$check")"; ln -sfn "$REAL" "$check"
  fi
done

if ( cd "$PLUG" && bun -e 'import("tau").then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1)})' >/dev/null 2>&1 ); then
  say OK "runtime: tau loads from $PLUG"
else
  say WARN "runtime: tau won't load — inspect manually"
fi

# ─────────────────────────────────────────────────────────────────────────
banner "6. TXT-EMBED FIX FOR COMPILED BINARY"
# the earlier binary smoke showed $bunfs/.../00_stealth_tampering.txt ENOENT
# convert readFileSync(join(import.meta.dir, X)) → import X with { type: 'text' }
TOOLS="$REAL/src/tools"
python3 - "$TOOLS" << 'PY'
import re, pathlib, sys, time
root = pathlib.Path(sys.argv[1])
pat = re.compile(
    r'^(?P<indent>[ \t]*)const\s+(?P<var>[A-Za-z_]\w*)\s*=\s*readFileSync\(\s*'
    r'(?:join|resolve)\(\s*import\.meta\.dir\s*,\s*'
    r'(?P<q>["\'])(?P<rel>[^"\']+)(?P=q)\s*\)\s*,\s*["\']utf-?8["\']\s*\)\s*;',
    re.MULTILINE,
)
n_total = 0
for f in sorted(root.rglob("*.ts")):
    s = str(f)
    if "node_modules" in s or ".prelude-backup" in s: continue
    src = f.read_text()
    if "readFileSync" not in src or "import.meta.dir" not in src: continue
    new, n = pat.subn(lambda m: f'{m.group("indent")}import {m.group("var")} from "{m.group("rel")}" with {{ type: "text" }};', src)
    if n:
        f.with_name(f.name + ".bak." + str(int(time.time()))).write_text(src)
        f.write_text(new)
        print(f"  EDIT  {f.relative_to(root)}  ({n})")
        n_total += n
print(f"  total {n_total} conversion[s]")
PY

# ─────────────────────────────────────────────────────────────────────────
banner "7. REBUILD + INSTALL BINARY"
BIN="$HOME/.local/bin/tau"
[ -x "$BIN" ] && { cp "$BIN" "$BIN.bak.$STAMP"; say OK "binary backup → $BIN.bak.$STAMP"; }
cd "$HOME/estate/ranch/tau" || exit 1
if bun run build 2>&1 | tail -20; then
  say OK "build finished"
  for cand in dist/tau bin/tau packages/coding-agent/dist/tau packages/coding-agent/bin/tau; do
    [ -f "$cand" ] && { cp "$cand" "$BIN.new" && mv "$BIN.new" "$BIN" && chmod +x "$BIN"; say OK "installed $cand → $BIN"; break; }
  done
else
  say FAIL "build failed"
fi

# ─────────────────────────────────────────────────────────────────────────
banner "8. SMOKE"
SMOKE="/tmp/tau_smoke_shim_$STAMP.log"
if timeout 60 tau -p "reply with only: ok" > "$SMOKE" 2>&1; then
  grep -qiE '\bok\b' "$SMOKE" && say OK "tau responds" || say WARN "ran, no 'ok' — see $SMOKE"
else
  say WARN "nonzero exit — see $SMOKE"
fi
tail -20 "$SMOKE" | sed 's|^|         |'

banner DONE
echo "  install log:  /tmp/tau_shim_install.log"
echo "  smoke log:    $SMOKE"
echo "  shim pkg:     $SHIM"
echo "  binary:       $BIN  (backup $BIN.bak.$STAMP)"
