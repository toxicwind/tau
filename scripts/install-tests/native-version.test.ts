import { describe, expect, it } from "bun:test";
import { nativeVersionFromExports } from "./native-version";
import { nativeVersionFromBindings } from "./native-version";

const fn = () => {};

describe("native addon release version", () => {
	it("reads the post-link stamp", () => {
		expect(nativeVersionFromBindings({ load: fn, __piNativesBuildVersion: () => "18.4.0" })).toBe("18.4.0");
		expect(nativeVersionFromBindings({ __piNativesBuildVersion: () => null })).toBeUndefined();
	});

	it("normalizes the unique legacy version sentinel", () => {
		expect(nativeVersionFromBindings({ load: fn, __piNativesV17_2_6: fn, other: fn })).toBe("17.2.6");
	});

	it("rejects missing or ambiguous legacy sentinels", () => {
		expect(nativeVersionFromBindings({ load: fn })).toBeUndefined();
		expect(nativeVersionFromBindings({ __piNativesV17_2_6: fn, __piNativesV17_2_7: fn })).toBeUndefined();
	});
});

// refused_by: modify_delete_guard · collision: none (no common ancestor text)
describe("native addon release sentinel", () => {
	it("normalizes the unique version sentinel", () => {
		expect(nativeVersionFromExports(["load", "__tauNativesV17_2_6", "other"])).toBe("17.2.6");
	});

	it("normalizes a pre-rebrand sentinel under the legacy prefix", () => {
		expect(nativeVersionFromExports(["load", "__piNativesV17_2_6", "other"])).toBe("17.2.6");
	});

	it("rejects missing or ambiguous sentinels", () => {
		expect(nativeVersionFromExports(["load"])).toBeUndefined();
		expect(nativeVersionFromExports(["__tauNativesV17_2_6", "__tauNativesV17_2_7"])).toBeUndefined();
		// Same release under both prefixes is one version, not an ambiguity.
		expect(nativeVersionFromExports(["__tauNativesV17_2_6", "__piNativesV17_2_6"])).toBe("17.2.6");
		expect(nativeVersionFromExports(["__tauNativesV17_2_6", "__piNativesV17_2_7"])).toBeUndefined();
	});
});
