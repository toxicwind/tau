<<<<<<< ours — interstitial `file_header` (S, confidence: medium)
// refused_by: merge_ladder_exhausted · collision: `// @ts-nocheck — example file; install @oh-my-pi/pi-coding-agen…`
// @ts-nocheck — example file; install @tau/tau-coding-agent before running
import type { ExtensionAPI } from "@tau/tau-coding-agent";
=======
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
>>>>>>> theirs — interstitial `file_header` (S, confidence: medium) · weave: run 'weave explain docs/skills/examples/mini-marketplace/my-plugin/index.ts' for per-hunk detail, 'weave check' to verify your resolution

export default function myPlugin(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("my-plugin loaded from example marketplace!", "info");
  });
}
