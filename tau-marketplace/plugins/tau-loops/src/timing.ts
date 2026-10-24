import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";

/**
 * Latency instrumentation, HFT-style.
 *
 * Doctrine this implements:
 *   - latency is a correctness criterion, not a metric
 *   - measure everything, report timings first-class
 *   - fail fast per attempt; slow is a kind of wrong
 *   - keep the fast path hot via a winners log
 *   - race redundant transports instead of retrying a blocked one
 */

export type Timing = { name: string; durationUs: number; ok: boolean; detail?: string };

const TIMINGS: Timing[] = [];

export function nowUs(): number {
	return performance.now() * 1000;
}

/** Time a step. Throws still record the time, because a slow failure is data. */
export function measure<T>(name: string, fn: () => T | Promise<T>, detail?: string): T | Promise<T> {
	const started = nowUs();
	const settle = (ok: boolean, note?: string): void => {
		TIMINGS.push({ name, durationUs: nowUs() - started, ok, detail: note ?? detail });
	};
	if (fn instanceof Promise) {
		return fn.then(
			(value) => {
				settle(true);
				return value;
			},
			(error: unknown) => {
				settle(false, String(error).slice(0, 120));
				throw error;
			},
		);
	}
	try {
		const value = fn();
		settle(true);
		return value;
	} catch (error) {
		settle(false, String(error).slice(0, 120));
		throw error;
	}
}

export async function measureAsync<T>(name: string, fn: () => Promise<T>, detail?: string): Promise<T> {
	return (await measure(name, fn, detail)) as T;
}

export function takeTimings(): Timing[] {
	return [...TIMINGS];
}

export function formatTimings(): string {
	if (TIMINGS.length === 0) return "timings: (none)";
	const width = Math.max(...TIMINGS.map((t) => t.name.length));
	const lines = TIMINGS.map((t) => {
		const ms = (t.durationUs / 1000).toFixed(1).padStart(9);
		const flag = t.ok ? "ok  " : "FAIL";
		const note = t.detail ? `  ${t.detail}` : "";
		return `  ${t.name.padEnd(width)}  ${ms}ms  ${flag}${note}`;
	});
	const totalUs = TIMINGS.reduce((sum, t) => sum + t.durationUs, 0);
	lines.push(`  ${"TOTAL".padEnd(width)}  ${(totalUs / 1000).toFixed(1).padStart(9)}ms`);
	return lines.join("\n");
}

/** NDJSON trace so a slow run can be watched while it is still running. */
export type TraceLevel = "debug" | "info" | "warn";

export function trace(loop: string, event: string, fields: Record<string, unknown> = {}): void {
	const line = JSON.stringify({
		ts: new Date().toISOString(),
		level: "info",
		loop,
		event,
		...fields,
	});
	if (process.env.TAU_LOOPS_TRACE === "0") return;
	process.stderr.write(`${line}\n`);
}

export function traceError(
	loop: string,
	event: string,
	error: unknown,
	fields: Record<string, unknown> = {},
): void {
	const line = JSON.stringify({
		ts: new Date().toISOString(),
		level: "error",
		loop,
		event,
		error: String(error).slice(0, 300),
		...fields,
	});
	if (process.env.TAU_LOOPS_TRACE === "0") return;
	process.stderr.write(`${line}\n`);
}

/**
 * Where winning strategies are recorded so the next run leads with them
 * instead of re-discovering the answer. `TAU_LOOPS_WINNERS_LOG` overrides it,
 * which is how a test keeps its appends out of the real log.
 */
export const WINNERS_LOG =
	process.env.TAU_LOOPS_WINNERS_LOG ?? join(homedir(), ".cache", "fleet-bus", "hft_race_winners.jsonl");

export type WinnerRecord = {
	ts: string;
	tag: string;
	winner: string;
	latencyMs: number;
	losers: Array<{ strategy: string; latencyMs: number; reason: string }>;
};

/** Append a win so the next run can lead with it instead of re-discovering it. */
export function recordWinner(record: WinnerRecord, path = WINNERS_LOG): void {
	try {
		mkdirSync(dirname(path), { recursive: true });
		appendFileSync(path, `${JSON.stringify(record)}\n`);
	} catch (error) {
		traceError("winners-log", "append failed", error, { path });
	}
}

export function readWinners(tag: string, limit = 50): WinnerRecord[] {
	try {
		return readFileLines(WINNERS_LOG)
			.filter((line): line is string => typeof line === "string")
			.map((line) => JSON.parse(line) as WinnerRecord)
			.filter((record) => record.tag === tag)
			.slice(-limit);
	} catch {
		return [];
	}
}

function readFileLines(path: string): unknown[] {
	// readFileSync is imported at the top of this module. A `require` here would
	// be undefined — the package is ESM — and the failure would only surface the
	// first time anything read a winners log.
	return readFileSync(path, "utf8")
		.split("\n")
		.filter((line): line is string => line.length > 0);
}

