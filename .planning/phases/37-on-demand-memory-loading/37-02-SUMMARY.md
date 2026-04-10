---
phase: 37-on-demand-memory-loading
plan: 02
subsystem: memory/session-config
tags: [fingerprint, soul-storage, hot-tier, memory-lookup]
dependency_graph:
  requires: [37-01]
  provides: [fingerprint-wiring, soul-memory-storage, top3-hot-injection]
  affects: [session-config, session-memory, memory-store]
tech_stack:
  added: []
  patterns: [json_each-tag-lookup, fingerprint-extraction, idempotent-memory-init]
key_files:
  created:
    - src/memory/__tests__/soul-storage.test.ts
  modified:
    - src/memory/store.ts
    - src/manager/session-memory.ts
    - src/manager/session-config.ts
    - src/manager/__tests__/session-config.test.ts
    - src/manager/__tests__/bootstrap-integration.test.ts
decisions:
  - "storeSoulMemory as separate async method (option b) to avoid changing initMemory signature"
  - "findByTag uses inline prepared statement with json_each (not class-level prepared statement)"
  - "Updated bootstrap-integration tests to assert fingerprint output instead of raw SOUL.md"
metrics:
  duration: 5min
  completed: 2026-04-10
---

# Phase 37 Plan 02: Wire Fingerprint + SOUL.md Storage Summary

Fingerprint-based system prompt with SOUL.md as retrievable memory and top-3 hot memory cap

## Tasks Completed

| # | Task | Commit | Key Changes |
|---|------|--------|-------------|
| 1 | Add findByTag to MemoryStore + storeSoulMemory | 79f2393 | findByTag method, async storeSoulMemory, soul-storage tests |
| 2 | Refactor buildSessionConfig for fingerprint + top-3 | 5049785 | Fingerprint injection, slice(0,3), memory_lookup instruction |

## Implementation Details

**findByTag:** Uses SQLite `json_each()` to join on the tags JSON array column, returning frozen MemoryEntry arrays matching the specified tag.

**storeSoulMemory:** Async method on AgentMemoryManager that reads SOUL.md, checks for existing "soul" tagged entry (idempotent), and inserts with importance=1.0 and skipDedup=true.

**Fingerprint wiring:** buildSessionConfig now calls extractFingerprint + formatFingerprint instead of injecting raw SOUL.md. Output is ~200-300 tokens vs potentially thousands.

**Top-3 hot memories:** getHotMemories().slice(0, 3) caps injection at 3 entries (already sorted by importance descending from TierManager).

**Agent name instruction:** Every non-bootstrap system prompt includes "Your name is {name}. When using memory_lookup, pass '{name}' as the agent parameter."

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Bootstrap integration tests expected raw SOUL.md content**
- **Found during:** Task 2
- **Issue:** bootstrap-integration.test.ts asserted full SOUL.md text in system prompt
- **Fix:** Updated assertions to check for fingerprint format markers (## Identity, name from heading)
- **Files modified:** src/manager/__tests__/bootstrap-integration.test.ts
- **Commit:** 5049785

## Known Issues (Out of Scope)

- `src/mcp/server.test.ts` has pre-existing failure: tool count assertion expects 6 but 7 exist (from 37-01 adding memory_lookup). Not caused by this plan's changes.

## Verification

- `npx vitest run src/memory/__tests__/soul-storage.test.ts` -- 5/5 pass
- `npx vitest run src/manager/__tests__/session-config.test.ts` -- 15/15 pass
- `npx vitest run src/manager/__tests__/bootstrap-integration.test.ts` -- 4/4 pass
- Full suite: 836/837 pass (1 pre-existing failure unrelated to this plan)

## Self-Check: PASSED
