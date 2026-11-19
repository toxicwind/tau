/**
 * `tau attach`: client for the session-host daemon (`tau serve`).
 *
 * A thin PTY mirror: terminal bytes stream from the daemon to stdout, stdin
 * bytes stream to the daemon (when this client owns input), and resizes are
 * forwarded as PTY resizes — the hosted TUI repaints fully, which is the
 * re-attach mechanism. Killing this process (even `kill -9`) only drops the
 * client socket; the hosted session keeps running.
 *
 * Key handling: Ctrl-A is the detach prefix (tmux-style) — Ctrl-A d detaches,
 * Ctrl-A Ctrl-A passes a literal Ctrl-A, any other Ctrl-A combo passes the
 * prefix through.
 */

import * as net from "node:net";
import { APP_NAME } from "@tau/tau-utils";
import { Command, Flags } from "@tau/tau-utils/cli";
import { attachCommandHelp as commandHelp } from "../cli/command-help";
import { servePaths } from "../serve/paths";
import {
	decodeServeBytes,
	encodeServeBytes,
	encodeServeFrame,
	isServeServerFrame,
	type ServeServerFrame,
} from "../serve/protocol";

const DETACH_PREFIX = "\x01";

export default class Attach extends Command {
	static description = commandHelp.description;
	static flags = {
		model: Flags.string({ description: "Start the serve daemon with this model if none is running" }),
	};

	static examples = [`${APP_NAME} attach`, `${APP_NAME} attach --model opus`];

	async run(): Promise<void> {
		const { flags } = await this.parse(Attach);
		if (!process.stdin.isTTY || !process.stdout.isTTY) {
			process.stderr.write(`${APP_NAME} attach requires an interactive terminal\n`);
			process.exitCode = 1;
			return;
		}
		const paths = await servePaths(process.cwd());
		let token: string;
		try {
			token = (await Bun.file(paths.tokenPath).text()).trim();
		} catch {
			process.stderr.write(`No ${APP_NAME} serve daemon for this project — start one with \`${APP_NAME} serve\`\n`);
			process.exitCode = 1;
			return;
		}
		await attach(paths.endpoint, token);
	}
}

async function attach(endpoint: string, token: string): Promise<void> {
	const socket = net.connect(endpoint);
	const stdin = process.stdin;
	const stdout = process.stdout;

	let owner = false;
	let detachPending = false;
	let closed = false;

	const restore = (): void => {
		stdin.setRawMode?.(false);
		stdin.pause();
		stdout.write("\x1b[?25h");
	};

	const exitWith = (message: string | undefined, code: number): never => {
		if (closed) process.exit(code);
		closed = true;
		restore();
		if (message) process.stderr.write(`${message}\n`);
		process.exit(code);
	};

	const dimensions = (): { cols: number; rows: number } => ({ cols: stdout.columns || 120, rows: stdout.rows || 40 });

	socket.on("connect", () => {
		const { cols, rows } = dimensions();
		socket.write(encodeServeFrame({ t: "hello", token, cols, rows }));
	});

	socket.on("data", chunk => {
		for (const line of chunk.toString("utf8").split("\n")) {
			if (line.length === 0) continue;
			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch {
				continue;
			}
			if (!isServeServerFrame(parsed)) continue;
			const frame: ServeServerFrame = parsed;
			switch (frame.t) {
				case "welcome":
					owner = frame.owner;
					stdin.setRawMode?.(true);
					stdin.resume();
					stdout.write("\x1b[?25h");
					stdin.on("data", onStdin);
					return;
				case "out":
					stdout.write(decodeServeBytes(frame.b64));
					return;
				case "owner":
					owner = frame.owner;
					if (frame.reason) process.stderr.write(`\r\n[tau attach] ${frame.reason}\r\n`);
					return;
				case "notice":
					process.stderr.write(`\r\n[tau attach] ${frame.text}\r\n`);
					return;
				case "bye":
					exitWith(frame.reason, 0);
					return;
				case "pong":
					return;
			}
		}
	});

	const onStdin = (data: Buffer): void => {
		if (!owner) return;
		const text = data.toString("latin1");
		let out = "";
		for (const ch of text) {
			if (detachPending) {
				detachPending = false;
				if (ch === "d") exitWith(undefined, 0);
				if (ch === DETACH_PREFIX) {
					out += DETACH_PREFIX;
					continue;
				}
				out += DETACH_PREFIX + ch;
				continue;
			}
			if (ch === DETACH_PREFIX) {
				detachPending = true;
				continue;
			}
			out += ch;
		}
		if (out.length > 0) socket.write(encodeServeFrame({ t: "input", b64: encodeServeBytes(out) }));
	};

	const onResize = (): void => {
		if (!owner) return;
		const { cols, rows } = dimensions();
		socket.write(encodeServeFrame({ t: "resize", cols, rows }));
	};

	socket.on("error", error => exitWith(`[tau attach] daemon socket error: ${error.message}`, 1));
	socket.on("close", () => exitWith("[tau attach] daemon closed the connection", 1));
	process.on("SIGWINCH", onResize);
	process.on("SIGHUP", () => exitWith(undefined, 0));
	process.on("SIGTERM", () => exitWith(undefined, 0));
}
