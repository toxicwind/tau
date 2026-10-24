# Contributing to omp-mobile-autocorrect

Contributions are welcome!

## Principles

1. **Sub-5ms Execution**: The engine runs in-process inside the agent loop. Never introduce I/O, heavy regex re-allocations, or daemon round-trips into the hot path.
2. **Never Break Code**: Any technical identifier, file path, CLI flag, URL, or symbol must remain 100% immune from spelling alterations. If in doubt, protect it.
3. **Ergonomic Grounding**: Distance costs must reflect real touch displacement on standard mobile virtual keyboards.

## Running Tests

```bash
bun test
bun run lint
```
