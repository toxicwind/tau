// keyring-env.ts — merge allowlisted secretsmith keys into the eval kernel env.
//
// 4.16 eval key RACE: the kernel previously carried ZERO keyring secrets, so
// eval cells had to `secretsmith get` per call (~600ms) or hardcode tokens.
// This provider resolves a config allowlist once per session via
// `secretsmith env` (proven: materializes real values, http 200 after the
// 2026-11-02 GITHUB_TOKEN sync) and merges them into the managed kernel env
// patch so every JS/Py cell sees them with zero transport copies.
//
// Security: only explicitly allowlisted keys are injected. A key that fails
// to resolve is an error for that key, never a partial-merge of stale values.
import { spawnSync } from "node:child_process";

/** Keys the eval kernel is allowed to see, sourced from ~/.secretsmith allowlist. */
export const KEYRING_KEY_ALLOWLIST = [
  // Resolved end-to-end on 2026-11-02 (Phases 3.12 / 2.6 / 2.7).
  "GITHUB_TOKEN",
  "NNTP_TORBOX_HOST",
  "NNTP_TORBOX_USER",
  "NNTP_TORBOX_PASS",
  "FREEINFERENCE_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "RHODOCHROSITE_API_KEY",
] as const;

export type KeyringEnvOptions = {
  /** Allowlist override (default KEYRING_KEY_ALLOWLIST). */
  allowlist?: readonly string[];
  /** secretsmith binary path. */
  secretsmith?: string;
  /** timeoutsMs for the resolve call. */
  timeoutsMs?: number;
};

export type KeyringEnvResult = {
  env: Record<string, string>;
  /** Key names that failed to resolve (never silently empty). */
  failures: string[];
};

/**
 * Resolve allowlisted keys via `secretsmith env` once, filter to the allowlist,
 * and return the merged env. Cache results for the process lifetime so a
 * session's repeated kernel boots don't re-invoke D-Bus secretsmith each time.
 */
const cache = new Map<string, KeyringEnvResult>();

export function resolveKeyringEnv(options: KeyringEnvOptions = {}): KeyringEnvResult {
  const secretsmith = options.secretsmith ?? "secretsmith";
  // An explicitly-empty allowlist is a real no-op; only an undefined one
  // falls back to the default allowlist.
  const allowlist = options.allowlist ?? KEYRING_KEY_ALLOWLIST;
  const timeoutsMs = options.timeoutsMs ?? 15_000;

  const cacheKey = `${secretsmith}:${allowlist.join(",")}`;
  const existing = cache.get(cacheKey);
  if (existing) return existing;

  const failures: string[] = [];
  const raw = spawnSync(secretsmith, ["env"], {
    encoding: "utf8",
    timeout: timeoutsMs,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const env: Record<string, string> = {};
  if (raw.status === 0 && raw.stdout) {
    const want = new Set(allowlist);
    for (const line of raw.stdout.split("\n")) {
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq);
      if (!want.has(key)) continue;
      const value = line.slice(eq + 1).trim();
      if (value) env[key] = value;
    }
    for (const key of allowlist) {
      if (!env[key]) failures.push(key);
    }
  } else {
    failures.push(...allowlist);
  }

  const result: KeyringEnvResult = { env, failures };
  cache.set(cacheKey, result);
  return result;
}

/** Merge into the options the kernel env-builder consumes (union of keys). */
export function mergeKeyringEnv<K extends string>(
  patch: Record<string, string | null | undefined>,
  result: KeyringEnvResult,
  allowlist: readonly string[] = KEYRING_KEY_ALLOWLIST,
): Record<string, string | null | undefined> {
  const out: Record<string, string | null | undefined> = { ...patch };
  for (const [key, value] of Object.entries(result.env)) {
    if (!allowlist.includes(key)) continue;
    // Never overwrite an explicit caller-provided value.
    if (patch[key] !== undefined) continue;
    out[key] = value;
  }
  return out;
}