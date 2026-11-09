/**
 * Auto-Commit on Exit Hook
 *
 * Automatically commits changes when the agent exits.
 * Uses the last assistant message to generate a commit message.
 */
<<<<<<< ours — interstitial `file_header` (S, confidence: medium)
// refused_by: merge_ladder_exhausted · collision: `import type { HookAPI } from "@oh-my-pi/pi-coding-agent";`
import type { HookAPI } from "@tau/tau-coding-agent";
=======
import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";
>>>>>>> theirs — interstitial `file_header` (S, confidence: medium) · weave: run 'weave explain packages/coding-agent/examples/hooks/auto-commit-on-exit.ts' for per-hunk detail, 'weave check' to verify your resolution

export default function (pi: HookAPI) {
	pi.on("session_shutdown", async (_event, ctx) => {
		// Check for uncommitted changes
		const { stdout: status, code } = await pi.exec("git", ["status", "--porcelain"]);

		if (code !== 0 || status.trim().length === 0) {
			// Not a git repo or no changes
			return;
		}

		// Find the last assistant message for commit context
		const entries = ctx.sessionManager.getEntries();
		let lastAssistantText = "";
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i];
			if (entry.type === "message" && entry.message.role === "assistant") {
				const content = entry.message.content;
				if (Array.isArray(content)) {
					lastAssistantText = content
						.filter((c): c is { type: "text"; text: string } => c.type === "text")
						.filter((c): c is { type: "text"; text: string } => c.type === "text")
						.map(c => c.text)
						.join("\n");
				}
				break;
			}
		}

		// Generate a simple commit message
		const firstLine = lastAssistantText.split("\n")[0] || "Work in progress";
		const commitMessage = `[tau] ${firstLine.slice(0, 50)}${firstLine.length > 50 ? "..." : ""}`;

		// Stage and commit
		await pi.exec("git", ["add", "-A"]);
		const { code: commitCode } = await pi.exec("git", ["commit", "-m", commitMessage]);

		if (commitCode === 0 && ctx.hasUI) {
			ctx.ui.notify(`Auto-committed: ${commitMessage}`, "info");
		}
	});
}
