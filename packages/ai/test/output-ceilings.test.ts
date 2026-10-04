import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { getAgentDir } from "@tau/tau-utils";
import * as path from "node:path";
import {
	__resetLearnedCeilingsForTests,
	getOutputCeiling,
	learnOutputCeilingFromError,
} from "../src/providers/output-ceilings";

const CEILING_400 =
	"400 max_tokens (65536): Input should be less than or equal to 32768 (type=AI_APICallError)";

const cacheFile = () => path.join(getAgentDir(), "cache", "output-ceilings.json");
let backup: string | null = null;

describe("output-ceilings (ai provider layer)", () => {
	beforeEach(() => {
		// Preserve any real learned ceilings; tests must not destroy them.
		try {
			backup = fs.existsSync(cacheFile()) ? fs.readFileSync(cacheFile(), "utf8") : null;
		} catch {
			backup = null;
		}
	});

	afterEach(() => {
		__resetLearnedCeilingsForTests();
		try {
			if (backup !== null) {
				fs.writeFileSync(cacheFile(), backup);
			} else {
				fs.rmSync(cacheFile(), { force: true });
			}
		} catch {
			// Best effort.
		}
		backup = null;
	});

	test("curated ceilings apply without any learning", () => {
		expect(getOutputCeiling("poolside/laguna-s-2.1-free")).toBe(32_768);
	});

	test("uncurated models have no ceiling until one is learned", () => {
		expect(getOutputCeiling("some/new-model-9")).toBeUndefined();
	});

	test("learns a ceiling from a 400 and applies it afterwards", () => {
		const modelId = "some/new-model-9";
		expect(learnOutputCeilingFromError(modelId, new Error(CEILING_400))).toBe(32_768);
		expect(getOutputCeiling(modelId)).toBe(32_768);
	});

	test("ceilings only ratchet down, never up", () => {
		const modelId = "some/ratchet-model";
		learnOutputCeilingFromError(modelId, new Error(CEILING_400));
		// A later 400 with a HIGHER ceiling must not raise the learned one.
		learnOutputCeilingFromError(
			modelId,
			new Error("400 max_tokens (32768): Input should be less than or equal to 65536"),
		);
		expect(getOutputCeiling(modelId)).toBe(32_768);
		// A later 400 with a LOWER ceiling tightens it.
		learnOutputCeilingFromError(
			modelId,
			new Error("400 max_tokens (32768): Input should be less than or equal to 16384"),
		);
		expect(getOutputCeiling(modelId)).toBe(16_384);
	});

	test("ignores errors without a usable ceiling", () => {
		const modelId = "some/clean-model";
		expect(learnOutputCeilingFromError(modelId, new Error("429 rate limit"))).toBeUndefined();
		expect(learnOutputCeilingFromError(modelId, null)).toBeUndefined();
		expect(getOutputCeiling(modelId)).toBeUndefined();
	});

	test("persists learned ceilings to the agent cache dir", () => {
		const modelId = "some/persist-model";
		learnOutputCeilingFromError(modelId, new Error(CEILING_400));
		const file = cacheFile();
		expect(fs.existsSync(file)).toBe(true);
		const saved = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, { ceiling: number }>;
		expect(saved[modelId]?.ceiling).toBe(32_768);
	});
});
