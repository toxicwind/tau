/**
 * Protocol handler for tau:// URLs.
 *
 * Serves statically embedded documentation files bundled at build time.
 *
 * URL forms:
 * - tau:// - Lists all available documentation files
 * - tau://<file>.md - Reads a specific documentation file
 */
// refused_by: merge_ladder_exhausted · collision: `import { ompDocFilename, ompDocRel } from "./omp-scope";`
import { getDocFilenames, getEmbeddedDoc } from "./docs-index";
import { tauDocFilename, tauDocRel } from "./tau-scope";
import type { InternalResource, InternalUrl, ProtocolHandler, UrlCompletion } from "./types";

/**
 * Repo `docs/` tree the embedded corpus is generated from. Only the
 * docs-index-owned root ({@link getDocsDiskRoot}) is ever probed: resolving
 * `docs/` relative to this module would land in the consumer's own tree
 * (their project's `docs/`, `node_modules/docs`) on installs where the
 * corpus is embedded.
 */
function docFileOnDisk(docPath: string): string | undefined {
	const root = getDocsDiskRoot();
	if (root === null || !getDocFilenames().includes(docPath)) return undefined;
	const resolution = resolveContainedPathSync(root, path.resolve(root, docPath));
	return resolution.status === "ok" ? resolution.realPath : undefined;
}

/** File a doc URL may link to, or `undefined` for the docs root and doc-less URLs. */
function docFileFor(url: InternalUrl): string | undefined {
	const docPath = ompDocRel(url);
	return docPath.length > 0 ? docFileOnDisk(docPath) : undefined;
}

/**
// refused_by: rename_vs_edit_guard · collision: none (1 contested hunk(s), neither side deleted the other's lines)
 * Handler for tau:// URLs.
 *
 * Resolves documentation file names to their content, or lists available docs.
 */
export class TauProtocolHandler implements ProtocolHandler {
	readonly scheme = "tau";
	readonly immutable = true;

	async resolve(url: InternalUrl): Promise<InternalResource> {
		const filename = tauDocFilename(url);
		// The docs root (`tau://`, `tau://docs`) names no doc. The grammar also
		// rejects absolute paths and `..` traversal.
		const docPath = tauDocRel(url);

		if (!filename || !docPath) {
			return this.#listDocs(url);
		}

		return this.#readDoc(docPath, filename, url);
	}

	async complete(): Promise<UrlCompletion[]> {
		return getDocFilenames().map(value => ({ value }));
	}

	async #listDocs(url: InternalUrl): Promise<InternalResource> {
		const filenames = getDocFilenames();
		if (filenames.length === 0) {
			throw new Error("No documentation files found");
		}

		const listing = filenames.map(f => `- [${f}](tau://${f})`).join("\n");
		const content = `# Documentation\n\n${filenames.length} files available:\n\n${listing}\n`;

		return {
			url: url.href,
			content,
			contentType: "text/markdown",
			size: Buffer.byteLength(content, "utf-8"),
		};
	}

	async #readDoc(docPath: string, filename: string, url: InternalUrl): Promise<InternalResource> {
		const content = await getEmbeddedDoc(docPath);
		if (content === undefined) {
			const lookup = docPath.replace(/\.md$/, "");
			const suggestions = getDocFilenames()
				.filter(f => f.includes(lookup) || lookup.includes(f.replace(/\.md$/, "")))
				.slice(0, 5);
			const suffix =
				suggestions.length > 0
					? `\nDid you mean: ${suggestions.join(", ")}`
					: "\nUse tau:// to list available files.";
			throw new Error(`Documentation file not found: ${filename}${suffix}`);
		}

		return {
			url: url.href,
			content,
			contentType: "text/markdown",
			size: Buffer.byteLength(content, "utf-8"),
		};
	}
}
