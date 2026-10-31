/**
 * streaming-output — coding-agent-facing re-export of the shared streaming
 * output/truncation engine.
 *
 * The canonical implementation lives in the TUI package and is published as
 * `@tau/tau-tui/tools/streaming-output` (source: `packages/tui/src/tools/
 * streaming-output.ts`). This module is the thin boundary that the
 * coding-agent session and tools (read, bash, ssh) import from, so the
 * documented path (`packages/coding-agent/src/session/streaming-output.ts`)
 * is real and the truncation constants are shared — not duplicated.
 *
 * Handles: inline truncation (head/tail/middle, line+byte aware), the
 * artifact-on-disk OutputSink with capped head+tail windows, byte-level
 * UTF-8-safe truncation, per-line column caps, keep-failure-lines, and the
 * tail-streaming onChunk helper for bash/ssh updates.
 */
export * from "@tau/tau-tui/tools/streaming-output";