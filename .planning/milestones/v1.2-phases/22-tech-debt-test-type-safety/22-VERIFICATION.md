---
phase: 22-tech-debt-test-type-safety
verified: 2026-04-09T19:05:00Z
status: gaps_found
score: 5/6 must-haves verified
re_verification: false
gaps:
  - truth: "session-adapter.ts compiles without TypeScript errors introduced by phase 22"
    status: failed
    reason: "Phase 22 introduced 6 new TypeScript errors in session-adapter.ts (was 42 pre-phase, now 48). Errors at lines 223, 242-243, 352 are caused by incomplete type narrowing in sdk-types.ts: SdkSession lacks `id` property (fallback used at line 223), the catch-all SdkStreamMessage branch types `usage` as `{}` making `input_tokens`/`output_tokens` inaccessible after discriminant check, and the `on?` handler signature `(...args: unknown[]) => void` is incompatible with the call site using `(error: Error) => void`."
    artifacts:
      - path: "src/manager/session-adapter.ts"
        issue: "6 new TS2339/TS2345 errors introduced by phase 22 type interfaces"
      - path: "src/manager/sdk-types.ts"
        issue: "SdkSession missing `id` field; SdkStreamMessage catch-all branch loses `usage` property typing; `on?` handler parameter type too broad"
    missing:
      - "Add `id?: string` to SdkSession type (SDK runtime exposes both sessionId and id)"
      - "Fix SdkStreamMessage union so `usage` property is accessible after `type === 'result'` narrowing — the catch-all `{type: string, [key: string]: unknown}` branch swallows result-message properties; consider narrowing SdkResultMessage union more precisely or using type assertions within extractUsage"
      - "Change `on?` handler signature from `(...args: unknown[]) => void` to `(error: Error) => void` or use `unknown` parameter in the call site"
human_verification:
  - test: "Verify pre-existing 42 TS errors are acknowledged as out-of-scope for phase 22"
    expected: "Phase 22 should have zero net-new TS errors; existing errors from other phases are acceptable"
    why_human: "Distinguishing introduced vs pre-existing TS errors requires project-level judgment about which phases own which errors"
---

# Phase 22: Tech Debt - Test & Type Safety Verification Report

**Phase Goal:** Test suite runs cleanly without type workarounds and CLI commands have unit test coverage
**Verified:** 2026-04-09T19:05:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | All test fixtures include required fields without type escape hatches | VERIFIED | `grep -rn "as unknown as" src/ --include="*.test.ts"` returns zero matches |
| 2 | No `as unknown as` casts remain in test files (excluding worktrees) | VERIFIED | Zero matches confirmed across all 7 fixed test files |
| 3 | CLI commands fork, send, webhooks, mcp each have unit tests covering success and error paths | VERIFIED | All 4 files exist and substantive; 22 tests pass in 4 files |
| 4 | SDK v2 unstable API usage has explicit TypeScript interfaces instead of any types | VERIFIED | sdk-types.ts created with SdkModule, SdkSession, SdkStreamMessage, SdkSessionOptions; zero `any` aliases remain in session-adapter.ts |
| 5 | session-adapter.ts compiles without eslint-disable for no-explicit-any | VERIFIED | Zero eslint-disable comments in session-adapter.ts |
| 6 | Migration notes document how to update when SDK stabilizes | VERIFIED | MIGRATION NOTES JSDoc block present in sdk-types.ts with 6-step guide |

**Caveat on Truth 4:** The `any` aliases are gone, but the replacement interfaces introduced 6 new TypeScript errors in session-adapter.ts (lines 223, 242-243, 352). The type interfaces are incomplete — they don't fully model the properties that the adapter code actually accesses at runtime.

