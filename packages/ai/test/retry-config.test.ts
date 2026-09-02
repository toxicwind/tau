/**
 * Tests for the per-provider `ProviderRetryConfig` plumbing added so that
 * OpenCode Go / Zen (and any future free-tier gateway that asks for
 * multi-hour `retry-after-ms`) can wait end-to-end instead of failing fast
 * against the user-set `retry.maxDelayMs` ceiling.
 */
import { describe, expect, it } from "bun:test";
import { resolveProviderMaxRetryDelayMs, getProviderDefinition, type ProviderDefinition } from "@oh-my-pi/pi-ai";
import { opencodeGoProvider } from "../src/registry/opencode-go";
import { opencodeZenProvider } from "../src/registry/opencode-zen";
import "../src/registry/registry"; // ensure ALL is populated

describe("ProviderRetryConfig / resolveProviderMaxRetryDelayMs", () => {
	it("opencode-go is registered with unboundedRetryAfter: true", () => {
		expect(opencodeGoProvider.retry?.unboundedRetryAfter).toBe(true);
		const def = getProviderDefinition("opencode-go");
		expect(def?.retry?.unboundedRetryAfter).toBe(true);
	});

	it("opencode-zen is registered with unboundedRetryAfter: true", () => {
		expect(opencodeZenProvider.retry?.unboundedRetryAfter).toBe(true);
		const def = getProviderDefinition("opencode-zen");
		expect(def?.retry?.unboundedRetryAfter).toBe(true);
	});

	it("caller-supplied maxRetryDelayMs wins over the per-provider default", () => {
		expect(resolveProviderMaxRetryDelayMs(getProviderDefinition("opencode-zen"), 5_000)).toBe(5_000);
	});

	it("unbounded provider returns 0 (disabled cap) when caller does not override", () => {
		expect(resolveProviderMaxRetryDelayMs(getProviderDefinition("opencode-zen"), undefined)).toBe(0);
		expect(resolveProviderMaxRetryDelayMs(getProviderDefinition("opencode-go"), undefined)).toBe(0);
	});

	it("non-unbounded provider returns undefined when no default is set", () => {
		const def = { id: "fake", name: "fake" } as ProviderDefinition;
		expect(resolveProviderMaxRetryDelayMs(def, undefined)).toBeUndefined();
	});

	it("per-provider maxRetryDelayMs default applies when caller leaves it unset", () => {
		const def = {
			id: "fake",
			name: "fake",
			retry: { maxRetryDelayMs: 90_000 },
		} as ProviderDefinition;
		expect(resolveProviderMaxRetryDelayMs(def, undefined)).toBe(90_000);
	});

	it("unbounded beats maxRetryDelayMs when caller does not override", () => {
		const def = {
			id: "fake",
			name: "fake",
			retry: { maxRetryDelayMs: 90_000, unboundedRetryAfter: true },
		} as ProviderDefinition;
		expect(resolveProviderMaxRetryDelayMs(def, undefined)).toBe(0);
	});
});
