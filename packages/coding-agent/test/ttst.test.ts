/**
 * ttst.test.ts — TDD for the TTST recorder (packages/coding-agent/src/utils/ttst.ts).
 *
 * Contract pins (real behavior, not invented "should"s — AGENTS.md §1.6):
 * - begin() starts a turn; push() before begin() is a no-op
 * - first push sets tok0At + ttstMs = tok0 - start
 * - second push sets tok1At + ttok1Ms = tok1 - tok0
 * - zero-length deltas are IGNORED for timing AND counters (meter convention)
 * - channel counters count only non-empty deltas
 * - worstGap tracks max gap with 1-based token index; gaps capped at MAX_GAPS
 *   (worst-gap updates stop at the cap; pushes still count)
 * - end() without begin() → null; end() resets (next push is a no-op until begin)
 * - gapPercentile: null on empty, exact endpoints, linear interpolation
 * - summarizeTtst: null-safe for single-token turns (no tok1, no gaps beyond tok0)
 */
import { describe, expect, test } from "bun:test";
import {
	TtstRecorder,
	gapPercentile,
	summarizeTtst,
	type TtstTurnRecord,
} from "../src/utils/ttst";

describe("TtstRecorder lifecycle", () => {
	test("push before begin is a no-op (no throw, no state)", () => {
		const r = new TtstRecorder();
		expect(() => r.push("text", "x", 1000)).not.toThrow();
		expect(r.end()).toBeNull();
	});

	test("end without begin returns null", () => {
		const r = new TtstRecorder();
		expect(r.end()).toBeNull();
	});

	test("end resets: post-end push is a no-op and end returns null again", () => {
		const r = new TtstRecorder();
		r.begin(1000);
		r.push("text", "a", 1050);
		const rec = r.end();
		expect(rec?.tok0At).toBe(1050);
		r.push("text", "b", 2000); // no-op
		expect(r.end()).toBeNull();
	});

	test("second begin() resets an in-flight turn (message_start twice)", () => {
		const r = new TtstRecorder();
		r.begin(1000);
		r.push("text", "a", 1100);
		r.begin(5000);
		const rec = r.end();
		expect(rec?.startedAt).toBe(5000);
		expect(rec?.tok0At).toBeUndefined();
		expect(rec?.gaps).toEqual([]);
	});
});

describe("TtstRecorder timing contract", () => {
	test("first push sets tok0At and ttstMs = tok0 - start", () => {
		const r = new TtstRecorder();
		r.begin(1000);
		r.push("text", "hello", 1450);
		const rec = r.end()!;
		expect(rec.tok0At).toBe(1450);
		expect(rec.ttstMs).toBe(450);
		expect(rec.tok1At).toBeUndefined();
		expect(rec.ttok1Ms).toBeUndefined();
		expect(rec.gaps).toEqual([450]); // first gap is measured from start
	});

	test("second push sets tok1At and ttok1Ms = tok1 - tok0", () => {
		const r = new TtstRecorder();
		r.begin(1000);
		r.push("text", "a", 1450);
		r.push("text", "b", 1900);
		const rec = r.end()!;
		expect(rec.tok1At).toBe(1900);
		expect(rec.ttok1Ms).toBe(450);
		expect(rec.gaps).toEqual([450, 450]);
	});

	test("gaps measure from tok0At: now - tok0 (startedAt for tok0 itself)", () => {
		// Code is absolute (probed live twice): gapMs = nowMs - (tok0At ??
		// startedAt). tok0's gap is ttst; every later gap is "elapsed since the
		// FIRST token", NOT the inter-token distance. ttok1Ms (tok1 - tok0) is
		// the only true inter-token metric, set once at the second push.
		const r = new TtstRecorder();
		r.begin(0);
		r.push("text", "a", 100);
		r.push("text", "b", 400);
		r.push("text", "c", 2000);
		const rec = r.end()!;
		expect(rec.tok0At).toBe(100);
		expect(rec.tok1At).toBe(400);
		expect(rec.ttok1Ms).toBe(300);
		expect(rec.gaps).toEqual([100, 300, 1900]);
	});

	test("zero-length text deltas are fully ignored (timing AND counters)", () => {
		const r = new TtstRecorder();
		r.begin(1000);
		r.push("text", "", 1200); // ignored
		r.push("text", "real", 1500);
		const rec = r.end()!;
		expect(rec.tok0At).toBe(1500); // NOT 1200
		expect(rec.ttstMs).toBe(500);
		expect(rec.textDeltas).toBe(1);
	});

	test("worstGap is the max from-tok0 gap — monotone streams make the LAST token worst", () => {
		const r = new TtstRecorder();
		r.begin(0);
		r.push("text", "a", 100); // gap 100 (token 1)
		r.push("text", "b", 200); // gap 200 (token 2)
		r.push("text", "c", 900); // gap 900 (token 3)
		r.push("text", "d", 950); // gap 950 (token 4) — monotone → last wins
		const rec = r.end()!;
		expect(rec.worstGap).toEqual({ token: 4, gapMs: 850 });
		expect(rec.gaps).toEqual([100, 100, 800, 850]);
	});

	test("worstGap includes the ttst pre-gap (the 6s stranded-first-token case)", () => {
		// tok0's gap is measured from message_start — a 6s prefill lands as
		// gap[0]; a FAST post-tok0 stream never beats it, so worstGap points
		// at token 1 and ttok1Ms carries the true inter-token distance.
		const r = new TtstRecorder();
		r.begin(0);
		r.push("text", "a", 6000); // ttst 6000 — the stranded first token
		r.push("text", "b", 6100);
		const rec = r.end()!;
		expect(rec.ttstMs).toBe(6000);
		expect(rec.ttok1Ms).toBe(100);
		expect(rec.worstGap).toEqual({ token: 1, gapMs: 6000 });
		expect(rec.gaps).toEqual([6000, 100]);
	});
});

