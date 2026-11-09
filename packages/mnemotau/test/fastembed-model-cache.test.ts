import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { isFastembedModelCached } from "../src/core/fastembed-model-cache";

// The agent shows download activity whenever this reports false, so it must
// match fastembed@3's `<cacheDir>/<Qdrant repo>/` layout and its
// fetch-only-missing-files behavior.
describe("isFastembedModelCached", () => {
	const files = [
		"model.onnx",
		"model.onnx_data",
		"tokenizer.json",
		"tokenizer_config.json",
		"config.json",
		"special_tokens_map.json",
	];
	let cacheDir: string;

	beforeEach(async () => {
		cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "mnemopi-fastembed-"));
	});

	afterEach(async () => {
		await fs.rm(cacheDir, { recursive: true, force: true });
	});

	async function populate(dir: string, names: readonly string[]): Promise<void> {
		await Promise.all(names.map(name => Bun.write(path.join(cacheDir, dir, name), "x")));
	}

	it("reports a model cached only when every weight and tokenizer file is present", async () => {
		await populate("Qdrant_multilingual-e5-large-onnx", files);
		expect(await isFastembedModelCached("fast-multilingual-e5-large", cacheDir)).toBe(true);

		await fs.rm(path.join(cacheDir, "Qdrant_multilingual-e5-large-onnx", "model.onnx_data"));
		expect(await isFastembedModelCached("fast-multilingual-e5-large", cacheDir)).toBe(false);
	});

	it("ignores the fastembed@2 tarball layout keyed by model name", async () => {
		await populate("fast-multilingual-e5-large", files);
		expect(await isFastembedModelCached("fast-multilingual-e5-large", cacheDir)).toBe(false);
	});

	it("reports unknown models as not cached", async () => {
		expect(await isFastembedModelCached("custom", cacheDir)).toBe(false);
	});
});

// refused_by: modify_delete_guard · collision: none (no common ancestor text)
describe("fastembed model cache repair", () => {
	it("downloads missing config and tokenizer sidecars without overwriting cached files", async () => {
		const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "mnemotau-fastembed-"));
		const model = "fast-bge-base-en-v1.5";
		const modelDir = path.join(cacheDir, model);
		const requested: string[] = [];
		const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
			Object.assign(
				(input: string | URL | Request, _init?: RequestInit) => {
					const url = String(input);
					requested.push(url);
					return Promise.resolve(new Response(`body:${path.basename(url)}`));
				},
				{ preconnect: globalThis.fetch.preconnect },
			),
		);

		try {
			await fs.mkdir(modelDir, { recursive: true });
			await Bun.write(path.join(modelDir, "tokenizer.json"), "cached-tokenizer");

			expect(await ensureFastembedModelSidecars(model, cacheDir)).toBe(true);

			expect(requested).toEqual([
				"https://huggingface.co/BAAI/bge-base-en-v1.5/resolve/main/config.json",
				"https://huggingface.co/BAAI/bge-base-en-v1.5/resolve/main/tokenizer_config.json",
				"https://huggingface.co/BAAI/bge-base-en-v1.5/resolve/main/special_tokens_map.json",
			]);
			expect(await Bun.file(path.join(modelDir, "config.json")).text()).toBe("body:config.json");
			expect(await Bun.file(path.join(modelDir, "tokenizer.json")).text()).toBe("cached-tokenizer");
			expect(await Bun.file(path.join(modelDir, "tokenizer_config.json")).text()).toBe("body:tokenizer_config.json");
			expect(await Bun.file(path.join(modelDir, "special_tokens_map.json")).text()).toBe(
				"body:special_tokens_map.json",
			);
		} finally {
			fetchSpy.mockRestore();
			await fs.rm(cacheDir, { recursive: true, force: true });
		}
	});

	it("reports unsupported fastembed cache names without network access", async () => {
		const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
			Object.assign(
				() => {
					throw new Error("fetch should not run");
				},
				{ preconnect: globalThis.fetch.preconnect },
			),
		);
		try {
			expect(await ensureFastembedModelSidecars("unknown-model", "/tmp/missing")).toBe(false);
			expect(fetchSpy).not.toHaveBeenCalled();
		} finally {
			fetchSpy.mockRestore();
		}
	});
});
