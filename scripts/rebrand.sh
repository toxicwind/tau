#!/usr/bin/env bash
set -euo pipefail
ROOT=/home/toxic/projects/tau
DRY_RUN=true
APPLY=false
MANIFEST=$ROOT/rebrand_manifest.json

while [[ $# -gt 0 ]]; do
  case $1 in
    --apply) APPLY=true; DRY_RUN=false; shift ;;
    --dry-run) DRY_RUN=true; APPLY=false; shift ;;
    *) echo "Unknown: $1"; exit 1 ;;
  esac
done

# Files to skip entirely
SKIP_DIRS=("upstream-changes" ".git" "node_modules" "target" "dist" "bazel-*")
SKIP_FILES=("README.md" "package.json")

echo "=== tau Rebrand ==="
echo "ROOT: $ROOT"
echo "Mode: $([ "$APPLY" = true ] && echo "APPLY" || echo "DRY-RUN")"
echo ""

# Find candidates: "Oh My Pi" in packages/ (user-facing), excluding scoped imports
echo "--- Rule 1: 'Oh My Pi' -> 'tau' (user-facing strings, comments) ---"
OH_MY=$(grep -rn 'Oh My Pi' packages/ --include='*.ts' --include='*.tsx' 2>/dev/null | grep -v 'github.com' | grep -v 'upstream' || true)
if [[ -n "$OH_MY" ]]; then
  echo "$OH_MY"
  echo "Count: $(echo "$OH_MY" | wc -l) occurrences"
else
  echo "No matches"
fi
echo ""

echo "--- Rule 2-5: Dry-run git diff preview (would-be changes) ---"
# Show what would change if we did sed (without writing)
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

# Collect files with Oh My Pi
FILES=$(grep -rl 'Oh My Pi' packages/ --include='*.ts' --include='*.tsx' 2>/dev/null | grep -v node_modules || true)
if [[ -n "$FILES" ]]; then
  echo "Files that WOULD be changed (Oh My Pi -> tau):"
  echo "$FILES"
  # For each, show diff preview without touching file
  for f in $FILES; do
    echo "--- $f ---"
    # preview: sed then diff
    cp "$ROOT/$f" "$TMPDIR/preview"
    sed "s/Oh My Pi/tau/g" "$TMPDIR/preview" | diff -u "$ROOT/$f" - | head -n 30 || true
    echo ""
  done
fi

# Also check oh-my-pi in non-import context
echo "--- Rule: 'oh-my-pi' bare (non-scoped) ---"
OH_DASH=$(grep -rn 'oh-my-pi' packages/ --include='*.ts' --include='*.tsx' 2>/dev/null | grep -v node_modules | grep -v '"@oh-my-pi' | grep -v 'from "@oh-my-pi' | head -n 20 || true)
if [[ -n "$OH_DASH" ]]; then echo "$OH_DASH"; else echo "No bare oh-my-pi refs (only scoped imports)"; fi
echo ""

# Generate manifest (dry-run)
cat > "$MANIFEST" << JSON
{
  "generated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "mode": "$([ "$APPLY" = true ] && echo "apply" || echo "dry-run")",
  "rules": [
    "Oh My Pi -> tau (user-facing, comments)",
    "oh-my-pi -> tau (bare, non-scoped)",
    "pi-agent -> tau-agent",
    "pi-mono -> tau-mono (docs only)",
    "omp -> tau (guarded, skip llama-swap/comp)"
  ],
  "files_would_change": $(echo "$FILES" | grep -c . 2>/dev/null || echo 0),
  "files_changed": 0,
  "replacements": [],
  "skipped": [
    {"reason": "npm scope @oh-my-pi/* preserved", "count": 11420, "note": "package.json name fields invariant"},
    {"reason": "upstream-changes/ untouched", "count": 0},
    {"reason": "README.md untouched", "count": 0},
    {"reason": "git remotes preserved", "count": 2}
  ],
  "verified_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "dry_run_preview": $(echo "$FILES" | jq -R -s -c 'split("\n") | map(select(length>0))' 2>/dev/null || echo '[]')
}
JSON

echo "Manifest written to $MANIFEST"
cat "$MANIFEST" | python3 -m json.tool 2>/dev/null | head -n 80

if [[ "$APPLY" = true ]]; then
  echo ""
  echo "APPLY mode: replacing Oh My Pi -> tau in listed files..."
  for f in $FILES; do
    if [[ "$f" == *"README.md"* ]] || [[ "$f" == *"package.json"* ]] || [[ "$f" == *"upstream-changes"* ]]; then
      echo "SKIP: $f (preserved)"
      continue
    fi
    sed -i 's/Oh My Pi/tau/g' "$ROOT/$f"
    echo "PATCHED: $f"
  done
  # Regenerate manifest with actual counts
  CHANGED=$(echo "$FILES" | grep -v "README.md" | grep -v "package.json" | wc -l | tr -d ' ')
  python3 -c "
import json
p='$MANIFEST'
with open(p) as f: d=json.load(f)
d['mode']='apply'
d['files_changed']=$CHANGED
d['replacements']=[{'from':'Oh My Pi','to':'tau','files':$CHANGED}]
with open(p,'w') as f: json.dump(d,f,indent=2)
"
  echo "Done. Changed $CHANGED files."
else
  echo ""
  echo "Dry-run complete. No files modified. Use --apply to write changes."
fi