describe("TtstRecorder channel counters", () => {
	test("counters count only non-empty deltas per channel", () => {
		const r = new TtstRecorder();
		r.begin(0);
		r.push("text", "a", 10);
		r.push("text", "", 20); // ignored
		r.push("thinking", "t", 30);
		r.push("toolcall", "c", 40);
		r.push("toolcall", "c2", 50);
		const rec = r.end()!;
		expect(rec.textDeltas).toBe(1);
		expect(rec.thinkingDeltas).toBe(1);
		expect(rec.toolcallDeltas).toBe(2);
	});
});

describe("TtstRecorder MAX_GAPS cap", () => {
	test("gaps keep growing past MAX_GAPS but worstGap stops updating at cap", () => {
		const r = new TtstRecorder();
		r.begin(0);
		// MAX_GAPS = 4096 (module const). Fill exactly to the cap with a big gap,
		// then push a BIGGER gap past the cap — worstGap must stay at the capped one.
		r.push("text", "a", 100000); // gap 100000 (token 1, the ttst pre-gap)
		for (let i = 2; i <= 4096; i++) r.push("text", "x", 100000 + i); // from-tok0 gaps grow monotonically
		r.push("text", "x", 200000); // gap 100000 at token 4097 — past cap, ties token 1
		const rec = r.end()!;
		expect(rec.gaps.length).toBe(4097); // gaps array keeps growing past the cap
		expect(rec.worstGap?.token).toBe(1); // worst update stopped at the cap
		expect(rec.worstGap?.gapMs).toBe(100000);
	});
});

describe("gapPercentile", () => {
	test("empty gaps → null", () => {
		expect(gapPercentile([], 50)).toBeNull();
	});

	test("single gap → that gap at any p", () => {
		expect(gapPercentile([300], 50)).toBe(300);
		expect(gapPercentile([300], 90)).toBe(300);
	});

	test("exact endpoints: p0 and p100 hit min/max", () => {
		expect(gapPercentile([100, 200, 300], 0)).toBe(100);
		expect(gapPercentile([100, 200, 300], 100)).toBe(300);
	});

	test("linear interpolation between ranks", () => {
		// p50 of [100,200]: rank = 0.5 → 150
		expect(gapPercentile([100, 200], 50)).toBe(150);
		// p90 of 10 items: rank = 8.1 → between sorted[8] and sorted[9]
		const gaps = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
		const p90 = gapPercentile(gaps, 90)!;
		expect(p90).toBeGreaterThan(90);
		expect(p90).toBeLessThan(100);
		expect(p90).toBeCloseTo(91);
	});
});

describe("summarizeTtst", () => {
	test("single-token turn: nulls for ttok1/worstGap... no — worstGap exists (gap from start)", () => {
		const rec: TtstTurnRecord = {
			startedAt: 1000,
			tok0At: 1500,
			ttstMs: 500,
			gaps: [500],
			textDeltas: 1,
			thinkingDeltas: 0,
			toolcallDeltas: 0,
		};
		const s = summarizeTtst(rec, 1600);
		expect(s.ttstMs).toBe(500);
		expect(s.ttok1Ms).toBeNull();
		// summarizeTtst reads record.worstGap verbatim — it does NOT recompute
		// from gaps. A hand-built record without worstGap summarizes as null.
		expect(s.worstGapMs).toBeNull();
		expect(s.worstGapAtToken).toBeNull();
		expect(s.gapCount).toBe(1);
		expect(s.gapTotalMs).toBe(500);
		expect(s.streamEndAt).toBe(1600);
	});

	test("record without any push (begin→end): all timing nulls, zero counts", () => {
		const rec: TtstTurnRecord = {
			startedAt: 1000,
			gaps: [],
			textDeltas: 0,
			thinkingDeltas: 0,
			toolcallDeltas: 0,
		};
		const s = summarizeTtst(rec, 2000);
		expect(s.ttstMs).toBeNull();
		expect(s.ttok1Ms).toBeNull();
		expect(s.worstGapMs).toBeNull();
		expect(s.worstGapAtToken).toBeNull();
		expect(s.gapP50Ms).toBeNull();
		expect(s.gapP90Ms).toBeNull();
		expect(s.gapCount).toBe(0);
		expect(s.gapTotalMs).toBe(0);
	});

	test("full turn summary: percentiles and totals computed", () => {
		const rec: TtstTurnRecord = {
			startedAt: 0,
			tok0At: 100,
			ttstMs: 100,
			tok1At: 200,
			ttok1Ms: 100,
			worstGap: { token: 2, gapMs: 800 },
			gaps: [100, 800, 100],
			textDeltas: 3,
			thinkingDeltas: 0,
			toolcallDeltas: 0,
		};
		const s = summarizeTtst(rec, 1200);
		expect(s.worstGapMs).toBe(800);
		expect(s.worstGapAtToken).toBe(2);
		expect(s.gapCount).toBe(3);
		expect(s.gapTotalMs).toBe(1000);
		expect(s.gapP50Ms).toBe(100);
		expect(s.gapP90Ms).toBeGreaterThan(100);
	});
});
