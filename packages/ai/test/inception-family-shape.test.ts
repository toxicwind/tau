import { describe, expect, test } from "bun:test";
import { normalizeMangledMarkers } from "../src/dialect/inception";

/**
 * Shape-based hardening (2026-11-16): like DeepSeek's DSML (issue #10556),
 * live mercury streams leak MUTATED forms of its internal `<|inc_tool_call_ml|>`
 * token — bars doubled, root repeated with either `|<|` or `||` seam, drifted
 * words. The normalizer must recognize the FAMILY SHAPE, not only the exact
 * spelling, and normalize every variant to clean XML.
 */

const MP = "<|inc_tool_call_ml|";
const MCP = "</|inc_tool_call_ml|";

describe("inception mangled-marker family shape", () => {
	test("single open/close prefixes normalize to clean tags", () => {
		expect(normalizeMangledMarkers(`${MP}invoke name="glob">`)).toBe('<invoke name="glob">');
		expect(normalizeMangledMarkers(`${MCP}invoke>`)).toBe("</invoke>");
	});

	test("doubled root with `||` seam (real mercury) normalizes", () => {
		expect(normalizeMangledMarkers(`${MP}|inc_tool_call_ml|_calls>`)).toBe("<tool_calls>");
	});

	test("doubled root with `|<|` seam (test fixture) normalizes", () => {
		expect(normalizeMangledMarkers(`${MP}<|inc_tool_call_ml|_calls>`)).toBe("<tool_calls>");
	});

	test("parameter tags with string=true normalize", () => {
		const input = `${MP}parameter name="path" string="true">src/a.ts${MCP}parameter>`;
		expect(normalizeMangledMarkers(input)).toBe('<parameter name="path" string="true">src/a.ts</parameter>');
	});

	test("full mangled block normalizes to clean XML tree", () => {
		const block = `${MP}|inc_tool_call_ml|_calls>
${MP}invoke name="glob">
${MP}parameter name="path" string="true">src/a.ts${MCP}parameter>
${MCP}invoke>
${MCP}tool_calls>`;
		const out = normalizeMangledMarkers(block);
		expect(out).not.toContain("inc_tool_call_ml");
		expect(out).toContain("<tool_calls>");
		expect(out).toContain('<invoke name="glob">');
		expect(out).toContain('<parameter name="path" string="true">src/a.ts</parameter>');
	});

	test("clean XML passes through untouched", () => {
		const clean = '<tool_calls><invoke name="glob"><parameter name="path">src/a.ts</parameter></invoke></tool_calls>';
		expect(normalizeMangledMarkers(clean)).toBe(clean);
	});
});