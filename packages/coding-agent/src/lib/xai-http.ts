<<<<<<< ours — interstitial `file_header` (S+F, confidence: low)
// refused_by: merge_ladder_exhausted · collision: `import { getBundledModels } from "@oh-my-pi/pi-catalog/models";` +1 more
// Ported from NousResearch/hermes-agent (MIT) — tools/xai_http.py.

import { getBundledModels } from "@tau/tau-catalog/models";
import { $env } from "@tau/tau-utils";
import type { ModelRegistry } from "../config/model-registry";

=======
>>>>>>> theirs — interstitial `file_header` (S+F, confidence: low) · weave: run 'weave explain packages/coding-agent/src/lib/xai-http.ts' for per-hunk detail, 'weave check' to verify your resolution
/** Resolved endpoint and configured headers for an xAI HTTP tool request. */
export interface XAIHttpTransport {
	baseURL: string;
	headers?: Record<string, string>;
}
