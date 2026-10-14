# Dots 3 Recon Fixes

Landings from the Dots 3 Note recon (2026-10-13). All eight fixes shipped across tau, cuttinggate, flock-proxy, and dots-client.

## Landed

### 1. List-as-string coercion — `a180f13c7f`

**Problem:** Dots returns markdown checklists as plain strings where the schema expects arrays. The coercion layer dropped them.

**Fix:** Recover markdown-checklist strings as arrays in the coercion layer (`packages/ai/src/dialect/coercion.ts`) plus the todo schema. Covered by `packages/ai/test/coercion-dots-list.test.ts`.

**Also in `a180f13c7f`** (8 upstream failure patches + Bun 1.4.3 compat):
- TUI transcript memory leak: decouple render cache release from frontier retirement (fixes 10.4GB RSS on 40h sessions)
- Subagent revive: reuse persisted park-time system prompt instead of re-rendering (prompt cache hits)
- DeepSeek: drop trailing orphan tool result instead of synthesizing note without reasoning_text (fixes deterministic 400)
- Natives: extract only selected addon variant, not all 380MB (cherry-pick #15465)
- Xiaomi: invalidate in-memory auth on model switch (fixes process-wide 401s)
- Codex SSE: fresh AbortController per retry (fixes aborted-signal retry death)
- worktree.clone: never clone secret-shaped files (.env*, *.key, *.pem, credentials*, secrets*)
- Shell read: spawn_blocking for process substitution (cherry-pick #15465, fixes deadlock)
- Bun 1.4.3: ttyid.ts CString compat (plain string on 1.4+)

### 2. Forced tool_choice retry + Dots max_tokens floors — `f946a2cc2a`

**Problem (forced tool_choice):** When `tool_choice` is forced, Dots degrades to returning empty-args `[]` instead of real tool calls. The correct data comes back when `tool_choice` is `auto`.

**Fix:** Detect the empty-args `[]` degradation under forced tool_choice and retry with `auto` (`packages/ai/src/utils/forced-tool-retry.ts`). Covered by `packages/ai/test/forced-tool-retry.test.ts` (5 tests).

**Problem (max_tokens):** Reasoning models starve on low token limits — they burn tokens thinking, then die before producing output.

**Fix:** Dots-specific max_tokens floors: 256 for text-only, 512 when tools are involved, 1024 for replay/continuation. Covered by `packages/ai/test/dots-max-tokens-floors.test.ts` (3 tests, 14 assertions).

**Files:** `packages/ai/src/providers/openai-completions.ts`, `packages/ai/src/providers/openai-responses.ts`, `packages/ai/src/providers/openai-shared.ts`, `packages/ai/src/utils/forced-tool-retry.ts`.

### 3. Forge parseArgs strict:false — `b9cd53e` (ranch)

**Problem:** Node's `util.parseArgs` defaults to `strict:true`, throwing TypeError on unknown options (`--top`, `--root`, etc). Found during Dots recon.

**Fix:** `parseArgs({ strict: false, allowPositionals: true })` in `forge/bin/forge`. One line, in the ranch repo (not tau).

### 4. Replay reasoning preservation + general tool-arg chunking — `5ab11e7632`

**Problem:** Reasoning content was lost on replay/continuation, and large tool-argument array payloads (>100 items) caused truncation/failures.

**Fix:** Preserve `reasoning_details` across replay turns and implement general tool-argument array chunking in `packages/ai` and `packages/agent`.

### 5. SovereignDotsClient coercions ported to tau — `241581cd83`

**Problem:** Direct Dots-3-Note calls needed deterministic temperature (0.1), reasoning budget clamp (128 tokens, `exclude: true`), and assistant `content: null -> ""` replay normalization.

**Fix:** Added `applyDotsRequestShaping` in `packages/ai/src/providers/openai-shared.ts` and test suite `packages/ai/test/dots-request-shaping.test.ts`.

### 6. Generalized OpenRouter coercions & stop/require_parameters guard — `c917869ef7` + sync

**Problem:** Live OpenRouter measurements showed two upstream routing failures:
1. Combining custom `stop` sequences with `provider.require_parameters: true` causes OpenRouter to return HTTP 404 `"no endpoints found"` (each works alone).
2. Injecting `strict: true` + `additionalProperties: false` on tool schemas without an opt-in narrows provider routing and causes 404s on providers that reject strict schema validation.

**Fix:** Generalized `applyOpenRouterCoercions` in `packages/ai/src/providers/openrouter-coercion.ts` (covered by `packages/ai/test/openrouter-coercion.test.ts`) and synchronized the `stop` vs. `require_parameters: true` guard and fill-in-only `reasoning` shaping across:
- `tau/packages/ai/src/providers/openai-shared.ts` (`applyDotsRequestShaping`)
- `dots-client/sovereign_dots_client.py`
- `mesh/proxy/cuttinggate/src/dots.ts`
- `mesh/proxy/flock-proxy/src/dots.rs`

### 7. Empty-content retry for reasoning->content boundary death — `9020f9d246`

**Problem:** Reasoning models occasionally terminate at the reasoning-to-content boundary with empty assistant content and no tool calls.

**Fix:** Added automatic empty-content retry in `packages/ai`.
