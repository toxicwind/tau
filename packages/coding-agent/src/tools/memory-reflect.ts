<<<<<<< ours — interstitial `file_header` (S+F, confidence: low)
// refused_by: merge_ladder_exhausted · collision: `import { logger, untilAborted } from "@oh-my-pi/pi-utils";`
import { type } from "@tau/tautype";
import type { AgentTool, AgentToolResult } from "@tau/tau-agent-core";
import { logger, untilAborted } from "@tau/tau-utils";
=======
import { type } from "@oh-my-pi/omptype";
import type { AgentTool, AgentToolResult } from "@oh-my-pi/pi-agent-core";
import { logger, prompt, untilAborted, toError } from "@oh-my-pi/pi-utils";
>>>>>>> theirs — interstitial `file_header` (S+F, confidence: low) · weave: run 'weave explain packages/coding-agent/src/tools/memory-reflect.ts' for per-hunk detail, 'weave check' to verify your resolution
import { isHindsightConfigured, loadHindsightConfig } from "../hindsight/config";
import { ensureBankExists } from "../hindsight/bank";
import reflectDescription from "../prompts/tools/reflect.md" with { type: "text" };
import { sessionMemoryToolRefs } from "../memory-backend/tool-names";
import type { ToolSession } from ".";

import { cfgMemoryBackend } from "../memory-backend/settings";

const memoryReflectSchema = type({
	query: type("string").describe("question to answer"),
	"context?": type("string").describe("optional context"),
});

export type MemoryReflectParams = typeof memoryReflectSchema.infer;

export class MemoryReflectTool implements AgentTool<typeof memoryReflectSchema> {
	readonly name = "reflect";
	readonly approval = "read" as const;
	readonly label = "Reflect";
	get description(): string {
		return prompt.render(reflectDescription, {
			toolRefs: sessionMemoryToolRefs(this.session),
		});
	}
	readonly parameters = memoryReflectSchema;
	readonly strict = true;
	readonly loadMode = "discoverable";
	readonly summary = "Synthesize an answer from long-term memory";

	constructor(private readonly session: ToolSession) {}

	static createIf(session: ToolSession): MemoryReflectTool | null {
		const backend = cfgMemoryBackend.get(session.settings);
		if (backend !== "hindsight" && backend !== "mnemotau") return null;
		if (backend === "hindsight" && !isHindsightConfigured(loadHindsightConfig(session.settings))) return null;
		return new MemoryReflectTool(session);
	}

	async execute(_id: string, params: MemoryReflectParams, signal?: AbortSignal): Promise<AgentToolResult> {
		return untilAborted(signal, async () => {
<<<<<<< ours — scope `execute` in class `MemoryReflectTool` (F, confidence: medium)
// refused_by: container_member · collision: none (2 contested hunk(s), neither side deleted the other's lines)
			const backend = this.session.settings.get("memory.backend");
			if (backend === "mnemotau") {
				const state = this.session.getMnemotauSessionState?.();
=======
			const backend = cfgMemoryBackend.get(this.session.settings);
			if (backend === "mnemopi") {
				const state = this.session.getMnemopiSessionState?.();
>>>>>>> theirs — scope `execute`
				if (!state) {
					throw new Error("Mnemotau backend is not initialised for this session.");
				}

				try {
					const query = params.context?.trim()
						? `${params.query.trim()}\n\nAdditional context:\n${params.context.trim()}`
						: params.query;
					const results = await state.recallResultsScoped(query);
					if (results.length === 0) {
						return {
							content: [{ type: "text", text: "No relevant information found to reflect on." }],
							details: {},
						};
					}
					const summary = state.formatContextScoped(results);
					return {
						content: [{ type: "text", text: `Based on recalled memories:\n\n${summary}` }],
						details: {},
					};
				} catch (err) {
<<<<<<< ours — scope `execute` in class `MemoryReflectTool` (F, confidence: medium)
// refused_by: container_member · collision: none (2 contested hunk(s), neither side deleted the other's lines)
					logger.warn("reflect failed", { backend: "mnemotau", bank: state.config.bank, error: String(err) });
					throw err instanceof Error ? err : new Error(String(err));
=======
					logger.warn("reflect failed", { backend: "mnemopi", bank: state.config.bank, error: String(err) });
					throw toError(err);
>>>>>>> theirs — scope `execute`
				}
			}

			const state = this.session.getHindsightSessionState?.();
			if (!state) {
				throw new Error("Hindsight backend is not initialised for this session.");
			}

			try {
				await ensureBankExists(state.client, state.bankId, state.config, state.banksSet);
				const response = await state.client.reflect(state.bankId, params.query, {
					context: params.context,
					budget: state.config.recallBudget,
					tags: state.recallTags,
					tagsMatch: state.recallTagsMatch,
				});
				const text = response.text?.trim() || "No relevant information found to reflect on.";
				return {
					content: [{ type: "text", text }],
					details: {},
				};
			} catch (err) {
				logger.warn("reflect failed", { bankId: state.bankId, error: String(err) });
				throw toError(err);
			}
		});
	}
}
