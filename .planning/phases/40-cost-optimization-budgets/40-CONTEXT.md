# Phase 40: Cost Optimization & Budgets - Context

**Gathered:** 2026-04-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Token spend is tracked, scored, and budget-enforced across the agent fleet. This phase adds per-agent/per-model cost tracking viewable via CLI and dashboard, automatic importance scoring for new memories, and opt-in escalation budgets with Discord alerts.

</domain>

<decisions>
## Implementation Decisions

### Cost Tracking & Visibility (COST-01)
- `clawcode costs` CLI command shows table: agent name, model, input/output tokens, total cost (USD estimate), period (today/week/month). Default period: today
- Cost estimated via hardcoded price-per-token map for haiku/sonnet/opus. Updated manually when pricing changes. Good enough for cost awareness
- Dashboard integration: add costs section to existing dashboard SSE stream — show per-agent token counts in the web UI

### Memory Importance Scoring (COST-02)
- Heuristic scoring: content length (longer = more important, capped), entity density (proper nouns, numbers, code blocks), and recency boost. Score 0.0-1.0
- Applied on insert — `MemoryStore.insert()` calculates importance automatically. Existing memories keep their current scores
- Scoring affects retrieval — SemanticSearch results weighted by importance score. Higher importance = boosted ranking

### Escalation Budgets & Alerts (TIER-04)
- No limits by default — budget enforcement is opt-in per agent via clawcode.yaml configuration
- When configured: soft enforcement — escalation is blocked (agent stays on haiku), Discord alert sent to agent's channel. Agent continues working on haiku
- Discord alerts fire at 80% budget usage (warning) and 100% (exceeded/blocked). One alert per threshold per period — no spam
- Alert format: Discord embed with agent name, model, tokens used/limit, percentage, period. Color-coded (yellow=warning, red=exceeded)
- Budget config schema: `escalationBudget: { daily: { sonnet: number, opus: number }, weekly: { sonnet: number, opus: number } }` — all fields optional, no enforcement when absent

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/usage/tracker.ts` — `UsageTracker` records per-session token/cost data; extend for per-model aggregation
- `src/usage/advisor-budget.ts` — `AdvisorBudget` with SQLite daily tracking pattern; reuse for escalation budgets
- `src/memory/store.ts` — `MemoryStore.insert()` with importance field; enhance with auto-scoring
- `src/memory/search.ts` — `SemanticSearch` with KNN; add importance weighting
- `src/dashboard/server.ts` — SSE + REST dashboard; add costs endpoint
- `src/dashboard/static/app.js` — dashboard UI; add costs section
- `src/discord/bridge.ts` — `DiscordBridge` with message sending; use for budget alerts
- `src/cli/commands/` — one file per CLI command; add `costs.ts`
- `src/manager/escalation.ts` — `EscalationMonitor` from Phase 39; integrate budget check before escalation

### Established Patterns
- CLI commands: `register<Command>Command(program)` pattern, IPC to daemon
- Dashboard: Node.js `http` server, SSE for live updates, REST for data
- SQLite for all persistence, prepared statements, WAL mode

### Integration Points
- `src/usage/tracker.ts` — add per-model aggregation queries
- `src/memory/store.ts` — add importance scoring on insert
- `src/memory/search.ts` — add importance weighting to results
- `src/cli/commands/costs.ts` — new CLI command
- `src/dashboard/server.ts` — add `/api/costs` endpoint
- `src/manager/escalation.ts` — add budget check before fork
- `src/discord/bridge.ts` — add budget alert sending

</code_context>

<specifics>
## Specific Ideas

- Budget enforcement integrates into the existing `EscalationMonitor.escalate()` method — check budget before forking
- The `clawcode costs` command should support `--period today|week|month` flag
- Importance scoring should be deterministic and fast (no LLM calls)
- The dashboard costs section can reuse the existing SSE pattern for live updates

</specifics>

<deferred>
## Deferred Ideas

- Historical cost trends and charts — v1.5 tracks current data, visualization deferred
- Cost optimization recommendations — "agent X is escalating too frequently" — deferred
- Budget alerting via email/webhook (beyond Discord) — deferred

</deferred>
