/**
 * Inspect and control cross-process LLM provider admission leases and weave state.
 */

import { Args, Command, Flags } from "@tau/tau-utils/cli";
import { runWeaveCommand, type WeaveAction, type WeaveCommandArgs } from "../cli/weave-cli";

const ACTIONS: WeaveAction[] = ["status", "init", "clean"];

export default class Weave extends Command {
	static description = "Inspect and control cross-process provider admission leases and weave state";

	static args = {
		action: Args.string({
			description: "status (default), init, or clean",
			required: false,
			options: ACTIONS,
		}),
	};

	static flags = {
		json: Flags.boolean({ char: "j", description: "Emit machine-readable JSON" }),
		verbose: Flags.boolean({ char: "v", description: "Verbose diagnostic output" }),
	};

	static examples = [
		"tau weave",
		"tau weave status",
		"tau weave status --json",
		"tau weave init",
		"tau weave clean",
	];

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Weave);
		const cmd: WeaveCommandArgs = {
			action: (args.action ?? "status") as WeaveAction,
			flags: {
				json: flags.json ?? false,
				verbose: flags.verbose ?? false,
			},
		};
		await runWeaveCommand(cmd);
	}
}
