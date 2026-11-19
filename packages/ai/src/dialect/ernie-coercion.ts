/**
 * ernie-coercion.ts — ERNIE model-specific tool-argument coercion recovery
 * and request shaping for the ERNIE 5.5 family (baidu/ernie-5.5-flash-preview:free).
 *
 * Why this exists: ERNIE 5.5 Flash Preview is a text-only, thinking-effort model
 * (mode "effort", only supported effort = "high", reasoning required) served over
 * OpenRouter. Like the FreeInference family, it can mis-render tool arguments:
 *  - flat string-array tool args rendered as per-item markdown checklists inside
 *    the JSON array (`items: ["- [ ] task", ...]`) — the FreeInference shape;
 *  - double-encoded JSON containers (a string that still parses) — the DeepSeek shape;
 *  - list:string tool-arg mismatches and ghost reasoning tails — the OpenRouter shapes.
 *
 * ERNIE's compat surface (from live request introspection 2026-11-12):
 *  - thinking: mode "effort", efforts ["high"], defaultLevel "high", requiresEffort: true
 *  - reasoning: true; reasoningContentField: "reasoning_content"
 *  - requiresReasoningContentForToolCalls: true
 *  - maxTokensField: "max_completion_tokens"
 *  - thinkingFormat: "openrouter"; reasoningEffortMap: {}
 *  - isOpenRouterHost: true (routed via https://openrouter.ai/api/v1)
 *  - supportsComputerUse: false; input: ["text"] (text-only, no vision)
 *  - cost: free (0 in/out/cache)
 *
 * This module is the per-model contract surface: it documents ERNIE's coercion
 * needs and exposes the shared recoverers (parseMarkdownItem/parseMarkdownList/
 * decodeValue/coerceValue from ./coercion). Consumers call coerceErnieValue for
 * tool-arg values and applyErnieRequestShaping for the request body.
 *
 * NOTE: ERNIE is OpenRouter-hosted, so the openrouter-coercion request shaping
 * (temperature, provider.require_parameters, allow_fallbacks, strict tool schemas)
 * applies as well — but ERNIE's reasoning is DELIBERATE (effort=high, reasoning
 * required), so the reasoning cap is opt-in per call site (parity with the
 * openrouter-coercion "reasoning: false by default" decision). Re-adding a
 * reasoning object would clobber the effort=high decision.
 */
import { coerceValue, decodeValue, parseMarkdownItem, parseMarkdownList } from "./coercion";
import {
	applyOpenRouterRequestShaping,
	normalizeOpenRouterMessages,
	applyOpenRouterStrictToolSchemas,
} from "../providers/openrouter-coercion";
import type { OpenRouterCoercionGate, OpenRouterRequestShapingOptions } from "../providers/openrouter-coercion";

/** The ERNIE 5.5 Flash Preview model id (free tier). */
export const ERNIE_MODEL_ID = "baidu/ernie-5.5-flash-preview:free" as const;

/** ERNIE 5.5 family model ids that emit tool calls (text-only). */
export const ERNIE_TOOL_MODELS = [ERNIE_MODEL_ID] as const;

export type ErnieModel = (typeof ERNIE_TOOL_MODELS)[number];

/** True when this model id is an ERNIE 5.5 family model. */
export function isErnieModel(modelId: string | undefined | null): boolean {
	if (!modelId) return false;
	return (ERNIE_TOOL_MODELS as readonly string[]).includes(modelId);
}

/**
 * Coerce an ERNIE tool-argument value against its JSON schema.
 * Uses the shared coercion engine: string-only args pass verbatim; everything
 * else is decodeValue'd (double-encoded unwrapping + markdown-list recovery).
 */
export function coerceErnieValue(raw: string, schema: unknown): unknown {
	return coerceValue(raw, schema);
}

/**
 * Reasoning-at-a-third doctrine (AGENTS.md): ERNIE 5.5 Flash Preview is a
 * thinking-effort model whose reasoning shares the same max-token ceiling as
 * its output (maxTokens 921,600). Cap the thinking budget at ~1/3 of the
 * effective max tokens so reasoning never starves the actual completion
 * (the length-starvation trap). Same doctrine as FreeInference's
 * resolveFreeInferenceThinkingBudget — ERNIE is a thinking model, so it needs
 * the same cap.
 */
export const ERNIE_THINKING_BUDGET_RATIO = 1 / 3;

/**
 * Resolve the thinking budget for ERNIE so reasoning uses at most ~1/3 of the
 * effective max-token ceiling. Prefers an explicit caller budget when one is
 * already set; otherwise derives the cap from the model's max tokens. Returns
 * the platform floor when the model reports no cap.
 */
export function resolveErnieThinkingBudget(
	modelMaxTokens: number | null,
	explicitBudget?: number,
	platformFloor = 1024,
): number {
	if (explicitBudget !== undefined && explicitBudget > 0) return explicitBudget;
	const cap = modelMaxTokens === null ? platformFloor : Math.floor(modelMaxTokens * ERNIE_THINKING_BUDGET_RATIO);
	return Math.max(cap, platformFloor);
}

/**
 * ERNIE request-shaping options. ERNIE is OpenRouter-hosted, so the
 * openrouter-coercion request shaping applies. Defaults:
 *  - temperature: true (deterministic tool use when unspecified)
 *  - stopSequences: true (cut ghost reasoning tails)
 *  - reasoning: FALSE by default — ERNIE's reasoning is deliberate (effort=high,
 *    reasoning required); the reasoning cap is opt-in per call site so it never
 *    clobbers the effort decision.
 */
export function applyErnieRequestShaping(
	params: Record<string, unknown>,
	gate: OpenRouterCoercionGate,
	options: OpenRouterRequestShapingOptions = {},
): void {
	// ERNIE is OpenRouter-hosted; reuse the openrouter request shaping verbatim.
	// reasoning defaults to false (ERNIE owns its effort=high reasoning config).
	applyOpenRouterRequestShaping(params, gate, { reasoning: false, ...options });
}

/**
 * Normalize prior assistant messages for ERNIE: content null/undefined -> "".
 * ERNIE is OpenRouter-routed, so the null-content replay crash applies. Returns
 * the input array unchanged (same reference) when nothing needs patching.
 */
export function normalizeErnieMessages<T extends { role?: string; content?: unknown }>(messages: T[]): T[] {
	return normalizeOpenRouterMessages(messages);
}

/**
 * Inject strict mode into all function tool schemas for ERNIE: strict:true +
 * parameters.additionalProperties:false. Forces real structured arguments
 * instead of markdown-checklist strings (the coercion recovery is the fallback,
 * not the first line of defense).
 */
export function applyErnieStrictToolSchemas(tools: unknown[]): unknown[] {
	return applyOpenRouterStrictToolSchemas(tools);
}

export { parseMarkdownItem, parseMarkdownList, decodeValue };