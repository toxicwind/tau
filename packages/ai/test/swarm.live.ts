/**
 * swarm.live.ts — importable swarm-builder scaffolding for the freeinference
 * 429 / shared-lease / route-verdict experiments. NOT part of `bun test` —
 * run manually:
 *
 *   bun packages/ai/test/swarm.live.ts [--swarm 8] [--rounds 3] [--models a,b,c]
 *
 * What it does:
 *   1. AUTO-DISCOVERS the providers that currently answer (live probe of the
 *      mimetite router /v1/models + one ping per candidate) — never trusts
 *      the catalog or docs.
 *   2. Builds a SWARM: N requests fired at the router at the exact same time
 *      (Promise.all), across M models from >=4 providers.
 *   3. Repeats for [--rounds] rounds to expose wall breaches statistically.
 *   4. Reports: surfaced 429s, wall breaches, mean/p95 latency, per-model
 *      verdicts, and which of the three routes (AIMD / cluster-LPM / SJF) the
 *      evidence supports.
 *
 * The builder is importable: `import { buildSwarm, discoverProviders } from
 * "./swarm.live"` — the run block is guarded by import.meta.main so other
 * tools can compose swarms without triggering the default experiment.
 */

import { getBundledModel } from "@tau/tau-catalog/models";
import { streamOpenAICompletions } from "@tau/tau-ai/providers/openai-completions";
import type { Context, FetchImpl, Model } from "@tau/tau-ai/types";

export const ROUTER_URL = process.env.MIMETITE_URL ?? "http://127.0.0.1:25193/v1";
export const ROUTER_KEY = process.env.MIMETITE_KEY ?? "no-key-required";

/** A discovered provider: name + models that answered a live ping. */
export interface DiscoveredProvider {
	provider: string;
	models: string[];
	latencyMs: number;
}

/**
 * Probe the router's /v1/models, ping each candidate with a tiny request, and
 * return only the providers/models that ANSWERED. This is the anti-doc move:
 * the catalog says 16, the docs say 2, the truth is what answers.
 */
export async function discoverProviders(
	minProviders = 4,
	maxModels = 8,
): Promise<DiscoveredProvider[]> {
	const listRes = await fetch(`${ROUTER_URL}/models`, {
		headers: { authorization: `Bearer ${ROUTER_KEY}` },
	});
	if (!listRes.ok) throw new Error(`router /models HTTP ${listRes.status}`);
	const list = (await listRes.json()) as { data?: Array<{ id: string; owned_by: string }> };
	const byProvider = new Map<string, string[]>();
	for (const m of list.data ?? []) {
		const p = m.owned_by || m.id.split("/")[0] || "alias";
		byProvider.set(p, [...(byProvider.get(p) ?? []), m.id]);
	}

	const candidates: Array<{ provider: string; model: string }> = [];
	for (const [provider, models] of byProvider) {
		for (const model of models.slice(0, maxModels)) candidates.push({ provider, model });
	}
	// Parallel ping: every candidate at once, 2.5s cap each. Circuit-broken
	// models 503 in ~0ms, so this is fast even when most lanes are dead.
	const pings = await Promise.all(
		candidates.map(async ({ provider, model }) => {
			const t0 = performance.now();
			try {
				const res = await fetch(`${ROUTER_URL}/chat/completions`, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						authorization: `Bearer ${ROUTER_KEY}`,
					},
					body: JSON.stringify({
						model,
						messages: [{ role: "user", content: "say OK" }],
						max_tokens: 8,
					}),
					signal: AbortSignal.timeout(2500),
				});
				const ms = Math.round(performance.now() - t0);
				if (!res.ok) return null;
				const d = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
				const ok = (d.choices?.[0]?.message?.content ?? "").trim().length > 0;
				return ok ? { provider, model, ms } : null;
			} catch {
				return null;
			}
		}),
	);
	const byName = new Map<string, { provider: string; models: string[]; latencyMs: number }>();
	for (const hit of pings) {
		if (!hit) continue;
		const entry = byName.get(hit.provider) ?? { provider: hit.provider, models: [], latencyMs: Number.MAX_SAFE_INTEGER };
		entry.models.push(hit.model);
		entry.latencyMs = Math.min(entry.latencyMs, hit.ms);
		byName.set(hit.provider, entry);
	}
	const discovered = [...byName.values()]
		.map((e) => ({ ...e, latencyMs: e.latencyMs === Number.MAX_SAFE_INTEGER ? 0 : e.latencyMs }))
		.sort((a, b) => a.latencyMs - b.latencyMs);

	discovered.sort((a, b) => a.latencyMs - b.latencyMs);
	return discovered.slice(0, Math.max(minProviders, discovered.length));
}

