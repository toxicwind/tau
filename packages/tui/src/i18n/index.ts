// Minimal type-safe i18n runtime for tau — no external dep.
// ponytail: tiny runtime replaces @stacksjs/ts-i18n; swap if it measurably falls short.

import type { TranslationKeys } from "./types.js";
import en from "./locales/en.json" with { type: "json" };
import no from "./locales/no.json" with { type: "json" };

const locales: Record<string, Record<string, string>> = { en, no };
let current: string = "en";
let fallback: Record<string, string> = en;

export function initI18n(locale: string): void {
  current = locales[locale] ? locale : "en";
  fallback = en;
}

export function t(key: TranslationKeys, vars?: Record<string, string>): string {
  const table = locales[current] ?? fallback;
  let value = table[key] ?? fallback[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) value = value.replaceAll(`{{${k}}}`, v);
  }
  return value;
}

export type { TranslationKeys } from "./types.js";
