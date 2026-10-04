/**
 * Output-token ceilings.
 *
 * The industry's open secret: gateways and provider metadata routinely
 * advertise max_tokens ceilings the upstream does not honor. Requests built
 * from the advertised value then 400 with
 * "max_tokens (X): Input should be less than or equal to Y".
 *
 * This module is the single source of truth for known-true ceilings. The
 * *reported* value stays on the model spec untouched — original schemas are
 * preserved — and the ceiling applies at request-build time as an additional
 * `Math.min` term, so it can only ever lower the wire value, never raise it.
 */

/**
 * Model id -> true upstream output ceiling, for gateways whose reported
 * metadata is known-stale. Add entries here when a provider 400s on its own
 * advertised ceiling; the adaptive learner (`learnOutputCeilingFromError`
 * in the ai package) handles the ones we have not curated yet.
 */
export const CURATED_OUTPUT_CEILINGS: Record<string, number> = {
	"meta/muse-spark-1.2-contributor": 131_072,
	"poolside/laguna-s-2.1-free": 32_768,
};

/** Curated true ceiling for a model id, if we have one. */
export function getCuratedOutputCeiling(modelId: string): number | undefined {
	return CURATED_OUTPUT_CEILINGS[modelId];
}

/** A 400-derived ceiling correction: what we asked for vs. the true cap. */
export interface ParsedOutputCeiling {
	/** The max_tokens value the failed request carried. */
	requested: number;
	/** The upstream's true ceiling parsed from the error. */
	ceiling: number;
}

// Matches "max_tokens (65536): Input should be less than or equal to 32768"
// and common variants ("must be less than or equal to", "expected <= N").
const CEILING_400_RE =
	/max_tokens\s*\((\d+)\)[^.]*?(?:less than or equal to|must be (?:less than or )?equal to|expected\s*<=?)\s+(\d+)/i;

/**
 * Parse a true output ceiling out of a provider 400 message. Returns
 * undefined unless the message carries a ceiling strictly below what was
 * requested — anything else is not a correction worth learning.
 */
export function parseOutputCeilingFromErrorText(text: string): ParsedOutputCeiling | undefined {
	if (!text) return undefined;
	const m = CEILING_400_RE.exec(text);
	if (!m) return undefined;
	const requested = Number(m[1]);
	const ceiling = Number(m[2]);
	if (!Number.isSafeInteger(requested) || !Number.isSafeInteger(ceiling)) return undefined;
	if (ceiling <= 0 || ceiling >= requested) return undefined;
	return { requested, ceiling };
}
