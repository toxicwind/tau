/**
 * stream-concurrency-hold-live.live.ts — REAL-LIVE concurrency hold contract
 * against the mimetite router (:25193), via tau's provider stack. Run
 * manually (NOT part of the bun suite):
 *
 *   bun packages/ai/test/stream-concurrency-hold-live.live.ts
 *
 * Fires 4 simultaneous chat completions against the router. The shared lease
 * (freeinference cap=1) must serialize them — zero surfaced 429s, all four
 * complete on the SAME model. This is the before/after proof: pre-fix, the
 * overflow requests bubbled straight to the fallback router (glm downgrade).
 *
 * The router key comes from ~/.tau/router.key (or PATCHLING_ROUTER_KEY).
 */
import { streamOpenAICompletions } from "@tau/tau-ai/providers/openai-completions";
import type { Context, Model } from "@tau/tau-ai/types";
import { getBundledModel } from "@tau/tau-catalog/models";

const ROUTER_URL = Bun.env.PATCHLING_ROUTER_URL ?? "http://127.0.0.1:25193/v1";
const MODEL = "deepseek-v4-flash"; // cheapest/fastest tool-free lane for a live ping

async function resolveKey(): Promise<string> {
	const envKey = Bun.env.PATCHLING_ROUTER_KEY ?? Bun.env.RHODOCHROSITE_KEY;
	if (envKey) return envKey;
	try {
		const f = Bun.env.PATCHLING_ROUTER_KEY_FILE ?? `${Bun.env.HOME}/.tau/router.key`;
		return (await Bun.file(f).text()).trim();
	} catch {
		return "";
	}
}

async function main() {
	const apiKey = await resolveKey();
	if (!apiKey) {
		console.error("router key required: set PATCHLING_ROUTER_KEY or ~/.tau/router.key");
		process.exit(2);
	}

	const bundled = getBundledModel<"openai-completions">("deepseek", MODEL);
	const model: Model<"openai-completions"> = { ...bundled, baseUrl: ROUTER_URL, requestModelId: MODEL };

	let completions = 0;
	let surfaced429 = 0;

	const fireOne = async (tag: number) => {
		const context: Context = {
			systemPrompt: [`Reply with exactly: ${tag}`],
			messages: [{ role: "user", content: `Reply with exactly: ${tag}`, timestamp: Date.now() }],
		};
		const stream = streamOpenAICompletions(model, context, { apiKey, maxTokens: 24 });
		let firstError: unknown;
		for await (const ev of stream) {
			if (ev.type === "error") {
				firstError = ev.error.errorMessage ?? ev.error;
				if (/429|concurrent/i.test(String(firstError))) surfaced429++;
			}
		}
		if (firstError) throw firstError;
		completions++;
	};

	const results = await Promise.allSettled([fireOne(1), fireOne(2), fireOne(3), fireOne(4)]);

	for (const [i, r] of results.entries()) {
		if (r.status === "rejected") console.error(`lane ${i + 1} failed:`, r.reason);
	}
	console.log(`completions: ${completions}/4, surfaced 429s: ${surfaced429}`);
	if (completions !== 4) {
		console.error("not all 4 lanes completed on the same model");
		process.exit(1);
	}
	if (surfaced429 > 0) {
		console.error("concurrency 429s surfaced to the caller");
		process.exit(1);
	}
	console.log("\nLIVE OK — 4 concurrent requests serialized via shared lease, zero 429s.");
}

main().catch((err) => {
	console.error("unhandled:", err);
	process.exit(1);
});