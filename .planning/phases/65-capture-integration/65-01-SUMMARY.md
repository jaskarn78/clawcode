---
phase: 65-capture-integration
plan: 01
subsystem: security
tags: [instruction-detection, prompt-injection, conversation-capture, sqlite, sec-02]

# Dependency graph
requires:
  - phase: 64-conversationstore-schema-foundation
    provides: ConversationStore with recordTurn(), conversation_turns table, RecordTurnInput type
provides:
  - detectInstructionPatterns pure function with high/medium risk classification
  - InstructionDetectionResult type
  - instruction_flags column on conversation_turns (idempotent migration)
  - captureDiscordExchange fire-and-forget helper for bridge.ts
  - CaptureInput type
affects: [65-02-capture-integration, 66-session-summarization]

# Tech tracking
tech-stack:
  added: []
  patterns: [pure-function-security-detector, fire-and-forget-capture, idempotent-column-migration]

key-files:
  created:
    - src/security/instruction-detector.ts
    - src/security/instruction-detector.test.ts
    - src/discord/capture.ts
    - src/discord/__tests__/capture.test.ts
  modified:
    - src/memory/conversation-types.ts
    - src/memory/conversation-store.ts
    - src/memory/store.ts
    - src/memory/__tests__/conversation-store.test.ts

key-decisions:
  - "Instruction detector is zero-import pure function -- no dependencies, testable in isolation"
  - "Detection result persisted as JSON string in instruction_flags TEXT column -- schema-flexible for future risk levels"
  - "captureDiscordExchange wraps entire body in try/catch -- never blocks Discord message delivery"

patterns-established:
  - "Pure security detector: zero imports, frozen return values, regex pattern arrays split by risk level"
  - "Fire-and-forget capture: try/catch wrapping all store operations, log.warn for non-fatal failures"
  - "Idempotent column migration: PRAGMA table_info check before ALTER TABLE ADD COLUMN"

requirements-completed: [SEC-02]

# Metrics
duration: 4min
completed: 2026-04-18
---

# Phase 65 Plan 01: Capture Integration Summary

**Instruction-pattern detector with high/medium risk classification, conversation schema extension for instruction_flags, and fire-and-forget capture helper tying detection to turn recording**

## Performance

- **Duration:** 4 min 16s
- **Started:** 2026-04-18T03:47:09Z
- **Completed:** 2026-04-18T03:51:25Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Built instruction-pattern detector (SEC-02) with 6 high-risk and 4 medium-risk regex patterns, zero false positives on normal conversation
- Extended ConversationStore schema with instruction_flags column via idempotent migration
- Created captureDiscordExchange helper that atomically records user+assistant turns with detection integration
- 67 total tests passing (18 detector + 40 existing + 3 new store + 9 capture = 70 across plan; 67 unique test file total)

## Task Commits

Each task was committed atomically:

1. **Task 1: Instruction-pattern detector + schema extension + type updates** - `db0337c` (feat)
2. **Task 2: Capture helper module with detection integration** - `42bbc85` (feat)

## Files Created/Modified
- `src/security/instruction-detector.ts` - Pure detectInstructionPatterns function with high/medium risk pattern matching
- `src/security/instruction-detector.test.ts` - 18 tests covering all risk levels, false positive resistance, edge cases
- `src/discord/capture.ts` - captureDiscordExchange fire-and-forget helper for bridge.ts
- `src/discord/__tests__/capture.test.ts` - 9 tests covering detection integration, dual-turn recording, error resilience
- `src/memory/conversation-types.ts` - Added instructionFlags to ConversationTurn and RecordTurnInput
- `src/memory/conversation-store.ts` - Updated INSERT/SELECT statements and row conversion for instruction_flags
- `src/memory/store.ts` - Added migrateInstructionFlags() idempotent migration
- `src/memory/__tests__/conversation-store.test.ts` - Added 3 instructionFlags persistence tests

## Decisions Made
- Instruction detector is zero-import pure function -- no dependencies, testable in isolation
- Detection result persisted as JSON string in instruction_flags TEXT column -- schema-flexible for future risk levels
- captureDiscordExchange wraps entire body in try/catch -- never blocks Discord message delivery

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Known Stubs
None - all modules are fully wired with real implementations.

## Next Phase Readiness
- Instruction detector and capture helper ready for Plan 02 to wire into DiscordBridge
- ConversationStore schema includes instruction_flags column for immediate use
- captureDiscordExchange accepts ConversationStore and Logger instances for dependency injection

## Self-Check: PASSED

All 9 created/modified files verified. Both task commits (db0337c, 42bbc85) confirmed in git history.

---
*Phase: 65-capture-integration*
*Completed: 2026-04-18*
