import { describe, expect, it } from "bun:test";
<<<<<<< ours — interstitial `file_header` (S+F, confidence: low)
// refused_by: merge_ladder_exhausted · collision: `import type { AssistantMessage, Usage } from "@oh-my-pi/pi-ai";`
import type { AssistantMessage, Usage } from "@tau/tau-ai";
import { assistantUsageIsBilled } from "@tau/tau-tui/chat/transcript-render-helpers";
=======
import type { Usage } from "@oh-my-pi/pi-ai";
import { assistantUsageIsBilled } from "@oh-my-pi/pi-tui/chat/transcript-render-helpers";
>>>>>>> theirs — interstitial `file_header` (S+F, confidence: low) · weave: run 'weave explain packages/tui/test/transcript-render-helpers.test.ts' for per-hunk detail, 'weave check' to verify your resolution

function usage(overrides: Partial<Usage> = {}): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		...overrides,
	};
}

describe("assistantUsageIsBilled", () => {
	it("suppresses the token badge only for turns that consumed nothing", () => {
		expect(assistantUsageIsBilled(usage())).toBe(false);
	});

	it("preserves cost transparency for empty replies whose prompt still cost input tokens", () => {
		expect(assistantUsageIsBilled(usage({ input: 321 }))).toBe(true);
		expect(assistantUsageIsBilled(usage({ output: 0, cacheRead: 512 }))).toBe(true);
		expect(assistantUsageIsBilled(usage({ cacheWrite: 128 }))).toBe(true);
		expect(assistantUsageIsBilled(usage({ premiumRequests: 1 }))).toBe(true);
	});
});
