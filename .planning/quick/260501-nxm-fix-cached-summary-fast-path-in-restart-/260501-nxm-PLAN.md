---
phase: 260501-nxm
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/manager/restart-greeting.ts
  - src/manager/__tests__/restart-greeting.test.ts
autonomous: true
requirements:
  - QUICK-260501-NXM
must_haves:
  truths:
    - "When the cached prior-session summary contains an API-error fingerprint (e.g. 'Credit balance is too low'), the restart-greeting embed description equals PLATFORM_ERROR_RECOVERY_MESSAGE — not the contaminated cached string."
    - "When the cached prior-session summary is clean (no fingerprint match), the restart-greeting embed description equals the cached string verbatim — the existing fast-path is preserved."
    - "Other API_ERROR_FINGERPRINTS patterns (auth/rate/permission/HTTP-status variants) also trigger the substitution — not just the literal 'Credit balance is too low' string."
    - "The fix is a read-time filter only — no migration, no scrub of stored memory entries."
    - "All previously-passing tests in src/manager/__tests__/restart-greeting.test.ts still pass."
  artifacts:
    - path: "src/manager/restart-greeting.ts"
      provides: "Fingerprint check on cached summary inside the fast-path block (around L483-488)."
      contains: "API_ERROR_FINGERPRINTS.some"
    - path: "src/manager/__tests__/restart-greeting.test.ts"
      provides: "2-3 new tests under a new describe block 'sendRestartGreeting — cached-summary fast-path API-error guard'."
      contains: "summaryMemoryId"
  key_links:
    - from: "src/manager/restart-greeting.ts (sendRestartGreeting fast-path)"
      to: "API_ERROR_FINGERPRINTS (module-scoped, L249)"
      via: "Array.prototype.some over .test(existing)"
      pattern: "API_ERROR_FINGERPRINTS\\.some"
    - from: "src/manager/restart-greeting.ts (fast-path)"
      to: "PLATFORM_ERROR_RECOVERY_MESSAGE (module-scoped, L277)"
      via: "summary = PLATFORM_ERROR_RECOVERY_MESSAGE on fingerprint match"
      pattern: "summary = PLATFORM_ERROR_RECOVERY_MESSAGE"
---

<objective>
Fix the cached-summary fast-path in `sendRestartGreeting` to filter contaminated API-error summaries that were persisted before the 2026-04-30 `isApiErrorDominatedSession` guard landed. Without this fix, a stale "Credit balance is too low" summary written by Haiku during a platform-incident session keeps reappearing on every subsequent restart — observed by the operator at 10:03 AM today after `/clawcode-restart Admin Clawdy`.

Purpose: stop serving stale platform-error summaries from cached `summaryMemoryId` content; preserve the happy-path fast-path behavior for clean summaries; mirror the upstream guard so write-side and read-side use the same fingerprint set as a single source of truth.

Output: ~6 LOC of production code (1 fingerprint check + 1 log line + 1 substitution branch) and 2-3 new vitest cases. Local repo only — no deploy.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md

@src/manager/restart-greeting.ts
@src/manager/__tests__/restart-greeting.test.ts

<interfaces>
<!-- Module-scoped exports/constants the fix relies on. Already in lexical scope of sendRestartGreeting — no new imports needed. -->

From src/manager/restart-greeting.ts:
```typescript
// L249 — module-scoped readonly array
const API_ERROR_FINGERPRINTS: readonly RegExp[] = [
  /\bAPI Error:\s*\d{3}\b/i,
  /\bFailed to authenticate\b/i,
  /\bpermission_error\b/i,
  /\brate_limit_error\b/i,
  /\boverloaded_error\b/i,
  /\bauthentication_error\b/i,
  /\bCredit balance is too low\b/i,
  /\bnot a member of the organization\b/i,
  /\b(401|403|429|500|502|503|529)\s+error\b/i,
];

// L277 — exported module constant (already imported by tests)
export const PLATFORM_ERROR_RECOVERY_MESSAGE =
  "I'm back. My prior session ran into platform errors (API auth/rate/load) and didn't make progress — nothing to recap. Ready to continue.";
```

