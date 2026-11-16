import { describe, expect, test } from "bun:test";
import { InceptionInbandScanner } from "../src/dialect/inception.ts";

/**
 * Regression: mercury's mangled tool-call markers must never leak as visible
 * text, and a mangled block must still yield a tool call.
 *
 * The doubled root is `<|inc_tool_call_ml||inc_tool_call_ml|_calls>` — note the
 * second copy omits the `<`, so the seam is `||`, not `|<|`. The original
 * normalizer only handled the `|<|` seam and the inner Anthropic scanner only
 * buffers partial *clean* tags (`<invoke`), so a chunk boundary landing inside
 * the prefix leaked raw markup into the transcript.
 */

const MANGLED_ROOT = "<|inc_tool_call_ml||inc_tool_call_ml|_calls>";
const MANGLED = `${MANGLED_ROOT}
<|inc_tool_call_ml|invoke name="glob">
<|inc_tool_call_ml|parameter name="path" string="true">src/a.ts</|inc_tool_call_ml|parameter>
</|inc_tool_call_ml|invoke>
</|inc_tool_call_ml|tool_calls>`;

type Ev = { type: string; text?: string; name?: string };

function run(chunks: string[]): Ev[] {
	const scanner = new InceptionInbandScanner();
	const out: Ev[] = [];
	for (const chunk of chunks) out.push(...(scanner.feed(chunk) as Ev[]));
	out.push(...(scanner.flush() as Ev[]));
	return out;
}

const text = (events: Ev[]) =>
	events
		.filter(e => e.type === "text")
		.map(e => e.text ?? "")
		.join("");

const leaked = (events: Ev[]) => {
	const t = text(events);
	return t.includes("inc_tool_call_ml") || t.includes("<|");
};

const called = (events: Ev[], name = "glob") =>
	events.some(e => e.type === "toolStart" && e.name === name);

describe("inception mangled markers", () => {
	test("whole block normalizes and calls the tool", () => {
		const events = run([MANGLED]);
		expect(leaked(events)).toBe(false);
		expect(called(events)).toBe(true);
	});

	test("does not leak when split at every possible boundary", () => {
		for (let cut = 1; cut < MANGLED.length; cut++) {
			const events = run([MANGLED.slice(0, cut), MANGLED.slice(cut)]);
			expect(leaked(events), `split at ${cut}`).toBe(false);
		}
	});

	test("does not leak when fed one character at a time", () => {
		const events = run(MANGLED.split(""));
		expect(leaked(events)).toBe(false);
		expect(called(events)).toBe(true);
	});

	test("survives empty chunks interleaved", () => {
		const events = run(MANGLED.split("").flatMap(c => ["", c, ""]));
		expect(leaked(events)).toBe(false);
	});

	test("the doubled root alone normalizes to an open tool_calls tag", () => {
		const events = run([MANGLED_ROOT]);
		expect(text(events)).not.toContain("inc_tool_call_ml");
	});
});