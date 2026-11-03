/**
 * TTST recorder — time-to-second-token and inter-token gap telemetry.
 *
 * The industry measures TTFT and TPOT/ITL in aggregate; nobody records the
 * per-turn tok0→tok1 gap or the worst inter-token stall on a real agent
 * stream. This is the hyper-obtuse instrument: per-turn tok0/tok1/worst-gap/
 * p50/p90 gap histograms, emitted as a session custom event at message_end so
 * the 6s "stranded first token" spike becomes attributable per provider/model.
 */

export interface TtstGap {
	/** Index of the token after the gap (1-based). */
	token: number;
	/** Wall-clock ms from the previous token (or message_start for token 0's pre-gap). */
	gapMs: number;
}

export interface TtstTurnRecord {
	/** Epoch ms of message_start. */
	startedAt: number;
	/** Epoch ms of the first streamed delta (tok0). */
	tok0At?: number;
	/** Epoch ms of the second streamed delta (tok1). */
	tok1At?: number;
	/** tok0 - message_start: dispatch + prefill + provider lead-in. */
	ttstMs?: number;
	/** tok1 - tok0: THE gap the industry never times per turn. */
	ttok1Ms?: number;
	/** Longest gap between consecutive tokens, and where it happened. */
	worstGap?: TtstGap;
	/** Raw gap sequence (capped) for offline histogramming. */
	gaps: number[];
	/** Delta counts by channel. */
	textDeltas: number;
	thinkingDeltas: number;
	toolcallDeltas: number;
}

const MAX_GAPS = 4096;

export class TtstRecorder {
	#turn: TtstTurnRecord | null = null;

	/** message_start (assistant role). */
	begin(nowMs: number = Date.now()): void {
		this.#turn = {
			startedAt: nowMs,
			gaps: [],
			textDeltas: 0,
			thinkingDeltas: 0,
			toolcallDeltas: 0,
		};
	}

	/** message_update delta. Channels with zero-length text are ignored (meter convention). */
	push(channel: "text" | "thinking" | "toolcall", text: string, nowMs: number = Date.now()): void {
		const turn = this.#turn;
		if (!turn || text.length === 0) return;
		if (channel === "text") turn.textDeltas++;
		else if (channel === "thinking") turn.thinkingDeltas++;
		else turn.toolcallDeltas++;
		const gapMs = nowMs - (turn.tok0At ?? turn.startedAt);
		if (turn.tok0At === undefined) {
			turn.tok0At = nowMs;
			turn.ttstMs = nowMs - turn.startedAt;
		} else {
			if (turn.tok1At === undefined) turn.tok1At = nowMs;
			turn.ttok1Ms = turn.tok1At - turn.tok0At;
		}
		turn.gaps.push(gapMs);
		if (turn.gaps.length <= MAX_GAPS) {
			const worst = turn.worstGap;
			if (!worst || gapMs > worst.gapMs) turn.worstGap = { token: turn.gaps.length, gapMs };
		}
	}

	/** message_end (assistant role). Returns the record, or null if no begin() ran. */
	end(): TtstTurnRecord | null {
		const turn = this.#turn;
		this.#turn = null;
		return turn;
	}
}

/** Percentile of a gap list in ms (linear interpolation). */
export function gapPercentile(gaps: readonly number[], p: number): number | null {
	if (gaps.length === 0) return null;
	const sorted = [...gaps].sort((a, b) => a - b);
	const rank = (p / 100) * (sorted.length - 1);
	const lo = Math.floor(rank);
	const hi = Math.ceil(rank);
	return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (rank - lo);
}

/** Compact summary for the session custom event payload. */
export function summarizeTtst(record: TtstTurnRecord, nowMs: number = Date.now()): Record<string, unknown> {
	const gaps = record.gaps;
	const total = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) : 0;
	return {
		startedAt: record.startedAt,
		ttstMs: record.ttstMs ?? null,
		ttok1Ms: record.ttok1Ms ?? null,
		worstGapMs: record.worstGap?.gapMs ?? null,
		worstGapAtToken: record.worstGap?.token ?? null,
		gapP50Ms: gapPercentile(gaps, 50),
		gapP90Ms: gapPercentile(gaps, 90),
		gapCount: gaps.length,
		gapTotalMs: total,
		streamEndAt: nowMs,
		textDeltas: record.textDeltas,
		thinkingDeltas: record.thinkingDeltas,
		toolcallDeltas: record.toolcallDeltas,
	};
}