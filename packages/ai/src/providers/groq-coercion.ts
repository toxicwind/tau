/**
 * groq-coercion.ts — Groq provider coercion layer.
 *
 * Groq's API runs strict schema validation and 400s on fields it doesn't
 * recognize — even fields other OpenAI-compatible providers accept:
 *  - `reasoning_content` on assistant messages (measured 2026-10-14:
 *    "'messages.11': property 'reasoning_content' is unsupported" for
 *    role:assistant, model moonshotai/kimi-k2-instruct via Groq).
 *    Tau attaches `reasoning_content` because Kimi-family models set
 *    `requiresReasoningContentForToolCalls` — correct for Moonshot/OpenRouter,
 *    fatal on Groq.
 *  - top-level `repetition_penalty` (measured 2026-10-14, same model/route).
 *    Groq supports presence_penalty/frequency_penalty; repetition_penalty is
 *    a vLLM-ism it rejects outright.
 *
 * Chris's call (2026-10-14): "fix groq every single model". So everything
 * here is gated on `compat.isGroqHost` (resolved by the catalog from the
 * provider config), never on the model ID — the same provider-gating the
 * OpenRouter coercions use.
 *
 * Conservative by design: only properties Groq demonstrably rejected (per the
 * http-400-requests log scan) are stripped. Nothing is added or defaulted.
 */

/** Minimal compat surface the coercions gate on. */
export interface GroqCoercionGate {
	isGroqHost?: boolean;
}

/** True when this request routes through Groq — the only gate used. */
export function isGroqRouted(gate: GroqCoercionGate | undefined): boolean {
	return gate?.isGroqHost === true;
}

/**
 * Strip Groq-unsupported properties from assistant messages.
 * Currently: `reasoning_content` (Groq 400s: "property 'reasoning_content'
 * is unsupported" for role:assistant). User/tool/system messages are never
 * touched — Groq only complained about assistant turns.
 * Returns the input array unchanged (same reference) when nothing needs
 * patching, so non-Groq hot paths pay nothing.
 */
export function stripGroqReasoningContent<T extends { role?: string; reasoning_content?: unknown }>(
	messages: T[],
): T[] {
	let changed = false;
	const out = messages.map(m => {
		if (m != null && m.role === "assistant" && "reasoning_content" in m) {
			changed = true;
			const copy = { ...m };
			delete copy.reasoning_content;
			return copy;
		}
		return m;
	});
	return changed ? out : messages;
}

export interface GroqRequestShapingOptions {
	/**
	 * Drop top-level `repetition_penalty`. Defaults to true: Groq 400s on it
	 * (measured 2026-10-14) while presence_penalty/frequency_penalty pass
	 * through untouched. Disable only if Groq ever documents the field.
	 */
	repetitionPenalty?: boolean;
}

/**
 * Apply Groq request-body coercions. Drop-only: explicit caller values are
 * never rewritten, only the fields Groq rejects outright are removed.
 *  - `repetition_penalty` when set (Groq: unsupported property -> 400)
 */
export function applyGroqRequestShaping(
	params: Record<string, unknown>,
	gate: GroqCoercionGate,
	options: GroqRequestShapingOptions = {},
): void {
	if (!isGroqRouted(gate)) return;
	const { repetitionPenalty = true } = options;
	if (repetitionPenalty && "repetition_penalty" in params) {
		delete params.repetition_penalty;
	}
}
