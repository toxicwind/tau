import { spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
export const DEFAULT_OMP = join(homedir(), "estate-scripts", "projects", "tau", "packages", "coding-agent", "dist", "omp");
export function resolveOmpPath(explicit) {
    const candidate = explicit ?? process.env.OMP_BIN ?? DEFAULT_OMP;
    if (!existsSync(candidate)) {
        throw new Error(`probe-runner: omp binary not found at ${candidate}; set OMP_BIN or pass an explicit path`);
    }
    return candidate;
}
export const DEFAULT_PROBE_OUTPUT = join(tmpdir(), `omp-probe-${process.pid}-${Date.now()}.json`);
export const DEFAULT_PROBE_RUN_TIMEOUT_MS = 120000;
/**
 * Run `extensionPath` as a one-shot extension and read back the JSON it wrote.
 * A missing or unparseable output file is an error, not an empty result —
 * a silent empty result is how a broken probe looks like a healthy one.
 */
export function runProbe(options) {
    const extensionPath = resolve(options.extensionPath);
    if (!existsSync(extensionPath))
        throw new Error(`probe-runner: no such extension: ${extensionPath}`);
    const outputPath = resolve(options.outputPath ?? DEFAULT_PROBE_OUTPUT);
    if (existsSync(outputPath))
        unlinkSync(outputPath);
    const ompPath = resolveOmpPath(options.ompPath);
    const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_RUN_TIMEOUT_MS;
    const prompt = options.prompt ?? "probe";
    const argv = ["-p", "--no-session", "--no-extensions", "--no-skills", "--no-rules", "-e", extensionPath];
    // Omitting --model entirely is meaningful: the session then uses whatever
    // default the live config resolves, which is usually what is being probed.
    if (options.model !== undefined)
        argv.push("--model", options.model);
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
        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        child.on("close", code => {
            clearTimeout(timer);
            let json = null;
            if (existsSync(outputPath)) {
                const raw = readFileSync(outputPath, "utf8");
                try {
                    json = JSON.parse(raw);
                }
                catch (error) {
                    stderr += `\nprobe-runner: ${outputPath} is not valid JSON: ${String(error)}`;
                }
            }
            else {
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
export function formatProbeRun(run) {
    return [
        `${run.ok ? "ok" : "FAILED"}  exit: ${run.exitCode}  in ${run.durationMs}ms`,
        run.stderr.trim() ? `stderr: ${run.stderr.trim().slice(0, 2000)}` : "stderr: (empty)",
        run.json === null ? "json: NONE WRITTEN" : `json: ${JSON.stringify(run.json).slice(0, 4000)}`,
    ].join("\n");
}
