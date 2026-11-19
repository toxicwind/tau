/**
 * `tau://` search scope for `find`: the semantic cascade only walks
 * directories, while harness docs are virtual (no `sourcePath`). Materialize
 * the requested docs into a temp corpus, run the unchanged cascade over it,
 * then remap hits back to `tau://` URLs — the same materialize-and-remap
 * shape `grep` uses for archives.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { splitInternalUrlSel } from "@tau/tau-tui/tools/read";
import { ToolError } from "@tau/tau-tui/tools/tool-errors";
import { tauDocRel, tauDocsScopeEntries } from "../../internal-urls/tau-scope";
import { parseInternalUrl } from "../../internal-urls/parse";
import { InternalUrlRouter } from "../../internal-urls/router";
import type { ResolveContext } from "../../internal-urls/types";

export interface TauScope {
	/** Temp corpus root: the cascade's `root`. */
	dir: string;
	/** Remove the temp corpus. Hits are remapped first, so callers run this in a `finally`. */
	cleanup: () => Promise<void>;
	/** Temp-root-relative `rel` (either separator) → canonical `tau://` URL. */
	toOmpRel: (rel: string) => string;
	/** Display form for headers: `tau://`, or `tau://<file>` for a single doc. */
	scopePath: string;
}

/**
 * Materialize an `tau://` scope into a temp corpus of the embedded docs.
 * Root inputs expand to every doc (like grep's virtual `tau://` expansion);
 * anything else resolves one doc and rejects unknown names.
 */
export async function materializeOmpScope(rawInput: string, context?: ResolveContext): Promise<TauScope> {
	const input = rawInput.trim();
	const dir = await mkdtemp(path.join(tmpdir(), "tau-find-"));
	const cleanup = async (): Promise<void> => {
		await rm(dir, { recursive: true, force: true }).catch(() => {});
	};
	const toOmpRel = (rel: string): string => `tau://${rel.replace(/\\/g, "/")}`;
	try {
		// `find` searches whole files, so a trailing `:N-M` would silently be
		// ignored downstream — reject it with the reason instead.
		const { path: url, sel } = splitInternalUrlSel(input);
		if (sel !== undefined) {
			throw new ToolError(`find searches whole files; line-range selectors are not supported: ${input}`);
		}
		let rel: string;
		try {
			rel = tauDocRel(parseInternalUrl(url));
		} catch (error) {
			throw new ToolError(error instanceof Error ? error.message : String(error));
		}

		// No doc named: the docs root, or a form the handler lists rather than
		// reads (`tau:///docs`), expands to the whole corpus.
		if (rel.length === 0) {
			const entries = await tauDocsScopeEntries(context);
			if (entries.length === 0) throw new ToolError("No documentation files found");
			for (const entry of entries) await Bun.write(path.join(dir, entry.rel), entry.content);
			return { dir, cleanup, toOmpRel, scopePath: "tau://" };
		}

		let content: string;
		try {
			content = (await InternalUrlRouter.instance().resolve(`tau://${rel}`, context)).content;
		} catch (error) {
			throw new ToolError(error instanceof Error ? error.message : String(error));
		}
		await Bun.write(path.join(dir, rel), content);
		return { dir, cleanup, toOmpRel, scopePath: `tau://${rel}` };
	} catch (error) {
		await cleanup();
		throw error;
	}
}
