<<<<<<< ours — interstitial `file_header` (S+F, confidence: low)
// refused_by: merge_ladder_exhausted · collision: `import type { HTMLElement } from "@oh-my-pi/pi-utils/dom";`
import type { HTMLElement } from "@tau/tau-utils/dom";
=======
import { prompt } from "@oh-my-pi/pi-utils";
import { settings } from "../../config/settings";
import xReadPrompt from "../../prompts/system/x-read.md" with { type: "text" };
>>>>>>> theirs — interstitial `file_header` (S+F, confidence: low) · weave: run 'weave explain packages/coding-agent/src/web/scrapers/twitter.ts' for per-hunk detail, 'weave check' to verify your resolution
import { ToolAbortError } from "../../tools/tool-errors";
import { SEARCH_HARD_TIMEOUT_MS } from "../search/providers/utils";
import {
	parseXAIAnswer,
	requestXAIResponses,
	XAI_SEARCH_REASONING_EFFORT,
	XAI_SEARCH_MAX_TURNS,
	xaiModelChain,
} from "../search/providers/xai";
import { parseXUrl, type XProfileTab, type XTarget } from "../x";
import type { RenderResult, SpecialHandler } from "./types";
import { buildResult } from "./types";

/** Search operators narrowing `from:<handle>` to what each profile tab shows. */
const PROFILE_TAB_FILTERS: Record<XProfileTab, string> = {
	posts: " -filter:replies",
	replies: "",
	media: " filter:media",
};

function promptContext(target: Exclude<XTarget, { kind: "unsupported" }>): Record<string, unknown> {
	switch (target.kind) {
		case "post":
			return { post: true, id: target.id };
		case "profile":
			return {
				profile: true,
				handle: target.handle,
				query: `from:${target.handle}${PROFILE_TAB_FILTERS[target.tab]}`,
			};
		case "search":
			return { search: true, query: target.query, mode: target.latest ? "Latest" : "Top" };
		case "users":
			return { users: true, query: target.query };
	}
}

function unavailable(url: string, fetchedAt: string, reason: string): RenderResult {
	return {
		url,
		finalUrl: url,
		contentType: "text/plain",
		method: "x-unavailable",
		content: reason,
		fetchedAt,
		truncated: false,
		notes: [],
	};
}

/**
 * Read X posts, profiles, and searches through Grok's native `x_search` tool
 * (`x_thread_fetch`, `x_user_search`, `x_keyword_search`); X blocks direct
 * scraping. Needs `xai-oauth` or `xai` credentials; tries the models of
 * {@link xaiModelChain} in order until one answers.
 */
export const handleTwitter: SpecialHandler = async (url, timeout, signal, _storage, modelRegistry) => {
	const target = parseXUrl(url);
	if (!target) return null;
	const fetchedAt = new Date().toISOString();
	if (target.kind === "unsupported") {
		return unavailable(
			url,
			fetchedAt,
			"X blocks automated access, and Grok's X tools only read posts, profiles, post searches, and hashtags.",
		);
	}
	const models = modelRegistry ? xaiModelChain(modelRegistry, settings) : [];
	if (!modelRegistry || models.length === 0) {
		return unavailable(
			url,
			fetchedAt,
			"X blocks automated access. Reading X goes through Grok's X tools, which need xAI credentials: log in to `xai-oauth` or set `XAI_API_KEY`.",
		);
	}

	const systemPrompt = prompt.render(xReadPrompt, promptContext(target));
	// Handle filters bind every keyword/semantic search, so a profile read cannot drift to other authors.
	const xSearch =
		target.kind === "profile" ? { type: "x_search", allowed_x_handles: [target.handle] } : { type: "x_search" };
	const failures: string[] = [];
	for (const model of models) {
		try {
			const { response } = await requestXAIResponses(
				{
					model,
					modelRegistry,
					authStorage: modelRegistry.authStorage,
					signal,
					timeoutMs: Math.max(timeout * 1000, SEARCH_HARD_TIMEOUT_MS),
				},
				{
					model: model.id,
					input: [
						{ role: "system", content: systemPrompt },
						{ role: "user", content: url },
					],
					tools: [xSearch],
					max_turns: XAI_SEARCH_MAX_TURNS,
					reasoning: { effort: XAI_SEARCH_REASONING_EFFORT },
				},
			);
			const content = parseXAIAnswer(response);
			if (!content) {
				failures.push(`${model.provider}/${model.id}: no answer`);
				continue;
			}
			const usage = response.usage?.server_side_tool_usage_details;
			return buildResult(content, {
				url,
				method: "x-search",
				fetchedAt,
				notes: [
					`Read by ${model.provider}/${model.id} via x_search (${usage?.x_posts_fetched ?? 0} posts, ${usage?.x_users_fetched ?? 0} profiles fetched); the model relays the text`,
				],
			});
		} catch (error) {
			if (signal?.aborted) throw new ToolAbortError();
			failures.push(`${model.provider}/${model.id}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return unavailable(url, fetchedAt, `Grok's X tools failed for ${url}: ${failures.join("; ")}`);
<<<<<<< ours — scope `try {` in function `handleTwitter`, deleted in theirs (S+F, confidence: low)
// refused_by: statement_fold · collision: none (no common ancestor text)
	try {
		const parsed = new URL(url);
		if (!["twitter.com", "x.com", "www.twitter.com", "www.x.com"].includes(parsed.hostname)) {
			return null;
		}

		const fetchedAt = new Date().toISOString();

		// Try Nitter instances
		for (const instance of NITTER_INSTANCES) {
			const nitterUrl = `https://${instance}${parsed.pathname}`;
			const result = await loadPage(nitterUrl, { timeout: Math.min(timeout, 10), signal });

			if (result.ok && result.content.length > 500) {
				// Parse the Nitter HTML
				const { parseHTML } = await import("@tau/tau-utils/dom");
				const doc = parseHTML(result.content).document;

				// Extract tweet content
				const tweetContent = doc.querySelector(".tweet-content")?.textContent?.trim();
				const fullname = doc.querySelector(".fullname")?.textContent?.trim();
				const username = doc.querySelector(".username")?.textContent?.trim();
				const date = doc.querySelector(".tweet-date a")?.textContent?.trim();
				const stats = doc.querySelector(".tweet-stats")?.textContent?.trim();

				if (tweetContent) {
					let md = `# Tweet by ${fullname || "Unknown"} (${username || "@?"})\n\n`;
					if (date) md += `*${date}*\n\n`;
					md += `${tweetContent}\n\n`;
					if (stats) md += `---\n${stats.replace(/\s+/g, " ")}\n`;

					// Check for replies/thread
					const replies = Array.from(doc.querySelectorAll(".timeline-item .tweet-content")) as HTMLElement[];
					if (replies.length > 1) {
						md += `\n---\n\n## Thread/Replies\n\n`;
						for (const reply of replies.slice(1, 10)) {
							const replyUser = reply.parentElement?.querySelector(".username")?.textContent?.trim();
							md += `**${replyUser || "@?"}**: ${reply.textContent?.trim()}\n\n`;
						}
					}

					return buildResult(md, {
						url,
						finalUrl: nitterUrl,
						method: "twitter-nitter",
						fetchedAt,
						notes: [`Via Nitter: ${instance}`],
					});
				}
			}
		}
	} catch {
		if (signal?.aborted) {
			throw new ToolAbortError();
		}
	}
=======
>>>>>>> theirs — scope `try {` deleted in theirs
};
