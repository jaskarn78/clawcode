---
phase: 64-conversationstore-schema-foundation
plan: 01
subsystem: database
tags: [sqlite, zod, memory, conversation, migration, types]

requires:
  - phase: 57-turndispatcher-foundation
    provides: TurnOrigin contract for origin field on ConversationTurn
  - phase: 58-task-store-state-machine
    provides: SQLite migration patterns (PRAGMA table_info, idempotent CREATE)
provides:
  - ConversationSession, ConversationTurn, RecordTurnInput, SessionStatus types
  - conversationConfigSchema nested in memoryConfigSchema
  - conversation_sessions and conversation_turns SQLite tables
  - source_turn_ids column on memories table
  - MemoryEntry.sourceTurnIds field for lineage tracking
affects: [64-conversationstore-schema-foundation, 65-conversationstore-crud, 66-conversation-summarizer, 67-conversation-wiring, 68-conversation-cli]

tech-stack:
  added: []
  patterns:
    - "Conversation provenance fields pattern: channelId, discordUserId, discordMessageId, isTrustedChannel on turns (SEC-01)"
    - "Migration chain extension: migrateConversationTables + migrateSourceTurnIds follow migrateGraphLinks"
    - "sourceTurnIds on MemoryEntry: nullable JSON array linking memories to conversation turns (CONV-03 lineage)"

key-files:
  created:
    - src/memory/conversation-types.ts
  modified:
    - src/memory/schema.ts
    - src/memory/types.ts
    - src/memory/store.ts
    - src/memory/episode-store.ts
    - src/memory/graph.ts
    - src/memory/search.ts
    - src/memory/tier-manager.ts

key-decisions:
  - "sourceTurnIds propagated across all rowToEntry functions and SQL SELECT queries to prevent runtime type mismatches"
  - "conversationConfigSchema is optional on memoryConfigSchema to preserve backward compatibility"
  - "UNIQUE index on (session_id, turn_index, role) for duplicate turn prevention"

patterns-established:
  - "Conversation type contracts: all readonly, provenance fields on ConversationTurn for SEC-01 audit trail"
  - "sourceTurnIds nullable pattern: null for pre-conversation memories, JSON array for derived memories"

requirements-completed: [CONV-01, CONV-02, CONV-03, SEC-01]

duration: 9min
completed: 2026-04-18
---

# Phase 64 Plan 01: ConversationStore Schema Foundation Summary

**Conversation type contracts, Zod config schema, and SQLite migrations for persistent conversation sessions/turns with SEC-01 provenance tracking**

## Performance

- **Duration:** 9 min
- **Started:** 2026-04-18T03:08:25Z
- **Completed:** 2026-04-18T03:18:21Z
- **Tasks:** 2
- **Files modified:** 13

## Accomplishments
- Created conversation-types.ts with ConversationSession, ConversationTurn, RecordTurnInput, SessionStatus types including all SEC-01 provenance fields
- Added conversationConfigSchema (enabled + turnRetentionDays) nested in memoryConfigSchema as optional field
- Added sourceTurnIds field to MemoryEntry type and propagated through all rowToEntry functions and SQL queries across 7 source files
- Added migrateConversationTables (conversation_sessions + conversation_turns) and migrateSourceTurnIds (memories ALTER TABLE) to MemoryStore constructor chain

## Task Commits

Each task was committed atomically:

1. **Task 1: Create conversation type definitions and Zod schemas** - `9c88af1` (feat)
2. **Task 2: Add conversation table migrations to MemoryStore** - `204d01b` (feat)

## Files Created/Modified
- `src/memory/conversation-types.ts` - ConversationSession, ConversationTurn, RecordTurnInput, SessionStatus types
- `src/memory/schema.ts` - conversationConfigSchema + ConversationConfig type export
- `src/memory/types.ts` - sourceTurnIds field on MemoryEntry
- `src/memory/store.ts` - migrateConversationTables, migrateSourceTurnIds, updated SELECT queries
- `src/memory/episode-store.ts` - Updated MemoryRow type and rowToEntry with sourceTurnIds
- `src/memory/graph.ts` - Updated BacklinkRow type and rowToMemoryEntry with sourceTurnIds
- `src/memory/search.ts` - Updated SearchRow type, SQL query, and rowToSearchResult with sourceTurnIds
- `src/memory/tier-manager.ts` - Added sourceTurnIds: null to rewarmFromCold return
- `src/manager/__tests__/context-assembler.test.ts` - Added sourceTurnIds to makeMemoryEntry helper
- `src/manager/__tests__/session-config.test.ts` - Added sourceTurnIds to makeHotMemory helper
- `src/memory/__tests__/compaction.test.ts` - Added sourceTurnIds to mock return
- `src/memory/__tests__/relevance.test.ts` - Added sourceTurnIds to makeResult helper
- `src/memory/__tests__/tier-manager.test.ts` - Added sourceTurnIds to ghost memory object

## Decisions Made
- sourceTurnIds propagated across all 7 source files that construct MemoryEntry objects or SELECT from memories table -- not just the 4 files in the plan's files_modified list -- to prevent TypeScript errors and runtime mismatches
- conversationConfigSchema uses .optional() on memoryConfigSchema to preserve full backward compatibility (no existing configs break)
- UNIQUE index on (session_id, turn_index, role) chosen to prevent duplicate turns while allowing same turn_index for different roles (user turn 0, assistant turn 0 in multi-message exchanges)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Propagated sourceTurnIds across all MemoryEntry consumers**
- **Found during:** Task 1 (type definitions)
- **Issue:** Plan listed 4 files to modify (conversation-types.ts, schema.ts, types.ts, store.ts) but adding sourceTurnIds to MemoryEntry broke TypeScript in 6 additional files (episode-store.ts, graph.ts, search.ts, tier-manager.ts, plus 5 test files) that construct MemoryEntry objects or have their own MemoryRow/rowToEntry patterns
- **Fix:** Updated all MemoryRow types, rowToEntry functions, SQL SELECT queries, and inline Object.freeze constructions to include sourceTurnIds across all consumers
- **Files modified:** episode-store.ts, graph.ts, search.ts, tier-manager.ts, 5 test files
- **Verification:** npx tsc --noEmit shows zero new errors; all 253 memory tests pass
- **Committed in:** 9c88af1 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Necessary for type correctness. All additional changes are minimal (adding sourceTurnIds: null or source_turn_ids column to existing patterns). No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All type contracts defined and exported for Plan 02 (ConversationStore CRUD class)
- conversation_sessions and conversation_turns tables created on MemoryStore construction
- source_turn_ids column available on memories table for lineage tracking
- conversationConfigSchema wired into memoryConfigSchema for config-driven behavior

## Self-Check: PASSED

- [x] src/memory/conversation-types.ts exists
- [x] 64-01-SUMMARY.md exists
- [x] Commit 9c88af1 found (Task 1)
- [x] Commit 204d01b found (Task 2)

---
*Phase: 64-conversationstore-schema-foundation*
*Completed: 2026-04-18*
