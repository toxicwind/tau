# Tau aborted sessions - 2026-10-26..28

Corpus: **50** session transcripts touched in window; **24 aborted** (1 more = this live session, excluded).
Abort signals: **16x SIGHUP**, **1x SIGTERM**, **5x no exit record (hard kill/crash)**, **2x disposed with dangling state**.

## A. Dangling mid-turn (15) - last assistant turn never completed

| # | Last activity (UTC) | Abort | cwd | Last user ask | Stop / state |
|---|---|---|---|---|---|
| 1 | 2026-10-26T19:42:55.385Z | no-exit | ~pens/olympus/products/tau | say hi | aborted tool-only turn in flight |
| 2 | 2026-10-26T20:02:02.060Z | signal/sigterm | ~pens/olympus/products/tau | say OK | aborted tool-only turn in flight |
| 3 | 2026-10-26T01:02:03.177Z | no-exit | ~tmp | do it do it you are running tau but | toolUse  |
| 4 | 2026-10-26T03:21:14.613Z | signal/sighup | ~tmp | wtf is going on with tool use | aborted tool-only turn in flight |
| 5 | 2026-10-26T05:47:42.077Z | no-exit | ~tmp | figure out arning: Fallback chain for role 'fallback' references unknown model:  | toolUse tool-only turn in flight |
| 6 | 2026-10-26T05:58:53.961Z | signal/sighup | ~tmp | run exactly this bash command and paste the raw output verbatim: type -t head; d | error tool-only turn in flight |
| 7 | 2026-10-26T16:46:55.139Z | signal/sighup | ~tmp | wtf | aborted tool-only turn in flight |
| 8 | 2026-10-26T22:38:28.273Z | signal/sighup | ~tmp | todo skill is not reliable at all tbh but you have to keep using it it triggers  | aborted tool-only turn in flight |
| 9 | 2026-10-26T19:51:48.524Z | normal/dispose | ~tmp | (none in tail) | toolUse pending tool: ? |
| 10 | 2026-10-27T19:43:17.434Z | signal/sighup | ~tmp | finish quickly the CURRENT micro todo that is so its not jsut lost eg commit pus | aborted tool-only turn in flight |
| 11 | 2026-10-27T19:43:17.515Z | signal/sighup | ~tmp | push to MAIN and merge max is what i meant make sure is it good? are you sure th | aborted tool-only turn in flight |
| 12 | 2026-10-27T06:12:00.588Z | signal/sighup | ~tmp | its useless | aborted tool-only turn in flight |
| 13 | 2026-10-27T18:42:49.922Z | signal/sighup | ~tmp | what the hell fix what kite is seeing on its side dude `Done immediately, in fle | error tool-only turn in flight |
| 14 | 2026-10-28T00:35:49.137Z | signal/sighup | ~tmp | and rerun all | aborted tool-only turn in flight |
| 15 | 2026-10-28T17:24:21.162Z | signal/sighup | ~tmp | (none in tail) | aborted tool-only turn in flight |

## B. Last turn completed, session then killed (9)

| # | Last activity | Abort | Last user ask | Final assistant (excerpt) |
|---|---|---|---|---|
| 1 | 2026-10-26T00:50:42.964Z | no-exit | (none in tail) | Everything is green and pushed. Here's where things landed: ## What was actually wrong (and fixed) **nativelin |
| 2 | 2026-10-26T01:04:36.992Z | no-exit | dude do it | Clean. Both ACPs are completely killed: | Process | Status | Port | |---|---|---| | `tau acp` (chute bridge) | |
| 3 | 2026-10-26T08:05:04.765Z | signal/sighup | dude you need to fix the livr proc lag innedistely | You're right — that kill-sweep loop was me flailing. Stopping it. Here's the honest state: ## What happened to |
| 4 | 2026-10-26T15:57:31.695Z | signal/sighup | wait wtf we have rename file and we ha e been ising the shitty bash, audit bash  | Here's the audit you asked for — my bash usage today, checked against tau's own interceptor doctrine: ## Bash  |
| 5 | 2026-10-26T22:40:25.276Z | normal/dispose | max edge case thouse | The session work is already complete. The todo state clearly shows: **4/4 done, 0 open** All verification item |
| 6 | 2026-10-27T06:12:00.574Z | signal/sighup | is there something wrong with thst use eval | **Lane is healthy — 28.5s wall for `say ok` at budget 2500, `finish_reason=stop`, content=`"ok"`.** The model  |
| 7 | 2026-10-27T20:49:31.382Z | signal/sighup | does it seem like its working lol | Yep, it's working — 123.6K tokens now (was 114.6K), still in `esc interrupt` mode meaning mid-generation, $0.0 |
| 8 | 2026-10-28T09:46:28.530Z | signal/sighup | (none in tail) | ✅ **Retrospective complete — all three artifacts shipped and pushed.** ## 1. Anomaly dossier (`estate/docs/ano |
| 9 | 2026-10-28T17:24:21.124Z | signal/sighup | did we work with and fix sharpshooter | Yes — sharpshooter was one of this session's real fixes. Quick status check confirms it's fully landed: ## Sha |

## Notable dangling work
- **01a17a76 (26 23:06, ~/tmp)** - "push to MAIN and merge, audit session, run retrospective" - interrupted by user + 429 concurrency; SIGHUP before push/retrospective.
- **01a181e9 (28 09:48, ~/tmp)** - bin-verify manifest work (FAIL broken symlink: .local/bin/delendai); SIGHUP mid-tool.
- **01a17bff (27 06:14)** - kite master-connector fix; died on 429 concurrency limit, retry budget exhausted.
- **01a17fb3 (27 23:30)** - "and rerun all"; 500 provider error then aborted.
- **01a176c9 (26 05:57)** - analyst command probe; hit 401 Wrong API Key.
- **01a179ab (26 19:24)** - disposed with 1 pending tool call.
