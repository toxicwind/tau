import { describe, expect, it } from "bun:test";
import {
	chunkArray,
	DEFAULT_MAX_ITEMS_PER_CALL,
	executeArgumentChunks,
	planArgumentChunks,
} from "../src/utils/chunk-tool-args";

describe("chunkArray", () => {
	it("splits into consecutive chunks of at most size, order preserved", () => {
		expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
	});

	it("returns a single chunk when items fit", () => {
		expect(chunkArray([1, 2], 80)).toEqual([[1, 2]]);
	});

	it("returns no chunks for empty input", () => {
		expect(chunkArray([], 80)).toEqual([]);
	});

	it("rejects a non-positive size", () => {
		expect(() => chunkArray([1], 0)).toThrow(RangeError);
	});

	it("defaults to the 80-item ceiling (Dots 3 recon: <100 items per call)", () => {
		const items = Array.from({ length: 200 }, (_, i) => i);
		const chunks = chunkArray(items);
		expect(chunks.map(c => c.length)).toEqual([80, 80, 40]);
		expect(chunks.flat()).toEqual(items);
		expect(DEFAULT_MAX_ITEMS_PER_CALL).toBe(80);
	});
});

describe("planArgumentChunks", () => {
	it("returns null when the array is within the ceiling", () => {
		expect(planArgumentChunks({ rows: [1, 2, 3] }, "rows")).toBeNull();
	});

	it("returns null when the field is missing or not an array", () => {
		expect(planArgumentChunks({}, "rows")).toBeNull();
		expect(planArgumentChunks({ rows: "nope" }, "rows")).toBeNull();
	});

	it("plans sequential calls carrying every other field verbatim", () => {
		const rows = Array.from({ length: 200 }, (_, i) => i);
		const plan = planArgumentChunks({ rows, mode: "append" }, "rows");
		expect(plan?.field).toBe("rows");
		expect(plan?.totalItems).toBe(200);
		expect(plan?.chunkCount).toBe(3);
		expect(plan?.calls.map(c => (c.rows as number[]).length)).toEqual([80, 80, 40]);
		expect(plan?.calls.every(c => c.mode === "append")).toBe(true);
		expect(plan?.calls.flatMap(c => c.rows as number[])).toEqual(rows);
	});

	it("honors a custom ceiling", () => {
		const plan = planArgumentChunks({ rows: [1, 2, 3, 4, 5] }, "rows", 2);
		expect(plan?.calls.map(c => c.rows)).toEqual([[1, 2], [3, 4], [5]]);
	});
});

describe("executeArgumentChunks", () => {
	it("runs sequentially in order and collects one result per call", async () => {
		const order: number[] = [];
		const results = await executeArgumentChunks([10, 20, 30], async (n, i) => {
			order.push(i);
			return n * 2;
		});
		expect(order).toEqual([0, 1, 2]);
		expect(results).toEqual([20, 40, 60]);
	});

	it("stops at the first error and never runs later chunks", async () => {
		const ran: number[] = [];
		await expect(
			executeArgumentChunks([1, 2, 3], async n => {
				ran.push(n);
				if (n === 2) throw new Error("boom");
				return n;
			}),
		).rejects.toThrow("boom");
		expect(ran).toEqual([1, 2]);
	});

	it("honors an already-aborted signal before the first chunk", async () => {
		const controller = new AbortController();
		controller.abort(new Error("stop"));
		await expect(executeArgumentChunks([1], async n => n, controller.signal)).rejects.toThrow("stop");
	});
});
