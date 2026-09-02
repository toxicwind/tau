import type { OAuthLoginCallbacks } from "./oauth/types";
import type { ProviderDefinition } from "./types";

export const opencodeGoProvider = {
	id: "opencode-go",
	name: "OpenCode Go",
	// OpenCode Go is a metered/free gateway; daily-quota windows can request
	// multi-hour `retry-after-ms` (observed ~21_400_000 ms = ~6h). Honour the
	// hint end-to-end instead of failing fast against the default 60s cap.
	retry: { unboundedRetryAfter: true },
	login: async (cb: OAuthLoginCallbacks) => {
		// Lazy import: keep heavy OAuth flow modules out of the eager registry graph.
		const { loginOpenCode } = await import("./oauth/opencode");
		return loginOpenCode(cb, "OpenCode Go");
	},
} as const satisfies ProviderDefinition;
