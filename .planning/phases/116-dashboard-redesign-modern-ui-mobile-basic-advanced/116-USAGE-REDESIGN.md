# 116-USAGE-REDESIGN — Costs page → Usage page

**Date:** 2026-05-11
**Scope:** Post-deploy reframe of `/dashboard/v2/costs` into `/dashboard/v2/usage`.
**Status:** Code-only. NOT deployed. Ramy-active hold continues.

## Operator complaint (root cause)

> "I feel like there is too much emphasis on 'spending' when im using my oauth which is set at 200."

The page surfaced today / 7d / 30d USD totals + a "month-end projection $145,132 ↑" headline. Those numbers come from `UsageTracker.getCostsByAgentModel()` and represent **theoretical API-equivalent cost** — what the volume of tokens would cost at the public API list price. The operator is on **Claude Max ($200/mo flat OAuth subscription)** and is not billed those amounts. Leading with them was treating a vanity metric as the primary constraint.

The real operator constraint on Claude Max is subscription rate limits, captured by Phase 103's `RateLimitTracker`:
- **5-hour session window** — most frequent reset, the binding constraint during active work
- **7-day weekly cap** — multi-session planning horizon
- **Per-model carve-outs** — Opus weekly + Sonnet weekly, since the SDK enforces these independently
- **Overage state** — allowed / disabled / exceeded
- **Surpassed-threshold warnings** — 0.5, 0.8 crossings

All of this was already being captured per-agent via `rate_limit_event` SDK messages (Phase 103 OBS-04 → OBS-06) and persisted in each agent's `RateLimitTracker`. The `list-rate-limit-snapshots` IPC handler at `daemon.ts:7779` was exposing it for `/clawcode-usage` Discord embeds. The dashboard didn't have a route to consume it. That was the gap.

## What shipped

### 1. Backend — new `/api/usage` routes (commit `01d633f`)

**New daemon IPC method:** `list-rate-limit-snapshots-fleet`
- Mirrors the `costs` aggregation pattern at `daemon.ts:9547`: iterates `manager.getRunningAgents()`, asks each for its `RateLimitTracker.getAllSnapshots()`, rolls up into a single payload.
- Returns `{agents: [{agent, snapshots: RateLimitSnapshot[]}]}`.
- Reuses the existing single-agent `handleListRateLimitSnapshotsIpc` so snapshot shape, immutability, and Pitfall 7 graceful-empty behaviour stay identical.
- The existing single-agent `list-rate-limit-snapshots` method is untouched (still used by `/clawcode-usage` Discord embed).

**New dashboard server routes** (`src/dashboard/server.ts`, Phase 116-postdeploy fence):
- `GET /api/usage` → proxies `list-rate-limit-snapshots-fleet`
- `GET /api/usage/:agent` → proxies single-agent `list-rate-limit-snapshots`

**New TanStack Query hooks** (`src/dashboard/client/src/hooks/useApi.ts`):
- `useFleetUsage()` — 30s refetch, 20s staleTime (matching the cost-side hook cadence)
- `useAgentUsage(name)` — same cadence, gated by `enabled: agent !== null`

**Type:** `RateLimitSnapshot.rateLimitType` is `string` (not the SDK union) per Phase 103 Pitfall 10 — a future SDK release may add new rate-limit types and the dashboard must keep rendering them under a fallback label rather than dropping them.

### 2. Frontend — Usage page redesign (commit `c7786b5`)

`src/dashboard/client/src/components/CostDashboard.tsx` rewritten in place. The file path is unchanged so the existing `React.lazy` import in `App.tsx` continues to resolve without route plumbing churn. The component is renamed to `UsageDashboard` and re-exported under the old `CostDashboard` name as a backwards-compat alias.

New visual hierarchy (top → bottom):

| Section | Component | Source |
|---|---|---|
| 1 | `MaxBanner` — dismissible explainer banner | localStorage: `clawcode.usage.banner.dismissed.v1` |
| 2 | `SubscriptionUtilization` — 5h/7d bars + Opus/Sonnet carve-outs + overage footer | `/api/usage` |
| 3 | Token volume cards (today / 7d / 30d) + `TokenTrendChart` | `/api/costs` rows, re-keyed as `tokens_in + tokens_out` |
| 4 | `TheoreticalCostSection` (collapsible, default closed) | `/api/costs` USD path |
| 5 | `BudgetGauges` (unchanged) | `/api/budgets` |

