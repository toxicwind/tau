/**
 * Status Line Hook
 *
 * Demonstrates ctx.ui.setStatus() for displaying persistent status text in the footer.
 * Shows plain-text turn progress across session and turn events.
 */
<<<<<<< ours
import type { HookAPI } from "@tau/tau-coding-agent";
||||||| base
import type { HookAPI } from "@oh-my-pi/pi-coding-agent";
=======
import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";
>>>>>>> theirs · weave: run 'weave explain packages/coding-agent/examples/hooks/status-line.ts' for per-hunk detail, 'weave check' to verify your resolution

export default function (pi: HookAPI) {
	let turnCount = 0;

	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.setStatus("status-demo", "Ready");
	});

	pi.on("turn_start", async (_event, ctx) => {
		turnCount++;
		ctx.ui.setStatus("status-demo", `● Turn ${turnCount}…`);
	});

	pi.on("turn_end", async (_event, ctx) => {
		ctx.ui.setStatus("status-demo", `✓ Turn ${turnCount} complete`);
	});

	pi.on("session_switch", async (event, ctx) => {
		if (event.reason === "new") {
			turnCount = 0;
			ctx.ui.setStatus("status-demo", "Ready");
		}
	});
}
