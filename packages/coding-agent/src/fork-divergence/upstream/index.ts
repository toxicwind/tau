/**
 * upstream/ — can1357/oh-my-pi's semantics, ported so both sides compile
 * in-tree. The A/B alternative to fork/ implementations.
 */
import type { DivergenceContracts } from "../types";
import { grepPathSemantics } from "./grep-path";
import { interceptorPolicy, sedBreSemantics } from "./semantics";

export { grepPathSemantics } from "./grep-path";
export { interceptorPolicy, sedBreSemantics } from "./semantics";

export const upstreamSemantics: DivergenceContracts = {
	grepPathSemantics,
	sedBreSemantics,
	interceptorPolicy,
};

export default upstreamSemantics;