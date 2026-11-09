import type { AgentToolContext, ToolCallContext } from "@tau/tau-agent-core";
import type { CustomToolContext } from "../extensibility/custom-tools/types";
import type { ExtensionUIContext } from "../extensibility/extensions/types";
import { trackUserWaits, type UserWaitTracker } from "../extensibility/extensions/user-wait";
import type { CalledToolShaper } from "../spotlight";

<<<<<<< ours — module `"@oh-my-pi/pi-agent-core"` (S+F, confidence: low)
// refused_by: rename_vs_edit_guard · collision: none (both sides edited, nowhere the same lines)
declare module "@tau/tau-agent-core" {
	interface AgentToolContext extends CustomToolContext {
		ui?: ExtensionUIContext;
		hasUI?: boolean;
		toolNames?: string[];
		toolCall?: ToolCallContext;
		/** Set after the write tool's outer gate approves an `xd://` device call
		 *  at the mounted tool's tier. The inner wrapper skips its tier-only
		 *  prompt, while explicit policies and overrides still apply. */
		xdevApproved?: boolean;
		/** Immutable snapshot of the arguments an ACP client approved. The inner
		 *  wrapper skips tier and explicit prompts only while the effective input
		 *  remains equal; deny policies and provider safety checks still apply. */
		acpApprovedArgs?: unknown;
		/** Reports the approval tier resolved after an extension rewrites an
		 *  xd:// device call, so dispatch metadata describes the input that ran. */
		xdevTierResolved?(tier: "read" | "write" | "exec"): void;
		/** Set only after an interactive prompt approves provider computer safety checks. */
		providerSafetyApproved?: boolean;
=======
declare module "@oh-my-pi/pi-agent-core" {
	interface AgentToolContext extends CustomToolContext {
		ui?: ExtensionUIContext;
		hasUI?: boolean;
		toolNames?: string[];
		toolCall?: ToolCallContext;
		/** Set after the write tool's outer gate approves an `xd://` device call:
		 *  the `tools.approval` key that gate resolved (the device name). While the
		 *  input flows through unchanged, the inner wrapper skips its tier-only
		 *  prompt and an explicit prompt policy under this same key; overrides and
		 *  policies under other keys still apply. */
		xdevPolicyKey?: string;
		/** Immutable snapshot of the arguments an ACP client approved. The inner
		 *  wrapper skips tier and explicit prompts only while the effective input
		 *  remains equal; deny policies and provider safety checks still apply. */
		acpApprovedArgs?: unknown;
		/** Reports the approval tier resolved after an extension rewrites an
		 *  xd:// device call, so dispatch metadata describes the input that ran. */
		xdevTierResolved?(tier: "read" | "write" | "exec"): void;
		/** Set only after an interactive prompt approves provider computer safety checks. */
		providerSafetyApproved?: boolean;
		/** Set by the Cursor exec bridge, whose read frames compose `:raw` only to
		 *  drop line gutters. `read` then still returns image files as images
		 *  instead of their bytes decoded as text, which Cursor rejects (#15630). */
		rawImages?: boolean;
		/** Set while the session runs the Spotlight experiment: the tool wrapper passes the final result of each of
		 *  the agent's own calls (`toolCall` lists it under the tool's name) through it. */
		spotlightShape?: CalledToolShaper;
>>>>>>> theirs — module `"@oh-my-pi/pi-agent-core"` (S+F, confidence: low) · weave: run 'weave explain packages/coding-agent/src/tools/context.ts' for per-hunk detail, 'weave check' to verify your resolution
	}
}

/** What every tool context of a session starts from: the custom-tool context and the session-wide hooks. */
export type ToolBaseContext = CustomToolContext & Pick<AgentToolContext, "spotlightShape">;

export class ToolContextStore {
	#uiContext: ExtensionUIContext | undefined;
	#hasUI = false;
	#toolNames: string[] = [];

	constructor(
		private readonly getBaseContext: () => ToolBaseContext,
		/** Runs each dialog a tool opens (`ask`, eval prelude approvals, computer control) as a wait for the user. */
		private readonly trackUserWait?: UserWaitTracker,
	) {}

	getContext(toolCall?: ToolCallContext): AgentToolContext {
		return {
			...this.getBaseContext(),
			ui: this.#uiContext,
			hasUI: this.#hasUI,
			toolNames: this.#toolNames,
			toolCall,
			// Loop-dispatched calls carry the loop's passive-context sink; direct
			// (non-loop) executors such as the Cursor bridge install their own.
			addAdditionalContext: toolCall?.addAdditionalContext,
		};
	}

	setUIContext(uiContext: ExtensionUIContext, hasUI: boolean): void {
		this.#uiContext = this.trackUserWait ? trackUserWaits(uiContext, this.trackUserWait) : uiContext;
		this.#hasUI = hasUI;
	}

	setToolNames(names: string[]): void {
		this.#toolNames = names;
	}
}