**Score:** 5/6 truths fully verified (truth 4 partially — `any` eliminated but type errors introduced)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/cli/commands/fork.test.ts` | Fork CLI command tests | VERIFIED | 3600 bytes, 5 tests: success output, --model option, --prompt option, ManagerNotRunningError, generic error |
| `src/cli/commands/send.test.ts` | Send CLI command tests | VERIFIED | 3457 bytes, 5 tests: success, --from option, --priority option, ManagerNotRunningError, generic error |
| `src/cli/commands/webhooks.test.ts` | Webhooks CLI command tests | VERIFIED | 3234 bytes, 9 tests: empty state, headers, avatar yes/no, status active/no-url, multiple rows, separator line |
| `src/cli/commands/mcp.test.ts` | MCP CLI command tests | VERIFIED | 2018 bytes, 3 tests: success, Error rejection, non-Error rejection |
| `src/manager/sdk-types.ts` | Typed interfaces for SDK v2 unstable API | VERIFIED | 4154 bytes, exports SdkModule, SdkSession, SdkStreamMessage, SdkSessionOptions, SdkAssistantMessage, SdkResultSuccess, SdkResultError; MIGRATION NOTES present |
| `src/manager/session-adapter.ts` | Session adapter using typed SDK interfaces | VERIFIED (wiring) / PARTIAL (compilation) | Imports from ./sdk-types.js confirmed; zero `any` aliases; but 6 new TS errors at lines 223, 242-243, 352 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| test fixtures | source type definitions | direct type conformance without as-unknown-as | VERIFIED | Zero `as unknown as` in src/*.test.ts files |
| `src/manager/sdk-types.ts` | `@anthropic-ai/claude-agent-sdk` | mirrors SDK exported types for v2 unstable API | VERIFIED | SdkSession, SdkSessionOptions, SdkResultMessage all defined; mirrors SDK interface structure |
| `src/manager/session-adapter.ts` | `src/manager/sdk-types.ts` | imports typed interfaces replacing any | VERIFIED | Line 2: `import type { SdkModule, SdkSession, SdkStreamMessage } from "./sdk-types.js"` |

### Data-Flow Trace (Level 4)

Not applicable — this phase produces test files and type definitions, not dynamic data-rendering components.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 4 new CLI test files pass (22 tests) | `npx vitest --run src/cli/commands/fork.test.ts src/cli/commands/send.test.ts src/cli/commands/webhooks.test.ts src/cli/commands/mcp.test.ts` | 4 passed, 22 tests passed | PASS |
| 7 fixture test files pass | `npx vitest --run src/heartbeat/.../tier-maintenance.test.ts ...` | All pass (failures only from .claude/worktrees/ which are excluded per plan) | PASS |
| No `as unknown as` casts in src/ test files | `grep -rn "as unknown as" src/ --include="*.test.ts"` | Zero matches | PASS |
| session-adapter.ts TypeScript compiles cleanly | `npx tsc --noEmit 2>&1 \| grep session-adapter` | 6 errors: TS2339 on `.id`, `.input_tokens`, `.output_tokens` (x2); TS2345 on `on?` handler | FAIL |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| DEBT-05 | 22-01-PLAN.md | Test fixtures updated with all required fields — no more `as unknown as` casts | SATISFIED | Zero `as unknown as` in src/ test files; 7 test files fixed |
| DEBT-06 | 22-01-PLAN.md | CLI commands have unit tests (schedules, skills, send, threads, webhooks, fork, memory, mcp, usage) | SATISFIED | All 9 CLI commands now have test files; 4 new ones created this phase |
| DEBT-07 | 22-02-PLAN.md | SDK v2 unstable API types narrowed from `any` to explicit interfaces with documented migration path | PARTIAL | `any` removed, explicit interfaces exist, migration notes present, but interfaces are incomplete causing 6 new TS errors |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/manager/sdk-types.ts` | 97-100 | Catch-all branch `{type: string, [key: string]: unknown}` in SdkStreamMessage union loses property typing downstream | Warning | After type narrowing on `msg.type === 'result'`, TypeScript cannot access `msg.usage.input_tokens` because the catch-all branch conflicts with the discriminated union resolution |
| `src/manager/session-adapter.ts` | 223 | `session.id` — `id` not present in SdkSession type definition | Blocker | TS2339 error; the fallback `session.id` is used for pre-init sessions but the type doesn't include it |
| `src/manager/session-adapter.ts` | 352 | `(error: Error) => void` passed to `on?` which expects `(...args: unknown[]) => void` | Warning | TS2345 type incompatibility; the `on` handler signature in SdkSession is too broad |

### Human Verification Required

#### 1. Pre-existing TS errors context

**Test:** Confirm that the 42 TypeScript errors present before phase 22 are known pre-existing issues from other phases
**Expected:** Phase 22 should be evaluated only on the 6 net-new errors it introduced; the pre-existing 42 belong to other phases
**Why human:** Requires judgment on whether DEBT-07 acceptance ("npx tsc --noEmit exits 0") was aspirational or mandatory given the pre-existing error count

#### 2. Worktree test failures

**Test:** Confirm that failing tests in `.claude/worktrees/` are agent worktrees excluded from the phase 22 scope
**Expected:** Only `src/` tests count for this phase; worktree tests are separate agent environments
**Why human:** The plan explicitly excludes worktrees but vitest picks them up without config exclusion

### Gaps Summary

Phase 22 achieved its primary goals for DEBT-05 and DEBT-06: all `as unknown as` casts were eliminated from test files and all 9 CLI commands now have unit tests. The CLI test files (fork, send, webhooks, mcp) are substantive and passing.

For DEBT-07, the `any` types were replaced with explicit interfaces, but the replacement introduced 6 new TypeScript errors because the interfaces are incomplete:

1. `SdkSession.id` is missing — the adapter uses `session.id` as a fallback at line 223
2. The `SdkStreamMessage` catch-all branch (`{type: string, [key: string]: unknown}`) interferes with TypeScript's ability to narrow the `usage` property after a `msg.type === 'result'` discriminant check (lines 242-243)
3. The `on?` handler parameter type `(...args: unknown[]) => void` is incompatible with the call site's `(error: Error) => void` (line 352)

The type interfaces need to be tightened so that session-adapter.ts compiles cleanly, which was the stated acceptance criterion for DEBT-07.

---

_Verified: 2026-04-09T19:05:00Z_
_Verifier: Claude (gsd-verifier)_
