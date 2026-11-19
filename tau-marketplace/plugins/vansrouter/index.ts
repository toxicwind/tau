/**
 * VansRouter extension for Tau (OMP).
 *
 * Registers the local VansRouter instance (http://127.0.0.1:20128)
 * as a model provider so tau models ls shows VansRouter models.
 *
 * Install: copy to ~/.tau/extensions/vansrouter.ts
 * Verify:  tau -e ~/.tau/extensions/vansrouter.ts models ls -v
 */

import type { ExtensionAPI, ExtensionContext, ProviderConfig, ProviderModelConfig } from "tau";

const VR_BASE = process.env.VANSROUTER_URL || process.env.NINEROUTER_URL || "http://127.0.0.1:20128";
const VR_KEY_ENV = "VANSROUTER_API_KEY";
const VR_KEY_FALLBACK = process.env[VR_KEY_ENV] || process.env.NINEROUTER_KEY || "";

const SEED_MODELS: ProviderModelConfig[] = [
	{
		id: "oc/jev-1.13-free",
		name: "VansRouter Jev-1.3 Free",
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 8192,
		reasoning: false,
	},
	{
		id: "oc/mimo-v2.5-free",
		name: "VansRouter Mimo V2.5 Free",
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 8192,
		reasoning: false,
	},
	{
		id: "oc/nemotron-3.5-lightning-free",
		name: "VansRouter Nemotron 3.5 Lightning Free",
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 8192,
		reasoning: true,
	},
	{
		id: "oc/deepseek-v4-flash-free",
		name: "VansRouter DeepSeek V4 Flash Free",
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 8192,
		reasoning: false,
	},
	{
		id: "mmf/mimo-auto",
		name: "VansRouter MMF Mimo Auto",
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 8192,
		reasoning: false,
	},
];

async function fetchDynamicModels(apiKey: string | undefined): Promise<readonly ProviderModelConfig[]> {
	try {
		const resp = await fetch(`${VR_BASE}/v1/models`, {
			headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
			signal: AbortSignal.timeout(5000),
		});
		const body = (await resp.json()) as { data?: Array<{ id?: string; name?: string }> };
		return (body?.data ?? []).map((m) => ({
			id: String(m.id),
			name: String(m.name ?? m.id),
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 8192,
			reasoning: false,
		}));
	} catch {
		return SEED_MODELS;
	}
}

function registerVansRouter(pi: ExtensionAPI): void {
	// Empty-string keys fail the engine provider-definition check
	// ("apiKey" or "oauth" is required when defining models), which crashed
	// `omp models`. This router serves keyless: register a placeholder and
	// suppress the auth header unless a real key exists, so no bogus
	// credential is ever sent. Verified against engine validation in
	// tau 18.3.0 dist/cli.js (authHeader===true &&
	// apiKey!==undefined gates header emission).
	const key = process.env[VR_KEY_ENV] || VR_KEY_FALLBACK || undefined;
	const config: ProviderConfig = {
		baseUrl: `${VR_BASE}/v1`,
		apiKey: key ?? "keyless",
		api: "openai-completions",
		authHeader: key !== undefined,
		models: SEED_MODELS,
		fetchDynamicModels: () => fetchDynamicModels(key),
	};
	pi.registerProvider("vansrouter", config);
}

function notify(ctx: ExtensionContext | unknown, text: string, level: 'info' | 'warn' | 'error' = 'info') {
	try {
		const lvl = level === 'warn' ? 'warning' : level;
		if (ctx && typeof ctx === 'object') {
			const c = ctx as Record<string, unknown>;
			const ui = c.ui as Record<string, unknown> | undefined;
			if (typeof ui?.notify === 'function') {
				(ui.notify as (msg: string, t?: string) => void)(text, lvl);
				return;
			}
			if (typeof ui?.print === 'function') {
				(ui.print as (msg: string) => void)(text);
				return;
			}
			const session = c.session as Record<string, unknown> | undefined;
			if (typeof session?.postMessage === 'function') {
				(session.postMessage as (msg: { role: string; text: string }) => void)({ role: 'system', text });
				return;
			}
			if (typeof c.sendUserMessage === 'function') {
				(c.sendUserMessage as (msg: string) => void)(text);
				return;
			}
		}
		console.warn('[vansrouter]', text);
	} catch (e) {
		console.warn('[vansrouter] notify failed:', e);
	}
}

// Export the factory — tau's loader calls this with the ExtensionAPI instance.
export default function vansrouterExtension(pi: ExtensionAPI): void {
	registerVansRouter(pi);

	pi.on("session_start", async (_event, ctx) => {
		try {
			const health = await fetch(`${VR_BASE}/api/health`, { signal: AbortSignal.timeout(2000) });
			const status = health.ok ? "online" : "offline";
			notify(ctx, `[vansrouter] ${status} — ${VR_BASE}`);
		} catch {
			notify(ctx, `[vansrouter] unreachable — ${VR_BASE}`);
		}
	});
}
