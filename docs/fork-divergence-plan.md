# OMP-UNDER / OVERLAY-ON-TOP — the maximal fork architecture

> **The idea:** stop diverging *in place*. Make the base tree **upstream-verbatim**
> (can1357/oh-my-pi 18.16.0), lift every fork divergence into an **overlay layer
> on top**, feature-flag each overlay, and let **weave** own the merge boundary.
> Settings flags are the runtime switch; the overlay module is the structural
> isolation; weave is the versioned before/after; the restored upstream contract
> tests + benches are the comparison harness.
>
> Status: PLAN (2026-11-02). Architect: "i trust you fully to take this somewhere
> cutting edge and emergent."

## The mental model

```
┌─────────────────────────────────────────────────┐
│  OVERLAY (ours, flag-gated)                     │  forkDivergence.* flags
│  src/fork/<contract>.ts        ← fork semantics │  pick per contract
│  src/upstream/<contract>.ts    ← their semantics │
│  src/fork-divergence/index.ts  ← THE SEAM       │
├─────────────────────────────────────────────────┤
│  UNDERLAY (theirs, verbatim)                    │  git merge upstream/main
│  upstream-verbatim tree (18.16.0)               │  via weave-driver
│  grep/sed/read/bash-interactive/…               │  entity-level, 98 types
└─────────────────────────────────────────────────┘
```

- **Merging upstream** touches the underlay + (rarely) the seam — never the
  overlay bodies. Conflicts collapse to one file class.
- **Our behavior** = overlay selected by flag. **Their behavior** = underlay
  selected by flag. Same binary, real A/B.
- **The comparison** = restored upstream contract tests (red/green per side)
  + benches on identical corpora, results ledgered.

## Phase 0 — Ground truth (DONE, verified live)
- Fork point: `.upstream-sync.json` base `dacdef24` (v18.3.0, recorded Oct 9).
- Upstream HEAD `83de60ad99` (**v18.16.0**, 2026-11-03) — we are **1 commit
  behind, 221 ahead** (fork commits; upstream work absorbed as divergence).
- Weave divergence set (base × HEAD × upstream/main): **2911 files**.
- Upstream ships `bashInterceptor.enabled: default:false` — the dead interceptor
  is UPSTREAM's bug too (can1357 shipped it; we forked it).
- Upstream ships 81 tool tests we deleted (grep-exclude/pagination/url-selectors,
  glob-directories, read-head-tail-list, bash-interactive, bash-url-filesystem,
  eval-timeout-contract, bash-interceptor). **Restored + ported to tau roots
  2026-11-02** (commit on this branch); 40 pass / 12 fail = the divergence
  surface. bre.rs is NOT deleted (MIRROR-DIFF lies; verified `mod bre` live).
- Weave merge driver live in this repo (98 types, `.ts/.rs/.tsx` covered);
  weave-driver 0.5.4.

## Phase 1 — THE UNDERLAY MERGE (weave-driven)
1. Branch: `git switch -c upstream-merge-18.16`
2. `git merge upstream/main` — weave resolves entity-level per .gitattributes
3. `WEAVE_FINDINGS=1` → per-file `.weave-findings.json` for conflicts; collect
   into the divergence ledger (Phase 3).
4. Sweep the path map (`crates/pi-* → crates/tau-*` etc. from
   `.upstream-sync.json`) over any new upstream files.
5. Gate: `bun run validate`-equivalents per package + the restored tool tests.
6. Land forward-only; record new `theirs` in `.upstream-sync.json`.
- Risk: 2911 files; weave's ~95% entity auto-resolution leaves ~150 hand-merges,
  each guided by findings JSON. Merge happens on a branch; main untouched until
  green.

## Phase 2 — THE OVERLAY EXTRACTION
For each contract in the divergence ledger:
1. **Extract** the fork implementation to `src/fork/<contract>.ts`
   (pure functions; no I/O; session-independent where possible).
2. **Port** upstream's implementation to `src/upstream/<contract>.ts`
   (from upstream main, compiled in-tree, imports = tau roots).
3. **The seam** `src/fork-divergence/index.ts` resolves per flag:
   `divergenceFor(session) → contracts`. Callers import ONLY the seam.
