import { ensureChromiumExecutable } from "tau/tools/browser/launch";

const platform = process.env.TAU_BROWSER_PROBE_PLATFORM;
if (platform) Object.defineProperty(process, "platform", { value: platform });

const executable = await ensureChromiumExecutable();
process.stdout.write(executable ?? "");
