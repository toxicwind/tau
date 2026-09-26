import { z } from "zod";

/**
 * Run Sovereign MoE PCIe experiments (1-8) via the unified CLI.
 */
export class Sm86MoeBenchTool {
  static readonly loadMode = "essential" as const;
  /** Run a specific experiment or all experiments. */
  async execute(
    opts: {
      /** Experiment ID: 1, 2, 3, 4, 5, 6, 7, 8, or "all". */
      experiment: string;
      /** If true, output raw JSON from the experiment. */
      json?: boolean;
    }
  ): Promise<{ output: string; json?: any }> {
    const { experiment, json = false } = opts;
    // Validate experiment
    const valid = ["1", "2", "3", "4", "5", "6", "7", "8", "all"];
    if (!valid.includes(experiment)) {
      throw new Error(
        `Invalid experiment ID: ${experiment}. Must be one of ${valid.join(", ")}`
      );
    }

    // Build command to run our unified CLI
    const args = [
      "python3",
      "/home/toxic/sovereign/tools/pcie-moe/cli.py",
      experiment,
    ];
    if (json) {
      args.push("--json");
    }

    const __proc = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" });
    const stdout = __proc.stdout.toString();
    const stderr = __proc.stderr.toString();
    if (__proc.exitCode !== 0) {
      throw new Error(`sm86-moe-bench exited ${__proc.exitCode}: ${stderr}`);
    }

    if (stderr.length > 0) {
      // Log stderr but don't fail unless there's also a non-zero exit? The spawn promise rejects on non-zero.
      // We'll just include stderr in output for debugging.
      console.warn(`sm86-moe-bench stderr: ${stderr}`);
    }

    const output = stdout.toString().trim();

    let parsed: any;
    if (json) {
      try {
        parsed = JSON.parse(output);
      } catch (e) {
        // If not valid JSON, return raw
        parsed = { raw: output };
      }
      return { output, json: parsed };
    } else {
      return { output };
    }
  }
}