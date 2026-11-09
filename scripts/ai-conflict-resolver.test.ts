import { describe, expect, test } from "bun:test";

import { nativePolicy, parseHunks } from "./ai-conflict-resolver";

const hunk = (ours: string[], theirs: string[]) => ({ ours, theirs });

describe("nativePolicy", () => {
	test("forces ours for any hunk in the renamed native crate", () => {
		for (const rel of ["crates/tau-natives/src/utok/bpe.rs", "crates/tau-natives/src/tokens.rs"]) {
			expect(nativePolicy(rel, hunk(["a"], ["b"]))).toEqual({
				protected: true,
				reason: "native-crate",
			});
		}
	});

	test("forces ours in the upstream spelling too", () => {
		// upstream-pull stages conflicts at upstream paths; the gate must not
		// be bypassed by path realignment.
		expect(nativePolicy("crates/pi-natives/src/utok/bpe.rs", hunk(["a"], ["b"]))).toEqual({
			protected: true,
			reason: "native-crate",
		});
	});

	test("does not protect unrelated crates", () => {
		expect(nativePolicy("crates/tau-shell/src/lib.rs", hunk(["a"], ["b"]))).toEqual({
			protected: false,
		});
		// A near-miss prefix must not match the alternation.
		expect(nativePolicy("crates/pi-natives-extra/src/lib.rs", hunk(["a"], ["b"]))).toEqual({
			protected: false,
		});
	});

	test("protected token wins outside the native crate", () => {
		expect(nativePolicy("crates/tau-diff/src/lib.rs", hunk(["x"], ["header_offset"]))).toEqual({
			protected: true,
			reason: "header_offset",
		});
	});
});

describe("parseHunks integration", () => {
	test("a staged pi-natives conflict hunk is classified protected", () => {
		const text = [
			"<<<<<<< ours",
			"let header = HEADER_OFFSET;",
			"||||||| base",
			"let header = HEADER_OFFSET;",
			"=======",
			"let header = offset - 12;",
			">>>>>>> theirs",
		].join("\n");
		const hunks = parseHunks(text);
		expect(hunks).not.toBeNull();
		const first = hunks![0]!;
		expect(nativePolicy("crates/pi-natives/src/utok/tables.rs", first).protected).toBe(true);
	});
	test("parses hunks with trailing weave annotations", () => {
		const text = [
			'<<<<<<< ours — scope `"check:types": "tsgo -p tsconfig.json --noEmit",` in object `scripts` (S, confidence: medium)',
			'    "check:types": "bun ../../scripts/typecheck.ts . --noEmit",',
			"=======",
			'    "check:types": "bun check --no-script -p tsconfig.json",',
			'>>>>>>> theirs — scope `"check:types": "tsgo -p tsconfig.json --noEmit",`',
		].join("\n");
		const hunks = parseHunks(text);
		expect(hunks).not.toBeNull();
		expect(hunks!.length).toBe(1);
		expect(hunks![0]!.ours).toEqual(['    "check:types": "bun ../../scripts/typecheck.ts . --noEmit",']);
		expect(hunks![0]!.theirs).toEqual(['    "check:types": "bun check --no-script -p tsconfig.json",']);
	});
});

import { sanitizeModelOutput } from "./ai-conflict-resolver";

describe("sanitizeModelOutput", () => {
	test("strips markdown fences and conflict markers emitted by model", () => {
		const dirty = [
			"```ts",
			"<<<<<<< ours",
			"const a = 1;",
			"=======",
			"const a = 2;",
			">>>>>>> theirs",
			"```",
		].join("\n");
		expect(sanitizeModelOutput(dirty)).toBe("const a = 1;\n\nconst a = 2;");
	});
});
