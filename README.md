# Tau: The Sovereign AI Agent Engine

Tau (formerly OMP) is the AI-native agent engine for the Sovereign ecosystem, designed for 1M+ context reasoning and multi-tool orchestration.

## Architecture
- **Engine Core:** Located in `packages/coding-agent/` and `packages/agent/`.
- **Orchestration:** Built for federated tool use via MCP and high-performance inference through the Herd inference router.
- **Monorepo Integration:** Part of the Sovereign workspace architecture (see `/README.md` in the monorepo root).

## Getting Started
1. **Setup:** Ensure you are running from the monorepo root.
2. **Development:** Use the standard Tau CLI, aliased in your `.bashrc`:
   `alias tau='/home/toxic/.local/bin/tau --cwd="$PWD"'`

## Documentation Index
- [Architecture Guide](/docs/ARCHITECTURE.md)
- [Setup Guide](/docs/SETUP.md)
- [Contributor Guide](/CONTRIBUTING.md)
- [Packages Overview](/docs/packages/)

---
*(Managed by the Sovereign infrastructure pipeline.)*
