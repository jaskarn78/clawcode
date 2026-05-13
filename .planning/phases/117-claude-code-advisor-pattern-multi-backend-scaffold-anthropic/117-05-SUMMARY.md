---
phase: 117
plan: 05
subsystem: src/advisor/backends
tags: [scaffold, advisor, backend, portable-fork, phase-118-deferred]
dependency_graph:
  requires:
    - 117-02 (AdvisorBackend interface at src/advisor/backends/types.ts)
  provides:
    - PortableForkAdvisor class (interface-conformant scaffold)
  affects: []
tech_stack:
  added: []
  patterns:
    - Interface-conformant stub that throws documented deferred error
      (mirrors the AnthropicSdkAdvisor "throws by design" pattern noted in
      src/advisor/backends/types.ts:7–13)
    - Header doc-comment IS the Phase 118 spec (per plan T01 action step 3)
key_files:
  created:
    - src/advisor/backends/portable-fork.ts
    - src/advisor/backends/__tests__/portable-fork.test.ts
  modified: []
decisions:
  - Error message verbatim from plan T01 body — "PortableForkAdvisor not
    implemented — see Phase 118" (em-dash, not "not yet implemented"). The
    test regex `/PortableForkAdvisor not implemented.*Phase 118/i` matches
    either wording, but the plan body is the source of truth.
  - Test directory `src/advisor/backends/__tests__/` is NEW (other advisor
    tests live in `src/advisor/__tests__/`); plan explicitly specifies the
    backends-local path in `files_modified` and T02 action.
  - NOT registered in BackendRegistry — confirmed by grep of
    src/advisor/registry.ts (only string-literal references for defensive
    coercion exist; no import of portable-fork.ts).
  - Schema rejection of "portable-fork" as a selectable value is Plan
    117-06's job; defensive coercion in registry.resolveBackend already
    handles the runtime case (src/advisor/registry.ts:60).
metrics:
  duration: ~2 minutes
  completed: 2026-05-13
  tasks_completed: 2
  files_changed: 2
---

# Phase 117 Plan 05: `PortableForkAdvisor` scaffold Summary

Interface-conformant scaffold for `PortableForkAdvisor` so the
`AdvisorBackend` abstraction has three concrete shapes from day one and
Phase 118 doesn't have to re-shape call sites. `consult()` throws a
documented Phase 118 deferred error; the file header captures the
intended implementation scope (transcript extraction +
`buildAdvisorSystemPrompt` + `CompletionProvider`-based call).

## Tasks executed

| Task | Description                                                                              | Commit    |
| ---- | ---------------------------------------------------------------------------------------- | --------- |
| T01  | Implement `PortableForkAdvisor` class at `src/advisor/backends/portable-fork.ts`         | `0c0bc25` |
| T02  | Write `src/advisor/backends/__tests__/portable-fork.test.ts` (2 contract assertions)     | `906c895` |

## Files

### Created

- **`src/advisor/backends/portable-fork.ts`** (50 lines)
  - `class PortableForkAdvisor implements AdvisorBackend`
  - `readonly id = "portable-fork" as const` (matches `BackendId` literal)
  - `consult()` signature: `(args: { agent, question, systemPrompt, advisorModel }) => Promise<{ answer: string }>`
  - `consult()` throws `Error("PortableForkAdvisor not implemented — see Phase 118")`
  - Header doc-comment (33-line block JSDoc) IS the Phase 118 spec —
    documents transcript extraction strategy (intercept tracing hooks vs.
    read SDK session file), `buildAdvisorSystemPrompt` reuse,
    `CompletionProvider` call shape, and the `{ answer: string }` return
    contract.

- **`src/advisor/backends/__tests__/portable-fork.test.ts`** (34 lines)
  - Test 1: `consult()` rejects with `/PortableForkAdvisor not implemented.*Phase 118/i`.
  - Test 2: `id === "portable-fork"`.
  - Header JSDoc references `portable-fork.ts` and RESEARCH §5.

### Modified

None.

## Verification

- `npm run typecheck` — **PASSED** (zero output, exit 0).
- `npm run build` — **PASSED** (clean tsc + Vite dashboard build, "built in 10.43s").
- `npx vitest run src/advisor/backends/__tests__/portable-fork.test.ts` —
  **PASSED** (Test Files 1 passed (1); Tests 2 passed (2); 345 ms).
- `grep -n "portable-fork\|PortableForkAdvisor" src/advisor/registry.ts`
  — only string-literal defensive references; **no import of portable-fork.ts**
  (verified: registry remains gated to native/fork until Phase 118).

## Deviations from Plan

**None — plan executed exactly as written.**

The orchestrator prompt phrased the error as "PortableForkAdvisor not
yet implemented — see Phase 118"; the plan body T01 specifies
"PortableForkAdvisor not implemented — see Phase 118" (no "yet"). The
plan file is the source of truth, so the implementation matches the
plan. The test regex `/PortableForkAdvisor not implemented.*Phase 118/i`
would tolerate either wording.

## Authentication gates

None.

## Out of scope (per plan)

- ANY implementation logic (transcript extraction, `CompletionProvider`
  call, etc.) — that's Phase 118.
- Registering `PortableForkAdvisor` in `BackendRegistry` — remains
  unregistered until Phase 118.
- Allowing `"portable-fork"` as a schema-accepted backend value — Plan
  117-06 rejects it at parse time.

## Known Stubs

The whole class is an intentional scaffold stub — documented in the
plan's `must_haves`, in the file header doc-comment, in CONTEXT.md
`<scope>` / `<deferred>`, and in RESEARCH §3. Resolution is Phase 118.
Not added to a "deferred-items" register because the deferral is
already first-class in CONTEXT.md `<deferred>`.

## Self-Check: PASSED

- `src/advisor/backends/portable-fork.ts` — FOUND
- `src/advisor/backends/__tests__/portable-fork.test.ts` — FOUND
- Commit `0c0bc25` — FOUND in `git log`
- Commit `906c895` — FOUND in `git log`
- Registry import check — confirmed no `import .* portable-fork` in
  `src/advisor/registry.ts`
