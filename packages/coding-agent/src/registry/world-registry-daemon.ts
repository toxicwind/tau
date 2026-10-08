/**
 * Machine-wide agent registry daemon — the cross-process bus behind
 * `agent://`, `history://`, and the IRC peer roster.
 *
 * Why this exists
 * ---------------
 * `AgentRegistry` is process-global: one `Map` inside one OS process. Two tau
 * sessions launched from two wezterm panes are two processes, so each knows
 * only its own tree. `agent://` therefore fails with "not found" for a peer
 * that is demonstrably running three feet away in another window, and there is
 * no first-class way to discover or address a sibling session at all. The
 * existing `collab/registry.ts` proves the transport works on this host (Unix
 * domain sockets, newline-delimited JSON, per-publication bearer tokens,
 * write-then-rename discovery metadata); it just publishes *browser links*,
 * not agents.
 *
 * This daemon is the same machinery pointed at the agent tree instead of a
 * room URL. Every tau process publishes its tree; every tau process can list
 * every tree and address a peer in any of them.
 *
 * Design constraints (these are the reasons it is shaped this way)
 * -----------------------------------------------------------------
 * - **Discovery is a directory scan, not a subscription.** Every publisher
 *   writes one small owner-only JSON file; listers read the directory. There
 *   is no central broker to lose, no reconnect protocol, and no ordering
 *   guarantee to get wrong. A crashed publisher leaves at most a stale file,
 *   which the next list prunes by pid liveness.
 * - **Roster state stays in the publisher.** A listing entry carries only
 *   non-capability metadata (ids, statuses, cwd, model). The receiving
 *   process calls back over the peer's socket for anything deeper, so no
 *   session state is duplicated and no capability leaks onto disk.
 * - **Mutations stay local.** A `write agent://x` never crosses the process
 *   boundary. Cross-process delivery would need a durable queue, ordering,
 *   and exactly-once semantics — none of which IRC's fire-and-forget mailbox
 *   provides. Reading across processes is the missing feature; sending across
 *   processes is not, and pretending otherwise would be a worse failure than
 *   a clear error.
 * - **Reuse, don't reimplement.** The transport, auth, size bounds, private
 *   dir assertions, socket relocation, and metadata atomicity are lifted
 *   verbatim from `collab/registry.ts` so the two registries cannot drift.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { getBaseConfigRoot } from "@tau/tau-utils";

/**
 * Discovery metadata / IPC protocol version. Bump on any wire change; a
 * mismatched reader refuses the entry instead of misreading it. The version
 * gate is deliberately a hard equal rather than a "minor" negotiation: the
 * roster is small, and a wrong roster is worse than no roster.
 */
export const WORLD_REGISTRY_VERSION = 1;

/** Reject request lines beyond this size. A valid request is <300 bytes. */
const MAX_REQUEST_BYTES = 4 * 1024;
/**
 * Reject responses beyond this size. A roster entry is ~400 bytes; 200
 * published processes stays far inside this while remaining bounded against a
 * hostile or broken peer streaming without newlines.
 */
const MAX_RESPONSE_BYTES = 512 * 1024;
/** Longest free-form string any roster field is sent with. */
const MAX_FIELD_CHARS = 1024;
/** Per-entry connect+response deadline during listing. */
const DEFAULT_QUERY_TIMEOUT_MS = 1_500;
/** Concurrency bound for querying discovery entries. */
const LIST_CONCURRENCY = 8;

/** Where published process trees live. Profile-independent, like the collab registry. */
export function worldRegistryRuntimeDir(): string {
	return path.join(getBaseConfigRoot(), "run", "world-agents");
}

const INSTANCE_ID_PATTERN = /^[a-z0-9-]{8,64}$/;

/**
 * One agent as published by its owning process. Mirrors `AgentRef` minus the
 * live `AgentSession` handle, which cannot leave the process that owns it.
 */
