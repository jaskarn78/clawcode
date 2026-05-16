# Phase 125 — Intelligent Auto-Compaction Strategy — Phase Summary

**Status:** Feature-complete locally across all 4 plans (Tier 1 + Tier 2 + Tier 3 + Tier 4); merged to master; deploy held per `feedback_ramy_active_no_deploy`. SC-5 (A/B agreement) + SC-6 (latency win) production verification gated on next deploy window.
**Phase window:** 2026-05-14 (entire tiered-retention algorithm landed same day; Plan 04 finalized).
**Builds on:** Phase 124 (CLI + IPC + heartbeat policy primitives) — Plan 125 replaces ONLY the `extractMemoriesFn` callback with a tiered pipeline behind the `src/manager/compact-extractors/` seam.

## Plans

| Plan | Subject | Commits | Status |
|------|---------|---------|--------|
| 125-01 | Active-state header (Tier 1 bedrock) — pure builder + atomic YAML writer + heartbeat injection at `runner.ts` | `1d0464b` `bbcc624` `94dbc2d` | Merged; sentinel `[125-01-active-state]` |
| 125-02 | Single extractor seam (`src/manager/compact-extractors/`) + Tier 1 verbatim gate + Tier 4 drop rules + dual-site daemon collapse | `40ee0c2` `7adb94d` `7726209` | Merged; 18 tests green; daemon.ts `split("\n")` deletions = 0 |
| 125-03 | Tier 2 — Haiku structured extraction (active clients, decisions, standing rules, in-flight tasks, drive paths, recover-or-lose-it numbers) — reuses session-summarizer Haiku call shape; dual-persist to `state/active-state.yaml` AND `memory.db` | `a5faf64` `3f6fad2` `09fcd09` | Merged; 30/30 Phase 124 regression green; Tier 2 fields wired into builder |
| 125-04 | Tier 3 prose summary + payload truncator + 20-prompt A/B fuzzy fixture (SC-5) + latency sentinel + pre-deploy baseline pin (SC-6) | `48698b9` `0d00430` `cfc5993` | Merged; 60/60 Phase 125 suite + 30/30 Phase 124 regression green |

## Success Criteria — verification status

| SC | Description | Status | Evidence |
|----|-------------|--------|----------|
| SC-1 | Active-state header renders at session top + refreshed every compaction | ✅ **Code-complete** | `state/active-state.yaml` per-agent + heartbeat injection regex-anchored; sentinel `[125-01-active-state]` |
| SC-2 | Tier 1 verbatim preservation (last N=10 turns, SOUL.md, IDENTITY.md, today's daily-notes, last 3 operator messages) | ✅ **Code-complete** | Marker-token regression test in `compact-extractors/__tests__/` survives N+5 compaction |
| SC-3 | Tier 4 drop rules — ≥40% byte reduction on synthetic 6-hour fin-acquisition replay | ✅ **Code-complete** | `ab-pre.json` / `ab-post.json` fixture pinned; byte-reduction measured pre-deploy |
| SC-4 | Tier 2 structured Haiku extraction persists to `active-state.yaml` AND `memory.db` chunk | ✅ **Code-complete** | `tier2-haiku.ts` + `builder-tier2-merge.test.ts` covers durable-across-reset path |
| SC-5 | A/B agreement >90% on 20-prompt fixture (same client name / task state / most recent feedback rule) | ✅ **Code-complete (fixture)** | 20/20 agreement pinned in `ab-fixture.test.ts`; production live-grading gated on deploy |
| SC-6 | First-token latency drops below 8 s on 6-hour-session replay; pre-compaction baseline ~30-60 s captured as regression sentinel | ✅ **Code-complete (sentinel)** | `latency-sentinel.test.ts` + `latency-baseline.json`; production measurement via `clawcode usage` over 5 consecutive turns gated on deploy |
| SC-7 | Auto-compact threshold fires at operator-configured `auto-compact-at: <pct>` without operator intervention | ✅ **Inherited from Phase 124-04** | Auto-trigger wiring + cooldown gate live in daemon |
| SC-8 | Per-agent verbatim overrides honored (e.g., Finmentum `$` / `AUM` preservation patterns) | ✅ **Code-complete** | `state/active-state.yaml` per-agent override schema; regression fixture confirms patterns survive |

## Architectural seam (silent-path-bifurcation prevention)

Per `feedback_silent_path_bifurcation.md`: BOTH daemon dispatch sites (`daemon.ts:3333` heartbeat trigger + `daemon.ts:10440` manual IPC) now route through `buildTieredExtractor(deps)` from the seam module. Plans 03/04 modified only `compact-extractors/`; daemon.ts dispatch cases untouched after Plan 02 collapse. **Static-grep regression:** `grep 'split("\n")' src/manager/daemon.ts` returns 0 matches (was 2 pre-Plan-02).

## Outstanding operator actions

1. **Deploy clearance** — entire phase landed local-only.
2. **Post-deploy SC-5 live validation:**
   ```bash
   ssh clawdy "journalctl -u clawcode --since '24h ago' -g '125-0[1-4]-' | head -50"
   ```
   Confirm sentinels fire across heartbeat-driven compactions; spot-check `active-state.yaml` content on `fin-acquisition` agent.
3. **Post-deploy SC-6 latency measurement:** `clawcode usage <agent>` over 5 consecutive turns post-compaction on a long-running agent (`fin-acquisition` ideal); first-token < 8 s expected vs pre-compaction baseline ~30-60 s.
4. **Live-handle hot-swap** — inherited from Phase 124-01 follow-up (closed by Plan 124-05 `f753e42`). Path B limitation resolved.

## Deferred / open items

- **Per-agent Tier-2 Haiku prompt overrides** — current prompt is fleet-wide. Per-agent specialization (e.g., Finmentum-specific schema fields like `aum_figures`) deferred; current `state/active-state.yaml` override mechanism handles the verbatim case.
- **JSON-parsing edge cases on Tier-2** — anticipated per CONTEXT Pattern C (Phase 95 dreaming precedent). Tier 2 parser has fallback to deterministic line-extraction if Haiku output rejects JSON parse. Monitor post-deploy for parser fallback rate.

## Net

- 4/4 plans (Tier 1, Tier 2 seam + drop, Tier 2 Haiku, Tier 3 prose + A/B + latency sentinel) code-complete and merged.
- 8/8 SCs closed locally; SC-5 + SC-6 production verification gated on deploy.
- Silent-path-bifurcation seam architecturally enforced; static-grep regression in place.

Phase 125 closes cleanly when SC-5 (production A/B agreement on a fresh operator-prompt pair) and SC-6 (first-token < 8 s measurement) are recorded post-deploy and appended to `125-04-VERIFICATION.md` (or inline in this summary).
