---
phase: 25-episode-memory
verified: 2026-04-09T20:17:00Z
status: gaps_found
score: 4/6 must-haves verified
re_verification: false
gaps:
  - truth: "CLI memory command shows episode count and supports episode listing"
    status: failed
    reason: "The CLI sends IPC request type 'episode-list' but daemon.ts has no handler for this method. It falls through to the default case which throws ManagerError('Unknown method: episode-list'). The feature is wired on the CLI side but the IPC server side is completely unimplemented."
    artifacts:
      - path: "src/cli/commands/memory.ts"
        issue: "Sends 'episode-list' IPC request — correct implementation"
      - path: "src/manager/daemon.ts"
        issue: "No 'case episode-list' handler. Last case is 'memory-list' at line 624, then default throws. EpisodeStore is never instantiated in AgentMemoryManager either."
      - path: "src/manager/session-memory.ts"
        issue: "AgentMemoryManager does not create or hold EpisodeStore instances — no episodeStores map, no EpisodeStore import"
    missing:
      - "Add 'case episode-list' in daemon.ts handleRequest() switch statement"
      - "Import EpisodeStore in daemon.ts or session-memory.ts"
      - "Add episodeStores map to AgentMemoryManager so daemon can resolve EpisodeStore per agent"
      - "Implement the handler to call episodeStore.listEpisodes(limit) and episodeStore.getEpisodeCount()"

  - truth: "config/schema.ts default values are consistent with expanded memoryConfigSchema"
    status: failed
    reason: "Phase 25 added 'episodes' field to memoryConfigSchema in src/memory/schema.ts, but the default values in src/config/schema.ts (lines 139-145 and 169) were not updated to include 'episodes' or 'tiers'. This causes TypeScript errors TS2769 in config/schema.ts and downstream TS2739 errors in config/__tests__/differ.test.ts and config/__tests__/loader.test.ts."
    artifacts:
      - path: "src/config/schema.ts"
        issue: "Lines 139-145 and 169: memory default objects missing 'tiers' and 'episodes' fields, causing TS2769 overload mismatch errors"
      - path: "src/config/__tests__/differ.test.ts"
        issue: "TS2739: test fixture memory object missing 'tiers' and 'episodes' fields"
      - path: "src/config/__tests__/loader.test.ts"
        issue: "TS2739: test fixture memory object missing 'tiers' and 'episodes' fields"
    missing:
      - "Add 'tiers: { hotAccessThreshold: 3, hotAccessWindowDays: 7, hotDemotionDays: 7, coldRelevanceThreshold: 0.05, hotBudget: 20 }' to memory defaults in config/schema.ts lines 139-145 and 169"
      - "Add 'episodes: { archivalAgeDays: 90 }' to memory defaults in config/schema.ts lines 139-145 and 169"
      - "Update differ.test.ts and loader.test.ts fixture objects to include 'tiers' and 'episodes'"
human_verification:
  - test: "Run 'clawcode memory episodes <agent>' with a running manager and agent"
    expected: "Either returns episode list or 'No episodes recorded for <agent>' — not an error"
    why_human: "Cannot test IPC round-trip without a running daemon process"
---

# Phase 25: Episode Memory Verification Report

