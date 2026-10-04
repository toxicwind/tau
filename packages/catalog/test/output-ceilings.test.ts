import { describe, expect, test } from "bun:test";
import {
	CURATED_OUTPUT_CEILINGS,
	getCuratedOutputCeiling,
	parseOutputCeilingFromErrorText,
} from "@tau/tau-catalog/output-ceilings";

describe("output-ceilings (catalog)", () => {
	test("curated table holds the known-stale gateway ceilings", () => {
		expect(CURATED_OUTPUT_CEILINGS["poolside/laguna-s-2.1-free"]).toBe(32_768);
		expect(CURATED_OUTPUT_CEILINGS["meta/muse-spark-1.2-contributor"]).toBe(131_072);
	});

	test("getCuratedOutputCeiling returns undefined for uncurated models", () => {
		expect(getCuratedOutputCeiling("openai/gpt-5.2")).toBeUndefined();
		expect(getCuratedOutputCeiling("")).toBeUndefined();
		expect(getCuratedOutputCeiling("poolside/laguna-s-2.1-free")).toBe(32_768);
	});

	test("parses the canonical 400 ceiling message", () => {
		expect(
			parseOutputCeilingFromErrorText(
				"400 max_tokens (65536): Input should be less than or equal to 32768 (type=AI_APICallError)",
			),
		).toEqual({ requested: 65_536, ceiling: 32_768 });
	});

	test("parses variant wordings", () => {
		expect(parseOutputCeilingFromErrorText("max_tokens (8192) must be less than or equal to 4096")).toEqual({
			requested: 8192,
			ceiling: 4096,
		});
	});

	test("rejects non-corrections and non-matching text", () => {
		// ceiling not below requested -> not a correction
		expect(parseOutputCeilingFromErrorText("max_tokens (100): Input should be less than or equal to 100")).toBeUndefined();
		expect(parseOutputCeilingFromErrorText("max_tokens (100): Input should be less than or equal to 200")).toBeUndefined();
		// unrelated errors
		expect(parseOutputCeilingFromErrorText("429 rate limit exceeded")).toBeUndefined();
		expect(parseOutputCeilingFromErrorText("")).toBeUndefined();
		expect(parseOutputCeilingFromErrorText("max_tokens must be positive")).toBeUndefined();
	});
});
