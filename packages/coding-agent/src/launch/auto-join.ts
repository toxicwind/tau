/**
 * auto-join.ts — Automatic interactive session registration into the Squawk Fleet.
 *
 * The interactive TUI is a UI, not a daemon: it registers PRESENCE (squawk
 * fleet card + heartbeat) and nothing more. It must never register itself as
 * a broker-supervised daemon — the 2026-10-31 incident: every interactive
 * session minted a `restart: "always"` PTY daemon spec whose
 * `application: process.execPath` is the compiled binary's in-memory bunfs
 * path (`/$bunfs/root/tau`), so the broker kept respawning full TUI copies
 * whose mangled argv turned the leaked self-path into a user prompt — ghost
 * sessions running unintended agentic turns (~90 procs/min fork storm on
 * 2026-10-30, ghost build turns on 2026-10-31).
 *
 * A session that must outlive its TUI is served by the detached keeper
 * (`modes/interactive-mode.ts` `#detachAndKeep`): the same process continues
 * headless until the session drains. Daemonization belongs to session hosts
 * (`tau acp`), not to UI copies.
 */

import { buildAgentCard, joinSquawkFleet, startPresenceHeartbeat } from "./fleet-card";

export interface AutoJoinOptions {
	name?: string;
	species?: "tau" | "kappa";
	task?: string;
	role?: string;
	lanes?: string[];
}

export interface RegisteredSession {
	name: string;
	stopHeartbeat: () => void;
}

export async function registerInteractiveTauSession(options: AutoJoinOptions = {}): Promise<RegisteredSession | null> {
	const name = options.name ?? `tau-${process.pid}`;
	const species = options.species ?? "tau";
	const task = options.task ?? "interactive-coding";

	// Emit POST /v1/join with LDP Agent Card to Squawk Fleet
	const card = buildAgentCard({
		name,
		species,
		task,
		role: options.role ?? "olympus-coding-agent",
		lanes: options.lanes ?? ["fast", "reasoning", "code"],
	});

	await joinSquawkFleet(card).catch(() => {});

	// Continuous presence heartbeat to squawk daemon (:25120)
	const stopHeartbeat = startPresenceHeartbeat(name, 30_000);

	return {
		name,
		stopHeartbeat,
	};
}
