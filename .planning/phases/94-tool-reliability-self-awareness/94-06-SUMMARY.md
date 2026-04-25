---
phase: 94-tool-reliability-self-awareness
plan: 06
subsystem: config
tags: [zod, schema, additive-optional, system-prompt, directives, prompt-cache, immutability, reloadable]

# Dependency graph
requires:
  - phase: 83-effort-extension
    provides: additive-optional schema blueprint (1st application — effortSchema)
  - phase: 86-dual-discord-model-picker-core
    provides: additive-optional + RELOADABLE_FIELDS pattern (allowedModels, 2nd application)
  - phase: 89-restart-greeting
    provides: additive-optional pattern (greetOnRestart / greetCoolDownMs, 3rd application)
  - phase: 90-memory-autoload
    provides: additive-optional pattern (memoryAutoLoad / memoryRetrievalTopK / memoryScannerEnabled, 4th-7th applications)
  - phase: 92-tool-self-awareness
    provides: additive-optional pattern (8th-prior application)
  - phase: 52-prompt-caching
    provides: stable-prefix mutable-suffix assembler split (insertion site for directive block)
provides:
  - defaults.systemPromptDirectives — fleet-wide default system-prompt directive record (D-09 file-sharing + D-07 cross-agent-routing)
  - agents.*.systemPromptDirectives — per-agent partial override (per-key merge)
  - resolveSystemPromptDirectives(agentOverride, defaults) — pure resolver, deterministic alphabetical sort, frozen output
  - renderSystemPromptDirectiveBlock(directives) — joins texts with double-newline; "" when no enabled directives
  - ContextSources.systemPromptDirectives — pre-rendered block prepended to stable prefix BEFORE identity
  - DEFAULT_SYSTEM_PROMPT_DIRECTIVES — verbatim D-09 + D-07 frozen constant
affects:
  - 94-05-auto-injected-tools — clawcode_share_file consumer relies on the file-sharing directive being present in the LLM prompt by default
  - future-CC-skills-with-directives — any future plan adding new default directives just appends to DEFAULT_SYSTEM_PROMPT_DIRECTIVES (record extension)
  - hot-reload — RELOADABLE_FIELDS now covers system-prompt directives at next-turn boundary (no daemon restart for directive edits)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "8th application of Phase 83/86/89/90/92 additive-optional schema blueprint — defaultsSchema field default-bearing, agentSchema field optional partial override, loader resolver merges per-key"
    - "Per-key partial-override merge — operator can flip enabled or text on one directive without re-stating the rest"
    - "Frozen-output resolver — Object.freeze(arr.map(Object.freeze(...))) for CLAUDE.md immutability invariant"
    - "Alphabetical sort for prompt-cache hash stability — same input → byte-identical output across processes"

key-files:
  created:
    - src/config/__tests__/schema-system-prompt-directives.test.ts
    - src/manager/__tests__/context-assembler-directives.test.ts
    - .planning/phases/94-tool-reliability-self-awareness/94-06-SUMMARY.md
  modified:
    - src/config/schema.ts (systemPromptDirectiveSchema, DEFAULT_SYSTEM_PROMPT_DIRECTIVES, defaultsSchema + agentSchema extension, configSchema default factory)
    - src/config/loader.ts (resolveSystemPromptDirectives + renderSystemPromptDirectiveBlock + ResolvedDirective interface + SystemPromptDirective type import)
    - src/config/types.ts (RELOADABLE_FIELDS — agents.*.systemPromptDirectives + defaults.systemPromptDirectives)
    - src/manager/context-assembler.ts (ContextSources.systemPromptDirectives optional field; prepend to stableParts BEFORE identity)
    - src/config/__tests__/loader.test.ts (resolver tests + DefaultsConfig fixtures)
    - src/config/__tests__/differ.test.ts (DefaultsConfig fixture extension)

