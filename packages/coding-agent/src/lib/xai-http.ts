// refused_by: merge_ladder_exhausted · collision: `import { getBundledModels } from "@oh-my-pi/pi-catalog/models";` +1 more
// Ported from NousResearch/hermes-agent (MIT) — tools/xai_http.py.

import { getBundledModels } from "@tau/tau-catalog/models";
import { $env } from "@tau/tau-utils";
import type { ModelRegistry } from "../config/model-registry";

/** Resolved endpoint and configured headers for an xAI HTTP tool request. */
export interface XAIHttpTransport {
	baseURL: string;
	headers?: Record<string, string>;
}
