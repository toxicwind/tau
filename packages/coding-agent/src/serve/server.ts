/**
 * Session-host daemon (`tau serve`): owns one interactive TUI running under a
 * PTY and multiplexes it to `tau attach` clients.
 *
 * The daemon is the tmux-server analogue built from tau's own pieces:
 * - `PtySession` (tau-natives) hosts the real TUI in a pseudo-terminal;
 * - `TerminalQueryResponder` answers the TUI's cursor/device queries (same
 *   pattern as the daemon broker's supervised PTYs);
 * - a per-project unix socket (broker runtime dir, token-authed, 0o600)
 *   carries newline-JSON serve frames.
 *
 * Clients are disposable: killing `tau attach` (even `kill -9`) touches only
 * the client socket — the TUI and its session keep running. The next attach
 * resizes the PTY to the client's dimensions, which makes the TUI repaint
 * fully, so no screen-diff state machine is needed.
 */

import * as fs from "node:fs/promises";
import * as net from "node:net";
import { PtySession } from "@tau/tau-natives";
import { isEnoent, logger, procmgr, setProcessName } from "@tau/tau-utils";
import { TerminalQueryResponder } from "@tau/tau-utils/vterm";
import { quoteShellArg } from "../launch/broker";
import { resolveExecutablePath, workerEnvFromParent } from "../subprocess/worker-client";
import { servePaths } from "./paths";
import {
	encodeServeBytes,
	encodeServeFrame,
	isServeClientFrame,
	SERVE_MAX_LINE_LENGTH,
	type ServeClientFrame,
	type ServeServerFrame,
} from "./protocol";

const TUI_EXIT_LINGER_MS = 2_000;

interface AttachedClient {
	socket: net.Socket;
	owner: boolean;
	cols: number;
	rows: number;
}

export class ServeServer {
	readonly #projectDir: string;
	readonly #clients = new Map<net.Socket, AttachedClient>();
	#server?: net.Server;
	#token = "";
	#pty?: PtySession;
	#tuiPid?: number;
	#tuiExit?: Promise<unknown>;
	#stopped = false;

	constructor(projectDir: string) {
		this.#projectDir = projectDir;
	}

