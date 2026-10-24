# tau-loops

Audit loops for the estate-scripts stack, packaged as an omp extension.

These exist because the same three investigations kept being done by hand, and
each hand-run version got subtly wrong. Every loop below reads live state and
fails loud rather than reporting a plausible empty result.

## Commands

| Command | What it does |
|---|---|
| `/loop-model-audit [configPath]` | Enumerates every model reference in a config, resolves the roles the engine knows about, probes each distinct reference for real, and classifies the result. |
| `/loop-dir-diff <leftDir> <rightDir>` | Diffs two trees, then censuses the tree for references to either. This tells you which copy is live before you delete one. |
| `/loop-probe <file.ts> [model] [prompt]` | Runs a throwaway extension under `omp -p` and reads back the JSON it wrote. Treats a silent no-result as a failure. |

## Why model-audit exists

An undefined `modelRoles` entry does not fall back to `default`. It falls through
to the engine's own `priority.json`, and every entry in those lists is a paid
model. So one undefined role becomes a 402 on every turn, with nothing in the
config saying so.

The loop reports two separate things. First, undefined roles, read from the
engine's own `MODEL_ROLE_IDS` rather than a copy, so a role the engine adds
later cannot go unreported. Second, live verdicts, one real HTTP request per
distinct reference, classified as `ok`, `no-credits`, `not-found`, `no-auth`,
`rate-limited`, `timeout`, or `error`.

A live run against this box's config found nine real problems. One of them was
the configured default model timing out at 20s.

### Providers that are not chat endpoints

`web/exa` and its siblings are search providers served by the engine, not
OpenAI-compatible chat models. Probing them returns
`400 exa is not a valid model ID`. That reads like a broken config entry and is
not one. They are reported under `NOT PROBED` instead of `DEAD OR DEGRADED`.

## Why dir-diff exists

Two copies of the same thing are the normal state here, and looking at either
one never answers which is live. `diffTrees` says what changed.
`censusConsumers` says who still points at each. A directory with zero
references is a real measurement, not an assumption.

Buckets are keyed by relative path, not content hash. Two files with identical
bytes at different paths land in `onlyInLeft` and `onlyInRight`, never in
`identical`. The twin-directory case is only visible through the path-keyed
intersection.

## Why probe-runner exists

Writing a throwaway `.ts` extension, running it under `omp -p`, and reading back
its output is four steps that are easy to get subtly wrong. A probe that wrote
nothing looks exactly like a probe that found nothing. `runProbe` deletes any
stale output first and reports `ok: false` when the extension wrote no parseable
JSON.

## Latency instrumentation

`src/timing.ts` carries the measurement primitives the loops run on.

`measure` and `measureAsync` record a timing even when the step throws. A slow
failure is data. If the throw skipped the record, the one case worth
investigating would be the one leaving no trace.

`race` fires every strategy at once and takes the first valid result. The
fastest valid strategy wins, not the first-listed one. A strategy that throws is
recorded as a loser rather than escaping. An early invalid result does not beat a
later valid one.

`probePort` is TCP liveness with a deadline that is actually honoured. It used
to accept a timeout and ignore it, so a filtered port hung instead of reporting
down.

`recordWinner` and `readWinners` append wins to
`~/.cache/fleet-bus/hft_race_winners.jsonl`, so the next run leads with the
known-good strategy instead of re-discovering it.

Tracing goes to stderr as NDJSON. Set `TAU_LOOPS_TRACE=0` to silence it.
`TAU_LOOPS_WINNERS_LOG` redirects the winners log.

## Development

```sh
bun run typecheck
bun test
```

The live audit runs from the estate-scripts root so `.secrets` is loadable.

```sh
cd /home/toxic/estate
set -a && . ./config/.secrets && set +a
bun projects/tau-extensions/packages/tau-loops/scripts/run-model-audit.ts
```
