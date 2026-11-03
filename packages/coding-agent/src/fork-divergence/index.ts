/**
 * fork-divergence — the upstream-merge seam.
 *
 * Every intentional divergence from upstream can1357/oh-my-pi lives here as a
 * CONTRACT with TWO implementations:
 *   - fork/     our chosen semantics (default)
 *   - upstream/ upstream's semantics, ported so it compiles in this tree
 *
 * `git merge upstream/main` conflicts ONLY at this module boundary: upstream
 * changes land in upstream/<file>, our behavior stays in fork/<file>, and the
 * settings flag (forkDivergence.*) resolves which implementation executes.
 * The A/B story is real — both implementations are compiled and benchmarkable;
 * the flag is just the runtime selector.
 */
import type { ToolSession } from "../tools";
import { forkSemantics } from "./fork";
import { upstreamSemantics } from "./upstream";
import type { DivergenceContracts } from "./types";

export type {
	DivergenceContracts,
	GrepPathSemantics,
	InterceptorPolicy,
	SedBreSemantics,
} from "./types";
export { forkSemantics } from "./fork";
export { upstreamSemantics } from "./upstream";
export { exclusionsForRoot, isExclusionEntry, isExclusionPart, normalizeExclusion } from "./upstream/grep-path";

/** Resolve the divergence implementation the session has selected. */
export function divergenceFor(session: Pick<ToolSession, "settings">): DivergenceContracts {
	const useUpstream = (key: Parameters<typeof session.settings.get>[0]): boolean =>
		session.settings.get(key) !== true;
	return {
		grepPathSemantics: useUpstream("forkDivergence.grepExclusions")
			? upstreamSemantics.grepPathSemantics
			: forkSemantics.grepPathSemantics,
		sedBreSemantics: useUpstream("forkDivergence.sedBrePerPattern")
			? upstreamSemantics.sedBreSemantics
			: forkSemantics.sedBreSemantics,
		interceptorPolicy: useUpstream("forkDivergence.interceptorRewrite")
			? upstreamSemantics.interceptorPolicy
			: forkSemantics.interceptorPolicy,
	};
}