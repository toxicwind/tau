#!/usr/bin/env bun
/**
<<<<<<< ours — interstitial `file_header` (T+S+F, confidence: low)
// refused_by: merge_ladder_exhausted · collision: `* Build the standalone share-viewer page the omp relay serves a…` +1 more
 * Build the standalone share-viewer page the tau relay serves at `GET /s/<id>`.
 *
 * Same template as HTML exports, but with no embedded session: share-loader.js
 * (injected right after the empty #session-data tag) fetches the sealed blob
 * (gist or relay store), decrypts it with the `#<key>` fragment in-browser, and
 * hands the JSON to template.js via `window.__TAU_SESSION_DATA__`.
 *
 * The relay repo's build script runs this and embeds the output via go:embed.
=======
 * Build the slim share page the omp relay serves at `GET /s/<id>`.
 * The pinned viewer fetches and decrypts the blob using the URL fragment key.
>>>>>>> theirs — interstitial `file_header` (T+S+F, confidence: low) · weave: run 'weave explain packages/coding-agent/scripts/generate-share-viewer.ts' for per-hunk detail, 'weave check' to verify your resolution
 */
import * as path from "node:path";
import { getTemplate } from "../src/export/html";

const outPath = process.argv[2];
<<<<<<< ours — interstitial `between:packages/coding-agent/scripts/generate-share-viewer.ts::variable::loaderJs:packages/coding-agent/scripts/generate-share-viewer.ts::variable::themeStyles` (T, confidence: high)
// refused_by: merge_ladder_exhausted · collision: `// Public artifacts use the bundled omp web themes rather than …`
// Public artifacts use the bundled tau web themes rather than TUI themes.
=======
>>>>>>> theirs — interstitial `between:packages/coding-agent/scripts/generate-share-viewer.ts::variable::loaderJs:packages/coding-agent/scripts/generate-share-viewer.ts::variable::themeStyles` (T, confidence: high)
if (!outPath) {
	console.error("usage: bun scripts/generate-share-viewer.ts <output.html>");
	process.exit(2);
}

const html = getTemplate()
<<<<<<< ours — scope `const html = getTemplate()` in variable `html` (F, confidence: medium)
// refused_by: statement_fold · collision: `.replace("<title>Session Export</title>", () => "<title>omp ses…`
	.replace("<theme-vars/>", () => `<style>${themeStyles}</style>`)
	.replace("<title>Session Export</title>", () => "<title>tau session</title>")
	.replace("{{SESSION_DATA}}</script>", () => `</script>\n  <script>${loaderJs}</script>`);
=======
	.replace("<theme-vars/>", "")
	.replace("<title>Session Export</title>", "<title>omp session</title>")
	.replace(
		'<script id="session-data" type="application/json">{{SESSION_DATA}}</script>',
		'<script id="session-data" type="application/json" data-source="share"></script>',
	);
>>>>>>> theirs — scope `const html = getTemplate()`

if (html.includes("{{SESSION_DATA}}")) throw new Error("session-data placeholder survived substitution");
<<<<<<< ours — interstitial `file_footer` (F, confidence: medium)
// refused_by: merge_ladder_exhausted · collision: `if (!html.includes("__OMP_SESSION_DATA__")) throw new Error("sh…`
if (!html.includes("__TAU_SESSION_DATA__")) throw new Error("share loader not injected");
=======
>>>>>>> theirs — interstitial `file_footer` (F, confidence: medium)

await Bun.write(outPath, html);
console.log(`Generated ${path.resolve(outPath)} (${(html.length / 1024).toFixed(0)} KB)`);
