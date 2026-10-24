import type { ExtensionAPI, ProviderConfig } from "tau";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const KIMI_AUTO_HERD = process.env.KIMI_AUTO_HERD || "http://127.0.0.1:25100";
const KIMI_STATE_PATH =
  process.env.KIMI_AUTO_STATE || join(homedir(), ".local/share/kimi-auto/state.json");

export function getKimiAutoState(): { model: string | null; healthy: boolean; updated_at: string | null } {
  try {
    if (existsSync(KIMI_STATE_PATH)) {
      const parsed = JSON.parse(readFileSync(KIMI_STATE_PATH, "utf-8"));
      return {
        model: typeof parsed.model === "string" ? parsed.model : null,
        healthy: Boolean(parsed.healthy),
        updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : null,
      };
    }
  } catch {
    // Return unverified state if unreadable
  }
  return { model: null, healthy: false, updated_at: null };
}

export default function tauKimiAutoExtension(pi: ExtensionAPI): void {
  const providerConfig: ProviderConfig = {
    baseUrl: `${KIMI_AUTO_HERD}/v1`,
    apiKey: "herd-kimi-auto",
    models: [
      {
        id: "kimi-auto",
        name: "kimi-auto (Herd Resolver)",
        contextWindow: 131072,
        maxTokens: 8192,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ],
  };

  pi.registerProvider("kimi-auto", providerConfig);

  pi.on("session_start", async (_event, ctx) => {
    const state = getKimiAutoState();
    if (ctx.hasUI && ctx.ui?.notify) {
      if (state.healthy && state.model) {
        ctx.ui.notify(`[kimi-auto] resolving to ${state.model}`, "info");
      }
    }
  });
}
