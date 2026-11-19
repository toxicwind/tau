#!/usr/bin/env bun
"use strict";
// throwaway: fix the mangled catch-branch escape + emoji in ranch generate-readme.ts
const p = "/home/toxic/pens/ranch/toolkit/generate-readme.ts";
let src = await Bun.file(p).text();
const bad = src.split("\n").find((l) => l.includes("not readable"));
if (!bad)
    throw new Error("catch line not found");
const good = '    md += `## \u{1f5c2}\u{fe0f} Components\\n\\n*(\\`.meta.yaml\\` not readable)*\\n\\n`;';
src = src.replace(bad, good);
await Bun.write(p, src);
console.log("fixed:", good);
