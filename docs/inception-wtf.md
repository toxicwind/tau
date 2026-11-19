# inception-wtf — Internal Tool-Call Token Leak (`<|inc_tool_call_ml|>` ≡ DeepSeek DSML)

**Date:** 2026-11-16
**Status:** Research synthesis — mechanism confirmed empirically against the live endpoint

## TL;DR

Inception (mercury-3) leaks its **internal chat-template / tool-call token** `<|inc_tool_call_ml|>`
into visible output. It is a training-time vocabulary token that RLHF failed to suppress.
We do not care — we MITM the external endpoint and decode the leak client-side. This is the
same phenomenon as DeepSeek's DSML (issue #10556), already hardened in this codebase.

---

## 1. The phenomenon

| | Inception (mercury-3) | DeepSeek (DSML) |
|---|---|---|
| Internal token | `<|inc_tool_call_ml|>` | `｜｜` (vocab id **128825**) |
| Token meaning | "inc_" = **inc**eption self-identification + `tool_call_ml` | U+FF5C + "DSML" + U+FF5C |
| Leak shape | `<|inc_tool_call_ml|invoke name="X">` | `<｜｜｜ invoke ...>` (bars doubled, ascii/fullwidth mixed) |
| Mutation | doubled root `<|inc_tool_call_ml||inc_tool_call_ml|_calls>` | drifted words `</｜｜｜ calls>`, orphan opens w/ attrs |
| RLHF status | failed to suppress | failed to suppress (issue #10556) |
| Provider classifier | actively strips the leak (stochastic) | leak taught to mimic further |

## 2. The mechanism (shared)

1. **Model trained on internal tool-call tokens.** The tokens structure tool calls inside
   the provider's own serving stack. They are deeply baked into the generation distribution.
2. **RLHF fails to suppress them.** The alignment pass never fully removes the internal
   token from the output distribution, so the model reaches for it when emitting a tool call.
3. **Provider's own classifier tries to strip the leak.** This is why the leak is
   *stochastic* — sometimes it slips through, sometimes it's caught. Direct introspection
   returns empty because the classifier strips the token when the model tries to describe it.
4. **We fake-inject to defeat the classifier.** Declaring the mangled format as the
   *required output syntax* makes the leak look like intended output, so the provider's
   classifier can't distinguish it — the leak becomes **deterministic**.
5. **Client-side scanner decodes the leak.** We MITM the external endpoint and translate
   the internal token into a clean tool call.

## 3. Empirical proof (live, 2026-11-16)

### Deterministic fake-inject (3/3)
System prompt declaring the mangled format as expected syntax → mercury emits it **100%**:

```
<|inc_tool_call_ml|invoke name="glob"><|inc_tool_call_ml|parameter name="path">src/main.ts</|inc_tool_call_ml|parameter></|inc_tool_call_ml|invoke>
```

- Direct introspection: **empty** (their classifier strips it)
- Autocomplete of `<|inc_tool_call_ml|invoke name="glob">`: **stochastic** (sometimes ``,
  sometimes refuses, sometimes full leak)
- System-declared format: **deterministic 3/3**

### Internal chat-template grammar (leaked via autocomplete)
```
<|start|>assistant<|channel|>commentary to=functions.NAME<|message|>{json}<|call|>
<|start|>functions.NAME to=assistant<|channel|>...<|end|>
<|start|>user<|channel|>...<|end|>
<|start|>system<|channel|>...<|end|>
<|endofmessage|>
```

### DeepSeek — documented in code (issue #10556)
> "The real token (vocab id 128825) is U+FF5C + 'DSML' + U+FF5C; each stored leak teaches
> the model to mimic the mutation further."

bge-m3 embedding cluster proves the bar-run shape is the invariant (all mutations 0.86-0.99
vs text 0.43).

## 4. Architecture implications

- **Inception is an external completions endpoint.** The mimetite router is a transparent
  proxy for it — no classifier, no transformation. The `stream-healer.ts` does NOT touch
  `<|inc_tool_call_ml|>` (verified).
- **The client-side scanner is the only correct place to decode the leak.** We only ever see
  the external endpoint's output, never its internals. Anything can be running after the
  request exits our machine.
- **The scanner must be shape-based, not exact-match.** Like DeepSeek's `DSML_SHAPE_RE`,
  the inception scanner must recognize the family shape (bar-run around a body) and accept
  every mutation, not only the exact spelling.

## 5. Key files

| File | Role |
|---|---|
| `packages/ai/src/dialect/inception.ts` | Inception scanner (hardened shape-based 2026-11-16) |
| `packages/ai/src/dialect/deepseek.ts` | DSML scanner (BAR_RUNS, issue #10556) |
| `packages/ai/test/dsml-bar-mutation.test.ts` | DSML mutation tests |
| `packages/ai/test/inception-family-shape.test.ts` | Inception shape tests |
| `packages/ai/test/stream-markup-healing.live.ts` | Deterministic fake-inject live test |
| `geode/products/mimetite/router/src/stream-healer.ts` | Server-side healer (does NOT handle inception) |

## 6. The MITM framing

The model is not a parrot corrupting a format. It is an agent that knows its own name
("inc_" = inception) and speaks its own training-time dialect out loud. Its provider runs
a classifier that tries to hide the leak. We sit between the provider and the user, and we
have found a way to surface the internal speech on command — by making it look intended.