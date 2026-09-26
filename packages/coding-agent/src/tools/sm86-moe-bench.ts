/**
 * Run Sovereign MoE PCIe experiments (1-8) via the unified CLI.
 */
export class Sm86MoeBenchTool {
	static readonly loadMode = "essential" as const;

	async execute(opts: { experiment: string; json?: boolean }): Promise<{ output: string; json?: unknown }> {
		const { experiment, json = false } = opts;
		const valid = ["1", "2", "3", "4", "5", "6", "7", "8", "all"];
		if (!valid.includes(experiment)) {
			throw new Error(`Invalid experiment ID: ${experiment}. Must be one of ${valid.join(", ")}`);
		}

		const args = ["python3", "/home/toxic/sovereign/tools/pcie-moe/cli.py", experiment];
		if (json) args.push("--json");

		const proc = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" });
		const stdout = proc.stdout.toString();
		const stderr = proc.stderr.toString();

		if (proc.exitCode !== 0) {
			throw new Error(`sm86-moe-bench exited ${proc.exitCode}: ${stderr}`);
		}

		if (stderr.length > 0) {
			console.warn(`sm86-moe-bench stderr: ${stderr}`);
		}

		const output = stdout.trim();

		if (json) {
			try {
				const parsed = JSON.parse(output);
				return { output, json: parsed };
			} catch {
				return { output, json: { raw: output } };
			}
		}

		return { output };
	}
}
