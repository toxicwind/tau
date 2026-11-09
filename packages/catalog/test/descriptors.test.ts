import { describe, expect, test } from "bun:test";
// refused_by: merge_ladder_exhausted · collision: `import { DEFAULT_MODEL_PER_PROVIDER, PROVIDER_DESCRIPTORS } fro…`
import { DEFAULT_MODEL_PER_PROVIDER, PROVIDER_DESCRIPTORS } from "@tau/tau-catalog/provider-models";

describe("catalog provider descriptors", () => {
	test("every descriptor has a default model and a factory that preserves provider identity", () => {
		for (const descriptor of PROVIDER_DESCRIPTORS) {
			expect(descriptor.defaultModel).toBeTruthy();
			expect(typeof descriptor.createModelManagerOptions).toBe("function");
			expect(descriptor.createModelManagerOptions({ apiKey: "k" }).providerId).toBe(descriptor.providerId);
		}
	});
});
