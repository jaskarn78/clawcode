# Phase 121 — Subagent UX Completion + Chunk-Boundary — Phase Summary

**Status:** Code-complete across both plans; merged to master; deploy held per `feedback_ramy_active_no_deploy`. Production verification (SC-3 + sub-bug B fixture) gated on next deploy window.
**Phase window:** 2026-05-14 (both plans landed same day; promoted from pre-written Phase 999.36 backlog plans 02 + 03).

## Plans

| Plan | Subject | Commits | Status |
|------|---------|---------|--------|
| 121-01 | Sub-bug D — premature completion gate (`streamFullyDrained && deliveryConfirmed`) + `subagent_idle_warning` separation + autoArchive guard | `d48afa1` `524e42e` `a9be728` `fd737dc` `2e51d58` `5215b14` (+ 2 doc/test) | Merged to master; tests 97/97 green |
| 121-02 | Sub-bug B — off-by-3 chunk-boundary seam at editor/overflow handoff + `splitMessage` sibling audit (clean — no fix needed) | `27c4883` `1e7a484` `d134492` | Merged to master; `seamGapBytes:0` pinned in tests |

## Success Criteria — verification status

| SC | Description | Status | Evidence |
|----|-------------|--------|----------|
| SC-1 | `subagent_complete` fires only on stream-drained + delivery-confirmed | ✅ **Code-complete** | `relay-and-mark-completed.ts` returns `delivery-not-confirmed` discriminant; 97 tests green |
| SC-2 | Off-by-3 byte seam at 2000-char boundary loses zero content | ✅ **Code-complete** | 2003-char fixture green; `EDITOR_TRUNCATE_INDEX` module-level + matching cursor |
| SC-3 | Production `seamGapBytes` logs `0` across 24h soak | ⏳ **Deploy-gated** | Post-deploy grep `journalctl -u clawcode -g "subagent overflow chunks summary"` and confirm `seamGapBytes:0` |
| SC-4 | `webhook-manager.ts:splitMessage` sibling audit | ✅ **No fix needed** | Algorithm uses linear `trimStart` + smart-break with no separate editor/overflow pipeline — no seam class exists. Pinned in `subagent-chunk-boundary-fixture.test.ts` |

## Outstanding operator actions

1. **Deploy clearance + production grep (SC-3)** — on next deploy, monitor `seamGapBytes` field in subagent overflow chunk summary logs for 24h; expect zero gaps.
2. **Visual confirmation** — re-test the two flagged evidence threads after deploy:
   - reelforge-build-v2 `1501361804012687504` (turn 1 mid-narrative cut, turn 2 mid-word "o-end")
   - Admin Clawdy `1501302129782952126` ("lls the whole file" → should read "reads the whole file")

## Open items (operator-visible)

- **`idleWarningEmittedAt` persistence** — in-memory only; resets on daemon restart. First post-restart quiescence cycle may emit a redundant warning. Persistence option (`~/.clawcode/manager/subagent-idle-state.json`) deferred; not blocking.
- **One-time migration cleanup** — `// REMOVE AFTER 999.36+1 milestone closes` markers in `thread-registry.ts` + `daemon.ts`. Schedule removal ~2 weeks post-deploy once all live bindings naturally re-stamp.

## Net

- 2/2 plans code-complete and merged.
- 2/4 SCs closed locally; 1 deploy-gated; 1 already proven clean.
- No threat flags; tsc green; no regressions in test suite.

Phase 121 closes cleanly when SC-3 24h `seamGapBytes:0` soak is recorded after the next deploy.
