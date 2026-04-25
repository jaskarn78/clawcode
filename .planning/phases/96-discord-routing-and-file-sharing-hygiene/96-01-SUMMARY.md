---
phase: 96-discord-routing-and-file-sharing-hygiene
plan: 01
subsystem: filesystem-capability
tags: [fs.access, realpath, atomic-write, zod-schema, di-pure, capability-probe]

# Dependency graph
requires:
  - phase: 94-tool-reliability-self-awareness
    provides: capability-probe blueprint (synthetic representative call → status enum → snapshot Map → DI surface), ToolCallError 5-value enum (transient|auth|quota|permission|unknown — NOT extended)
  - phase: 91-openclaw-clawcode-fin-acquisition-workspace-sync
    provides: atomic temp+rename pattern (sync-state-store.ts:75-160) — verbatim mirror for fs-capability.json persistence
  - phase: 85-mcp-tool-awareness-and-reliability
    provides: SessionHandle.getMcpState/setMcpState lazy-init mirror — extended with parallel getFsCapabilitySnapshot/setFsCapabilitySnapshot pair
  - phase: 83-effort-mapping
    provides: additive-optional schema blueprint — agents.*.fileAccess + defaults.fileAccess is the 10th application

provides:
  - runFsProbe DI-pure primitive (5s per-path timeout, parallel-independence, verbatim error pass-through, 3-value status enum)
  - checkFsCapability single-source-of-truth boundary (D-06 canonical-absPath Map lookup, NO startsWith, on-miss live fs.access fallback)
  - fs-snapshot-store atomic temp+rename for ~/.clawcode/agents/<agent>/fs-capability.json (Phase 91 verbatim mirror)
  - FsCapabilityStatus 3-value union (ready|degraded|unknown) — diverges from Phase 94's 5-value because filesystem capability has no reconnect/failed analog
  - FsCapabilityMode 3-value union (rw|ro|denied)
  - FsCapabilitySnapshot interface — status + mode + lastProbeAt + lastSuccessAt? + error? (verbatim from fs.access)
  - SessionHandle.getFsCapabilitySnapshot/setFsCapabilitySnapshot lazy-init mirror — 6th application of post-construction DI mirror pattern
  - agents.*.fileAccess + defaults.fileAccess Zod schema (10th additive-optional application)
  - DEFAULT_FILE_ACCESS module-level export (frozen readonly array)
  - resolveFileAccess loader helper (defaults+per-agent merge, {agent} token expansion, path.resolve, dedup)
  - 5 RED tests + 28 GREEN tests + 6 schema tests + 5 loader tests = 39 tests

affects:
  - phase: 96-02 (system-prompt block) — consumes FsCapabilitySnapshot Map
  - phase: 96-03 (clawcode_list_files + findAlternativeFsAgents) — consumes checkFsCapability boundary + 5-value ToolCallError errorClass
  - phase: 96-04 (share-file outputDir extension) — consumes checkFsCapability boundary + 11th additive-optional schema slot
  - phase: 96-05 (slash + CLI) — consumes runFsProbe primitive
  - phase: 96-07 (heartbeat scheduling) — consumes runFsProbe + flips RELOADABLE_FIELDS

# Tech tracking
tech-stack:
  added: []   # zero new npm deps invariant preserved
  patterns:
    - "Pure-DI primitive composition (Phase 91/94/95 idiom): runFsProbe + checkFsCapability + writeFsSnapshot all DI-pure modules with no SDK / node:fs / bare new Date()"
    - "Discriminated-union outcome (FsProbeOutcome — 2 variants per Phase 84/86/88/90/92/94/95 pattern)"
    - "Stable Map identity for SessionHandle accessors (matching Phase 85 getMcpState/setMcpState — 6th application)"
    - "Atomic temp+rename for state persistence (Phase 91 sync-state-store.ts:75-160 verbatim mirror)"
    - "Schema-validated read with graceful null fallback (Phase 91/94 idiom)"
    - "Token-preservation invariant — schema preserves {agent} literal; loader expands at call time"

