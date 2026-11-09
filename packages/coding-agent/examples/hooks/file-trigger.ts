/**
 * File Trigger Hook
 *
 * Watches a trigger file and injects its contents into the conversation.
 * Useful for external systems to send messages to the agent.
 *
 * Usage:
 *   echo "Run the tests" > /tmp/agent-trigger.txt
 */
import * as fs from "node:fs";
<<<<<<< ours
import type { HookAPI } from "@tau/tau-coding-agent";
||||||| base
import type { HookAPI } from "@oh-my-pi/pi-coding-agent";
=======
import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";
>>>>>>> theirs · weave: run 'weave explain packages/coding-agent/examples/hooks/file-trigger.ts' for per-hunk detail, 'weave check' to verify your resolution

export default function (pi: HookAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const triggerFile = "/tmp/agent-trigger.txt";

		fs.watch(triggerFile, async () => {
			try {
				const content = (await Bun.file(triggerFile).text()).trim();
				if (content) {
					pi.sendMessage(
						{
							customType: "file-trigger",
							content: `External trigger: ${content}`,
							display: true,
						},
						{ triggerTurn: true }, // get LLM to respond
					);
					await Bun.write(triggerFile, ""); // Clear after reading
				}
			} catch {
				// File might not exist yet
			}
		});

		if (ctx.hasUI) {
			ctx.ui.notify(`Watching ${triggerFile}`, "info");
		}
	});
}
