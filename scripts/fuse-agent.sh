#!/usr/bin/env bash
# fuse-agent.sh — bridge fuse conflict handoffs to the local Herd/beellama endpoint.
# Contract (fuse resolve --agent): conflict prompt on stdin -> complete resolved file on stdout.
# Endpoint: http://127.0.0.1:25100/v1 (beellama/qwen-flash-64k, self-hosted, no key — see docs/PRE_RELEASE_INTEGRATION_ENGINE.md).
set -euo pipefail
PROMPT="$(cat)"
PAYLOAD="$(jq -n --arg p "$PROMPT" '{model:"beellama/qwen-flash-64k",messages:[{role:"user",content:$p}],max_tokens:8192,temperature:0}')"
curl -s --max-time 180 http://127.0.0.1:25100/v1/chat/completions \
	-H 'Content-Type: application/json' \
	-d "$PAYLOAD" |
	python3 -c '
import json, sys, re
d = json.load(sys.stdin)
c = d["choices"][0]["message"].get("content", "")
c = c.strip()
c = re.sub(r"^```[a-zA-Z0-9_+-]*\n", "", c)
c = re.sub(r"\n```\s*$", "", c)
print(c)
'