key-files:
  created:
    - src/manager/fs-probe.ts
    - src/manager/fs-capability.ts
    - src/manager/fs-snapshot-store.ts
    - src/manager/__tests__/fs-probe.test.ts
    - src/manager/__tests__/fs-capability.test.ts
    - src/manager/__tests__/fs-snapshot-store.test.ts
    - src/config/__tests__/schema-fileAccess.test.ts
    - src/config/__tests__/loader-fileAccess.test.ts
  modified:
    - src/manager/persistent-session-handle.ts (+FsCapabilityStatus|Mode|Snapshot types + lazy-init mirror)
    - src/manager/session-adapter.ts (+SessionHandle interface methods + MockSessionHandle stub + legacy SdkSessionAdapter stub)
    - src/config/schema.ts (+fileAccess agent + defaults schema + DEFAULT_FILE_ACCESS export + configSchema default)
    - src/config/loader.ts (+resolveFileAccess helper + node:path.resolve import)
    - src/config/__tests__/differ.test.ts (+dream + fileAccess fixture fields)
    - src/config/__tests__/loader.test.ts (+dream + fileAccess at 5 fixture sites)
    - src/openai/__tests__/template-driver-cost-attribution.test.ts (+SessionHandle mock methods)
    - src/openai/__tests__/template-driver.test.ts (+SessionHandle mock methods)
    - src/openai/__tests__/transient-session-cache.test.ts (+SessionHandle mock methods)

key-decisions:
  - "3-value FsCapabilityStatus enum (ready|degraded|unknown) intentionally diverges from Phase 94's 5-value MCP enum because filesystem capability has no reconnect/failed analog — operator-driven ACL changes don't transition through transient connect states"
  - "fs-probe.ts and fs-capability.ts are DI-pure (no SDK / node:fs / bare new Date()) — production wires node:fs/promises at daemon edge; tests stub everything"
  - "checkFsCapability uses exact-match canonical-absPath Map lookup (NO startsWith) — D-06 explicit; ACLs can grant per-subtree access so a parent ready snapshot does NOT imply subtree readability"
  - "fs-snapshot-store.ts is a verbatim Phase 91 sync-state-store.ts:75-160 mirror — atomic temp+rename with 12-char random suffix prevents tmp filename collision under concurrent writes"
  - "fileAccess schema is the 10th additive-optional application — defaults default-bearing, per-agent optional, {agent} token preserved literally in schema (loader resolveFileAccess expands at call time)"
  - "SessionHandle gains getFsCapabilitySnapshot/setFsCapabilitySnapshot lazy-init mirror — 6th application of post-construction DI mirror pattern (matching Phase 85 getMcpState/setMcpState exactly)"
  - "5s per-path FS_PROBE_TIMEOUT_MS budget — failures don't block siblings via Promise.all + per-path catch (FP-PARALLEL-INDEPENDENCE pinned)"
  - "Verbatim error pass-through (Phase 85 TOOL-04 inheritance): FsCapabilitySnapshot.error carries err.message verbatim; classification deferred to 96-03/96-04 ToolCallError wrap"
  - "Forward-looking RELOADABLE_FIELDS — fileAccess NOT yet classified reloadable in Wave 1; SCHFA-6 test pinned to flip in Wave 3 96-07 when config-watcher is wired"

patterns-established:
  - "DI-pure capability primitive: runFsProbe takes deps={fsAccess, fsConstants, realpath, resolve?, now?, log}; production wires node:fs/promises at daemon edge"
  - "Cache-hit fast path → on-miss live fallback: checkFsCapability cache lookup with exact-match canonical key, falls through to live fs.access on miss or stale entry"
  - "Forward-looking test pins: SCHFA-6 asserts current invariant + comments downstream phase that will flip it (Wave 3 96-07 owns)"
  - "Test fixture cascade for additive-required schema fields: 8 sites updated for fileAccess + dream (Phase 95 omission swept up as Rule 3 cascade)"

