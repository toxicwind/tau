/**
 * Git Checkpoint Hook
 *
 * Creates git stash checkpoints at each turn so /branch can restore code state.
 * When branching, offers to restore code to that point in history.
 */
<<<<<<< ours
import type { HookAPI } from "@tau/tau-coding-agent";
||||||| base
import type { HookAPI } from "@oh-my-pi/pi-coding-agent";
=======
import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";
>>>>>>> theirs · weave: run 'weave explain packages/coding-agent/examples/hooks/git-checkpoint.ts' for per-hunk detail, 'weave check' to verify your resolution

export default function (pi: HookAPI) {
	const checkpoints = new Map<string, string>();
	let currentEntryId: string | undefined;

	// Track the current entry ID when user messages are saved
	pi.on("tool_result", async (_event, ctx) => {
		const leaf = ctx.sessionManager.getLeafEntry();
		if (leaf) currentEntryId = leaf.id;
	});

	pi.on("turn_start", async () => {
		// Create a git stash entry before LLM makes changes
		const { stdout } = await pi.exec("git", ["stash", "create"]);
		const ref = stdout.trim();
		if (ref && currentEntryId) {
			checkpoints.set(currentEntryId, ref);
		}
	});

	pi.on("session_before_branch", async (event, ctx) => {
		const ref = checkpoints.get(event.entryId);
		if (!ref) return;

		if (!ctx.hasUI) {
			// In non-interactive mode, don't restore automatically
			return;
		}

		const choice = await ctx.ui.select("Restore code state?", [
			"Yes, restore code to that point",
			"No, keep current code",
		]);

		if (choice?.startsWith("Yes")) {
			await pi.exec("git", ["stash", "apply", ref]);
			ctx.ui.notify("Code restored to checkpoint", "info");
		}
	});

	pi.on("agent_end", async () => {
		// Clear checkpoints after agent completes
		checkpoints.clear();
	});
}
