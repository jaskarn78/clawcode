---
phase: quick
plan: 260409-whx
subsystem: types/tests
tags: [type-safety, test-fixtures, maintenance]
key-files:
  modified:
    - src/config/schema.ts
    - src/cli/commands/start-all.ts
    - src/manager/session-memory.ts
    - src/agent/__tests__/workspace.test.ts
    - src/bootstrap/__tests__/detector.test.ts
    - src/config/__tests__/differ.test.ts
    - src/config/__tests__/loader.test.ts
    - src/discord/__tests__/bridge-attachments.test.ts
    - src/discord/__tests__/router.test.ts
    - src/discord/subagent-thread-spawner.test.ts
    - src/discord/thread-manager.test.ts
    - src/heartbeat/__tests__/runner.test.ts
    - src/heartbeat/checks/__tests__/consolidation.test.ts
    - src/heartbeat/checks/__tests__/tier-maintenance.test.ts
    - src/manager/__tests__/config-reloader.test.ts
    - src/manager/__tests__/session-config.test.ts
    - src/manager/__tests__/session-manager.test.ts
    - src/manager/fork.test.ts
    - src/memory/__tests__/compaction.test.ts
    - src/memory/__tests__/consolidation.test.ts
    - src/memory/__tests__/embedder.test.ts
    - src/memory/__tests__/relevance.test.ts
    - src/memory/__tests__/tier-manager.test.ts
decisions:
  - "Used 'as unknown as Type' for mock casts that don't overlap sufficiently with real types"
  - "Added non-null assertions (!) on archiveToCold results in tier-manager tests since tests expect non-null"
metrics:
  duration: "~13min"
  completed: "2026-04-09"
  files_modified: 23
  errors_fixed: 53
---

# Quick Task 260409-whx: Fix Stale Test Fixture Type Definitions

Resolve all 53 TypeScript type errors from `npx tsc --noEmit` across 23 files to achieve zero errors.

## Changes Made

### Source Code Fixes (3 files)

1. **src/config/schema.ts** - Added missing `tiers` and `episodes` fields to memory schema defaults, and `zoneThresholds` to heartbeat contextFill defaults in both `defaultsSchema` and `configSchema` factory functions.

2. **src/cli/commands/start-all.ts** - Fixed `cliLog()` call with no arguments; `cliLog` requires a string parameter. Changed to `cliLog("")`.

3. **src/manager/session-memory.ts** - Fixed `EpisodeStore` constructor invocation from `new EpisodeStore({ store, embedder })` (object) to `new EpisodeStore(store, embedder)` (positional args) matching the actual constructor signature.

### Test Fixture Fixes (20 files)

Added missing required fields to `ResolvedAgentConfig` test fixtures across the codebase. The type accumulated new required fields over multiple phases (`reactions`, `mcpServers`, `skillsPath`, `admin`, `subagentModel`, `threads`, `slashCommands`) but older test fixtures were not updated.

- **11 test files**: Added missing `reactions`, `mcpServers`, and other fields to `makeConfig`/`makeAgent` helper functions
- **4 test files**: Changed `as Type` casts to `as unknown as Type` for mock objects that don't fully implement the target interface (MemoryStore, EmbeddingService, SessionLogger, Logger, SessionManager, Collection, Message, pipeline)
- **1 test file**: Added missing `tier` field to `SearchResult` and `MemoryEntry` fixtures
- **1 test file**: Added non-null assertions on `archiveToCold()` return values
- **1 test file**: Added missing `path` field to `SkillEntry` fixtures
- **1 test file**: Added missing root-level `mcpServers` to `Config` fixtures
- **1 test file**: Added missing `threads` to `DefaultsConfig` fixtures

## Verification

- `npx tsc --noEmit` exits with 0 errors (was 53)
- `npx vitest run` shows 753 passing tests; 5 pre-existing failures unrelated to this change

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Commits

| Hash | Description |
|------|-------------|
| a56dee4 | fix(260409-whx): resolve all TypeScript type errors across 23 files |
