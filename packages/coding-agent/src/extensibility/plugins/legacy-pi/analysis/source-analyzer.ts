/**
 * Facade composing {@link AstParser} with the process-shared
 * {@link ExtensionParseCache} to produce an {@link ExtensionSourceAnalysis}
 * for a given source text.
 *
 * Two-level cache: an in-memory Map for the hot path, then the SQLite cache,
 * then a full Babel parse as the fallback. The in-memory key is the same
 * hash-shaped string as the persistent key, so a warm process never touches
 * disk for a source it has already seen.
 */
import * as path from "node:path";
import { AstParser } from "./ast-parser";
import { EXTENSION_PARSE_CACHE_SCHEMA_VERSION, ExtensionParseCache } from "./analysis-cache";
import type { ExtensionSourceAnalysis } from "../types";

/**
 * Derive the cache key for `source` at `importerPath`. Exposed so tests and
 * the persistent cache agree on the exact shape.
 */
export function extensionParseCacheKey(source: string, importerPath: string): string {
	return `${EXTENSION_PARSE_CACHE_SCHEMA_VERSION}:${path.extname(importerPath).toLowerCase()}:${Bun.hash(source).toString(16)}`;
}

/**
 * Analyze extension source files, memoized in-memory and (optionally) on
 * disk. The class owns the in-memory Map and delegates persistence to an
 * {@link ExtensionParseCache}.
 */
export class SourceAnalyzer {
	readonly #parser: AstParser;
	readonly #cache: ExtensionParseCache;
	readonly #memo = new Map<string, ExtensionSourceAnalysis>();

	constructor(parser: AstParser = new AstParser(), cache: ExtensionParseCache = new ExtensionParseCache()) {
		this.#parser = parser;
		this.#cache = cache;
	}

	/** The underlying AST parser, for callers that need raw parse results. */
	get parser(): AstParser {
		return this.#parser;
	}

	/** Whether the persistent cache opened successfully. */
	get persistentCacheAvailable(): boolean {
		return this.#cache.available;
	}

	/**
	 * Return the analysis for `source`. Checks the in-memory Map, then the
	 * persistent cache, then parses. On a parse, both caches are populated.
	 */
	analyze(source: string, importerPath: string): ExtensionSourceAnalysis {
		const cacheKey = extensionParseCacheKey(source, importerPath);
		const memoized = this.#memo.get(cacheKey);
		if (memoized) return memoized;

		const persisted = this.#cache.get(cacheKey);
		if (persisted) {
			this.#memo.set(cacheKey, persisted);
			return persisted;
		}

		const ast = this.#parser.parse(source, importerPath);
		const sourceType = ast.program.sourceType;
		const analysis: ExtensionSourceAnalysis = {
			sourceType,
			references: this.#parser.collectSpecifierReferences(source, importerPath, ast),
			hasCommonJsSyntax: sourceType === "script" && this.#parser.hasCommonJsSyntax(ast),
		};
		this.#memo.set(cacheKey, analysis);
		this.#cache.set(cacheKey, analysis);
		return analysis;
	}
}
