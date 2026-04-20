---
phase: 78-config-mapping-yaml-writer
plan: 02
subsystem: migration
tags: [migration, model-map, config-mapper, mcp, cli, tdd, pure-function, warning-union]

# Dependency graph
requires:
  - phase: 76-migration-cli-read-side-dry-run
    provides: "diff-builder WARNING_KINDS tuple (additive extension), PlanWarning union, getTargetBasePath/getTargetMemoryPath helpers"
  - phase: 77-pre-flight-guards-safety-rails
    provides: "Literal-string pinning culture (DAEMON_REFUSE_MESSAGE / SECRET_REFUSE_MESSAGE pattern), zero-new-deps discipline"
  - phase: 78-config-mapping-yaml-writer-01
    provides: "agentSchema.soulFile + identityFile + ResolvedAgentConfig expansion — MappedAgentNode's soulFile/identityFile targets are schema-valid"
provides:
  - "DEFAULT_MODEL_MAP (frozen 7-entry hardcoded table)"
  - "UNMAPPABLE_MODEL_WARNING_TEMPLATE (literal-pinned byte-exact copy)"
  - "parseModelMapFlag (throws on malformed, first-= split, repeatable aggregation)"
  - "mergeModelMap (pure merge — user overrides win)"
  - "mapModel (structured {mapped, warning} return)"
  - "mapAgent (pure function: OpenclawSourceEntry + modelMap + mcp map + target paths -> MappedAgentNode + structured warnings)"
  - "MappedAgentNode shape (name, workspace, memoryPath?, soulFile, identityFile, model, channels, mcpServers)"
  - "MapAgentWarning union (unknown-mcp-server | unmappable-model) — assignable to PlanWarning via widening"
  - "AUTO_INJECT_MCP = ['clawcode', '1password'] (dedup-aware)"
  - "diff-builder WARNING_KINDS extended +2 (unknown-mcp-server, unmappable-model)"
  - "--model-map <mapping...> CLI flag on `plan` AND `apply` subcommands (repeatable, fail-fast)"
  - "migrateOpenclawHandlers dispatch holder (ESM-safe commander-action indirection for test monkey-patching)"
affects: [78-03-yaml-writer, 79-workspace-copy, 80-memory-translation, 81-verify-rollback]

# Tech tracking
tech-stack:
  added: []  # Zero new deps — reuses existing node:path.join, existing test infra
  patterns:
    - "Structured warning union type (MapAgentWarning) that satisfies the PlanReport PlanWarning widening via field-aliasing (id -> detail, name -> detail)"
    - "Mutable dispatch holder (migrateOpenclawHandlers) for ESM-safe commander-action indirection — alternative to vi.spyOn on frozen named-import bindings"
    - "Fail-fast CLI flag validation: invalid --model-map syntax surfaces as exit 1 + literal stderr BEFORE any ledger/guard side-effect"
    - "Dedup-aware auto-inject: AUTO_INJECT_MCP + per-agent names merged via Set<string> seen-guard, preserves insertion order"

key-files:
  created:
    - "src/migration/model-map.ts"
    - "src/migration/config-mapper.ts"
    - "src/migration/__tests__/model-map.test.ts"
    - "src/migration/__tests__/config-mapper.test.ts"
    - "src/cli/__tests__/migrate-openclaw.test.ts"
  modified:
    - "src/migration/diff-builder.ts"
    - "src/migration/__tests__/diff-builder.test.ts"
    - "src/cli/commands/migrate-openclaw.ts"
    - ".gitignore"

