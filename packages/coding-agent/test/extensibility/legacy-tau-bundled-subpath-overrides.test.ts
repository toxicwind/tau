import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as url from "node:url";
import { __buildLegacyPiPackageRootOverrides } from "tau/extensibility/plugins/legacy-tau-compat";
import { TempDir } from "@tau/tau-utils";
import { __renderLegacyPiVirtualModule, collectBundledPiEntries } from "../../scripts/legacy-tau-virtual-module";
import type { BundledPiEntry } from "../../scripts/legacy-pi-virtual-module";

const bundledEntries = await collectBundledPiEntries();
const bundledModuleKeys = new Set(bundledEntries.map(entry => entry.key));

async function runRegistryProbe(entries: BundledPiEntry[], source: string): Promise<unknown> {
	// Bare package imports in the generated registry need the workspace links.
	const packageRoot = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..", "..");
	const registryPath = path.join(packageRoot, `.probe-legacy-pi-${Bun.randomUUIDv7()}.ts`);
	await Bun.write(registryPath, `${__renderLegacyPiVirtualModule(entries)}\n${source}\n`);
	try {
		// Runtime-selected registry filename: static imports cannot exercise its generated module.
		const registry = await import(url.pathToFileURL(registryPath).href);
		return registry.observed;
	} finally {
		await fs.rm(registryPath, { force: true });
	}
}
<<<<<<< ours — interstitial `between:packages/coding-agent/test/extensibility/legacy-tau-bundled-subpath-overrides.test.ts::variable::bundledModuleKeys:packages/coding-agent/test/extensibility/legacy-tau-bundled-subpath-overrides.test.ts::test_suite::legacy pi compat compiled-mode subpath overrides (issue #3442)` (T+S, confidence: medium)
// refused_by: merge_ladder_exhausted · collision: `// failed to resolve `@earendil-works/pi-ai/oauth` because the …` +1 more

// Regression for issue #3442: extension validation in compiled-binary mode
// failed to resolve `@earendil-works/tau-ai/oauth` because the override map
// only covered bare package roots — every non-wildcard subpath fell through
// to `Bun.resolveSync`, which bunfs can't satisfy on Bun 1.3.14+, then the
// `rewriteLegacyPiImports` catch left the original specifier in place and
// Bun's native resolver couldn't find a peer install. The build plugin now
// derives every module key from current package exports, so subpaths route to
// the same `tau-legacy-tau-bundled:` virtual namespace as package roots without
// a generated registry or duplicate key list.
=======
>>>>>>> theirs — interstitial `between:packages/coding-agent/test/extensibility/legacy-tau-bundled-subpath-overrides.test.ts::variable::bundledModuleKeys:packages/coding-agent/test/extensibility/legacy-tau-bundled-subpath-overrides.test.ts::test_suite::legacy pi compat compiled-mode subpath overrides (issue #3442)` (T+S, confidence: medium) · weave: run 'weave explain packages/coding-agent/test/extensibility/legacy-tau-bundled-subpath-overrides.test.ts' for per-hunk detail, 'weave check' to verify your resolution

