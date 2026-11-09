/**
 * Resolved Hindsight runtime configuration.
 *
 * Every field reads a `hindsight.*` setting handle. Handles declare their `HINDSIGHT_*`
 * environment variable, which wins over the settings layers because operators frequently
 * override per-shell (CI, prod) without touching the persisted settings file.
 */
<<<<<<< ours — interstitial `file_header` (S+F, confidence: low)
// refused_by: merge_ladder_exhausted · collision: `import { logger } from "@oh-my-pi/pi-utils";`

import { logger } from "@tau/tau-utils";
=======
>>>>>>> theirs — interstitial `file_header` (S+F, confidence: low) · weave: run 'weave explain packages/coding-agent/src/hindsight/config.ts' for per-hunk detail, 'weave check' to verify your resolution
import type { Settings } from "../config/settings";
import {
	cfgHindsightApiToken,
	cfgHindsightApiUrl,
	cfgHindsightAutoRecall,
	cfgHindsightAutoRetain,
	cfgHindsightBankId,
	cfgHindsightBankIdPrefix,
	cfgHindsightBankMission,
	cfgHindsightDebug,
	cfgHindsightGlobalScope,
	cfgHindsightMentalModelAutoSeed,
	cfgHindsightMentalModelMaxRenderChars,
	cfgHindsightMentalModelsEnabled,
	cfgHindsightRecallBudget,
	cfgHindsightRecallContextTurns,
	cfgHindsightRecallMaxQueryChars,
	cfgHindsightRecallMaxTokens,
	cfgHindsightRecallTimeoutMs,
	cfgHindsightRecallTypes,
	cfgHindsightReflectTimeoutMs,
	cfgHindsightRequestTimeoutMs,
	cfgHindsightRetainContext,
	cfgHindsightRetainEveryNTurns,
	cfgHindsightRetainMission,
	cfgHindsightRetainMode,
	cfgHindsightRetainOverlapTurns,
	cfgHindsightRetainTimeoutMs,
	cfgHindsightScoping,
} from "./settings";

export type HindsightScoping = "global" | "per-project" | "per-project-tagged";

export interface HindsightConfig {
	hindsightApiUrl: string | null;
	hindsightApiToken: string | null;

	bankId: string | null;
	bankIdPrefix: string;
	scoping: HindsightScoping;
	/** Whether `retain`/`learn` may store `scope: "global"` items untagged; opt-in through `hindsight.globalScope`. */
	globalScope: boolean;
	bankMission: string;
	retainMission: string | null;

	autoRecall: boolean;
	autoRetain: boolean;

	retainMode: "full-session" | "last-turn";
	retainEveryNTurns: number;
	retainOverlapTurns: number;
	retainContext: string;

	recallBudget: "low" | "mid" | "high";
	recallMaxTokens: number;
	recallTypes: string[];
	recallContextTurns: number;
	recallMaxQueryChars: number;
	recallPromptPreamble: string;

	debug: boolean;

	/** Default per-request client deadline (ms) for ops without a specific override. */
	requestTimeoutMs: number;
	/** Client deadline (ms) for reflect (agentic synthesis; costlier than a metadata fetch). */
	reflectTimeoutMs: number;
	/** Client deadline (ms) for recall. */
	recallTimeoutMs: number;
	/** Client deadline (ms) for retain / retainBatch. */
	retainTimeoutMs: number;

	mentalModelsEnabled: boolean;
	mentalModelAutoSeed: boolean;
	mentalModelMaxRenderChars: number;
}

const DEFAULT_PREAMBLE =
	"Relevant memories from past conversations (prioritize recent when conflicting). " +
	"Only use memories that are directly useful to continue this conversation; ignore the rest:";

/**
 * Load the resolved Hindsight config. `HINDSIGHT_*` environment variables override settings
 * through the setting definitions (`hindsight/settings.ts`); invalid values fall back to defaults.
 */
export function loadHindsightConfig(settings: Settings): HindsightConfig {
	const config: HindsightConfig = {
		hindsightApiUrl: cfgHindsightApiUrl.get(settings),
		hindsightApiToken: cfgHindsightApiToken.get(settings) ?? null,

		bankId: cfgHindsightBankId.get(settings) ?? null,
		bankIdPrefix: cfgHindsightBankIdPrefix.get(settings) ?? "",
		scoping: cfgHindsightScoping.get(settings),
		globalScope: cfgHindsightGlobalScope.get(settings),
		bankMission: cfgHindsightBankMission.get(settings) ?? "",
		retainMission: cfgHindsightRetainMission.get(settings) ?? null,

		autoRecall: cfgHindsightAutoRecall.get(settings),
		autoRetain: cfgHindsightAutoRetain.get(settings),

<<<<<<< ours — scope `* `process.env` per case.` in function `loadHindsightConfig` (S+F, confidence: low)
// refused_by: statement_fold · collision: `retainContext: settings.get("hindsight.retainContext") ?? "omp",`
		retainMode: retainModeEnv ?? settingsRetainMode ?? "full-session",
		retainEveryNTurns: retainEveryNTurnsEnv ?? settings.get("hindsight.retainEveryNTurns"),
		retainOverlapTurns: settings.get("hindsight.retainOverlapTurns"),
		retainContext: settings.get("hindsight.retainContext") ?? "tau",
=======
		retainMode: cfgHindsightRetainMode.get(settings),
		retainEveryNTurns: cfgHindsightRetainEveryNTurns.get(settings),
		retainOverlapTurns: cfgHindsightRetainOverlapTurns.get(settings),
		retainContext: cfgHindsightRetainContext.get(settings),
>>>>>>> theirs — scope `* `process.env` per case.`

		recallBudget: cfgHindsightRecallBudget.get(settings),
		recallMaxTokens: cfgHindsightRecallMaxTokens.get(settings),
		recallTypes: [...cfgHindsightRecallTypes.get(settings)],
		recallContextTurns: cfgHindsightRecallContextTurns.get(settings),
		recallMaxQueryChars: cfgHindsightRecallMaxQueryChars.get(settings),
		recallPromptPreamble: DEFAULT_PREAMBLE,

		debug: cfgHindsightDebug.get(settings),

		requestTimeoutMs: cfgHindsightRequestTimeoutMs.get(settings),
		reflectTimeoutMs: cfgHindsightReflectTimeoutMs.get(settings),
		recallTimeoutMs: cfgHindsightRecallTimeoutMs.get(settings),
		retainTimeoutMs: cfgHindsightRetainTimeoutMs.get(settings),

		mentalModelsEnabled: cfgHindsightMentalModelsEnabled.get(settings),
		mentalModelAutoSeed: cfgHindsightMentalModelAutoSeed.get(settings),
		mentalModelMaxRenderChars: cfgHindsightMentalModelMaxRenderChars.get(settings),
	};

	return config;
}

/** Whether the caller has enough config to talk to a Hindsight server. */
export function isHindsightConfigured(
	config: HindsightConfig,
): config is HindsightConfig & { hindsightApiUrl: string } {
	return typeof config.hindsightApiUrl === "string" && config.hindsightApiUrl.length > 0;
}
