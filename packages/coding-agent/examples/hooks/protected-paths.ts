/**
 * Protected Paths Hook
 *
 * Blocks write and edit operations to protected paths.
 * Useful for preventing accidental modifications to sensitive files.
 */
<<<<<<< ours
import type { HookAPI } from "@tau/tau-coding-agent";
||||||| base
import type { HookAPI } from "@oh-my-pi/pi-coding-agent";
=======
import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";
>>>>>>> theirs · weave: run 'weave explain packages/coding-agent/examples/hooks/protected-paths.ts' for per-hunk detail, 'weave check' to verify your resolution

export default function (pi: HookAPI) {
	const protectedPaths = [".env", ".git/", "node_modules/"];

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "write" && event.toolName !== "edit") {
			return undefined;
		}

		const path = event.input.path as string;
		const isProtected = protectedPaths.some(p => path.includes(p));

		if (isProtected) {
			if (ctx.hasUI) {
				ctx.ui.notify(`Blocked write to protected path: ${path}`, "warning");
			}
			return { block: true, reason: `Path "${path}" is protected` };
		}

		return undefined;
	});
}
