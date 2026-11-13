// coercion-viewer — aesthetic dark browser daemon for the coercion layer
// Serves a tabbed HTML view of omp vs tau coercion files + the comparison.
// Run: bun coercion-viewer.ts  → http://0.0.0.0:25250
import { readFileSync, existsSync } from "node:fs";

const PORT = 25250;
const OMP = "/home/toxic/pens/ranch/products/oh-my-pi/packages/ai/src";
const TAU = "/home/toxic/pens/olympus/products/tau/packages/ai/src";
const CMP = "/home/toxic/pens/recon/products/iptv-provider-recon/audits/coercion-compare.md";

const files = [
	{ id: "cmp", label: "Comparison", path: CMP, lang: "md" },
	{ id: "coercion-omp", label: "coercion.ts (omp)", path: OMP + "/dialect/coercion.ts", lang: "ts" },
	{ id: "coercion-tau", label: "coercion.ts (tau)", path: TAU + "/dialect/coercion.ts", lang: "ts" },
	{ id: "freeinf", label: "freeinference-coercion", path: TAU + "/dialect/freeinference-coercion.ts", lang: "ts" },
	{ id: "deepseek", label: "deepseek.ts", path: TAU + "/dialect/deepseek.ts", lang: "ts" },
	{ id: "openrouter", label: "openrouter-coercion", path: TAU + "/providers/openrouter-coercion.ts", lang: "ts" },
	{ id: "groq", label: "groq-coercion", path: TAU + "/providers/groq-coercion.ts", lang: "ts" },
	{ id: "ernie", label: "ernie-coercion (new)", path: TAU + "/dialect/ernie-coercion.ts", lang: "ts" },
];

function load(f) {
	try { return existsSync(f.path) ? readFileSync(f.path, "utf8") : "// NOT FOUND: " + f.path; }
	catch (e) { return "// ERR: " + e.message; }
}

function esc(s) { return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

// very small tokenizer for TS/JS-ish highlighting
function hl(code, lang) {
	if (lang === "md") return esc(code); // markdown left raw-ish in <pre>
	let s = esc(code);
	// keywords (word-boundary) — apply on escaped text, avoid tags
	s = s.replace(/\b(import|from|export|const|let|function|return|if|else|for|while|class|extends|new|this|type|interface|implements|async|await|as|of|in|typeof|instanceof|try|catch|finally|throw|switch|case|break|continue|default|void|null|undefined|true|false)\b/g, '<span class="k">$1</span>');
	// comments
	s = s.replace(/(\/\/[^\n]*)/g, '<span class="c">$1</span>');
	s = s.replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="c">$1</span>');
	// numbers
	s = s.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="n">$1</span>');
	return s;
}

const tabs = files.map((f, i) => `<button class="tab${i===0?' active':''}" data-id="${f.id}">${esc(f.label)}</button>`).join("");
const panels = files.map((f, i) => {
	const code = load(f);
	const lines = code.split("\n").length;
 return `<div class="panel${i===0?' active':''}" id="p-${f.id}">
   <div class="bar"><span class="file">${esc(f.label)}</span><span class="meta">${lines} lines · ${esc(f.path)}</span></div>
   <pre class="code">${hl(code, f.lang)}</pre>
 </div>`;
}).join("");

const html = `<!doctype html><html><head><meta charset="utf-8">
<title>coercion layer — omp vs tau</title>
<style>
:root{--bg:#0d1117;--panel:#161b22;--border:#30363d;--fg:#c9d1d9;--mut:#8b949e;--acc:#58a6ff;--k:#ff7b72;--s:#a5d6ff;--c:#8b949e;--n:#79c0ff;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace}
header{padding:14px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:16px;background:var(--panel);position:sticky;top:0;z-index:5}
header h1{font-size:15px;margin:0;font-weight:600;color:var(--fg)}
header h1 .dim{color:var(--mut);font-weight:400}
.tabs{display:flex;gap:4px;flex-wrap:wrap;padding:10px 20px;border-bottom:1px solid var(--border);background:var(--panel);position:sticky;top:52px;z-index:4}
.tab{background:transparent;border:1px solid var(--border);color:var(--mut);padding:6px 12px;border-radius:6px;cursor:pointer;font:inherit}
.tab:hover{color:var(--fg);border-color:var(--acc)}
.tab.active{background:var(--acc);color:#0d1117;border-color:var(--acc);font-weight:600}
.panel{display:none;padding:0 20px 40px}
.panel.active{display:block}
.bar{display:flex;justify-content:space-between;align-items:baseline;padding:14px 0 8px;position:sticky;top:102px;background:var(--bg);z-index:3}
.bar .file{color:var(--acc);font-weight:600}
.bar .meta{color:var(--mut);font-size:11px}
pre.code{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:16px 18px;overflow:auto;margin:0;font:12.5px/1.5 ui-monospace,monospace;tab-size:2}
.k{color:var(--k)}.s{color:var(--s)}.c{color:var(--c);font-style:italic}.n{color:var(--n)}
</style></head><body>
<header><h1>coercion layer <span class="dim">— omp vs tau</span></h1><span class="dim" style="color:var(--mut)">${new Date().toISOString().slice(0,16)}Z · port ${PORT}</span></header>
<div class="tabs">${tabs}</div>
${panels}
<script>
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active'));
  t.classList.add('active');
  document.getElementById('p-'+t.dataset.id).classList.add('active');
  window.scrollTo(0,0);
});
</script>
</body></html>`;

Bun.serve({ port: PORT, hostname: "0.0.0.0", fetch() { return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }); } });
console.log("coercion-viewer on http://0.0.0.0:" + PORT);