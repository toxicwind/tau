# TTSR turn-storm gate — tau fork feature (2026-11-02)

## The defect (verified: 244 injections, one session)

`no-output-truncation` (and any tool-arg-text rule whose injected body re-mentions
its own tokens) re-fired on every retry. Mechanism: `#canTrigger` gaps on
`messageCount`, which only advances per real turn; a TTSR hit aborts + retries the
stream via `continue()` WITHOUT advancing messageCount, so the injected reminder
(text containing `head`/`tail`) re-matched its own condition on each retry.

## What upstream (can1357/oh-my-pi) had

`StreamBuffer`/`ConditionScan` with **settled-per-buffer** semantics (added
2026-10-17 #14693, paced #16974): a rule that matched a buffer settles and never
re-matches that buffer. This stops per-buffer re-fires but NOT retry re-fires:
upstream resets the buffer per stream retry, so the same rule can re-fire after a
retry regardless.

## The fork's addition (new feature): settled-per-TURN

`#firedThisTurn` — a rule fired in the current monotonic turn stays fired until a
REAL new turn (`incrementMessageCount`), not until a buffer reset. Wired at the
single injection funnel (`#markInjected`), so retries (`continue()` without
`onTurnEnd`) cannot re-trigger the rule they just violated. This is strictly
stronger than upstream: same-per-buffer settlement PLUS turn-level settlement.

## Evidence

- Storm test: `test/ttsr-coordinator-buffer.test.ts` — first delta matches, retry
  with self-referential reminder returns 0. 48/48 across 5 TTSR/rule suites.
- Commit `0b189631a0` (tau main).

## Superiority note

Fork carries upstream settled-per-buffer + adds settled-per-turn; upstream alone
cannot stop retry storms. The remaining upstream-only mechanism (paced rescan
threshold `FULL_RESCAN_*`) is a perf nicety for long unterminated lines, not a
correctness gap.