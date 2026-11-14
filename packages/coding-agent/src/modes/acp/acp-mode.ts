import * as net from "node:net";
import * as stream from "node:stream";
import { inspect } from "node:util";
import { postmortem } from "@tau/tau-utils";
import { AgentSideConnection, ndJsonStream, type Stream } from "@tau/tau-utils/acp";
import type { ExtensionUIContext } from "../../extensibility/extensions/types";
import type { AgentSession } from "../../session/agent-session";
import { AcpAgent } from "./acp-agent";

/** Session and deferred tool UI hook created for an ACP client workspace. */
export interface AcpSessionHandle {
	session: AgentSession;
	setToolUIContext: (uiContext: ExtensionUIContext, hasUI: boolean) => void;
}

/**
 * Creates sessions requested by an ACP client.
 *
 * Session-only results remain supported for embedders that do not need the
 * deferred interactive-prompt bridge.
 */
export type AcpSessionFactory = (
	cwd: string,
	options?: { interactivePrompts?: boolean },
) => Promise<AgentSession | AcpSessionHandle>;

/** Creates an ACP connection and exposes its agent when process-level teardown must own it. */
export function createAcpConnection(
	transport: Stream,
	createSession: AcpSessionFactory,
	initialSession?: AgentSession,
	onAgent?: (agent: AcpAgent) => void,
): AgentSideConnection {
	return new AgentSideConnection(connection => {
		const agent = new AcpAgent(connection, createSession, initialSession);
		onAgent?.(agent);
		return agent;
	}, transport);
}

/**
 * Redirects stray stdout traffic to stderr so it can never corrupt the JSON-RPC channel.
 */
function isolateProtocolStdout(): NodeJS.WriteStream {
	// fd 1 is the JSON-RPC transport — the same invariant rpc-mode guards by
	// suppressing notifications. Extensions, dependencies, and console.log all
	// target process.stdout; a single OSC title or BEL spliced into the stream
	// desyncs frame parsing and the client times out. Capture the real stdout
	// for the transport, then detour every other writer to stderr.
	const protocolStdout = process.stdout;
	const stderrSink = new stream.Writable({
		write(chunk, _encoding, callback) {
			process.stderr.write(chunk, callback);
		},
	}) as unknown as NodeJS.WriteStream;
	Object.defineProperty(process, "stdout", { value: stderrSink, configurable: true, writable: true });
	// Node's bootstrap console bound to the original stdout object; rebind so
	// extension console.log calls are detoured away from fd 1 as well.
	(globalThis.console as unknown as { log: (...args: unknown[]) => void }).log = (...args) =>
		process.stderr.write(`${formatConsoleArgs(args)}\n`);
	return protocolStdout;
}

function formatConsoleArgs(args: unknown[]): string {
	return args
		.map(arg => {
			if (typeof arg === "string") return arg;
			if (arg instanceof Error) return arg.stack ?? `${arg.name}: ${arg.message}`;
			return inspect(arg, { depth: 2, breakLength: 120 });
		})
		.join(" ");
}

function normalizeServer(s: unknown): unknown {
	if (!s || typeof s !== "object") {
		return { type: "stdio", name: "", command: "", args: [], env: [] };
	}
	const rec = s as Record<string, unknown>;
	if (typeof rec.url === "string" && rec.url.length > 0) {
		const out: Record<string, unknown> = {
			type: typeof rec.type === "string" ? rec.type : "http",
			name: typeof rec.name === "string" ? rec.name : "",
			url: rec.url,
		};
		if (rec.headers && typeof rec.headers === "object" && !Array.isArray(rec.headers)) {
			out.headers = rec.headers;
		}
		return out;
	}
	return {
		type: typeof rec.type === "string" ? rec.type : "stdio",
		name: typeof rec.name === "string" ? rec.name : "",
		command: typeof rec.command === "string" ? rec.command : "",
		args: Array.isArray(rec.args) ? rec.args : [],
		env: Array.isArray(rec.env) ? rec.env : [],
	};
}

function normalizeMcpServers(m: unknown): unknown[] {
	if (m === undefined || m === null) return [];
	if (Array.isArray(m)) return m.map(normalizeServer);
	if (typeof m === "object") {
		return Object.entries(m as Record<string, unknown>).map(([name, cfg]) =>
			normalizeServer({ ...(typeof cfg === "object" && cfg ? cfg : {}), name }),
		);
	}
	return [];
}

function rewriteAcpFrame(msg: unknown): unknown {
	if (!msg || typeof msg !== "object") return msg;
	const rec = msg as Record<string, unknown>;
	if ((rec.method === "session/new" || rec.method === "session/load") && rec.params && typeof rec.params === "object") {
		const params = rec.params as Record<string, unknown>;
		if ("mcpServers" in params) {
			params.mcpServers = normalizeMcpServers(params.mcpServers);
		}
	}
	return msg;
}

