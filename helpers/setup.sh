#!/bin/bash
set -euo pipefail
SOV="$HOME/sovereign"
TAU="$SOV/projects/tau"
CONFIG="$SOV/config"
QUEUE="$HOME/buildsrv/queue"

mkdir -p "$CONFIG" "$SOV/projects" "$QUEUE" "$SOV/helpers" "$HOME/.local/bin" "$HOME/.config/vansrouter"

# 1. Config master setup
if [ -d "$HOME/.tau" ] && [ ! -L "$HOME/.tau" ]; then
    echo "[config] moving ~/.tau -> $CONFIG/tau"
    rm -rf "$CONFIG/tau" 2>/dev/null || true
    mv "$HOME/.tau" "$CONFIG/tau" 2>/dev/null || cp -a "$HOME/.tau" "$CONFIG/tau"
fi
rm -rf "$HOME/.tau" 2>/dev/null || true
ln -sfn "$CONFIG/tau" "$HOME/.tau"
ln -sfn "$HOME/.tau" "$HOME/.omp"

# 2. .secrets master setup
if [ -f "$HOME/.secrets" ] && [ ! -L "$HOME/.secrets" ]; then
    mv "$HOME/.secrets" "$CONFIG/.secrets" 2>/dev/null || cp -a "$HOME/.secrets" "$CONFIG/.secrets"
fi
touch "$CONFIG/.secrets"
chmod 600 "$CONFIG/.secrets"
ln -sfn "$CONFIG/.secrets" "$HOME/.secrets"
ln -sfn "$CONFIG/.secrets" "$HOME/.config/vansrouter/.env"

grep -q "^API_KEY_SECRET=" "$CONFIG/.secrets" || echo "API_KEY_SECRET=$(openssl rand -hex 32)" >> "$CONFIG/.secrets"
grep -q "^JWT_SECRET=" "$CONFIG/.secrets" || echo "JWT_SECRET=$(openssl rand -hex 32)" >> "$CONFIG/.secrets"
grep -q "^MACHINE_ID_SALT=" "$CONFIG/.secrets" || echo "MACHINE_ID_SALT=$(openssl rand -hex 16)" >> "$CONFIG/.secrets"

echo "[setup] setup complete successfully!"
