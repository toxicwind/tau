# Hooks Examples

Example hooks for omp-coding-agent. Hook modules load through the extension runner, so every `pi.on(...)` handler here behaves like an extension handler.
<<<<<<< ours — scope `Example hooks for omp-coding-agent.` in heading `Hooks Examples`, deleted in theirs (S, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
Example hooks for tau-coding-agent.
=======
>>>>>>> theirs — scope `Example hooks for omp-coding-agent.` deleted in theirs · weave: run 'weave explain packages/coding-agent/examples/hooks/README.md' for per-hunk detail, 'weave check' to verify your resolution

## Usage

```bash
# Load a hook with --hook flag
tau --hook examples/hooks/permission-gate.ts

<<<<<<< ours — scope `# Or copy to hooks directory for auto-discovery` in heading `Usage` (T+F, confidence: medium)
// refused_by: statement_fold · collision: `cp permission-gate.ts ~/.omp/agent/hooks/`
# Or copy to hooks directory for auto-discovery
cp permission-gate.ts ~/.tau/agent/hooks/
=======
# Or copy to a hooks/pre (or hooks/post) directory for auto-discovery
cp permission-gate.ts ~/.omp/agent/hooks/pre/
>>>>>>> theirs — scope `# Or copy to hooks directory for auto-discovery`
```

## Examples

| Hook                     | Description                                                                    |
| ------------------------ | ------------------------------------------------------------------------------ |
| `permission-gate.ts`     | Prompts for confirmation before dangerous bash commands (rm -rf, sudo, etc.)   |
| `git-checkpoint.ts`      | Creates git stash checkpoints at each turn for code restoration on branch      |
| `protected-paths.ts`     | Blocks writes to protected paths (.env, .git/, node_modules/)                  |
| `file-trigger.ts`        | Watches a trigger file and injects contents into conversation                  |
| `confirm-destructive.ts` | Confirms before destructive session actions (clear, switch, branch)            |
| `dirty-repo-guard.ts`    | Prevents session changes with uncommitted git changes                          |
| `auto-commit-on-exit.ts` | Auto-commits on exit using last assistant message for commit message           |
| `custom-compaction.ts`   | Custom compaction that summarizes entire conversation                          |
| `qna.ts`                 | Extracts questions from last response into editor via `ctx.ui.setEditorText()` |
| `status-line.ts`         | Shows plain-text turn progress in the footer via `ctx.ui.setStatus()`          |
| `handoff.ts`             | Transfer context to a new focused session via `/handoff <goal>`                |

## Writing Hooks

See [docs/hooks.md](../../../../docs/hooks.md) for full documentation.

```typescript
<<<<<<< ours — scope `declaration` in heading `Writing Hooks` (S, confidence: medium)
// refused_by: statement_fold · collision: `import type { HookAPI } from "@oh-my-pi/pi-coding-agent/hooks";`
import type { HookAPI } from "@tau/tau-coding-agent/hooks";
=======
import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";
>>>>>>> theirs — scope `declaration`

export default function (pi: HookAPI) {
	// Subscribe to events
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
			const ok = await ctx.ui.confirm("Dangerous!", "Allow rm -rf?");
			if (!ok) return { block: true, reason: "Blocked by user" };
		}
	});

	// Register custom commands
	pi.registerCommand("hello", {
		description: "Say hello",
		handler: async (args, ctx) => {
			ctx.ui.notify("Hello!", "info");
		},
	});
}
```