	async start(): Promise<void> {
		setProcessName("tau-serve");
		const paths = await servePaths(this.#projectDir, { create: true });

		// Single daemon per project: refuse to double-listen.
		const existing = await this.#readLivePid(paths.pidPath);
		if (existing !== undefined && existing !== process.pid) {
			throw new Error(`A serve daemon is already running for this project (pid ${existing})`);
		}

		this.#token = crypto.randomUUID().replaceAll("-", "");
		await Bun.write(paths.tokenPath, `${this.#token}\n`, { mode: 0o600 });

		this.#server = net.createServer(socket => this.#onConnection(socket));
		this.#server.maxConnections = 16;
		await new Promise<void>((resolve, reject) => {
			this.#server!.once("error", reject);
			this.#server!.listen(paths.endpoint, () => resolve());
		});
		if (process.platform !== "win32") await fs.chmod(paths.endpoint, 0o600);
		await Bun.write(paths.pidPath, JSON.stringify({ pid: process.pid }), { mode: 0o600 });

		this.#installSignalPolicy();
		this.#spawnTui();
		logger.info("serve daemon started", { endpoint: paths.endpoint, projectDir: this.#projectDir });
	}

	/** Spawn the interactive TUI under a PTY (mirrors the broker's supervised PTY launch). */
	#spawnTui(): void {
		const pty = new PtySession();
		this.#pty = pty;
		const responder = new TerminalQueryResponder();
		const executable = resolveExecutablePath();
		const args = process.env.TAU_SERVE_ARGS?.length ? JSON.parse(process.env.TAU_SERVE_ARGS) : [];
		const argv = [executable, ...args];
		const onChunk = (error: Error | null, chunk: string): void => {
			if (error) logger.warn("serve pty output error", { error: error.message });
			if (!chunk) return;
			const reply = responder.feed(chunk);
			if (reply) {
				try {
					pty.write(reply);
				} catch {
					// The PTY may exit between emitting its final output and receiving the reply.
				}
			}
			this.#broadcastOut(chunk);
		};
		const started = Promise.withResolvers<void>();
		const onStart = (error: Error | null, pid: number): void => {
			if (error) logger.warn("serve pty startup callback failed", { error: error.message });
			else if (Number.isSafeInteger(pid) && pid > 0) this.#tuiPid = pid;
			started.resolve();
		};
		let run: Promise<unknown>;
		if (process.platform === "win32") {
			run = pty.startArgv({ application: executable, args, cwd: this.#projectDir, env: this.#tuiEnv(), cols: 120, rows: 40 }, onChunk, onStart);
		} else {
			const shell = procmgr.getShellConfig().shell;
			run = pty.start(
				{ command: `exec ${argv.map(quoteShellArg).join(" ")}`, shell, cwd: this.#projectDir, env: this.#tuiEnv(), cols: 120, rows: 40 },
				onChunk,
				onStart,
			);
		}
		this.#tuiExit = run.then(
			async result => {
				await this.#onTuiExit(`tui exited (code=${result.exitCode ?? "unknown"})`);
			},
			async error => {
				await this.#onTuiExit(`tui failed to start: ${error instanceof Error ? error.message : String(error)}`);
			},
		);
	}

	#tuiEnv(): Record<string, string> {
		return workerEnvFromParent({
			TERM: "xterm-256color",
			TAU_SERVE_CHILD: "1",
		}) as Record<string, string>;
	}

	async #onTuiExit(reason: string): Promise<void> {
		logger.info("serve tui exited", { reason });
		this.#broadcast({ t: "bye", reason });
		this.#tuiPid = undefined;
		// Linger briefly so final PTY output reaches clients, then stop.
		setTimeout(() => void this.shutdown(reason), TUI_EXIT_LINGER_MS);
	}

	#onConnection(socket: net.Socket): void {
		let authenticated = false;
		let buffer = "";
		const client: AttachedClient = { socket, owner: false, cols: 80, rows: 24 };
		this.#clients.set(socket, client);

		socket.on("data", chunk => {
			buffer += chunk.toString("utf8");
			// Frames are newline-delimited; keep any partial tail in the buffer.
			let newline = buffer.indexOf("\n");
			while (newline !== -1) {
				const line = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);
				if (line.length > SERVE_MAX_LINE_LENGTH) {
					socket.destroy();
					return;
				}
				if (line.length > 0) this.#onClientFrame(client, line, () => (authenticated = true));
				newline = buffer.indexOf("\n");
			}
		});
		socket.on("error", () => this.#dropClient(client));
		socket.on("close", () => this.#dropClient(client));
	}

	#onClientFrame(client: AttachedClient, line: string, markAuthenticated: () => void): void {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			client.socket.destroy();
			return;
		}
		if (!isServeClientFrame(parsed)) {
			client.socket.destroy();
			return;
		}
		const frame: ServeClientFrame = parsed;
		if (!authenticated) {
			if (frame.t !== "hello") {
				client.socket.destroy();
				return;
			}
			if (frame.token !== this.#token) {
				this.#send(client, { t: "bye", reason: "authentication failed" });
				client.socket.destroy();
				return;
			}
			markAuthenticated();
			client.cols = frame.cols;
			client.rows = frame.rows;
			this.#stealOwnership(client);
			this.#send(client, { t: "welcome", pid: this.#tuiPid, owner: client.owner });
			if (client.owner) this.#resizeTui(client.cols, client.rows);
			return;
		}
		switch (frame.t) {
			case "hello":
				// Protocol violation after handshake.
				client.socket.destroy();
				return;
			case "input":
				if (!client.owner) {
					this.#send(client, { t: "notice", text: "read-only: another attach owns input" });
					return;
				}
				try {
					this.#pty?.write(atob(frame.b64));
				} catch {
					// PTY gone between frames; shutdown path will notify.
				}
				return;
			case "resize":
				client.cols = frame.cols;
				client.rows = frame.rows;
				if (client.owner) this.#resizeTui(frame.cols, frame.rows);
				return;
			case "ping":
				this.#send(client, { t: "pong" });
				return;
			case "stop":
				void this.shutdown("stop requested");
				return;
		}
	}

