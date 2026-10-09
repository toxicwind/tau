import { describe, expect, test } from "bun:test";

import { derivePathMap, MIN_DIR_SUPPORT, parseRenameRecords, realignPath } from "./upstream-pull-paths.ts";

describe("parseRenameRecords", () => {
	test("keeps only rename rows", () => {
		const out = parseRenameRecords(
			[
				"R096\tcrates/pi-natives/src/lib.rs\tcrates/tau-natives/src/lib.rs",
				"M\tREADME.md\tREADME.md",
				"A\ta\tb",
				"D\tx\ty",
			].join("\n"),
		);
		expect(out).toEqual([{ from: "crates/pi-natives/src/lib.rs", to: "crates/tau-natives/src/lib.rs" }]);
	});

	test("rejects a malformed row rather than inventing a move", () => {
		expect(parseRenameRecords("R096\tmissing-to-side")).toEqual([]);
	});

	test("normalizes windows separators", () => {
		expect(parseRenameRecords("R100\tcrates\\pi-ast\\src\\lib.rs\tcrates\\tau-ast\\src\\lib.rs")).toEqual([
			{ from: "crates/pi-ast/src/lib.rs", to: "crates/tau-ast/src/lib.rs" },
		]);
	});
});

describe("derivePathMap", () => {
	/** `n` files moving from one directory to another is a directory rename. */
	const moved = (from: string, to: string, n: number) =>
		Array.from({ length: n }, (_, i) => ({ from: `${from}/f${i}.rs`, to: `${to}/f${i}.rs` }));

	test("recovers a directory rename from per-file records", () => {
		const map = derivePathMap(moved("crates/pi-natives/src", "crates/tau-natives/src", 12));
		// The crate root is lifted from its child: git reports no rename for a
		// file directly in `crates/pi-natives/`, but leaving the root behind
		// makes the merge write a second, half-empty copy of the crate.
		expect(map).toEqual({
			"crates/pi-natives": "crates/tau-natives",
			"crates/pi-natives/src": "crates/tau-natives/src",
		});
		expect(realignPath("crates/pi-natives/src/lib.rs", map)).toBe("crates/tau-natives/src/lib.rs");
		expect(realignPath("crates/pi-natives/Cargo.toml", map)).toBe("crates/tau-natives/Cargo.toml");
	});

	test("recovers each renamed crate independently", () => {
		const map = derivePathMap([
			...moved("crates/pi-natives/src", "crates/tau-natives/src", 9),
			...moved("crates/pi-shell/src", "crates/tau-shell/src", 7),
			...moved("crates/pi-edit/src", "crates/tau-edit/src", 5),
		]);
		expect(map["crates/pi-natives/src"]).toBe("crates/tau-natives/src");
		expect(map["crates/pi-shell/src"]).toBe("crates/tau-shell/src");
		expect(map["crates/pi-edit/src"]).toBe("crates/tau-edit/src");
	});

	// The real reason a prefix rule was the wrong tool: none of these are
	// prefixes of each other, and two change length.
	test("handles the non-prefix renames in this fork", () => {
		const map = derivePathMap([
			...moved("packages/mnemopi/src", "packages/mnemotau/src", 6),
			...moved("packages/omptype/src", "packages/tautype/src", 6),
			...moved("crates/pi-vcs/src", "crates/tau-vcs/src", 6),
		]);
		expect(map["packages/mnemopi/src"]).toBe("packages/mnemotau/src");
		expect(map["packages/omptype/src"]).toBe("packages/tautype/src");
		expect(map["crates/pi-vcs/src"]).toBe("crates/tau-vcs/src");
	});

	test("ignores a lone moved file — that is not a directory rename", () => {
		expect(derivePathMap(moved("docs", "docs/upstream", 1))).toEqual({});
	});

	test("stays silent below the support threshold", () => {
		expect(derivePathMap(moved("a/src", "b/src", MIN_DIR_SUPPORT - 1))).toEqual({});
	});

	test("drops a directory whose evidence is split evenly", () => {
		const records = [
			...moved("crates/pi-natives/src", "crates/tau-natives/src", 4),
			...moved("crates/pi-natives/src", "crates/somewhere-else/src", 4),
		];
		expect(derivePathMap(records)["crates/pi-natives/src"]).toBeUndefined();
	});

	test("keeps the majority when evidence is uneven", () => {
		const records = [
			...moved("crates/pi-natives/src", "crates/tau-natives/src", 6),
			...moved("crates/pi-natives/src", "crates/somewhere-else/src", 2),
		];
		expect(derivePathMap(records)["crates/pi-natives/src"]).toBe("crates/tau-natives/src");
	});

	test("ignores a file that did not change directory", () => {
		expect(derivePathMap([...moved("crates/x/src", "crates/x/src", 9)])).toEqual({});
	});

	test("an empty record set yields no map rather than throwing", () => {
		expect(derivePathMap([])).toEqual({});
	});

	// `git rename docs docs/upstream` is a reorganization, not a rename, and
	// replaying it as a filesystem move is rename(2) on a directory into its
	// own subtree — EINVAL on Linux. This pair is in the real fork diff.
	test("drops a move whose destination is inside its own source", () => {
		expect(derivePathMap(moved("docs", "docs/upstream", 40))).toEqual({});
	});

	test("still keeps a sibling move alongside a dropped nested one", () => {
		const map = derivePathMap([
			...moved("docs", "docs/upstream", 40),
			...moved("crates/pi-natives", "crates/tau-natives", 40),
		]);
		expect(map).toEqual({ "crates/pi-natives": "crates/tau-natives" });
	});
});

describe("realignPath", () => {
	const map = {
		"crates/pi-natives/src": "crates/tau-natives/src",
		"crates/pi-shell/src": "crates/tau-shell/src",
	};

	test("rewrites a path under a renamed directory", () => {
		expect(realignPath("crates/pi-natives/src/utok/tables.rs", map)).toBe("crates/tau-natives/src/utok/tables.rs");
	});

	test("rewrites the directory itself", () => {
		expect(realignPath("crates/pi-shell/src", map)).toBe("crates/tau-shell/src");
	});

	test("leaves an unmapped path alone", () => {
		expect(realignPath("packages/ai/src/index.ts", map)).toBe("packages/ai/src/index.ts");
	});

	// `crates/pi-natives/...` must not be half-consumed by a shorter entry
	// that happens to be a prefix of it.
	test("prefers the longest matching prefix", () => {
		const nested = { "crates/pi": "crates/tau", "crates/pi-natives/src": "crates/tau-natives/src" };
		expect(realignPath("crates/pi-natives/src/lib.rs", nested)).toBe("crates/tau-natives/src/lib.rs");
	});

	test("does not match a directory whose name merely starts the same", () => {
		expect(realignPath("crates/pi-natives-extra/src/lib.rs", map)).toBe("crates/pi-natives-extra/src/lib.rs");
	});

	test("an empty map is a no-op", () => {
		expect(realignPath("crates/pi-natives/src/lib.rs", {})).toBe("crates/pi-natives/src/lib.rs");
	});
});