**Phase Goal:** Agents can record and retrieve significant discrete events as first-class memory objects
**Verified:** 2026-04-09T20:17:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | Episodes can be stored with title, summary, importance, tags, and timestamp | VERIFIED | `EpisodeStore.recordEpisode` in `src/memory/episode-store.ts` validates via `episodeInputSchema`, stores with structured `[Episode: {title}]\n\n{summary}` content format, importance defaults to 0.6, auto-adds "episode" tag |
| 2 | Episodes appear in semantic search results alongside regular memories | VERIFIED | Episodes inserted into shared `memories` table with `source='episode'` and vector in `vec_memories` via the same `MemoryStore.insert` path. SemanticSearch test confirms retrieval. |
| 3 | Episode source type is a first-class MemorySource value | VERIFIED | `MemorySource` union includes `"episode"` in `types.ts`. `memorySourceSchema` enum includes `"episode"`. CHECK constraint in `store.ts` includes `'episode'`. `migrateEpisodeSource()` handles existing databases. |
| 4 | Episodes older than archivalAgeDays can be archived monthly | VERIFIED | `archiveOldEpisodes` in `src/memory/episode-archival.ts` queries by `created_at < cutoff` and `tier != 'cold'`, calls `store.updateTier(id, 'cold')` and deletes from `vec_memories`. 7 passing tests confirm all edge cases. |
| 5 | Archived episodes are moved to cold tier and removed from vector search | VERIFIED | `archiveOldEpisodes` explicitly deletes `FROM vec_memories WHERE memory_id = ?` after tier update. Test at line 122 confirms vec_memories count drops to 0 after archival. |
| 6 | CLI memory command shows episode count and supports episode listing | FAILED | CLI (`memory.ts`) sends `"episode-list"` IPC request correctly, but `daemon.ts` has no `case "episode-list"` handler — falls to `default: throw ManagerError("Unknown method: episode-list")`. `AgentMemoryManager` has no `EpisodeStore` instances. The IPC contract is broken end-to-end. |

