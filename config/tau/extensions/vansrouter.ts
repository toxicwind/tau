import fs from "fs";
import type { ExtensionAPI, ProviderConfig, ProviderModelConfig } from "@tau/tau-coding-agent";

const KNOWN_PROVIDERS = new Set([
  "oc", "mmf", "nvidia", "openai", "anthropic", "google", "groq",
  "openrouter", "cerebras", "hf", "nim", "vansrouter",
]);

function resolveApiKey(): string {
  if (process.env.VANSROUTER_API_KEY?.trim()) return process.env.VANSROUTER_API_KEY.trim();
  if (process.env.API_KEY_SECRET?.trim()) return process.env.API_KEY_SECRET.trim();
  for (const f of ["/home/toxic/.config/vansrouter/env", "/home/toxic/.secrets"]) {
    try {
      const raw = fs.readFileSync(f, "utf-8");
      const m = raw.match(/^(?:VANSROUTER_API_KEY|API_KEY_SECRET)=(.*)$/m);
      if (m?.[1]) {
        const k = m[1].trim().replace(/^["']|["']$/g, "").trim();
        if (k) return k;
      }
    } catch {}
  }
  return "local-sovereign";
}

// Collapse accidental double prefixes like nvidia/nvidia/foo -> nvidia/foo
// and strip a single leading prefix that duplicates the segment after it.
function cleanModelId(raw: string): string {
  if (!raw) return raw;
  const parts = raw.split("/");
  // Collapse consecutive duplicates: a/a/b/c -> a/b/c
  const collapsed: string[] = [];
  for (const p of parts) {
    if (collapsed.length === 0 || collapsed[collapsed.length - 1] !== p) collapsed.push(p);
  }
  return collapsed.join("/");
}

function inferCapabilities(id: string) {
  const lower = id.toLowerCase();
  const vision = /vision|llava|qwen.*vl|gpt-4|gpt-5|claude|gemini|image/.test(lower);
  const reasoning = /reason|think|o1|o3|r1|nemotron|deepseek-r/.test(lower);
  return { vision, reasoning };
}

function toProviderModel(m: { id?: string; name?: string }): ProviderModelConfig {
  const rawId = String(m.id ?? "");
  const id = cleanModelId(rawId);
  const { vision, reasoning } = inferCapabilities(id);
  return {
    id,
    name: String(m.name ?? id),
    input: vision ? ["text", "image"] : ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
    reasoning,
  };
}

// Curated seed — only IDs vansrouter actually serves.
const SEED_MODELS: ProviderModelConfig[] = [
  "oc/jev-1.13-free",
  "oc/mimo-v2.5-free",
  "oc/deepseek-v4-flash-free",
  "oc/nemotron-3.5-lightning-free",
  "mmf/mimo-auto",
].map((id) => toProviderModel({ id }));

export default function vansrouterExtension(pi: ExtensionAPI): void {
  const baseUrl = process.env.VANSROUTER_URL || "http://127.0.0.1:20128/v1";
  const apiKey = resolveApiKey();

  const register = (models: ProviderModelConfig[]) => {
    pi.registerProvider("vansrouter", {
      baseUrl,
      apiKey,
      api: "openai-completions",
      authHeader: true,
      models,
    } as ProviderConfig);
  };

  // Sync registration — session/new never throws
  register(SEED_MODELS);

  // Async discovery — replace with whatever the live catalog actually has,
  // but always sanitize IDs and drop anything that still looks doubled.
  pi.on("session_start", async (_e, ctx) => {
    try {
      const res = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { data?: Array<{ id?: string; name?: string }> };
      const raw = Array.isArray(json?.data) ? json.data : [];

      const seen = new Set<string>();
      const live: ProviderModelConfig[] = [];
      for (const m of raw) {
        const pm = toProviderModel(m);
        const segments = pm.id.split("/");
        // Require exactly one provider segment + one model name
        if (segments.length < 2) continue;
        if (segments[0] === segments[1]) continue; // doubled
        if (seen.has(pm.id)) continue;
        seen.add(pm.id);
        live.push(pm);
      }

      if (live.length > 0) {
        register(live);
        ctx?.ui?.notify?.(`[vansrouter] synced ${live.length} live models`);
        return;
      }
    } catch (e) {
      // fall through
    }
    ctx?.ui?.notify?.(`[vansrouter] using ${SEED_MODELS.length} seed models`);
  });
}
