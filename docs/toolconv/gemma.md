# Gemma 4 tool-calling format (token-delimited `call:NAME{…}`)

Tool-calling convention of Google's **Gemma 4** open-weights family (`google/gemma-4-*-it`). It differs from the prompt-driven Pythonic `tool_code` convention for Gemma 3 and malformed hosted Gemini output (see [gemini.md](gemini.md)): calls use **token-delimited brace syntax**, and strings use `<|"|>` rather than ASCII quotes. The model emits `<|tool_call>call:NAME{key:value,…}<tool_call|>`; the app parses it, runs the tool, and appends `<|tool_response>response:NAME{output:…}<tool_response|>`. Hosted Gemini's native structured API is separate from both text dialects.

<<<<<<< ours — scope `Verified against the OMP `gemma` dialect (`pa...` in heading `Gemma 4 tool-calling format (token-delimited `call:NAME{…}`)` (S, confidence: medium)
// refused_by: statement_fold · collision: `Verified against the OMP `gemma` dialect (`packages/ai/src/dial…`
Verified against the TAU `gemma` dialect (`packages/ai/src/dialect/gemma.ts`): the streaming scanner that parses these blocks and the `renderAssistantToolCalls` / `renderToolResults` / `renderTranscript` renderers that produce them. The example streams below match that implementation; the worked model id is `google/gemma-4-E2B-it`.
=======
OMP's `gemma` dialect is implemented in `packages/ai/src/dialect/gemma.ts`: `GemmaInbandScanner` parses these blocks, and `renderAssistantToolCalls`, `renderToolResults`, and `renderTranscript` produce them. OMP matches decoded marker strings rather than tokenizer IDs.
>>>>>>> theirs — scope `Verified against the OMP `gemma` dialect (`pa...` · weave: run 'weave explain docs/toolconv/gemma.md' for per-hunk detail, 'weave check' to verify your resolution

## Special tokens

Gemma 4 wraps each structural element in a paired token. Note the **asymmetric pipe placement** — an opener carries the pipe on the left (`<|x>`) and its closer carries it on the right (`<x|>`):

| Open                | Close               | Purpose                                                                                                                       |
| ------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `<bos>`             | —                   | Beginning of sequence                                                                                                         |
| `<\|turn>`          | `<turn\|>`          | One conversation turn; the role name is the first line of the body                                                            |
| `<\|tool_call>`     | `<tool_call\|>`     | One tool **call** emitted by the model                                                                                        |
| `<\|tool_response>` | `<tool_response\|>` | One tool **result** fed back to the model                                                                                     |
| `<\|channel>`       | `<channel\|>`       | Reasoning channel; `<\|channel>thought` opens the model's chain-of-thought (closed by `<channel\|>`) before the visible reply |
| `<\|"\|>`           | `<\|"\|>`           | String-literal delimiter (same token on both ends)                                                                            |
| `<eos>`             | —                   | End of sequence                                                                                                               |

Because the string delimiter is a token (`<|"|>`), values may contain raw ASCII quotes and commas without escaping — only a literal `<|"|>` token sequence cannot appear inside a string.

Thinking variants emit reasoning in a dedicated channel — `<|channel>thought\n…<channel|>` at the start of the model turn, before any reply text or tool call. The `gemma` scanner routes that channel to thinking events (keeping it out of the visible reply) and still parses tool calls that follow it; `renderThinking` round-trips a thought back to the same `<|channel>thought\n…<channel|>` block. With `parseThinking: false` the channel is left in the visible text instead.

## Roles / turn structure

Each turn is `<|turn>{role}\n{body}<turn|>`, and turns are concatenated with no separator. `renderTranscript` uses `system`, `user`, and `model` (`developer` renders as `system`), starts nonempty history with `<bos>`, and does not append a generation prompt. It merges an assistant turn with immediately following tool results into one `model` turn; a standalone result run also renders as a `model` turn.

## Tool definitions

The owned `gemma` prompt **does** carry each tool's normalized wire schema. `renderInbandToolPrompt` serializes one compact OpenAI-style object per line inside `<tools></tools>`, followed by the Gemma format guide:

```text
<tools>
{"type":"function","function":{"name":"get_current_temperature","description":"Gets the current temperature for a given location.","parameters":{"type":"object","properties":{"location":{"type":"string","description":"The city name, e.g. San Francisco"}},"required":["location"]}}}
</tools>
```

`renderToolInventory` is a separate verbose inventory used by the system prompt and `/dump`. It emits one `## functions` TypeScript `namespace functions { … }` block. Tool descriptions are `//` comments above `type NAME = (_: PARAMS);` declarations; configured examples appear as JSDoc-style `// @example` entries whose calls use Python keyword-argument syntax. It does not emit per-tool Markdown sections or native Gemma `<|tool_call>` examples.

## Tool-call format

The model emits one call per `<|tool_call>…<tool_call|>` block. The body is `call:NAME{ARGS}`, where `ARGS` is a comma-separated list of `key:value` pairs:

```text
<|tool_call>call:get_current_temperature{location:<|"|>London<|"|>}<tool_call|>
```

Value grammar inside `{…}`:

| Value kind    | Encoding             | Example                                  |
| ------------- | -------------------- | ---------------------------------------- |
| string        | `<\|"\|>text<\|"\|>` | `location:<\|"\|>London<\|"\|>`          |
| int / float   | bare                 | `count:42`                               |
| bool          | bare                 | `flag:true`                              |
| null          | bare                 | `unit:null`                              |
| list          | `[v,v,…]`            | `tags:[<\|"\|>a<\|"\|>,<\|"\|>b<\|"\|>]` |
| nested object | `{k:v,…}`            | `config:{theme:<\|"\|>dark<\|"\|>}`      |

The TAU parser is the streaming `GemmaInbandScanner` (`packages/ai/src/dialect/gemma.ts`), not a flat regex. For each `<|tool_call>` block it:

1. finds the matching `<tool_call|>` close, skipping any `<|"|>…<|"|>` string span so a `<tool_call|>` sequence that appears inside a string value does not end the block early;
2. matches the `call:NAME{` head, then takes the brace body up to its depth-matched `}`;
3. splits that body into `key:value` pairs at top-level commas — bracket depth (`[]`, `{}`) and `<|"|>` string spans are skipped — and decodes each value per the grammar above, so nested lists and objects parse correctly (a single-level regex would not).
   Calls are emitted only after the complete close marker arrives; there are no partial-argument events. If the stream is flushed with an unterminated tool block, OMP drops that incomplete block. A syntactically closed block with a missing final argument brace is still parsed from the available body.

The call name and object keys must match `[A-Za-z_]\w*`; segments with invalid keys or no top-level colon are skipped. This restriction also applies to nested object keys. The parser tolerates missing list/object closing delimiters once the tool close marker is present; malformed heads are consumed without a call.
<<<<<<< ours — scope `Calls are emitted only after the complete clo...` in heading `Tool-call format`, deleted in theirs (S, confidence: medium)
// refused_by: statement_fold · collision: none (no common ancestor text)
Calls are emitted only after the complete close marker arrives; there are no partial-argument events. If the stream is flushed with an unterminated tool block, TAU drops that incomplete block. A syntactically closed block with a missing final argument brace is still parsed from the available body.
=======
>>>>>>> theirs — scope `Calls are emitted only after the complete clo...` deleted in theirs

## Multiple / parallel tool calls

Parallel calls are consecutive `<|tool_call>…<tool_call|>` blocks (one call each), returned in order. The application returns one `<|tool_response>` per call in the same order.

## Tool-result format

Each result is `<|tool_response>response:NAME{output:VALUE}<tool_response|>`. `renderToolResults` always wraps the result under a single `output` key, and `JSON.parse`s the tool's text first — so JSON output becomes a nested object/array in the brace syntax, while a plain string is wrapped in `<|"|>…<|"|>`:

```text
<|tool_response>response:get_current_weather{output:{temperature:15,weather:<|"|>sunny<|"|>}}<tool_response|>
<|tool_response>response:read{output:<|"|>FILE<|"|>}<tool_response|>
```

The Gemma wire form has no dedicated success/error field. TAU renders `isError` results in the same `response:NAME{output:…}` shape as successful results, so any failure indication must be present in the result text itself.

## End-to-end example

`renderTranscript` output for a weather query with developer instructions (rendered as `system`). The call merges with its following result into one `model` turn, and the final answer is the next `model` turn. Turns abut with no separator. This lower-level renderer does not inject the catalog itself; owned requests append it separately to the provider's system prompt:

```text
<bos><|turn>system
You are a helpful assistant.<turn|><|turn>user
Hey, what's the weather in Tokyo right now?<turn|><|turn>model
<|tool_call>call:get_current_weather{location:<|"|>Tokyo, JP<|"|>}<tool_call|><|tool_response>response:get_current_weather{output:{temperature:15,weather:<|"|>sunny<|"|>}}<tool_response|><turn|><|turn>model
The current weather in Tokyo is 15 degrees Celsius and sunny.<turn|>
```

## Parsing notes & gotchas

- **String delimiter is a token, not a quote.** Inside `<|"|>…<|"|>` the bytes `"` and `,` are literal data — the example `<|"|>The city and state, e.g. "San Francisco, CA"…<|"|>` contains both. Split arguments on `,`/`}` only **outside** a `<|"|>…<|"|>` span.
- **Asymmetric pipes.** The closer is `<tool_call|>`, not `</tool_call>` or `<|tool_call>`. Matching the wrong pipe side will never close the block.
- **One call per block.** Unlike a JSON `tool_calls[]` array, parallelism is "more blocks", not "more entries in one block".
<<<<<<< ours — heading `Parsing notes & gotchas` (S, confidence: medium)
// refused_by: merge_ladder_exhausted · collision: none (1 contested hunk(s), neither side deleted the other's lines)
- **Bare scalars.** A value not wrapped in `<|"|>` is `true`/`false` → bool, `null`/`none` → null, numeric → number, otherwise a bare string (e.g. an unquoted enum or type name like `STRING`).
- **Tool-call ids are synthesized.** The format carries no id; after receiving a complete closed block, TAU parses it and emits adjacent `toolStart`/`toolEnd` events with a newly minted id. Rendered responses are correlated by surrounding message order/name.
- **Not Gemma 3 / hosted Gemini.** Those use the Pythonic `tool_code` / `default_api` form in `gemini.md`. Gemma 4 replaced it with this token syntax; the two are not interchangeable.
- **Gemma 3 automatic-selection caveat.** TAU's current family affinity maps Gemma 3 and Gemma 4 model IDs to `gemma`. If a Gemma 3 model is marked `supportsTools: false`, `tools.format=auto` therefore chooses this Gemma 4 grammar even though Gemma 3 requires the Pythonic convention in `gemini.md`; set `tools.format=gemini` explicitly.
=======
- **Bare scalars.** A value not wrapped in `<|"|>` is `true`/`false` → bool, `null`/`none`/`None` → null, numeric → number, otherwise a bare string (e.g. an unquoted enum or type name like `STRING`).
- **Tool-call ids are synthesized.** The format carries no id; after receiving a complete closed block, OMP parses it and emits adjacent `toolStart`/`toolEnd` events with a newly minted id. Rendered responses are correlated by surrounding message order/name.
- **Not the Gemini dialect.** Gemma 3's Pythonic prompting uses the convention in [gemini.md](gemini.md); hosted Gemini native tool calls use structured API parts. Neither is this token syntax.
- **Gemma 3 automatic-selection caveat.** OMP's current family affinity maps Gemma 3 and Gemma 4 model IDs to `gemma`. If a Gemma 3 model is marked `supportsTools: false`, `tools.format=auto` therefore chooses this Gemma 4 grammar even though Gemma 3 requires the Pythonic convention in `gemini.md`; set `tools.format=gemini` explicitly.
>>>>>>> theirs — heading `Parsing notes & gotchas` (S, confidence: medium)

## omp / pi converter behavior

Set `tools.format` to `gemma` to force this dialect. The default `auto` keeps native tools unless `supportsTools === false`, then uses the model-class affinity. `PI_DIALECT=gemma` is consulted only when the configured dialect resolver returns no owned dialect.

With tools present, owned mode appends the compact catalog and format guide, omits native tools/`tool_choice`, and uses `encodeInbandToolHistory`, not `renderTranscript`. Assistant turns with calls become prose plus call blocks, without their thinking/image blocks; call-free assistant turns stay unchanged. Result runs become synthetic **user** messages containing response blocks, with result images retained separately. They are not merged into model turns on this provider-request path.

The owned stream enables thinking parsing and discards output from a fabricated `<|tool_response>` onward. `tools.abortOnFabricatedResult` defaults to `true` and aborts the provider at that boundary; disabling it only changes whether the discarded continuation is drained. Named native calls are forwarded if a provider still emits them; the first native/in-band channel to produce a call wins.

## Sources

<<<<<<< ours — scope `- OMP `gemma` dialect implementation: `packag...` in heading `Sources` (S, confidence: medium)
// refused_by: statement_fold · collision: `- OMP `gemma` dialect implementation: `packages/ai/src/dialect/…`
- TAU `gemma` dialect implementation: `packages/ai/src/dialect/gemma.ts` (scanner + renderers), `packages/ai/src/dialect/catalog.ts` + `packages/ai/src/dialect/prompt-template.md` (tool catalog), `packages/ai/src/dialect/gemma.md` (format guide).
=======
- OMP `gemma` dialect: `packages/ai/src/dialect/gemma.ts` (scanner/renderers), `catalog.ts` + `prompt-template.md` (tool catalog), `gemma.md` (format guide), `history.ts` (provider history), `owned-stream.ts` (projection); selection: `packages/catalog/src/identity/dialect.ts`, `packages/coding-agent/src/sdk.ts` (`resolveDialect`), `packages/agent/src/agent-loop.ts` (`resolveOwnedDialectFromEnv`).
>>>>>>> theirs — scope `- OMP `gemma` dialect implementation: `packag...`
- Function calling with Gemma 4: https://ai.google.dev/gemma/docs/capabilities/text/function-calling-gemma4
- Gemma 4 prompt formatting: https://ai.google.dev/gemma/docs/core/prompt-formatting-gemma4
