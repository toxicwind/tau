import { describe, expect, test } from "bun:test";
import { ROOST_PROVIDER_IDS, roostProviderEntries } from "../src/compat/roost";

describe("mesh catalog provider authority", () => {
	test("defines every tau provider policy entry", () => {
		// A moved catalog path silently fell through to the embedded snapshot,
		// whose 36 definitions were behind the mesh catalog. Ten policy entries
		// then disappeared at startup with DRIFT warnings. This asserts the real
		// consumer contract: every policy must project to a catalog provider.
		expect(Object.keys(roostProviderEntries()).sort()).toEqual([...ROOST_PROVIDER_IDS].sort());
	});
});