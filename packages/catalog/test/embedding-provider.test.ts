import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { buildModel } from "@tau/tau-catalog/build";
import type { ModelSpec } from "@tau/tau-catalog/types";
import { compileCompatRules } from "../scripts/compat-compiler";
import { roostProviderEntries } from "../src/compat/roost";

const RULES_DIR = path.join(import.meta.dir, "../src/compat/rules");

async function resolvedSeedModels(providerId: "openai" | "openrouter") {
	const rules = await compileCompatRules(RULES_DIR);
	// Catalog entries are KDL-compiled plus roost-sourced: openrouter's entry
	// (including these seed rows) now comes from `@ranch/roost` via
	// `src/compat/roost.ts`. Roost wins on id conflict, mirroring
	// `src/compat/providers.ts`.
	const providers = { ...rules.providers, ...roostProviderEntries() };
	const seed = providers[providerId]?.seed;
	if (!seed) throw new Error(`${providerId} has no catalog seed`);
	return seed.models.filter(row => row.api === "openai-embeddings").map(row => buildModel(row as ModelSpec));
}

describe("cloud embedding catalog policy", () => {
	test("OpenAI embedding seeds resolve onto the embeddings runner", async () => {
		const models = await resolvedSeedModels("openai");
		expect(models.map(model => model.id)).toEqual([
			"text-embedding-3-small",
			"text-embedding-3-large",
			"text-embedding-ada-002",
		]);
		expect(models.map(model => model.cost.input)).toEqual([0.02, 0.13, 0.1]);
		for (const model of models) {
			expect(model.kind).toBe("embedding");
			expect(model.api).toBe("openai-embeddings");
			expect(model.cost.output).toBe(0);
		}
	});

	test("OpenRouter's bundled embedding fallbacks resolve onto the embeddings runner", async () => {
		const models = await resolvedSeedModels("openrouter");
		expect(models.map(model => model.id)).toEqual(["openai/text-embedding-3-small", "qwen/qwen3-embedding-8b"]);
		expect(models.map(model => model.cost.input)).toEqual([0.02, 0.01]);
		for (const model of models) {
			expect(model.kind).toBe("embedding");
			expect(model.api).toBe("openai-embeddings");
			expect(model.cost.output).toBe(0);
		}
	});
});