// Regression for issue #3442: extension validation in compiled-binary mode
// failed to resolve `@earendil-works/pi-ai/oauth` because the override map
// only covered bare package roots — every non-wildcard subpath fell through
// to `Bun.resolveSync`, which bunfs can't satisfy on Bun 1.3.14+, then the
// `rewriteLegacyPiImports` catch left the original specifier in place and
// Bun's native resolver couldn't find a peer install. The build plugin now
// derives every module key from current package exports, so subpaths route to
// the same `omp-legacy-pi-bundled:` virtual namespace as package roots without
// a generated registry or duplicate key list.
describe("legacy pi compat compiled-mode subpath overrides (issue #3442)", () => {
	it("does not evaluate unrelated host modules while loading the registry", async () => {
		using tempDir = TempDir.createSync("@tau-legacy-tau-loaders-");
		const alphaPath = path.join(tempDir.path(), "alpha.ts");
		const betaPath = path.join(tempDir.path(), "beta.ts");
		const registryPath = path.join(tempDir.path(), "registry.ts");
		await Bun.write(alphaPath, 'Reflect.set(globalThis, "__alphaLoads", 1);\nexport const value = "alpha";\n');
		await Bun.write(betaPath, 'Reflect.set(globalThis, "__betaLoads", 1);\nexport const value = "beta";\n');
		const registry = __renderLegacyPiVirtualModule([
			{ key: "alpha", binding: "bundledAlpha", importSpecifier: url.pathToFileURL(alphaPath).href },
			{ key: "beta", binding: "bundledBeta", importSpecifier: url.pathToFileURL(betaPath).href },
		]);
		await Bun.write(
			registryPath,
			`${registry}
export const beforeAlpha = Reflect.get(globalThis, "__alphaLoads") ?? 0;
export const beforeBeta = Reflect.get(globalThis, "__betaLoads") ?? 0;
await BUNDLED_PI_MODULE_LOADERS.alpha();
export const afterAlpha = Reflect.get(globalThis, "__alphaLoads") ?? 0;
export const betaAfterAlpha = Reflect.get(globalThis, "__betaLoads") ?? 0;
await BUNDLED_PI_MODULE_LOADERS.beta();
export const finalAlpha = Reflect.get(globalThis, "__alphaLoads") ?? 0;
export const finalBeta = Reflect.get(globalThis, "__betaLoads") ?? 0;
`,
		);
		Reflect.deleteProperty(globalThis, "__alphaLoads");
		Reflect.deleteProperty(globalThis, "__betaLoads");
		try {
			// The generated registry has a runtime-selected temp path; importing it is the loading boundary under test.
			const observed = await import(url.pathToFileURL(registryPath).href);
			expect([
				observed.beforeAlpha,
				observed.beforeBeta,
				observed.afterAlpha,
				observed.betaAfterAlpha,
				observed.finalAlpha,
				observed.finalBeta,
			]).toEqual([0, 0, 1, 0, 1, 1]);
		} finally {
			Reflect.deleteProperty(globalThis, "__alphaLoads");
			Reflect.deleteProperty(globalThis, "__betaLoads");
		}
	});

	it("serves @tau/tau-ai/oauth through the bundled virtual namespace in compiled mode", () => {
		const overrides = __buildLegacyPiPackageRootOverrides(true, bundledModuleKeys);
		expect(overrides["@tau/tau-ai/oauth"]).toBe("tau-legacy-tau-bundled:@tau/tau-ai/oauth");
	});

	it("loads utility root-wildcard subpaths used by external image-link extensions", async () => {
		const keys = ["@oh-my-pi/pi-utils/lru", "@oh-my-pi/pi-utils/marked"] as const;
		const entries = bundledEntries.filter(entry => (keys as readonly string[]).includes(entry.key));
		expect(entries.map(entry => entry.key).sort()).toEqual([...keys]);

		const observed = await runRegistryProbe(
			entries,
			`const { Lexer } = await BUNDLED_PI_MODULE_LOADERS["@oh-my-pi/pi-utils/marked"]();
const { LRUCache } = await BUNDLED_PI_MODULE_LOADERS["@oh-my-pi/pi-utils/lru"]();
const cache = new LRUCache({ max: 1 });
cache.set("image", "photo.png");
const paragraph = Lexer.lex("[photo.png](file:///tmp/photo.png)")[0];
export const observed = {
	cachedImage: cache.get("image"),
	link: paragraph.tokens.map(token => ({ type: token.type, text: token.text, href: token.href })),
};`,
		);
		expect(observed).toEqual({
			cachedImage: "photo.png",
			link: [{ type: "link", text: "photo.png", href: "file:///tmp/photo.png" }],
		});
		const overrides = __buildLegacyPiPackageRootOverrides(true, bundledModuleKeys);
		for (const key of keys) expect(overrides[key]).toBe(`omp-legacy-pi-bundled:${key}`);
	});

	it("loads exported .js utility aliases from the same host modules", async () => {
		const keys = [
			"@oh-my-pi/pi-utils/lru",
			"@oh-my-pi/pi-utils/lru.js",
			"@oh-my-pi/pi-utils/marked",
			"@oh-my-pi/pi-utils/marked.js",
		];
		const entries = bundledEntries.filter(entry => keys.includes(entry.key));
		expect(entries.map(entry => entry.key).sort()).toEqual(keys);

		const observed = await runRegistryProbe(
			entries,
			`const marked = await BUNDLED_PI_MODULE_LOADERS["@oh-my-pi/pi-utils/marked"]();
const markedJs = await BUNDLED_PI_MODULE_LOADERS["@oh-my-pi/pi-utils/marked.js"]();
const lru = await BUNDLED_PI_MODULE_LOADERS["@oh-my-pi/pi-utils/lru"]();
const lruJs = await BUNDLED_PI_MODULE_LOADERS["@oh-my-pi/pi-utils/lru.js"]();
const cache = new lruJs.LRUCache({ max: 1 });
cache.set("image", "photo.png");
export const observed = {
	sharedLexer: markedJs.Lexer === marked.Lexer,
	sharedCache: lruJs.LRUCache === lru.LRUCache,
	text: markedJs.Lexer.lex(cache.get("image"))[0].text,
};`,
		);
		expect(observed).toEqual({ sharedLexer: true, sharedCache: true, text: "photo.png" });
		const overrides = __buildLegacyPiPackageRootOverrides(true, bundledModuleKeys);
		for (const key of keys) expect(overrides[key]).toBe(`omp-legacy-pi-bundled:${key}`);
	});

	it("expands wildcard exports for concrete on-disk targets (issue #3442 follow-up)", () => {
		// `tau-ai/oauth/anthropic` is exposed via the `./oauth/*` wildcard export;
		// the original fix only bundled non-wildcard subpaths, so peer-only plugins
		// importing `@(scope)/tau-ai/oauth/anthropic` (remapped via PI_SUBPATH_REMAPS
		// from `@mariozechner/tau-ai/utils/oauth/anthropic`) still hit the bunfs
		// fall-through. The generator now globs each wildcard's source pattern
		// and registers every concrete `.ts` match against the virtual namespace.
		const overrides = __buildLegacyPiPackageRootOverrides(true, bundledModuleKeys);
		expect(overrides["@tau/tau-ai/oauth/anthropic"]).toBe("tau-legacy-tau-bundled:@tau/tau-ai/oauth/anthropic");
		// Sanity: the wildcard expansion also reaches deeper subroots so plugins
		// pinned to e.g. `@tau/tau-ai/providers/openai` keep resolving.
		expect(bundledModuleKeys.has("@tau/tau-ai/oauth/anthropic")).toBe(true);
		expect(bundledModuleKeys.has("@tau/tau-ai/oauth/openai-codex")).toBe(true);
	});

	it("actually loads the shim's shared Pi translation through the bundled registry", async () => {
		// The legacy shim performs the same Pi arg translation as the modern
		// bridge and imports the shared helpers rather than copying them. Those
		// use the explicit single-segment `providers/cursor-tau-args` target; wildcard
		// exports may also match nested paths, whose registry coverage is tested below.
		//
		// Executing the generated registry is the contract — a key present in the
		// override map still proves nothing if the module cannot be imported.
		const key = "@tau/tau-ai/providers/cursor-tau-args";
		const entry = bundledEntries.find(candidate => candidate.key === key);
		expect(entry).toBeDefined();

<<<<<<< ours — scope `it("actually loads the shim's shared Pi trans...` in test_suite `legacy pi compat compiled-mode subpath overrides (issue #3442)` (F, confidence: medium)
// refused_by: statement_fold · collision: `const registryPath = path.join(packageRoot, `.probe-legacy-pi-a…`
		// The rendered registry imports by bare specifier, exactly as the real
		// bundle does, so it must run somewhere those specifiers resolve — the
		// package itself. A temp dir has no workspace links and would fail for
		// a reason unrelated to the export map.
		const packageRoot = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..", "..");
		const registryPath = path.join(packageRoot, `.probe-legacy-tau-args-${Bun.randomUUIDv7()}.ts`);
		await Bun.write(
			registryPath,
			`${__renderLegacyPiVirtualModule([entry!])}
const mod = await BUNDLED_PI_MODULE_LOADERS[${JSON.stringify(key)}]();
export const observed = [
	mod.piEscapeRegexLiteral("a.b*c"),
	mod.piJoinPath("src", "*.ts"),
];
`,
		);
		try {
			// The generated registry has a runtime-selected package-root path; importing it exercises bare resolution.
			const registryModule = await import(url.pathToFileURL(registryPath).href);
			expect(registryModule.observed).toEqual(["a\\.b\\*c", path.join("src", "*.ts")]);
		} finally {
			await fs.rm(registryPath, { force: true });
		}
=======
		expect(
			await runRegistryProbe(
				[entry!],
				`const mod = await BUNDLED_PI_MODULE_LOADERS[${JSON.stringify(key)}]();
export const observed = [mod.piEscapeRegexLiteral("a.b*c"), mod.piJoinPath("src", "*.ts")];`,
			),
		).toEqual(["a\\.b\\*c", path.join("src", "*.ts")]);
>>>>>>> theirs — scope `it("actually loads the shim's shared Pi trans...`

		const overrides = __buildLegacyPiPackageRootOverrides(true, bundledModuleKeys);
		expect(overrides[key]).toBe(`tau-legacy-tau-bundled:${key}`);
	});

	it("loads catalog root and provider-model exports from the bundled graph", async () => {
		const root = bundledEntries.find(entry => entry.key === "@oh-my-pi/pi-catalog");
		const provider = bundledEntries.find(entry => entry.key === "@oh-my-pi/pi-catalog/provider-models");
		if (!root || !provider) throw new Error("Catalog imports are missing from the bundled registry");

		const observed = await runRegistryProbe(
			[root, provider],
			`const catalog = await BUNDLED_PI_MODULE_LOADERS["@oh-my-pi/pi-catalog"]();
const providers = await BUNDLED_PI_MODULE_LOADERS["@oh-my-pi/pi-catalog/provider-models"]();
const result = await catalog.createModelManager(providers.anthropicModelManagerOptions()).refresh("offline");
export const observed = result.models.some(model => model.id === "claude-fable-5");`,
		);
		expect(observed).toBe(true);
	});

	it("loads catalog build exports through the bundled registry in compiled mode", async () => {
		const key = "@oh-my-pi/pi-catalog/build";
		const entry = bundledEntries.find(candidate => candidate.key === key);
		if (!entry) throw new Error("Catalog build import is missing from the bundled registry");

		const observed = await runRegistryProbe(
			[entry],
			`const { buildModel } = await BUNDLED_PI_MODULE_LOADERS[${JSON.stringify(key)}]();
export const observed = buildModel({
	id: "custom-model",
	name: "OpenAI: Sample (latest)",
	api: "openai-completions",
	provider: "custom",
	baseUrl: "https://api.example.com/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 8192,
}).name;`,
		);
		expect(observed).toBe("Sample");
		const overrides = __buildLegacyPiPackageRootOverrides(true, bundledModuleKeys);
		expect(overrides[key]).toBe(`omp-legacy-pi-bundled:${key}`);
	});

	it("expands web search provider wildcard exports for compiled plugin imports", () => {
		const overrides = __buildLegacyPiPackageRootOverrides(true, bundledModuleKeys);
		const providerKeys = [
			"tau/web/search/providers/xai",
			"tau/web/search/providers/tinyfish",
			"tau/web/search/providers/firecrawl",
			"tau/web/search/providers/duckduckgo",
		] as const;

		for (const key of providerKeys) {
			expect(bundledModuleKeys.has(key)).toBe(true);
			expect(overrides[key]).toBe(`tau-legacy-tau-bundled:${key}`);
		}
	});

	it("serves coding-agent registry wildcard exports in compiled mode", () => {
		const key = "tau/registry/agent-registry";
		const overrides = __buildLegacyPiPackageRootOverrides(true, bundledModuleKeys);
		expect(bundledModuleKeys.has(key)).toBe(true);
		expect(overrides[key]).toBe(`tau-legacy-tau-bundled:${key}`);
	});

<<<<<<< ours — scope `it("does not enumerate root catch-all wildcar...` in test_suite `legacy pi compat compiled-mode subpath overrides (issue #3442)` (S+F, confidence: low)
// refused_by: statement_fold · collision: `// pi-* files directly, so we keep those routed via `Bun.resolv…` +1 more
	it("does not enumerate root catch-all wildcards (./* / ./*.js)", () => {
		// Root `./*` / `./*.js` patterns would static-import top-level files
		// like the package's own `cli.ts` and explode the bundle through the
		// binary entry's transitive graph. Plugins almost never import top-level
		// tau-* files directly, so we keep those routed via `Bun.resolveSync`.
		// Concrete check: `tau/cli` is NOT bundled.
		expect(bundledModuleKeys.has("tau/cli")).toBe(false);
		expect(bundledModuleKeys.has("tau/main")).toBe(false);
=======
	it("keeps coding-agent's root catch-all wildcards (./* / ./*.js) out of the bundle", () => {
		// coding-agent exposes CLI entrypoints at the root; importing one from
		// the virtual registry would expand the binary entry's transitive graph.
		expect(bundledModuleKeys.has("@oh-my-pi/pi-coding-agent/cli")).toBe(false);
		expect(bundledModuleKeys.has("@oh-my-pi/pi-coding-agent/main")).toBe(false);
		expect(bundledModuleKeys.has("@oh-my-pi/pi-coding-agent/cli.js")).toBe(false);
		expect(bundledModuleKeys.has("@oh-my-pi/pi-coding-agent/main.js")).toBe(false);
>>>>>>> theirs — scope `it("does not enumerate root catch-all wildcar...`
	});

	it("does not bundle main-thread-unsafe worker entrypoints", () => {
		// Worker entry modules throw at top level unless `parentPort` exists.
		// The compiled legacy registry is imported on the main thread while
		// validating plugin extensions, so enumerating these files recreates the
		// `js worker-entry: missing parentPort` failure from #3508.
		expect(bundledModuleKeys.has("tau/eval/js/worker-entry")).toBe(false);
	});

	it("maps every bundled key (minus shimmed roots + typebox) to its virtual specifier in compiled mode", () => {
		const overrides = __buildLegacyPiPackageRootOverrides(true, bundledModuleKeys);
		const missing: string[] = [];
		for (const key of bundledModuleKeys) {
			// tau-ai/tau-coding-agent/tau-tui roots intentionally use the legacy compat
			// shims (they re-attach `Type`, `defineTool`, `decodeKittyPrintable`, etc.
			// dropped from the canonical package surfaces); typebox is served via
			// TYPEBOX_SHIM_PATH.
			if (
				key === "@tau/tau-ai" ||
				key === "tau" ||
				key === "@tau/tau-coding-agent" ||
				key === "@tau/tau-tui" ||
				key === "typebox"
			)
				continue;
			if (overrides[key] !== `tau-legacy-tau-bundled:${key}`) {
				missing.push(key);
			}
		}
		expect(missing).toEqual([]);
	});

<<<<<<< ours — scope `it("keeps pi-ai/pi-coding-agent/pi-tui roots ...` in test_suite `legacy pi compat compiled-mode subpath overrides (issue #3442)`, deleted in theirs (S+F, confidence: low)
// refused_by: statement_fold · collision: none (no common ancestor text)
	it("keeps tau-ai/tau-coding-agent/tau-tui roots routed to their compat shims in compiled mode", () => {
		// The shim entries themselves resolve to virtual bundled specifiers in
		// compiled mode (the shim files are bundled under their own registry
		// keys); the test asserts only that the roots stay distinct from the
		// canonical tau-* surface — extensions still see the `Type` /
		// `defineTool` helpers the canonical entrypoints dropped.
		const overrides = __buildLegacyPiPackageRootOverrides(true, bundledModuleKeys);
		expect(overrides["@tau/tau-ai"]).toBeDefined();
		expect(overrides["@tau/tau-ai"]).not.toBe("tau-legacy-tau-bundled:@tau/tau-ai/oauth");
		expect(overrides["tau"]).toBeDefined();
		expect(overrides["@tau/tau-tui"]).toBeDefined();
	});
=======
>>>>>>> theirs — scope `it("keeps pi-ai/pi-coding-agent/pi-tui roots ...` deleted in theirs

	it("does not register subpath overrides in dev/install mode", () => {
		const overrides = __buildLegacyPiPackageRootOverrides(false);
		expect(overrides).not.toHaveProperty("@tau/tau-ai/oauth");
		expect(overrides).not.toHaveProperty("tau/tools");
		// Dev keeps only the historical shim entries so canonical subpath
		// imports continue to flow through `Bun.resolveSync` against the live
		// monorepo / installed `node_modules` tree.
	});

	it("never emits a virtual specifier for typebox via the override map", () => {
		// typebox is routed through `TYPEBOX_SHIM_PATH` + a dedicated onResolve
		// hook; mirroring it in the override map would double-register and the
		// virtual loader would race the dedicated shim path.
		const overrides = __buildLegacyPiPackageRootOverrides(true, bundledModuleKeys);
		expect(overrides).not.toHaveProperty("typebox");
	});

	it("bundles nested wildcard subpaths so a compiled extension can import them", () => {
		// Node matches `*` in an `exports` pattern across `/`, so
		// `./slash-commands/*` genuinely serves
		// `slash-commands/helpers/active-oauth-account`. Enumerating only the
		// top level left every nested key out of the compiled registry, so the
		// import resolved from source and failed inside a binary — which is how
		// a real extension (`quota-hud.ts`) broke on this exact specifier.
<<<<<<< ours — scope `it("bundles nested wildcard subpaths so a com...` in test_suite `legacy pi compat compiled-mode subpath overrides (issue #3442)` (F, confidence: medium)
// refused_by: statement_fold · collision: `expect(bundledModuleKeys.has("@oh-my-pi/pi-tui/theme/defaults/i…`
		expect(bundledModuleKeys.has("tau/slash-commands/helpers/active-oauth-account")).toBe(true);
		// Directory index modules stay excluded: `./x/*` must not serve `x/y`
		// from `y/index.ts`, which Node would not resolve either.
		expect(bundledModuleKeys.has("@tau/tau-tui/theme/defaults/index")).toBe(false);
=======
		expect(bundledModuleKeys.has("@oh-my-pi/pi-coding-agent/slash-commands/helpers/active-oauth-account")).toBe(true);
>>>>>>> theirs — scope `it("bundles nested wildcard subpaths so a com...`
	});

<<<<<<< ours — scope `inserted statements` in test_suite `legacy pi compat compiled-mode subpath overrides (issue #3442)` (S+F, confidence: low)
// refused_by: statement_fold · collision: none (no common ancestor text)
	it("registers the rebranded package under its previously published name", () => {
		// The tau->tau rebrand renamed the coding-agent manifest to `tau`, but the
		// extension ecosystem still imports `tau` and the
		// runtime shim only ever looks up `@tau/*` keys (PI_PACKAGE_NAMES in
		// legacy-tau-compat.ts). Dropping the old name from the generated registry
		// made every such extension fail with
		// `tau:legacy-tau-shim: no bundled module registered for
		// tau`. Both names must map to the same bindings.
		const legacyPrefix = "tau";
		const canonicalPrefix = "tau";
		const legacySubpaths = bundledEntries
			.filter(entry => entry.key.startsWith(`${legacyPrefix}/`))
			.map(entry => entry.key.slice(legacyPrefix.length + 1));
		const canonicalSubpaths = bundledEntries
			.filter(entry => entry.key.startsWith(`${canonicalPrefix}/`))
			.map(entry => entry.key.slice(canonicalPrefix.length + 1));

		expect(bundledModuleKeys.has(legacyPrefix)).toBe(true);
		expect(legacySubpaths).toEqual(canonicalSubpaths);
		expect(legacySubpaths.length).toBeGreaterThan(0);

		// Alias keys load through the real package name, so a subpath that only
		// resolves under the new name can never be stranded by the rebrand.
		const byKey = new Map(bundledEntries.map(entry => [entry.key, entry]));
		for (const subpath of legacySubpaths) {
			const legacy = byKey.get(`${legacyPrefix}/${subpath}`);
			const canonical = byKey.get(`${canonicalPrefix}/${subpath}`);
			expect(legacy?.importSpecifier).toBe(`${canonicalPrefix}/${subpath}`);
			expect(legacy?.binding).toBe(canonical?.binding);
		}
		expect(byKey.get(legacyPrefix)?.binding).toBe(byKey.get(canonicalPrefix)?.binding);

		// The generated module emits one `const` per binding; an alias that
		// redeclared its shared binding would not parse.
		const source = __renderLegacyPiVirtualModule(bundledEntries);
		const declarations = source.split("\n").filter(line => line.startsWith("const "));
		expect(new Set(declarations).size).toBe(declarations.length);

		const overrides = __buildLegacyPiPackageRootOverrides(true, bundledModuleKeys);
		expect(overrides[`${legacyPrefix}/tools`]).toBe(`tau-legacy-tau-bundled:${legacyPrefix}/tools`);
=======
	it("loads pi-tui native/* modules through the bundled registry in compiled mode (issue #14834)", async () => {
		// `native/*` was only reachable through pi-tui's root `./*` catch-all, which
		// the generator skips, so extensions importing it failed inside the binary.
		const keys = ["@oh-my-pi/pi-tui/native/overlay", "@oh-my-pi/pi-tui/native/spans"] as const;
		const entries = bundledEntries.filter(entry => (keys as readonly string[]).includes(entry.key));
		expect(entries.map(entry => entry.key).sort()).toEqual([...keys]);

		const observed = await runRegistryProbe(
			entries,
			`const { actionBar, actionButton } = await BUNDLED_PI_MODULE_LOADERS["@oh-my-pi/pi-tui/native/overlay"]();
const { plainLine } = await BUNDLED_PI_MODULE_LOADERS["@oh-my-pi/pi-tui/native/spans"]();
export const observed = { role: actionBar([actionButton("Go", "go")]).p.role, line: plainLine("\\x1b[1ma\\n b\\x1b[0m") };`,
		);
		expect(observed).toEqual({ role: "omp.actions", line: "a b" });
		const overrides = __buildLegacyPiPackageRootOverrides(true, bundledModuleKeys);
		for (const key of keys) expect(overrides[key]).toBe(`omp-legacy-pi-bundled:${key}`);
	});

	it("serves pi-tui root-level, nested, and index spellings from the host graph (issue #15659)", async () => {
		// pi-tui's root `./*` catch-all and `x/index` spellings used to stay out of
		// the registry, so a compiled extension loaded those specifiers from its
		// own node_modules and saw a second `TERMINAL` / theme record.
		const keys = [
			"@oh-my-pi/pi-tui/terminal-capabilities",
			"@oh-my-pi/pi-tui/chat/svg-figure",
			"@oh-my-pi/pi-tui/theme",
			"@oh-my-pi/pi-tui/theme/index",
		] as const;
		const entries = bundledEntries.filter(entry => (keys as readonly string[]).includes(entry.key));
		expect(entries.map(entry => entry.key).sort()).toEqual([...keys].sort());

		const observed = await runRegistryProbe(
			entries,
			`const theme = await BUNDLED_PI_MODULE_LOADERS["@oh-my-pi/pi-tui/theme"]();
const themeIndex = await BUNDLED_PI_MODULE_LOADERS["@oh-my-pi/pi-tui/theme/index"]();
const svg = await BUNDLED_PI_MODULE_LOADERS["@oh-my-pi/pi-tui/chat/svg-figure"]();
const caps = await BUNDLED_PI_MODULE_LOADERS["@oh-my-pi/pi-tui/terminal-capabilities"]();
export const observed = {
	theme: theme.setThemeInstance === themeIndex.setThemeInstance,
	svg: typeof svg.svgFigurePalette,
	caps: typeof caps.setTerminalImageProtocol,
};`,
		);
		expect(observed).toEqual({ theme: true, svg: "function", caps: "function" });
		const overrides = __buildLegacyPiPackageRootOverrides(true, bundledModuleKeys);
		for (const key of keys) expect(overrides[key]).toBe(`omp-legacy-pi-bundled:${key}`);
>>>>>>> theirs — scope `inserted statements`
	});
});