/** One swarm member: model, its provider, and the result of firing it. */
export interface SwarmResult {
	model: string;
	provider: string;
	status: number | "ERR";
	ms: number;
	ok: boolean;
	content: string;
	surfaced429: boolean;
}

export interface SwarmReport {
	round: number;
	swarmSize: number;
	wallMs: number;
	results: SwarmResult[];
	okCount: number;
	surfaced429: number;
	meanMs: number;
	p95Ms: number;
}

/** Fire [models] concurrently (Promise.all = exact-same-time) and report. */
export async function runSwarm(
	models: Array<{ model: string; provider: string }>,
	round: number,
): Promise<SwarmReport> {
	const started = performance.now();
	const results = await Promise.all(
		models.map(async ({ model, provider }) => {
			const t0 = performance.now();
			try {
				const res = await fetch(`${ROUTER_URL}/chat/completions`, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						authorization: `Bearer ${ROUTER_KEY}`,
					},
					body: JSON.stringify({
						model,
						messages: [{ role: "user", content: `Reply with exactly: ${round}` }],
						max_tokens: 64,
						temperature: 0,
					}),
					signal: AbortSignal.timeout(30_000),
				});
				const ms = Math.round(performance.now() - t0);
				if (!res.ok) {
					const body = (await res.text()).slice(0, 120);
					return {
						model,
						provider,
						status: res.status,
						ms,
						ok: false,
						content: "",
						surfaced429: res.status === 429,
					};
				}
				const d = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
				const content = (d.choices?.[0]?.message?.content ?? "").trim().slice(0, 40);
				return { model, provider, status: 200, ms, ok: content.length > 0, content, surfaced429: false };
			} catch (e) {
				return { model, provider, status: "ERR", ms: -1, ok: false, content: "", surfaced429: false };
			}
		}),
	);
	const wallMs = Math.round(performance.now() - started);
	const okResults = results.filter((r) => r.ok);
	const latencies = okResults.map((r) => r.ms).sort((a, b) => a - b);
	const meanMs = latencies.length ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length) : -1;
	const p95Ms = latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] : -1;
	return {
		round,
		swarmSize: results.length,
		wallMs,
		results,
		okCount: okResults.length,
		surfaced429: results.filter((r) => r.surfaced429).length,
		meanMs,
		p95Ms,
	};
}

/** Build a swarm from discovered providers: up to [maxModels] across >= [minProviders]. */
export function buildSwarm(discovered: DiscoveredProvider[], maxModels = 8): Array<{ model: string; provider: string }> {
	const out: Array<{ model: string; provider: string }> = [];
	for (const d of discovered) {
		for (const m of d.models) {
			out.push({ model: m, provider: d.provider });
			if (out.length >= maxModels) return out;
		}
	}
	return out;
}

