import { describe, expect, test } from "bun:test";
import { AstParser } from "./ast-parser";
import { ExtensionParseCache } from "./analysis-cache";
import { extensionParseCacheKey, SourceAnalyzer } from "./source-analyzer";

const makeAnalyzer = () =>
	new SourceAnalyzer(new AstParser(), new ExtensionParseCache(":memory:"));

describe("extensionParseCacheKey", () => {
	test("is deterministic for the same source and extension", () => {
		expect(extensionParseCacheKey("const x = 1;", "a.ts")).toBe(extensionParseCacheKey("const x = 1;", "a.ts"));
	});

	test("differs for different source text", () => {
		expect(extensionParseCacheKey("const x = 1;", "a.ts")).not.toBe(extensionParseCacheKey("const x = 2;", "a.ts"));
	});

	test("differs for different extensions with the same source", () => {
		expect(extensionParseCacheKey("const x = 1;", "a.ts")).not.toBe(extensionParseCacheKey("const x = 1;", "a.tsx"));
	});

	test("is prefixed with the schema version", () => {
		expect(extensionParseCacheKey("x", "a.ts")).toMatch(/^\d+:/);
	});
});

describe("SourceAnalyzer.analyze", () => {
	test("returns script sourceType for CommonJS source", () => {
		const result = makeAnalyzer().analyze('const x = require("foo");', "test.cjs");
		expect(result.sourceType).toBe("script");
		expect(result.hasCommonJsSyntax).toBe(true);
	});

	test("returns module sourceType for ESM source", () => {
		const result = makeAnalyzer().analyze('import x from "foo";', "test.ts");
		expect(result.sourceType).toBe("module");
		expect(result.hasCommonJsSyntax).toBe(false);
	});

	test("never reports hasCommonJsSyntax for a module source", () => {
		const result = makeAnalyzer().analyze("module.exports = {}; export {};", "test.ts");
		expect(result.sourceType).toBe("module");
		expect(result.hasCommonJsSyntax).toBe(false);
	});

	test("memoizes identical source in the in-memory map", () => {
		const a = makeAnalyzer();
		const first = a.analyze("const x = 1;", "a.ts");
		const second = a.analyze("const x = 1;", "a.ts");
		expect(second).toBe(first);
	});

	test("survives a fresh analyzer via the persistent cache", () => {
		const cache = new ExtensionParseCache(":memory:");
		const first = new SourceAnalyzer(new AstParser(), cache).analyze("const y = 2;", "b.ts");
		const second = new SourceAnalyzer(new AstParser(), cache).analyze("const y = 2;", "b.ts");
		expect(second).toEqual(first);
	});

	test("exposes the underlying parser", () => {
		expect(makeAnalyzer().parser).toBeInstanceOf(AstParser);
	});

	test("reports persistentCacheAvailable=true with an in-memory DB", () => {
		expect(makeAnalyzer().persistentCacheAvailable).toBe(true);
	});
});

describe("ExtensionParseCache", () => {
	test("get() returns null for an unknown key", () => {
		expect(new ExtensionParseCache(":memory:").get("nonexistent")).toBeNull();
	});

	test("set() then get() round-trips an analysis", async () => {
		const cache = new ExtensionParseCache(":memory:");
		const analysis = {
			sourceType: "module" as const,
			references: [{ kind: "import" as const, specifier: "foo", start: 0, end: 5 }],
			hasCommonJsSyntax: false,
		};
		cache.set("k", analysis);
		await new Promise(r => setTimeout(r, 0));
		expect(cache.get("k")).toEqual(analysis);
	});

	test("available is true for the in-memory DB", () => {
		expect(new ExtensionParseCache(":memory:").available).toBe(true);
	});
});
