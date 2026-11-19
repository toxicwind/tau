# Contributing to tau-marketplace

Thank you for contributing to the official estate-scripts Estate marketplace for Tau and Oh-My-Pi.

## Standards

1. **Maximal Engineering**: Every plugin must be production-grade, self-contained, and deterministic. No stubs, mocks, or placeholders.
2. **Fail Loud**: Errors must surface clearly with actionable context. Never silently swallow failures.
3. **In-Process Performance**: Favor synchronous in-memory TypeScript executing in under 5ms over spawning heavy background daemons or external HTTP services when possible.
4. **Schema Compliance**: Every plugin must supply a valid `package.json`, `.omp-plugin/plugin.json` (or `.claude-plugin/plugin.json`), and be declared in `marketplace.json`.

## Adding a Plugin

1. Add your plugin under `plugins/<plugin-name>/`.
2. Ensure the plugin exports a default function receiving `ExtensionAPI`:
   ```typescript
   import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

   export default function myExtension(pi: ExtensionAPI): void {
     // Register tools, commands, providers, or hooks
   }
   ```
3. Register the plugin entry in `marketplace.json`, `.omp-plugin/marketplace.json`, and `.claude-plugin/marketplace.json`.
4. Run `bun run validate` and ensure 100% pass rate.
5. Add unit tests under your plugin directory or `test/`.

## Validation

Before committing, run:
```bash
bun run validate
bun test
```
