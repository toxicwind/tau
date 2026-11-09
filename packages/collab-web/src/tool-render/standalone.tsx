/**
<<<<<<< ours
 * Entry point for the self-contained tool-view bundle embedded in HTML
 * session exports (built by scripts/build-tool-views.ts; React included).
 * Importing registers `<tau-tool-view>`.
||||||| base
 * Entry point for the self-contained tool-view bundle embedded in HTML
 * session exports (built by scripts/build-tool-views.ts; React included).
 * Importing registers `<omp-tool-view>`.
=======
 * Tool-view registration included in the shared HTML export viewer
 * (built by scripts/build-export-viewer.ts; React included).
 * Importing registers `<omp-tool-view>`.
>>>>>>> theirs · weave: run 'weave explain packages/collab-web/src/tool-render/standalone.tsx' for per-hunk detail, 'weave check' to verify your resolution
 */
import { defineToolViewElement } from "./element";

defineToolViewElement();
