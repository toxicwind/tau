# Detached keeper — sessions survive a killed TUI

2026-10-31. Root fix for "tau is still not correctly daemonized: sessions
should continue on kill of TUI".

## What was wrong

The interactive TUI (`modes/interactive-mode.ts`) owns the `AgentSession` **in
the TUI process**. There is no session-host daemon:

- The per-project daemon broker (`launch/broker.ts`) supervises **service
  daemons** (the `proc://` surface), never agent sessions.
- `tau acp` hosts sessions server-side, but only for editor clients.
- **`launch/auto-join.ts` (refactored 2026-10-31) made it worse, not better**:
  every interactive session registered ITSELF into the broker as a
  `restart: "always"` PTY daemon with `application: process.execPath` — the
  compiled binary's in-memory bunfs path (`/$bunfs/root/tau`). The broker kept
  respawning full TUI copies whose mangled argv turned the leaked self-path
  into a **user prompt** — ghost sessions running unintended agentic turns
  (~90 procs/min fork storm on 2026-10-30; ghost build turns on 2026-10-31;
  14 ghost daemons purged with the fix). Auto-join now registers presence
  only (squawk fleet card + heartbeat).
- On SIGHUP/SIGTERM, postmortem's default handlers ran the session-teardown
  registration and **exited unconditionally** — killing the in-flight turn,
  queued messages, and owned subagents. Result: every terminal close / tmux
  kill-session / `kill <pid>` aborted mid-turn work (the `sighup`/`sigterm`
  abort records in the session forensics).

A true session-host daemon (TUI as a thin client) remains the long-term
architecture (kappa parity: kappa's daemon hosts its sessions). That is a full
client/server refactor of the 7k-line `InteractiveMode` binding. The detached
keeper is the fix that makes TUI death non-fatal for sessions **today**.

## What changed

1. **`packages/utils/src/postmortem.ts`** — sanctioned signal takeover:
   `takeoverSignalHandler("SIGTERM" | "SIGHUP")` removes the module's default
   handler so an owner can implement its own policy; `runTakenOverSignalCleanup(reason)`
   runs the full (exit-settling) cleanup pass for the taken-over signal.
2. **`modes/session-teardown.ts`** — `resolveFatalSignalAction(reason, workInFlight, alreadyDetached)`:
   - SIGTERM/SIGHUP + work in flight + not yet detached → **detach**
   - SIGINT (Ctrl+C) stays the abort path → teardown
   - no work in flight → teardown (original contract, exit 128+n)
   - second signal while detached → teardown (escape hatch)
3. **`modes/interactive-mode.ts`** — `#installHangupSignalPolicy()` (init, POSIX
   only) takes over both signals; `#detachAndKeep()`:
   - persists the editor draft, aborts UI-owned continuation loops (loop mode
     auto-submit), uninstalls **only the UI layer** (`#stopUiForDetach()`:
     render subscriptions, share publisher, recorder, status line, TUI stop —
     keeps the postmortem teardown registration, goal/todo continuation
     timers, agent-registry publication, collab, eval kernels, browser tabs),
   - then quiesces like `checkShutdownRequested` (`waitForIdle()` +
     admitted submissions + queued messages + async jobs),
   - then disposes the session normally (clean `session_exit`) and exits 0.
   - A second SIGTERM/SIGHUP is the **escape hatch**: dispose now, exit 143/129.

## What is and isn't covered

- Covered: SIGTERM, SIGHUP (terminal close, tmux kill-session, `kill`, SSH
  drop). The turn, queued messages, admitted submissions, owned async jobs
  (detached subagents), eval kernels, and owned browser tabs all continue
  headless; the transcript persists every message; the session exits with a
  **clean** exit record so `tau --resume <id>` shows completed work.
- Not covered: SIGKILL — nothing in this design survives SIGKILL of the TUI
  process; only a real session-host daemon could.
- A turn that hits a tool-approval prompt while detached **stalls** (nothing
  can answer it). That is deliberate (fail-closed, never auto-approve); the
  escape hatch (second signal) releases it.
- `tau share` viewers and screen recording end at detach (they surface the UI).

## Kappa parity note

kappa's daemon hosts its sessions, so its TUI is disposable today. tau's
equivalent is `tau acp` (session-hosting server) + this keeper. When a real
tau session-host daemon lands, it must mirror the kappa daemon contract:
sessions owned by the daemon, TUI/UI as re-attachable clients, daemon
supervised by pitchfork.

## Follow-up design: session-host daemon (not yet built)

The keeper survives every *catchable* signal but not SIGKILL, and the next
`tau` cold-resumes from JSONL. The endgame is a headless session server so the
TUI is a disposable client:

- A daemon owns the `AgentSession` lifecycle in memory across client
  connects/disconnects, scoped per project, reusing the daemon-broker socket
  machinery (`launch/client.ts` `SocketDaemonClient`, `daemonClientForProject`,
  token file). Disposal only on explicit server shutdown or a settled
  `session_exit kind=normal` — never as part of "session survives".
- `tau` with a TTY starts/adopts the server if absent; `tau --attach <id>`
  connects to a live session. Killing the TUI closes only the client socket;
  the server keeps running; the next `tau` re-attaches to the live
  `AgentSession` (in-flight turn, queues, async jobs intact) instead of
  cold-resuming. SIGINT stays the abort path; SIGTERM/SIGHUP on the client
  just detach.
- Scope discipline: prove single-TUI detach/re-attach first. No multi-client
  collab, no ACP forwarding, no web UI in that change.
- The keeper (this document) remains the fallback for TUI-owned state and the
  safety net if the daemon is down.
