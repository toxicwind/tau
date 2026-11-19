import { describe, expect, it } from "bun:test";
import { buildNonInteractiveEnv } from "../src/exec/non-interactive-env";
import { countTokens, Encoding } from "@tau/tau-natives";
import { SETTINGS_SCHEMA } from "../src/config/settings-schema";

describe("bash tiktoken auto-shim & token tracking", () => {
	it("injects TIKTOKEN_CACHE_DIR + ~/.local/bin, but never a foreign Python's PYTHONPATH (venv isolation)", () => {
		const env = buildNonInteractiveEnv();
		expect(env.TIKTOKEN_CACHE_DIR).toBeDefined();
		expect(env.TIKTOKEN_CACHE_DIR).toContain(".cache/tiktoken");
		expect(env.PATH).toBeDefined();
		expect(env.PATH).toContain(".local/bin");
		// Regression: the environment must NOT merge a mise site-packages path
		// into PYTHONPATH — that cross-Python-ABI bleed crashes every isolated
		// venv/uvx server (pydantic_core ArgsKwargs). nvm-style: the interpreter
		// comes from PATH; child processes keep their own clean PYTHONPATH.
		expect(env.PYTHONPATH).toBeUndefined();
	});

	it("preserves caller overrides while retaining tiktoken shims", () => {
		const env = buildNonInteractiveEnv({ CUSTOM_VAR: "true", PATH: "/custom/bin:/usr/bin" });
		expect(env.CUSTOM_VAR).toBe("true");
		expect(env.PATH).toContain(".local/bin");
		expect(env.PATH).toContain("/custom/bin");
		expect(env.TIKTOKEN_CACHE_DIR).toContain(".cache/tiktoken");
	});

	it("has bash.tiktokenShim.enabled registered in SETTINGS_SCHEMA defaulting to true", () => {
		const setting = (SETTINGS_SCHEMA as Record<string, { default?: unknown }>)["bash.tiktokenShim.enabled"];
		expect(setting).toBeDefined();
		expect(setting?.default).toBe(true);
	});

	it("calculates live token counts using native o200k_base tokenizer", () => {
		const sampleText = "echo 'Testing live bash tiktoken tracking on awrawr-pc' <|endoftext|>";
		const tokens = countTokens(sampleText, Encoding.O200kBase);
		expect(typeof tokens).toBe("number");
		expect(tokens).toBeGreaterThan(0);
	});
});
