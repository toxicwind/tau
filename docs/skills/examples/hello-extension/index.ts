<<<<<<< ours — interstitial `file_header` (S, confidence: medium)
// refused_by: merge_ladder_exhausted · collision: `// @ts-nocheck — example file; install @oh-my-pi/pi-coding-agen…`
// @ts-nocheck — example file; install @tau/tau-coding-agent before running
import type { ExtensionAPI } from "@tau/tau-coding-agent";
=======
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
>>>>>>> theirs — interstitial `file_header` (S, confidence: medium) · weave: run 'weave explain docs/skills/examples/hello-extension/index.ts' for per-hunk detail, 'weave check' to verify your resolution

export default function helloExtension(pi: ExtensionAPI) {
  // Show a greeting whenever a session starts.
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("Hello from hello-extension!", "info");
  });

  // Register a /hello slash command that sends a greeting into the conversation.
  pi.registerCommand("hello", {
    description: "Send a greeting into the conversation",
    handler: async (args, ctx) => {
      const name = args.trim() || "there";
      pi.sendMessage(
        {
          customType: "hello-extension",
          content: `Hello, ${name}!`,
          display: true,
          attribution: "user",
        },
        { triggerTurn: false }
      );
      ctx.ui.notify("Message sent!", "info");
    },
  });
}
