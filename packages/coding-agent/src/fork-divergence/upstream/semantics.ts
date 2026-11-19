/**
 * upstream/semantics.ts — can1357/oh-my-pi's sed-BRE + interceptor semantics,
 * ported so both sides compile in-tree (the A/B side of the fork defaults).
 */
import type { InterceptorPolicy, SedBreSemantics } from "../types";

/**
 * Upstream sed: strict BRE→ERE translation for EVERY pattern (`crate::bre` is
 * present upstream; the fork kept bre.rs and added a per-pattern fallback).
 */
export const sedBreSemantics: SedBreSemantics = {
	name: "upstream-strict-ere",
	bresToEre(pattern) {
		// Upstream: always translate BRE to ERE; when a pattern has no GNU `\|`
		// alternation the translation is identity-shaped. Returning non-null
		// signals "run the strict translation path" — the caller hands the
		// result to the native translator (which still supports backrefs).
		return pattern;
	},
};

/**
 * Upstream interceptor: HARD BLOCK always — when the suggested tool is
 * available the command refuses with the rule message; when unavailable the
 * rule is skipped entirely (no rewrite lane). This is what upstream ships
 * (`bashInterceptor.enabled` default false + block-only).
 */
export const interceptorPolicy: InterceptorPolicy = {
	name: "upstream-block",
	rewriteWhenToolUnavailable: false,
	blockWhenToolAvailable: true,
};