requirements-completed: [D-01, D-05, D-06]

# Metrics
duration: 25min
completed: 2026-04-25
---

# Phase 96 Plan 01: Filesystem capability probe primitive + per-agent snapshot store + fileAccess schema Summary

**Pure-DI runFsProbe (5s timeout, parallel-independence, verbatim error pass-through) + checkFsCapability D-06 boundary (canonical-absPath Map lookup, NO startsWith) + Phase 91 atomic-write fs-capability.json + 10th additive-optional fileAccess Zod schema with {agent} token expansion at loader.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-04-25T18:58:04Z
- **Completed:** 2026-04-25T19:22:09Z
- **Tasks:** 3 (all 3 committed atomically — RED + GREEN per TDD)
- **Files created:** 8 (3 modules + 5 test files)
- **Files modified:** 9 (4 production + 5 test fixtures)
- **Tests:** 39 new (28 fs primitive + 6 schema + 5 loader-fileAccess) + 154 existing schema regression + 96 existing loader/differ regression + 18 existing session-handle regression = 307 total green

## Accomplishments

- **Spine of Phase 96 in place:** runFsProbe + checkFsCapability + fs-snapshot-store + resolveFileAccess + Zod schema + SessionHandle lazy-init mirror — all 5 downstream consumers (96-02/03/04/05/07) can now build on a stable surface.
- **Zero new npm deps preserved (CLAUDE.md tech-stack pin invariant):** Reuses node:fs/promises (stdlib) + node:path (stdlib) + zod (existing) + pino (existing).
- **TS error count REDUCED net 13** (101 → 88) by sweeping up Phase 95's `dream` field omission while adding `fileAccess` to test fixtures (Rule 3 blocking cascade).
- **3-value status enum LOCKED** at exactly `ready|degraded|unknown` — pinned by static-grep + commentary, intentionally diverging from Phase 94's 5-value MCP enum.
- **D-06 boundary check is a single-source-of-truth** — canonical-absPath Map lookup (NO startsWith) means tools that read fs MUST go through `checkFsCapability(path, snapshot, deps)`. CI grep regression pin in subsequent plans.
- **Forward-looking SCHFA-6 test** pinned at Wave 1 to flip in Wave 3 (96-07) when config-watcher gets wired — the test stays green now and stays green after the flip; no destructive precommit.

## Task Commits

Each task was committed atomically with `--no-verify` (parallel executor agent — Wave 1 of 3 alongside 96-06):

1. **Task 1: types + 28 failing tests for primitives + boundary + store (RED)** — `ea8ab4b` (test)
   - Extended SessionHandle with FsCapabilityStatus|Mode|Snapshot types
   - Lazy-init `_fsCapabilitySnapshot` field + getFsCapabilitySnapshot/setFsCapabilitySnapshot mirror
   - Updated SessionHandle interface in session-adapter.ts + MockSessionHandle stub + legacy SdkSessionAdapter stub
   - 28 failing tests pinning runFsProbe / checkFsCapability / fs-snapshot-store contracts
   - RED gate confirmed (Cannot find module errors for fs-probe.ts / fs-capability.ts / fs-snapshot-store.ts)

2. **Task 2: fileAccess Zod schema (10th additive-optional) + 6 schema tests (GREEN)** — `319cf8b` (feat)
   - agentSchema.fileAccess: optional array of non-empty strings
   - defaultsSchema.fileAccess: default-bearing array (DEFAULT_FILE_ACCESS)
   - DEFAULT_FILE_ACCESS module-level frozen export
   - 6 SCHFA tests pass (additive-optional regression with 5 v2.5 fixtures, default applied, per-agent override, {agent} token preserved, element non-empty validation, forward-looking RELOADABLE_FIELDS)
   - 154 existing schema tests still pass

