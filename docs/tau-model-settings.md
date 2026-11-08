# Tau model-specific settings

> Catalog of every tau model setting, its source, and its resolved value.
> Companion doc: `docs/kappa-model-settings.md` (kappa's mirror — a change in
> only one agent is half a change; keep both in sync).
>
> **Model identity chain** (anomaly #3): the model that actually executes is
> NOT the CLI tag. It resolves through: provider catalog → `models.yml` →
> provider/model overrides → `modelRoles` → agent frontmatter list → parent
> active/default fallback. The roster's resolved model is ground truth.
>
> **Declared ≠ Observed** (anomaly #2): never trust a catalog field as
> behavioral fact. Verify with a live probe before relying on it. Example:
> `deepseek-v4-flash` advertises image input but 400s on vision requests
> (verified 2026-11-05); `nemotron-3.5-lightning-30b-a3b` is text-only on the
> NVIDIA endpoint despite being listed as a vision fallback.

## 1. The resolution chain (how a role becomes a model)

```
provider catalog (mimetite src/data.ts)
  → models.yml (pinax-generated, DO NOT EDIT BY HAND)
  → provider overrides (config.yml providers.*)
  → model overrides (models.yml provider.models[], config.yml)
  → modelRoles (config.yml modelRoles.<role>)
  → agent frontmatter model list (per-agent)
  → parent active/default fallback
```

Resolution code: `packages/coding-agent/src/config/model-resolver.ts`
(`resolveModelRole`, `resolveProviderModelReference`). The registry that
composes the catalog: `packages/coding-agent/src/config/model-registry.ts`.

## 2. `modelRoles` — the primary role→model map

Source: `~/.tau/agent/config.yml` → `modelRoles:` (16 roles).

| Role | Resolved model | Lane | Notes |
|---|---|---|---|
| `default` | `zai/glm-4.7-flash:minimal` | zai | main interactive model |
| `smol` | `freeinference/glm-5.3-flash` | freeinference | fast/light |
| `slow` | `freeinference/deepseek-v4-flash:high` | freeinference | high reasoning effort |
| `vision` | `freeinference/glm-5.3-flash` | freeinference | VL lane |
| `plan` | `freeinference/qwen3.6-35b` | freeinference | planning |
| `advisor` | `freeinference/qwen3.6-35b` | freeinference | tauvisor |
| `judge` | `typesafe/jev-latest` | typesafe | evaluation |
| `task` | `freeinference/glm-5.3-flash` | freeinference | subagent tasks |
| `commit` | `freeinference/glm-5.3-flash` | freeinference | commit messages |
| `tiny` | `freeinference/glm-5.3-flash` | freeinference | tiny inference |
| `memory` | `freeinference/glm-5.3-flash` | freeinference | memory ops |
| `verification` | `freeinference/glm-5.3-flash` | freeinference | verification |
| `fallback` | `freeinference/glm-5.3-flash` | freeinference | fallback lane |
| `web` | `web/exa` | web | web search |
| `dots` | `custom/dots` | custom | dots agent |
| `bodybuilder` | `custom/bodybuilder` | custom | bodybuilder agent |

`cycleOrder: [smol, default, slow]` — the Ctrl-P cycle order.

## 3. Provider catalog (models.yml)

Source: `~/.tau/models.yml` — **pinax-generated** from mimetite
`pens/geode/products/mimetite/src/data.ts`. DO NOT EDIT BY HAND; regenerate
with `bun run build` in the catalog source.

Providers declared (with baseUrl + apiKey source):

| Provider | baseUrl | apiKey | Models |
|---|---|---|---|
| `flock` | `http://127.0.0.1:25193/v1` | `!cat ~/.tau/flock.key` | discovery |
| `freeinference` | `http://127.0.0.1:25109/freeinference` | `!cat ~/.tau/freeinference.key` | `glm-5.3-flash`, `qwen3.6-35b`, `deepseek-v4-flash` (reasoning) |
| `nvidia` | `https://integrate.api.nvidia.com/v1` | `NVIDIA_API_KEY` | discovery |
| `moonshot`/`groq`/`cerebras`/`deepseek`/`zen`/`chutes`/`cohere`/`github`/`parasail`/`openrouter` | provider-native | env key | discovery |
| `google` | `http://127.0.0.1:25109/gemini-eap-interactions` | none | `models/gemini-*` (1M ctx) |

**Critical**: freeinference baseUrl is `http://127.0.0.1:25109/freeinference`
WITHOUT `/v1` — the keypool appends the request path to its upstream
(`https://freeinference.org/v1`). A `/v1` here doubles it and every call 404s
(the 404 bug).

## 4. Provider overrides (config.yml `providers.*`)

Source: `~/.tau/agent/config.yml` → `providers:`.

| Key | Value | Effect |
|---|---|---|
| `providers.freeinference.baseUrl` | `http://127.0.0.1:25109/freeinference` | keypool lane |
| `providers.freeinference.apiKey` | `!cat ~/.tau/freeinference.key` | key from file |
|| `providers.openai-compatible.baseUrl` | `http://127.0.0.1:25193/v1` | mimetite |
|| `providers.openai-compatible.apiKey` | (corral JWT) | mimetite auth |
| `providers.vercel-ai-gateway` | `https://ai-gateway.vercel.sh/v1` | vercel gateway |
| `providers.maxInFlightRequests.openai-compatible` | `16` | concurrency cap |
| `providers.anthropic.serverSideFallback` | `true` | anthropic fallback |

## 5. Subagent model

Source: `~/.tau/agent/config.yml` → `subagents:`.

- `subagents.defaultModel: freeinference/qwen3.6-35b` — default for spawned subagents.
- `subagents.subagent: inherit` — subagents inherit the parent model by default.
- `subagents.whitelist`: `[task, plan, review, auditor, critic, explorer, analyst, debugger]`.

## 6. Retry / fallback chains

Source: `~/.tau/agent/config.yml` → `retry.fallbackChains`.

| Chain | Order |
|---|---|
| `fallback` | `freeinference/glm-5.3-flash` → `deepseek-v4-flash` → `qwen3.6-35b` → `google/models/gemini-*` → `openrouter/*` |
| `freeinference/*` | `qwen3.6-35b` → `deepseek-v4-flash` → `glm-5.3-flash` → `minimax-m3` |
| `openrouter/*` | `freeinference/glm-5.3-flash` → `qwen3.6-35b` → `deepseek-v4-flash` |
| `default` | `typesafe/jev-latest` → `freeinference/qwen3.6-35b` → `glm-5.3-flash` → `deepseek-v4-flash` |
| `web` | `web/tavily` → `web/firecrawl` → `web/brave` → `web/parallel` → `web/synthetic` → `google-antigravity/gemini-3.8-flash` |
| `judge` | `typesafe/jev-latest` → `freeinference/deepseek-v4-flash` → `qwen3.6-35b` → `glm-5.3-flash` |

`retry.modelFallback: true`, `maxRetries: 3`, `maxDelayMs: 300000`,
`usageAwareFallback: true`, `usageReservePct: 10`.

## 7. Effort / reasoning

Source: `~/.tau/agent/config.yml`.

- `effort.high: 0.9`, `effort.ultrathink: 0.99` — reasoning effort levels.
- `task.enableEffort: true`, `task.maxEffort: high` — subagent effort gate.
- `defaultThinkingLevel: auto`, `proseOnlyThinking: true`, `omitThinking: false`.
- `modelRoles.slow: freeinference/deepseek-v4-flash:high` — the `:high` suffix sets high reasoning effort.
- **Reasoning budget** (anomaly #1): reasoning + content share ONE max_tokens ceiling. With reasoning on, `max_tokens ≥ 2500` or content starves (finish=length, empty content).

## 8. Embeddings (mnemopi)

Source: `~/.tau/agent/config.yml` → `mnemopi:`.

- `embeddingModel: bge-m3` — the estate default embedding lane.
- `embeddingApiUrl: https://freeinference.org/v1`, `embeddingApiKey: !cat ~/.tau/freeinference.key`.
- `embeddingDimension: 1024`, `embeddingVariant: en`.
- `llmMode: smol` — memory LLM mode.

## 9. Output-token ceilings

Two mechanisms cap `max_tokens` at the true upstream ceiling:

1. **Curated** — `packages/catalog/src/output-ceilings.ts`
   `CURATED_OUTPUT_CEILINGS`: `meta/muse-spark-1.2-contributor` → 131072,
   `poolside/laguna-s-2.1-free` → 32768, `z-ai/glm-4.6v-flash(-free)` → 32768.
   Applied at request-build as a `Math.min` term (only lowers, never raises).
   The adaptive learner (`learnOutputCeilingFromError` in the ai package)
   handles un-curated models.
2. **Algorithmic discovery** — `pens/geode/products/mimetite/src/max-output-probe.ts`
   (`discoverMaxOutputs`): metadata probe reads `max_tokens`/`max_completion_tokens`/
   `max_output_tokens` from `/v1/models`, then binary-searches the largest
   accepted value with a real chat-completion probe. Emits `maxOutputTokens`
   into models.yml so request-build clamps to the real ceiling.

## 10. Agent frontmatter model list

Per-agent frontmatter can list candidate models. The resolver walks the list
and selects the first that is available (credentialed + not suppressed). If no
frontmatter model matches, it falls back to the parent's active model, then
`modelRoles.default`. See `model-resolver.ts` `resolveModelRole`.

## 11. Live-verified caveats (2026-11-05)

- `freeinference/deepseek-v4-flash` advertises image input (`input_modalities`)
  but **400s on vision requests** — do not route vision through it.
- `nvidia/nemotron-3.5-lightning-30b-a3b` is **text-only** on the NVIDIA
  endpoint (400 "multimodal processing not enabled") — not a vision fallback.
  Use `nvidia/nemotron-3.5-super-vl-120b-a12b` for NVIDIA vision (content-safety
  gated).
- The three qwen attempts in mimetite are suspect (architect 2026-11-05) —
  -  treat the mimetite qwen provider config as unverified until live-tested.