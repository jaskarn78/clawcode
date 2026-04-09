---
phase: 02-agent-lifecycle
plan: 01
subsystem: manager
tags: [typescript, zod, json-rpc, backoff, registry, session-adapter, lifecycle]

requires:
  - phase: 01-config-workspace
    provides: "Zod schemas, ResolvedAgentConfig type, shared errors base classes"
provides:
  - "AgentStatus (7-state machine), RegistryEntry, Registry, BackoffConfig, AgentSessionConfig types"
  - "Atomic JSON registry with CRUD operations (readRegistry, writeRegistry, updateEntry, createEntry)"
  - "Exponential backoff calculator with jitter, cap, max retries, and stability reset"
  - "IPC protocol with JSON-RPC 2.0 Zod validation schemas"
  - "SessionAdapter interface with MockSessionAdapter and SdkSessionAdapter"
  - "ManagerError, SessionError, IpcError, ManagerNotRunningError error classes"
affects: [02-agent-lifecycle, 03-discord-routing]

tech-stack:
  added: []
  patterns: [atomic-file-write, session-adapter-pattern, json-rpc-2.0, exponential-backoff-with-jitter, immutable-registry-updates]

key-files:
  created:
    - src/manager/types.ts
    - src/manager/registry.ts
    - src/manager/backoff.ts
    - src/manager/session-adapter.ts
    - src/ipc/protocol.ts
    - src/manager/__tests__/registry.test.ts
    - src/manager/__tests__/backoff.test.ts
    - src/ipc/__tests__/protocol.test.ts
  modified:
    - src/shared/errors.ts

key-decisions:
  - "Used z.refine (Zod 4 API) instead of z.refinement for response schema validation"
  - "Used @ts-expect-error for SDK dynamic import since SDK is not yet installed (Plan 02)"
  - "MockSessionAdapter uses sequential counter IDs instead of nanoid for deterministic testing"
  - "SdkSessionAdapter uses dynamic import() to defer SDK loading and avoid compile errors"

patterns-established:
  - "Atomic file writes: write to .tmp then rename for crash-safe persistence"
  - "Session adapter pattern: abstract SDK behind interface for testability"
  - "Immutable registry updates: all operations return new objects, never mutate"
  - "TDD workflow: RED (failing test) -> GREEN (minimal impl) -> commit"

requirements-completed: [MGMT-06, MGMT-07]

duration: 5min
completed: 2026-04-09
---

# Phase 02 Plan 01: Foundation Types Summary

**Agent lifecycle type system with atomic JSON registry, exponential backoff calculator, JSON-RPC IPC protocol, and SDK session adapter interface**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-08T23:58:46Z
- **Completed:** 2026-04-09T00:03:35Z
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments
- Complete type system for agent lifecycle: 7-state AgentStatus, RegistryEntry, Registry, BackoffConfig, AgentSessionConfig
- Atomic JSON registry with immutable CRUD operations and crash-safe write-then-rename pattern
- Exponential backoff calculator with jitter (+/-10%), cap at maxMs, max retries cutoff, and stability reset
- JSON-RPC 2.0 IPC protocol with Zod validation schemas for request/response messages
- SessionAdapter interface abstracting Claude Agent SDK V2 behind stable contract with mock for testing
- 4 new error classes extending the shared error hierarchy
- 42 new tests (13 protocol + 15 backoff + 14 registry), all passing alongside 50 Phase 1 tests

## Task Commits

Each task was committed atomically:

1. **Task 1: Manager types, error classes, and IPC protocol** - `590566a` (feat)
2. **Task 2: Registry persistence and backoff calculator** - `921100c` (feat)
3. **Task 3: Session adapter interface and mock** - `c409582` (feat)

## Files Created/Modified
- `src/manager/types.ts` - AgentStatus, RegistryEntry, Registry, BackoffConfig, AgentSessionConfig, DEFAULT_BACKOFF_CONFIG
- `src/manager/registry.ts` - Atomic JSON registry with readRegistry, writeRegistry, updateEntry, createEntry, EMPTY_REGISTRY
- `src/manager/backoff.ts` - calculateBackoff (exponential with jitter), shouldResetBackoff
- `src/manager/session-adapter.ts` - SessionHandle, SessionAdapter interface, MockSessionAdapter, SdkSessionAdapter
- `src/ipc/protocol.ts` - IPC_METHODS, ipcRequestSchema, ipcResponseSchema (Zod JSON-RPC 2.0)
- `src/shared/errors.ts` - Added ManagerError, SessionError, IpcError, ManagerNotRunningError
- `src/manager/__tests__/backoff.test.ts` - 15 tests covering backoff math, jitter, cap, max retries, stability reset
- `src/manager/__tests__/registry.test.ts` - 14 tests covering CRUD, atomicity, immutability, error cases
- `src/ipc/__tests__/protocol.test.ts` - 13 tests covering request/response validation, edge cases

## Decisions Made
- Used Zod 4's `z.refine` (not `z.refinement`) for the response schema's "must have result or error" constraint
- SdkSessionAdapter uses dynamic `import()` with `@ts-expect-error` since the SDK package is installed in Plan 02
- MockSessionAdapter uses a sequential counter for session IDs instead of nanoid for deterministic test behavior

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed Zod 4 API mismatch for refinement**
- **Found during:** Task 1 (IPC protocol implementation)
- **Issue:** Plan referenced `z.refinement()` which does not exist in Zod 4. The correct API is `z.refine()`.
- **Fix:** Changed to `z.refine()` with `.check()` wrapper per Zod 4 documentation
- **Files modified:** src/ipc/protocol.ts
- **Verification:** All 13 protocol tests pass
- **Committed in:** 590566a (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Minor API name correction. No scope change.

## Issues Encountered
None

## Known Stubs
None - all modules are fully implemented with real logic.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All foundation types and pure functions ready for Plan 02 (session manager) and Plan 03 (IPC server/client)
- SessionAdapter interface enables Plan 02 to implement the real session lifecycle with MockSessionAdapter for testing
- Registry CRUD and backoff calculator are complete and tested for Plan 02's crash recovery logic
- IPC protocol schemas ready for Plan 03's socket server/client implementation

---
*Phase: 02-agent-lifecycle*
*Completed: 2026-04-09*