key-decisions:
  - "Literal unmappable-model warning stored as exported constant UNMAPPABLE_MODEL_WARNING_TEMPLATE + rendered via renderUnmappableModelWarning(id) — single source of truth for the pinned copy; both id occurrences substitute, <clawcode-id> stays literal so operators see the override shape"
  - "mapModel returns {mapped, warning} structured — callers thread warning into PlanReport without a second pass; config-mapper only needs `mapped` field (warning copy is CLI-layer concern)"
  - "config-mapper does NOT render the literal warning string — emits structured warning {kind, id, agent} instead. Keeps mapper decoupled from warning-copy format; CLI / Plan 03 writer owns the copy"
  - "Unmappable model keeps RAW source string in node.model (not 'unknown' or null) — Plan 03 refuses to write when unmappable-model warning present unless --model-map override lands the mapping; intermediate state observable in plan output for operator inspection"
  - "AUTO_INJECT_MCP = ['clawcode', '1password'] as frozen readonly array — dedup-aware: explicit user declaration of these names is treated as redundant (silently absorbed), NOT as double-inject"
  - "Unknown per-agent MCP name -> unknown-mcp-server warning + skipped from mcpServers array (not hard error) — per 78-CONTEXT D-mcp: operator curates the top-level mcpServers map, missing entries are a soft signal not a failure"
  - "migrateOpenclawHandlers mutable dispatch holder — ESM-safe alternative to vi.spyOn(module, 'runPlanAction'). Direct named-import bindings are frozen in ESM after module init; dispatch-holder property swap works inside test beforeEach without vi.mock/vi.hoisted ceremony"
  - "--model-map parse error surfaces via process.exit(1) from INSIDE the commander .action() handler BEFORE runPlanAction/runApplyAction is called — fail-fast: typo in flag never touches ledger, never installs fs-guard"
  - "runPlanAction + runApplyAction accept modelMap?: Record<string,string> parameter but do not USE it yet — Plan 02 plumbs the value through for CLI test coverage; Plan 03's yaml-writer is the actual consumer (marked with void _modelMap + inline comment)"
  - "diff-builder WARNING_KINDS extended additively with 'unknown-mcp-server' + 'unmappable-model' — existing Phase 76 expected-diff.json fixture unchanged (mapper warnings are a new code path, not fired by buildPlan)"
  - ".gitignore: .planning/migration/ added — runtime ledger is per-host state, not source-controlled. Discovered during test run that leaked ledger.jsonl into working tree"

patterns-established:
  - "Pure migration module + TDD RED/GREEN cadence (mirrors Phase 77 Plan 02)"
  - "Structured warning union + PlanWarning-widening idiom — Plan 03's yaml-writer will aggregate MapAgentWarning[] into PlanReport.warnings[] via field rename (id -> detail, name -> detail)"
  - "ESM dispatch holder for CLI test monkey-patching — template for future CLI integration tests that need handler-level spies"
  - "Literal template + renderer helper pattern (UNMAPPABLE_MODEL_WARNING_TEMPLATE + renderUnmappableModelWarning) — single source of truth for load-bearing strings with parametric substitution"

requirements-completed:
  - CONF-02
  - CONF-03

# Metrics
duration: 11min
completed: 2026-04-20
---

# Phase 78 Plan 02: Model Map + Config Mapper + CLI Flag Summary

**Two pure-logic migration modules + CLI wiring landed: `model-map.ts` (hardcoded defaults + literal warning template + --model-map parser) and `config-mapper.ts` (mapAgent pure function). Plan 03's yaml-writer now has a stable, typed, fully-tested contract to consume — 36 new tests pin every edge case including byte-exact warning copy, MCP auto-inject dedup, and fail-fast CLI flag validation.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-04-20T18:49:13Z
- **Completed:** 2026-04-20T19:00:05Z
- **Tasks:** 2 (both TDD)
- **Files created:** 5
- **Files modified:** 4

## Accomplishments

- `model-map.ts`: DEFAULT_MODEL_MAP frozen 7-entry table (sonnet/opus/haiku variants + minimax + admin-clawdy passthrough)
- `model-map.ts`: UNMAPPABLE_MODEL_WARNING_TEMPLATE literal pinned byte-exact (em-dash U+2014, angle bracket placeholders, double-quotes around override template)
- `model-map.ts`: parseModelMapFlag — validates `=` separator, first-match split (values may contain `=`), fail-fast Error with "invalid --model-map syntax" + offending input
- `model-map.ts`: mergeModelMap — pure merge, user overrides win, defaults intact
- `model-map.ts`: mapModel — structured `{mapped, warning}` return for single-pass plan-report assembly
- `config-mapper.ts`: mapAgent pure function — OpenclawSourceEntry + targetBasePath/targetMemoryPath + modelMap + existingTopLevelMcp + perAgentMcpNames -> {node, warnings}
- `config-mapper.ts`: MappedAgentNode shape (name, workspace, memoryPath?, soulFile, identityFile, model, channels, mcpServers) — finmentum agents get distinct memoryPath; dedicated agents omit it (schema fallback inherits workspace per Phase 75)
- `config-mapper.ts`: AUTO_INJECT_MCP = ['clawcode', '1password'] dedup-aware unconditional injection
- `config-mapper.ts`: MapAgentWarning union — {kind: "unknown-mcp-server", name, agent} | {kind: "unmappable-model", id, agent}
- `diff-builder.ts`: WARNING_KINDS extended +2 (unknown-mcp-server, unmappable-model) — additive, Phase 76 expected-diff.json fixture unchanged
- `migrate-openclaw.ts`: renderWarnings yellow-colors both new kinds
- `migrate-openclaw.ts`: --model-map `<mapping...>` option on `plan` AND `apply` subcommands (repeatable via commander variadic syntax)
- `migrate-openclaw.ts`: Fail-fast parse — malformed --model-map triggers exit 1 + stderr literal BEFORE any handler runs (no ledger write, no fs-guard install)
- `migrate-openclaw.ts`: `migrateOpenclawHandlers` exported mutable dispatch holder — tests monkey-patch runPlanAction/runApplyAction without vi.mock hoisting (ESM-safe)
- `migrate-openclaw.ts`: runPlanAction + runApplyAction signatures accept `modelMap?: Record<string,string>` (plumbed-through; Plan 03 consumes)

