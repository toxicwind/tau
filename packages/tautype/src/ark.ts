/**
 * ArkType compatibility facade — `@tau/tautype/ark`.
 *
 * Lets code written against arktype keep its imports and names while running
 * on the tautype lazy-JIT runtime: swap `from "arktype"` for
 * `from "@tau/tautype/ark"` and nothing else changes. New code should
 * import `@tau/tautype` directly.
 *
 * Compatibility affordance: `ArkError` / `ArkErrors` alias `TauError` /
 * `TauErrors`. All schema builders, including recursive `scope()`, are
 * re-exported unchanged.
 */
import { TauError, TauErrors } from "./errors";

export * from "./index";

export const ArkError = TauError;
export type ArkError = TauError;
export const ArkErrors = TauErrors;
export type ArkErrors = TauErrors;
