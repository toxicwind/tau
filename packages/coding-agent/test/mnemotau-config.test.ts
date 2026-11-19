import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import { Settings } from "tau/config/settings";
import { loadMnemotauConfig, type MnemotauBackendConfig } from "tau/mnemotau/config";
import { getMemoriesDir } from "@tau/tau-utils";

// `mnemotau.embeddingVariant` selects the concrete local embedding model, while an
// explicit `mnemotau.embeddingModel` is an advanced override that wins. Scoping is
// pinned to "global" so the resolver stays pure (no legacy-bank disk probing).
function mnemotauConfigFor(
	overrides: Record<string, unknown>,
	agentDir = "/tmp/mnemotau-config-test",
): MnemotauBackendConfig {
	const settings = Settings.isolated({ "mnemotau.scoping": "global", ...overrides });
	return loadMnemotauConfig(settings, agentDir);
}

function embeddingModelFor(overrides: Record<string, unknown>): string | undefined {
	return mnemotauConfigFor(overrides).providerOptions.embeddingModel;
}

describe("loadMnemotauConfig embedding variant resolution", () => {
	it("maps the en variant to BAAI/bge-base-en-v1.5", () => {
		expect(embeddingModelFor({ "mnemotau.embeddingVariant": "en" })).toBe("BAAI/bge-base-en-v1.5");
	});

	it("maps the multilingual variant to intfloat/multilingual-e5-large", () => {
		expect(embeddingModelFor({ "mnemotau.embeddingVariant": "multilingual" })).toBe("intfloat/multilingual-e5-large");
	});

	it("lets an explicit embeddingModel override win over the variant", () => {
		expect(
			embeddingModelFor({
				"mnemotau.embeddingVariant": "multilingual",
				"mnemotau.embeddingModel": "openai/text-embedding-3-small",
			}),
		).toBe("openai/text-embedding-3-small");
	});

	it("ignores a blank override and falls back to the variant", () => {
		expect(embeddingModelFor({ "mnemotau.embeddingVariant": "en", "mnemotau.embeddingModel": "   " })).toBe(
			"BAAI/bge-base-en-v1.5",
		);
	});

	it("honors MNEMOTAU_EMBEDDING_MODEL when no explicit model setting is present", () => {
		const previous = Bun.env.MNEMOTAU_EMBEDDING_MODEL;
		Bun.env.MNEMOTAU_EMBEDDING_MODEL = "BAAI/bge-large-en-v1.5";
		try {
			// The documented env override must not be shadowed by the variant default.
			expect(embeddingModelFor({ "mnemotau.embeddingVariant": "en" })).toBe("BAAI/bge-large-en-v1.5");
		} finally {
			if (previous === undefined) delete Bun.env.MNEMOTAU_EMBEDDING_MODEL;
			else Bun.env.MNEMOTAU_EMBEDDING_MODEL = previous;
		}
	});

	it("lets an explicit embeddingModel setting win over the env var", () => {
		const previous = Bun.env.MNEMOTAU_EMBEDDING_MODEL;
		Bun.env.MNEMOTAU_EMBEDDING_MODEL = "BAAI/bge-large-en-v1.5";
		try {
			expect(embeddingModelFor({ "mnemotau.embeddingModel": "openai/text-embedding-3-small" })).toBe(
				"openai/text-embedding-3-small",
			);
		} finally {
			if (previous === undefined) delete Bun.env.MNEMOTAU_EMBEDDING_MODEL;
			else Bun.env.MNEMOTAU_EMBEDDING_MODEL = previous;
		}
	});
});

describe("loadMnemotauConfig database path resolution", () => {
	it("resolves a blank dbPath to persistent agent storage", () => {
		const agentDir = "/tmp/mnemotau-blank-db-path-test";
		const defaultPath = path.join(getMemoriesDir(agentDir), "mnemotau", "mnemotau.db");

		expect(mnemotauConfigFor({ "mnemotau.dbPath": "" }, agentDir).dbPath).toBe(defaultPath);
		expect(mnemotauConfigFor({ "mnemotau.dbPath": " \t " }, agentDir).dbPath).toBe(defaultPath);
	});
});
