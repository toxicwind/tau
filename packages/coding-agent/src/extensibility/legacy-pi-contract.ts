/**
 * Canonical manifest of every runtime export of `@earendil-works/pi-coding-agent`
 * that legacy extensions may import from the package root.
 *
 * Pinned to pi commit in ./pi-contract.lock.
 * Every "function"/"class" entry MUST be re-exported by
 * legacy-tau-coding-agent-shim.ts. See legacy-pi-contract.test.ts.
 *
 * Regenerate with: bun run scripts/sync-legacy-pi-contract.ts
 */
export const LEGACY_PI_ROOT_EXPORTS = {
  // core/session
  AgentSession: "class",
  parseSkillBlock: "function",
  // ParsedSkillBlock is a type — no runtime presence required
  ParsedSkillBlock: "type",

  // skills / extensibility
  loadSkills: "function",
  getAgentDir: "function",
} as const satisfies Record<string, "function" | "class" | "type">;