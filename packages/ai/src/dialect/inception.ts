import type { Message, ToolCall } from "../types";
import { AnthropicInbandScanner } from "./anthropic";
import { buildArgShapes, type ToolArgShape } from "./coercion";
import {
	escapeXmlAttr,
	renderDelimitedThinking,
	renderLegacyTextTranscript,
	renderToolResponseResults,
	stringifyJson,
} from "./rendering";
import type {
	DialectDefinition,
	DialectRenderOptions,
	DialectToolResult,
	InbandScanEvent,
	InbandScanner,
	InbandScannerOptions,
} from "./types";
import dialectPrompt from "./inception.md" with { type: "text" };

/**
 * Inception (api.inceptionlabs.ai) mercury models are OpenAI-compatible hosts
 * that, when told to use an XML tool-call dialect, emit a *mangled* marker
 * variant: every tag is prefixed with `<|inc_tool_call_ml|` (an ASCII-mangled
 * chat-template token). The clean structure is otherwise a valid
 * Anthropic-style invoke/parameter tree:
 *
 *     <|inc_tool_call_ml||inc_tool_call_ml|_calls>
 *       <|inc_tool_call_ml|invoke name="glob">
 *         <|inc_tool_call_ml|parameter name="path" string="true">…</|inc_tool_call_ml|parameter>
 *       </|inc_tool_call_ml|invoke>
 *     </|inc_tool_call_ml|tool_calls>
 *
 * The base Anthropic scanner's `parseTag` regex rejects the `<|` prefix, so
 * every tool call degrades to visible text and the loop runs away. This
 * scanner normalizes the mangled prefix before delegating to the shared
 * Anthropic scanner, and — because the mangling is not guaranteed — also
 * tolerates the clean form so a well-behaved mercury build still works.
 */

const MANGLED_PREFIX = "<|inc_tool_call_ml|";
const MANGLED_CLOSE_PREFIX = "</|inc_tool_call_ml|";

/**
 * Streaming-safe normalizer: strips the mangled `<|inc_tool_call_ml|` prefix
 * from every tag open/close, turning the mangled tree into the clean
 * Anthropic form the base scanner already understands. Because the prefix can
 * be split across stream chunks, only whole, fully-buffered occurrences are
 * rewritten; partial prefixes are held back by the inner scanner's existing
 * partial-tag buffering.
 */
export class InceptionInbandScanner implements InbandScanner {
	readonly #inner: InbandScanner;
	readonly #pending: string;

	constructor(options: InbandScannerOptions = {}) {
		this.#inner = new AnthropicInbandScanner(options);
		this.#pending = "";
	}

	feed(text: string): InbandScanEvent[] {
		if (text.length === 0) return [];
		return this.#inner.feed(normalizeMangledMarkers(text));
	}

	flush(): InbandScanEvent[] {
		return this.#inner.flush();
	}
}

/**
 * Rewrite every occurrence of the mangled marker prefix. Handles both the
 * doubled root form (`<|inc_tool_call_ml||inc_tool_call_ml|_calls>`) and the
 * single-tag form (`<|inc_tool_call_ml|invoke>`, `</|inc_tool_call_ml|invoke>`).
 */
function normalizeMangledMarkers(text: string): string {
	if (!text.includes(MANGLED_PREFIX) && !text.includes(MANGLED_CLOSE_PREFIX)) return text;
	// Doubled root: `<|inc_tool_call_ml||inc_tool_call_ml|_calls>` → `<tool_calls>`
	let out = text.replaceAll(`${MANGLED_PREFIX}${MANGLED_PREFIX}_calls>`, "<tool_calls>");
	out = out.replaceAll(`${MANGLED_PREFIX}${MANGLED_PREFIX}oke`, "<invoke");
	// Single-tag close: `</|inc_tool_call_ml|invoke>` → `</invoke>`
	out = out.replaceAll(MANGLED_CLOSE_PREFIX, "</");
	// Single-tag open: `<|inc_tool_call_ml|invoke>` → `<invoke>`
	out = out.replaceAll(MANGLED_PREFIX, "<");
	return out;
}

function renderToolCall(call: ToolCall, options: DialectRenderOptions = {}): string {
	return renderInvoke(call, buildArgShapes(options.tools).get(call.name));
}

function renderAssistantToolCalls(calls: readonly ToolCall[], options: DialectRenderOptions = {}): string {
	return renderInvokes(calls, options.tools ?? []);
}

function renderToolResults(results: readonly DialectToolResult[]): string {
	return renderToolResponseResults(results);
}

function renderThinking(text: string): string {
	return renderDelimitedThinking("<thinking>", "</thinking>", text);
}

function renderTranscript(messages: readonly Message[], options: DialectRenderOptions = {}): string {
	return renderLegacyTextTranscript(messages, options, {
		renderThinking,
		renderCalls: renderAssistantToolCalls,
		renderResults: renderToolResults,
	});
}

function renderInvoke(call: ToolCall, shape: ToolArgShape | undefined): string {
	let body = `<invoke name="${escapeXmlAttr(call.name)}">`;
	for (const key in call.arguments) {
		const value = call.arguments[key];
		const isString = shape?.stringArgs.has(key) === true;
		const rendered = isString && typeof value === "string" ? value : stringifyJson(value);
		body += `<parameter name="${escapeXmlAttr(key)}">${rendered}</parameter>`;
	}
	return `${body}</invoke>`;
}

function renderInvokes(calls: readonly ToolCall[], tools: NonNullable<DialectRenderOptions["tools"]>): string {
	const shapes = buildArgShapes(tools);
	return calls.map(call => renderInvoke(call, shapes.get(call.name))).join("\n");
}

const definition: DialectDefinition = {
	dialect: "inception",
	prompt: dialectPrompt,
	createScanner: options => new InceptionInbandScanner(options),
	renderToolCall,
	renderAssistantToolCalls,
	renderToolResults,
	renderThinking,
	renderTranscript,
};

export default definition;