## Task Commits

TDD tasks — 2 commits each (RED -> GREEN):

1. **Task 1 RED: model-map failing tests** — `43c4c0b` (test)
2. **Task 1 GREEN: model-map implementation** — `e62f85e` (feat)
3. **Task 2 RED: config-mapper + CLI failing tests** — `678373d` (test)
4. **Task 2 GREEN: config-mapper + CLI + diff-builder extension** — `b5455aa` (feat)

## Files Created/Modified

**Created:**
- `src/migration/model-map.ts` — DEFAULT_MODEL_MAP + UNMAPPABLE_MODEL_WARNING_TEMPLATE + parseModelMapFlag + mergeModelMap + mapModel + renderUnmappableModelWarning
- `src/migration/config-mapper.ts` — mapAgent pure function + MappedAgentNode + MapAgentWarning union + AUTO_INJECT_MCP
- `src/migration/__tests__/model-map.test.ts` — 18 tests covering all exports + literal warning byte-exact pin
- `src/migration/__tests__/config-mapper.test.ts` — 13 tests covering finmentum/dedicated paths, MCP auto-inject + dedup + unknown warnings, unmappable-model + override, channels passthrough, purity pins, PlanWarning widening
- `src/cli/__tests__/migrate-openclaw.test.ts` — 5 tests covering --model-map parse + thread (plan + apply), fail-fast on malformed, empty-map default

**Modified:**
- `src/migration/diff-builder.ts` — WARNING_KINDS extended +2 (unknown-mcp-server, unmappable-model)
- `src/migration/__tests__/diff-builder.test.ts` — WARNING_KINDS test updated from 4 to 6 expected kinds
- `src/cli/commands/migrate-openclaw.ts` — parseModelMapFlag import, renderWarnings extended, --model-map option on plan + apply, migrateOpenclawHandlers dispatch holder, runPlanAction + runApplyAction signatures extended with modelMap
- `.gitignore` — `.planning/migration/` (runtime ledger, per-host state)

## Test Counts

| Suite | New Tests | Notes |
|-------|-----------|-------|
| model-map | 18 | 17 plan + 1 smoke — covers DEFAULT_MODEL_MAP shape, frozen invariant, mapModel happy + unknown, parseModelMapFlag 8 variants, mergeModelMap purity, template substring pin |
| config-mapper | 13 | finmentum vs dedicated paths (2), MCP auto-inject + dedup + unknown (4), model mapping + override (2), channels passthrough (2), purity (2), PlanWarning widening (1) |
| CLI migrate-openclaw | 5 | --model-map plan (1), --model-map apply repeated (1), fail-fast parse (1), empty default (1), exitSpy smoke (1) |
| **Total new** | **36** | |
| **Regression (migration + cli + config)** | **704 passing** | 49 test files, 0 failures |

## Decisions Made

