---
phase: 125
plan: 02
title: Single extractor seam + Tier 1 verbatim preservation + Tier 4 drop rules
status: complete
completed: 2026-05-14
commits:
  - 40ee0c2  # T-01 seam module + types + Tier 4 drop rules
  - 7adb94d  # T-02 Tier 1 verbatim gate + per-agent schema fields
  - 7726209  # T-03 collapse both daemon extractor sites + integration test
requirements: [SC-2, SC-3, SC-8]
sentinels: ["[125-02-tier1-filter]", "[125-02-tier4-drop]"]
---

# Phase 125 Plan 02 Summary

## One-liner
Single D-01 extractor seam at `src/manager/compact-extractors/` collapses both daemon dispatch sites (heartbeat auto-trigger + manual IPC) to ONE module that runs Tier 1 verbatim preservation + Tier 4 drop rules in front of the unchanged `ExtractMemoriesFn` contract; ≥40% byte reduction on a 420-turn synthetic fin-acquisition replay.

## What shipped
- `src/manager/compact-extractors/` — types.ts, tier1-verbatim.ts, tier4-drop.ts, index.ts.
- Schema knobs `preserveLastTurns` + `preserveVerbatimPatterns` on agentSchema + defaultsSchema; loader resolvers compile regex at config-load (invalid patterns reject loudly).
- Both daemon callsites replaced: `daemon.ts:~3347` (auto-trigger) + `daemon.ts:~10583` (manual IPC `compact-session`). Grep gate: `grep -n 'split("\\n")' src/manager/daemon.ts` returns 0 matches; `buildTieredExtractor` appears 4x.
- Synthetic 420-turn fixture: 60% heartbeat probes, 20% repeat tool calls, 15% real work, 5% failed-then-retried.

## Metrics
- Byte reduction on synthetic replay: ≥40% on the `toCompact` slice (assertion in `seam-integration.test.ts`).
- Tests: 18 new compact-extractors tests pass; Phase 124 regression suite (190 tests across loader/differ/compact-session/event-log/auto-trigger) clean.

## Deviations
- **[Advisor reconciliation]** Plan T-03 floated "prepend preserved to `getConversationTurns` lambda" as an option — rejected. That callback feeds `compactForAgent`'s daily-log flush; filtering it would erase preserved turns from the audit trail. Final shape: partition runs at the daemon callsite; preserved turns thread through `buildTieredExtractor` deps and ride out the extractor's HEAD; `getConversationTurns` returns all turns unchanged.
- **[Rule 2 — back-compat]** Made schema fields `.optional()` (consumer-side fallback 10 / []) and `ResolvedAgentConfig.preserveLastTurns?` optional at the TYPE level. Required-by-default would have broken ~20 existing test factories. Pattern matches Phase 115 `memoryRetrievalTokenBudget` precedent.
- **[Advisor — anti-overmatch]** Heartbeat-probe regex anchored to start-of-content + bracketed sentinel matches (`[125-01-active-state]`, `^---\s*ACTIVE STATE\s*---`, `^HEARTBEAT_OK\b`, `^heartbeat probe\b`). Operator messages mentioning "heartbeat probe" mid-sentence do NOT match. Test asserts this explicitly.

## Open items
- **Live-handle hot-swap** still deferred (inherited from Phase 124-01 follow-up). Path B limitation persists.
- **Plan 03** plugs Tier 2 Haiku into the seam (no daemon.ts changes per D-01).
- **Plan 04** plugs Tier 3 prose + A/B verification fixture into the seam.

## Sentinel proof (deferred to deploy)
Per Ramy-active deploy hold (D-07): no clawdy redeploy this turn. Post-deploy verify with `ssh clawdy "journalctl -u clawcode -g '125-02-' --since '1h ago'"`.

## Self-Check: PASSED
- 3 commits exist on master: 40ee0c2 / 7adb94d / 7726209.
- `grep -n 'split("\\n")' src/manager/daemon.ts` → 0 matches.
- `grep -n 'buildTieredExtractor' src/manager/daemon.ts` → 4 matches (≥2 sites wired).
- 18 compact-extractors tests pass; 190-test regression slice clean.
