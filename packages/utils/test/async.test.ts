import { expect, test, describe, vi } from "bun:test";
import { withTimeout, AsyncDrain } from "../src/async";

describe("withTimeout", () => {
    test("should resolve if promise resolves in time", async () => {
        vi.useFakeTimers();
        const { promise, resolve } = Promise.withResolvers<string>();
        const p = withTimeout(promise, 100, "timeout");
        resolve("done");
        expect(await p).toBe("done");
        vi.useRealTimers();
    });

    test("should reject if timeout fires", async () => {
        vi.useFakeTimers();
        const { promise } = Promise.withResolvers<string>();
        const p = withTimeout(promise, 50, "too slow");
        vi.advanceTimersByTime(60);
        await expect(p).rejects.toThrow("too slow");
        vi.useRealTimers();
    });

    test("should reject if signal is already aborted", async () => {
        const controller = new AbortController();
        controller.abort();
        const { promise } = Promise.withResolvers<string>();
        await expect(withTimeout(promise, 100, "timeout", controller.signal)).rejects.toThrow("The operation was aborted.");
    });
});

describe("AsyncDrain", () => {
    test("should coalesce pushes", async () => {
        vi.useFakeTimers();
        const drain = new AsyncDrain<number>(10);
        const results: number[][] = [];
        
        const p1 = drain.push(1, vals => { results.push([...vals]); });
        const p2 = drain.push(2, vals => { results.push([...vals]); });
        
        vi.advanceTimersByTime(20);
        await Promise.all([p1, p2]);
        
        expect(results).toHaveLength(1);
        expect(results[0]).toEqual([1, 2]);
        vi.useRealTimers();
    });

    test("should handle immediate execution", async () => {
        const drain = new AsyncDrain<number>(0);
        const results: number[][] = [];
        
        await drain.push(1, vals => { results.push([...vals]); });
        await drain.push(2, vals => { results.push([...vals]); });
        
        expect(results).toHaveLength(2);
        expect(results[0]).toEqual([1]);
        expect(results[1]).toEqual([2]);
    });
});
