import { describe, expect, test } from "bun:test";
import { clearBundledAgentsCache, getBundledAgent, loadBundledAgents } from "../../src/task/agents";

// Regression: a bare `...SWARM_SLOTS.map` in the bundled agent catalog referenced
// an identifier with no definition anywhere, so evaluating the catalog (which
// `tau acp` / `tau serve` do at startup) threw `ReferenceError: SWARM_SLOTS is
// not defined` and crashed the compiled binary. loadBundledAgents() is the exact
// code path that crashed. This defends the externally observable contract: the
// bundled agent catalog builds and includes the swarm slots.
describe("bundled agent catalog builds (ACP/serve startup path)", () => {
  test("loadBundledAgents() does not throw (no ReferenceError) and produces swarm slots", () => {
    clearBundledAgentsCache();
    const agents = loadBundledAgents();
    expect(Array.isArray(agents)).toBe(true);
    expect(agents.length).toBeGreaterThan(3);
    const swarm = agents.filter((a) => a.name.startsWith("swarm-"));
    expect(swarm.length).toBe(8);
    expect(swarm.map((a) => a.name)).toEqual(
      Array.from({ length: 8 }, (_, i) => `swarm-${String(i + 1).padStart(2, "0")}`),
    );
  });

  test("getBundledAgent('swarm-01') resolves after the definition fix", () => {
    clearBundledAgentsCache();
    const a = getBundledAgent("swarm-01");
    expect(a?.name).toBe("swarm-01");
  });
});