# @tau/tau-mnemotau

Local SQLite memory engine for tau agents.

This package is the Bun/TypeScript port of the Mnemosyne memory engine. It provides:

- `Mnemotau`, a small facade for remember/recall/stats/sleep workflows.
- `BeamMemory`, the lower-level working/episodic memory engine.
- MCP tool definitions and a dispatcher for host integrations.
- Optional local ONNX embeddings through `fastembed` and optional OpenAI-compatible embedding/LLM endpoints.

The package does not bundle or download a local GGUF LLM. LLM paths are host-backend or OpenAI-compatible remote only; when no LLM is configured, deterministic heuristic paths are used.

## Basic use

```ts
import { Mnemotau } from "@tau/tau-mnemotau";

const memory = new Mnemotau({ dbPath: "./mnemotau.db", bank: "project" });
const id = memory.remember("The deployment target is stable-cluster.", {
	source: "notes",
	importance: 0.8,
	veracity: "true",
});

const results = memory.recall("deployment target", 5);
console.log(id, results[0]?.content);

memory.close();
```

## Configuration

`Mnemotau` accepts LLM and embedding options directly. `MNEMOTAU_*` environment variables remain fallbacks/defaults when the matching constructor option is omitted.

```ts
import { Mnemotau } from "@tau/tau-mnemotau";
import type { Model } from "@tau/tau-ai";

const ftsOnly = new Mnemotau({ noEmbeddings: true });

const remoteEmbeddings = new Mnemotau({
	embeddingModel: "text-embedding-3-small",
	embeddingApiUrl: "https://api.openai.com/v1",
	embeddingApiKey: process.env.OPENAI_API_KEY,
});

const remoteLlm = new Mnemotau({
	llm: {
		baseUrl: "https://api.openai.com/v1",
		apiKey: process.env.OPENAI_API_KEY,
		model: "gpt-4.1-mini",
	},
	// Equivalent aliases: llmBaseUrl, llmApiKey, llmModel.
});

declare const smolModel: Model;
const piAiLlm = new Mnemotau({ llm: smolModel });
const dynamicLlm = new Mnemotau({
	llm: async (prompt, opts) => {
		const token = await getFreshOauthToken();
		return await completeWithPiAi(prompt, {
			token,
			maxTokens: opts?.maxTokens,
			temperature: opts?.temperature,
		});
	},
});
```

### Banks and host scoping

`Mnemotau` itself exposes banks directly through constructor options such as `bank`; it does not hard-code coding-agent project scoping.

The tau coding-agent wrapper adds `mnemotau.scoping` on top of those constructor options:

- `global`: one shared bank
- `per-project`: isolated project memory
- `per-project-tagged`: project-local writes plus global recall visibility

In `per-project-tagged`, the wrapper is responsible for combining project-local retention with global recall visibility. The package still just exposes banks plus constructor-level LLM and embedding options.

Common environment fallbacks:

- `MNEMOTAU_DATA_DIR` / `MNEMOTAU_DB_PATH`: default storage location.
- `MNEMOTAU_DB_PAGE_SIZE`: optional SQLite page size for new file-backed databases; use a valid power of two from 512 to 65536 or `os` to request the detected system page size. Unset preserves SQLite's default.
- `MNEMOTAU_NO_EMBEDDINGS=1`: force FTS-only recall.
- `MNEMOTAU_EMBEDDING_MODEL`: defaults to `BAAI/bge-small-en-v1.5`.
- `MNEMOTAU_EMBEDDING_API_URL` and `MNEMOTAU_EMBEDDING_API_KEY`: OpenAI-compatible embedding endpoint.
- `MNEMOTAU_LLM_ENABLED=1`, `MNEMOTAU_LLM_BASE_URL`, `MNEMOTAU_LLM_API_KEY`, `MNEMOTAU_LLM_MODEL`: OpenAI-compatible LLM endpoint.

Local embeddings use the `fastembed` npm package. Its default `BGESmallENV15` model is 384-dimensional and uses the package's CLS pooling plus vector normalization path. Local GGUF LLMs are not available in this package.

## Commands

```sh
mnemotau remember "Use stable-cluster for production deploys"
mnemotau recall "production deploy target"
mnemotau stats
mnemotau sleep
```

## Tests

```sh
bun --cwd packages/mnemotau test
bun --cwd packages/mnemotau run check
```
