# learn

> Capture a reusable lesson into long-term memory and optionally create or update a managed skill.

## Source

- Entry: `packages/coding-agent/src/tools/learn.ts`
- Model-facing prompt: `packages/coding-agent/src/prompts/tools/learn.md`
- Managed-skill helper: `packages/coding-agent/src/autolearn/managed-skills.ts`
- Local memory backend: `packages/coding-agent/src/memory-backend/local-backend.ts`
- Local lesson persistence: `packages/coding-agent/src/memories/index.ts` (`saveLearnedLesson(...)`)

## Registration / Visibility

- `loadMode = "essential"` and `strict = true`, so the tool remains top-level rather than mounting under `xd://`.
<<<<<<< ours — scope `- Approval is dynamic: a call containing `ski...` in heading `Registration / Visibility` (S, confidence: medium)
// refused_by: statement_fold · collision: `- Approval is dynamic: a call containing `skill`, or any call w…`
- Approval is dynamic: a call containing `skill`, or any call while `memory.backend = "local"`, has `approval = "write"`; a memory-only Hindsight/Mnemotau call has `approval = "read"`.
=======
- Approval is dynamic: a call containing `skill` or `scope: "global"`, or any call while `memory.backend = "local"`, has `approval = "write"`; any other memory-only Hindsight/Mnemopi call has `approval = "read"`.
>>>>>>> theirs — scope `- Approval is dynamic: a call containing `ski...` · weave: run 'weave explain docs/tools/learn.md' for per-hunk detail, 'weave check' to verify your resolution
<<<<<<< ours — scope `- Registration requires `autolearn.enabled = ...` in heading `Registration / Visibility` (S, confidence: medium)
// refused_by: statement_fold · collision: `- Registration requires `autolearn.enabled = true` (default `fa…`
- Registration requires `autolearn.enabled = true` (default `false`) and `memory.backend` equal to `"hindsight"`, `"mnemotau"`, or `"local"`.
=======
- Registration requires `autolearn.enabled = true` (default `false`) and `memory.backend` equal to `"hindsight"`, `"mnemopi"`, or `"local"`. Hindsight additionally requires a configured backend (`isHindsightConfigured(loadHindsightConfig(settings))`).
>>>>>>> theirs — scope `- Registration requires `autolearn.enabled = ...`
- Enabled top-level sessions auto-include `learn` in an ordinary explicit tool list. Subagents do not discover or auto-receive it, but may use it when their requested-tools/frontmatter list explicitly includes it.
- Execution is single-shot and emits no progress updates.

## Inputs

| Field     | Type                                                                                | Required | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------- | ----------------------------------------------------------------------------------- | -------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memory`  | `string`                                                                            |      Yes | Durable, self-contained lesson to remember: what, when, and why. The schema has no minimum length; backend-specific sanitization/storage determines whether an empty value succeeds.                                                                                                                                                                                                                                                                                                                                                        |
| `context` | `string`                                                                            |       No | Source context for the lesson.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `scope`   | `"project" \| "global"`                                                             |       No | `global` stores the lesson where every project recalls it: the shared Mnemopi bank, or an untagged Hindsight memory. In the schema and tool description only when `memory.backend` is `"mnemopi"` or `"hindsight"` and that backend's scoping (`mnemopi.scoping` / `hindsight.scoping`) is `global` or `per-project-tagged`, and for Hindsight only with `hindsight.globalScope = true` (default `false`), read from the session's Hindsight state so a subagent follows its parent's config from when it started; omitted means `project`. |
| `skill`   | `{ action: "create" \| "update"; name: string; description: string; body: string }` |       No | Managed skill to create or enhance after the lesson succeeds. `body` is Markdown without frontmatter.                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## Outputs

- Lesson only:
   - `content[0].text = "Lesson stored."` or `"Lesson queued for retention."`
   - `details = { skill: null }`
- Lesson plus skill:
   - `content[0].text = "<lesson result>. Created managed skill \"<name>\"."` or `"... Updated ..."`
   - `details = { skill: "<name>" }`
- Authored-skill name conflict returns `isError: true` after storing/queueing the lesson and reports `details = { skill: null, shadowed: true }`.

## Flow

<<<<<<< ours — scope `## Flow` in heading `Flow` (S+F, confidence: low)
// refused_by: statement_fold · collision: `1. `LearnTool.createIf(...)` exposes the tool only when `autole…`
## Flow
1. `LearnTool.createIf(...)` exposes the tool only when `autolearn.enabled` is true and `memory.backend` is `"hindsight"`, `"mnemotau"`, or `"local"`.
=======
1. `LearnTool.createIf(...)` checks `autolearn.enabled`, the supported backend, and Hindsight configuration when that backend is selected.
>>>>>>> theirs — scope `## Flow`
2. `execute(...)` stores the lesson before attempting any skill mutation:
<<<<<<< ours — scope `2. `execute(...)` stores the lesson before at...` in heading `Flow` (S+F, confidence: low)
// refused_by: statement_fold · collision: `- Mnemopi: calls `rememberScoped(...)` with `source: "coding-ag…`
   - Mnemotau: calls `rememberScoped(...)` with `source: "coding-agent-learn"`, `importance: 0.8`, `scope: "bank"`, extraction enabled, `veracity: "tool"`, `memoryType: "fact"`, and session/cwd/context metadata; an absent returned id is treated as failure.
   - Local backend: calls `localBackend.save(...)`, which normalizes and writes a project-scoped `learned.md`; `stored === 0` is treated as failure.
   - Hindsight: enqueues retention with `state.enqueueRetain(memory, context)` and reports the lesson as queued.
=======
   - Mnemopi: for `scope: "global"`, first resolves `state.getGlobalRetainTarget()`, which throws under `per-project` scoping before anything is stored or any skill is written; then calls `rememberScoped(...)` (with that target for a global lesson) with `source: "coding-agent-learn"`, `importance: 0.8`, `scope: "bank"`, fact and entity extraction enabled, `veracity: "tool"`, `memoryType: "fact"`, and session/cwd/context metadata. A thrown storage error is reported as `Mnemopi did not store the lesson: <reason>`; the return value is not checked.
   - Local backend: calls `localBackend.save(...)`, which normalizes and writes a project-scoped `learned.md`; `stored === 0` is treated as failure.
   - Local backend: rejects `scope: "global"` with `Global memory scope is not available with the local memory backend.` before storing or writing a skill.
   - Hindsight: awaits `state.enqueueRetain(toolCallId, [{ content: memory, context, scope }])`, which writes the lesson to the same [durable outbox as retain](./retain.md) before the lesson is reported as queued. A global lesson is retained untagged; `enqueueRetain` throws before queueing or writing a skill while `hindsight.globalScope` is off (`Hindsight global scope is off; set hindsight.globalScope to true to enable it.`), under `per-project` scoping (`Hindsight global scope requires global or per-project-tagged scoping.`), or when the outbox is full or unwritable.
>>>>>>> theirs — scope `2. `execute(...)` stores the lesson before at...`
3. If `skill` is absent, the tool returns after the memory write/queue.
4. If `skill.action == "create"`, the tool checks the lowercased/validated name against active authored skills. A conflict returns an error result after the lesson has already been stored or queued.
5. Otherwise, it calls `writeManagedSkill(...)`. Skill-write failure is rethrown as a partial outcome because lesson persistence already happened.
6. Unlike `manage_skill`, `learn` does not call the session's `refreshSkills` callback after writing. The managed skill is discovered on a later skill refresh/session.

## Modes / Variants

- Memory-only lesson capture.
- Lesson plus managed skill create/update for repeatable procedures worth codifying as `SKILL.md`.
- Backend-specific persistence: queued Hindsight, scoped Mnemotau SQLite, or project-scoped local `learned.md`.
- `create` fails if the managed skill file exists; `update` fails if it does not. Same-name in-process mutations are serialized.

## Side Effects

- Filesystem:
<<<<<<< ours — scope `## Side Effects` in heading `Side Effects` (S+F, confidence: low)
// refused_by: statement_fold · collision: `- Managed skills write `<agent-dir>/managed-skills/<sanitized-n…` +1 more
  - Local backend writes `<agent-dir>/memories/<encoded-cwd>/learned.md`.
  - Managed skills write `<agent-dir>/managed-skills/<sanitized-name>/SKILL.md`; the default agent directory is `~/.tau/agent`.
  - Mnemotau writes its scoped SQLite database.
=======
   - Local backend writes `<agent-dir>/memories/<encoded-cwd>/learned.md`.
   - Managed skills write `<agent-dir>/managed-skills/<sanitized-name>/SKILL.md`; the default agent directory is `~/.omp/agent`.
   - Mnemopi writes its scoped SQLite database.
   - Hindsight writes a private event file under `<agent-dir>/hindsight-outbox/` until the server accepts it.
>>>>>>> theirs — scope `## Side Effects`
- Network: Hindsight queue flushes to the configured server later. Mnemotau can schedule configured embedding/fact-extraction provider work after the synchronous row write; local file-backed storage itself is offline.
- Session state: reads backend state, settings, cwd, and session id. A skill created here is not immediately injected into the active skill list.
- Background work: Hindsight retention and Mnemotau extraction/embedding can continue after the tool result.

## Limits & Caps

- Availability requires `autolearn.enabled` plus a supported memory backend; both settings default to disabled/off.
- Managed skill names are trimmed and lowercased, then must match `[a-z0-9][a-z0-9-]{0,63}`.
- Managed descriptions are collapsed to one line and stripped of control/format characters, angle brackets, backticks, and repeated tildes.
- Final managed `SKILL.md` content, including generated frontmatter and description, is capped at `64_000` UTF-8 bytes.
- Managed skills never override authored skills; authored names win discovery.
- Local lessons are newest-first and deduplicated by normalized rendered line, with at most 100 lesson bullets. Lesson content is capped at 2,000 characters and context at 400 after prompt-injection neutralization and secret redaction. Writes serialize per lesson file in-process and preserve hand-edited headings, prose, and blank lines outside the lesson bullets.

## Errors

<<<<<<< ours — scope `## Errors` in heading `Errors` (S+F, confidence: low)
// refused_by: statement_fold · collision: none (1 contested hunk(s), neither side deleted the other's lines)
## Errors
- `Mnemotau backend is not initialised for this session.` when Mnemotau state is missing.
=======
- `Mnemopi backend is not initialised for this session.` when Mnemopi state is missing.
>>>>>>> theirs — scope `## Errors`
<<<<<<< ours — scope `- `Mnemopi did not store the lesson (no memor...` in heading `Errors` (S, confidence: medium)
// refused_by: statement_fold · collision: `- `Mnemopi did not store the lesson (no memory id returned).` w…`
- `Mnemotau did not store the lesson (no memory id returned).` when the local Mnemotau write returns no id; the optional skill is not attempted.
=======
- `Mnemopi did not store the lesson: <reason>` when the synchronous Mnemopi write throws; the optional skill is not attempted.
>>>>>>> theirs — scope `- `Mnemopi did not store the lesson (no memor...`
- `Lesson was empty after sanitization; nothing stored.` when local-backend normalization yields no lesson; the optional skill is not attempted.
- `Hindsight backend is not initialised for this session.` when Hindsight state is missing.
- Authored-name conflict on `skill.action = "create"` returns `isError: true`, `details = { skill: null, shadowed: true }`, after the lesson succeeds.
- Managed-skill validation, create/update, safety, or size failures throw `<lesson result>, but the managed skill could not be written: <reason>` after the lesson succeeds.

## Notes

- Use this tool sparingly. One precise reusable lesson is better than several vague memories.
- Put `skill` only on repeatable procedures; ordinary facts should remain memory-only.
- Managed skill frontmatter is generated from the normalized name and sanitized description; `body` must not include frontmatter.
- Managed skills are isolated from authored skills. `learn` writes them for a later discovery refresh; use `manage_skill` when the active session must refresh immediately after a mutation.
