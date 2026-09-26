#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
REPO_NAME="$(basename "$REPO_DIR")"
BUILDSRV_ROOT="${BUILDSRV_ROOT:-/home/toxic/buildsrv}"
QUEUE_DIR="$BUILDSRV_ROOT/queue"

mkdir -p "$QUEUE_DIR"

COMMIT_SHA="$(git rev-parse HEAD 2>/dev/null || echo "manual")"

# Robust version extraction from packages/coding-agent/package.json or root package.json
VERSION="18.3.0"
if [ -f "$REPO_DIR/packages/coding-agent/package.json" ]; then
    VERSION="$(node -p "require('./packages/coding-agent/package.json').version || '18.3.0'" 2>/dev/null || echo "18.3.0")"
elif [ -f "$REPO_DIR/package.json" ]; then
    VERSION="$(node -p "require('./package.json').version || '18.3.0'" 2>/dev/null || echo "18.3.0")"
fi

JOB_ID="v${VERSION}-${REPO_NAME}-${COMMIT_SHA:0:7}-${RANDOM}"

# Detect toolchain
TOOLCHAIN="bun"
if [ -f "$REPO_DIR/Cargo.toml" ]; then
    TOOLCHAIN="rust"
elif [ -f "$REPO_DIR/go.mod" ]; then
    TOOLCHAIN="go"
elif [ -f "$REPO_DIR/pyproject.toml" ] || [ -f "$REPO_DIR/requirements.txt" ]; then
    TOOLCHAIN="python"
fi

# Detect build command
BUILD_CMD="bun run build"
if [ "$TOOLCHAIN" = "rust" ]; then
    BUILD_CMD="cargo build --release"
elif [ "$TOOLCHAIN" = "go" ]; then
    BUILD_CMD="go build -v ./..."
elif [ "$TOOLCHAIN" = "python" ]; then
    BUILD_CMD="python3 -m build || pip install ."
fi

cat <<EOF > "$QUEUE_DIR/${JOB_ID}.json"
{
  "id": "$JOB_ID",
  "name": "v${VERSION}-${REPO_NAME}-${COMMIT_SHA:0:7}",
  "repo": "$REPO_DIR",
  "toolchain": "$TOOLCHAIN",
  "cmd": "$BUILD_CMD"
}
EOF

echo "🚀 [CI/CD Push Build] Submitted versioned build job ${JOB_ID} (v${VERSION}) for ${REPO_NAME} (${COMMIT_SHA:0:7}) to buildsrv queue."
