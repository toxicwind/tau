import { type CompactionSettings, resolveThresholdTokens } from "@tau/tau-agent-core/compaction";
import type { Model } from "@tau/tau-ai";
import {
	computeCompactionBoundaries,
	computeContextBreakdown,
	type CompactionBoundaries,
	type ContextBreakdown,
	type ContextSavingsEstimate,
<<<<<<< ours — interstitial `file_header` (S+F, confidence: low)
// refused_by: merge_ladder_exhausted · collision: none (1 contested hunk(s), neither side deleted the other's lines)
} from "@tau/tau-tui/status-line/context-usage";
import type { Settings } from "../config/settings";
=======
} from "@oh-my-pi/pi-tui/status-line/context-usage";
import type { ScopeLike } from "../config/registry";
>>>>>>> theirs — interstitial `file_header` (S+F, confidence: low) · weave: run 'weave explain packages/coding-agent/src/session/context-usage-runtime.ts' for per-hunk detail, 'weave check' to verify your resolution
import type { AgentSession } from "./agent-session";
import { resolveSpeculationMethod } from "./compaction-methods";
import { estimateInlineSavings } from "./snapcompact-inline";
import { resolveModelCompactionSettings } from "./model-compaction-threshold";
import { resolveSpeculationLeadTokens } from "./speculation-lead";

import { cfgSkillful } from "./settings";
import { cfgSnapcompactShape, cfgSnapcompactSystemPrompt, cfgSnapcompactToolResults } from "./context-settings";

/** Resolve session policy before handing pure boundary arithmetic to the UI. */
export function getSessionCompactionBoundaries(
	settings: ScopeLike,
	contextWindow: number,
	model?: Model | null,
): CompactionBoundaries | null {
	if (!(contextWindow > 0)) return null;
	const configured = resolveModelCompactionSettings(settings, model);
	const compaction: CompactionSettings = configured;
	if (!compaction.enabled || compaction.strategy === "off") return null;
	const threshold = resolveThresholdTokens(contextWindow, compaction);
	if (!(threshold > 0) || threshold > contextWindow) return null;
	const speculates = configured.asyncEnabled !== false && resolveSpeculationMethod(model, configured) !== undefined;
	return computeCompactionBoundaries(
		compaction,
		contextWindow,
		speculates ? resolveSpeculationLeadTokens(threshold) : undefined,
	);
}

/** Read host settings and optionally run the provider's inline-image planner. */
export function computeSessionContextBreakdown(
	session: AgentSession,
	options?: { snapcompactSavings?: boolean },
): ContextBreakdown {
	let snapcompact: ContextSavingsEstimate | undefined;
	if (options?.snapcompactSavings) {
		const renderSystemPrompt = cfgSnapcompactSystemPrompt.get(session.settings);
		const renderToolResults = cfgSnapcompactToolResults.get(session.settings);
		if (renderSystemPrompt !== "none" || renderToolResults) {
			snapcompact = estimateInlineSavings({
				options: { renderSystemPrompt, renderToolResults, shape: cfgSnapcompactShape.get(session.settings) },
				model: session.model,
				systemPrompt: session.systemPrompt ?? [],
				messages: session.messages ?? [],
			});
		}
	}
	return computeContextBreakdown(session, {
		compaction: resolveModelCompactionSettings(session.settings, session.model),
		sourceRevision: session.settings.revision,
		skillful: cfgSkillful.get(session.settings),
		snapcompact,
	});
}
