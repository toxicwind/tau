import { Args, Command } from "@tau/tau-utils/cli";
import { initTheme } from "@tau/tau-tui/theme";

export default class Pwd extends Command {
	static description = "Print the current working directory";

	static args = {}; // No arguments

	async run(): Promise<void> {
		const { args } = await this.parse(Pwd);
		await initTheme();
		process.stdout.write(process.cwd() + "\n");
	}
}