**Aggregation rule for the bars:** when multiple agents report the same `rateLimitType`, pick the most-constrained snapshot. `rejected` always wins over `allowed/allowed_warning` regardless of utilisation; otherwise the highest `utilization` wins. The `bindingAgent` field is surfaced under the bar so the operator can see who's driving the constraint.

**Empty-state copy:** distinguished from a fetch error. `usageQ.isLoading && !hasAny` shows "Loading…"; daemon-reachable-but-no-snapshots shows "Subscription utilisation data will appear after the first turn. Captured per-agent from SDK rate_limit_event messages." A 503 from `/api/usage` flows through TanStack's `isError` path (unchanged generic error UI).

**Reframed anomaly banner:** the existing `AnomalyBanner` is now nested inside the demoted theoretical-cost section. Copy changed from "Spend anomaly: today is X× the 30-day daily average" (anxiety-inducing) to "High token-volume day: today's theoretical spend is X× the 30-day daily average" (factual, neutral, and clear that it's theoretical).

**Bundle delta:**
- Eager `index-*.js`: 815.78 KB raw / 243.36 KB gzip → 815.81 KB raw / 243.37 KB gzip (+30 B / +10 B)
- Lazy `CostDashboard-*.js`: 50.41 KB raw / 13.76 KB gzip (was ~50 KB / ~13.7 KB pre-rewrite; effectively unchanged)
- Well inside the 1 MB raw / 320 KB gzip ceiling. New surfaces are pure Tailwind divs; the recharts dependency continues to dominate the lazy chunk.

### 3. Nav rename + path alias (commit `ed729b0`)

`src/dashboard/client/src/App.tsx`:
- Nav button label `Costs` → `Usage`
- View enum `'costs'` → `'usage'`
- Canonical path `/dashboard/v2/usage`
- Legacy alias: `'/dashboard/v2/costs'` still maps to `'usage'` view via `PATH_TO_VIEW` so historical bookmarks resolve to the new page without needing a server-side 301. Forward navigation always writes `/usage`.
- Lazy import target switches from `m.CostDashboard` to `m.UsageDashboard`. The old export name is kept in the module as `export const CostDashboard = UsageDashboard` so any out-of-tree consumer doesn't break.
- Suspense fallback copy retargeted: "Loading usage dashboard…"

## What did NOT change

- `/api/costs` and `/api/costs/daily` routes are untouched. The cost data still feeds the demoted theoretical-cost section + the token-volume cards (re-keyed on the same rows). The complaint was framing, not the data.
- `RateLimitTracker`, `daemon-rate-limit-ipc.ts`, and the existing single-agent `list-rate-limit-snapshots` IPC are untouched — they remain the source of truth for `/clawcode-usage` Discord parity.
- The `EscalationBudget` gauges (token-unit, operator-configured caps) remain a top-level section. These ARE real operator constraints, not theoretical.

## Verification (local, no deploy)

| Check | Result |
|---|---|
| `npm run build` (daemon + SPA) | clean |
| SPA `tsc --noEmit` | only pre-existing `baseUrl` deprecation warning (unrelated) |
| Bundle budget (1 MB raw / 320 KB gzip) | within (815 KB raw / 243 KB gzip on eager bundle) |
| `/api/costs` unchanged | verified by grep — route + IPC handler intact |
| Legacy `/dashboard/v2/costs` alias resolves | verified by `PATH_TO_VIEW` table inspection |

Operator-side post-deploy verification:
- `curl http://100.98.211.108:3100/api/usage` should return `{agents: [...]}` or `{agents: []}` (graceful empty)
- `curl http://100.98.211.108:3100/api/costs?period=today` should return the same shape as before

## Commits

1. `01d633f` — `feat(116-postdeploy): expose subscription utilisation via /api/usage`
2. `c7786b5` — `fix(116-postdeploy): reframe Costs page as Usage (subscription-first)`
3. `ed729b0` — `feat(116-postdeploy): rename Costs nav route to Usage (with alias)`
4. (this commit) — `docs(116-postdeploy): document Usage-page reframe rationale + diff`

## Deferred / follow-ups

- Fleet tile grid + comparison table subagent cardinality (still open from prior 116-postdeploy pass — unrelated to this redesign).
- Per-agent drill-down on Usage page (`/dashboard/v2/usage/:agent`) — the `useAgentUsage()` hook is wired but no route yet exists. Promotion criteria: operator demand OR a constrained-binding-agent investigation pattern emerges where the fleet aggregate hides the relevant story.
- SSE bridge for `/api/usage` — currently relies on 30s polling. If utilisation visibility lag becomes operator pain, fan the `rate_limit_event` through the existing SSE bus.
