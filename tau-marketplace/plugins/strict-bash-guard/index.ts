import type { ExtensionAPI } from "tau";

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event) => {
    if (event.tool !== "bash") return;

    const cmd = ((event.input?.command as string) ?? "").trim();

    // Check for common search/read utilities in the command line
    const blockedTools = [
      {
        regex: /\b(?:find|fd)\s+[^|;&]+/,
        msg: "BLOCKED: Use the 'glob' tool instead of find.",
      },
      {
        regex: /\b(?:grep|rg|ripgrep)\s+/,
        msg: "BLOCKED: Use 'grep' or 'ast_grep' instead of bash grep.",
      },
      {
        regex: /\b(?:sed\s+-n|awk)\s+/,
        msg: "BLOCKED: Use 'read' (with line ranges) instead of sed/awk.",
      },
      {
        regex: /\b(?:cat|head|tail)\s+[^-]/,
        msg: "BLOCKED: Use 'read' instead of shell file reading.",
      },
    ];

    for (const { regex, msg } of blockedTools) {
      if (regex.test(cmd)) {
        return {
          block: true,
          reason: `${msg}\nCommand attempted: ${cmd}`,
        };
      }
    }
  });
}