From src/manager/restart-greeting.ts (current fast-path block, L482-488 — TO BE MODIFIED):
```typescript
let summary: string | undefined;
if (lastSession.summaryMemoryId && deps.getMemoryById) {
  const existing = deps.getMemoryById(lastSession.summaryMemoryId);
  if (existing && existing.trim().length > 0) {
    summary = existing;
  }
}
```

From src/manager/__tests__/restart-greeting.test.ts (test infrastructure):
```typescript
// L46 — fixed clock for deterministic tests
const FIXED_NOW = new Date("2026-04-23T12:00:00Z").getTime();

// L101-113 — session fixture; default summaryMemoryId is null
function makeSession(overrides: Partial<ConversationSession> = {}): ConversationSession;

// L115-132 — turn fixture; default content "Hello", FIXED_NOW - 3_600_000 createdAt
function makeTurn(overrides: Partial<ConversationTurn> = {}): ConversationTurn;

// L186-198 — deps factory; conversationStore defaults to [makeSession()] + 1 makeTurn
function makeDeps(overrides: Partial<SendRestartGreetingDeps> = {}): SendRestartGreetingDeps;

// Existing assertion shape for embed description (L612-616, L644-648):
const sendAsAgent = (deps.webhookManager as unknown as {
  sendAsAgent: ReturnType<typeof vi.fn>;
}).sendAsAgent;
const embedArg = sendAsAgent.mock.calls[0]?.[3];
expect(embedArg?.data?.description).toBe(PLATFORM_ERROR_RECOVERY_MESSAGE);
```

