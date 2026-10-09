import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { buildModel } from "@tau/tau-catalog/build";
import type { ModelSpec } from "@tau/tau-catalog/types";
import { compileCompatRules } from "../scripts/compat-compiler";
import { roostProviderEntries } from "../src/compat/roost";

const RULES_DIR = path.join(import.meta.dir, "../src/compat/rules");

describe("video catalog policy", () => {
	test("OpenRouter's bundled video fallbacks resolve onto the video runner", async () => {
		const rules = await compileCompatRules(RULES_DIR);
		// openrouter's entry (kindApis + seed rows) now comes from
		// `@ranch/roost` via `src/compat/roost.ts`; roost wins on conflict.
		const provider = roostProviderEntries()["openrouter"] ?? rules.providers.openrouter;
		if (!provider?.seed) throw new Error("openrouter has no catalog seed");
		expect(provider.kindApis?.video).toBe("openrouter-video");
		const models = provider.seed.models
			.filter(row => row.api === "openrouter-video")
			.map(row => buildModel(row as ModelSpec));
		expect(models.map(model => model.id)).toEqual(["google/veo-3.1", "minimax/hailuo-3", "alibaba/wan-2.7"]);
		for (const model of models) {
			expect(model).toMatchObject({
				kind: "video",
				api: "openrouter-video",
				baseUrl: "https://openrouter.ai/api/v1",
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			});
		}
	});
});
