/**
 * Session-side bridge between the process-global `AgentRegistry` and the
 * machine-wide world registry.
 *
 * Two responsibilities, both deliberately narrow:
 *
 * 1. **Publish.** While a session is alive, its tree is discoverable by every
 *    other tau process on the machine. Roster state is read live from the
 *    registry on each request, so there is no cache to invalidate when a
 *    subagent spawns, finishes, or parks.
 *
 * 2. **Resolve.** `agent://` and `history://` gain a foreign-process fallback:
 *    when an id is not in this process's registry and not in any artifact dir,
 *    ask the world registry for peers with that id and read their published
 *    `sessionFile`. That turns "agent not found" into "that is your own
 *    artifact dir, readable over there", which is the whole point.
 *
 * Why publishing is opt-in per process rather than automatic: publication
 * writes to disk and opens a socket. A pure library embed (SDK, tests, an eval
 * harness) has no business appearing in the operator's agent roster, so
 * {@link startWorldRegistryBridge} is called from the CLI/host paths, not from
 * `createAgentSession`.
 */

import * as crypto from "node:crypto";
import { logger } from "@tau/tau-utils";
import type { AgentRef } from "./agent-registry";
import { AgentRegistry } from "./agent-registry";
import {
	type WorldAgent,
	type WorldProcessSnapshot,
	type WorldPublication,
	listAgentTrees,
	publishAgentTree,
} from "./world-registry-daemon";

/** Options for {@link startWorldRegistryBridge}. */
export interface WorldRegistryBridgeOptions {
	/**
	 * Override the discovery directory (tests). Defaults to the profile-
	 * independent `~/.tau/run/world-agents`.
	 */
	dir?: string;
	/** False to publish without the ability to revive parked peers. Defaults to true. */
	revive?: boolean;
}

/** Handle returned by {@link startWorldRegistryBridge}; closing withdraws the tree. */
export interface WorldRegistryBridge {
	readonly instanceId: string;
	readonly endpoint: string;
	close(): Promise<void>;
}

/**
 * Flatten this process's registry into publishable rows.
 *
 * Advisors are included: they are observability transcripts the Agent Hub
 * already shows, and hiding them from a peer process would make the Hub's view
 * depend on which window you happen to be looking from. They are not peers —
 * `revive` is false for them so nothing downstream treats one as messageable.
 */
function toWorldAgents(registry: AgentRegistry, revive: boolean): WorldAgent[] {
	return registry.list().map(ref => {
		const agent: WorldAgent = {
			id: ref.id,
			displayName: ref.displayName,
			kind: ref.kind,
			status: ref.status,
			sessionFile: ref.sessionFile,
			createdAt: ref.createdAt,
			lastActivity: ref.lastActivity,
			// Only a main-kind ref owned by a live session can be revived in-process.
			revivable: revive && ref.kind !== "advisor" && ref.session !== null,
		};
		if (ref.parentId !== undefined) agent.parentId = ref.parentId;
		if (ref.activity !== undefined) agent.activity = ref.activity;
		const model = ref.history?.resolvedModel;
		if (typeof model === "string") agent.model = model;
		if (ref.lifecycle?.acceptedAt !== undefined) agent.accepted = true;
		return agent;
	});
}

/**
 * Find this process's root agent row: the `Main` ref when present, else the
 * first live session in the registry. Used to label the published tree so a
 * lister can tell two top-level windows apart.
 */
function rootAgentIdOf(registry: AgentRegistry): string {
	const refs = registry.list();
	const main = refs.find(ref => ref.id === "Main") ?? refs.find(ref => ref.kind === "main");
	return main?.id ?? "Main";
}

function sessionIdOf(registry: AgentRegistry): string | null {
	for (const ref of registry.list()) {
		if (ref.kind !== "main") continue;
		const id = ref.session?.sessionManager?.getSessionId?.();
		if (typeof id === "string") return id;
	}
	return null;
}

/**
 * Start publishing `registry` to the machine-wide registry.
 *
 * Reuses the caller's registry instance so an embedder with a non-global
 * registry publishes its own tree rather than an empty global one. Failure to
 * publish is logged and degrades to in-process behaviour: a read-only
 * filesystem or a taken endpoint must never stop a session from starting.
 */
