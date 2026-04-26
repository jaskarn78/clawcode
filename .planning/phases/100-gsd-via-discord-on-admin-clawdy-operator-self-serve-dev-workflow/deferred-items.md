# Phase 100 — Deferred Items

Items discovered during execution that are out of scope per CLAUDE.md SCOPE BOUNDARY (pre-existing failures not caused by current task changes). Logged here for future cleanup phases.

## From Plan 100-07 execution (2026-04-26)

### 1. `loader.test.ts` LR-RESOLVE-DEFAULT-CONST-MATCHES failure

- **Test:** `src/config/__tests__/loader.test.ts` > `resolveSystemPromptDirectives (Phase 94 TOOL-10)` > `LR-RESOLVE-DEFAULT-CONST-MATCHES`
- **Failure:** `expected [ 'cross-agent-routing', …(2) ] to deeply equal [ 'cross-agent-routing', …(1) ]`
- **Source:** Test asserts `DEFAULT_SYSTEM_PROMPT_DIRECTIVES` matches a hard-coded 2-entry array `["cross-agent-routing", "file-sharing"]`, but the actual exported constant has 3 entries. Stash-baseline check confirms the failure exists without any Plan 07 changes.
- **Status:** PRE-EXISTING — out of scope per CLAUDE.md SCOPE BOUNDARY.
- **Suggested fix:** Phase 96 / 94 follow-up should reconcile the test array length with the current `DEFAULT_SYSTEM_PROMPT_DIRECTIVES` export.

### 2. Pre-existing `tsc --noEmit` errors (233 total)

- **Files:** `src/cli/commands/__tests__/dream.test.ts`, `fs-status.test.ts`, `latency.test.ts`, `tasks.test.ts`, `probe-fs.test.ts`, `differ.test.ts`, `loader.test.ts` (typed array literal/tuple-type mismatches around `outputDir`), and `gsd-install.test.ts` (parallel Plan 06 file-not-yet-committed).
- **Status:** PRE-EXISTING — verified via stash-baseline diff (0 new errors caused by Plan 07).
- **Suggested fix:** A `chore: tsc-cleanup` phase or piggyback onto Phase 95/96 follow-up.

---

*Plan 07 own changes contributed zero new tsc errors and zero new vitest regressions outside its own test file.*
