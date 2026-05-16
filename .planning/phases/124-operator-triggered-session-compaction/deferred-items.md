# Phase 124 — Deferred Items

Out-of-scope discoveries during plan execution. Not fixed in this phase.

## DEFERRED-124-A — Pre-existing test depends on gitignored `clawcode.yaml`

**Discovered:** Plan 124-02 execution (2026-05-14)

**File:** `src/config/__tests__/schema.test.ts:1967`

**Symptom:** `PR11: parse-regression — in-tree clawcode.yaml parses` reads `clawcode.yaml` at the workspace root via `readFileSync`. That file is `.gitignore`d (see commit `0278e6f` — `chore: rename clawcode.yaml -> clawcode.example.yaml + gitignore the runtime file`). A fresh checkout has no `clawcode.yaml`, so this test ENOENT-fails on `master` independent of any Plan 124-02 changes.

**Reproduce on master:**
```
git stash && npx vitest run src/config/__tests__/schema.test.ts 2>&1 | grep "PR11"
```

**Out-of-scope rationale:** Pre-existing failure, no plan task touches `schema.test.ts:1967`. Not caused by the Plan 124-02 yaml split or the new `auto-compact-at` schema field. Per executor rules (`SCOPE BOUNDARY`): log here, do not fix.

**Suggested follow-up:** Either re-point the test at `clawcode.example.yaml` (the canonical checked-in file) or guard with `fs.existsSync` and skip when absent. Owner: whichever phase next touches `src/config/__tests__/schema.test.ts`.

## DEFERRED-124-B — Pre-existing test failures unrelated to Plan 124-02

**Discovered:** Plan 124-02 T-04 verification (2026-05-14)

**Symptom:** `npx vitest run src/config/__tests__/ src/manager/__tests__/ src/heartbeat/__tests__/ src/discord/__tests__/ src/agent/__tests__/ src/bootstrap/__tests__/ src/__tests__/` produces ~41 pre-existing failures on `master` (verified via `git stash` round-trip). Files include:

- `src/config/__tests__/clawcode-yaml-phase100*.test.ts` — depend on the gitignored `clawcode.yaml`.
- `src/discord/__tests__/slash-commands*.test.ts` — multiple GSD/sync-status registration tests fail on master.
- `src/manager/__tests__/daemon-openai.test.ts` — `startOpenAiEndpoint` boot/env override assertions.
- `src/manager/__tests__/bootstrap-integration.test.ts` — buildSessionConfig boot path.
- `src/heartbeat/__tests__/discovery.test.ts` — module-count assertion (drift vs Phase 999.8 registry).
- `src/heartbeat/__tests__/runner.test.ts` — initialize() boot log assertion.

**Branch produces 41 failures; master produces 42 (when excluding the new `auto-compact-at-schema.test.ts`). Plan 124-02 net effect: ZERO new failures.**

**Out-of-scope rationale:** None of these failures are caused by the Plan 124-02 changes (schema field, loader resolver, fixture patches, yaml split, regression test). Per executor rules (`SCOPE BOUNDARY`): log here, do not fix.

**Suggested follow-up:** Operator triages the master-flaky list separately. Phase 124-03 (Discord `/compact` admin command) will need a clean `src/discord/__tests__/slash-commands.test.ts` baseline before it can land.

## DEFERRED-124-B — Pre-existing tsc error in compact-session-integration.test.ts

**Discovered:** Plan 124-03 execution (2026-05-14)

**File:** `src/manager/__tests__/compact-session-integration.test.ts:121`

**Symptom:** `error TS2740: Type '{ embed: (text: string) => Promise<Float32Array<ArrayBufferLike>>; }' is missing the following properties from type 'EmbeddingService': pipeline, warmPromise, warmup, warmupV2, and 6 more.`

**Reproduce on master (independent of Plan 124-03 changes):**
```
git stash --include-untracked && npx tsc --noEmit 2>&1 | grep compact-session-integration ; git stash pop
```

**Out-of-scope rationale:** Pre-existing tsc error on the 124-01 integration test, not caused by Plan 124-03's slash-command addition (which only touches `src/discord/`). Per executor `SCOPE BOUNDARY`: log here, do not fix. The test still runs (`vitest` is JavaScript-eval'd; `tsc --noEmit` strict-mode discrepancy doesn't block runtime).

**Suggested follow-up:** Either widen the `EmbeddingService` mock fixture to include `pipeline`/`warmPromise`/etc., or change the mock cast strategy in 124-01's test. Owner: whichever phase next touches that test file (likely Phase 125 when the tiered extractor lands).
