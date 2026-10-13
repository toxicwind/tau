import { describe, expect, test } from "bun:test";
import {
  applyDotsRequestShaping,
  DOTS_REASONING_MAX_TOKENS,
  DOTS_STOP_SEQUENCES,
  DOTS_TEMPERATURE,
  isDotsModel,
} from "../src/providers/openai-shared";

describe("applyDotsRequestShaping (SovereignDotsClient coercions)", () => {
  test("no-op for non-Dots models", () => {
    const params: Record<string, unknown> = { temperature: 0.7 };
    applyDotsRequestShaping(params, "openai/gpt-4o");
    expect(params).toEqual({ temperature: 0.7 });
  });

  test("no-op for undefined model", () => {
    const params: Record<string, unknown> = {};
    applyDotsRequestShaping(params, undefined);
    expect(params).toEqual({});
  });

  test("sets temperature 0.1 when caller did not specify one", () => {
    const params: Record<string, unknown> = {};
    applyDotsRequestShaping(params, "openrouter/dots-studio/dots-3-note-preview:free");
    expect(params.temperature).toBe(DOTS_TEMPERATURE);
    expect(DOTS_TEMPERATURE).toBe(0.1);
  });

  test("respects caller-specified temperature", () => {
    const params: Record<string, unknown> = { temperature: 0.5 };
    applyDotsRequestShaping(params, "dots-studio/dots-3-note-preview:free");
    expect(params.temperature).toBe(0.5);
  });

  test("sets Dots stop sequences when none present", () => {
    const params: Record<string, unknown> = {};
    applyDotsRequestShaping(params, "openrouter/dots-studio/dots-3-note-preview:free");
    expect(params.stop).toEqual(DOTS_STOP_SEQUENCES);
    expect(DOTS_STOP_SEQUENCES).toContain("</tool_call>");
    expect(DOTS_STOP_SEQUENCES).toContain("</dots_function_call>");
  });

  test("respects caller stop sequences", () => {
    const params: Record<string, unknown> = { stop: ["custom"] };
    applyDotsRequestShaping(params, "openrouter/dots-studio/dots-3-note-preview:free");
    expect(params.stop).toEqual(["custom"]);
  });

  test("caps reasoning at 128 tokens and excludes it", () => {
    const params: Record<string, unknown> = {};
    applyDotsRequestShaping(params, "openrouter/dots-studio/dots-3-note-preview:free");
    expect(params.reasoning).toEqual({ max_tokens: DOTS_REASONING_MAX_TOKENS, exclude: true });
    expect(DOTS_REASONING_MAX_TOKENS).toBe(128);
  });

  test("matches Dots family by id substring (case-insensitive)", () => {
    expect(isDotsModel("openrouter/dots-studio/dots-3-note-preview:free")).toBe(true);
    expect(isDotsModel("flock/dots-studio/dots-3-note-preview:free")).toBe(true);
    expect(isDotsModel("DOTS-custom")).toBe(true);
    expect(isDotsModel("openai/gpt-4o")).toBe(false);
  });
});
