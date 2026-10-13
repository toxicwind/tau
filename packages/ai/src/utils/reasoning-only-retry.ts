import type { AssistantMessage } from "../types";
import { AssistantMessageEventStream } from "../utils/event-stream";

/**
 * Reasoning models sometimes die at the reasoning->content boundary: the
 * provider stream ends with finish_reason:"stop", ZERO content chunks, but
 * non-empty reasoning_content. The reasoning text is a complete, coherent
 * plan for the final answer — then generation ends at the boundary.
 * The emptiness is in the provider stream itself, not tau parsing.
 *
 * Detects this shape: stopReason === "stop" AND no text/tool content AND
 * non-empty reasoning (thinking blocks or message-level reasoning_details).
 *
 * See tau-models-diagnosis 2026-10-13: nemotron-3-nano-omni stream
 * chatcmpl-762b0c92 — 751 completion tokens, ALL reasoning_content,
 * zero content chunks, finish_reason:"stop".
 */
export function hasReasoningOnlyEmptyContent(message: AssistantMessage): boolean {
	if (message.stopReason !== "stop") return false;

	let hasContent = false;
	let hasReasoning = false;

	for (const block of message.content) {
		if (block.type === "text" && block.text.length > 0) {
			hasContent = true;
		} else if (block.type === "toolCall") {
			hasContent = true;
		} else if (block.type === "thinking" && block.thinking.length > 0) {
			hasReasoning = true;
		} else if (block.type === "redactedThinking") {
			hasReasoning = true;
		}
	}

	if (
		!hasReasoning &&
		message.messageReasoningDetails !== undefined &&
		message.messageReasoningDetails.length > 0
	) {
		hasReasoning = true;
	}

	return hasReasoning && !hasContent;
}

/**
 * Wraps a stream factory with reasoning-only-empty retry.
 *
 * If the completed message shows the reasoning->content boundary death
 * (finish=stop, empty content, non-empty reasoning), re-issues the request
 * once with reasoning disabled and returns that stream's events instead.
 *
 * Mirrors the forced-tool-degradation retry pattern
 * (utils/forced-tool-retry.ts). Logs the retry so it's visible in debugging.
 */
export function withReasoningOnlyEmptyRetry<
	M,
	O extends { disableReasoning?: boolean; signal?: AbortSignal },
>(
	model: M,
	context: { tools?: unknown[] },
	options: O | undefined,
	attempt: (model: M, context: any, options?: O) => AssistantMessageEventStream,
	log: (msg: string) => void,
): AssistantMessageEventStream {
	const outer = new AssistantMessageEventStream();

	void (async () => {
		// First attempt with the original options.
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

		// Check for reasoning-only empty content death.
		const message = terminal?.type === "done" ? terminal.message : undefined;
		if (
			message &&
			hasReasoningOnlyEmptyContent(message) &&
			!options?.signal?.aborted &&
			!options?.disableReasoning
		) {
			log(
				"[reasoning-only-empty] Detected finish=stop with empty content but non-empty reasoning; retrying once with reasoning disabled",
			);
			// Retry with reasoning disabled.
			const retryOptions = { ...options, disableReasoning: true } as O;
			const second = attempt(model, context, retryOptions);
			for await (const event of second) {
				outer.push(event);
				if (outer.done) return;
			}
			return;
		}

		// No degradation (or already disabled) — forward the terminal event.
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
