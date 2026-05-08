# Phase 115 deferred items — out-of-scope discoveries

## During Plan 115-04 execution (2026-05-08)

### Pre-existing test failures NOT introduced by Plan 115-04

Confirmed via `git stash && npx vitest run src/manager/` — these tests
failed identically on the master commit `b9268a8` (Plan 115-04 T01) BEFORE
any T02 changes. They are out of scope per the scope-boundary rule (only
auto-fix issues directly caused by the current task's changes).

| Test file | Test | Notes |
|---|---|---|
| `src/manager/__tests__/bootstrap-integration.test.ts` | `buildSessionConfig with bootstrapStatus complete returns normal prompt` | Pre-existing |
| `src/manager/__tests__/bootstrap-integration.test.ts` | `buildSessionConfig with bootstrapStatus undefined returns normal prompt (backward compat)` | Pre-existing |
| `src/manager/__tests__/daemon-openai.test.ts` | All 6 sub-tests | Pre-existing — daemon-openai env / shutdown wiring |
| `src/manager/__tests__/daemon-warmup-probe.test.ts` | `EmbeddingService singleton invariant (src-level grep)` | Pre-existing — src-level grep regression |
| `src/manager/__tests__/dream-prompt-builder.test.ts` | `P1: systemPrompt contains verbatim '<agent>'s reflection daemon' template (D-03 verbatim)` | Pre-existing |
| `src/manager/__tests__/dream-prompt-builder.test.ts` | `P3: estimatedInputTokens ≤ 32_000 even with 1000 chunks × 100 tokens (truncation)` | Pre-existing — test timeout |
| `src/manager/__tests__/session-config.test.ts` | `MEM-01-C2: 50KB cap — 60KB MEMORY.md truncates to 50KB + marker` | Pre-existing — Phase 115-03 changed truncation marker text from `…(truncated at 50KB cap)` to `[TRUNCATED — N chars dropped, dream-pass priority requested]` but this MEM-01-C2 test still asserts the legacy marker. Should be updated by a future Phase 115 or operational maintenance plan. |
| `src/manager/__tests__/session-config.test.ts` | `cache HIT (matching fingerprint) → skips assembleConversationBrief, uses cached block` | Pre-existing |
| `src/manager/__tests__/session-config.test.ts` | `cache entry with stale fingerprint → cache miss, assembler called, new entry written` | Pre-existing |
| `src/manager/__tests__/session-config.test.ts` | `Test 10: memoryAssemblyBudgets threaded through to assembler + warn fires for over-budget` | Pre-existing |
| `src/config/__tests__/loader.test.ts` | `LR-RESOLVE-DEFAULT-CONST-MATCHES` | Pre-existing — system prompt directive list expanded but test fixture not updated |
| `src/config/__tests__/schema.test.ts` | `PR11: parse-regression — in-tree clawcode.yaml parses` | Pre-existing — depends on `clawcode.yaml` in repo root which is not present in workspace tree |
| `src/config/__tests__/clawcode-yaml-phase100*.test.ts` | both files (suite-level) | Pre-existing — same missing `clawcode.yaml` |

**Total:** 16 pre-existing failures across 8 test files. Plan 115-04 introduced
ZERO new failures (verified by `comm -23 post-t02-fails pre-t02-fails`).

### Out of scope for Plan 115-04 — deferred to follow-on plans

These items are mentioned in PLAN.md but were scope-aligned out by the
orchestrator's narrower `<success_criteria>` (matching the precedent
115-03 set when its T03/T04 were similarly scope-aligned):

- **`staticPrefixHash` field on `AssembledContext` return type** — operator
  observability for measuring static-section cache reuse independently of
  full-prefix reuse. Lands in **Plan 115-08 closeout** dashboard work.
- **`static_prefix_hash` column on `traces.db`** — same observability.
  Plan 115-08.
- **`latestStaticPrefixHashByAgent` Map on `SessionManager`** — per-agent
  cache for static-hash trend analysis. Plan 115-08.
- **`[diag] static-prefix-cache-bust` log line** — operator-grep-friendly
  signal when static portion changes (the high-cost cache eviction event).
  Plan 115-08.

The Phase 115-04 narrow scope (architecture: place sections, mark boundary,
keep SDK shape) lands the structural change. Operator-visible
observability layered on top arrives in 115-08.

## conversation-brief.test.ts — 2 pre-existing failures (not introduced by 115-06)

**Discovered while running full memory test suite during Plan 115-06 T03 verification.**

```
src/memory/__tests__/conversation-brief.test.ts
  Tests  2 failed | 13 passed
```

Both failures persist with `git stash` applied (i.e., pre-existing on master before any 115-06 changes). One assertion is `result.skipped === true` (line 499) where the actual value is `false`. Out of scope for 115-06; logging here per execution-flow Rule SCOPE BOUNDARY.


## src/manager/__tests__/ — 16 pre-existing failures (not introduced by 115-06)

**Discovered during post-execution advisor-suggested cross-suite check.**

```
src/manager/__tests__/daemon-openai.test.ts (10 tests | 7 failed)
src/manager/__tests__/daemon-warmup-probe.test.ts (24 tests | 1 failed)
src/manager/__tests__/bootstrap-integration.test.ts (4 tests | 2 failed)
src/manager/__tests__/session-config.test.ts (58 tests | 4 failed)
src/manager/__tests__/dream-prompt-builder.test.ts (12 tests | 2 failed)
```

Verified pre-existing via `git stash`-and-rerun: failures persist with all 115-06 changes stashed (master state pre-115-06). Out of scope per execution-flow Rule SCOPE BOUNDARY.


## During Plan 115-05 execution (2026-05-08)

### Pre-existing test failures NOT introduced by Plan 115-05

```
src/migration/__tests__/verifier.test.ts (2 failed) — Phase 81 verifier
  expects MEMORY.md / CLAUDE.md / USER.md / TOOLS.md present in fixture;
  fixture only ships agent.yaml + SOUL.md, so the assertion of "6 files
  present" never held.

src/migration/__tests__/memory-translator.test.ts (1 failed) — Phase 80
  memory-translator regex expected 1 store.insert( call but found 2.

src/cli/commands/__tests__/migrate-openclaw-complete.test.ts (1 failed)
  — Phase 82 SC-3 happy path test timed out at 5000ms.
```

Verified out-of-scope: these test files touch `src/migration/*` and
`src/cli/commands/migrate-openclaw-*`, which are entirely outside the
Plan 115-05 surface (memory tools, dream auto-apply, dream cron, trace
collector, trace store, daemon IPC handlers). Per the orchestrator's
scope-boundary rule, logged here as deferred — NOT auto-fixed.

### Plan 115-05 acceptance-criteria interpretation

PLAN.md T04 step 4 said "Vitest extension to one of the existing tool tests"
— the executor created a separate test file
`src/performance/__tests__/trace-collector-lazy-recall.test.ts` instead of
extending `clawcode-memory-search-tool.test.ts`. Substantively equivalent:
the test verifies the lazy_recall_call_count counter writer at the
TraceCollector layer, which is the correct test boundary for the writer
(the search-tool test would have to mock the daemon IPC handler stack to
exercise the increment). The acceptance criterion grep
`recordLazyRecallCall` ≥4 in daemon.ts holds regardless of which test
file pins it.

