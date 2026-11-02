import { describe, expect, it } from "bun:test";
import * as vm from "node:vm";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { spawn as nodeSpawn } from "node:child_process";
import { JAVASCRIPT_PRELUDE_SOURCE } from "../../src/eval/js/shared/prelude";

/**
 * The eval prelude ships a first-class `shell()` lane because Bun's `$` shell
 * parser rejects background jobs (`&`) and process substitution — which forced
 * agents into fragile `/bin/bash -c` wrapper strings in cell code. These lock
 * the real helper as shipped: full stdout/stderr (nothing truncated), exit
 * code, kill-on-timeout, and a detached `.bg()` for long-running work.
 *
 * The prelude source runs verbatim in a throwaway VM with only the host bridge
 * stubbed, so tests exercise the shipped source, not a re-implementation.
 */
/**
 * A minimal, ambient-gate-free `Bun` for the shell() lane. The real worker's
 * `Bun.spawn` can be patched by installJsDenyGate (worker-core.ts) when another
 * test imports it in the same process, which would make this suite depend on
 * test order and the ambient TAU_DENIED_TOOLS. We surface a shim backed by
 * node:child_process whose spawn surface (exited/pid/kill/unref/stdout/stderr)
 * matches what the shipped prelude reads — so the tests exercise the prelude
 * source deterministically, regardless of how the shared Bun was patched.
 */
function makeBunShim(): Record<string, unknown> {
	const node = { spawn: nodeSpawn };
	// Wrap a node subprocess stream into the web ReadableStream the shipped
	// prelude consumes via `new Response(proc.stdout)`. Node streams are not
	// web streams; reading through `setEncoding` + data events preserves all
	// bytes and terminates cleanly on end/error.
	const toWebStream = (nodeStream: NodeJS.ReadableStream | null) => {
		if (!nodeStream) return new ReadableStream({ start(controller) { controller.close(); } });
		let ended = false;
		return new ReadableStream({
			start(controller) {
				nodeStream.setEncoding("utf8");
				nodeStream.on("data", chunk => {
					if (!ended) controller.enqueue(chunk as string);
				});
				nodeStream.on("end", () => {
					if (!ended) {
						ended = true;
						controller.close();
					}
				});
				nodeStream.on("error", error => {
					if (!ended) {
						ended = true;
						controller.error(error);
					}
				});
			},
			cancel() {
				ended = true;
				try {
					nodeStream.destroy();
				} catch (_) {}
			},
		});
	};
	return {
		spawn(argv: string[], opts: Record<string, unknown> = {}) {
			const stdio: Array<"ignore" | "pipe" | "inherit"> = [
				opts.stdin === "inherit" ? "inherit" : "ignore",
				opts.stdout === "pipe" ? "pipe" : "ignore",
				opts.stderr === "pipe" ? "pipe" : "ignore",
			];
			const child = node.spawn(argv[0], argv.slice(1), {
				cwd: String(opts.cwd || process.cwd() || ""),
				env: (opts.env as Record<string, string> | undefined) ?? process.env,
				stdio,
				detached: Boolean(opts.detached),
			});
			return {
				pid: child.pid,
				stdout: toWebStream(child.stdout ?? null),
				stderr: toWebStream(child.stderr ?? null),
				exited: new Promise<number>(resolve => {
					child.once("exit", code => resolve(code ?? 0));
					child.once("error", () => resolve(1));
				}),
				kill: (signal?: NodeJS.Signals) => {
					try {
						child.kill(signal);
						return true;
					} catch {
						return false;
					}
				},
				unref: () => {
					try {
						child.unref();
					} catch (_) {}
				},
			};
		},
		sleep: (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
	};
}

function loadPrelude(callTool: (name: string, args: unknown) => Promise<unknown>): Record<string, unknown> {
	// The prelude's shell() lane needs Bun/process/Response globals. Surface the
	// ambient-shim Bun (never the possibly-patched real one) plus the host
	// process so the shipped source runs unaffected by other tests' gate install.
	const sandbox: Record<string, unknown> = {
		__tau_call_tool__: callTool,
		Bun: makeBunShim(),
		process,
		Response,
		TextDecoder,
		console,
		setTimeout,
		clearTimeout,
		AbortController,
	};
	vm.createContext(sandbox);
	vm.runInContext(JAVASCRIPT_PRELUDE_SOURCE, sandbox);
	return sandbox;
}

type ShellResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
	timedOut: boolean;
};
type ShellHelper = (command: string | string[], opts?: Record<string, unknown>) => Promise<ShellResult>;

function tmpDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "prelude-shell-"));
}

describe("eval js shell() full-POSIX lane", () => {
	it("runs a command through bash and returns full stdout plus exit code", async () => {
		const sandbox = loadPrelude(async () => ({}));
		const shell = sandbox.shell as ShellHelper;
		const result = await shell(`printf 'line1\\nline2\\n'`);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("line1\nline2\n");
		expect(result.timedOut).toBe(false);
	});

	it("returns the non-zero exit code without throwing and captures stderr", async () => {
		const sandbox = loadPrelude(async () => ({}));
		const shell = sandbox.shell as ShellHelper;
		const result = await shell(`echo boom >&2; exit 3`);
		expect(result.exitCode).toBe(3);
		expect(result.stderr.trim()).toBe("boom");
		expect(result.stdout).toBe("");
	});

	it("supports background jobs (`&`) that Bun's $ shell rejects — the regression", async () => {
		const sandbox = loadPrelude(async () => ({}));
		const shell = sandbox.shell as ShellHelper;
		const result = await shell(`sleep 0.2 & echo started-${"$$"}`);
		// bash returns immediately after `&`; the background sleep keeps running.
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("started-");
	});

	it("supports process substitution and job control through the real shell", async () => {
		const sandbox = loadPrelude(async () => ({}));
		const shell = sandbox.shell as ShellHelper;
		const result = await shell(`diff <(printf 'a\\nb\\n') <(printf 'a\\nb\\n') && echo same`);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("same");
	});

	it("times out and kills the process, reporting timedOut and exit code 124", async () => {
		const sandbox = loadPrelude(async () => ({}));
		const shell = sandbox.shell as ShellHelper;
		const started = Date.now();
		const result = await shell(`sleep 5`, { timeoutMs: 250 });
		expect(result.timedOut).toBe(true);
		expect(result.exitCode).toBe(124);
		expect(Date.now() - started).toBeLessThan(3000);
	});

	it("honors cwd and env options", async () => {
		const sandbox = loadPrelude(async () => ({}));
		const shell = sandbox.shell as ShellHelper;
		const dir = tmpDir();
		const result = await shell(`pwd; printf '%s' "$NV_TEST"`, { cwd: dir, env: { NV_TEST: "ok" } });
		expect(result.stdout).toContain(dir);
		expect(result.stdout).toContain("ok");
	});

	it("exposes shell.bg() returning a detached handle", async () => {
		const sandbox = loadPrelude(async () => ({}));
		const shell = sandbox.shell as ShellHelper & { bg(command: string): { pid: number; exited: Promise<number> } };
		const handle = shell.bg(`sleep 0.05; printf 'bg-done'`);
		expect(typeof handle.pid).toBe("number");
		const outcome = await shell.waitForHandle(handle);
		expect(outcome.exitCode).toBe(0);
		expect(outcome.stdout).toContain("bg-done");
	});

	it("honors the shell:sh option for pure POSIX", async () => {
		const sandbox = loadPrelude(async () => ({}));
		const shell = sandbox.shell as ShellHelper;
		const result = await shell(`printf 'posix'`, { shell: "sh" });
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("posix");
	});
});