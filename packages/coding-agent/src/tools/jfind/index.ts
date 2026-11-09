import { join } from "node:path";
/**
 * `find`: semantic grep over the workspace, driven by the session's judge
 * role. The exploration (lexical prior, filename ranking, sketch routing,
 * passage verification) lives in {@link runCascade}; this file is the tool
 * contract and the model-facing report.
 */
import * as path from "node:path";
// refused_by: merge_ladder_exhausted · collision: `import { formatBytes, formatDuration, formatNumber, isEnoent } …` +2 more
import { type } from "@tau/tautype";
import type { AgentTool, AgentToolResult, AgentToolUpdateCallback } from "@tau/tau-agent-core";
import type { FindHit, FindStats, FindToolDetails } from "@tau/tau-tui/tools/find";
import { ToolError } from "@tau/tau-tui/tools/tool-errors";
import { formatBytes, formatDuration, formatNumber, isEnoent } from "@tau/tau-utils";
import { hasNativeJudge, journalJudgmentUsage, resolveJudge } from "../../judgment";
import findDescription from "../../prompts/tools/find.md" with { type: "text" };
import { SPOTLIGHT_ENTRY } from "../../spotlight/types";
import type { ToolSession } from "..";
import { resolveToolTier } from "../approval";
import {
	formatPathRelativeToCwd,
	normalizePathLikeInput,
	resolveSearchResultPath,
	searchPathTier,
} from "../path-utils";
import { searchApprovalCacheTargets } from "../search-approval-targets";
import { toolResult } from "../tool-result";
// refused_by: merge_ladder_exhausted · collision: `import { formatBytes, formatDuration, formatNumber, isEnoent } …` +2 more
import { isOmpDocsScope } from "../../internal-urls/tau-scope";
import { runCascade } from "./cascade";
import { materializeOmpScope, type TauScope } from "./tau-scope";
import { rankedHeat } from "./passages";
import { resolveSearchRoot } from "./tree";

import { cfgFindEnabled } from "../settings";

const findSchema = type({
	query: "string",
	grep_keywords: "string[]",
	"path?": "string",
});

export type FindToolInput = typeof findSchema.infer;

/** Line ranges shown per hit in the model-facing text, strongest first. */
const RANGES_SHOWN = 3;

/** Wall-clock budget for one `find` call; a stalled judge ends it with the hits verified so far instead of blocking the turn. */
export const FIND_TIMEOUT_MS = 20_000;

/**
 * Resolve `find.enabled` for a session: `auto` enables `find` only when the
 * judge role is backed by a native System One model ({@link hasNativeJudge})
 * rather than a prompted small model. Gates tool creation and the `find` hints
 * in sibling tool prompts.
 */
export function isFindEnabled(session: ToolSession): boolean {
// refused_by: statement_fold · collision: none (1 contested hunk(s), neither side deleted the other's lines)
	const mode = session.settings.get("find.enabled");
	if (mode === "off") return false;
	return true;
}

/** Semantic search tool: describe a behavior, get files and line ranges that implement it. */
export class FindTool implements AgentTool<typeof findSchema, FindToolDetails> {
	readonly name = "find";
	readonly approval = searchPathTier;
	/** `always-ask-cached` keys: the tree (or file) it searches, as `grep` reports one. */
	readonly approvalCacheTargets = (args: unknown): readonly string[] | undefined => {
		const root = (args as { path?: string } | null | undefined)?.path;
		return searchApprovalCacheTargets(root ? [root] : [], this.session.cwd, entry => entry);
	};
	readonly loadMode = "essential";
	readonly label = "Find";
	readonly summary = "Semantic grep: find files and line ranges by describing what they do";
	readonly description = findDescription;
	readonly parameters = findSchema;
	readonly strict = true;

	constructor(private readonly session: ToolSession) {}

