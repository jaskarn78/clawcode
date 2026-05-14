---
phase: 120-dashboard-observability-cleanup
plan: 02
subsystem: dashboard-frontend
tags: [BenchmarksView, percentileCell, regression-sentinel, dash-01, dash-02, dash-03]
requirements: [DASH-01, DASH-02, DASH-03]
completed: 2026-05-14
status: complete
key-files:
  created:
    - src/dashboard/client/src/components/percentileCell.tsx
    - src/dashboard/client/src/components/__tests__/percentileCell.test.tsx
    - src/dashboard/client/src/components/__tests__/BenchmarksView.tool-rollup.test.tsx
    - src/dashboard/client/src/__tests__/static-grep-text-danger.test.ts
  modified:
    - src/dashboard/client/src/components/BenchmarksView.tsx
decisions:
  - "DASH-01 ships as defense-in-depth only — non-reproducible from production data"
  - "percentileCell utility null-takes-precedence-over-breach (Test 4)"
  - "Empty-state literal pinned exactly per CONTEXT D-06"
  - "Static-grep sentinel scoped to BenchmarksView only — D-08 forbids global theme abstraction"
---

# Phase 120 Plan 02: BenchmarksView DASH-01/02/03 — Summary

## T-01 (DASH-01) — Non-reproducible. Defensive fallback only.

Production diagnostic (see `120-DIAGNOSTIC.md` §"DASH-01"):
- `trace_spans.name` is well-formed for every `tool_call.*` row (zero empty,
  zero NULL, all prefix-length ≥ 14 chars).
- The SQL `SUBSTR(s.name, 11)` (perToolPercentiles, `trace-store.ts:969`)
  correctly strips the 10-char `tool_call.` prefix.
- `BenchmarksView.tsx:305` renders `{r.tool}` directly with no intermediate
  transformation.

There is no SQL bug, no IPC binding loss, no emitter blank-name. The
original 999.49 hypothesis (LENGTH guard misfire) is wrong; the secondary
hypotheses (IPC, emitter, frontend JOIN) all fail empirically. Per advisor
guidance, did NOT fabricate a fix. Shipped the defensive `(unnamed)`
fallback so a future regression renders an attributable label instead of a
silent blank. Static-grep Test 4 pins the literal.

## T-02 (DASH-02) — percentileCell utility + static-grep sentinel

`src/dashboard/client/src/components/percentileCell.tsx` — single canonical
renderer. Returns `<td>` with:
- className `text-fg-3` + content `—` when value is null (regardless of isBreach)
- className `text-danger` when value present + isBreach
- className `text-fg-1` when value present + not breach
- Optional `format: (number) => ReactNode` for formatted display
- Optional `className: string` merged into the variant class

`BenchmarksView.tsx` refactored: p50/p95/p99 cells now route through
`percentileCell({ value, isBreach, format: formatMs, className })`. Per
pre-Phase-120 convention p99 stays neutral text-fg-2 (only p50/p95 carry
the SLO-breach indicator).

7 unit tests in `percentileCell.test.tsx` — null-wins-over-breach (Test 4)
is the critical invariant.

Static-grep sentinel at `src/dashboard/client/src/__tests__/static-grep-text-danger.test.ts`:
- Test 1: BenchmarksView imports `percentileCell` from `@/components/percentileCell`
- Test 2: no line in BenchmarksView co-locates `text-danger` + `formatMs(`
- Test 3: DASH-03 literal pinned
- Test 4: DASH-01 fallback pinned
- Test 5: positive control (text-danger exists elsewhere — grep works)

**Self-test documented:** probe added a same-line `text-danger`+`formatMs`
violation → Test 2 RED with `L318: ...` offender line → restored →
Test 2 GREEN. Pattern adapted from Phase 119 D-09 and Plan 03 T-02.

## T-03 (DASH-03) — Empty-state literal

Replaced the prior empty-state strings with literal forms:
- Default: `'No tool spans recorded in window'`
- Memory variant: `'No memory-tool spans recorded in window'`

Both render with `text-fg-3` neutral (NOT `text-danger`). Static-grep Test 3
pins the default literal. Per D-06 — string IS the assertion, no
i18n / template / constant indirection.

## Deviations

- **T-01 (Rule 4 — non-reproduction):** plan T-01 anticipated four root-cause
  branches (SQL guard / IPC / emitter / frontend). All four fail empirically
  against production data. Shipped defensive fallback per advisor guidance;
  documented non-reproduction in `120-DIAGNOSTIC.md`. Did not fabricate a fix.
- **Static-grep scope narrowing:** plan T-02 implied a sweep of `text-danger`
  across `src/dashboard/client/src/`. That would flag legitimate uses in
  ~20 sibling components (error banners, status icons, breach badges with
  no null path). Per CONTEXT D-08 (no new abstractions) the sentinel scope
  was narrowed to BenchmarksView only — the surface DASH-02 actually
  regresses. Broader sweep is out of phase scope.
- **memoryOnly empty-state:** added a sibling literal
  `'No memory-tool spans recorded in window'` (not in plan but symmetric
  with the default literal — Rule 2 critical UX).

## Verification

```
Test Files  3 passed (3)
     Tests  20 passed (20)
```

Dashboard SPA build: `BenchmarksView-D6hpq2-b.js 34.39 kB (gzip 10.69 kB)`,
1.43s, clean.

## Commits

- `e7397cb` feat(120-02-T02): percentileCell utility — null wins over isBreach
- `5d36b57` feat(120-02-T01T02T03): BenchmarksView DASH-01/02/03 frontend bundle

## Self-Check: PASSED

- `src/dashboard/client/src/components/percentileCell.tsx` exists.
- `src/dashboard/client/src/components/__tests__/percentileCell.test.tsx` exists.
- `src/dashboard/client/src/components/__tests__/BenchmarksView.tool-rollup.test.tsx` exists.
- `src/dashboard/client/src/__tests__/static-grep-text-danger.test.ts` exists.
- Commits `e7397cb` + `5d36b57` present.
- All 20 tests green; SPA build clean.
