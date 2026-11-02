# tau failure diagnosis — bundle tau-report-2026-10-24T03-48-31-762Z.tar.gz
Session: tau 18.8.4+estate-scripts.tau.f6baf040, cwd /home/toxic/tmp, ran 2026-10-23T22:25 -> 2026-10-24T03:48 (~5h23m). 4628 session events.

## Scale (the "what on earth")
- 1212 assistant turns; stopReason: toolUse 1161, stop 71, aborted 48, error 2.
- 1355 tool results (of which isError=true 125, useless=true 43).
- 41MB of tool artifacts written to disk; biggest 989.bash.log=11.8MB, estate-recovery-3.jsonl=7.6MB.
- Tool payload ~3.0MB, text blocks ~5.8MB in-session.
- 202 mode_change events, ALL mode="goal" (195) + goal_paused 4 + none 2 + vibe 1 — emitted once PER TURN for a mode that never changed.
- 112 vibe-session-lifecycle events; vibe_spawn 27, vibe_kill 38, vibe_wait 49 (36 of the waits flagged useless=true).
- 23 assistant messages recorded with a COMPLETELY EMPTY content array.
- Models thrashed 10x: glm-5.3-flash -> deepseek-v4-flash -> glm-5.3-flash -> minimax-m3 -> deepseek-v4-flash -> minimax-m3 -> openrouter/qwen3.6-plus -> deepseek-v4-flash -> qwen3.6-35b. BANNED deepseek-v4-flash ran 1080/1282 turns (84%) despite config model=qwen3.6-35b.
- No session_exit / goal-completed event: the session was mid-loop when captured (externally by report generation).

## Confirmed failure chain
1. CONTEXT BLOWOUT: contextSnapshot.promptTokens grew 17.5k -> 587,648 tokens with NO compaction. First of only TWO compactions fired at ~404k (00:33:36), dropping to 25k; second at 03:39:03. nonMessageTokens (system+tools) 14.3k normally, but DROPPED to 8,243 after compaction #1 and drifted 9,913 -> 16,851 after #2 => TOOL/SCHEMA LOSS around compaction.
2. PROVIDER ABORTS: 30x "Request was aborted", 6x "Operation aborted", 9x "Interrupted by user" (errorId 67112960), 2x 402 Insufficient credits (528384). Aborts cluster while context is 130k-587k => requests exceed the provider's REAL context window while tau's catalog-declared window is far larger.
3. EMPTY TURNS: aborted provider calls recorded as assistant messages with ZERO content; these degenerate turns feed the loop -> flailing.
4. TOOL INVISIBILITY: right after compaction #2 (ts 1792813167757..03170740740, model qwen3.6-35b) the model emitted MALFORMED tool calls accepted as real: name="call:ffs grep", "call:grep", "call:eval(i=\"...\")", "</parameter". This is the signature of a model with NO tool schema -> improvised `call:`/XML syntax. tau executed them instead of rejecting+re-prompting.
5. GOAL-MODE INFINITE LOOP: goal mode never terminated; mode_change re-emitted each turn; only 71 stop turns vs 1161 toolUse turns.

## User's hypothesis (confirmed by evidence)
"tau doesn't see tools or anything eg tau natives": nonMessageTokens contraction after compaction + malformed tool-call names prove tools are intermittently absent/mangled; `call:ffs grep` shows an MCP tool whose name contains a SPACE being fed through an openai-completions function-name schema that forbids spaces.
