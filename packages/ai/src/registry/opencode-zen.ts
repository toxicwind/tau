import type { OAuthLoginCallbacks } from "./oauth/types";
import type { ProviderDefinition } from "./types";

export const opencodeZenProvider = {
	id: "opencode-zen",
	name: "OpenCode Zen",
	// OpenCode Zen subscription daily-quota resets can request multi-hour
	// `retry-after-ms` (observed ~21_400_000 ms = ~6h on free tier). Honour
	// the hint end-to-end instead of failing fast against the default 60s cap.
	retry: { unboundedRetryAfter: true },
	login: async (cb: OAuthLoginCallbacks) => {
		// Lazy import: keep heavy OAuth flow modules out of the eager registry graph.
		const { loginOpenCode } = await import("./oauth/opencode");
		return loginOpenCode(cb, "OpenCode Zen");
	},
} as const satisfies ProviderDefinition;
