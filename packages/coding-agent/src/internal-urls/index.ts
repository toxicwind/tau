/**
 * Internal URL routing system: scheme handlers, their declared specs, and the
 * process-global router that dispatches to them.
 *
 * One process-global `InternalUrlRouter` is shared across sessions. Handlers
 * are stateless; they pull whatever they need (active skills/rules, active
 * MCP/async managers, AgentRegistry-listed sessions) from the owning module
 * on each resolve call.
 */

export * from "./agent-protocol";
export * from "./artifact-protocol";
export * from "./attachment-protocol";
export * from "./cfg-protocol";
export * from "./conflict-protocol";
export * from "./context";
export * from "./history-protocol";
export * from "./issue-pr-protocol";
export * from "./local-protocol";
export * from "./mcp-protocol";
export * from "./memory-protocol";
export * from "./tau-protocol";
export * from "./tau-scope";