- **Literal warning in mapAgent stays structured, not rendered** — mapAgent emits `{kind: "unmappable-model", id, agent}`; the CLI / Plan 03 writer owns the literal copy render. Keeps the mapper decoupled from warning-copy format (and identical to Phase 76 PlanWarning shape).
- **Unmappable model preserves RAW source string in node.model** — not "unknown" placeholder, not null. Plan 03's writer gates on the unmappable-model warning being present; until then, operators see the actual OpenClaw id in the plan output for forensic clarity.
- **AUTO_INJECT_MCP dedup-aware** — user declaring 'clawcode' or '1password' explicitly in their OpenClaw source is a no-op (silently absorbed via `seen` set-guard). Avoids noise: inserted-twice would serialize as duplicate YAML refs; skipping is correct.
- **migrateOpenclawHandlers dispatch holder over vi.spyOn/vi.mock** — named-import bindings are frozen in ESM. vi.spyOn(module, "runPlanAction") mutates the namespace object but does NOT rebind the closure captured by commander.action(). The dispatch-holder `.runPlanAction = mock` swap works because the commander closure reads the property at call-time, not import-time. Simpler than vi.hoisted + vi.mock factory.
- **--model-map parse error inside .action() handler (not commander option .argParser)** — commander's argParser throws synchronously at parseAsync time, which trips program.exitOverride() and surfaces as CommanderError. Running parseModelMapFlag inside the action handler lets us route errors via cliError() + process.exit(1) with our literal copy, matching Phase 77 error surfacing conventions.
- **runPlanAction + runApplyAction plumb modelMap but don't use it yet** — Plan 02 scope explicitly called for threading, not consumption. Plan 03's writer is the consumer. `void _modelMap` + inline `// Plan 03 consumes` comment documents intent; tsc is satisfied because the parameter is typed.
- **WARNING_KINDS extension is additive** — existing Phase 76 `expected-diff.json` byte-parity test unchanged. The mapper is a NEW code path that buildPlan does not currently call; Plan 03 orchestrates the fold-in.
- **.gitignore addition for .planning/migration/** — discovered ledger.jsonl leaked into working tree from a test run. Runtime ledger is per-host state, not source-controlled.

## Deviations from Plan

**[Rule 2 - Missing Critical Functionality] Added `.gitignore` entry for `.planning/migration/`**
- **Found during:** Task 2 regression sweep (before final commit)
- **Issue:** Test runs left `.planning/migration/ledger.jsonl` in working tree (runtime state leaked into source control)
- **Fix:** Added `.planning/migration/` pattern to `.gitignore` — matches the existing `.planning/benchmarks/reports/` convention
- **Files modified:** `.gitignore`
- **Commit:** `b5455aa`

All other acceptance-criteria greps satisfied:
- `grep -Fn '⚠ unmappable model: <id> — pass --model-map "<id>=<clawcode-id>" or edit plan.json' src/migration/model-map.ts` → 1 match (EXACT byte-level pin)
- `grep -n 'DEFAULT_MODEL_MAP' src/migration/model-map.ts` → 2 matches (comment + export)
- `grep -n 'Object.freeze' src/migration/model-map.ts` → 1 match
- `grep -c '"anthropic-api/claude-' src/migration/model-map.ts` → 5 (5 anthropic entries)
- `grep -n 'minimax/abab6.5' src/migration/model-map.ts` → 1 match
- `grep -n 'clawcode/admin-clawdy' src/migration/model-map.ts` → 1 match (passthrough key+value on same line)
- `grep -n 'invalid --model-map syntax' src/migration/model-map.ts` → 2 matches (doc comment + thrown Error)
- `grep -n 'export function mapAgent' src/migration/config-mapper.ts` → 1 match
- `grep -n 'AUTO_INJECT_MCP' src/migration/config-mapper.ts` → 4 matches (constant + usages)
- `grep -Fn '"clawcode"' src/migration/config-mapper.ts` → 1 match (inside AUTO_INJECT_MCP)
- `grep -Fn '"1password"' src/migration/config-mapper.ts` → 1 match (inside AUTO_INJECT_MCP)
- `grep -n 'kind: "unknown-mcp-server"' src/migration/config-mapper.ts` → 2 matches (union + push)
- `grep -n 'kind: "unmappable-model"' src/migration/config-mapper.ts` → 2 matches (union + push)
- `grep -n '"unknown-mcp-server"' src/migration/diff-builder.ts` → 1 match (WARNING_KINDS)
- `grep -n '"unmappable-model"' src/migration/diff-builder.ts` → 1 match (WARNING_KINDS)
- `grep -c -- '--model-map' src/cli/commands/migrate-openclaw.ts` → 4 (option declaration + description on plan & apply)
- `grep -c 'parseModelMapFlag' src/cli/commands/migrate-openclaw.ts` → 3 (1 import + 2 usages)
- `npx vitest run src/migration/__tests__/model-map.test.ts` → 18/18 pass
- `npx vitest run src/migration/__tests__/config-mapper.test.ts src/cli/__tests__/migrate-openclaw.test.ts` → 18/18 pass
- `npx tsc --noEmit` → 0 errors in Plan 02 files (pre-existing unrelated errors in other files out of scope per SCOPE BOUNDARY — same as 78-01 SUMMARY)
- `git diff package.json` → 0 lines (zero new deps)

## Issues Encountered

None beyond the gitignore deviation documented above. Pre-existing TSC errors in unrelated files (src/usage/, src/manager/, src/tasks/, src/triggers/, src/ipc/) are NOT introduced by this plan — verified via `npx tsc --noEmit | grep -cE "config-mapper|model-map|migrate-openclaw"` returning 0. Out of scope per deviation-rules SCOPE BOUNDARY.

## Plan 03 Handshake

Plan 03 (yaml-writer) receives:

- **Import surface:** `mapAgent`, `MappedAgentNode`, `MapAgentResult`, `MapAgentWarning` from `src/migration/config-mapper.js`; `parseModelMapFlag`, `mergeModelMap`, `mapModel`, `DEFAULT_MODEL_MAP`, `UNMAPPABLE_MODEL_WARNING_TEMPLATE`, `renderUnmappableModelWarning` from `src/migration/model-map.js`.
- **Consumer contract:** Plan 03's writer iterates over PlanReport.agents, calls `mapAgent()` per entry with `modelMap = mergeModelMap(DEFAULT_MODEL_MAP, parseModelMapFlag(opts.modelMap ?? []))`, aggregates `MapAgentWarning[]` into `PlanReport.warnings[]` (field rename: id/name → detail), and refuses to write when any `unmappable-model` warning remains.
- **Warning copy:** Plan 03 owns the literal unmappable-model copy render — use `renderUnmappableModelWarning(warning.id)` when the CLI surfaces the warning to stderr; the template is already pinned in `model-map.ts`.
- **Discord channel wiring:** Plan 03 writes `node.channels` as the YAML `channels:` key. Empty-array agents (no discord binding) — Plan 03 decides whether to omit the key or emit `[]`; Phase 76 buildPlan already emits `missing-discord-binding` warning for these so the user is informed.
- **MCP server refs:** Plan 03 writes `node.mcpServers` as YAML string-array `mcpServers: [clawcode, 1password, ...]`. Top-level `mcpServers:` map is read-only from the writer's perspective (operator curates).
- **soulFile/identityFile:** Plan 03 writes the pointers as absolute paths (node.soulFile / node.identityFile). Phase 78-01 established the schema + lazy-read + expandHome semantics; the writer can trust these land unmodified.

## Regression Surface

Unchanged — all preserved:
- Phase 76 expected-diff.json byte-parity: WARNING_KINDS additions do not fire in buildPlan (new code path via mapAgent only).
- Phase 77 fs-guard / secret-scan / channel-collision / daemon-check: untouched.
- Phase 78-01 agentSchema + superRefine + session-config 3-branch precedence: untouched.
- Full migration + cli + config suites: 704/704 pass (49 test files).

## Self-Check: PASSED

- `src/migration/model-map.ts` — FOUND (DEFAULT_MODEL_MAP frozen 7-entry + template + 3 helpers)
- `src/migration/config-mapper.ts` — FOUND (mapAgent pure function + MappedAgentNode + MapAgentWarning)
- `src/migration/__tests__/model-map.test.ts` — FOUND (18 tests)
- `src/migration/__tests__/config-mapper.test.ts` — FOUND (13 tests)
- `src/cli/__tests__/migrate-openclaw.test.ts` — FOUND (5 tests)
- `src/migration/diff-builder.ts` — FOUND (WARNING_KINDS extended +2)
- `src/cli/commands/migrate-openclaw.ts` — FOUND (--model-map wiring + dispatch holder)
- `.gitignore` — FOUND (.planning/migration/ added)
- Commit `43c4c0b` — FOUND (Task 1 RED)
- Commit `e62f85e` — FOUND (Task 1 GREEN)
- Commit `678373d` — FOUND (Task 2 RED)
- Commit `b5455aa` — FOUND (Task 2 GREEN)

---
*Phase: 78-config-mapping-yaml-writer*
*Completed: 2026-04-20*