/** Route verdicts from a set of swarm reports (the WTF docs' three routes). */
export function routeVerdicts(reports: SwarmReport[]): string[] {
	const total429 = reports.reduce((s, r) => s + r.surfaced429, 0);
	const totalOk = reports.reduce((s, r) => s + r.okCount, 0);
	const total = reports.reduce((s, r) => s + r.swarmSize, 0);
	const verdicts: string[] = [];
	verdicts.push(
		`Route A (AIMD window): ${total429 === 0 ? "PASS" : "FAIL"} — ${total429} surfaced 429s across ${total} requests`,
	);
	verdicts.push(
		`Route B (cluster-LPM sticky): ${totalOk === total ? "PASS" : "CHECK"} — ${totalOk}/${total} ok`,
	);
	const allMs = reports.flatMap((r) => r.results.filter((x) => x.ok).map((x) => x.ms)).sort((a, b) => a - b);
	const mean = allMs.length ? Math.round(allMs.reduce((s, v) => s + v, 0) / allMs.length) : -1;
	verdicts.push(`Route C (SJF line-jump): mean latency ${mean}ms across ${allMs.length} ok requests`);
	return verdicts;
}

// ─── Default experiment (guarded: importable without triggering) ───────────
if (import.meta.main) {
	const args = process.argv.slice(2);
	const swarmSize = Number(args.find((a) => a.startsWith("--swarm"))?.split("=")[1] ?? args[args.indexOf("--swarm") + 1] ?? 8);
	const rounds = Number(args.find((a) => a.startsWith("--rounds"))?.split("=")[1] ?? args[args.indexOf("--rounds") + 1] ?? 3);
	const forcedIdx = args.indexOf("--models");
	const forced = (forcedIdx >= 0
		? (args[forcedIdx + 1]?.split(",") ?? [])
		: (args.find((a) => a.startsWith("--models="))?.split("=")[1]?.split(",") ?? []));

	let discovered: DiscoveredProvider[];
	let swarm: Array<{ model: string; provider: string }>;
	if (forced.length > 0) {
		// Fast path: caller names the exact models (e.g. the known-healthy
		// gold/local/nvidia set). No discovery ping — just group by prefix.
		console.log(`=== swarm.live — forced models: ${forced.join(", ")} ===`);
		const byProvider = new Map<string, string[]>();
		for (const m of forced) {
			const p = m.includes("/") ? m.split("/")[0] : "alias";
			byProvider.set(p, [...(byProvider.get(p) ?? []), m]);
		}
		discovered = [...byProvider.entries()].map(([provider, models]) => ({ provider, models, latencyMs: 0 }));
		swarm = forced.map((model) => ({
			model,
			provider: model.includes("/") ? model.split("/")[0] : "alias",
		}));
	} else {
		console.log(`=== swarm.live — discovering live providers via ${ROUTER_URL} ===`);
		discovered = await discoverProviders();
		console.log(`discovered ${discovered.length} providers:`);
		for (const d of discovered) {
			console.log(`  ${d.provider} (${d.latencyMs}ms): ${d.models.join(", ")}`);
		}
		if (discovered.length < 4) {
			console.error(`\nWARN: only ${discovered.length} providers answered (wanted >=4). The wall test needs 4+ lanes.`);
		}
		swarm = buildSwarm(discovered, swarmSize);
	}
	console.log(`\n=== swarm: ${swarm.length} models fired concurrently, ${rounds} rounds ===`);
	const reports: SwarmReport[] = [];
	for (let r = 1; r <= rounds; r++) {
		const report = await runSwarm(swarm, r);
		reports.push(report);
		console.log(
			`round ${r}: ${report.okCount}/${report.swarmSize} ok, ${report.surfaced429} surfaced-429, wall ${report.wallMs}ms, mean ${report.meanMs}ms, p95 ${report.p95Ms}ms`,
		);
		for (const res of [...report.results].sort((a, b) => (a.ms ?? 99999) - (b.ms ?? 99999))) {
			console.log(
				`  ${String(res.ms).padStart(6)}ms  ${res.model.padEnd(30)} ${res.ok ? `OK "${res.content}"` : `${res.status}`}`,
			);
		}
	}

	console.log(`\n=== ROUTE VERDICTS ===`);
	for (const v of routeVerdicts(reports)) console.log(`  ${v}`);

	await Bun.write(
		"/tmp/swarm-results.json",
		JSON.stringify({ discovered, reports, verdicts: routeVerdicts(reports) }, null, 2),
	);
	console.log(`\nfull -> /tmp/swarm-results.json`);
}