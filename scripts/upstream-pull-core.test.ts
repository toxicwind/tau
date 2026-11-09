import { describe, expect, test } from "bun:test";
import {
	classifyFromBooleans,
	lineDelta,
	gateUniversalFromLines,
	invertMap,
} from "./upstream-pull-core.ts";

describe("invertMap", () => {
	test("inverts key/value pairs", () => {
		expect(invertMap({ a: "b", c: "d" })).toEqual({ b: "a", d: "c" });
	});
});

describe("lineDelta", () => {
	test("identifies added and removed lines as multisets", () => {
		const delta = lineDelta(["a", "b", "c"], ["b", "c", "d"]);
		expect(delta.removed).toEqual(["a"]);
		expect(delta.added).toEqual(["d"]);
	});

	test("handles duplicate lines correctly", () => {
		const delta = lineDelta(["a", "a"], ["a"]);
		expect(delta.removed).toEqual(["a"]);
		expect(delta.added).toEqual([]);
	});
});

describe("classifyFromBooleans", () => {
	test("returns deleted-upstream when not in theirs", () => {
		expect(
			classifyFromBooleans({
				inBase: true,
				inOurs: true,
				inTheirs: false,
				isBinary: false,
				sameOursBase: false,
				sameTheirsBase: false,
				isManifest: false,
			}),
		).toBe("deleted-upstream");
	});

	test("returns upstream-only when not in ours and not in base", () => {
		expect(
			classifyFromBooleans({
				inBase: false,
				inOurs: false,
				inTheirs: true,
				isBinary: false,
				sameOursBase: false,
				sameTheirsBase: false,
				isManifest: false,
			}),
		).toBe("upstream-only");
	});

	test("manifest always takes weave over suture", () => {
		expect(
			classifyFromBooleans({
				inBase: true,
				inOurs: true,
				inTheirs: true,
				isBinary: false,
				sameOursBase: false,
				sameTheirsBase: false,
				isManifest: true,
			}),
		).toBe("weave");
	});
});

describe("gateUniversalFromLines", () => {
	test("flags dropped upstream addition", () => {
		const findings = gateUniversalFromLines(
			"foo.ts",
			["base"],
			["base"],
			["base", "upstream-added"],
			["base"], // dropped
		);
		expect(findings.length).toBe(1);
		expect(findings[0]!.problem).toContain("upstream added");
	});

	test("flags restored ours deletion", () => {
		const findings = gateUniversalFromLines(
			"foo.ts",
			["base", "deleted"],
			["base"],
			["base", "deleted"],
			["base", "deleted"], // restored
		);
		expect(findings.length).toBe(1);
		expect(findings[0]!.problem).toContain("we deleted");
	});
});
