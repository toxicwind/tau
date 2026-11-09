Describe behavior, get implementing files and line ranges. MUST use first for unknown locations; known strings/regex/symbols → `grep`, names → `glob`.
`query`: plain language, not regex; quoted phrases match whole. `grep_keywords`: likely verbatim terms, `[]` if unsure.
<<<<<<< ours — scope ``path`: one directory or `omp://` docs scope ...` in preamble `(preamble)` (S, confidence: medium)
// refused_by: statement_fold · collision: ``path`: one directory or `omp://` docs scope (`omp://<file>.md`…`
`path`: one directory or `tau://` docs scope (`tau://<file>.md` narrows); omitted = workspace root. Scope known subsystem; batch related questions. Searches live files, no index; no `:start-end` selector (judges whole files).
=======
`path`: one directory or file, host path or internal URL (`omp://`, `omp://<file>.md`, `skill://<name>`, `local://…`); omitted = workspace root. Scope known subsystem; batch related questions. Searches live files, no index; no `:start-end` selector (judges whole files).
>>>>>>> theirs — scope ``path`: one directory or `omp://` docs scope ...` · weave: run 'weave explain packages/coding-agent/src/prompts/tools/find.md' for per-hunk detail, 'weave check' to verify your resolution
<<<<<<< ours — scope `Hits strongest first: `path:start-end score s...` in preamble `(preamble)` (S, confidence: medium)
// refused_by: statement_fold · collision: `Hits strongest first: `path:start-end score snippet` (workspace…`
Hits strongest first: `path:start-end score snippet` (workspace-relative or `tau://`); read returned ranges. Scores: absolute comparable 0–1 probability; below ~0.4 = weak evidence, so widen query or use `grep` before concluding absence.
=======
Hits strongest first: `path:start-end score snippet` (workspace-relative, or URL under URL scope); read returned ranges. Scores: absolute comparable 0–1 probability; below ~0.4 = weak evidence, so widen query or use `grep` before concluding absence.
>>>>>>> theirs — scope `Hits strongest first: `path:start-end score s...`
