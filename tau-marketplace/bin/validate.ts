import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

interface PluginEntry {
  name: string;
  version: string;
  description: string;
  category: string;
  tags?: string[];
  source: string;
  homepage?: string;
  license?: string;
}

interface MarketplaceCatalog {
  $schema?: string;
  name: string;
  owner: { name: string; email?: string };
  metadata?: { description?: string; version?: string; homepage?: string };
  plugins: PluginEntry[];
}

const rootDir = resolve(import.meta.dir, "..");
const catalogPath = join(rootDir, "marketplace.json");

console.log("=== TAU MARKETPLACE VALIDATOR ===");
console.log(`Root: ${rootDir}`);
console.log(`Catalog: ${catalogPath}\n`);

if (!existsSync(catalogPath)) {
  console.error("FAIL: marketplace.json not found!");
  process.exit(1);
}

let catalog: MarketplaceCatalog;
try {
  catalog = JSON.parse(readFileSync(catalogPath, "utf-8"));
} catch (err) {
  console.error(`FAIL: Could not parse marketplace.json: ${err}`);
  process.exit(1);
}

if (!catalog.name || !catalog.owner?.name || !Array.isArray(catalog.plugins)) {
  console.error("FAIL: marketplace.json missing required top-level fields (name, owner.name, plugins array)");
  process.exit(1);
}

console.log(`Marketplace: "${catalog.name}" (version ${catalog.metadata?.version || "1.0.0"})`);
console.log(`Owner: ${catalog.owner.name}`);
console.log(`Plugins declared: ${catalog.plugins.length}\n`);

let passedCount = 0;
let failedCount = 0;

for (const plugin of catalog.plugins) {
  const pluginDir = resolve(rootDir, plugin.source);
  const exists = existsSync(pluginDir);

  if (!exists) {
    console.error(`[FAIL] ${plugin.name} -> source directory missing: ${pluginDir}`);
    failedCount++;
    continue;
  }

  // Check for entry point (index.ts, src/extension.ts, or package.json)
  const candidateEntries = [
    join(pluginDir, "index.ts"),
    join(pluginDir, "src", "extension.ts"),
    join(pluginDir, "src", "index.ts"),
  ];

  const entryExists = candidateEntries.some(p => existsSync(p));
  if (!entryExists) {
    console.error(`[FAIL] ${plugin.name} -> no entrypoint found in ${pluginDir}`);
    failedCount++;
    continue;
  }

  const pkgJsonPath = join(pluginDir, "package.json");
  const hasPkg = existsSync(pkgJsonPath);

  console.log(`[PASS] ${plugin.name} (v${plugin.version})`);
  console.log(`       Category: ${plugin.category} | Tags: [${plugin.tags?.join(", ") || "none"}]`);
  console.log(`       Source: ${plugin.source} (manifest: ${hasPkg ? "yes" : "no"})`);
  passedCount++;
}

console.log(`\nValidation complete: ${passedCount} passed, ${failedCount} failed.`);
if (failedCount > 0) {
  process.exit(1);
}
console.log("ALL MARKETPLACE PLUGINS VALID!");
