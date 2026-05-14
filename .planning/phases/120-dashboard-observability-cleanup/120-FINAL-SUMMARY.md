---
phase: 120-dashboard-observability-cleanup
subsystem: dashboard + observability
tags: [BenchmarksView, percentileCell, IPC, allowlist, regression-sentinel, silent-path-bifurcation]
requirements: [DASH-01, DASH-02, DASH-03, DASH-04, DASH-05]
completed: 2026-05-14
status: complete-with-1-deferral-and-1-deploy-block
key-files:
  created:
    - src/dashboard/client/src/components/percentileCell.tsx
    - src/dashboard/client/src/components/__tests__/percentileCell.test.tsx
    - src/dashboard/client/src/components/__tests__/BenchmarksView.tool-rollup.test.tsx
    - src/dashboard/client/src/__tests__/static-grep-text-danger.test.ts
    - src/manager/__tests__/static-grep-iterateWithTracing.test.ts  (Plan 03, prior session)
    - .planning/phases/120-dashboard-observability-cleanup/120-02-SUMMARY.md
    - .planning/phases/120-dashboard-observability-cleanup/120-03-SUMMARY.md  (prior session)
    - .planning/phases/120-dashboard-observability-cleanup/120-03-SMOKE.md
    - .planning/phases/120-dashboard-observability-cleanup/120-04-VERIFICATION.md
    - .planning/phases/120-dashboard-observability-cleanup/deferred-items.md
  modified:
    - src/dashboard/client/src/components/BenchmarksView.tsx
    - src/ipc/protocol.ts
    - src/ipc/__tests__/protocol-daemon-parity.test.ts
    - src/ipc/__tests__/protocol.test.ts
    - .planning/phases/120-dashboard-observability-cleanup/120-DIAGNOSTIC.md
    - .planning/phases/120-dashboard-observability-cleanup/120-CONTEXT.md
---

# Phase 120 Final Summary — Dashboard Observability Cleanup

Five operator-flagged regressions on the Benchmarks tab. Closed three
(DASH-01/02/03), pinned the silent-path-bifurcation regression sentinel
already shipped in Plan 03 (DASH-04), and surfaced + locally-fixed the
DASH-05 CLI failure (allowlist drift). One follow-up deferred, one fix
deploy-pending.

## Closure by requirement

| Req | Status | Evidence |
|---|---|---|
| DASH-01 | DEFENSIVE-CLOSED | `(unnamed)` fallback shipped; production data showed bug non-reproducible — see `120-DIAGNOSTIC.md` |
| DASH-02 | CLOSED | `percentileCell` utility + static-grep sentinel; commit `e7397cb`, `5d36b57` |
| DASH-03 | CLOSED | Empty-state literal `'No tool spans recorded in window'` pinned by static-grep; commit `5d36b57` |
| DASH-04 | CLOSED (sentinel) + DEFERRED-120-A | Static-grep sentinel pinned by `ba33aa9` / `83837cf`; producer-gating gap deferred to follow-up phase |
| DASH-05 | BLOCKED-deploy-pending | Allowlist fix shipped at `75e98b1`; production verification awaits deploy clearance |

## Commits (this session)

| Commit | Purpose |
|---|---|
| `8746a28` | Reconcile DASH-04 column names; capture deferred producer gap |
| `e7397cb` | `percentileCell` utility — null wins over isBreach |
| `5d36b57` | BenchmarksView DASH-01/02/03 frontend bundle + static-grep sentinel |
| `12fdeb5` | Plan 02 SUMMARY + Plan 03 reconciled SMOKE |
| `75e98b1` | Allowlist `tool-latency-audit` + widen parity sentinel (also catches `skill-create`) |
| `5969a37` | DASH-05 VERIFICATION.md — BLOCKED-deploy-pending verdict |

Total: 6 atomic commits, all `npm test` green for touched files at commit time.

## Tests

- 20 dashboard SPA tests green (3 files: percentileCell, BenchmarksView tool-rollup, static-grep text-danger).
- 72 IPC tests green (incl. widened parity sentinel + updated `IPC_METHODS` exact-array assertion).
- 2 Plan 03 sentinel tests (`static-grep-iterateWithTracing`) green from prior session.
- Dashboard SPA build clean (1.43s, `BenchmarksView-D6hpq2-b.js 34.39 kB`).

## Deviations from plans

1. **Plan 02 T-01 (Rule 4 non-reproduction):** plan anticipated four
   root-cause branches for DASH-01. All four fail empirically against
   production data. Shipped defensive `(unnamed)` fallback only, did not
   fabricate a fix.
2. **Plan 02 T-02 (scope narrowing):** static-grep sentinel scoped to
   BenchmarksView only — global `text-danger` sweep would flag ~20
   legitimate uses in sibling components, violating CONTEXT D-08 (no new
   theme abstraction).
3. **Plan 02 T-03 (memoryOnly literal symmetry):** added a symmetric
   `'No memory-tool spans recorded in window'` literal — Rule 2 critical
   UX, not in plan but the obviously-correct sibling.
4. **Plan 04 T-01 (Rule 2 fix):** verification surfaced a real IPC
   allowlist regression. Per advisor (and the 116-postdeploy + 124-01
   precedent), shipped the allowlist + sentinel fix inline. Verdict honors
   "no silent PASS" rule by reading BLOCKED-deploy-pending. Same Rule-2
   surfaced `skill-create` had the identical gap; fixed in same commit to
   avoid "fix one, expose another" thrash.
5. **Plan 04 framing correction:** CONTEXT references Phase 106 hotfix
   `fa72303` — that SHA does not exist in git history. The actual
   lineage is `12ff097` (116-postdeploy IPC allowlist drift + sentinel
   test), `ec530d7` (116-postdeploy list-rate-limit-snapshots-fleet),
   `96bf6ec` (124-01 compact-session). Documented in
   `120-04-VERIFICATION.md` §"Notes on plan framing".

## Open items

- **`DEFERRED-120-A` — `addToolExecutionMs` callsite-gating regression.**
  139/232 post-2026-05-01 traces with `tool_call.*` spans have NULL
  `tool_execution_ms`. Canonical producer is on the production path
  (Plan 03 T-01 confirmed), so this is NOT silent-path-bifurcation;
  a different gating condition skips the `addToolExecutionMs` calls.
  Captured in `deferred-items.md`. Out of phase scope (Rule 4
  architectural).
- **DASH-05 production verification.** Awaits deploy clearance (D-09,
  Ramy active). Re-run after deploy: `ssh clawdy 'sudo -u clawcode
  /usr/bin/clawcode tool-latency-audit --json'` should exit 0 + emit
  valid JSON. Trace window was confirmed non-empty (332 spans/24h).
- **Parity sentinel gap precedent.** The original `case`-only extractor
  silently allowed `if (method === "...")` drift for an unknown duration.
  Audit during this session found only 2 missing entries (both fixed);
  future similar drift would be caught now. No further action needed.

## Self-Check

- All listed key-files exist on disk.
- All listed commits resolve in `git log`.
- 20+72 = 92 tests green across touched files (per latest run at 13:40 UTC).
- VERIFICATION.md verdict line matches one of the three sanctioned strings.
- Diagnostic + CONTEXT D-03 carry the corrected column-name framing.
