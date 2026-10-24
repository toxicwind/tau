/**
 * Exercise the model-audit loop against the live config the engine actually
 * reads. Run from the estate-scripts root so `.secrets` is loadable:
 *
 *   set -a && . ./config/.secrets && set +a
 *   bun packages/tau-extensions/packages/tau-loops/scripts/run-model-audit.ts
 */
import { runAudit, formatReport, resolveConfigPath } from "../src/model-audit.ts";

const report = await runAudit({ configPath: resolveConfigPath() });
process.stdout.write(formatReport(report));
process.stdout.write(`\nprobed ${report.probes.length} distinct model refs\n`);