**Score:** 5/6 truths verified (EPSD-01, EPSD-02, EPSD-03, EPSD-04 storage/archival verified; EPSD-04 CLI visibility blocked)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/memory/types.ts` | EpisodeInput type and 'episode' in MemorySource | VERIFIED | `MemorySource` includes `"episode"` at line 7; `EpisodeInput` type at lines 10-16 |
| `src/memory/schema.ts` | Episode config schema | VERIFIED | `episodeInputSchema` at line 51, `episodeConfigSchema` at line 59, `episodes` field in `memoryConfigSchema` at line 89 |
| `src/memory/store.ts` | Schema migration for 'episode' CHECK constraint | VERIFIED | `migrateEpisodeSource()` at line 474, called in constructor at line 66, CHECK constraint updated at lines 381 and 438 |
| `src/memory/episode-store.ts` | EpisodeStore with recordEpisode, listEpisodes, getEpisodeCount | VERIFIED | Full implementation, 119 lines, all three methods present and substantive |
| `src/memory/__tests__/episode-store.test.ts` | Unit tests for episode storage | VERIFIED | 8 test cases, all passing |
| `src/memory/episode-archival.ts` | archiveOldEpisodes function | VERIFIED | Full implementation, exports `archiveOldEpisodes` and `EpisodeArchivalResult`, error-tolerant loop |
| `src/memory/__tests__/episode-archival.test.ts` | Unit tests for episode archival | VERIFIED | 7 test cases, all passing |
| `src/cli/commands/memory.ts` | Episode subcommand for listing and counting | PARTIAL | CLI side is correct — `episodes` subcommand, `--count`, `--limit`, `formatEpisodeList`, IPC call to `"episode-list"`. Blocked by missing daemon handler. |
| `src/manager/daemon.ts` | IPC handler for 'episode-list' | MISSING | No `case "episode-list"` in `handleRequest()` switch. Falls to `default: throw ManagerError("Unknown method: episode-list")` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `src/memory/episode-store.ts` | `src/memory/store.ts` | `MemoryStore.insert` with `source="episode"` | VERIFIED | Line 78-87: `this.store.insert({ content, source: "episode", importance, tags, skipDedup: true }, embedding)` |
| `src/memory/episode-store.ts` | `src/memory/embedder.ts` | `embedder.embed` for episode content | VERIFIED | Line 76: `const embedding = await this.embedder.embed(content)` |
| `src/memory/episode-archival.ts` | `src/memory/store.ts` | `updateTier` and `vec_memories` DELETE | VERIFIED | Line 55: `store.updateTier(row.id, "cold")`, line 56: `db.prepare("DELETE FROM vec_memories WHERE memory_id = ?").run(row.id)` |
| `src/cli/commands/memory.ts` | `src/memory/episode-store.ts` | `EpisodeStore.listEpisodes` via IPC | NOT_WIRED | CLI sends `"episode-list"` IPC request; daemon has no handler; `EpisodeStore` not instantiated in `AgentMemoryManager` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/memory/episode-store.ts` | `rows` from `listEpisodes` | `memories` table WHERE `source='episode'` | Yes — direct SQLite query | FLOWING |
| `src/memory/episode-archival.ts` | `rows` to archive | `memories` table WHERE `source='episode' AND tier!='cold' AND created_at<?` | Yes — real DB query with cutoff | FLOWING |
| `src/cli/commands/memory.ts` | `result.entries` | IPC `"episode-list"` response | No — IPC handler missing in daemon | DISCONNECTED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| EpisodeStore unit tests (8 cases) | `npx vitest run src/memory/__tests__/episode-store.test.ts` | 8/8 passed | PASS |
| Episode archival tests (7 cases) | `npx vitest run src/memory/__tests__/episode-archival.test.ts` | 7/7 passed | PASS |
| TypeScript phase-25 files | `npx tsc --noEmit` (filtered to phase 25 files) | `src/config/schema.ts:139,164 TS2769` — memory default objects missing `tiers` and `episodes` fields | FAIL |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| EPSD-01 | 25-01 | Agents can store discrete episode records | SATISFIED | `EpisodeStore.recordEpisode` stores with `source='episode'`, title, summary, tags, importance, timestamp |
| EPSD-02 | 25-01 | Episodes have structured fields: title, summary, importance, tags, timestamp | SATISFIED | `EpisodeInput` type has all fields; `episodeInputSchema` validates; `occurredAt` stored as part of entry |
| EPSD-03 | 25-01 | Episodes are searchable via semantic search alongside regular memories | SATISFIED | Shared `vec_memories` KNN table; `SemanticSearch.search()` test confirms episodes appear in results |
| EPSD-04 | 25-02 | Episodes can be archived monthly (similar to consolidation pipeline) | PARTIAL | Archival function works fully; CLI visibility blocked by missing IPC handler |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/manager/daemon.ts` | 648 | Missing `case "episode-list"` — falls to `default: throw ManagerError("Unknown method")` | Blocker | CLI `memory episodes` command throws error at runtime |
| `src/config/schema.ts` | 139-145, 169 | Memory default objects missing `tiers` and `episodes` fields | Warning | TypeScript TS2769 compile errors; `zod.default()` call is mismatched |
| `src/config/__tests__/differ.test.ts` | ~13 | Test fixture memory object missing `tiers` and `episodes` | Warning | TS2739 errors; tests may behave incorrectly with schema-validated memory config |
| `src/config/__tests__/loader.test.ts` | ~20 | Test fixture memory object missing `tiers` and `episodes` | Warning | TS2739 errors |

### Human Verification Required

#### 1. CLI `memory episodes` End-to-End

**Test:** Start the ClawCode manager daemon, create an agent, record an episode via code or MCP, then run `clawcode memory episodes <agent-name>`
**Expected:** Either a formatted table of episodes or "No episodes recorded for <agent-name>" — not "Unknown method: episode-list"
**Why human:** Cannot test IPC round-trip without a running daemon; requires fixing the gap first

### Gaps Summary

Two gaps block full goal achievement:

**Gap 1 (Blocker): Missing IPC handler for `"episode-list"`**

The CLI `memory episodes` subcommand is fully implemented in `src/cli/commands/memory.ts` — it sends an IPC request with method `"episode-list"`. However, `src/manager/daemon.ts`'s `handleRequest()` switch statement has no `case "episode-list"`. The request falls through to `default: throw new ManagerError("Unknown method: episode-list")`. Additionally, `AgentMemoryManager` in `src/manager/session-memory.ts` has no `episodeStores` map and never imports `EpisodeStore` — so even if the daemon case was added, there's no store instance to query.

This means EPSD-04's CLI visibility requirement is not delivered. The archival function itself works correctly.

**Gap 2 (Warning): Config schema default values not updated**

`src/config/schema.ts` hardcodes default values for `memorySchema` on lines 139-145 and 169 that are missing the `tiers` and `episodes` fields added in Phases 23 and 25. This causes TypeScript compilation errors TS2769 in `config/schema.ts` and downstream TS2739 errors in `config/__tests__/differ.test.ts` and `config/__tests__/loader.test.ts`. The `tiers` gap pre-dates Phase 25, but the `episodes` omission is a Phase 25 regression.

---

_Verified: 2026-04-09T20:17:00Z_
_Verifier: Claude (gsd-verifier)_
