import { spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Throwaway-extension probe runner.
 *
 * The engine's model registry, auth storage and provider headers are not
 * reachable from a plain `bun` script, but they ARE reachable from inside a
 * running session. The reliable way to inspect them is: write a `.ts` file
 * that exports a function, run it as a one-shot extension, and have it write
 * a JSON blob. This wraps that dance so it stops being hand-rolled each time.
 */

export type ProbeRun = {
	exitCode: number;
	stdout: string;
	stderr: string;
	durationMs: number;
	/** Whatever the extension parsed out of its output file; null when it wrote none. */
	json: unknown | null;
	/**
	 * True only when the process exited clean AND the extension wrote parseable
	 * JSON. A probe that ran but produced nothing is a failure, because
	 * "no result" and "result: nothing wrong" look identical downstream.
	 */
	ok: boolean;
};

export const DEFAULT_OMP = join(
	homedir(),
	"estate-scripts",
	"projects",
	"tau",
	"packages",
	"coding-agent",
	"dist",
	"omp",
);

export function resolveOmpPath(explicit?: string): string {
	const candidate = explicit ?? process.env.OMP_BIN ?? DEFAULT_OMP;
	if (!existsSync(candidate)) {
		throw new Error(`probe-runner: omp binary not found at ${candidate}; set OMP_BIN or pass an explicit path`);
	}
	return candidate;
}

export type RunProbeOptions = {
	/** The throwaway extension source. */
	extensionPath: string;
	/**
	 * Where the extension is told to write its JSON. Defaults to a path under
	 * TMPDIR, passed in as OMP_PROBE_OUTPUT so the caller never has to agree on
	 * a location with the extension it is writing.
	 */
	outputPath?: string;
	/**
	 * Model the session itself runs on. Optional: with no model the session
	 * uses the configured default, which is what you want when the point of
	 * the probe is to see what the default does.
	 */
	model?: string;
	ompPath?: string;
	cwd?: string;
	timeoutMs?: number;
	prompt?: string;
};

export const DEFAULT_PROBE_OUTPUT = join(tmpdir(), `omp-probe-${process.pid}-${Date.now()}.json`);

export const DEFAULT_PROBE_RUN_TIMEOUT_MS = 120_000;

/**
 * Run `extensionPath` as a one-shot extension and read back the JSON it wrote.
 * A missing or unparseable output file is an error, not an empty result —
 * a silent empty result is how a broken probe looks like a healthy one.
 */
export function runProbe(options: RunProbeOptions): Promise<ProbeRun> {
	const extensionPath = resolve(options.extensionPath);
	if (!existsSync(extensionPath)) throw new Error(`probe-runner: no such extension: ${extensionPath}`);
	const outputPath = resolve(options.outputPath ?? DEFAULT_PROBE_OUTPUT);
	if (existsSync(outputPath)) unlinkSync(outputPath);
	const ompPath = resolveOmpPath(options.ompPath);
	const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_RUN_TIMEOUT_MS;
	const prompt = options.prompt ?? "probe";

	const argv = ["-p", "--no-session", "--no-extensions", "--no-skills", "--no-rules", "-e", extensionPath];
	// Omitting --model entirely is meaningful: the session then uses whatever
	// default the live config resolves, which is usually what is being probed.
	if (options.model !== undefined) argv.push("--model", options.model);
	argv.push(prompt);

	return new Promise(resolvePromise => {
		const started = Date.now();
		const child = spawn(ompPath, argv, {
			cwd: options.cwd ?? process.cwd(),
			env: { ...process.env, OMP_PROBE_OUTPUT: outputPath },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => {
			stderr += `\nprobe-runner: killed after ${timeoutMs}ms`;
			child.kill("SIGKILL");
		}, timeoutMs);
		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.on("close", code => {
			clearTimeout(timer);
			let json: unknown = null;
			if (existsSync(outputPath)) {
				const raw = readFileSync(outputPath, "utf8");
				try {
					json = JSON.parse(raw);
				} catch (error) {
					stderr += `\nprobe-runner: ${outputPath} is not valid JSON: ${String(error)}`;
				}
			} else {
				stderr += `\nprobe-runner: extension wrote nothing to ${outputPath}`;
			}
			resolvePromise({
				exitCode: code ?? -1,
				stdout,
				stderr,
				durationMs: Date.now() - started,
				json,
				ok: (code ?? -1) === 0 && json !== null,
			});
		});
	});
}

export function formatProbeRun(run: ProbeRun): string {
	return [
		`${run.ok ? "ok" : "FAILED"}  exit: ${run.exitCode}  in ${run.durationMs}ms`,
		run.stderr.trim() ? `stderr: ${run.stderr.trim().slice(0, 2000)}` : "stderr: (empty)",
		run.json === null ? "json: NONE WRITTEN" : `json: ${JSON.stringify(run.json).slice(0, 4000)}`,
	].join("\n");
}
