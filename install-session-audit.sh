#!/usr/bin/env bash
set -e
# 1. entrypoint: kleio audit helper is a bun shebang script
HELPER=/home/toxic/pens/olympus/products/kleio/helper/audit.ts
chmod +x "$HELPER"
# 2. alias: session-audit -> kleio audit engine (bin contract: bin points at product)
ln -sf "$HELPER" /home/toxic/.local/bin/session-audit
ls -la /home/toxic/.local/bin/session-audit
# 3. regenerate manifest (scans ~/.local/bin)
GEN=$(find /home/toxic/pens/estate/products/estate-ops -name "manifest-gen*" -type f 2>/dev/null | head -1)
echo "generator: $GEN"
if [ -n "$GEN" ]; then
  python3 "$GEN" 2>&1 | tail -3 || true
fi
# 4. verify
cd /home/toxic/pens/estate/products/estate-ops
bash bin-verify.sh /home/toxic/pens/estate/products/estate-ops/bin/manifest.yaml 2>&1 | tail -6
echo "verify-exit: $?"