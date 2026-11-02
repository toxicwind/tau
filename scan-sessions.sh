#!/usr/bin/env bash
set +e
echo "== rollout roots (threads) =="
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 /home/toxic/.tau/agent/agent.db "SELECT DISTINCT substr(rollout_path,1,70) FROM threads;" 2>&1 | head -12
else
  echo "sqlite3 missing — fallback dir listing"
fi
echo "== sessions dir =="
ls -la /home/toxic/.tau/agent/sessions 2>&1 | head -8
echo "== custom-session-files =="
ls /home/toxic/.tau/agent/custom-session-files 2>&1 | head -8
echo "== kappa session sites =="
find /home/toxic/.kappa /home/toxic/.config/kappa -maxdepth 3 -type f \( -name "*.db" -o -name "*.jsonl" -o -name "*.log" \) 2>/dev/null | head -10
echo "== webos/lg/failed-chat hits in tau sessions =="
grep -rli "webos\|lg-fleet\|failed chat\|lg.webos" /home/toxic/.tau/agent/sessions /home/toxic/.tau/agent/custom-session-files /home/toxic/.tau/agent/blobs 2>/dev/null | head -15
echo "== webos mentions in any tau file (top 10) =="
grep -rli "webos" /home/toxic/.tau 2>/dev/null | grep -v "\.db" | head -10