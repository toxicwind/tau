import { Args, Command } from "@oh-my-pi/pi-utils/cli";
import { initTheme } from "@oh-my-pi/pi-tui/theme";

export default class Pwd extends Command {
  static description = "Print the current working directory";

  static args = {}; // No arguments

  async run(): Promise<void> {
    const { args } = await this.parse(Pwd);
    await initTheme();
    process.stdout.write(process.cwd() + "\n");
  }
}