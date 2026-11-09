import { describe, expect, test } from "bun:test";
<<<<<<< ours — interstitial `file_header` (S, confidence: medium)
// refused_by: merge_ladder_exhausted · collision: `import { DEFAULT_MODEL_PER_PROVIDER, PROVIDER_DESCRIPTORS } fro…`
import { DEFAULT_MODEL_PER_PROVIDER, PROVIDER_DESCRIPTORS } from "@tau/tau-catalog/provider-models";
=======
import { PROVIDER_DESCRIPTORS } from "@oh-my-pi/pi-catalog/provider-models";
>>>>>>> theirs — interstitial `file_header` (S, confidence: medium) · weave: run 'weave explain packages/catalog/test/descriptors.test.ts' for per-hunk detail, 'weave check' to verify your resolution

describe("catalog provider descriptors", () => {
	test("every descriptor has a default model and a factory that preserves provider identity", () => {
		for (const descriptor of PROVIDER_DESCRIPTORS) {
			expect(descriptor.defaultModel).toBeTruthy();
			expect(typeof descriptor.createModelManagerOptions).toBe("function");
			expect(descriptor.createModelManagerOptions({ apiKey: "k" }).providerId).toBe(descriptor.providerId);
		}
	});
});