export interface WorldAgent {
	/** Stable registry id (`Main`, a subagent slug, `Main/advisor`, …). */
	id: string;
	/** Human-facing label. */
	displayName: string;
	/** `main` | `sub` | `advisor`. Advisors are published for Hub parity but are never peers. */
	kind: "main" | "sub" | "advisor";
	parentId?: string;
	/** `running` | `idle` | `parked` | `aborted` | … */
	status: string;
	/** Transcript path, when the ref has one. */
	sessionFile: string | null;
	/** Short gist of current work, when the agent is running. */
	activity?: string;
	/** Resolved model id, when known. */
	model?: string;
	createdAt: number;
	lastActivity: number;
	/** Run lifecycle milestones; `acceptedAt` without `terminalAt` means accepted-but-running. */
	accepted?: boolean;
	/**
	 * Whether the publisher can revive a parked peer (revive, `task resume`).
	 * `false` for an observer that only lists.
	 */
	revivable: boolean;
}

/** One published process tree. */
export interface WorldProcessSnapshot {
	instanceId: string;
	pid: number;
	/** Root agent id of this tree (`Main` for a top-level session). */
	rootAgentId: string;
	/** Session id of the root conversation, for display and matching. */
	sessionId: string | null;
	cwd: string;
	startedAt: number;
	agents: WorldAgent[];
}

/** Handle returned by {@link publishAgentTree}; closing withdraws the tree. */
export interface WorldPublication {
	readonly endpoint: string;
	/** Republish the roster. Call after any registry change you want peers to see. */
	refresh(): void;
	close(): Promise<void>;
}

export interface WorldPublishOptions {
	/** Override the discovery directory (tests). */
	dir?: string;
	/** Stable id across refreshes. Defaults to a fresh random id. */
	instanceId?: string;
	/** Base for the short socket directory when the canonical path overflows `sun_path`. */
	socketFallbackBase?: string;
	/** Whether this process can revive parked peers it discovers. */
	revive?: boolean;
}

export interface WorldListOptions {
	dir?: string;
	/** Per-entry query deadline in milliseconds. */
	timeoutMs?: number;
	socketFallbackBase?: string;
}

/**
 * Supplies the current tree. Called on every request so the roster reflects
 * live state, and it may throw when the publisher can no longer vouch for
 * its session — the caller then reports the entry as unreachable rather than
 * serving a stale tree.
 */
export interface WorldTreeSource {
	snapshot(): WorldProcessSnapshot;
}

interface DiscoveryMetadata {
	version: number;
	instanceId: string;
	pid: number;
	endpoint: string;
	createdAt: number;
	token: string;
}

function parseDiscoveryMetadata(text: string): DiscoveryMetadata | null {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return null;
	}
	if (typeof raw !== "object" || raw === null) return null;
	const meta = raw as Record<string, unknown>;
	if (typeof meta.version !== "number") return null;
	if (typeof meta.instanceId !== "string" || !INSTANCE_ID_PATTERN.test(meta.instanceId)) return null;
	if (typeof meta.pid !== "number" || !Number.isInteger(meta.pid) || meta.pid <= 0) return null;
	if (typeof meta.endpoint !== "string" || meta.endpoint.length === 0) return null;
	if (typeof meta.createdAt !== "number") return null;
	if (typeof meta.token !== "string" || meta.token.length === 0) return null;
	return {
		version: meta.version,
		instanceId: meta.instanceId,
		pid: meta.pid,
		endpoint: meta.endpoint,
		createdAt: meta.createdAt,
		token: meta.token,
	};
}

function tokenMatches(expected: string, presented: unknown): boolean {
	if (typeof presented !== "string") return false;
	const a = Buffer.from(expected, "utf8");
	const b = Buffer.from(presented, "utf8");
	if (a.length !== b.length) return false;
	return crypto.timingSafeEqual(a, b);
}

function boundField(value: string): string {
	return value.length > MAX_FIELD_CHARS ? value.slice(0, MAX_FIELD_CHARS) : value;
}

/**
 * Parse one snapshot off the wire. Every field is checked because the peer is
 * another process on the same machine, not a trusted library call: a
 * malformed roster must degrade to "skip this entry", never to a ref that
 * looks registered but is not.
 */
