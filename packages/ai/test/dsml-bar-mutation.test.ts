/**
 * DSML bar-multiplicity mutation tests (2026-11-02).
 *
 * Ground truth: a live DeepSeek-family stream leaked RAW tool-call markup into
 * visible chat text — the tokens arrived DOUBLED (`<｜｜DSML｜｜ invoke ...>`,
 * `</｜｜DSML｜｜ parameter>`) with a drifted unknown-word closer
 * (`</｜｜DSML｜｜ calls>`) and orphan OPENS with attributes. The scanner knew
 * only the single-bar forms, so every mutated token fell through `outside` as
 * text — and per issue #10556, each stored leak teaches the model to mimic the
 * mutation further.
 *
 * Contract under test: the scanner consumes DSML tool-call envelopes for ANY
 * bar count ≥ 1 (fullwidth/ascii/mixed runs), strips orphan DSML tags
 * (opens AND closes, with or without attributes, known word or drifted) in the
 * outside state, and recovers envelopes split across SSE chunk boundaries.
 */
import { describe, expect, it } from "bun:test";
import { getDialectDefinition } from "../src/dialect/index.ts";
import type { InbandScanEvent } from "../src/dialect/types";

const deepseek = () => getDialectDefinition("deepseek").createScanner();

function feedAll(scanner: ReturnType<typeof deepseek>, chunks: string[]): InbandScanEvent[] {
	const events: InbandScanEvent[] = [];
	for (const chunk of chunks) events.push(...scanner.feed(chunk));
	events.push(...scanner.flush());
	return events;
}

const textOf = (events: InbandScanEvent[]) =>
	events.filter(e => e.type === "text").map(e => (e as { text: string }).text).join("");
const tools = (events: InbandScanEvent[]) =>
	events.filter(e => e.type === "toolEnd") as Array<{ type: "toolEnd"; name: string; arguments: Record<string, unknown> }>;

const DOUBLE_OPEN = '<｜｜DSML｜｜tool_calls>';
const DOUBLE_CLOSE = '</｜｜DSML｜｜tool_calls>';

describe("DSML bar-multiplicity mutations", () => {
	it("parses a full double-bar envelope into tool calls with zero text leakage", () => {
		const events = feedAll(deepseek(), [
			`${DOUBLE_OPEN}\n<｜｜DSML｜｜invoke name="eval">\n<｜｜DSML｜｜parameter name="language" string="true">js</｜｜DSML｜｜parameter>\n<｜｜DSML｜｜parameter name="code" string="true">console.log(1)</｜｜DSML｜｜parameter>\n</｜｜DSML｜｜invoke>\n${DOUBLE_CLOSE}`,
		]);
		const calls = tools(events);
		expect(calls.length).toBe(1);
		expect(calls[0]!.name).toBe("eval");
		expect(calls[0]!.arguments["language"]).toBe("js");
		expect(calls[0]!.arguments["code"]).toBe("console.log(1)");
		expect(textOf(events).includes("DSML")).toBe(false);
	});

	it("bare invoke open WITH name = omit-START tool call (vLLM #48931 semantics)", () => {
		const events = feedAll(deepseek(), [
			'hello <｜｜DSML｜｜ invoke name="eval"> world</｜｜DSML｜｜invoke>',
		]);
		const calls = tools(events);
		expect(calls.length).toBe(1);
		expect(calls[0]!.name).toBe("eval");
		// Content between invoke open/close without parameter tags is
		// envelope noise (consumed into rawBlock, not streamed as text).
		expect(calls[0]!.rawBlock).toContain("invoke");
		expect(textOf(events)).toBe("hello ");
	});

	it("strips drifted unknown-word closers like </｜｜DSML｜｜ calls>", () => {
		const events = feedAll(deepseek(), [
			'before </｜｜DSML｜｜ calls> after',
		]);
		expect(textOf(events)).toBe("before  after");
	});

	it("handles ascii double-bar and mixed fullwidth/ascii bar runs", () => {
		const events = feedAll(deepseek(), [
			'<||DSML||tool_calls><|｜DSML｜|invoke name="t"><||DSML||parameter name="a" string="true">v</||DSML||parameter></|｜DSML｜|invoke></||DSML||tool_calls>',
		]);
		const calls = tools(events);
		expect(calls.length).toBe(1);
		expect(calls[0]!.arguments["a"]).toBe("v");
		expect(textOf(events).includes("DSML")).toBe(false);
	});

	it("recovers a double-bar envelope split across SSE chunk boundaries", () => {
		const events = feedAll(deepseek(), [
			"<｜｜DS",
			"ML｜｜tool_calls><｜｜DSML｜｜invoke na",
			'me="read"><｜｜DSML｜｜parameter name="path" str',
			'ing="true">src/a.ts</｜｜DSML｜｜para',
			"meter></｜｜DS",
			"ML｜｜invoke>",
			DOUBLE_CLOSE,
		]);
		const calls = tools(events);
		expect(calls.length).toBe(1);
		expect(calls[0]!.name).toBe("read");
		expect(calls[0]!.arguments["path"]).toBe("src/a.ts");
		expect(textOf(events).includes("DSML")).toBe(false);
	});

	it("never leaks a bar-run even when a chunk ends mid-bars", () => {
		const events = feedAll(deepseek(), [
			"text<｜｜", "DSML｜｜invoke name=\"x\">v</｜｜DSML｜｜invoke>",
		]);
		expect(textOf(events).startsWith("text")).toBe(true);
		expect(textOf(events).includes("DSML")).toBe(false);
		const calls = tools(events);
		expect(calls.length).toBe(1);
	});
});
