import { INTENT_FIELD } from "@tau/tau-wire";
import type { AssistantMessage, ToolCall, ToolResultMessage } from "../types";

const LEGACY_INTENT_FIELD = "__intent";
const RESULT_SUMMARY_LIMIT = 200;
const ARGUMENT_SUMMARY_LIMIT = 400;

/** Runtime settings for cross-turn tool-call repetition detection. */
export interface ToolCallLoopGuardOptions {
	readonly threshold: number;
	readonly exemptTools: readonly string[];
}

/** A completed assistant turn plus the tool results it produced. */
export interface ToolCallLoopTurn {
	readonly message: AssistantMessage;
	readonly toolResults: readonly ToolResultMessage[];
}

/** Details needed to steer the model away from a repeated tool call. */
export interface RepeatedToolCallDetection {
	readonly kind: "repeated_tool_call";
	readonly toolName: string;
	readonly count: number;
	readonly resultSummary: string;
	readonly argumentsSummary: string;
}

function canonicalizeToolCallValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(item => canonicalizeToolCallValue(item));
	}
	if (!value || typeof value !== "object") {
		return value;
	}

	const input = value as Record<string, unknown>;
	const output: Record<string, unknown> = {};
	for (const key of Object.keys(input).sort()) {
		if (key === INTENT_FIELD || key === LEGACY_INTENT_FIELD) continue;
		output[key] = canonicalizeToolCallValue(input[key]);
	}
	return output;
}

function summarizeText(text: string, limit: number): string {
	let summary = text.replace(/\s+/g, " ").trim();
	if (summary.length > limit) {
		summary = `${summary.slice(0, limit)}…`;
	}
	return summary;
}

function summarizeToolResult(toolResults: readonly ToolResultMessage[], toolCallId: string): string {
	const result = toolResults.find(candidate => candidate.toolCallId === toolCallId);
	if (!result) return "";

	const textParts: string[] = [];
	for (const block of result.content) {
		if (block.type === "text") {
			textParts.push(block.text);
		}
	}
	return summarizeText(textParts.join("\n"), RESULT_SUMMARY_LIMIT);
}

/** Detects consecutive identical assistant tool calls across model turns. */
export class ToolCallLoopGuard {
	#threshold: number;
	#exemptTools: ReadonlySet<string>;
	#lastHash: string | undefined;
	#count = 0;

	// Denial-aware accumulator: catches the observed estate bug where a tool is
	// re-invoked with a *different* command each turn but every result is an
	// error / denial (e.g. "Tool bash not found", arg-validation failures). The
	// args-keyed #lastHash never matches, so the loop went undetected. We track
	// same-tool consecutive error outcomes independent of arguments and surface
	// them so the loop steers the model instead of letting it spin.
	#deniedTool: string | undefined;
	#deniedCount = 0;

	constructor(options: ToolCallLoopGuardOptions) {
		this.#threshold = Math.max(1, Math.trunc(options.threshold));
		this.#exemptTools = new Set(options.exemptTools);
	}

	/** Records one completed turn and reports repetitions at or beyond the threshold. */
	recordTurn(turn: ToolCallLoopTurn): RepeatedToolCallDetection | null {
		const toolCalls = turn.message.content.filter((part): part is ToolCall => part.type === "toolCall");
		if (toolCalls.length === 0) {
			this.#reset();
			return null;
		}
		if (toolCalls.every(tc => this.#exemptTools.has(tc.name))) {
			this.#reset();
			return null;
		}

		const canonicalCalls = toolCalls
			.map(tc => JSON.stringify([tc.name, canonicalizeToolCallValue(tc.arguments)]))
			.sort();
		const turnHash = JSON.stringify(canonicalCalls);
		if (turnHash === this.#lastHash) {
			this.#count++;
		} else {
			this.#lastHash = turnHash;
			this.#count = 1;
		}

		if (this.#count >= this.#threshold) {
			const reportCall = this.#chooseCall(toolCalls);
			return this.#detection(reportCall, turn, this.#count);
		}

		// Denial-aware lane: same non-exempt tool, every result an error, across
		// turns regardless of argument variance (estate "Tool bash not found" 99x).
		const single = toolCalls.filter(tc => !this.#exemptTools.has(tc.name));
		const allDenied = single.length > 0 && single.every(tc => this.#resultIsError(turn.toolResults, tc.id));
		if (allDenied) {
			const name = single[0]!.name;
			if (name === this.#deniedTool) {
				this.#deniedCount++;
			} else {
				this.#deniedTool = name;
				this.#deniedCount = 1;
			}
			if (this.#deniedCount >= this.#threshold) {
				const reportCall = this.#chooseCall(toolCalls);
				return this.#detection(reportCall, turn, this.#deniedCount);
			}
		} else {
			this.#deniedTool = undefined;
			this.#deniedCount = 0;
		}

		return null;
	}

	#reset(): void {
		this.#lastHash = undefined;
		this.#count = 0;
		this.#deniedTool = undefined;
		this.#deniedCount = 0;
	}

	#chooseCall(toolCalls: readonly ToolCall[]): ToolCall {
		return toolCalls.find(tc => !this.#exemptTools.has(tc.name)) ?? toolCalls[0]!;
	}

	#resultIsError(results: readonly ToolResultMessage[], toolCallId: string): boolean {
		const result = results.find(candidate => candidate.toolCallId === toolCallId);
		return Boolean(result?.isError);
	}

	#detection(reportCall: ToolCall, turn: ToolCallLoopTurn, count: number): RepeatedToolCallDetection {
		return {
			kind: "repeated_tool_call",
			toolName: reportCall.name,
			count,
			resultSummary: summarizeToolResult(turn.toolResults, reportCall.id),
			argumentsSummary: summarizeText(
				JSON.stringify(canonicalizeToolCallValue(reportCall.arguments)),
				ARGUMENT_SUMMARY_LIMIT,
			),
		};
	}
}
