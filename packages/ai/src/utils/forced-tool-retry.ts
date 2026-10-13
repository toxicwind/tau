import { isForcedToolChoice } from "../utils/tool-choice";
import type { AssistantMessage } from "../types";
import { AssistantMessageEventStream } from "../utils/event-stream";

/**
 * Dots 3 Note (and related) models degrade under forced tool_choice:
 * they return the forced tool call with empty array args (e.g. {"list":[]})
 * instead of the actual data. Auto mode works correctly.
 *
 * Detects this shape: tool_choice was forced AND at least one tool call
 * has an argument that is an empty array.
 *
 * See Dots 3 recon 2026-10-13: forced -> {"list":[]}, auto -> correct data.
 */
export function hasForcedToolDegradation(
	message: AssistantMessage,
	wasForced: boolean,
): boolean {
	if (!wasForced) return false;
	for (const block of message.content) {
		if (block.type !== "toolCall") continue;
		const args = block.arguments;
		if (!args || typeof args !== "object") continue;
		for (const value of Object.values(args as Record<string, unknown>)) {
			if (Array.isArray(value) && value.length === 0) {
				return true;
			}
		}
	}
	return false;
}

/**
 * Wraps a stream factory with forced-tool degradation retry.
 *
 * If the original request used a forced tool_choice and the completed
 * message shows the empty-args degradation shape, re-issues the request
 * with tool_choice: "auto" and returns that stream's events instead.
 *
 * Logs the retry so it's visible in debugging.
 */
export function withForcedToolDegradationRetry<M, O extends { toolChoice?: unknown; signal?: AbortSignal }>(
	model: M,
	context: { tools?: unknown[] },
	options: O | undefined,
	originalToolChoice: unknown,
	attempt: (model: M, context: any, options?: O) => AssistantMessageEventStream,
	log: (msg: string) => void,
): AssistantMessageEventStream {
	const outer = new AssistantMessageEventStream();
	const wasForced = isForcedToolChoice(originalToolChoice);

	void (async () => {
		// First attempt with the original (forced) tool choice.
		const first = attempt(model, context, options);
		let terminal: any;
		for await (const event of first) {
			if (event.type === "done" || event.type === "error") {
				terminal = event;
				break;
			}
			outer.push(event);
			if (outer.done) return;
		}

		// Check for forced-tool degradation.
		const message = terminal?.type === "done" ? terminal.message : undefined;
		if (message && hasForcedToolDegradation(message, wasForced) && !options?.signal?.aborted) {
			const toolName = typeof originalToolChoice === "object" && originalToolChoice !== null
				? JSON.stringify(originalToolChoice)
				: String(originalToolChoice);
			log(`[forced-tool-degradation] Detected empty-args tool call under forced tool_choice=${toolName}; retrying with tool_choice="auto"`);
			// Retry with auto.
			const retryOptions = { ...options, toolChoice: "auto" } as O;
			const second = attempt(model, context, retryOptions);
			for await (const event of second) {
				outer.push(event);
				if (outer.done) return;
			}
			return;
		}

		// No degradation (or already auto) — forward the terminal event.
		if (terminal) {
			outer.push(terminal);
		} else if (!outer.done) {
			try {
				outer.end(await first.result());
			} catch (error) {
				outer.fail(error);
			}
		}
	})();

	return outer;
}