export async function startWorldRegistryBridge(
	registry: AgentRegistry = AgentRegistry.global(),
	options?: WorldRegistryBridgeOptions,
): Promise<WorldRegistryBridge> {
	const revive = options?.revive ?? true;
	// A fixed id for the process lifetime: the snapshot closure needs it before
	// publication returns, and minting it after the fact would ship an
	// "pending" instanceId to any peer that queried the socket in between.
	const instanceId = crypto.randomBytes(8).toString("hex");
	const publication: WorldPublication = await publishAgentTree(
		{
			snapshot(): WorldProcessSnapshot {
				return {
					instanceId,
					pid: process.pid,
					rootAgentId: rootAgentIdOf(registry),
					sessionId: sessionIdOf(registry),
					cwd: process.cwd(),
					startedAt: Date.now(),
					agents: toWorldAgents(registry, revive),
				};
			},
		},
		{ instanceId, revive, ...(options?.dir === undefined ? {} : { dir: options.dir }) },
	);
	logger.debug("world registry bridge published", { endpoint: publication.endpoint });
	return {
		instanceId,
		endpoint: publication.endpoint,
		close: () => publication.close(),
	};
}

/** A peer agent discovered in another process, with enough context to disambiguate. */
export interface ForeignAgent {
	agent: WorldAgent;
	/** The publishing process's tree. */
	tree: WorldProcessSnapshot;
}

/**
 * Every published agent with `id` outside this process.
 *
 * Returns all matches rather than the first. `Main` is the default id for every
 * top-level tau session, so a "first hit wins" resolver would routinely hand
 * one window another window's session artifacts — precisely the confusion this
 * registry exists to make visible rather than hide. Callers surface the
 * ambiguity (cwd, pid, session id) and let the operator or the model choose.
 */
export async function findForeignAgents(
	id: string,
	options?: { dir?: string; excludeInstanceId?: string },
): Promise<ForeignAgent[]> {
	let trees;
	try {
		({ trees } = await listAgentTrees(options?.dir === undefined ? undefined : { dir: options.dir }));
	} catch (error) {
		// Discovery is best-effort: a broken registry directory must not turn a
		// local artifact lookup into an error.
		logger.debug("world agent discovery failed", {
			error: error instanceof Error ? error.message : String(error),
		});
		return [];
	}
	const matches: ForeignAgent[] = [];
	for (const tree of trees) {
		if (options?.excludeInstanceId && tree.instanceId === options.excludeInstanceId) continue;
		for (const agent of tree.agents) {
			if (agent.id === id) matches.push({ agent, tree });
		}
	}
	return matches;
}

/**
 * Artifact directories contributed by foreign peers carrying `id`.
 *
 * A foreign ref's artifacts live beside its own transcript, so
 * `sessionFile.slice(0, -6)` is exactly the dir `agent://` already knows how to
 * scan. Peers with no transcript (never written, or unreadable) contribute
 * nothing rather than a guessable path.
 */
export function foreignArtifactDirs(matches: ForeignAgent[]): string[] {
	const dirs: string[] = [];
	for (const { agent } of matches) {
		if (!agent.sessionFile?.endsWith(".jsonl")) continue;
		const dir = agent.sessionFile.slice(0, -".jsonl".length);
		if (!dirs.includes(dir)) dirs.push(dir);
	}
	return dirs;
}

/**
 * Human-facing disambiguation for a foreign-agent resolution failure, so the
 * model learns what exists rather than only that the id was not found.
 */
export function describeForeignAgents(matches: ForeignAgent[]): string {
	if (matches.length === 0) return "";
	if (matches.length === 1) {
		const { agent, tree } = matches[0];
		const status = agent.status === "running" ? "running" : agent.status;
		return `${agent.displayName} (pid ${tree.pid}, ${tree.cwd}, ${status})`;
	}
	return matches
		.map(({ agent, tree }) => `${agent.displayName} (pid ${tree.pid}, ${tree.cwd}, ${agent.status})`)
		.join("; ");
}

/** Re-export for callers that only need the ref shape. */
export type { AgentRef };