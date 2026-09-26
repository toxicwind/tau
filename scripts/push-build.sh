#!/usr/bin/env bash
set -euo pipefail
REPO_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
REPO_NAME="$(basename "$REPO_DIR" | tr -cd 'A-Za-z0-9._-')"
QUEUE_DIR="${BUILDSRV_ROOT:-/home/toxic/buildsrv}/queue"
SHA="$(git rev-parse HEAD 2>/dev/null || echo manual)"
VER="$(node -p "require('./packages/coding-agent/package.json').version" 2>/dev/null || echo "18.3.0")"
ID="${REPO_NAME}-${VER}-${SHA:0:7}-${RANDOM}"
ID="$(echo "$ID" | tr -cd 'A-Za-z0-9._-')"
mkdir -p "$QUEUE_DIR"
CMD="cargo build --profile release-fast"
TOOL="rust"
cat > "$QUEUE_DIR/${ID}.json" <<EOF
{"id":"$ID","name":"$ID","repo":"$REPO_DIR","toolchain":"$TOOL","cmd":"$CMD"}
EOF
echo "🚀 $ID $CMD"
BUN_ID="${REPO_NAME}-bun-${SHA:0:7}-${RANDOM}"
cat > "$QUEUE_DIR/${BUN_ID}.json" <<EOF
{"id":"$BUN_ID","name":"$BUN_ID","repo":"$REPO_DIR","toolchain":"bun","cmd":"bun run build"}
EOF
echo "🚀 $BUN_ID bun run build"