key-decisions:
  - "Phase 94 TOOL-10 — 8th application of additive-optional schema blueprint; defaults.systemPromptDirectives default-bearing record (DEFAULT_SYSTEM_PROMPT_DIRECTIVES), agents.*.systemPromptDirectives optional partial override; v2.5 migrated configs without the field parse unchanged (REG-V25-BACKCOMPAT)"
  - "Phase 94 TOOL-10 — per-key merge in resolveSystemPromptDirectives (override?.field ?? defaults?.field); filter enabled && text !== ''; alphabetical sort for prompt-cache hash stability; frozen output (CLAUDE.md immutability)"
  - "Phase 94 TOOL-10 — D-09 file-sharing default text contains 'ALWAYS upload via Discord' + 'NEVER just tell the user a local file path' verbatim; D-07 cross-agent-routing contains 'suggest the user ask another agent' verbatim — pinned by static-grep regression"
  - "Phase 94 TOOL-10 — Pre-rendered block via renderSystemPromptDirectiveBlock + ContextSources.systemPromptDirectives string field; assembler prepends as FIRST element of stableParts BEFORE identity (single integration site, no duplicate prepends); empty string short-circuits — no marker block, no leading whitespace, byte-identical to no-directives baseline"
  - "Phase 94 TOOL-10 — RELOADABLE classification: next-turn boundary (assembler reads via resolver each turn). No socket/db/workspace restart required"

patterns-established:
  - "Pre-rendered block in ContextSources — caller (session-config) computes the block via the resolver+renderer pair; assembler stays a pure renderer of strings (no SDK or config types reach context-assembler.ts)"
  - "Alphabetical sort + Object.freeze on resolver output — required pattern for any future per-key resolver where prompt-cache hash stability matters"
  - "DEFAULT_<X> exported constant — frozen, verbatim, pinned by static-grep on its substrings"

requirements-completed: [TOOL-10]

# Metrics
duration: 7min
completed: 2026-04-25
---

# Phase 94 Plan 06: defaults.systemPromptDirectives + file-sharing/cross-agent-routing default directives Summary

**TOOL-10 wired: defaults.systemPromptDirectives ships D-09 file-sharing + D-07 cross-agent-routing as default-enabled fleet directives, per-agent partial override merges per-key, assembler prepends the block BEFORE identity in the stable prefix — 8th application of the Phase 83/86/89/90/92 additive-optional schema blueprint.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-04-25T05:38:34Z
- **Completed:** 2026-04-25T05:45:47Z
- **Tasks:** 2 (TDD: RED → GREEN)
- **Files modified:** 6 src/ files (3 schema/loader/types + 1 assembler + 2 fixture-touched tests)
- **Files created:** 2 new test files

## Accomplishments

- `defaults.systemPromptDirectives` field added to schema with D-09 + D-07 default-enabled entries; legacy v2.5 configs without the field parse unchanged (REG-V25-BACKCOMPAT).
- `agents.*.systemPromptDirectives` per-agent override field with partial-shape (`{enabled?, text?}`) — operators can flip one directive without restating others.
- `resolveSystemPromptDirectives` pure resolver: per-key merge of override over defaults, filters `enabled && text !== ""`, alphabetical sort for prompt-cache hash stability, frozen output.
- `renderSystemPromptDirectiveBlock` helper: joins directive texts with double-newline; returns `""` when no enabled directives (deterministic, no marker comments).
- `context-assembler.ts` integration: `ContextSources.systemPromptDirectives` (pre-rendered string) prepended as FIRST element of stableParts BEFORE identity. Single integration site.
- `RELOADABLE_FIELDS` registers both schema paths — directive edits take effect at next-turn boundary without daemon restart.
- 9 plan-targeted tests + 6 supplementary tests = 15 directive-specific tests pass; 297 total tests in the touched suites pass with zero regressions; zero new npm deps.

## Task Commits

Each task was committed atomically:

1. **Task 1: schema + resolver + assembler — 9 failing tests (RED)** — `43e0dfc` (test)
2. **Task 2: schema extension + resolver + assembler integration (GREEN)** — `65cd5d6` (feat)

_Plan metadata commit appended after STATE.md / ROADMAP.md updates._

## Files Created/Modified

### Created

- `src/config/__tests__/schema-system-prompt-directives.test.ts` — schema-level tests: shape, defaults presence, REG-V25-BACKCOMPAT, REG-OVERRIDE-PARTIAL, REG-OVERRIDE-TEXT, REG-OVERRIDE-NEW-DIRECTIVE, REG-MALFORMED-REJECTED, REG-DETERMINISTIC (12 tests).
- `src/manager/__tests__/context-assembler-directives.test.ts` — assembler integration tests: REG-ASSEMBLER-PREPENDS, REG-ASSEMBLER-PREPENDS-FIRST, REG-ASSEMBLER-EMPTY-WHEN-DISABLED, REG-DETERMINISTIC (4 tests).

### Modified

