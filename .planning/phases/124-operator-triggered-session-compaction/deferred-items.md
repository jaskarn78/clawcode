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
