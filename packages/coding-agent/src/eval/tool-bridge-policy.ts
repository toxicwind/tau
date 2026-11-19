/**
 * Eval-bridge tool policy (upstream parity, oh-my-pi 8d1dfcd5ab).
 *
 * These tools need direct toolResult events to commit their session changes;
 * a bridged call would report success without taking effect.
 *
 * Two enforcement points share this policy:
 *   1. `eval/js/tool-bridge.ts` callSessionTool — rejects bridged calls.
 *   2. `session/session-tools.ts` getToolForEvalBridge / getEvalBridgeToolNames
 *      — excludes them from the bridge-callable set advertised to eval kernels.
 */

export const EVAL_BRIDGE_EXCLUDED_TOOLS: ReadonlySet<string> = new Set(["checkpoint", "rewind"]);

export function isEvalBridgeToolCallable(tool: { name?: string }): boolean {
	const name = tool?.name;
	// Missing name = not an excluded tool = callable (upstream signature takes a
	// resolved AgentTool whose name is always set; tolerate degraded input).
	return name === undefined || !EVAL_BRIDGE_EXCLUDED_TOOLS.has(name);
}