- `src/config/schema.ts` — added `systemPromptDirectiveSchema`, `systemPromptDirectiveOverrideSchema`, `DEFAULT_SYSTEM_PROMPT_DIRECTIVES` constant (frozen, verbatim D-09 + D-07 text), extended `defaultsSchema` with default-bearing record, extended `agentSchema` with optional partial override, extended `configSchema` defaults default-factory.
- `src/config/loader.ts` — added `ResolvedDirective` interface, `resolveSystemPromptDirectives` pure per-key merge resolver, `renderSystemPromptDirectiveBlock` block renderer; imported `SystemPromptDirective` from schema.
- `src/config/types.ts` — added `agents.*.systemPromptDirectives` and `defaults.systemPromptDirectives` to `RELOADABLE_FIELDS`.
- `src/manager/context-assembler.ts` — added optional `systemPromptDirectives: string` to `ContextSources`; prepends to stableParts BEFORE identity in `assembleContextInternal`.
- `src/config/__tests__/loader.test.ts` — added `resolveSystemPromptDirectives` + `renderSystemPromptDirectiveBlock` resolver tests (5 + 2 = 7 new tests); extended DefaultsConfig fixtures with `systemPromptDirectives: { ...DEFAULT_SYSTEM_PROMPT_DIRECTIVES }`.
- `src/config/__tests__/differ.test.ts` — extended `makeConfig` fixture with verbatim D-09 + D-07 directive entries (DefaultsConfig type now requires the new field).

## Decisions Made

1. **8th application of additive-optional schema blueprint** — `defaultsSchema.systemPromptDirectives` is `default(() => ({ ...DEFAULT_SYSTEM_PROMPT_DIRECTIVES }))`; legacy configs see `defaults.systemPromptDirectives` populated automatically. `agentSchema.systemPromptDirectives` is `optional()` with partial-shape override. Pattern matches Phase 83 effort, 86 allowedModels, 89 greetOnRestart, 90 memoryAutoLoad/memoryRetrievalTopK/memoryScannerEnabled, 92 (Phase 94 prior).
2. **Per-key merge resolver** — for each key in `union(keys(defaults), keys(override))`, `enabled = override?.enabled ?? defaults?.enabled ?? false`, `text = override?.text ?? defaults?.text ?? ""`, keep iff `enabled && text !== ""`. Operator can disable one directive without restating others (REG-OVERRIDE-PARTIAL contract).
3. **Alphabetical sort + frozen output** — `merged.sort((a, b) => a.key.localeCompare(b.key))` ensures byte-deterministic output for prompt-cache hash stability (REG-DETERMINISTIC); `Object.freeze` on the array and each entry enforces CLAUDE.md immutability invariant.
4. **Pre-rendered block in ContextSources** — split rendering between loader (resolver returns structured `ResolvedDirective[]`, renderer joins to string) and assembler (consumes the string). Keeps assembler agnostic to config types — no `import` of schema or config from `context-assembler.ts`. The session-config wiring layer will glue them together in a follow-up plan when consumers (94-05 file-share helper) need the directive in the prompt.
5. **Empty string short-circuits** — `if (sources.systemPromptDirectives && sources.systemPromptDirectives.length > 0)` ensures the no-directives case produces a stable prefix byte-identical to the pre-Phase-94 baseline (REG-ASSEMBLER-EMPTY-WHEN-DISABLED). No marker block, no leading whitespace, no `\n\n` — required for prompt-cache hash stability when operators opt out.
6. **Reloadable classification** — both schema paths added to `RELOADABLE_FIELDS`. Directive edits take effect on the next prompt assembly (per-turn boundary). Matches the Phase 90 MEM-01 reload semantics for `memoryAutoLoad`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] DefaultsConfig fixture missing systemPromptDirectives field broke loader.test.ts and differ.test.ts**
- **Found during:** Task 2 (GREEN — TypeScript compile after defaultsSchema extension)
- **Issue:** Adding the new default-bearing field to `defaultsSchema` widened the `DefaultsConfig` type. 6 in-test fixtures (5 in `loader.test.ts`, 1 in `differ.test.ts`) constructed `DefaultsConfig` literally and now failed type-check with "Property 'systemPromptDirectives' is missing".
- **Fix:** Extended each fixture to include `systemPromptDirectives: { ...DEFAULT_SYSTEM_PROMPT_DIRECTIVES }` (loader.test.ts via `replace_all` on the unique `memoryCueEmoji: "✅", // Phase 90 MEM-05` marker line). differ.test.ts inlined the verbatim D-09 + D-07 text since it does not import from schema.
- **Files modified:** `src/config/__tests__/loader.test.ts`, `src/config/__tests__/differ.test.ts`
- **Verification:** `npx tsc --noEmit` no longer reports any new errors in `src/config/` or `src/manager/context-assembler.ts`. The remaining 2 pre-existing errors at `src/config/loader.ts:274,313` (mcpServers push + effort enum mismatch) are pre-existing and unrelated to this plan.
- **Committed in:** `65cd5d6` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking — fixture extension required by widened DefaultsConfig type)
**Impact on plan:** Mechanical — additive schema fields always require fixture updates downstream. No scope creep. The pre-existing TS errors (loader.ts mcpServers push + effort enum) are out-of-scope — logged for a future cleanup plan.

