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
});
