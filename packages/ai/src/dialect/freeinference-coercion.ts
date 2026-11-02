/**
 * freeinference coercion — model-specific tool-argument coercion recovery for
 * the three current FreeInference text models (deepseek-v4-flash, glm-5.3-flash,
 * qwen3.6-35b; bge-m3 is embeddings-only and skips tool calling entirely).
 *
 * Why this exists: all three models, when asked to render a flat array-of-strings
 * tool argument (e.g. a todo `init` `list[].items` or bare `items`), emit the
 * array elements as per-item markdown checklist lines INSIDE the JSON array:
 *
 *   {"op":"init","list":[{"phase":"Work","items":[
 *     "- [ ] Draft project proposal",
 *     "- [ ] Review team feedback"
 *   ]}]}
 *
 * rather than a clean string array (or a whole-checklist string). Captured live
 * from each model 2026-11-02 — the shape is identical across the family, so one
 * coercion applies to all three. Each item must be stripped of its bullet /
 * checkbox / ordered-list prefix, otherwise the persisted value (todo task
 * content) keeps the literal `- [ ] ` and exact-match targeting breaks.
 *
 * This module is the per-model contract surface: it documents each model's
 * coercion needs and exposes the shared recoverers. Consumers (the todo tool)
 * call parseMarkdownItem/parseMarkdownList from the base coercion module; this
 * file is the annotated FreeInference-facing registry the fixtures pin to.
 */
import { parseMarkdownItem, parseMarkdownList, coerceValue, decodeValue } from "./coercion";

/** The three current FreeInference text models that emit tool calls. */
export const FREEINFERENCE_TOOL_MODELS = ["deepseek-v4-flash", "glm-5.3-flash", "qwen3.6-35b"] as const;

export type FreeInferenceModel = (typeof FREEINFERENCE_TOOL_MODELS)[number];

/** Coerce a FreeInference tool-argument value against its JSON schema. */
export function coerceFreeInferenceValue(raw: string, schema: unknown): unknown {
	return coerceValue(raw, schema);
}

export { parseMarkdownItem, parseMarkdownList, decodeValue };
