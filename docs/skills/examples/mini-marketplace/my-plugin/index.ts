// refused_by: merge_ladder_exhausted · collision: `// @ts-nocheck — example file; install @oh-my-pi/pi-coding-agen…`
// @ts-nocheck — example file; install @tau/tau-coding-agent before running
import type { ExtensionAPI } from "@tau/tau-coding-agent";

export default function myPlugin(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("my-plugin loaded from example marketplace!", "info");
  });
}
