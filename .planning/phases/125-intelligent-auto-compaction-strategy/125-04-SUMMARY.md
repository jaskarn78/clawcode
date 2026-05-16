---
phase: 125
plan: 04
title: Tier 3 prose summary + A/B verification fixture + latency regression sentinel
status: complete
completed: 2026-05-14
sentinel: "[125-04-tier3-prose]"
milestone: phase-125-feature-complete
commits:
  - 48698b9  # T-01: tier3 prose + payload truncator + seam wire
  - 0d00430  # T-02: SC-5 A/B fuzzy fixture
  - cfc5993  # T-03: SC-6 latency sentinel + baseline pin
closes:
  - SC-5
  - SC-6
---

# Phase 125 Plan 04 — Tier 3 + A/B + Latency Sentinel: Summary

Closes Phase 125. Tier pipeline complete; A/B and latency gates live local. Production verification deferred behind Ramy-active deploy hold.

## Commits

- `48698b9` — T-01: `tier3-payload-truncator.ts` (pure helper, 4 KB/8 KB stubs) + `tier3-prose.ts` (DI'd Haiku, 30s timeout, deterministic fallback) + seam wire in `index.ts`; `Tier3SummarizeFn` + `tier3Summarize?` on `BuildExtractorDeps`. 14 tests added.
- `0d00430` — T-02: `ab-pre.json` / `ab-post.json` (20-prompt corpus across client-name / task-state / feedback-rule) + `ab-fixture.test.ts` (structural keyword-survival test, canned tier2 YAML + tier3 prose). 20/20 agreement.
- `cfc5993` — T-03: `latency-sentinel.test.ts` (in-process budget < 500 ms; reduction_pct ≥ 40) + `latency-baseline.json` sidecar pinned at the 30 000 ms / 8 000 ms regression-sentinel pair. Post-deploy verification procedure documented inline.

## Tests Added

- `src/manager/compact-extractors/__tests__/tier3-truncator.test.ts` (7 cases)
- `src/manager/compact-extractors/__tests__/tier3-prose.test.ts` (7 cases)
- `src/manager/compact-extractors/__tests__/ab-fixture.test.ts` (1 case)
- `src/manager/compact-extractors/__tests__/latency-sentinel.test.ts` (2 cases)

## Test Output (final)

```
Test Files  10 passed (10)
     Tests  60 passed (60)
  Start at  15:47:29
  Duration  1.16s
```

Phase 124 regression suite (5 files / 30 tests): all green.

## Metrics

- **Byte reduction (Tier 3 contribution + full pipeline):** synthetic 6 h replay 20 594 → 2 782 bytes (**86 %**) on the live fixture (pinned in `latency-baseline.json`).
- **Pipeline overhead:** **14.9 ms** wall-clock on the synthetic fixture (budget 500 ms).
- **A/B agreement:** **20 / 20** (>= 18/20 SC-5 target).
- **Production baseline first-token:** 30 000 ms (observed 2026-05-13). **Target:** < 8 000 ms. Production measurement deferred.

## Deviations

None. Plan executed exactly as written. One micro-fix during T-01: the deterministic-stub test initially used `"X".repeat(...)` which triggered the base64-hint regex; switched the test payload to space-separated chars so the `text` kind classification fired as documented (test change only, not implementation).

## Open Items

- **Production SC-5 + SC-6 verification** — both deferred behind `feedback_ramy_active_no_deploy.md`. Post-deploy procedure (verbatim, copy-pasteable) lives in `latency-sentinel.test.ts` header comment: journalctl `[125-04-tier3-prose]` grep + `clawcode usage fin-acquisition --last 5` against the 30-60 s baseline.
- **A/B structural vs. behavioral** — Plan T-02.4 acknowledges the local fixture asserts *keyword survival* through the pipeline, not *agent response parity*. End-to-end agent A/B requires a live deployed agent; deferred.

## Phase 125 milestone

This plan is the final plan in Phase 125. With Plans 01 (active-state YAML), 02 (single seam + Tier 1 + Tier 4), 03 (Tier 2 Haiku + dual-persist), and 04 (Tier 3 prose + A/B + latency sentinel), **Phase 125 is feature-complete locally**. SC-1 / SC-2 / SC-3 / SC-4 / SC-5 / SC-6 / SC-8 closed in code; SC-7 inherited from Phase 124-04. Deploy + production verification of SC-5 and SC-6 remain pending the Ramy-active deploy window.

## Self-Check: PASSED

- `src/manager/compact-extractors/tier3-prose.ts` — exists
- `src/manager/compact-extractors/tier3-payload-truncator.ts` — exists
- `src/manager/compact-extractors/__tests__/tier3-prose.test.ts` — exists
- `src/manager/compact-extractors/__tests__/tier3-truncator.test.ts` — exists
- `src/manager/compact-extractors/__tests__/ab-fixture.test.ts` — exists
- `src/manager/compact-extractors/__tests__/fixtures/ab-pre.json` — exists
- `src/manager/compact-extractors/__tests__/fixtures/ab-post.json` — exists
- `src/manager/compact-extractors/__tests__/latency-sentinel.test.ts` — exists
- `src/manager/compact-extractors/__tests__/fixtures/latency-baseline.json` — exists
- Commits `48698b9`, `0d00430`, `cfc5993` — all present in git log
- Phase 125 suite 60/60 + Phase 124 regression 30/30 — passing
