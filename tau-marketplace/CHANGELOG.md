# Changelog

All notable changes to `tau-marketplace` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-10-02

### Added
- Initial release of `tau-marketplace` as the official estate-scripts Estate marketplace under `ranch/tau-marketplace`.
- Conformance to the Claude Code / OMP marketplace schema (`marketplace.json`, `.omp-plugin/marketplace.json`, `.claude-plugin/marketplace.json`).
- Core curated plugin suite:
  - `omp-mobile-autocorrect` (v1.0.0): In-process MITM spatial QWERTY autocorrect for Termux and glass keyboards (sub-5ms, dual `input` and `context` hooks, status bar telemetry).
  - `vansrouter` (v1.0.0): Dynamic local OpenAI-compatible provider with live catalog sync from VansRouter (`:20128`).
  - `strict-bash-guard` (v1.0.0): Native tool guard blocking shell commands that duplicate built-in tools (`find`, `grep`, `cat`, `sed`).
  - `omp-model-router` (v1.0.0): Dynamic multi-model router, prompt classifier, token estimator, and cost governor.
  - `tau-kimi-auto` (v1.0.0): Virtual model provider resolving to the best healthy Kimi model via herd (`:25100`/`:25153`).
  - `omp-edit-committer` (v0.1.0): Conventional commit generator with visual hunk badges.
  - `omp-kafka` (v0.1.0): Real-time Kafka topic streaming consumer.
  - `tau-loops` (v1.0.0): Bounded diagnostic loops (`/loop-model-audit`, `/loop-dir-diff`, `/loop-probe`).
- Validation suite (`bin/validate.ts`) verifying catalog structure and plugin entrypoints.
- Moonrepo project integration (`moon.yml`).
