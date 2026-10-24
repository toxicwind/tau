# Changelog

All notable changes to `omp-mobile-autocorrect` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-10-02

### Added
- Initial release of `omp-mobile-autocorrect`.
- 2D QWERTY spatial distance matrix with 1.25x vertical thumb sweep penalty.
- Spatial Damerau-Levenshtein search with length bucketing for sub-millisecond lookups.
- Domain-aware lexical token classifier isolating protected code flags, file paths, URLs, camelCase, snake_case, and inline code fences from prose words.
- Dual lifecycle hooks:
  - `input` hook for interactive Termux TUI sessions.
  - `context` hook for pre-LLM MITM safety gate.
- Status bar telemetry via `ctx.ui.setStatus("autocorrect", ...)`.
- Full unit test suite and validation scripts.
