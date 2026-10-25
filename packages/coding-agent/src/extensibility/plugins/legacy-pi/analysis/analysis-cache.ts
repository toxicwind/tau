/**
 * SQLite-backed persistent cache for extension source analyses.
 *
 * The cache is keyed by a hash of the source text plus the file extension,
 * so identical content in different extensions gets distinct entries. It is
 * versioned by `EXTENSION_PARSE_CACHE_SCHEMA_VERSION`; bumping the version
 * drops the table and starts fresh.
 *
 * Connection acquisition is lazy: {@link ExtensionParseCache} opens the DB on
 * first use and tolerates failure by disabling itself for the process. This
 * mirrors the monolith's behavior so a broken cache path never crashes tau.
 */
import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { getDbBusyTimeoutMs, getLegacyPiExtensionCacheDbPath, logger } from "@tau/tau-utils";
import type { ExtensionSourceAnalysis, ExtensionSpecifierReference } from "../types";

/** Bump to force the whole cache to rebuild on next open. */
export const EXTENSION_PARSE_CACHE_SCHEMA_VERSION = 3;

const CREATE_EXTENSION_PARSE_CACHE_TABLE =
	"CREATE TABLE IF NOT EXISTS extension_parse_cache (cache_key TEXT PRIMARY KEY, source_type TEXT NOT NULL, [references] TEXT NOT NULL, commonjs_syntax INTEGER NOT NULL)";
const EXTENSION_PARSE_CACHE_MAX_BYTES = 8 * 1024 * 1024;
const EXTENSION_PARSE_CACHE_MAX_ENTRIES = 10_000;

interface ExtensionParseCacheRow {
	source_type: "script" | "module";
	references: string;
	commonjs_syntax: number;
}

function parseCachedAnalysis(row: ExtensionParseCacheRow): ExtensionSourceAnalysis | null {
	try {
		if (row.source_type !== "script" && row.source_type !== "module") return null;
		const references = JSON.parse(row.references) as unknown;
		if (
			!Array.isArray(references) ||
			!references.every(
				reference =>
					reference &&
					typeof reference === "object" &&
					(reference.kind === "import" || reference.kind === "require") &&
					typeof reference.specifier === "string" &&
					typeof reference.start === "number" &&
					typeof reference.end === "number",
			)
		) {
			return null;
		}
		return {
			sourceType: row.source_type,
			references: references as ExtensionSpecifierReference[],
			hasCommonJsSyntax: row.commonjs_syntax === 1,
		};
	} catch {
		return null;
	}
}

/**
 * Persistent, process-shared cache for extension source analyses.
 *
 * One instance per process is sufficient; the DB connection is shared by
 * construction, not by singleton accessor, so tests can build isolated
 * instances against a temp path if needed.
 */
export class ExtensionParseCache {
	readonly #db: Database | null;

	readonly #cachePath: string;

	constructor(cachePath: string = getLegacyPiExtensionCacheDbPath()) {
		this.#cachePath = cachePath;
		this.#db = this.#open(cachePath);
	}

	/** Whether the underlying DB opened successfully. */
	get available(): boolean {
		return this.#db !== null;
	}

	/**
	 * Look up a previously stored analysis. Returns `null` on miss, on a
	 * malformed row, or when the cache is disabled.
	 */
	get(cacheKey: string): ExtensionSourceAnalysis | null {
		const db = this.#db;
		if (!db) return null;
		try {
			const row = db
				.query<ExtensionParseCacheRow, [string]>(
					"SELECT source_type, [references], commonjs_syntax FROM extension_parse_cache WHERE cache_key = ?",
				)
				.get(cacheKey);
			return row ? parseCachedAnalysis(row) : null;
		} catch (error) {
			logger.debug("legacy Pi extension parse cache read failed", {
				error: error instanceof Error ? error.message : String(error),
			});
			return null;
		}
	}

	/**
	 * Store an analysis. Fire-and-forget: the write is deferred to a microtask
	 * so a caller's synchronous hot path is never blocked on disk I/O. Errors
	 * are logged at debug and otherwise swallowed.
	 */
	set(cacheKey: string, analysis: ExtensionSourceAnalysis): void {
		void Promise.resolve()
			.then(() => {
				const db = this.#db;
				if (!db) return;
				db.run(
					"INSERT OR REPLACE INTO extension_parse_cache (cache_key, source_type, [references], commonjs_syntax) VALUES (?, ?, ?, ?)",
					[cacheKey, analysis.sourceType, JSON.stringify(analysis.references), analysis.hasCommonJsSyntax ? 1 : 0],
				);
				const count =
					db.query<{ count: number }, []>("SELECT count(*) AS count FROM extension_parse_cache").get()?.count ?? 0;
				if (count > EXTENSION_PARSE_CACHE_MAX_ENTRIES) {
					db.run("DELETE FROM extension_parse_cache");
				}
			})
			.catch(error => {
				logger.debug("legacy Pi extension parse cache write failed", {
					error: error instanceof Error ? error.message : String(error),
				});
			});
	}

	#open(cachePath: string): Database | null {
		try {
			try {
				if (fs.statSync(cachePath).size > EXTENSION_PARSE_CACHE_MAX_BYTES) {
					// Remove the full WAL set, not just the main db. A leftover
					// `-wal`/`-shm` pair still owned by a concurrent tau process is
					// adopted by this fresh connection; when that `-wal` has
					// uncheckpointed frames (the normal case while another tau is
					// writing its own cache entries), `journal_mode=WAL` fails with
					// SQLITE_IOERR — disabling the parse cache for the whole process
					// and forcing a reparse of every extension on startup. See #9549.
					for (const suffix of ["", "-wal", "-shm"]) {
						fs.rmSync(`${cachePath}${suffix}`, { force: true });
					}
				}
			} catch {
				// A missing or unreadable cache is a cold cache.
			}
			fs.mkdirSync(path.dirname(cachePath), { recursive: true });
			const db = new Database(cachePath, { create: true });
			// Install the busy handler BEFORE any lock-taking statement (incl.
			// `PRAGMA journal_mode=WAL`, which takes an exclusive lock during WAL
			// recovery). See #2421. WAL + synchronous=NORMAL avoids the per-entry
			// journal create/delete + fsync churn that serialized this cache behind
			// concurrent tau startups and blocked the event loop for ~20s (#9549).
			db.run(`PRAGMA busy_timeout = ${getDbBusyTimeoutMs()}`);
			db.run("PRAGMA journal_mode=WAL");
			db.run("PRAGMA synchronous=NORMAL");
			const schemaVersion = db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0;
			if (schemaVersion === EXTENSION_PARSE_CACHE_SCHEMA_VERSION) {
				db.run(CREATE_EXTENSION_PARSE_CACHE_TABLE);
			} else {
				db.transaction(() => {
					db.run("DROP TABLE IF EXISTS extension_parse_cache");
					db.run(CREATE_EXTENSION_PARSE_CACHE_TABLE);
					db.run(`PRAGMA user_version = ${EXTENSION_PARSE_CACHE_SCHEMA_VERSION}`);
				})();
			}
			return db;
		} catch (error) {
			logger.debug("legacy Pi extension parse cache unavailable", {
				error: error instanceof Error ? error.message : String(error),
			});
			return null;
		}
	}
}