## Issues Encountered

None — TDD flow proceeded cleanly. RED gate (12 failing tests) confirmed before implementation; GREEN gate (15 passing tests, 297 tests across touched suites with zero regressions) confirmed after implementation.

## Verification Results

- `npx vitest run src/config/__tests__/schema-system-prompt-directives.test.ts src/manager/__tests__/context-assembler-directives.test.ts --reporter=dot` — 15/15 passed
- `npx vitest run src/config/__tests__/loader.test.ts --reporter=dot` — 77/77 passed
- `npx vitest run src/config/ src/manager/__tests__/context-assembler-directives.test.ts src/manager/__tests__/context-assembler.test.ts --reporter=dot` — 355/355 passed (zero regressions across all touched suites)
- `git diff package.json` — empty (zero new npm deps)
- Static-grep regression pins (all confirmed):
  - `grep -q "ALWAYS upload via Discord" src/config/schema.ts` ✓ (D-09 verbatim)
  - `grep -q "NEVER just tell the user a local file path" src/config/schema.ts` ✓ (D-09 NEVER clause)
  - `grep -q "suggest the user ask another agent" src/config/schema.ts` ✓ (D-07 verbatim)
  - `grep -E '"file-sharing"|"cross-agent-routing"' src/config/schema.ts | wc -l` = 3 (≥ 2 required, both default keys + DEFAULT constant comment)
  - `grep -q "DEFAULT_SYSTEM_PROMPT_DIRECTIVES" src/config/schema.ts` ✓
  - `grep -q "export function resolveSystemPromptDirectives" src/config/loader.ts` ✓
  - `grep -q "Object.freeze" src/config/loader.ts` ✓ (immutability)
  - Resolver function body has no `node:fs|new Date|setTimeout` references (pure-fn invariant)

## Next Phase Readiness

- TOOL-10 plumbing complete. `94-05` (auto-injected `clawcode_share_file` tool) can now rely on the file-sharing directive being in the prompt by default — when fin-acquisition produces a PNG, the LLM receives the "ALWAYS upload via Discord" instruction in its stable prefix and won't say "see /home/clawcode/output.png".
- Session-config wiring is the natural next step: read agent's resolved config + defaults via `resolveSystemPromptDirectives(agent.systemPromptDirectives, defaults.systemPromptDirectives)`, render via `renderSystemPromptDirectiveBlock`, pass into `assembleContext` via `ContextSources.systemPromptDirectives`. This wiring is a separate plan (or rolled into 94-05 / a follow-up integration plan) — Plan 94-06 ships the schema + resolver + assembler primitives.
- ResolvedAgentConfig in `src/shared/types.ts` does NOT yet expose `systemPromptDirectives` — the resolver is currently called with the raw `AgentConfig.systemPromptDirectives` and `DefaultsConfig.systemPromptDirectives` directly. If a future plan needs a normalized resolved field on `ResolvedAgentConfig`, it can add one trivially (the resolver is callable from any consumption site).

## Self-Check: PASSED

**Files verified to exist:**
- FOUND: src/config/__tests__/schema-system-prompt-directives.test.ts
- FOUND: src/manager/__tests__/context-assembler-directives.test.ts
- FOUND: src/config/schema.ts (modified)
- FOUND: src/config/loader.ts (modified)
- FOUND: src/config/types.ts (modified)
- FOUND: src/manager/context-assembler.ts (modified)
- FOUND: src/config/__tests__/loader.test.ts (modified)
- FOUND: src/config/__tests__/differ.test.ts (modified)

**Commits verified to exist:**
- FOUND: 43e0dfc (Task 1 — RED)
- FOUND: 65cd5d6 (Task 2 — GREEN)

---
*Phase: 94-tool-reliability-self-awareness*
*Completed: 2026-04-25*
