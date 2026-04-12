---
phase: 40-cost-optimization-budgets
plan: 01
subsystem: usage-tracking, memory
tags: [cost-tracking, importance-scoring, cli, dashboard]
dependency_graph:
  requires: []
  provides: [pricing-map, cost-aggregation, importance-scoring, costs-cli, costs-api]
  affects: [memory-search, memory-store, dashboard]
tech_stack:
  added: []
  patterns: [multiplicative-boost-scoring, deterministic-heuristic-scoring]
key_files:
  created:
    - src/usage/pricing.ts
    - src/memory/importance.ts
    - src/memory/importance.test.ts
    - src/cli/commands/costs.ts
    - src/cli/commands/costs.test.ts
  modified:
    - src/usage/types.ts
    - src/usage/tracker.ts
    - src/dashboard/server.ts
    - src/memory/store.ts
    - src/memory/search.ts
    - src/memory/__tests__/store.test.ts
decisions:
  - Importance auto-calculation replaces default 0.5 when not explicitly provided
  - Multiplicative boost (0.7 + 0.3 * importance) preserves semantic ordering while rewarding important memories
metrics:
  duration: 4min
  completed: "2026-04-10T22:59:46Z"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 11
---

# Phase 40 Plan 01: Cost Tracking and Importance Scoring Summary

Per-agent/per-model cost tracking with CLI and dashboard visibility, plus automatic importance scoring on memory insert with importance-weighted search results.

## What Was Built

1. **Pricing map** (`src/usage/pricing.ts`): MODEL_PRICING constant with haiku/sonnet/opus per-million-token rates. `estimateCost(model, tokensIn, tokensOut)` function for cost calculation.

2. **Cost aggregation** (`src/usage/tracker.ts`): `getCostsByAgentModel(startTime, endTime)` method with GROUP BY agent, model SQL query returning summed tokens and cost.

3. **Importance scorer** (`src/memory/importance.ts`): Deterministic `calculateImportance(content)` function using length, code blocks, numbers, proper nouns, and recency boost. Always returns 0.0-1.0.

4. **CLI costs command** (`src/cli/commands/costs.ts`): `clawcode costs` with `--period` (today/week/month) and `--agent` filter. Aligned table output with totals.

5. **Dashboard endpoint** (`src/dashboard/server.ts`): GET `/api/costs?period=today` returns JSON array of CostByAgentModel.

6. **Importance wiring** (`src/memory/store.ts`): `insert()` auto-calculates importance via heuristic when not explicitly set.

7. **Search weighting** (`src/memory/search.ts`): Multiplicative boost `combinedScore * (0.7 + 0.3 * importance)` applied after scoreAndRank, before topK slice.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated existing store test**
- **Found during:** Task 2
- **Issue:** `src/memory/__tests__/store.test.ts` expected default importance of 0.5 but auto-calculation now produces a different value
- **Fix:** Updated test to assert auto-calculated importance is >0 and <0.5 for short content
- **Files modified:** src/memory/__tests__/store.test.ts
- **Commit:** 5da780e

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | 052a991 | feat(40-01): add pricing map, cost aggregation, and importance scorer |
| 2 | 5da780e | feat(40-01): wire dashboard costs endpoint, importance scoring, and search weighting |

## Known Stubs

None - all functionality is fully wired with real data sources.

## Self-Check: PASSED
