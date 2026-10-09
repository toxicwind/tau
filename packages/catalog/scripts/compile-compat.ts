/**
 * `bun run gen:compat` — compiles `src/compat/rules/` into
 * `src/compat/rules.json`, the committed compiled form the runtime engine
 * imports. Mirrors the models.json discipline: deterministic output,
 * regenerate + commit together with rule changes.
 *
 * `rules.json` carries the KDL-compiled providers; provider ids sourced from
 * `@ranch/roost` (see `src/compat/roost.ts`) are merged in for
 * `provider-ids.ts` so `KnownProvider` covers every catalog provider.
 */
import * as path from "node:path";
import { ROOST_PROVIDER_IDS, roostProviderEntries } from "../src/compat/roost";
import type { CompiledProvider } from "../src/compat/types";
import { compileCompatRules, renderAuthIds, renderProviderIds } from "./compat-compiler";

const rulesDir = path.join(import.meta.dir, "../src/compat/rules");
const outPath = path.join(import.meta.dir, "../src/compat/rules.json");
const authIdsPath = path.join(import.meta.dir, "../src/compat/auth-ids.ts");
const providerIdsPath = path.join(import.meta.dir, "../src/compat/provider-ids.ts");

const compiled = await compileCompatRules(rulesDir);
// Resolve roost BEFORE any writes: roostProviderEntries() is the fallible step
// (module resolution + drift checks), and writing outputs first would leave a
// partially updated tree (fresh rules.json, stale provider-ids.ts) on failure.
const roostEntries = roostProviderEntries();
await Bun.write(outPath, JSON.stringify(compiled));
await Bun.write(authIdsPath, renderAuthIds(compiled.auth));
// KnownProvider is the union of KDL-compiled and roost-sourced catalog
// provider ids — roost is the data authority for its providers.
const providersForIds: Record<string, CompiledProvider> = { ...compiled.providers };
for (const [id, entry] of Object.entries(roostEntries)) providersForIds[id] = entry;
await Bun.write(providerIdsPath, renderProviderIds(providersForIds));
console.log(
	`wrote ${path.relative(process.cwd(), outPath)} (${compiled.cascade.rules.length} rules, ${compiled.taxonomy.classes.length} classes, ${Object.keys(providersForIds).length} catalog providers (${ROOST_PROVIDER_IDS.length} roost-sourced), ${compiled.auth.providers.length} auth providers, ${compiled.files.length} files)`,
);
