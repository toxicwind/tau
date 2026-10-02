/**
 * Typed accessors over the catalog-provider entries.
 *
 * Provider data has ONE authority: `@ranch/roost` (`ranch/roost`),
 * projected onto the `CompiledProvider` shape by `./roost`. The KDL tree
 * (`rules/providers/<id>.kdl`) still compiles catalog entries for providers
 * roost does not cover yet — a shrinking legacy rump, never a competing
 * inventory: roost wins every id conflict (there are none by construction).
 *
 * `provider-models/descriptors.ts` pairs these entries with the per-provider
 * model-manager factories; the generator bundles seed rows per each entry's
 * `bundle` policy.
 */
import { roostProviderEntries } from "./roost";
import rules from "./rules.json";
import type { Api, ModelSpec } from "../types";
import type { CompiledProvider } from "./types";

const EMPTY: readonly ModelSpec<Api>[] = [];

let merged: Readonly<Record<string, CompiledProvider>> | undefined;

/** Every catalog provider entry keyed by id (sorted; roost-sourced first-class). */
export function providerEntries(): Readonly<Record<string, CompiledProvider>> {
	if (!merged) {
		const kdl = rules.providers as Readonly<Record<string, CompiledProvider>>;
		const fromTack = roostProviderEntries();
		const ids = [...new Set([...Object.keys(fromTack), ...Object.keys(kdl)])].sort();
		const out: Record<string, CompiledProvider> = {};
		for (const id of ids) out[id] = fromTack[id] ?? kdl[id]!;
		merged = out;
	}
	return merged;
}

/** One provider's catalog entry, or `undefined` for ids without one. */
export function providerEntry(provider: string): CompiledProvider | undefined {
	return providerEntries()[provider];
}

/**
 * The authored seed rows for one provider (empty when it has none). Rows are
 * the compiled JSON verbatim; callers that mutate must copy.
 */
export function seedModels<TApi extends Api = Api>(provider: string): readonly ModelSpec<TApi>[] {
	// Compile-time validated rows; the only untyped edge is `thinking`/`compat`
	// arriving as resolved-key records rather than the spec interfaces.
	return (providerEntry(provider)?.seed?.models ?? EMPTY) as unknown as readonly ModelSpec<TApi>[];
}