function rewriteAcpLine(line: string): string {
	if (!line.trim()) return line;
	try {
		return JSON.stringify(rewriteAcpFrame(JSON.parse(line)));
	} catch {
		return line;
	}
}

function createNormalizedStream(input: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	let buffered = "";

	return new ReadableStream<Uint8Array>({
		async start(controller) {
			const reader = input.getReader();
			try {
				while (true) {
					const next = await reader.read();
					if (next.done) break;
					buffered += decoder.decode(next.value, { stream: true });
					let newline = buffered.indexOf("\n");
					while (newline >= 0) {
						const line = buffered.slice(0, newline);
						buffered = buffered.slice(newline + 1);
						if (line.trim().length > 0) {
							const rewritten = rewriteAcpLine(line);
							controller.enqueue(encoder.encode(`${rewritten}\n`));
						}
						newline = buffered.indexOf("\n");
					}
				}
				buffered += decoder.decode();
				const finalLine = buffered.trim();
				if (finalLine.length > 0) {
					const rewritten = rewriteAcpLine(finalLine);
					controller.enqueue(encoder.encode(`${rewritten}\n`));
				}
				controller.close();
			} catch (error) {
				controller.error(error);
			} finally {
				reader.releaseLock();
			}
		},
	});
}

export interface AcpModeOptions {
	port?: number;
	hostname?: string;
}

async function runAcpTcpServer(
	createSession: AcpSessionFactory,
	initialSession: AgentSession | undefined,
	port: number,
	hostname: string,
): Promise<void> {
	const activeAgents = new Set<AcpAgent>();
	let stopped = false;

	const server = net.createServer(socket => {
		let agent: AcpAgent | undefined;
		const output = stream.Writable.toWeb(socket);
		const rawInput = stream.Readable.toWeb(socket) as unknown as ReadableStream<Uint8Array>;
		const input = createNormalizedStream(rawInput);
		const transport = ndJsonStream(output, input);

		const connection = createAcpConnection(transport, createSession, initialSession, createdAgent => {
			agent = createdAgent;
			activeAgents.add(createdAgent);
		});

		const cleanup = async () => {
			if (agent) {
				activeAgents.delete(agent);
				try {
					await agent.dispose();
				} catch {
					// connection closed
				}
				agent = undefined;
			}
		};

		socket.on("error", () => void cleanup());
		socket.on("close", () => void cleanup());
		connection.closed.finally(() => void cleanup());
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, hostname, () => {
			process.stderr.write(`tau acp: listening on tcp://${hostname}:${port}\n`);
			resolve();
		});
	});

	const shutdown = async (signal: string) => {
		if (stopped) return;
		stopped = true;
		process.stderr.write(`tau acp: shutting down on ${signal}...\n`);
		server.close();
		await Promise.allSettled(Array.from(activeAgents).map(a => a.dispose()));
		process.exit(0);
	};

	process.on("SIGTERM", () => void shutdown("SIGTERM"));
	process.on("SIGINT", () => void shutdown("SIGINT"));

	await new Promise<void>(resolve => {
		server.on("close", () => resolve());
	});
}

/** Serves ACP over stdio or TCP until disconnect, then awaits session teardown before exit. */
export async function runAcpMode(
	createSession: AcpSessionFactory,
	initialSession?: AgentSession,
	options?: AcpModeOptions,
): Promise<void> {
	if (options?.port !== undefined && options.port > 0) {
		await runAcpTcpServer(createSession, initialSession, options.port, options.hostname ?? "127.0.0.1");
		return;
	}

	// Humans who run `tau acp` by hand see a silent process and assume it is
	// broken (stdout is the JSON-RPC transport, so nothing may be printed
	// there). When stdin is a TTY no ACP client is attached — say so on stderr
	// before the transport starts.
	if (process.stdin.isTTY) {
		process.stderr.write(
			"tau acp: ACP server speaking JSON-RPC over stdio.\n" +
				'This command is meant to be spawned by an ACP client (e.g. Zed\'s "agent_servers" config), not run directly.\n' +
				"Waiting for protocol frames on stdin; logs: ~/.tau/logs/\n",
		);
	}
	let agent: AcpAgent | undefined;
	postmortem.register("acp-session-teardown", reason => agent?.dispose(reason));
	postmortem.registerStdioDisconnectHandling();
	const input = stream.Writable.toWeb(isolateProtocolStdout());
	const output = stream.Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>;
	const transport = ndJsonStream(input, output);
	const connection = createAcpConnection(transport, createSession, initialSession, createdAgent => {
		agent = createdAgent;
	});
	await connection.closed;
	await postmortem.quit(0);
}
