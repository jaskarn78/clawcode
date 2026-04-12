---
phase: 40-cost-optimization-budgets
verified: 2026-04-10T23:45:00Z
status: passed
score: 7/7 must-haves verified
re_verification:
  previous_status: gaps_found
  previous_score: 5/7
  gaps_closed:
    - "registerCostsCommand imported at line 34 and called at line 146 in src/cli/index.ts"
    - "case 'costs' handler added at line 1160 in src/manager/daemon.ts — iterates running agents via manager.getRunningAgents(), calls tracker.getCostsByAgentModel() with computed since/now dates, returns { period, costs: results }"
  gaps_remaining: []
  regressions: []
---

# Phase 40: Cost Optimization & Budgets Verification Report

**Phase Goal:** Token spend is tracked, scored, and budget-enforced across the agent fleet
**Verified:** 2026-04-10T23:45:00Z
**Status:** passed
**Re-verification:** Yes — after gap closure

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | `clawcode costs` shows per-agent/per-model token usage with USD cost estimates | VERIFIED | `registerCostsCommand` imported at cli/index.ts:34, registered at line 146 |
| 2 | Dashboard `/api/costs` endpoint returns per-agent cost JSON | VERIFIED | daemon.ts `case "costs"` at line 1160 — aggregates across all running agents, returns `{ period, costs }` |
| 3 | New memories inserted via `MemoryStore.insert()` receive automatic importance scores (0.0-1.0) | VERIFIED | `calculateImportance` imported and called in store.ts line 138 |
| 4 | SemanticSearch results are weighted by importance score | VERIFIED | Multiplicative boost `combinedScore * (0.7 + 0.3 * importance)` applied in search.ts lines 90-93 |
| 5 | Escalation is blocked when agent exceeds configured daily/weekly token budget | VERIFIED | `canEscalate` check + `BudgetExceededError` throw in escalation.ts lines 111-120 |
| 6 | Discord alert fires at 80% usage (warning) and 100% usage (exceeded) | VERIFIED | `sendBudgetAlert` in bridge.ts with EmbedBuilder, color 0xFFCC00/0xFF0000 |
| 7 | Alerts fire once per threshold per period — no spam | VERIFIED | `firedAlerts: Set<string>` with composite key in budget.ts, `shouldAlert` guards both call sites |

**Score:** 7/7 truths verified

### Required Artifacts

