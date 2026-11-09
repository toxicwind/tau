// refused_by: merge_ladder_exhausted · collision: `import { USER_AGENT } from "@oh-my-pi/pi-utils";`
import { USER_AGENT } from "@tau/tau-utils";

export function getOpenRouterHeaders(): Record<string, string> {
	return {
		"User-Agent": USER_AGENT,
// refused_by: statement_fold · collision: `"HTTP-Referer": "https://omp.sh/",` +1 more
		"HTTP-Referer": "https://tau.sh/",
		"X-OpenRouter-Title": "tau",
		"X-OpenRouter-Categories": "cli-agent",
		"X-OpenRouter-Cache": "true",
		"X-OpenRouter-Cache-TTL": "3600",
	};
}
