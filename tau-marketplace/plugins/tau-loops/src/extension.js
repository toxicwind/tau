import { censusConsumers, diffTrees, formatCensus, formatDiff, resolveDir } from "./dir-diff.ts";
import { describeRun, formatReport, resolveApiKey, resolveConfigPath, runAudit } from "./model-audit.ts";
import { formatProbeRun, resolveOmpPath, runProbe } from "./probe-runner.ts";
import { measureAsync, trace, traceError } from "./timing.ts";
export default function tauLoopsExtension(pi) {
    pi.registerCommand("loop-model-audit", {
        description: "Probe every model the live config references and report the dead ones, plus any role the engine knows but the config leaves unset.",
        handler: async (args, ctx) => {
            const configPath = args.trim() || resolveConfigPath();
            ctx.ui.notify(`loop-model-audit: ${configPath}`, "info");
            try {
                const report = await measureAsync("loop-model-audit", () => runAudit({ configPath, apiKey: resolveApiKey() }));
                trace("loop-model-audit", "done", { configPath, summary: describeRun(report) });
                ctx.ui.notify(formatReport(report), report.undefinedRoles.length > 0 ? "warning" : "info");
            }
            catch (error) {
                traceError("loop-model-audit", "failed", error, { configPath });
                ctx.ui.notify(`loop-model-audit failed: ${String(error)}`, "error");
            }
        },
    });
    pi.registerCommand("loop-dir-diff", {
        description: "Diff two directories, then census the repo for references to each so you know which one is live before deleting either.",
        handler: async (args, ctx) => {
            const [left, right] = args.trim().split(/\s+/).filter(Boolean);
            if (!left || !right) {
                ctx.ui.notify("usage: loop-dir-diff <leftDir> <rightDir>", "error");
                return;
            }
            try {
                const diff = diffTrees(resolveDir(left), resolveDir(right));
                trace("loop-dir-diff", "diffed", {
                    left,
                    right,
                    onlyInLeft: diff.onlyInLeft.length,
                    onlyInRight: diff.onlyInRight.length,
                    differing: diff.differing.length,
                    identical: diff.identical.length,
                });
                ctx.ui.notify(formatDiff(diff), "info");
                // A diff says the trees differ; only a census says anyone cares.
                const hits = censusConsumers({
                    searchRoot: resolveDir("."),
                    needles: [left, right],
                });
                ctx.ui.notify(formatCensus(hits), "info");
            }
            catch (error) {
                traceError("loop-dir-diff", "failed", error, { left, right });
                ctx.ui.notify(`loop-dir-diff failed: ${String(error)}`, "error");
            }
        },
    });
    pi.registerCommand("loop-probe", {
        description: "Run a throwaway extension under omp -p and print the JSON it wrote, so the engine can be asked something the logs will not say.",
        handler: async (args, ctx) => {
            const [file, model, ...promptParts] = args.trim().split(/\s+/).filter(Boolean);
            if (file === undefined) {
                ctx.ui.notify("usage: loop-probe <file.ts> [model] [prompt]", "error");
                return;
            }
            try {
                const result = await measureAsync("loop-probe", () => runProbe({
                    extensionPath: file,
                    model,
                    prompt: promptParts.join(" ") || "Run your extension and exit.",
                    ompPath: resolveOmpPath(),
                }));
                trace("loop-probe", "done", { file, ok: result.ok, exitCode: result.exitCode });
                ctx.ui.notify(formatProbeRun(result), result.ok ? "info" : "error");
            }
            catch (error) {
                traceError("loop-probe", "failed", error, { file });
                ctx.ui.notify(`loop-probe failed: ${String(error)}`, "error");
            }
        },
    });
}
