/**
 * fleet-card.ts — LDP-compliant Agent Card builder & Squawk Fleet Auto-Join.
 * Provides machine-readable identity (model.lanes, species, task, role) and
 * presence heartbeats to the squawk coordination server (:25120).
 */

export interface LdpAgentCard {
	"@context"?: string[];
	id: string;
	type: string[];
	name: string;
	species: "tau" | "kappa";
	role: string;
	task: string;
	lanes: string[];
	capabilities: string[];
	protocols: string[];
	created: string;
}

export interface BuildCardOptions {
	name: string;
	species: "tau" | "kappa";
	role?: string;
	task?: string;
	lanes?: string[];
}

export function buildAgentCard(opts: BuildCardOptions): LdpAgentCard {
	return {
		"@context": ["https://www.w3.org/ns/activitystreams", "https://schema.org"],
		id: `urn:agent:${opts.name}`,
		type: ["Agent", "SoftwareAgent"],
		name: opts.name,
		species: opts.species,
		role: opts.role ?? "coding-agent",
		task: opts.task ?? "interactive-coding",
		lanes: opts.lanes ?? ["fast", "reasoning", "code"],
		capabilities: ["code_generation", "shell_execution", "tool_use", "mcp"],
		protocols: ["squawk/2.0", "a2a/1.0"],
		created: new Date().toISOString(),
	};
}

export async function joinSquawkFleet(card: LdpAgentCard): Promise<boolean> {
	try {
		const tokenFile = Bun.file(`${process.env.HOME}/.config/estate-chat-token`);
		if (!(await tokenFile.exists())) return false;
		const token = (await tokenFile.text()).trim();
		const res = await fetch("http://127.0.0.1:25120/v1/join", {
			method: "POST",
			headers: {
				"Authorization": `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				agent_id: card.name,
				name: card.name,
				surface: `${card.species}-interactive`,
				activity: `${card.species} session: ${card.task}`,
				counters: {
					species: card.species,
					lanes: card.lanes,
					card,
				},
			}),
		});
		return res.ok;
	} catch {
		return false;
	}
}

export function startPresenceHeartbeat(agentId: string, intervalMs = 30_000): () => void {
	const timer = setInterval(async () => {
		try {
			const tokenFile = Bun.file(`${process.env.HOME}/.config/estate-chat-token`);
			if (!(await tokenFile.exists())) return;
			const token = (await tokenFile.text()).trim();
			await fetch("http://127.0.0.1:25120/v1/presence", {
				method: "POST",
				headers: {
					"Authorization": `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					agent_id: agentId,
					activity: "active",
				}),
			});
		} catch {}
	}, intervalMs);

	if (typeof timer.unref === "function") {
		timer.unref();
	}

	return () => clearInterval(timer);
}
