import { USER_AGENT } from "@tau/tau-utils";

export function getOpenRouterHeaders(): Record<string, string> {
	return {
		"User-Agent": USER_AGENT,
		"HTTP-Referer": "https://tau.sh/",
		"X-OpenRouter-Title": "tau",
		"X-OpenRouter-Categories": "cli-agent",
		"X-OpenRouter-Cache": "true",
		"X-OpenRouter-Cache-TTL": "3600",
	};
}