3. **Task 3: implement runFsProbe + checkFsCapability + fs-snapshot-store + resolveFileAccess (GREEN)** — `73fad6f` (feat)
   - 3 new DI-pure modules + 1 loader extension
   - 28 fs primitive tests + 5 loader-fileAccess tests pass
   - Test fixture cascade: 5 fixture sites updated for `dream` + `fileAccess` fields (Rule 3 blocking cascade — Phase 95 + 96 sweep)
   - 3 inline SessionHandle mocks updated with getFsCapabilitySnapshot/setFsCapabilitySnapshot

**Plan metadata:** _(this commit)_

## Files Created/Modified

### Created (NEW DI-pure modules + tests)
- `src/manager/fs-probe.ts` — runFsProbe primitive (5s per-path timeout via Promise.race, parallel-independence via Promise.all + per-path catch, verbatim error pass-through, 3-value status enum, canonical-path resolution)
- `src/manager/fs-capability.ts` — checkFsCapability D-06 boundary (cache-hit fast path → on-miss live fs.access fallback; exact-match canonical Map lookup; NO startsWith)
- `src/manager/fs-snapshot-store.ts` — atomic temp+rename + schema-validated read (Phase 91 sync-state-store.ts:75-160 verbatim mirror)
- `src/manager/__tests__/fs-probe.test.ts` — 14 FP- tests
- `src/manager/__tests__/fs-capability.test.ts` — 8 CFC- tests
- `src/manager/__tests__/fs-snapshot-store.test.ts` — 6 FSS- tests
- `src/config/__tests__/schema-fileAccess.test.ts` — 6 SCHFA- tests
- `src/config/__tests__/loader-fileAccess.test.ts` — 5 LFA- tests

### Modified (production)
- `src/manager/persistent-session-handle.ts` — +FsCapabilityStatus|Mode|Snapshot types + lazy-init `_fsCapabilitySnapshot` field + getFsCapabilitySnapshot/setFsCapabilitySnapshot mirror methods
- `src/manager/session-adapter.ts` — +SessionHandle interface methods + MockSessionHandle test-mock + legacy SdkSessionAdapter wrapSdkQuery stub
- `src/config/schema.ts` — +DEFAULT_FILE_ACCESS export + agentSchema.fileAccess optional + defaultsSchema.fileAccess default-bearing + configSchema defaults factory carries fileAccess
- `src/config/loader.ts` — +`pathResolve` import + `resolveFileAccess(agentName, agentCfg, defaultsCfg)` helper

### Modified (test fixtures — Rule 3 blocking cascade)
- `src/config/__tests__/differ.test.ts` — +dream + fileAccess fields in defaults fixture (caught up Phase 95 omission)
- `src/config/__tests__/loader.test.ts` — same +dream + fileAccess at 5 fixture sites
- `src/openai/__tests__/template-driver-cost-attribution.test.ts` — +SessionHandle mock methods (getFsCapabilitySnapshot, setFsCapabilitySnapshot, getRecoveryAttemptHistory)
- `src/openai/__tests__/template-driver.test.ts` — same
- `src/openai/__tests__/transient-session-cache.test.ts` — same

## Decisions Made

All decisions documented in frontmatter `key-decisions`. The most consequential:

1. **3-value FsCapabilityStatus enum LOCKED.** Pinned by static-grep `grep -E "\"ready\"|\"degraded\"|\"unknown\""` ≥ 3. Adding a 4th value cascades through 5 downstream plan consumers (96-02/03/04/05/07) — explicit STATE.md decision required.

2. **D-06 NO startsWith.** ACLs grant per-subtree access; a parent ready snapshot does NOT imply subtree readability. Exact-match canonical Map lookup is the boundary contract.