**Plan 01 Artifacts:**

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/usage/pricing.ts` | Hardcoded price map for haiku/sonnet/opus | VERIFIED | Exports `MODEL_PRICING` (frozen record) and `estimateCost(model, in, out)`, 39 lines |
| `src/cli/commands/costs.ts` | CLI costs command with --period and --agent | VERIFIED | File exists, substantive (89 lines). Imported and registered in `src/cli/index.ts` lines 34 and 146 |
| `src/memory/importance.ts` | Pure importance scoring function | VERIFIED | `calculateImportance` exported, deterministic formula, returns clamped 0-1 |
| `src/usage/types.ts` | CostByAgentModel type | VERIFIED | Type defined at line 41 with all required readonly fields |
| `src/usage/tracker.ts` | getCostsByAgentModel method | VERIFIED | Method at line 121, prepared statement with `GROUP BY agent, model`, frozen return |
| `src/dashboard/server.ts` | /api/costs endpoint | VERIFIED | Route handler exists (line 181), sends IPC "costs" request — daemon now has case handler at line 1160 |
| `src/memory/store.ts` | importance auto-calc on insert | VERIFIED | `calculateImportance` imported (line 8), called in insert() when importance is null or 0.5 (lines 137-138) |
| `src/memory/search.ts` | importance weighting in search | VERIFIED | Multiplicative boost applied after scoreAndRank, before topK slice (lines 88-96) |

**Plan 02 Artifacts:**

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/usage/budget.ts` | EscalationBudget class with canEscalate/recordUsage/checkAlerts | VERIFIED | 199 lines, all methods implemented, SQLite-backed with prepared statements |
| `src/usage/budget.test.ts` | Tests for budget enforcement and alerts | VERIFIED | 20 tests covering all behaviors |
| `src/config/schema.ts` | escalationBudget schema on agentSchema | VERIFIED | Optional zod object with daily/weekly sonnet/opus number fields at line 162 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/cli/index.ts` | `src/cli/commands/costs.ts` | `registerCostsCommand(program)` | WIRED | Import at line 34, call at line 146 — confirmed fixed |
| `src/cli/commands/costs.ts` | `src/manager/daemon.ts` | IPC request "costs" action | WIRED | daemon.ts `case "costs"` at line 1160 handles the request — confirmed fixed |
| `src/manager/daemon.ts` | `src/usage/tracker.ts` | `tracker.getCostsByAgentModel(since, now)` | WIRED | Handler calls `manager.getRunningAgents()` then `getUsageTracker(agentName)` and aggregates results |
| `src/memory/store.ts` | `src/memory/importance.ts` | `calculateImportance` called in insert() | WIRED | Import at line 8, used at line 137-138 |
| `src/memory/search.ts` | `importance` field | importance weighting in score calculation | WIRED | `result.importance` used in multiplicative boost at line 90 |
| `src/manager/escalation.ts` | `src/usage/budget.ts` | `canEscalate` check before fork | WIRED | Import at line 2-3, check at line 113, throw at line 118 |
| `src/usage/budget.ts` | `src/discord/bridge.ts` | `sendBudgetAlert` for threshold notifications | WIRED | `alertCallback` pattern — EscalationMonitor invokes alertCallback, caller wires to sendBudgetAlert |
| `src/config/schema.ts` | `escalationBudget` | zod schema validates agent config | WIRED | `escalationBudget` field added to agentSchema at line 162 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/dashboard/server.ts /api/costs` | IPC response from "costs" action | `src/manager/daemon.ts` case "costs" | Yes — aggregates live tracker data from running agents with real time-range filtering | FLOWING |
| `src/memory/store.ts insert()` | `importance` score | `calculateImportance(input.content)` | Yes — deterministic heuristic on real content | FLOWING |
| `src/memory/search.ts search()` | `result.importance` | DB column from memories table | Yes — importance stored on insert, retrieved in SELECT | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| importance scoring returns 0-1 | vitest run importance.test.ts | 67 tests pass | PASS |
| budget enforcement blocks escalation | vitest run budget.test.ts | 20 tests pass, all edge cases covered | PASS |
| escalation.test.ts with budget wiring | vitest run escalation.test.ts | 55 tests pass | PASS |
| costs CLI registration | grep registerCostsCommand src/cli/index.ts | line 34 (import) + line 146 (call) | PASS |
| daemon costs IPC handler | grep "case.*costs" src/manager/daemon.ts | line 1160 | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| COST-01 | 40-01 | Per-agent, per-model token usage tracked in SQLite, viewable via CLI and dashboard | SATISFIED | Full pipeline wired: tracker.getCostsByAgentModel() → daemon "costs" handler → CLI registerCostsCommand registered → dashboard /api/costs endpoint connected |
| COST-02 | 40-01 | New memories receive automatic importance scoring based on content heuristics | SATISFIED | calculateImportance wired in MemoryStore.insert(), importance-weighted search in SemanticSearch.search() |
| TIER-04 | 40-02 | Per-agent escalation budgets enforce daily/weekly token limits for upgraded models with Discord alerts | SATISFIED | EscalationBudget class wired into EscalationMonitor, Discord sendBudgetAlert with color-coded embeds, alert deduplication confirmed by tests |

### Anti-Patterns Found

None — both previously-identified blockers resolved. No new anti-patterns detected in the fix locations.

### Human Verification Required

None — all behavioral checks are either automated or confirmed by code analysis.

### Gaps Summary

Both gaps from initial verification are closed. The "costs" IPC pipeline is now fully connected end-to-end:

`clawcode costs` (CLI) → `registerCostsCommand` registered in cli/index.ts → IPC "costs" request → daemon `case "costs"` handler → `manager.getRunningAgents()` iteration → `tracker.getCostsByAgentModel(since, now)` → aggregated results returned.

Dashboard `/api/costs` endpoint follows the same IPC path and now receives real data from the daemon handler.

All 7 observable truths are verified. Phase goal is achieved.

---

_Verified: 2026-04-10T23:45:00Z_
_Verifier: Claude (gsd-verifier)_