function parseSnapshot(raw: unknown): WorldProcessSnapshot | null {
	if (typeof raw !== "object" || raw === null) return null;
	const snap = raw as Record<string, unknown>;
	if (typeof snap.instanceId !== "string" || !INSTANCE_ID_PATTERN.test(snap.instanceId)) return null;
	if (typeof snap.pid !== "number" || !Number.isInteger(snap.pid)) return null;
	if (typeof snap.rootAgentId !== "string" || snap.rootAgentId.length === 0) return null;
	if (snap.sessionId !== null && typeof snap.sessionId !== "string") return null;
	if (typeof snap.cwd !== "string") return null;
	if (typeof snap.startedAt !== "number") return null;
	if (!Array.isArray(snap.agents)) return null;
	const agents: WorldAgent[] = [];
	for (const entry of snap.agents) {
		const agent = parseAgent(entry);
		if (!agent) return null;
		agents.push(agent);
	}
	return {
		instanceId: snap.instanceId,
		pid: snap.pid,
		rootAgentId: snap.rootAgentId,
		sessionId: snap.sessionId,
		cwd: snap.cwd,
		startedAt: snap.startedAt,
		agents,
	};
}

function parseAgent(raw: unknown): WorldAgent | null {
	if (typeof raw !== "object" || raw === null) return null;
	const a = raw as Record<string, unknown>;
	if (typeof a.id !== "string" || a.id.length === 0) return null;
	if (typeof a.displayName !== "string") return null;
	if (a.kind !== "main" && a.kind !== "sub" && a.kind !== "advisor") return null;
	if (typeof a.status !== "string") return null;
	if (a.sessionFile !== null && typeof a.sessionFile !== "string") return null;
	if (typeof a.createdAt !== "number") return null;
	if (typeof a.lastActivity !== "number") return null;
	const agent: WorldAgent = {
		id: a.id,
		displayName: a.displayName,
		kind: a.kind,
		status: a.status,
		sessionFile: a.sessionFile,
		createdAt: a.createdAt,
		lastActivity: a.lastActivity,
		revivable: a.revivable === true,
	};
	if (typeof a.parentId === "string") agent.parentId = a.parentId;
	if (typeof a.activity === "string") agent.activity = a.activity;
	if (typeof a.model === "string") agent.model = a.model;
	if (typeof a.accepted === "boolean") agent.accepted = a.accepted;
	return agent;
}

/** The snapshot as sent on the wire: every free-form string bounded. */
function boundSnapshot(snapshot: WorldProcessSnapshot): WorldProcessSnapshot {
	return {
		...snapshot,
		cwd: boundField(snapshot.cwd),
		agents: snapshot.agents.map(agent => ({
			...agent,
			displayName: boundField(agent.displayName),
			sessionFile: agent.sessionFile === null ? null : boundField(agent.sessionFile),
			...(agent.activity === undefined ? {} : { activity: boundField(agent.activity) }),
			...(agent.model === undefined ? {} : { model: boundField(agent.model) }),
		})),
	};
}

/** One request per connection: authenticate, dispatch, respond, close. */
function handleConnection(socket: net.Socket, token: string, source: WorldTreeSource): void {
	let buffer = "";
	let handled = false;
	const respond = (payload: object): void => {
		handled = true;
		socket.end(`${JSON.stringify(payload)}\n`);
	};
	const fail = (error: string): void => respond({ ok: false, v: WORLD_REGISTRY_VERSION, error });
	socket.setEncoding("utf8");
	socket.on("error", () => socket.destroy());
	socket.on("data", chunk => {
		if (handled) return;
		buffer += chunk;
		if (Buffer.byteLength(buffer, "utf8") > MAX_REQUEST_BYTES) {
			socket.destroy();
			return;
		}
		const newline = buffer.indexOf("\n");
		if (newline < 0) return;
		const line = buffer.slice(0, newline).trim();
		let request: unknown;
		try {
			request = JSON.parse(line);
		} catch {
			fail("malformed_request");
			return;
		}
		if (typeof request !== "object" || request === null) {
			fail("malformed_request");
			return;
		}
		const { v, token: presented, op } = request as Record<string, unknown>;
		if (v !== WORLD_REGISTRY_VERSION) {
			fail("unsupported_protocol");
			return;
		}
		if (!tokenMatches(token, presented)) {
			fail("authentication_failed");
			return;
		}
		if (op !== "snapshot") {
			fail("invalid_operation");
			return;
		}
		let snapshot: WorldProcessSnapshot;
		try {
			snapshot = source.snapshot();
		} catch {
			// Never let source errors leak into the wire error.
			fail("snapshot_unavailable");
			return;
		}
		respond({ ok: true, v: WORLD_REGISTRY_VERSION, snapshot: boundSnapshot(snapshot) });
	});
}

