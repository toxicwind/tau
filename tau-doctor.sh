#!/usr/bin/env bash
echo "== listeners"; ss -ltnp 2>/dev/null | grep -E ':(25193|20130|20128|25200)\b' | awk '{print $4, $NF}'
echo "== unix sockets"; ls -l /tmp/oracle_a2a.sock /tmp/yote_kite.sock 2>&1 | sed 's/^/  /'
echo "== flock with / without key"
curl -s -o /dev/null -w "  no key:    %{http_code}\n" http://127.0.0.1:25193/v1/models
curl -s -o /dev/null -w "  FLOCK key: %{http_code}\n" -H "Authorization: Bearer ${FLOCK_API_KEY:-none}" http://127.0.0.1:25193/v1/models
echo "== tau processes: FLOCK_API_KEY present in env? (count)"
for p in $(pgrep -u "$USER" -f 'tau'); do printf "  pid %s %s: " "$p" "$(ps -o args= -p "$p" | cut -c1-60)"; tr '\0' '\n' </proc/$p/environ 2>/dev/null | grep -c '^FLOCK_API_KEY='; done
echo "== flock references in tau config (values redacted)"
rg -n --no-messages -i 'flock' ~/.tau/config.yml ~/.tau/agent/models.yml ~/.omp/config.yml ~/estate/config/tau/.env 2>/dev/null | sed -E 's/((api_?key|token|secret)[A-Za-z_]*[:= ]+).*/\1<redacted>/I' | cut -c1-140 | head -20
echo "== newest tau log tail"; ls -t ~/.tau/logs/*.log 2>/dev/null | head -1 | xargs -r tail -n 15 | cut -c1-200