export type Attempt<T> = {
	strategy: string;
	promise: Promise<{ value: T; latencyUs: number }>;
	startedUs: number;
};

/**
 * Race distinct strategies. First *valid* result wins; losers are abandoned
 * but still recorded with their latency. `timeoutUs` is a per-attempt
 * deadline, not a budget for the whole race.
 */
export async function race<T>(
	tag: string,
	strategies: Array<{ name: string; run: () => Promise<T>; valid?: (value: T) => boolean }>,
	options: { timeoutUs: number },
): Promise<{ winner: string; value: T; latencyMs: number; attempts: number }> {
	trace("race", "start", { tag, strategies: strategies.map((s) => s.name), timeoutUs: options.timeoutUs });
	const settled = new Map<string, { ok: boolean; value?: T; latencyUs: number; reason?: string }>();

	for (const strategy of strategies) {
		const startedUs = nowUs();
		// Promise.resolve().then() rather than run().then(): a strategy that
		// throws synchronously would otherwise escape `race` entirely instead
		// of being recorded as a loser.
		void Promise.resolve()
			.then(() => strategy.run())
			.then((value) => {
				const valid = strategy.valid ? strategy.valid(value) : true;
				settled.set(strategy.name, {
					ok: valid,
					value,
					latencyUs: nowUs() - startedUs,
					reason: valid ? undefined : "invalid",
				});
			})
			.catch((error: unknown) => {
				settled.set(strategy.name, {
					ok: false,
					latencyUs: nowUs() - startedUs,
					reason: String(error).slice(0, 120),
				});
			});
	}

	// High-frequency liveness probe: wake on completion, but also check the
	// deadline so a hung attempt is killed rather than awaited forever.
	const deadlineUs = options.timeoutUs;
	const startedUs = nowUs();
	for (;;) {
		await Bun.sleep(2);
		// Lowest latency wins, not first-listed. When several strategies are
		// already settled by the time this check runs, scanning in array order
		// would hand the win to whichever was declared first.
		const best = [...settled.entries()]
			.filter(([, result]) => result.ok && result.value !== undefined)
			.sort((a, b) => a[1].latencyUs - b[1].latencyUs)[0];
		if (best !== undefined) {
			const [name, result] = best;
			// The filter above already established this, but narrowing through a
			// predicate does not survive the destructuring.
			if (result.value === undefined) continue;
			recordWinner({
				ts: new Date().toISOString(),
				tag,
				winner: name,
				latencyMs: result.latencyUs / 1000,
				losers: [...settled.entries()]
					.filter(([other]) => other !== name)
					.map(([other, loser]) => ({
						strategy: other,
						latencyMs: loser.latencyUs / 1000,
						reason: loser.reason ?? "abandoned",
					})),
			});
			trace("race", "won", { tag, winner: name, latencyMs: result.latencyUs / 1000 });
			return {
				winner: name,
				value: result.value,
				latencyMs: result.latencyUs / 1000,
				attempts: strategies.length,
			};
		}
		if (nowUs() - startedUs >= deadlineUs) {
			const reasons = strategies.map((s) => `${s.name}=${settled.get(s.name)?.reason ?? "timeout"}`);
			recordWinner({
				ts: new Date().toISOString(),
				tag,
				winner: "none",
				latencyMs: (nowUs() - startedUs) / 1000,
				losers: reasons.map((reason) => ({ strategy: reason.split("=")[0] ?? "?", latencyMs: 0, reason })),
			});
			throw new Error(`race "${tag}" timed out after ${deadlineUs}us: ${reasons.join(", ")}`);
		}
	}
}

/**
 * Prove a local TCP port is listening. Returns null on success, a reason on
 * failure. The timeout is real: a connect to a filtered port can hang far
 * longer than a probe should, and a liveness check that hangs is worse than
 * one that reports "down".
 */
export async function probePort(port: number, host = "127.0.0.1", timeoutMs = 2000): Promise<string | null> {
	const startedUs = nowUs();
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		// Bun.connect resolves to the connected socket; holding the promise and
		// calling .end() on it is a type error that also leaks the fd.
		const socket = await Promise.race([
			Bun.connect({ hostname: host, port, socket: { data() {} } }),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error(`connect timed out after ${timeoutMs}ms`)), timeoutMs);
			}),
		]);
		socket.end();
		trace("port", "open", { port, latencyMs: (nowUs() - startedUs) / 1000 });
		return null;
	} catch (error) {
		const reason = `${host}:${port} ${String(error).slice(0, 80)}`;
		trace("port", "closed", { port, latencyMs: (nowUs() - startedUs) / 1000 });
		return reason;
	} finally {
		// Without this the timer holds the event loop open for timeoutMs after
		// a probe that connected instantly, which is a real cost at 30s poll
		// intervals across 50 surfaces.
		clearTimeout(timer);
	}
}
