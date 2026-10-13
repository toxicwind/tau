import { expect, test } from "bun:test";
import { parseMarkdownList, isMarkdownList, coerceValue } from "../src/dialect/coercion";

test("isMarkdownList detects checklist shapes", () => {
	expect(isMarkdownList("## Alpha\n- [ ] one\n- [ ] two")).toBe(true);
	expect(isMarkdownList("- one\n- two")).toBe(true);
	expect(isMarkdownList("1. one\n2. two")).toBe(true);
	expect(isMarkdownList("just a string")).toBe(false);
	expect(isMarkdownList('{"a": 1}')).toBe(false);
});

test("parseMarkdownList strips bullets and checkboxes", () => {
	expect(parseMarkdownList("## Alpha\n- [ ] one\n- [ ] two")).toEqual(["one", "two"]);
	expect(parseMarkdownList("- one\n* two\n+ three")).toEqual(["one", "two", "three"]);
	expect(parseMarkdownList("1. first\n2. second")).toEqual(["first", "second"]);
});

test("coerceValue recovers markdown list for array schema (Dots shape)", () => {
	const schema = { type: "array", items: { type: "string" } };
	const result = coerceValue("## Alpha\n- [ ] one\n- [ ] two", schema);
	expect(result).toEqual(["one", "two"]);
});

test("coerceValue leaves non-list strings alone", () => {
	const schema = { type: "array", items: { type: "string" } };
	const result = coerceValue("just a string", schema);
	expect(result).toBe("just a string");
});

test("coerceValue still parses JSON", () => {
	const schema = { type: "array", items: { type: "string" } };
	const result = coerceValue('["a", "b"]', schema);
	expect(result).toEqual(["a", "b"]);
});