/**
 * The registry must be a real directory; POSIX also verifies its owner.
 * Listing prunes malformed entries, so following a symlink into an unrelated
 * directory would turn a listing into a deletion tool.
 */
async function assertPrivateDir(dir: string): Promise<fs.Stats | null> {
	const stat = await fs.promises.lstat(dir);
	if (stat.isSymbolicLink()) throw new Error(`world registry directory is a symlink: ${dir}`);
	if (!stat.isDirectory()) throw new Error(`world registry path is not a directory: ${dir}`);
	if (process.platform === "win32") return null;
	const uid = process.getuid?.();
	if (uid !== undefined && stat.uid !== uid) {
		throw new Error(`world registry directory is not owned by the current user: ${dir}`);
	}
	return stat;
}

async function ensurePrivateDir(dir: string): Promise<void> {
	await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
	const stat = await assertPrivateDir(dir);
	if (stat && (stat.mode & 0o077) !== 0) await fs.promises.chmod(dir, 0o700);
}

/** `sun_path` capacity: 104 bytes on macOS, 108 elsewhere. */
const SUN_PATH_LIMIT = process.platform === "darwin" ? 104 : 108;
const DEFAULT_SOCKET_FALLBACK_BASE = "/tmp";

/**
 * Short owner-private socket directory for publications whose canonical path
 * would overflow `sun_path`, keyed by uid and the canonical registry directory.
 * Listers never guess the relocated path; the metadata records the endpoint.
 */
function socketFallbackDir(dir: string, base: string): string {
	const key = new Bun.CryptoHasher("sha256")
		.update(String(process.getuid?.() ?? 0))
		.update("\0")
		.update(dir)
		.digest("hex")
		.slice(0, 20);
	return path.join(base, `tau-world-${key}`);
}

async function resolveSocketEndpoint(dir: string, entryId: string, fallbackBase: string): Promise<string> {
	const canonical = path.join(dir, `${entryId}.sock`);
	if (Buffer.byteLength(canonical) < SUN_PATH_LIMIT) return canonical;
	const shortDir = socketFallbackDir(dir, fallbackBase);
	await ensurePrivateDir(shortDir);
	return path.join(shortDir, `${entryId}.sock`);
}

/**
 * Publish this process's agent tree to the machine-wide registry.
 *
 * Creates the owner-only runtime dir, starts a private IPC endpoint backed by
 * `source`, and writes discovery metadata (never session state or tokens
 * beyond the endpoint bearer). Call {@link WorldPublication.close} on every
 * teardown path; a process-exit hook removes on-disk state for a normal exit,
 * and the OS closing the endpoint covers a crash.
 */
