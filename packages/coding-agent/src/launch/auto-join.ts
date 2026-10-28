/**
 * auto-join.ts — Automatic interactive session registration into Daemon Broker and Squawk Fleet.
 */

import type { DaemonSpec } from "@tau/tau-tui/tools/daemon";
import { daemonClientForProject } from "./client";
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
	const cwd = process.cwd();

	// 1. Construct DaemonSpec per Phase 3.0.1 specification
	const spec: DaemonSpec = {
		name,
		application: process.execPath,
		args: process.argv.slice(1),
		env: { ...process.env } as Record<string, string>,
		cwd,
		pty: true,
		restart: "always",
		persist: true,
		detached: false,
	};

	// 2. Connect to daemon broker socket and emit start/adopt operation
	try {
		const client = await daemonClientForProject(cwd);
		await client.request({
			op: "start",
			spec,
			owner: name,
			replace: true,
		}).catch(() => {
			// Broker rejected or already registered; non-fatal
		});
	} catch {
		// Broker daemon socket offline; continue gracefully
	}

	// 3. Emit POST /v1/join with LDP Agent Card to Squawk Fleet
	const card = buildAgentCard({
		name,
		species,
		task,
		role: options.role ?? "olympus-coding-agent",
		lanes: options.lanes ?? ["fast", "reasoning", "code"],
	});

	await joinSquawkFleet(card).catch(() => {});

	// 4. Start continuous presence heartbeat to squawk daemon (:25120)
	const stopHeartbeat = startPresenceHeartbeat(name, 30_000);

	return {
		name,
		stopHeartbeat,
	};
}