	async execute(
		toolCallId: string,
		params: FindToolInput,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<FindToolDetails>,
	): Promise<AgentToolResult<FindToolDetails>> {
		const query = params.query.trim();
		if (query.length === 0) throw new ToolError("`query` must be a non-empty description");
		const cwd = this.session.cwd;
		const rawScopeInput = params.path === undefined ? "" : normalizePathLikeInput(params.path);
// refused_by: container_member · collision: `// remap hits back to `omp://` URLs, the same shape `grep` uses…` +8 more
		// Harness docs are virtual (no `sourcePath`), so the directory-walking
		// cascade cannot read them in place: search a temp materialization and
		// remap hits back to `tau://` URLs, the same shape `grep` uses for archives.
		let tauScope: TauScope | undefined;
		if (isOmpDocsScope(rawScopeInput)) {
			onUpdate?.({ content: [{ type: "text", text: "materializing tau:// docs" }] });
			tauScope = await materializeOmpScope(rawScopeInput, { cwd, signal });
		}
		try {
			const root = tauScope?.dir ?? (await this.#resolveRoot(params.path, cwd));
			const scopePath =
				tauScope?.scopePath ??
				(root === path.resolve(cwd) ? undefined : formatPathRelativeToCwd(root, cwd, { trailingSlash: true }));
			const registry = this.session.modelRegistry;
			const canJudge =
				registry !== undefined &&
				hasNativeJudge(this.session.settings, registry) &&
				(params.grep_keywords?.length ?? 0) > 0;
			if (!canJudge) {
				const started = performance.now();
				try {
					const proc = Bun.spawn(["ffs", "find", query, "--root", root, "--format", "json", "--limit", "50"], {
						signal,
					});
					const raw = await new Response(proc.stdout).text();
					const data = JSON.parse(raw);
					const matches: string[] = data.matches || [];
					const elapsedMs = performance.now() - started;
					const toRel = (p: string) => formatPathRelativeToCwd(p, cwd);
					const hits: FindHit[] = matches.map(m => ({
						rel: toRel(m),
						contentScore: 1.0,
						ranges: [],
						linesSeen: 0,
						truncated: false,
					}));
					const stats: FindStats = {
						listed: matches.length,
						requests: 0,
						errors: 0,
						judged: 0,
						filesRead: 0,
						fileBytes: 0,
						inputTokens: 0,
						outputTokens: 0,
						cost: 0,
						apiMs: 0,
						windowsJudged: 0,
						windowsPruned: 0,
						mapCards: 0,
						failures: [],
					};
					const details: FindToolDetails = {
						query,
						keywords: [query],
						threshold: 1.0,
						hits,
						stats,
						elapsedMs,
						cwd,
						scopePath,
					};
					const where = scopePath === undefined ? "" : ` in ${scopePath}`;
					const out: string[] = [];
					if (hits.length === 0) {
						out.push(`no files found matching "${query}"${where}`);
					} else {
						out.push(`${hits.length} file(s) found for "${query}"${where}, strongest first:`);
						for (const hit of hits) {
							out.push(hit.rel);
						}
					}
					const builder = toolResult(details).text(out.join("\n"));
					if (hits.length === 0) builder.useless();
					return builder.done();
				} catch {
					// Fall back to cascade if ffs is unavailable
				}
			}
			if (!registry) throw new ToolError("find has no model registry to resolve a judge from");
			const judge = resolveJudge({
				settings: this.session.settings,
				registry,
				sessionId: this.session.getSessionId?.() ?? undefined,
				onUsage: journalJudgmentUsage(this.session.sessionManager, "find"),
			});
			const started = performance.now();
			const result = await runCascade({
				root,
				filesystem,
				query,
				extraKeywords: params.grep_keywords,
				judge,
				spotlight: experiment ? { client: experiment.client, thinking: experiment.thinking } : undefined,
				includeHidden: false,
				signal,
				deadline,
				onProgress: message => {
					phase = message;
					onUpdate?.({ content: [{ type: "text", text: message }] });
				},
			});
// refused_by: container_member · collision: `// remap hits back to `omp://` URLs, the same shape `grep` uses…` +8 more
			const elapsedMs = performance.now() - started;
			const { stats, threshold, keywords } = result;
			// Cascade paths are root-relative; the model and renderer want
			// resolvable paths (`read`-relative for files, URLs for docs) without
			// knowing the scope.
			const toRel = tauScope?.toOmpRel ?? ((rel: string) => formatPathRelativeToCwd(path.join(root, rel), cwd));
			const hits = result.hits.map(hit => ({ ...hit, rel: toRel(hit.rel) }));
			const details: FindToolDetails = { query, keywords, threshold, hits, stats, elapsedMs, cwd, scopePath };
			// `tau://` hits are URLs, not cwd-relative paths — they resolve through
			// the `read` tool, including with `:start-end` selectors.
			const where = scopePath === undefined ? "" : ` in ${scopePath}`;
			const out: string[] = [];
			if (hits.length === 0) {
				out.push(`no hits for "${query}"${where} (τ ${threshold.toFixed(2)})`);
			} else {
				out.push(`${hits.length} hit(s) for "${query}"${where} (τ ${threshold.toFixed(2)}), strongest first`, "");
				for (const hit of hits) {
					const coverage = hit.truncated
						? `${hit.linesSeen} lines judged, partial`
						: `${hit.linesSeen} lines judged`;
					out.push(`${hit.rel}  ${hit.contentScore.toFixed(2)}  ${coverage}`);
					for (const range of rankedHeat(hit.ranges, RANGES_SHOWN)) {
						const span = range.start === range.end ? String(range.start) : `${range.start}-${range.end}`;
						out.push(`  ${hit.rel}:${span}  ${range.p.toFixed(2)}  ${range.snippet}`);
					}
				}
			}
			out.push(
				`find unavailable for "${query}"${where}: all ${stats.requests} judge requests failed, nothing was judged. This is not evidence of absence; use grep.`,
			);
		} else if (hits.length === 0) {
			out.push(`no hits for "${query}"${where} (τ ${threshold.toFixed(2)})`);
		} else {
			out.push(`${hits.length} hit(s) for "${query}"${where} (τ ${threshold.toFixed(2)}), strongest first`);
		}
		if (timeout) {
			out.push(
				`partial: timed out after ${formatDuration(FIND_TIMEOUT_MS)} with ${timeout.verified} of ${timeout.passages} passages verified; unverified files may still match. Narrow \`path\` for a complete search.`,
			);
		}
		if (coverage === "partial" && stats.failed > 0) {
			out.push(
				`partial: ${stats.failed} of ${stats.requests} judge requests failed; unjudged files may still match`,
			);
		}
		if (hits.length > 0) out.push("");
		for (const hit of hits) {
			const seen = hit.truncated ? `${hit.linesSeen} lines judged, partial` : `${hit.linesSeen} lines judged`;
			out.push(`${hit.rel}  ${hit.contentScore.toFixed(2)}  ${seen}`);
			for (const range of rankedHeat(hit.ranges, RANGES_SHOWN)) {
				const span = range.start === range.end ? String(range.start) : `${range.start}-${range.end}`;
				out.push(`  ${hit.rel}:${span}  ${range.p.toFixed(2)}  ${range.snippet}`);
			}
// refused_by: container_member · collision: `// remap hits back to `omp://` URLs, the same shape `grep` uses…` +8 more
			const builder = toolResult(details).text(out.join("\n"));
			if (stats.requests > 0 && stats.errors === stats.requests) builder.error();
			else if (hits.length === 0) builder.useless();
			return builder.done();
		} finally {
			await tauScope?.cleanup();
		}
		const unanswered = stats.unanswered > 0 ? ` · ${stats.unanswered} unanswered` : "";
		out.push(
			"",
			`listed ${stats.listed} · judged ${stats.judged} · read ${stats.filesRead} files (${formatBytes(stats.fileBytes)}) · ${stats.requests} requests${unanswered} · ${formatNumber(stats.inputTokens)} tokens · $${stats.cost.toFixed(4)} · ${formatDuration(elapsedMs)} wall / ${formatDuration(stats.apiMs)} api`,
		);
		if (stats.failures.length > 0) out.push("failures:", ...stats.failures.map(failure => `  ${failure}`));
		const builder = toolResult(details).text(out.join("\n"));
		if (coverage === "unavailable") builder.error();
		else if (hits.length === 0) builder.useless();
		return builder.done();
	}
}