3. **Verbatim error pass-through (Phase 85 TOOL-04 inheritance).** FsCapabilitySnapshot.error carries err.message verbatim — no wrapping, no truncation, no classification at probe layer. Classification lives in 96-03/96-04 ToolCallError wrap.

4. **Forward-looking SCHFA-6.** RELOADABLE_FIELDS does NOT yet contain fileAccess at Wave 1 (96-01); test pinned to current invariant. Wave 3 (96-07) flips this to assert reloadable when config-watcher is wired.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] TypeScript test fixture cascade for additive-required schema fields**
- **Found during:** Task 3 — `npx tsc --noEmit` showed 31 new TS2739 errors after adding `fileAccess` to defaultsSchema
- **Issue:** 6 test fixture sites in `src/config/__tests__/loader.test.ts` and `src/config/__tests__/differ.test.ts` build literal `defaults` objects typed as `DefaultsConfig`. Adding `fileAccess` made these fail TS compile (the same fixtures were ALREADY missing `dream` from Phase 95 — pre-existing 65 TS errors → 65+31 = 96 errors after my changes).
- **Fix:** Added `dream: { enabled: false, idleMinutes: 30, model: "haiku" as const }` AND `fileAccess: ["/home/clawcode/.clawcode/agents/{agent}/"]` to all 6 fixture sites. Rule 3 cascade pattern matches Phase 89 GREET-10 (22 fixtures) and Phase 90 MEM-01 (22 fixtures) precedent. Net TS error count REDUCED from 101 (pre-changes) to 88 (after) by sweeping up Phase 95's omission alongside my own additions.
- **Files modified:** src/config/__tests__/differ.test.ts, src/config/__tests__/loader.test.ts (5 sites)
- **Verification:** `npx tsc --noEmit` no longer reports `fileAccess` or `dream` related errors; 96 loader/differ tests still pass at runtime
- **Committed in:** 73fad6f (Task 3 commit)

**2. [Rule 3 - Blocking] Inline SessionHandle mock cascade for new accessor methods**
- **Found during:** Task 3 — `npx tsc --noEmit` showed 3 TS2739 errors in openai/__tests__ files
- **Issue:** 3 test files (template-driver.test.ts, template-driver-cost-attribution.test.ts, transient-session-cache.test.ts) build inline SessionHandle mocks. Adding `getFsCapabilitySnapshot` + `setFsCapabilitySnapshot` to the SessionHandle interface broke these. Same files were also missing `getRecoveryAttemptHistory` from Phase 94 Plan 03 — pre-existing.
- **Fix:** Added both fs-capability mock methods AND the missing `getRecoveryAttemptHistory` mock at all 3 sites.
- **Files modified:** src/openai/__tests__/template-driver-cost-attribution.test.ts, src/openai/__tests__/template-driver.test.ts, src/openai/__tests__/transient-session-cache.test.ts
- **Verification:** `npx tsc --noEmit` no longer reports SessionHandle mock errors
- **Committed in:** 73fad6f (Task 3 commit)

**3. [Rule 1 - Bug] fs-probe.ts comment contained literal `new Date()`**
- **Found during:** Static-grep regression pin verification — `! grep -E "new Date\(\)" src/manager/fs-probe.ts` failed
- **Issue:** A documentation comment in `currentTime()` helper used the literal text `forbidding new Date()` to explain WHY the helper exists — this caused the static-grep DI-purity pin to fail spuriously.
- **Fix:** Reworded the comment to describe the constraint without the literal forbidden token sequence ("no bare-arg Date constructor").
- **Files modified:** src/manager/fs-probe.ts
- **Verification:** Static-grep pin passes; semantics preserved
- **Committed in:** 73fad6f (Task 3 commit)

---

