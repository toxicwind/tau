/**
 * fork/ — OUR semantics for each divergence contract (2026-11-02 defaults).
 *
 * These encode the current shipped behavior so switching to `forkSemantics`
 * changes nothing at runtime; the upstream implementations are the A/B side.
 */
import type {
	DivergenceContracts,
	GrepPathSemantics,
	InterceptorPolicy,
	SedBreSemantics,
} from "../types";

export const grepPathSemantics: GrepPathSemantics = {
	name: "fork-literal",
	split(raw: string, _cwd: string) {
		// Fork: `;` separates entries; a `!` prefix is a LITERAL path — the
		// fork treats "!notes.txt" as a real file whose name starts with `!`.
		// No exclusion globs are extracted: everything is an include.
		return { includes: raw.split(";").filter(Boolean), excludes: [] };
	},
};

export const sedBreSemantics: SedBreSemantics = {
	name: "fork-per-pattern-fallback",
	bresToEre(pattern) {
		// Fork: per-pattern fallback — when `\|` alternation is present, the
		// pattern is handled by the fork's local normalize_basic_alternation
		// instead of strict ERE translation. Returning null signals "run the
		// fork's per-pattern path".
		return pattern.includes("\\|") ? null : pattern;
	},
};

export const interceptorPolicy: InterceptorPolicy = {
	name: "fork-rewrite",
	// Fork: when the suggested tool is unavailable, rewrite the command to a
	// kairos wrap instead of hard-blocking (fix-don't-scold doctrine).
	rewriteWhenToolUnavailable: true,
	// When the tool IS available, still block (dedicated tools win).
	blockWhenToolAvailable: true,
};

export const forkSemantics: DivergenceContracts = {
	grepPathSemantics,
	sedBreSemantics,
	interceptorPolicy,
};

export default forkSemantics;