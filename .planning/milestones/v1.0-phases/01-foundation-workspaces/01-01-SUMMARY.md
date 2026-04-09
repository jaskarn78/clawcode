---
phase: 01-foundation-workspaces
plan: 01
subsystem: config
tags: [typescript, zod, yaml, esm, vitest, pino]

requires: []
provides:
  - "TypeScript project scaffold with ESM, strict mode, vitest"
  - "Zod schema for clawcode.yaml config validation"
  - "Config loader with YAML parsing, validation, defaults merging"
  - "Shared types (ResolvedAgentConfig, WorkspaceResult)"
  - "Shared error classes with agent-name-context formatting"
  - "Default SOUL.md and IDENTITY.md templates"
  - "expandHome and renderIdentity utility functions"
affects: [01-02, 02-lifecycle, 03-discord, config]

tech-stack:
  added: [yaml@2.8.3, zod@4.3.6, commander@14.0.3, pino@9, typescript@6.0.2, vitest@4.1.3, tsx@4.21.0, tsup@8.5.1]
  patterns: [zod-schema-as-source-of-truth, immutable-defaults-merging, inline-vs-path-content-resolution]

key-files:
  created:
    - package.json
    - tsconfig.json
    - vitest.config.ts
    - src/config/schema.ts
    - src/config/defaults.ts
    - src/config/loader.ts
    - src/shared/types.ts
    - src/shared/errors.ts
    - src/shared/logger.ts
    - src/config/__tests__/schema.test.ts
    - src/config/__tests__/loader.test.ts
  modified: []

key-decisions:
  - "Zod 4 default() on object schemas requires function form for nested defaults"
  - "ZodError path type is PropertyKey[] in Zod 4, filtered to string|number for formatting"
  - "Content resolution heuristic: newlines = inline, path-like + exists = file, else inline"

patterns-established:
  - "Zod schema as single source of truth for config types"
  - "Immutable defaults merging -- resolveAgentConfig returns new object, never mutates"
  - "Error classes with contextual formatting (agent name in validation errors)"
  - "TDD workflow: RED (failing tests) -> GREEN (implementation) -> commit separately"

requirements-completed: [MGMT-01]

duration: 4min
completed: 2026-04-08
---

# Phase 01 Plan 01: Project Scaffold and Config System Summary

**Zod-validated YAML config schema with defaults merging, content resolution, and 28 passing tests**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-08T22:55:07Z
- **Completed:** 2026-04-08T22:59:20Z
- **Tasks:** 3 (1a scaffold, 1b shared+schema, 2 loader TDD)
- **Files modified:** 11

## Accomplishments
- TypeScript ESM project with strict mode, vitest, and all dependencies installed
- Zod schema for clawcode.yaml enforcing version=1, min 1 agent, string channel IDs, valid model enum
- Config loader that reads YAML, validates, and merges defaults immutably
- 28 tests passing: 9 schema validation + 19 loader/resolver tests
- Default SOUL.md and IDENTITY.md templates with name interpolation

## Task Commits

Each task was committed atomically:

1. **Task 1a: Project scaffold** - `63629f7` (chore)
2. **Task 1b: Shared layer and config schema** - `67b8257` (feat)
3. **Task 2 RED: Failing tests** - `53249b4` (test)
4. **Task 2 GREEN: Config loader implementation** - `6ed5c3a` (feat)

## Files Created/Modified
- `package.json` - Project manifest with ESM, dependencies, scripts
- `tsconfig.json` - Strict TypeScript with NodeNext module resolution
- `vitest.config.ts` - Test runner configuration
- `src/config/schema.ts` - Zod schema for clawcode.yaml (configSchema, agentSchema, defaultsSchema)
- `src/config/defaults.ts` - DEFAULT_SOUL, DEFAULT_IDENTITY_TEMPLATE, renderIdentity, expandHome
- `src/config/loader.ts` - loadConfig, resolveAgentConfig, resolveContent, resolveAllAgents
- `src/shared/types.ts` - ResolvedAgentConfig, WorkspaceResult types
- `src/shared/errors.ts` - ConfigValidationError, ConfigFileNotFoundError, WorkspaceError
- `src/shared/logger.ts` - Pino logger with CLAWCODE_LOG_LEVEL env var
- `src/config/__tests__/schema.test.ts` - 9 schema validation tests
- `src/config/__tests__/loader.test.ts` - 19 loader, resolver, and expandHome tests

## Decisions Made
- Zod 4's `.default({})` on object schemas with nested defaults requires function form to satisfy TypeScript (returns full default object)
- ZodError.issues path type changed to `PropertyKey[]` in Zod 4; filtered to `string|number` for formatting
- Content resolution uses the simplest heuristic: newlines mean inline, path-like + file exists means file, otherwise inline

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Zod 4 default() type mismatch on defaultsSchema**
- **Found during:** Task 1b (schema creation)
- **Issue:** `defaultsSchema.default({})` fails TypeScript in Zod 4 -- empty object doesn't match the expected full defaults shape
- **Fix:** Changed to `.default(() => ({ model: "sonnet" as const, skills: [], basePath: "~/.clawcode/agents" }))`
- **Files modified:** src/config/schema.ts
- **Verification:** `npx tsc --noEmit` passes
- **Committed in:** 67b8257

**2. [Rule 1 - Bug] Fixed ZodError path type (PropertyKey vs string|number)**
- **Found during:** Task 1b (errors.ts)
- **Issue:** Zod 4 uses `PropertyKey[]` (includes symbol) for issue paths, but formatting functions expected `(string|number)[]`
- **Fix:** Added filter to exclude symbol keys before formatting
- **Files modified:** src/shared/errors.ts
- **Verification:** `npx tsc --noEmit` passes
- **Committed in:** 67b8257

---

**Total deviations:** 2 auto-fixed (2 bugs -- Zod 4 API differences from v3)
**Impact on plan:** Both fixes were necessary for TypeScript compilation. No scope creep.

## Issues Encountered
None beyond the Zod 4 type adjustments documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Config schema and loader ready for Plan 02 (workspace creation)
- Shared types and error classes available for all subsequent plans
- Test infrastructure established with vitest

---
*Phase: 01-foundation-workspaces*
*Completed: 2026-04-08*
