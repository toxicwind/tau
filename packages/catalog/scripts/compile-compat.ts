/**
 * `bun run gen:compat` — compiles `src/compat/rules/` into
 * `src/compat/rules.json`, the committed compiled form the runtime engine
 * imports. Mirrors the models.json discipline: deterministic output,
 * regenerate + commit together with rule changes.
 *
 * `rules.json` carries the KDL-compiled providers; provider ids sourced from
 * `@ranch/remuda` (see `src/compat/remuda.ts`) are merged in for
 * `provider-ids.ts` so `KnownProvider` covers every catalog provider.
 */
import * as path from "node:path";
import { REMUDA_PROVIDER_IDS, remudaProviderEntries } from "../src/compat/remuda";
import type { CompiledProvider } from "../src/compat/types";
import { compileCompatRules, renderAuthIds, renderProviderIds } from "./compat-compiler";

const rulesDir = path.join(import.meta.dir, "../src/compat/rules");
const outPath = path.join(import.meta.dir, "../src/compat/rules.json");
const authIdsPath = path.join(import.meta.dir, "../src/compat/auth-ids.ts");
const providerIdsPath = path.join(import.meta.dir, "../src/compat/provider-ids.ts");

const compiled = await compileCompatRules(rulesDir);
await Bun.write(outPath, JSON.stringify(compiled));
await Bun.write(authIdsPath, renderAuthIds(compiled.auth));
// KnownProvider is the union of KDL-compiled and remuda-sourced catalog
// provider ids — remuda is the data authority for its providers.
const providersForIds: Record<string, CompiledProvider> = { ...compiled.providers };
for (const [id, entry] of Object.entries(remudaProviderEntries())) providersForIds[id] = entry;
await Bun.write(providerIdsPath, renderProviderIds(providersForIds));
console.log(
	`wrote ${path.relative(process.cwd(), outPath)} (${compiled.cascade.rules.length} rules, ${compiled.taxonomy.classes.length} classes, ${Object.keys(providersForIds).length} catalog providers (${REMUDA_PROVIDER_IDS.length} remuda-sourced), ${compiled.auth.providers.length} auth providers, ${compiled.files.length} files)`,
);
