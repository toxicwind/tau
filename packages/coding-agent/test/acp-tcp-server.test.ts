import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as net from "node:net";
import { runAcpMode } from "../src/modes/acp/acp-mode";

describe("ACP TCP Server", () => {
	const TEST_PORT = 25199;
	let serverAbortController: AbortController;
	let serverRunning = false;

	beforeAll(async () => {
		serverAbortController = new AbortController();
		// Start ACP server on TEST_PORT
		const mockSession: any = {
			sessionId: "test-session-id",
			modelRegistry: {},
			settings: { get: () => undefined },
			sessionManager: { getCwd: () => process.cwd() },
			dispose: async () => {},
			subscribeRunState: () => () => {},
		};

		const mockFactory = async () => mockSession;

		// Run in background promise
		void runAcpMode(mockFactory, undefined, { port: TEST_PORT });

		// Wait for socket to become reachable
		for (let i = 0; i < 40; i++) {
			try {
				const client = await new Promise<net.Socket>((resolve, reject) => {
					const s = net.connect(TEST_PORT, "127.0.0.1", () => resolve(s));
					s.once("error", reject);
				});
				client.destroy();
				serverRunning = true;
				break;
			} catch {
				await Bun.sleep(50);
			}
		}
		expect(serverRunning).toBe(true);
	});

	it("connects over TCP and answers initialize request", async () => {
		const socket = net.connect(TEST_PORT, "127.0.0.1");

		const responsePromise = new Promise<any>((resolve, reject) => {
			let buffer = "";
			socket.on("data", chunk => {
				buffer += chunk.toString("utf8");
				const idx = buffer.indexOf("\n");
				if (idx !== -1) {
					const line = buffer.slice(0, idx);
					try {
						resolve(JSON.parse(line));
					} catch (e) {
						reject(e);
					}
				}
			});
			socket.on("error", reject);
		});

		const req = {
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: 1 },
		};

		socket.write(JSON.stringify(req) + "\n");
		const res = await responsePromise;

		expect(res.jsonrpc).toBe("2.0");
		expect(res.id).toBe(1);
		expect(res.result).toBeDefined();
		expect(res.result.protocolVersion).toBeDefined();

		socket.destroy();
	});
});
