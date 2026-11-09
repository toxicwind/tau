/**
 * Dirty Repo Guard Hook
 *
 * Prevents session changes when there are uncommitted git changes.
 * Useful to ensure work is committed before switching context.
 */
<<<<<<< ours — interstitial `file_header` (S, confidence: medium)
// refused_by: merge_ladder_exhausted · collision: `import type { HookAPI, HookContext } from "@oh-my-pi/pi-coding-…`
import type { HookAPI, HookContext } from "@tau/tau-coding-agent";
=======
import type { HookAPI, HookContext } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";
>>>>>>> theirs — interstitial `file_header` (S, confidence: medium) · weave: run 'weave explain packages/coding-agent/examples/hooks/dirty-repo-guard.ts' for per-hunk detail, 'weave check' to verify your resolution

async function checkDirtyRepo(pi: HookAPI, ctx: HookContext, action: string): Promise<{ cancel: boolean } | undefined> {
	// Check for uncommitted changes
	const { stdout, code } = await pi.exec("git", ["status", "--porcelain"]);

	if (code !== 0) {
		// Not a git repo, allow the action
		return;
	}

	const hasChanges = stdout.trim().length > 0;
	if (!hasChanges) {
		return;
	}

	if (!ctx.hasUI) {
		// In non-interactive mode, block by default
		return { cancel: true };
	}

	// Count changed files
	const changedFiles = stdout.trim().split("\n").filter(Boolean).length;

	const choice = await ctx.ui.select(`You have ${changedFiles} uncommitted file(s). ${action} anyway?`, [
		"Yes, proceed anyway",
		"No, let me commit first",
	]);

	if (choice !== "Yes, proceed anyway") {
		ctx.ui.notify("Commit your changes first", "warning");
		return { cancel: true };
	}
}

export default function (pi: HookAPI) {
	pi.on("session_before_switch", async (event, ctx) => {
		const action = event.reason === "new" ? "new session" : "switch session";
		return checkDirtyRepo(pi, ctx, action);
	});

	pi.on("session_before_branch", async (_event, ctx) => {
		return checkDirtyRepo(pi, ctx, "branch");
	});
}
