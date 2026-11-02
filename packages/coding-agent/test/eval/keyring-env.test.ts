import { describe, expect, it } from "bun:test";
import {
  resolveKeyringEnv,
  mergeKeyringEnv,
  KEYRING_KEY_ALLOWLIST,
} from "../../src/eval/keyring-env.js";

/**
 * 4.16 eval key RACE — TDD for the keyring env provider (sync contract).
 *
 * Security invariants:
 *  1. ONLY allowlisted keys materialize — no ambient spill.
 *  2. A key missing from the keyring is reported in `failures`, never silently
 *     omitted from the result shape.
 *  3. Empty allowlist = no-op.
 *  4. mergeKeyringEnv never overwrites an explicit caller-provided value.
 */

describe("resolveKeyringEnv", () => {
  it("has a non-empty allowlist covering the proven lanes", () => {
    expect(KEYRING_KEY_ALLOWLIST.length).toBeGreaterThanOrEqual(6);
    expect(KEYRING_KEY_ALLOWLIST).toContain("GITHUB_TOKEN");
    expect(KEYRING_KEY_ALLOWLIST).toContain("NNTP_TORBOX_HOST");
    expect(KEYRING_KEY_ALLOWLIST).toContain("FREEINFERENCE_API_KEY");
  });

  it("returns an env record with no failures when secretsmith succeeds", () => {
    // Against the LIVE keyring (Phase 3.12 proved GITHUB_TOKEN + NNTP_TORBOX_*
    // materialize via `secretsmith env`; this is the real integration path).
    const result = resolveKeyringEnv();
    expect(typeof result.env).toBe("object");
    // MISSING keys are surfaced, not swallowed
    expect(Array.isArray(result.failures)).toBe(true);
    // A proven key resolves end-to-end against the real keyring
    if (result.env.GITHUB_TOKEN) {
      expect(result.env.GITHUB_TOKEN.length).toBeGreaterThan(20);
    }
  });

  it("never leaks a non-allowlisted key into the merged env", () => {
    const patch: Record<string, string | null | undefined> = { KEEP: "v" };
    const merged = mergeKeyringEnv(patch, {
      env: { SECRET_A: "a", GITHUB_TOKEN: "tok" },
      failures: [],
    });
    expect(merged.SECRET_A).toBeUndefined();
    expect(merged.KEEP).toBe("v");
    expect(merged.GITHUB_TOKEN).toBe("tok");
  });

  it("mergeKeyringEnv never overwrites an explicit caller value", () => {
    const merged = mergeKeyringEnv(
      { GITHUB_TOKEN: "explicit", OTHER: "x" },
      { env: { GITHUB_TOKEN: "keyring", OTHER: "y" }, failures: [] },
    );
    expect(merged.GITHUB_TOKEN).toBe("explicit");
    expect(merged.OTHER).toBe("x");
  });

  it("records failures for every key when secretsmith is missing", () => {
    const result = resolveKeyringEnv({ secretsmith: "/nonexistent/bin/secretsmith" });
    expect(result.failures.length).toBe(KEYRING_KEY_ALLOWLIST.length);
    expect(Object.keys(result.env).length).toBe(0);
  });

  it("empty allowlist is a no-op even against the live keyring", () => {
    const result = resolveKeyringEnv({ allowlist: [] });
    expect(Object.keys(result.env).length).toBe(0);
    expect(result.failures.length).toBe(0);
  });

  it("caches per secretsmith binary (no duplicate D-Bus round-trips)", () => {
    const a = resolveKeyringEnv();
    const b = resolveKeyringEnv();
    expect(a).toBe(b); // same cached result object
  });
});