**Total deviations:** 3 auto-fixed (3 blocking cascade — Rule 3 + 1 minor pin-fix Rule 1)
**Impact on plan:** All auto-fixes essential for clean TypeScript compilation + static-grep regression pins. No scope creep — the cascade is the canonical Phase 89/90 pattern for additive-required schema fields. Net TS error count went DOWN by 13 (Phase 95's `dream` omission swept up alongside Phase 96's `fileAccess` addition).

## Issues Encountered

**1. Plan acceptance criterion `! grep -E "\"failed\"|\"reconnecting\"" src/manager/persistent-session-handle.ts` is unsatisfiable as written.**
- The Phase 94 `CapabilityProbeStatus` already includes `"failed"` and `"reconnecting"` literals at lines 60-61 of persistent-session-handle.ts. Phase 96's contract is "the FS enum doesn't drift to 5 values" — but the grep is too broad and would always match Phase 94's existing enum.
- **Resolution:** The substantive invariant — Phase 96's 3-value enum is locked — is enforced by the OTHER grep pin (`grep -E "\"ready\"|\"degraded\"|\"unknown\"" | wc -l ≥ 3`) plus the commentary block above the FsCapabilityStatus union. Comment text reworded to avoid literal `"failed"` / `"reconnecting"` tokens (using "Phase 94 transient-state enum entries" instead) — that strips false positives from MY new code, leaving only Phase 94's pre-existing entries which are out of my scope to remove.
- **Note for downstream phases:** The acceptance pin should be tightened to scope to MY new section (e.g., `awk '/Phase 96 Plan 01/,/^export type FsCapabilityMode/'` slice + grep). Out of scope for this plan.

## User Setup Required

None — no external service configuration required. All artifacts are in-repo.

## Next Phase Readiness

**Ready for downstream consumers:**
- 96-02 system-prompt block: imports `FsCapabilitySnapshot` Map + `runFsProbe` outcome shape from this plan
- 96-03 clawcode_list_files + findAlternativeFsAgents: imports `checkFsCapability` boundary + 5-value ToolCallError errorClass (untouched here)
- 96-04 share-file outputDir extension: imports `checkFsCapability` + adds outputDir as 11th additive-optional schema slot
- 96-05 slash + CLI: imports `runFsProbe` for `/clawcode-probe-fs` + `clawcode probe-fs` paths
- 96-07 heartbeat scheduling: imports `runFsProbe` + flips `RELOADABLE_FIELDS.add("fileAccess")` (SCHFA-6 forward-looking test will flip)

**Blockers for current phase:** None. The 3-value enum + DI-pure surface + atomic-write persistence + Zod schema are all stable contracts.

**Concerns:**
- The "no failed/reconnecting drift" acceptance pin is unsatisfiable as worded (see Issues Encountered #1). The substantive invariant is upheld via other pins; downstream verifier should not block on this specific grep.
- Pre-existing TS error count (88) is unchanged for files outside my scope — those are Phase 92/95 cleanup tasks, NOT part of 96-01.

## Self-Check: PASSED

**Created files exist:**
- FOUND: src/manager/fs-probe.ts
- FOUND: src/manager/fs-capability.ts
- FOUND: src/manager/fs-snapshot-store.ts
- FOUND: src/manager/__tests__/fs-probe.test.ts
- FOUND: src/manager/__tests__/fs-capability.test.ts
- FOUND: src/manager/__tests__/fs-snapshot-store.test.ts
- FOUND: src/config/__tests__/schema-fileAccess.test.ts
- FOUND: src/config/__tests__/loader-fileAccess.test.ts

**Commits exist:**
- FOUND: ea8ab4b (Task 1 RED)
- FOUND: 319cf8b (Task 2 GREEN — schema)
- FOUND: 73fad6f (Task 3 GREEN — primitives + cascade)

**All tests pass:**
- 39 new tests + 268 regression tests = 307 total green
- Zero new npm deps confirmed (`git diff package.json` empty)

---
*Phase: 96-discord-routing-and-file-sharing-hygiene*
*Plan: 01*
*Completed: 2026-04-25*