	/** Make `client` the input owner; demote the previous owner. */
	#stealOwnership(client: AttachedClient): void {
		for (const other of this.#clients.values()) {
			if (other !== client && other.owner) {
				other.owner = false;
				this.#send(other, { t: "owner", owner: false, reason: "input moved to a newer attach" });
			}
		}
		client.owner = true;
	}

	#resizeTui(cols: number, rows: number): void {
		if (cols <= 0 || rows <= 0) return;
		try {
			this.#pty?.resize(cols, rows);
		} catch (error) {
			logger.warn("serve pty resize failed", { error: String(error) });
		}
	}

	#broadcastOut(chunk: string): void {
		if (this.#clients.size === 0) return;
		const frame = encodeServeFrame({ t: "out", b64: encodeServeBytes(chunk) });
		for (const client of this.#clients.values()) {
			try {
				client.socket.write(frame);
			} catch {
				this.#dropClient(client);
			}
		}
	}

	#broadcast(frame: ServeServerFrame): void {
		for (const client of [...this.#clients.values()]) this.#send(client, frame);
	}

	#send(client: AttachedClient, frame: ServeServerFrame): void {
		try {
			client.socket.write(encodeServeFrame(frame));
		} catch {
			this.#dropClient(client);
		}
	}

	#dropClient(client: AttachedClient): void {
		if (!this.#clients.delete(client.socket)) return;
		if (client.owner) {
			// Promote the most recent remaining client to owner.
			const remaining = [...this.#clients.values()].at(-1);
			if (remaining) {
				remaining.owner = true;
				this.#send(remaining, { t: "owner", owner: true });
				this.#resizeTui(remaining.cols, remaining.rows);
			}
		}
	}

	/** The daemon survives SIGHUP/SIGTERM expectations of its CLIENT; its own signals mean "stop hosting". */
	#installSignalPolicy(): void {
		const stop = (signal: string): void => {
			void this.shutdown(signal);
		};
		process.on("SIGTERM", () => stop("SIGTERM"));
		process.on("SIGHUP", () => stop("SIGHUP"));
		process.on("SIGINT", () => stop("SIGINT"));
	}

	/** Graceful shutdown: SIGTERM the TUI (twice — detach then escape), wait, close. */
	async shutdown(reason: string): Promise<void> {
		if (this.#stopped) return;
		this.#stopped = true;
		logger.info("serve daemon shutting down", { reason });
		this.#broadcast({ t: "bye", reason });
		const pid = this.#tuiPid;
		if (pid !== undefined) {
			const terminate = (): void => {
				try {
					process.kill(pid, "SIGTERM");
				} catch {
					// Already gone.
				}
			};
			terminate();
			setTimeout(terminate, 800); // Second SIGTERM = the keeper's escape hatch.
		}
		await Promise.race([this.#tuiExit ?? Promise.resolve(), new Promise(r => setTimeout(r, 5_000))]);
		try {
			this.#pty?.kill();
		} catch {
			// PTY already reaped.
		}
		for (const client of [...this.#clients.values()]) {
			client.socket.destroy();
		}
		const paths = await servePaths(this.#projectDir);
		await Promise.allSettled([fs.rm(paths.pidPath, { force: true }), fs.rm(paths.tokenPath, { force: true })]);
		this.#server?.close();
		process.exit(0);
	}

	async #readLivePid(pidPath: string): Promise<number | undefined> {
		try {
			const raw: unknown = await Bun.file(pidPath).json();
			if (typeof raw === "object" && raw !== null && "pid" in raw && typeof raw.pid === "number") {
				const pid = raw.pid;
				try {
					process.kill(pid, 0);
					return pid;
				} catch {
					return undefined;
				}
			}
		} catch (error) {
			if (isEnoent(error)) return undefined;
		}
		return undefined;
	}
}
