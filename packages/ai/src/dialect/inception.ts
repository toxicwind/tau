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
 * Shape-based recognition of the inception mangled-marker family. Like
 * DeepSeek's DSML (issue #10556), live mercury streams leak MUTATED forms of
 * its internal tool-call token — bars doubled, root repeated, drifted words —
 * and each stored leak teaches the model to mimic the mutation further. So we
 * recognize the SHAPE (a `<|inc_tool_call_ml|`-family prefix on a tag) rather
 * than only the exact spelling, and normalize any variant to clean XML.
 *
 * The invariant is the `inc_tool_call_ml` body wrapped in `<|...|` bars, with
 * an optional doubled root (the `||inc_tool_call_ml|` seam). Spelling of the
 * envelope word (`_calls`, `oke`=invoke, `parameter`) may drift.
 */
const MANGLED_OPEN_RE = /<\|inc_tool_call_ml\|(?:\|inc_tool_call_ml\|)?/g;
const MANGLED_CLOSE_RE = /<\/\|inc_tool_call_ml\|/g;

/**
 * Streams whose *prefixes* must be buffered while a chunk boundary is
 * ambiguous. The doubled-root sentinels matter most: `<|inc_tool_call_ml|` is
 * itself a complete single-tag prefix, so normalizing it as soon as it arrives
 * destroys the information needed to recognize the doubled root
 * (`<|inc_tool_call_ml||inc_tool_call_ml|_calls>`). Holding the prefix until
 * the next chunk disambiguates single-tag vs doubled-root is what keeps the
 * root from degrading to visible text.
 */
const INCEPTION_SENTINELS = [
	MANGLED_PREFIX,
	MANGLED_CLOSE_PREFIX,
	`${MANGLED_PREFIX}|inc_tool_call_ml|_calls>`,
	`${MANGLED_PREFIX}|inc_tool_call_ml|oke`,
] as const;

/**
 * Length of the longest trailing run of `text` that is a strict prefix of a
 * mangled marker. Such a run must be held back: `normalizeMangledMarkers` can
 * only rewrite whole markers, and the inner Anthropic scanner only buffers
 * partial *clean* tags (`<invoke`), so an unrewritten `<|inc_tool_` fragment
 * degrades to visible text and the call is lost.
 */
function trailingPartialMarkerLength(text: string): number {
	let longest = 0;
	for (const sentinel of INCEPTION_SENTINELS) {
		const max = Math.min(sentinel.length - 1, text.length);
		for (let length = max; length > longest; length--) {
			if (text.endsWith(sentinel.slice(0, length))) {
				longest = length;
				break;
			}
		}
	}
	return longest;
}

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
	#pending = "";

	constructor(options: InbandScannerOptions = {}) {
		this.#inner = new AnthropicInbandScanner(options);
	}

	feed(text: string): InbandScanEvent[] {
		if (text.length === 0 && this.#pending.length === 0) return [];
		// A mangled prefix can straddle a chunk boundary (`<|inc_tool_` + `call_ml|…`).
		// Rejoin it with the held-back tail before normalizing so the marker is
		// always whole when the normalizer and the inner scanner see it.
		const buffered = this.#pending + text;
		const held = trailingPartialMarkerLength(buffered);
		this.#pending = held > 0 ? buffered.slice(buffered.length - held) : "";
		const ready = held > 0 ? buffered.slice(0, buffered.length - held) : buffered;
		if (ready.length === 0) return [];
		return this.#inner.feed(normalizeMangledMarkers(ready));
	}

	flush(): InbandScanEvent[] {
		const pending = this.#pending;
		this.#pending = "";
		const drained = pending.length > 0 ? this.#inner.feed(normalizeMangledMarkers(pending)) : [];
		return [...drained, ...this.#inner.flush()];
	}
}

/**
 * Rewrite every occurrence of the mangled marker prefix. Handles both the
 * doubled root form (`<|inc_tool_call_ml||inc_tool_call_ml|_calls>`) and the
 * single-tag form (`<|inc_tool_call_ml|invoke>`, `</|inc_tool_call_ml|invoke>`),
 * plus any bar-multiplicity mutation of the family shape (DeepSeek-style).
 */
export function normalizeMangledMarkers(text: string): string {
	if (!text.includes(MANGLED_PREFIX) && !text.includes(MANGLED_CLOSE_PREFIX)) return text;
	// Normalize the `|<|` doubled-root seam to `||` (the real mercury form
	// omits the second `<`). This makes both spellings equivalent before the
	// doubled-root mapping below.
	let out = text.replaceAll(`${MANGLED_PREFIX}<|inc_tool_call_ml|`, `${MANGLED_PREFIX}|inc_tool_call_ml|`);
	// Doubled-root seams map to a specific clean tag, not a bare `<`:
	// `<|inc_tool_call_ml||inc_tool_call_ml|_calls>` → `<tool_calls>`,
	// `<|inc_tool_call_ml||inc_tool_call_ml|oke` → `<invoke`.
	out = out.replaceAll(`${MANGLED_PREFIX}|inc_tool_call_ml|_calls>`, "<tool_calls>");
	out = out.replaceAll(`${MANGLED_PREFIX}|inc_tool_call_ml|oke`, "<invoke");
	// Then the generic family shape: strip the mangled open prefix (single or
	// doubled root) and the mangled close prefix wherever they appear. This
	// handles the exact spellings AND any bar-multiplicity mutation.
	out = out.replace(MANGLED_OPEN_RE, "<").replace(MANGLED_CLOSE_RE, "</");
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