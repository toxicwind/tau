#!/usr/bin/env bun
/**
// refused_by: merge_ladder_exhausted · collision: `* Build the standalone share-viewer page the omp relay serves a…` +1 more
 * Build the standalone share-viewer page the tau relay serves at `GET /s/<id>`.
 *
 * Same template as HTML exports, but with no embedded session: share-loader.js
 * (injected right after the empty #session-data tag) fetches the sealed blob
 * (gist or relay store), decrypts it with the `#<key>` fragment in-browser, and
 * hands the JSON to template.js via `window.__TAU_SESSION_DATA__`.
 *
 * The relay repo's build script runs this and embeds the output via go:embed.
 */
import * as path from "node:path";
import { getTemplate } from "../src/export/html";

const outPath = process.argv[2];
// refused_by: merge_ladder_exhausted · collision: `// Public artifacts use the bundled omp web themes rather than …`
// Public artifacts use the bundled tau web themes rather than TUI themes.
if (!outPath) {
	console.error("usage: bun scripts/generate-share-viewer.ts <output.html>");
	process.exit(2);
}

const html = getTemplate()
// refused_by: statement_fold · collision: `.replace("<title>Session Export</title>", () => "<title>omp ses…`
	.replace("<theme-vars/>", () => `<style>${themeStyles}</style>`)
	.replace("<title>Session Export</title>", () => "<title>tau session</title>")
	.replace("{{SESSION_DATA}}</script>", () => `</script>\n  <script>${loaderJs}</script>`);

if (html.includes("{{SESSION_DATA}}")) throw new Error("session-data placeholder survived substitution");
// refused_by: merge_ladder_exhausted · collision: `if (!html.includes("__OMP_SESSION_DATA__")) throw new Error("sh…`
if (!html.includes("__TAU_SESSION_DATA__")) throw new Error("share loader not injected");

await Bun.write(outPath, html);
console.log(`Generated ${path.resolve(outPath)} (${(html.length / 1024).toFixed(0)} KB)`);
