/**
 * Protocol handler for tau:// URLs.
 *
 * Serves statically embedded documentation files bundled at build time.
 *
 * URL forms:
 * - tau:// - Lists all available documentation files
 * - tau://<file>.md - Reads a specific documentation file
 */
import { getDocFilenames, getEmbeddedDoc } from "./docs-index";
import { tauDocFilename, tauDocRel } from "./tau-scope";
import type { InternalResource, InternalUrl, ProtocolHandler, UrlCompletion } from "./types";

/**
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
