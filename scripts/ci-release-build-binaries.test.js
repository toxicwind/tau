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
import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import { TempDir } from "@tau/tau-utils/temp";
import { $ } from "bun";
import { resolveCrossBuild } from "../packages/coding-agent/scripts/build-binary";
import { compileCodingAgent } from "../packages/coding-agent/scripts/compile-binary";
const repoRoot = path.join(import.meta.dir, "..");
describe("Windows release binary target", () => {
    it("builds both Windows architecture release assets with their native runtimes", async () => {
        const result = await $ `bun scripts/ci-release-build-binaries.ts --dry-run --targets win32-x64,win32-arm64`
            .cwd(repoRoot)
            .quiet()
            .nothrow();
        expect(result.exitCode).toBe(0);
        const output = result.text();
        expect(output).toContain("Building packages/coding-agent/binaries/tau-windows-x64.exe...");
        expect(output).toContain("DRY RUN Bun.build target=bun-windows-x64-baseline outfile=packages/coding-agent/binaries/tau-windows-x64.exe");
        expect(output).toContain("Building packages/coding-agent/binaries/tau-windows-arm64.exe...");
        expect(output).toContain("DRY RUN Bun.build target=bun-windows-arm64 outfile=packages/coding-agent/binaries/tau-windows-arm64.exe");
        expect(output).toContain("external=fastembed,onnxruntime-node");
        expect(output).not.toContain("bun-windows-x64-modern");
    });
    it("resolves local Windows cross-build aliases for both architectures", () => {
        expect(resolveCrossBuild("win32-x64")).toEqual({
            id: "win32-x64",
            platform: "win32",
            arch: "x64",
            target: "bun-windows-x64-baseline",
        });
        expect(resolveCrossBuild("windows-x64")).toEqual({
            id: "windows-x64",
            platform: "win32",
            arch: "x64",
            target: "bun-windows-x64-baseline",
        });
        expect(resolveCrossBuild("win32-arm64")).toEqual({
            id: "win32-arm64",
            platform: "win32",
            arch: "arm64",
            target: "bun-windows-arm64",
        });
        expect(resolveCrossBuild("windows-arm64")).toEqual({
            id: "windows-arm64",
            platform: "win32",
            arch: "arm64",
            target: "bun-windows-arm64",
        });
    });
});
it("runs compiled bytecode containing dependency import.meta.resolve calls", async () => {
    const env_1 = { stack: [], error: void 0, hasError: false };
    try {
        const temp = __addDisposableResource(env_1, TempDir.createSync("@tau-bytecode-"), false);
        const entrypoint = temp.join("entry.ts");
        const outfile = temp.join(process.platform === "win32" ? "probe.exe" : "probe");
        await Bun.write(entrypoint, 'console.log(import.meta.resolve("node:fs"));\n');
        await compileCodingAgent({
            repoRoot: temp.path(),
            entrypoint,
            outfile,
            transformersVersion: "unused",
        });
        const result = await $ `${outfile}`.quiet().nothrow();
        expect(result.exitCode).toBe(0);
        expect(result.text().trim()).toBe("node:fs");
    }
    catch (e_1) {
        env_1.error = e_1;
        env_1.hasError = true;
    }
    finally {
        __disposeResources(env_1);
    }
}, 30000);
describe("macOS release binary entitlements", () => {
    it("allows Xcode MCP automation through Apple Events", async () => {
        const entitlements = await Bun.file(path.join(repoRoot, "scripts/macos-entitlements.plist")).text();
        expect(entitlements).toContain("<key>com.apple.security.automation.apple-events</key>\n\t<true/>");
    });
});