4. Flag defaults: fork-true (zero behavior change on land).
Initial contracts (from the 12 red tests):
   - `grepPathSemantics` — fork-literal vs upstream `!glob` exclusions
   - `sedBreSemantics` — fork per-pattern fallback vs upstream strict BRE→ERE
   - `interceptorPolicy` — fork rewrite-to-kairos vs upstream hard-block
   - `approvalGate` — interceptor runs pre-approval (upstream) vs fork's
     approval-first flow
Files already scaffolded: `src/fork-divergence/{index,types}.ts`,
`src/fork-divergence/fork/index.ts` (grep/sed/interceptor contracts).

## Phase 3 — THE DIVERGENCE LEDGER (emergent piece)
Extend `.upstream-sync.json` with:
```jsonc
"divergences": [{
  "id": "grep-path-semantics",
  "flag": "forkDivergence.grepExclusions",
  "forkImpl": "src/fork/grep-path.ts",
  "upstreamImpl": "src/upstream/grep-path.ts",
  "upstreamRefs": ["tools/grep.ts", "path-utils.ts"],
  "weaveFindings": ".weave/grep.ts.findings.json",   // entity refs
  "tests": ["test/tools/grep-exclude.test.ts"],      // gates BOTH sides
  "bench": "bench/grep-semantics.bench.ts",
  "why": "fork rewrite for archives/virtual/line-ranges",
  "decided": "2026-11-02: fork default; upstream impl kept compilable"
}]
```
Every upstream merge updates the ledger from weave findings — the merge itself
reports which contracts moved upstream and which flags need re-review.

## Phase 4 — THE COMPARISON HARNESS
1. **Tests**: restored upstream contract tests read the flag —
   `it("upstream exclusions", { skip: flag-on ? "fork mode" : false }, ...)`
   so one suite pins both. The 12 reds become the fork-mode regression gate.
2. **Bench** `bench/grep-semantics.bench.ts`: identical corpora (tau repo +
   vendor/pkg fixture trees), measures: bare grep, `!glob` exclusion parse,
   BRE `\|` alternation translation, fork-native vs upstream paths. Output:
   `bench/results/grep-semantics-<date>.json` + md table.
3. **A/B record**: flip flag → re-run → both rows ledgered. The estate's
   agentic-moment layer ships results as dataframes (dedupe-keyed).

## Phase 5 — OPERATOR SURFACE
- `tau divergence list` — ledger table (contract, flag, mode, last bench).
- `tau divergence bench <id>` — run A/B, print before/after.
- `tau divergence flip <id>` — toggle + validate-gate + record decision.
- Session-level override: `--divergence grepExclusions=upstream`.

## Phase 6 — CUTTING-EDGE / EMERGENT (the part worth existing for)
1. **Entity-level A/B**: weave parses entities; the bench reports divergence
   per FUNCTION, not per file — "fork changed fn X, upstream changed fn X
   differently" → the seam auto-suggests re-review of that contract only.
2. **Merge-guided flagging**: WEAVE_FINDINGS JSON on merge → new divergences
   mint ledger entries AUTOMATICALLY (scaffold: flag + impls + test-gate
   skeleton), so the overlay is always exactly as big as the real divergence.
3. **Live flip in-session**: flags are settings — a flipped flag + tool
   re-registration = hot A/B inside a running session (settings layer already
   supports it; validate gate runs on flip).
4. **Kappa mirror note**: kappa is NOT an oh-my-pi fork (different engine), so
   the seam is tau-only; kappa's equivalent doctrine = its own tool-policy
   layer. Mirrored BEHAVIOR (interceptor→kairos rewrite) lands in kappa's
   policy file per AGENTS.md half-a-change rule, not this seam.

## Execution order (this session)
1. ✅ Ground truth + restored tests (committed)
2. → Plan doc (this file)
3. → Phase 2 scaffold (seam + fork impls exist; add upstream impls + wire grep)
4. → Phase 4 bench skeleton + run on the 12-red corpus
5. → Phase 1 merge (branch, weave, findings → ledger) — the big one
6. Commit/push tau + estate docs at each phase boundary (save-as-we-go)
