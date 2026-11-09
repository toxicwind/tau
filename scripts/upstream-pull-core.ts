/**
 * Pure functions extracted from upstream-pull.ts for testability and reuse.
 */

export type PathKind =
	| "keep-ours"
	| "upstream-only"
	| "deleted-upstream"
	| "suture"
	| "weave"
	| "binary"
	| "conflict";

export interface Finding {
	gate: "parsable" | "universal" | "idempotent";
	rel: string;
	problem: string;
}

export const MANIFEST_RE = /(^|\/)(package\.json|tsconfig[^/]*\.json|Cargo\.toml|pyproject\.toml)$/;
export const TEXT_RE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|json|toml|ya?ml|md|sh|ps1|nix|txt)$/;
export const CONFLICT_RE = /^(<{7} |={7}\r?$|>{7} )/m;

export function invertMap(m: Record<string, string>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [from, to] of Object.entries(m)) out[to] = from;
	return out;
}

export function lineDelta(
	from: string[],
	to: string[],
): { removed: string[]; added: string[] } {
	const count = (xs: string[]): Map<string, number> => {
		const m = new Map<string, number>();
		for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
		return m;
	};
	const a = count(from);
	const b = count(to);
	const removed: string[] = [];
	const added: string[] = [];
	for (const [k, n] of a) {
		const d = n - (b.get(k) ?? 0);
		for (let i = 0; i < d; i++) removed.push(k);
	}
	for (const [k, n] of b) {
		const d = n - (a.get(k) ?? 0);
		for (let i = 0; i < d; i++) added.push(k);
	}
	return { removed, added };
}

export interface ClassifyInput {
	inBase: boolean;
	inOurs: boolean;
	inTheirs: boolean;
	isBinary: boolean;
	sameOursBase: boolean;
	sameTheirsBase: boolean;
	isManifest: boolean;
}

export function classifyFromBooleans(i: ClassifyInput): PathKind {
	if (!i.inTheirs) return "deleted-upstream";
	if (!i.inOurs) return i.inBase ? "deleted-upstream" : "upstream-only";
	if (i.isBinary) return "binary";
	if (i.sameOursBase || !i.inBase) return "upstream-only";
	if (i.sameTheirsBase) return "keep-ours";
	return i.isManifest ? "weave" : "suture";
}

export function snippet(line: string): string {
	return `\`${line.trim().slice(0, 72)}\``;
}

export function gateUniversalFromLines(
	rel: string,
	baseLines: string[] | null,
	oursLines: string[],
	theirsLines: string[],
	mergedLines: string[],
): Finding[] {
	if (!baseLines) return [];
	const oursDelta = lineDelta(baseLines, oursLines);
	const theirsDelta = lineDelta(baseLines, theirsLines);
	const mergedCount = new Map<string, number>();
	for (const l of mergedLines) mergedCount.set(l, (mergedCount.get(l) ?? 0) + 1);
	const oursHas = new Set(oursLines);
	const theirsHas = new Set(theirsLines);
	const findings: Finding[] = [];

	for (const line of theirsDelta.added) {
		if (theirsHas.has(line) && !oursHas.has(line) && (mergedCount.get(line) ?? 0) === 0) {
			findings.push({
				gate: "universal",
				rel,
				problem: `upstream added ${snippet(line)} and our side never had it, but it is absent from the merge`,
			});
		}
	}
	for (const line of oursDelta.removed) {
		if (theirsHas.has(line) && (mergedCount.get(line) ?? 0) > 0) {
			findings.push({
				gate: "universal",
				rel,
				problem: `we deleted ${snippet(line)}, upstream kept it, yet the merge restored it`,
			});
		}
	}
	const oursAdded = new Set(oursDelta.added);
	for (const line of theirsDelta.added) {
		if (!oursAdded.has(line)) continue;
		if ((mergedCount.get(line) ?? 0) > 1) {
			findings.push({
				gate: "universal",
				rel,
				problem: `${snippet(line)} was added by both sides and occurs ${mergedCount.get(line)} times — a shared edit applied more than once`,
			});
		}
	}
	return findings;
}
