# Recovery: packages/catalog/src/types.ts

Main was corrupted by truncated tool uploads (PLACEHOLDER). **Do this on a machine with the repo:**

```bash
cd projects/sovereign-projects/tau
git fetch origin
git checkout 6100dc543553ef35cd7783d1f3727944cc24c09e -- packages/catalog/src/types.ts
# optional: add require_parameters (also in packages/catalog/src/openrouter-types.ts)
rm -f packages/catalog/src/types-a.ts packages/catalog/src/types-b.ts
git add packages/catalog/src/types.ts
git commit -m "fix(catalog): restore types.ts from 6100dc54"
git push origin main
```

## Already good on main

- Antigravity DEFAULT 4.3.0 + gemini-3.7/3.8 wire profiles (`ced0ee08`)
- stream-markup-healing HTML entity unescape (`6100dc54`)
- `packages/catalog/src/openrouter-types.ts` with `require_parameters` (`7ef1036`)

## Pending (Copilot PRs)

- https://github.com/toxicwind/tau/pull/2 — restore types via git show + openai-shared require_parameters
- https://github.com/toxicwind/tau/pull/1 — earlier attempt

After restore, still need `applyOpenAIGatewayRouting` to force `require_parameters: true` when `params.tools` is non-empty.
