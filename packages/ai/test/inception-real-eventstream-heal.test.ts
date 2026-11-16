import { describe, expect, test } from "bun:test";
import { InceptionInbandScanner } from "../src/dialect/inception.ts";

/**
 * Regression: the REAL mangled mercury-3 tool-call block, pulled verbatim from
 * the kilo event stream (event table, message.part.updated.1, session
 * ses_e1ccf084, assistant message msg_1e36a60c). This is the exact raw dialect
 * the agent emitted — the scanner must auto-heal it into a tool call with zero
 * leaked markup, not just the synthetic char-code fixture.
 *
 * Note the doubled root seam is `||` (second copy omits the `<`), and the
 * `bun_eval` tool with `string="true"` params is the real shape.
 */
const REAL_MANGLED = `Let me first verify all providers have the metadata fields (I added via eval + edit, need confirmation).

<|inc_tool_call_ml||inc_tool_call_ml|_calls>
<|inc_tool_call_ml|invoke name="bun_eval">
<|inc_tool_call_ml|parameter name="code" string="true">import { readFileSync } from "node:fs";
const text = readFileSync("/home/toxic/pens/geode/products/mimetite/catalog/src/data.ts","utf8");
const names = ["nvidia","groq","bitdeer","mistral","openrouter","zen","google","moonshot","freeinference"];
const out=[];
for (const n of names){
  const found = text.match(new RegExp(\`name:\\s*"\${n}"[\\s\\S]*?defaultThinking:\\s*"auto"\`));
  out.push(n.padEnd(12)+(found?"defaultThinking=auto OK":"MISSING"));
}
console.log(out.join("\\n"));
console.log("total defaultThinking:", (text.match(/defaultThinking/g)||[]).length);</|inc_tool_call_ml|parameter>
<|inc_tool_call_ml|parameter name="title" string="true">Verify all provider defaults</|inc_tool_call_ml|parameter>
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

function leaked(events: Ev[]): boolean {
	const t = events
		.filter(e => e.type === "text")
		.map(e => e.text ?? "")
		.join("");
	return t.includes("inc_tool_call_ml") || t.includes("<|");
}

function hasToolStart(events: Ev[], name: string): boolean {
	return events.some(e => e.type === "toolStart" && e.name === name);
}

describe("inception real event-stream auto-heal", () => {
	test("whole real block auto-heals into the bun_eval tool call", () => {
		const events = run([REAL_MANGLED]);
		expect(leaked(events)).toBe(false);
		expect(hasToolStart(events, "bun_eval")).toBe(true);
	});

	test("real block does not leak when split at every boundary", () => {
		for (let cut = 1; cut < REAL_MANGLED.length; cut++) {
			const events = run([REAL_MANGLED.slice(0, cut), REAL_MANGLED.slice(cut)]);
			expect(leaked(events), `split at ${cut}`).toBe(false);
		}
	});

	test("real block auto-heals when fed one char at a time", () => {
		const events = run(REAL_MANGLED.split(""));
		expect(leaked(events)).toBe(false);
		expect(hasToolStart(events, "bun_eval")).toBe(true);
	});

	test("real block survives interleaved empty chunks", () => {
		const events = run(REAL_MANGLED.split("").flatMap(c => ["", c, ""]));
		expect(leaked(events)).toBe(false);
		expect(hasToolStart(events, "bun_eval")).toBe(true);
	});
});