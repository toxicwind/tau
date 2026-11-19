/**
 * Divergence contract types — the seam's interface.
 *
 * Each contract is a pure function (no I/O) so both implementations are
 * trivially testable and benchmarkable side by side.
 */

/** How `!`-prefixed entries in a grep/search `path` list are interpreted. */
export interface GrepPathSemantics {
	name: "fork-literal" | "upstream-exclusion";
	/**
	 * Split a raw path list ("src;!*.test.ts") into search entries +
	 * exclusions.
	 * - fork:      `!foo` is a LITERAL path (a file literally named !foo)
	 * - upstream:  `!foo` is a ripgrep-style exclusion glob
	 */
	split(raw: string, cwd: string): { includes: string[]; excludes: string[] };
}

/** How sed translates BRE patterns when GNU `\|` alternation is present. */
export interface SedBreSemantics {
	name: "fork-per-pattern-fallback" | "upstream-strict-ere";
	/** Translate a BRE pattern to ERE, or null when the fork's per-pattern fallback applies. */
	bresToEre(pattern: string): string | null;
}

/** Interceptor policy when the suggested tool is unavailable. */
export interface InterceptorPolicy {
	name: "fork-rewrite" | "upstream-block";
	/** true → rewrite the command (kairos wrap); false → hard block. */
	rewriteWhenToolUnavailable: boolean;
	/** true → hard block when the tool IS available. */
	blockWhenToolAvailable: boolean;
}

/** All divergence contracts. Extend per divergence when adding the next flag. */
export interface DivergenceContracts {
	grepPathSemantics: GrepPathSemantics;
	sedBreSemantics: SedBreSemantics;
	interceptorPolicy: InterceptorPolicy;
}