export async function publishAgentTree(
	source: WorldTreeSource,
	options?: WorldPublishOptions,
): Promise<WorldPublication> {
	const dir = options?.dir ?? worldRegistryRuntimeDir();
	await ensurePrivateDir(dir);

	const instanceId = options?.instanceId ?? crypto.randomBytes(8).toString("hex");
	if (!INSTANCE_ID_PATTERN.test(instanceId)) throw new Error("invalid world registry instance id");
	// Unpredictable per-publication entry id names the endpoint and metadata
	// file: pid reuse cannot attach stale metadata to an unrelated process.
	const entryId = crypto.randomBytes(8).toString("hex");
	const token = crypto.randomBytes(32).toString("hex");
	const endpoint =
		process.platform === "win32"
			? `\\\\.\\pipe\\tau-world-${entryId}`
			: await resolveSocketEndpoint(dir, entryId, options?.socketFallbackBase ?? DEFAULT_SOCKET_FALLBACK_BASE);
	const metaPath = path.join(dir, `${entryId}.json`);

	const liveSockets = new Set<net.Socket>();
	const server = net.createServer(socket => {
		liveSockets.add(socket);
		socket.once("close", () => liveSockets.delete(socket));
		handleConnection(socket, token, source);
	});
	const listening = Promise.withResolvers<void>();
	server.once("error", err => listening.reject(err));
	server.listen(endpoint, () => listening.resolve());
	try {
		await listening.promise;
		if (process.platform !== "win32") await fs.promises.chmod(endpoint, 0o600);
		const meta: DiscoveryMetadata = {
			version: WORLD_REGISTRY_VERSION,
			instanceId,
			pid: process.pid,
			endpoint,
			createdAt: Date.now(),
			token,
		};
		// Write-then-rename so a concurrent list never observes a partial file
		// (it would classify the entry as malformed and prune it, leaving this
		// process published but undiscoverable). The `.tmp` suffix keeps it out
		// of the `*.json` listing filter.
		const tmpPath = `${metaPath}.tmp`;
		const handle = await fs.promises.open(tmpPath, "wx", 0o600);
		try {
			try {
				await handle.writeFile(JSON.stringify(meta), "utf8");
			} finally {
				await handle.close();
			}
			await fs.promises.rename(tmpPath, metaPath);
		} catch (err) {
			fs.rmSync(tmpPath, { force: true });
			throw err;
		}
	} catch (err) {
		server.close();
		if (process.platform !== "win32") fs.rmSync(endpoint, { force: true });
		throw err;
	}

	const removeArtifactsSync = (): void => {
		try {
			fs.rmSync(metaPath, { force: true });
			if (process.platform !== "win32") fs.rmSync(endpoint, { force: true });
		} catch {
			// Best-effort; a survivor is pruned by the next list.
		}
	};
	process.once("exit", removeArtifactsSync);

	let closed = false;
	return {
		endpoint,
		refresh(): void {
			// Snapshot is computed on request; nothing to rewrite. The roster is
			// always current at read time, so "refresh" exists only to give callers
			// a stable place to hook a future cached-roster implementation.
		},
		async close(): Promise<void> {
			if (closed) return;
			closed = true;
			process.off("exit", removeArtifactsSync);
			const done = Promise.withResolvers<void>();
			server.close(() => done.resolve());
			for (const socket of liveSockets) socket.destroy();
			removeArtifactsSync();
			await done.promise;
		},
	};
}

type QueryResult<T> = { status: "ok"; value: T } | { status: "dead" } | { status: "skip"; error?: string };

/** Query one endpoint: connect, authenticate, send one request, read one bounded line. */
function query(meta: DiscoveryMetadata, request: object, timeoutMs: number): Promise<QueryResult<unknown>> {
	const { promise, resolve } = Promise.withResolvers<QueryResult<unknown>>();
	let buffer = "";
	const socket = net.createConnection({ path: meta.endpoint });
	const finish = (result: QueryResult<unknown>): void => {
		clearTimeout(timer);
		socket.destroy();
		resolve(result);
	};
	const timer = setTimeout(() => finish({ status: "skip" }), timeoutMs);
	socket.setEncoding("utf8");
	socket.once("error", err => {
		// Endpoints die with their host process: refused or missing means the
		// publisher is gone. Any other error (EMFILE, EACCES, EAGAIN) says
		// nothing about liveness and must not prune a live publisher.
		const code = (err as NodeJS.ErrnoException).code;
		finish({ status: code === "ENOENT" || code === "ECONNREFUSED" ? "dead" : "skip" });
	});
	socket.once("connect", () => {
		socket.write(`${JSON.stringify({ v: WORLD_REGISTRY_VERSION, token: meta.token, ...request })}\n`);
	});
	socket.on("data", chunk => {
		buffer += chunk;
		if (Buffer.byteLength(buffer, "utf8") > MAX_RESPONSE_BYTES) {
			finish({ status: "skip" });
			return;
		}
		const newline = buffer.indexOf("\n");
		if (newline < 0) return;
		finish({ status: "ok", value: parseEnvelope(buffer.slice(0, newline).trim()) });
	});
	return promise;
}

