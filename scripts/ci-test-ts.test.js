var __addDisposableResource = (this && this.__addDisposableResource) || function (env, value, async) {
    if (value !== null && value !== void 0) {
        if (typeof value !== "object" && typeof value !== "function") throw new TypeError("Object expected.");
        var dispose, inner;
        if (async) {
            if (!Symbol.asyncDispose) throw new TypeError("Symbol.asyncDispose is not defined.");
            dispose = value[Symbol.asyncDispose];
        }
        if (dispose === void 0) {
            if (!Symbol.dispose) throw new TypeError("Symbol.dispose is not defined.");
            dispose = value[Symbol.dispose];
            if (async) inner = dispose;
        }
        if (typeof dispose !== "function") throw new TypeError("Object not disposable.");
        if (inner) dispose = function() { try { inner.call(this); } catch (e) { return Promise.reject(e); } };
        env.stack.push({ value: value, dispose: dispose, async: async });
    }
    else if (async) {
        env.stack.push({ async: true });
    }
    return value;
};
var __disposeResources = (this && this.__disposeResources) || (function (SuppressedError) {
    return function (env) {
        function fail(e) {
            env.error = env.hasError ? new SuppressedError(e, env.error, "An error was suppressed during disposal.") : e;
            env.hasError = true;
        }
        var r, s = 0;
        function next() {
            while (r = env.stack.pop()) {
                try {
                    if (!r.async && s === 1) return s = 0, env.stack.push(r), Promise.resolve().then(next);
                    if (r.dispose) {
                        var result = r.dispose.call(r.value);
                        if (r.async) return s |= 2, Promise.resolve(result).then(next, function(e) { fail(e); return next(); });
                    }
                    else s |= 1;
                }
                catch (e) {
                    fail(e);
                }
            }
            if (s === 1) return env.hasError ? Promise.reject(env.error) : Promise.resolve();
            if (env.hasError) throw env.error;
        }
        return next();
    };
})(typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
});
import { describe, expect, test } from "bun:test";
import { ptree, TempDir } from "@tau/tau-utils";
import { selectShard } from "./ci-test-ts";
describe("test runner watchdog", () => {
    // Parent fake timers cannot drive the real watchdog inside the isolated runner process.
    test("kills a stalled chunk, reports failure, and continues the queue", async () => {
        const env_1 = { stack: [], error: void 0, hasError: false };
        try {
            const dir = __addDisposableResource(env_1, TempDir.createSync("tau-test-runner-watchdog-"), false);
            const started = dir.join("started");
            const completed = dir.join("completed");
            const continued = dir.join("continued");
            const stalledCommand = [
                process.execPath,
                "-e",
                `await Bun.write(${JSON.stringify(started)}, "started"); await Bun.sleep(60_000); await Bun.write(${JSON.stringify(completed)}, "completed");`,
            ];
            const nextCommand = [process.execPath, "-e", `await Bun.write(${JSON.stringify(continued)}, "continued");`];
            const commands = [
                { label: "stalled chunk", cwd: ".", command: stalledCommand },
                { label: "following chunk", cwd: ".", command: nextCommand },
            ];
            const result = await ptree.exec([
                process.execPath,
                "-e",
                `import { runTestCommandsInParallel } from ${JSON.stringify(import.meta.resolve("./ci-test-ts.ts"))}; await runTestCommandsInParallel(${JSON.stringify(commands)}, 1);`,
            ], {
                env: { ...Bun.env, TAU_TEST_CHUNK_TIMEOUT: "1", NO_COLOR: "1" },
                timeout: 10000,
                detached: true,
                allowNonZero: true,
            });
            expect(result.exitCode).toBe(1);
            expect(result.stdout).toContain("[watchdog]");
            expect(await Bun.file(started).exists()).toBe(true);
            expect(await Bun.file(completed).exists()).toBe(false);
            expect(await Bun.file(continued).text()).toBe("continued");
        }
        catch (e_1) {
            env_1.error = e_1;
            env_1.hasError = true;
        }
        finally {
            __disposeResources(env_1);
        }
    }, 15000);
});
describe("TAU_TEST_SHARD", () => {
    test("shards partition every chunk exactly once, balanced to within one", () => {
        const chunks = Array.from({ length: 79 }, (_, i) => i);
        const shards = [1, 2, 3].map(i => selectShard(chunks, `${i}/3`));
        expect(shards.flat().sort((a, b) => a - b)).toEqual(chunks);
        const sizes = shards.map(s => s.length);
        expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
        expect(selectShard(chunks, "1/1")).toEqual(chunks);
        expect(selectShard(chunks, undefined)).toEqual(chunks);
    });
    test("rejects malformed specs instead of running an empty or partial shard", () => {
        for (const spec of ["0/2", "3/2", "1/0", "2", "a/b", "1/2/3"]) {
            expect(() => selectShard([1, 2, 3], spec)).toThrow("Invalid TAU_TEST_SHARD");
        }
    });
    test("rejects a shard that selects no chunks", () => {
        expect(() => selectShard([1], "2/2")).toThrow("selects no chunks");
        expect(() => selectShard([], "1/1")).toThrow("selects no chunks");
    });
});
