import { afterEach, describe, expect, it } from "bun:test";
import {
	CallableLlmBackend,
	callHostLlm,
<<<<<<< ours — imports `file_header` (F, confidence: medium)
// refused_by: merge_ladder_exhausted · collision: none (both sides edited, nowhere the same lines)
	getHostLlmBackend,
	resetHostLlmBackendForTests,
	setHostLlmBackend,
} from "@tau/tau-mnemotau/core/llm-backends";
=======
	resetHostLlmBackendForTests,
	setHostLlmBackend,
} from "@oh-my-pi/pi-mnemopi/core/llm-backends";
>>>>>>> theirs — imports `file_header` (F, confidence: medium) · weave: run 'weave explain packages/mnemotau/test/llm-backends.test.ts' for per-hunk detail, 'weave check' to verify your resolution

afterEach(() => resetHostLlmBackendForTests());

describe("host LLM backend registry", () => {
	it("returns null without a backend", async () => {
		expect(await callHostLlm("anything", { maxTokens: 64 })).toBeNull();
	});

	it("swallows backend exceptions", async () => {
		setHostLlmBackend(
			new CallableLlmBackend("boom", () => {
				throw new Error("provider exploded");
			}),
		);
		expect(await callHostLlm("anything", { maxTokens: 64 })).toBeNull();
	});
});