Note: `PLATFORM_ERROR_RECOVERY_MESSAGE` is already imported at the top of the test file (L30) — no import edits needed.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: RED — add cached-summary fingerprint-guard tests, confirm they fail, then GREEN — apply ~6-LOC fingerprint check in sendRestartGreeting fast-path</name>
  <files>src/manager/__tests__/restart-greeting.test.ts, src/manager/restart-greeting.ts</files>
  <behavior>
    Three new behaviors must be covered in src/manager/__tests__/restart-greeting.test.ts (added as a NEW `describe` block AFTER the existing "sendRestartGreeting — API-error-dominated session bypass" describe at L590, mirroring its assertion shape):

    1. **REGRESSION (today's 10:03 AM bug):** When `lastSession.summaryMemoryId` is non-null AND `deps.getMemoryById(id)` returns the literal string "Credit balance is too low" (or any string containing it) AND the session has at least one normal turn, the embed sent through `webhookManager.sendAsAgent` has `embedArg.data.description === PLATFORM_ERROR_RECOVERY_MESSAGE`. Result kind === "sent". Summarize spy MUST NOT have been called (fast-path took over before Haiku).

    2. **HAPPY-PATH PRESERVED:** When `summaryMemoryId` is non-null AND `deps.getMemoryById(id)` returns a clean string like "I was building a thing." (no API-error fingerprint), the embed description equals that clean string verbatim. Result kind === "sent". Summarize spy MUST NOT have been called (fast-path still wins).

    3. **BROADER FINGERPRINT COVERAGE:** When the cached summary is "Failed to authenticate. API Error: 403 — permission_error", the embed description equals `PLATFORM_ERROR_RECOVERY_MESSAGE`. Proves the guard runs the full `API_ERROR_FINGERPRINTS` array, not a hardcoded "Credit balance" string.

    Test fixture mechanics (per existing test patterns in this file):
    - Build a session via `makeSession({ summaryMemoryId: "mem_test_001" })` — overrides the default `null`.
    - Build deps via `makeDeps({ conversationStore: stubStore([session], { "sess-abc": [makeTurn()] }), getMemoryById: vi.fn().mockReturnValue("<the cached summary string>"), summarize: vi.fn().mockResolvedValue("Haiku should NOT be called") })`.
    - Call `sendRestartGreeting(deps, { agentName: "clawdy", config: makeConfig(), restartKind: "clean" })` (or "crash-suspected" — the embed description is identical for both kinds, only color/footer differ).
    - Assert via `(deps.webhookManager as unknown as { sendAsAgent: ReturnType<typeof vi.fn> }).sendAsAgent.mock.calls[0]?.[3]?.data?.description` (mirrors L612-616 / L644-648 of existing tests).

    No imports need to change — `PLATFORM_ERROR_RECOVERY_MESSAGE` is already imported at L30.
  </behavior>
  <action>
    Two-phase TDD pass — both phases done in this single task to keep context tight.

    **PHASE 1 — RED.** Append a new describe block to src/manager/__tests__/restart-greeting.test.ts AFTER the closing `});` of the existing "sendRestartGreeting — API-error-dominated session bypass" describe (currently ends at L650). Title: `describe("sendRestartGreeting — cached-summary fast-path API-error guard", () => { ... })`. Add three `it(...)` cases matching the three behaviors above:

    - `it("substitutes PLATFORM_ERROR_RECOVERY_MESSAGE when cached summary contains 'Credit balance is too low' (operator-observed 2026-05-01 bug)", async () => { ... })`
    - `it("preserves the cached summary verbatim when content has no API-error fingerprint (happy-path regression guard)", async () => { ... })`
    - `it("substitutes PLATFORM_ERROR_RECOVERY_MESSAGE for any cached summary matching the API_ERROR_FINGERPRINTS array (e.g. 'Failed to authenticate. API Error: 403')", async () => { ... })`

    Each test MUST also assert that the `summarize` spy was NOT called — the fast-path takes the cached value, so Haiku must stay quiet.

    Run `npx vitest run src/manager/__tests__/restart-greeting.test.ts` (or `bun test src/manager/__tests__/restart-greeting.test.ts` if bun is the project default — check package.json scripts; vitest is the configured framework). EXPECT: tests 1 and 3 FAIL because the current fast-path passes `existing` through verbatim (so `embedArg.data.description` equals "Credit balance is too low" and "Failed to authenticate. API Error: 403 — permission_error" respectively, not `PLATFORM_ERROR_RECOVERY_MESSAGE`). Test 2 should PASS already (it's the regression guard for the unchanged happy path).

    **PHASE 2 — GREEN.** Modify the fast-path block in src/manager/restart-greeting.ts at L483-488 from:

    ```typescript
    if (lastSession.summaryMemoryId && deps.getMemoryById) {
      const existing = deps.getMemoryById(lastSession.summaryMemoryId);
      if (existing && existing.trim().length > 0) {
        summary = existing;
      }
    }
    ```

    to:

    ```typescript
    if (lastSession.summaryMemoryId && deps.getMemoryById) {
      const existing = deps.getMemoryById(lastSession.summaryMemoryId);
      if (existing && existing.trim().length > 0) {
        // 2026-05-01 fix — guard against legacy bad summaries cached BEFORE the
        // L496 isApiErrorDominatedSession guard landed (2026-04-30). Without this,
        // a stale "Credit balance is too low" summary written by Haiku during a
        // platform-incident session keeps reappearing on every subsequent restart
        // until the cached value is overwritten or expired. Read-time filter only —
        // no scrub of stored memory; the next session that writes a fresh summary
        // will overwrite the bad cached value organically.
        if (API_ERROR_FINGERPRINTS.some((re) => re.test(existing))) {
          deps.log.info(
            { agent: agentName, summaryMemoryId: lastSession.summaryMemoryId },
            "[greeting] cached summary contains API-error fingerprint; using verbatim platform-error recovery message",
          );
          summary = PLATFORM_ERROR_RECOVERY_MESSAGE;
        } else {
          summary = existing;
        }
      }
    }
    ```

    Constraints (verbatim from operator):
    - DO NOT modify `API_ERROR_FINGERPRINTS` (L249) — current pattern set is correct (already covers the 9 variants the fresh-Haiku guard checks against).
    - DO NOT modify `PLATFORM_ERROR_RECOVERY_MESSAGE` (L277) — current copy is correct.
    - DO NOT touch the fresh-Haiku path's existing guard (L496-501) — it's working correctly.
    - DO NOT add a write-side migration/scrub of stored summaries — read-time filter is sufficient and reversible.
    - Log line prefix `[greeting]` and `agent:` field name MUST match the existing log at L497-500 for grep consistency.
    - `API_ERROR_FINGERPRINTS` and `PLATFORM_ERROR_RECOVERY_MESSAGE` are module-scoped — both are already in this function's lexical scope. NO new imports.

    Re-run the test command. EXPECT: all three new tests pass + ALL existing tests in restart-greeting.test.ts still pass (especially the existing API-error-dominated-session bypass tests at L590-650, the cool-down tests, the dormancy tests, and the truncation tests).
  </action>
  <verify>
    <automated>npx tsc --noEmit && npx vitest run src/manager/__tests__/restart-greeting.test.ts && npx vitest run src/manager</automated>
  </verify>
  <done>
    - `npx tsc --noEmit` passes with zero errors.
    - `npx vitest run src/manager/__tests__/restart-greeting.test.ts` passes — 3 new tests + all pre-existing tests green.
    - `npx vitest run src/manager` passes (full src/manager test surface).
    - The new fingerprint check is present in src/manager/restart-greeting.ts inside the `if (existing && existing.trim().length > 0)` block, with the `[greeting]` log prefix and `agent:` log field matching the L497-500 convention.
    - No edits outside the fast-path block in restart-greeting.ts. No edits to `API_ERROR_FINGERPRINTS`, `PLATFORM_ERROR_RECOVERY_MESSAGE`, or the L496-501 fresh-Haiku guard.
    - `git diff --stat src/manager/restart-greeting.ts src/manager/__tests__/restart-greeting.test.ts` shows changes only in those two files; no other files modified.
  </done>
</task>

</tasks>

<verification>
- `npx tsc --noEmit` — zero TypeScript errors across the workspace.
- `npx vitest run src/manager/__tests__/restart-greeting.test.ts` — all tests pass, including 3 new fast-path-fingerprint cases.
- `npx vitest run src/manager` — full src/manager test surface green (catches incidental breakage from the fast-path edit).
- Manual code-review checklist:
  - The `if (API_ERROR_FINGERPRINTS.some(...))` branch is INSIDE the `if (existing && existing.trim().length > 0)` block — so `existing` is guaranteed non-empty when the fingerprint check runs.
  - The `summary = PLATFORM_ERROR_RECOVERY_MESSAGE` path correctly bypasses the `if (summary === undefined)` block at L490 (summary is now defined), so the fresh-Haiku branch is not re-entered for contaminated cache hits.
  - The downstream `if (summary.trim().length === 0)` at L523 still works correctly (PLATFORM_ERROR_RECOVERY_MESSAGE is non-empty).
  - Log line shape: `deps.log.info({ agent, summaryMemoryId }, "[greeting] ...")` — matches the L497-500 pattern.

Abort signal: if `git status src/manager/restart-greeting.ts` shows uncommitted changes from a parallel session BEFORE editing, ABORT and surface to operator (Phase 108 work touches src/manager broadly but should not be on this file).
</verification>

<success_criteria>
- Operator restarts an agent whose `summaryMemoryId` resolves to a contaminated "Credit balance is too low" string → embed description shows the verbatim `PLATFORM_ERROR_RECOVERY_MESSAGE` ("I'm back. My prior session ran into platform errors..."), NOT the misleading credit-balance text.
- Operator restarts an agent whose cached summary is clean → embed description shows that summary verbatim (existing behavior preserved).
- All vitest cases (existing + 3 new) pass; tsc clean.
- LOCAL ONLY. No deploy. No write-side migration. No edits to `API_ERROR_FINGERPRINTS`, `PLATFORM_ERROR_RECOVERY_MESSAGE`, or the L496-501 fresh-Haiku guard.
</success_criteria>

<output>
After completion, create `.planning/quick/260501-nxm-fix-cached-summary-fast-path-in-restart-/260501-nxm-SUMMARY.md`. Orchestrator handles STATE.md row insertion post-execution.

Out of scope (do NOT pull into this task):
- Migrating/scrubbing existing bad cached summaries from memory stores (read-time filter is sufficient; the next fresh write overwrites organically).
- Modifying any other restart-greeting code path.
- Phase 999.18 relay reliability (separate bug, partially shipped earlier today).
- Any deploy step — operator explicitly said "Wait for me to give deploy order."
</output>
