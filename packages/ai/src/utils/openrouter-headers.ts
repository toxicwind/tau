<<<<<<< ours — interstitial `file_header` (S, confidence: medium)
// refused_by: merge_ladder_exhausted · collision: `import { USER_AGENT } from "@oh-my-pi/pi-utils";`
import { USER_AGENT } from "@tau/tau-utils";
=======
import { APP_NAME, APP_URL, USER_AGENT } from "@oh-my-pi/pi-utils";
>>>>>>> theirs — interstitial `file_header` (S, confidence: medium) · weave: run 'weave explain packages/ai/src/utils/openrouter-headers.ts' for per-hunk detail, 'weave check' to verify your resolution

export function getOpenRouterHeaders(): Record<string, string> {
	return {
		"User-Agent": USER_AGENT,
<<<<<<< ours — scope `return {` in function `getOpenRouterHeaders` (F, confidence: medium)
// refused_by: statement_fold · collision: `"HTTP-Referer": "https://omp.sh/",` +1 more
		"HTTP-Referer": "https://tau.sh/",
		"X-OpenRouter-Title": "tau",
=======
		"HTTP-Referer": APP_URL,
		"X-OpenRouter-Title": APP_NAME,
>>>>>>> theirs — scope `return {`
		"X-OpenRouter-Categories": "cli-agent",
		"X-OpenRouter-Cache": "true",
		"X-OpenRouter-Cache-TTL": "3600",
	};
}
