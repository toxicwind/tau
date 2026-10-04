/**
 * Request-time output ceilings: curated overrides plus ceilings learned
 * from live 400 responses.
 *
 * Read path (`getOutputCeiling`) is called from `resolveOpenAIOutputTokenParam`
 * via `providerOutputClamp` — it feeds one more `Math.min` term, so it can
 * only lower the wire value. The model spec's reported value is never
 * mutated; original schemas stay intact.
 *
 * Write path (`learnOutputCeilingFromError`) parses 400s of the form
 * "max_tokens (X): Input should be less than or equal to Y" and persists
 * the learned ceiling to the agent cache dir, so the next process — and the
 * next request — already knows. Ceilings only ratchet down.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir } from "@tau/tau-utils";
import {
	getCuratedOutputCeiling,
	parseOutputCeilingFromErrorText,
} from "@tau/tau-catalog/output-ceilings";

interface LearnedCeiling {
	ceiling: number;
	reported: number;
	learnedAt: string;
}

let learnedCache: Record<string, LearnedCeiling> | null = null;

function ceilingsPath(): string {
	return path.join(getAgentDir(), "cache", "output-ceilings.json");
}

function loadLearned(): Record<string, LearnedCeiling> {
	if (learnedCache) return learnedCache;
	try {
		const raw = fs.readFileSync(ceilingsPath(), "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
			learnedCache = parsed as Record<string, LearnedCeiling>;
			return learnedCache;
		}
	} catch {
		// Missing or corrupt cache -> start empty. Best effort throughout.
	}
	learnedCache = {};
	return learnedCache;
}

function saveLearned(map: Record<string, LearnedCeiling>): void {
	try {
		fs.mkdirSync(path.dirname(ceilingsPath()), { recursive: true });
		fs.writeFileSync(ceilingsPath(), JSON.stringify(map, null, 2) + "\n");
	} catch {
		// Persistence is best-effort; the in-memory cache still applies.
	}
}

/**
 * Effective output ceiling for a model id: curated override wins, then a
 * ceiling learned from a previous 400, else undefined (no clamping).
 */
export function getOutputCeiling(modelId: string): number | undefined {
	return getCuratedOutputCeiling(modelId) ?? loadLearned()[modelId]?.ceiling;
}

function errorText(error: unknown): string {
	if (typeof error === "string") return error;
	if (error instanceof Error) {
		const cause = (error as { cause?: unknown }).cause;
		const causeText =
			cause instanceof Error ? cause.message : cause !== undefined ? String(cause) : "";
		return `${error.message}\n${causeText}`;
	}
	return "";
}

/**
 * Learn a true ceiling from a provider 400. Returns the learned ceiling, or
 * undefined when the error carries no usable correction. Safe to call on any
 * error — non-matching errors are ignored.
 */
export function learnOutputCeilingFromError(
	modelId: string,
	error: unknown,
): number | undefined {
	const parsed = parseOutputCeilingFromErrorText(errorText(error));
	if (!parsed) return undefined;
	const map = loadLearned();
	const prev = map[modelId]?.ceiling;
	const ceiling = prev === undefined ? parsed.ceiling : Math.min(prev, parsed.ceiling);
	map[modelId] = {
		ceiling,
		reported: parsed.requested,
		learnedAt: new Date().toISOString(),
	};
	learnedCache = map;
	saveLearned(map);
	return ceiling;
}

/** Test seam: drop the in-memory learned cache. */
export function __resetLearnedCeilingsForTests(): void {
	learnedCache = null;
}
