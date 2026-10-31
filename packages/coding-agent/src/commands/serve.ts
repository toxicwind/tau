/**
 * `tau serve`: session-host daemon for one project directory.
 *
 * Runs the interactive TUI under a PTY inside a detached daemon so the TUI
 * you are looking at (`tau attach`) is disposable — killing it, even with
 * SIGKILL, never touches the session. See `serve/server.ts` and
 * `docs/detached-keeper.md`.
 */

import * as fs from "node:fs/promises";
import { APP_NAME } from "@tau/tau-utils";
import { Command, Flags } from "@tau/tau-utils/cli";
import { serveCommandHelp as commandHelp } from "../cli/command-help";
import { ServeServer } from "../serve/server";
import { servePaths } from "../serve/paths";
import { resolveExecutablePath } from "../subprocess/worker-client";

export default class Serve extends Command {
	static description = commandHelp.description;
	static flags = {
		foreground: Flags.boolean({
			description: "Run the daemon in this process (foreground; for debugging)",
			default: false,
		}),
		"serve-child": Flags.boolean({
			description: "Internal: run as the already-detached daemon process",
			default: false,
			hidden: true,
		}),
		stop: Flags.boolean({ description: "Stop the running serve daemon for this project", default: false }),
		model: Flags.string({ description: "Model override passed to the hosted TUI" }),
	};

	static examples = [`${APP_NAME} serve`, `${APP_NAME} serve --stop`, `${APP_NAME} serve --foreground`];

	async run(): Promise<void> {
		const { flags } = await this.parse(Serve);
		if (flags.stop) return stopServeDaemon();
		if (flags["serve-child"]) {
			const server = new ServeServer(process.cwd());
			await server.start();
			await new Promise<never>(() => {}); // The server exits the process itself.
			return;
		}
		if (flags.foreground) {
			const server = new ServeServer(process.cwd());
			await server.start();
			process.stderr.write(`${APP_NAME} serve (foreground) — ctrl+c to stop\n`);
			await new Promise<never>(() => {});
			return;
		}
		return daemonizeSelf(flags.model);
	}
}

/** Spawn `tau serve --serve-child` detached and wait for its runtime files to appear. */
function daemonizeSelf(model: string | undefined): void {
	const childEnv: Record<string, string> = { TAU_SERVE_CHILD: "1" };
	if (model) childEnv.TAU_SERVE_ARGS = JSON.stringify(["--model", model]);
	const proc = Bun.spawn([resolveExecutablePath(), "serve", "--serve-child"], {
		cwd: process.cwd(),
		env: { ...process.env, ...childEnv },
		stdio: ["ignore", "ignore", "ignore"],
		detached: true,
	});
	proc.unref();
	void waitForServeRuntime().then(ready => {
		if (ready) {
			process.stdout.write(`${APP_NAME} serve daemon started (pid ${proc.pid}) — attach with \`${APP_NAME} attach\`\n`);
		} else {
			process.stderr.write(`${APP_NAME} serve daemon (pid ${proc.pid}) did not become ready within 10s — check ~/.tau/logs\n`);
			process.exitCode = 1;
		}
	});
}

/** Poll for the serve token file (written after the socket is listening). */
async function waitForServeRuntime(timeoutMs = 10_000): Promise<boolean> {
	const { tokenPath } = await servePaths(process.cwd());
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			await fs.access(tokenPath);
			return true;
		} catch {
			await Bun.sleep(200);
		}
	}
	return false;
}

async function stopServeDaemon(): Promise<void> {
	const { pidPath } = await servePaths(process.cwd());
	let pid: number | undefined;
	try {
		const raw: unknown = await Bun.file(pidPath).json();
		if (typeof raw === "object" && raw !== null && "pid" in raw && typeof raw.pid === "number") pid = raw.pid;
	} catch {
		// Missing pid file reads as no daemon.
	}
	if (pid === undefined) {
		process.stderr.write(`No ${APP_NAME} serve daemon is running for this project\n`);
		process.exitCode = 1;
		return;
	}
	try {
		process.kill(pid, "SIGTERM");
	} catch {
		process.stderr.write(`Serve daemon pid ${pid} is already gone; cleaning up\n`);
		await fs.rm(pidPath, { force: true });
		return;
	}
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		try {
			process.kill(pid, 0);
			await Bun.sleep(200);
		} catch {
			process.stdout.write("Serve daemon stopped\n");
			return;
		}
	}
	process.stderr.write(`Serve daemon pid ${pid} did not exit within 10s\n`);
	process.exitCode = 1;
}
