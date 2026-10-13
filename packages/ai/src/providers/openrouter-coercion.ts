/**
 * openrouter-coercion.ts — generalized OpenRouter coercion layer.
 *
 * The Dots 3 recon (2026-10-13) found four caller-side behaviors that
 * neutralize failure modes on OpenRouter-routed calls:
 *  - ghost outputs (reasoning burning the whole completion budget),
 *  - list:string tool-arg mismatches,
 *  - slow fallback chains (22s latency),
 *  - replay crashes on null assistant content.
 *
 * Chris's call (2026-10-13): these are NOT Dots-specific — any model routed
 * through OpenRouter is suspect. So everything here is gated on
 * `compat.isOpenRouterHost` (resolved by the catalog from the provider
 * config), never on the model ID.
 *
 * Ported from ranch/dots-client/sovereign_dots_client.py
 * (SovereignDotsClient.execute_structured_step), with two corrections proven
 * by live measurement (2026-10-13, dots-3-note-preview:free):
 *  1. Custom `stop` sequences + `provider.require_parameters:true` is
 *     unroutable — OpenRouter returns 404 "no endpoints found" for the
 *     combination (each works alone). Provider constraints win; stop
 *     sequences are skipped when require_parameters is in effect.
 *  2. The reasoning cap is Dots-scoped: tau's pipeline manages reasoning
 *     deliberately (adaptive efforts go 1:1 on the wire; forced tool_choice
 *     strips reasoning for Kimi — issue #827). Re-adding a reasoning object
 *     would clobber those decisions, so the cap is opt-in per call site.
 */

/** Deterministic tool use when the caller didn't pick a temperature. */
export const OPENROUTER_TEMPERATURE = 0.1;
/** Reasoning cap: reasoning can't burn the whole completion budget. */
export const OPENROUTER_REASONING_MAX_TOKENS = 128;
/** Cut ghost-output tails (tool-call XML leaks, markdown fences). */
export const OPENROUTER_STOP_SEQUENCES = ["</tool_call>", "</dots_function_call>", "<|endoftext|>", "```"];

/** Minimal compat surface the coercions gate on. */
export interface OpenRouterCoercionGate {
	isOpenRouterHost: boolean;
}

/** True when this request routes through OpenRouter — the only gate used. */
export function isOpenRouterRouted(gate: OpenRouterCoercionGate | undefined): boolean {
	return gate?.isOpenRouterHost === true;
}

/**
 * Normalize prior assistant messages: content null/undefined -> "".
 * OpenRouter-routed upstreams and replay/continuation payloads crash on
 * null content; the empty string is the neutral equivalent.
 * Returns the input array unchanged (same reference) when nothing needs
 * patching, so non-OpenRouter hot paths pay nothing.
 */
export function normalizeOpenRouterMessages<T extends { role?: string; content?: unknown }>(messages: T[]): T[] {
	let changed = false;
	const out = messages.map(m => {
		if (m != null && m.role === "assistant" && (m.content === null || m.content === undefined)) {
			changed = true;
			return { ...m, content: "" };
		}
		return m;
	});
	return changed ? out : messages;
}

/**
 * Inject strict mode into all function tool schemas:
 * `strict: true` + `parameters.additionalProperties: false`, deep-copied so
 * the caller's tool definitions are never mutated.
 * Forces real structured arguments instead of markdown-checklist strings.
 */
export function applyOpenRouterStrictToolSchemas(tools: unknown[]): unknown[] {
	return tools.map(t => {
		if (typeof t !== "object" || t === null) return t;
		const rec = t as Record<string, unknown>;
		if (rec.type !== "function") return t;
		const fn = rec.function;
		if (typeof fn !== "object" || fn === null) return t;
		const fnRec = fn as Record<string, unknown>;
		const parameters =
			typeof fnRec.parameters === "object" && fnRec.parameters !== null
				? { ...(fnRec.parameters as Record<string, unknown>), additionalProperties: false }
				: fnRec.parameters;
		return { ...rec, function: { ...fnRec, strict: true, parameters } };
	});
}

export interface OpenRouterRequestShapingOptions {
	/** Apply the temperature default. Disable on APIs without a temperature field. */
	temperature?: boolean;
	/** Apply the stop sequences. Disable on APIs without a top-level stop field. */
	stopSequences?: boolean;
	/**
	 * Apply the reasoning cap when reasoning is unset. Defaults to false:
	 * tau's reasoning pipeline owns reasoning config (adaptive efforts,
	 * forced-toolChoice stripping); opt in only where the recon proved the
	 * ghost-output disease (Dots family).
	 */
	reasoning?: boolean;
}

/**
 * Apply the SovereignDotsClient payload coercions to a request body.
 * Raise-only / fill-in-only: explicit caller values always win.
 *  - temperature 0.1 when unspecified (deterministic tool use)
 *  - provider.require_parameters=true + provider.allow_fallbacks=false when
 *    unspecified (real structured args; fail fast instead of hanging
 *    through slow fallback chains)
 *  - stop sequences that cut ghost tails — skipped when require_parameters
 *    is in effect (the combination is unroutable: measured 404)
 *  - reasoning capped at 128 tokens and excluded, only when opted in and
 *    unset
 *
 * max_tokens is intentionally NOT forced: OpenRouter fans out to upstreams
 * whose output caps differ from the catalog value, so a catalog default
 * above the routed upstream's cap makes OpenRouter skip that upstream.
 * tau's resolveOpenAIOutputTokenParam owns that decision (its OpenRouter
 * omission rule is deliberate).
 */
export function applyOpenRouterRequestShaping(
	params: Record<string, unknown>,
	gate: OpenRouterCoercionGate,
	options: OpenRouterRequestShapingOptions = {},
): void {
	if (!isOpenRouterRouted(gate)) return;
	const { temperature = true, stopSequences = true, reasoning = false } = options;
	if (temperature && params.temperature === undefined) {
		params.temperature = OPENROUTER_TEMPERATURE;
	}
	const base =
		typeof params.provider === "object" && params.provider !== null
			? { ...(params.provider as Record<string, unknown>) }
			: {};
	if (base.require_parameters === undefined) base.require_parameters = true;
	if (base.allow_fallbacks === undefined) base.allow_fallbacks = false;
	params.provider = base;
	if (stopSequences && base.require_parameters !== true && params.stop === undefined) {
		params.stop = [...OPENROUTER_STOP_SEQUENCES];
	}
	if (reasoning && (params.reasoning === undefined || params.reasoning === null)) {
		params.reasoning = { max_tokens: OPENROUTER_REASONING_MAX_TOKENS, exclude: true };
	}
}