function parseEnvelope(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/**
 * Whether a recorded pid is still alive. Used to prune metadata whose
 * publisher crashed without running its exit hook (SIGKILL, power loss). The
 * check is a signal-0 liveness probe, not an identity check: a pid that has
 * been recycled will read alive and simply answer no snapshot request, so it
 * degrades to "skip" rather than to a wrong roster.
 */
function processAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		// EPERM means the process exists but belongs to another user.
		return (err as NodeJS.ErrnoException).code === "EPERM";
	}
}

/**
 * Every published agent tree on this machine.
 *
 * Entries are pruned best-effort: a dead pid's metadata is removed, and a
 * refused endpoint whose pid is gone is removed too. A refused endpoint whose
 * pid is alive is kept (transient), and an over-long or malformed response
 * skips the entry without deleting its metadata — losing discovery is worse
 * than showing one stale row.
 */
export async function listAgentTrees(options?: WorldListOptions): Promise<{
	trees: WorldProcessSnapshot[];
	pruned: number;
}> {
	const dir = options?.dir ?? worldRegistryRuntimeDir();
	const timeoutMs = options?.timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
	let entries: string[];
	try {
		entries = await fs.promises.readdir(dir);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "ENOENT" || code === "ENOTDIR") return { trees: [], pruned: 0 };
		throw err;
	}

	const metas: DiscoveryMetadata[] = [];
	let pruned = 0;
	for (const name of entries) {
		if (!name.endsWith(".json")) continue;
		const metaPath = path.join(dir, name);
		let meta: DiscoveryMetadata | null;
		try {
			meta = parseDiscoveryMetadata(await fs.promises.readFile(metaPath, "utf8"));
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			// ENOENT is the tolerated race: a publisher closing right now removed
			// the file between readdir and read. Anything else is a real fault.
			if (code === "ENOENT") continue;
			continue;
		}
		if (!meta) {
			// Malformed metadata: only prune when the owning pid is gone, so a
			// partially-written file from a live publisher survives the next list.
			fs.rmSync(metaPath, { force: true });
			pruned++;
			continue;
		}
		if (meta.version !== WORLD_REGISTRY_VERSION) continue;
		if (!processAlive(meta.pid)) {
			fs.rmSync(metaPath, { force: true });
			if (process.platform !== "win32") fs.rmSync(meta.endpoint, { force: true });
			pruned++;
			continue;
		}
		metas.push(meta);
	}

	let next = 0;
	const trees: WorldProcessSnapshot[] = [];
	const workers = Array.from({ length: Math.min(LIST_CONCURRENCY, metas.length) }, async () => {
		for (;;) {
			const index = next++;
			const meta = metas[index];
			if (!meta) return;
			const result = await query(meta, { op: "snapshot" }, timeoutMs);
			if (result.status === "ok") {
				const envelope = result.value as Record<string, unknown> | null;
				if (envelope && envelope.ok === true) {
					const snapshot = parseSnapshot(envelope.snapshot);
					if (snapshot) {
						trees.push(snapshot);
						continue;
					}
				}
				// The publisher answered but could not vouch for a well-formed tree.
				continue;
			}
			if (result.status === "dead" && !processAlive(meta.pid)) {
				fs.rmSync(path.join(dir, `${meta.instanceId}.json`), { force: true });
				pruned++;
			}
		}
	});
	await Promise.all(workers);
	return { trees, pruned };
}

/**
 * Resolve one agent id across every published tree, optionally excluding the
 * caller's own instance. Returns every match rather than picking one: a shared
 * id (`Main`) is the normal case, and silently choosing a stranger's `Main` is
 * exactly the bug this feature exists to remove. Callers disambiguate by
 * instanceId or cwd.
 */
export async function findWorldAgents(
	id: string,
	options?: WorldListOptions & { excludeInstanceId?: string },
): Promise<Array<{ tree: WorldProcessSnapshot; agent: WorldAgent }>> {
	const { trees } = await listAgentTrees(options);
	const matches: Array<{ tree: WorldProcessSnapshot; agent: WorldAgent }> = [];
	for (const tree of trees) {
		if (options?.excludeInstanceId && tree.instanceId === options.excludeInstanceId) continue;
		for (const agent of tree.agents) {
			if (agent.id === id) matches.push({ tree, agent });
		}
	}
	return matches;
}