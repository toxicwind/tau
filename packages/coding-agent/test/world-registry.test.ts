/**
 * Cross-process agent registry: the contract that matters is two real OS
 * processes seeing each other, so most cases publish from a child process and
 * assert from the parent. A single-process test would pass even if the socket
 * path, the discovery metadata, or the bearer handshake were broken, because
 * in-process readers can shortcut straight to the closure.
 */
import { afterEach, describe, expect, test } from "bun:test";
import * as net from "node:net";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { listAgentTrees, publishAgentTree, type WorldProcessSnapshot } from "../src/registry/world-registry-daemon";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tau-world-test-"));
	dirs.push(dir);
	return dir;
}

function snapshot(overrides: Partial<WorldProcessSnapshot> = {}): WorldProcessSnapshot {
	return {
		instanceId: "aaaaaaaa-bbbb",
		pid: process.pid,
		rootAgentId: "Main",
		sessionId: "session-under-test",
		cwd: "/tmp/example",
		startedAt: 1_700_000_000_000,
		agents: [],
		...overrides,
	};
}

afterEach(async () => {
	while (dirs.length > 0) {
		const dir = dirs.pop();
		if (dir) await fs.rm(dir, { recursive: true, force: true });
	}
});

describe("world agent registry", () => {
	test("a published tree is listed with its agents", async () => {
		const dir = await tempDir();
		const publication = await publishAgentTree(
			{
				snapshot: () =>
					snapshot({
						instanceId: "local-one",
						agents: [
							{
								id: "Main",
								displayName: "Main",
								kind: "main",
								status: "running",
								sessionFile: "/tmp/example/session.jsonl",
								createdAt: 1,
								lastActivity: 2,
								revivable: true,
							},
						],
					}),
			},
			{ dir, instanceId: "local-one" },
		);

		const { trees } = await listAgentTrees({ dir });
		expect(trees).toHaveLength(1);
		expect(trees[0]?.pid).toBe(process.pid);
		expect(trees[0]?.cwd).toBe("/tmp/example");
		expect(trees[0]?.agents[0]?.id).toBe("Main");
		expect(trees[0]?.agents[0]?.status).toBe("running");

		await publication.close();
	});

	test("roster is read live, so a later spawn is visible without republishing", async () => {
		const dir = await tempDir();
		let agents: WorldProcessSnapshot["agents"] = [];
		const publication = await publishAgentTree({ snapshot: () => snapshot({ agents }) }, { dir });

		expect((await listAgentTrees({ dir })).trees[0]?.agents).toHaveLength(0);

		agents = [
			{
				id: "subagent",
				displayName: "subagent",
				kind: "sub",
				status: "idle",
				sessionFile: null,
				createdAt: 1,
				lastActivity: 2,
				revivable: true,
			},
		];
		expect((await listAgentTrees({ dir })).trees[0]?.agents[0]?.id).toBe("subagent");

		await publication.close();
	});

	test("closing withdraws the entry", async () => {
		const dir = await tempDir();
		const publication = await publishAgentTree({ snapshot: () => snapshot() }, { dir });
		await publication.close();
		expect((await listAgentTrees({ dir })).trees).toHaveLength(0);
	});

	test("an unauthenticated request is refused", async () => {
		const dir = await tempDir();
		const publication = await publishAgentTree({ snapshot: () => snapshot() }, { dir });

		const response = await fetchSocket(publication.endpoint, {
			v: 1,
			token: "wrong-token",
			op: "snapshot",
		});
		expect(response.ok).toBe(false);
		expect(response.error).toBe("authentication_failed");

		await publication.close();
	});

	test("metadata for a dead pid is pruned", async () => {
		const dir = await tempDir();
		await fs.writeFile(
			path.join(dir, "dead.json"),
			JSON.stringify({
				version: 1,
				instanceId: "dead-one",
				// pid 1 exists but is not ours; use an implausible pid that is
				// guaranteed absent so the prune path is what is under test.
				pid: 0x7ffffff0,
				endpoint: path.join(dir, "dead.sock"),
				createdAt: 1,
				token: "t".repeat(64),
			}),
			"utf8",
		);
		const { trees, pruned } = await listAgentTrees({ dir });
		expect(trees).toHaveLength(0);
		expect(pruned).toBe(1);
		await expect(fs.readdir(dir)).resolves.not.toContain("dead.json");
	});

	test("a separate OS process publishes and is discovered", async () => {
		const dir = await tempDir();
		// A real child process: exercises the socket path, the discovery file,
		// and the bearer handshake end to end, which an in-process publication
		// cannot distinguish from a working implementation.
		const child = Bun.spawn(
			[
				process.execPath,
				"-e",
				`
				const { publishAgentTree } = await import(${JSON.stringify(
					path.resolve(import.meta.dir, "../src/registry/world-registry-daemon.ts"),
				)});
				const pub = await publishAgentTree(
					{
						snapshot: () => ({
							instanceId: "child-one",
							pid: process.pid,
							rootAgentId: "Main",
							sessionId: "child-session",
							cwd: "/tmp/child-workspace",
							startedAt: Date.now(),
							agents: [{
								id: "Main",
								displayName: "Main",
								kind: "main",
								status: "running",
								sessionFile: "/tmp/child-workspace/s.jsonl",
								createdAt: Date.now(),
								lastActivity: Date.now(),
								revivable: true,
							}],
						}),
					},
					{ dir: ${JSON.stringify(dir)}, instanceId: "child-one" },
				);
				// Hold the publication open until the parent has listed.
				await new Promise(r => setTimeout(r, 5000));
				await pub.close();
				`,
			],
			{ stdout: "pipe", stderr: "pipe" },
		);

		try {
			// Poll for the child's entry. This is a genuine cross-process
			// integration check with no event to await: the child binds its own
			// socket on its own schedule, so the parent's only signal is the
			// published metadata appearing. A fake clock cannot stand in for
			// another kernel process scheduling its own write.
			let trees: WorldProcessSnapshot[] = [];
			for (let attempt = 0; attempt < 40; attempt++) {
				({ trees } = await listAgentTrees({ dir }));
				if (trees.length > 0) break;
				await Bun.sleep(50);
			}

			expect(trees).toHaveLength(1);
			expect(trees[0]?.instanceId).toBe("child-one");
			expect(trees[0]?.cwd).toBe("/tmp/child-workspace");
			expect(trees[0]?.sessionId).toBe("child-session");
			expect(trees[0]?.agents[0]?.sessionFile).toBe("/tmp/child-workspace/s.jsonl");
			// The discovery must reflect the child's OWN pid, not the test's.
			expect(trees[0]?.pid).toBe(child.pid);
		} finally {
			child.kill();
		}
	});
});

/** Minimal newline-delimited client, matching the server's one-request-per-connection shape. */
function fetchSocket(
	endpoint: string,
	payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const { promise, resolve, reject } = Promise.withResolvers<Record<string, unknown>>();
	const socket = net.createConnection({ path: endpoint });
	let buffer = "";
	socket.setEncoding("utf8");
	socket.once("error", reject);
	socket.once("connect", () => socket.write(`${JSON.stringify(payload)}\n`));
	socket.on("data", chunk => {
		buffer += chunk;
		const newline = buffer.indexOf("\n");
		if (newline < 0) return;
		socket.end();
		resolve(JSON.parse(buffer.slice(0, newline)));
	});
	return promise;
}