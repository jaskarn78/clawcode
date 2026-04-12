# Phase 40: Cost Optimization & Budgets - Research

**Researched:** 2026-04-10
**Domain:** Token cost tracking, memory importance scoring, budget enforcement
**Confidence:** HIGH

## Summary

Phase 40 adds three capabilities to the existing ClawCode agent fleet: (1) a `clawcode costs` CLI command plus dashboard section showing per-agent/per-model token spend, (2) automatic importance scoring on memory insert, and (3) opt-in escalation budget enforcement with Discord alerts.

The implementation is well-bounded. All three features build on existing infrastructure: `UsageTracker` already stores per-event cost data with model/agent fields, `MemoryStore.insert()` already accepts an importance parameter, and `EscalationMonitor.escalate()` provides the integration point for budget checks. The work is primarily new queries, a new CLI command, schema extension, and wiring.

**Primary recommendation:** Extend the existing `UsageTracker` with per-agent/per-model GROUP BY queries rather than creating a new module. Add importance scoring as a pure function called inside `MemoryStore.insert()`. Budget enforcement is a guard inserted at the top of `EscalationMonitor.escalate()`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- `clawcode costs` CLI command shows table: agent name, model, input/output tokens, total cost (USD estimate), period (today/week/month). Default period: today
- Cost estimated via hardcoded price-per-token map for haiku/sonnet/opus. Updated manually when pricing changes
- Dashboard integration: add costs section to existing dashboard SSE stream
- Heuristic scoring: content length (longer = more important, capped), entity density (proper nouns, numbers, code blocks), and recency boost. Score 0.0-1.0
- Applied on insert -- MemoryStore.insert() calculates importance automatically. Existing memories keep their current scores
- Scoring affects retrieval -- SemanticSearch results weighted by importance score
- No limits by default -- budget enforcement is opt-in per agent via clawcode.yaml
- When configured: soft enforcement -- escalation is blocked (agent stays on haiku), Discord alert sent to agent's channel
- Discord alerts fire at 80% budget usage (warning) and 100% (exceeded/blocked). One alert per threshold per period -- no spam
- Alert format: Discord embed with agent name, model, tokens used/limit, percentage, period. Color-coded (yellow=warning, red=exceeded)
- Budget config schema: `escalationBudget: { daily: { sonnet: number, opus: number }, weekly: { sonnet: number, opus: number } }` -- all fields optional

### Claude's Discretion
- Implementation details of the importance scoring formula (exact weights, caps)
- How to integrate importance into SemanticSearch scoring (additive vs multiplicative)
- Internal structure of budget tracking (reuse AdvisorBudget pattern vs new table)
- Alert deduplication strategy (in-memory set vs SQLite flag)

### Deferred Ideas (OUT OF SCOPE)
- Historical cost trends and charts
- Cost optimization recommendations
- Budget alerting via email/webhook (beyond Discord)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| COST-01 | Per-agent, per-model token usage tracked in SQLite and viewable via CLI and dashboard | UsageTracker already stores per-event data with agent+model fields; needs new GROUP BY queries + CLI command + dashboard endpoint |
| COST-02 | New memories receive automatic importance scoring based on content heuristics | MemoryStore.insert() already accepts importance param (defaults 0.5); add scoring function before insert |
| TIER-04 | Per-agent escalation budgets enforce daily/weekly token limits with Discord alerts | EscalationMonitor.escalate() is the integration point; add budget check + Discord alert via bridge |
</phase_requirements>

## Standard Stack

### Core (already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | 12.8.0 | Budget and cost persistence | Already used for usage_events table |
| zod | 4.3.6 | Config schema for escalationBudget | Already validates clawcode.yaml |
| discord.js | 14.26.2 | Budget alert embeds | Already used by DiscordBridge |
| commander | (existing) | CLI costs command | Already used for all CLI commands |

### No New Dependencies Required

This phase requires zero new npm packages. All functionality is built on existing infrastructure.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── usage/
│   ├── tracker.ts          # EXTEND: add per-agent/per-model aggregate queries
│   ├── pricing.ts          # NEW: hardcoded price-per-token map
│   ├── types.ts            # EXTEND: CostBreakdown type
│   └── budget.ts           # NEW: EscalationBudget (daily/weekly token budget tracking)
├── memory/
│   ├── store.ts            # MODIFY: call importance scorer in insert()
│   ├── importance.ts       # NEW: pure scoring function
│   ├── search.ts           # MODIFY: weight results by importance
│   └── relevance.ts        # REFERENCE: existing scoring pattern to follow
├── cli/commands/
│   └── costs.ts            # NEW: clawcode costs command
├── dashboard/
│   ├── server.ts           # EXTEND: /api/costs endpoint
│   └── sse.ts              # EXTEND: costs polling
├── manager/
│   └── escalation.ts       # MODIFY: budget check before fork
├── discord/
│   └── bridge.ts           # EXTEND: sendBudgetAlert method
└── config/
    └── schema.ts           # EXTEND: escalationBudget in agentSchema
```

### Pattern 1: Per-Agent/Per-Model Cost Aggregation
**What:** New prepared statements on UsageTracker that GROUP BY agent, model with date filtering
**When to use:** For the costs CLI and dashboard endpoint
**Example:**
```typescript
// New query pattern matching existing UsageTracker style
const costsByAgentModel = db.prepare(`
  SELECT agent, model,
    COALESCE(SUM(tokens_in), 0) AS tokens_in,
    COALESCE(SUM(tokens_out), 0) AS tokens_out,
    COALESCE(SUM(cost_usd), 0) AS cost_usd
  FROM usage_events
  WHERE timestamp >= ? AND timestamp < ?
  GROUP BY agent, model
  ORDER BY agent, model
`);
```

### Pattern 2: Pure Importance Scoring Function
**What:** Deterministic scoring without LLM calls
**When to use:** On every memory insert
**Example:**
```typescript
// Pure function, no side effects, fast (<1ms)
export function calculateImportance(content: string): number {
  let score = 0;

  // Length factor: longer content tends to be more substantive (capped)
  const lengthScore = Math.min(content.length / 500, 0.3);
  score += lengthScore;

  // Entity density: proper nouns, numbers, code blocks
  const codeBlocks = (content.match(/```[\s\S]*?```/g) ?? []).length;
  const numbers = (content.match(/\b\d+(\.\d+)?\b/g) ?? []).length;
  const properNouns = (content.match(/\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)*/g) ?? []).length;
  const entityScore = Math.min((codeBlocks * 0.1 + numbers * 0.02 + properNouns * 0.03), 0.4);
  score += entityScore;

  // Recency boost: always applied on insert (fresh memories matter)
  score += 0.2;

  return Math.min(Math.max(score, 0), 1);
}
```

### Pattern 3: Budget Guard in Escalation
**What:** Check budget before forking, send alert if exceeded
**When to use:** At top of `EscalationMonitor.escalate()`
**Example:**
```typescript
async escalate(agentName: string, message: string): Promise<string> {
  // Budget check BEFORE acquiring the lock
  if (this.budget && !this.budget.canEscalate(agentName, this.config.escalationModel)) {
    await this.alertBudgetExceeded(agentName);
    throw new BudgetExceededError(agentName, this.config.escalationModel);
  }

  this.escalating.add(agentName);
  // ... existing fork logic ...
}
```

### Pattern 4: Alert Deduplication
**What:** Track which alerts have fired per agent per period to prevent spam
**When to use:** Before sending Discord budget alerts
**Example:**
```typescript
// In-memory set keyed by "agent:threshold:period_start"
// Resets naturally when period rolls over
private readonly firedAlerts = new Set<string>();

private shouldAlert(agent: string, threshold: "warning" | "exceeded"): boolean {
  const periodKey = `${agent}:${threshold}:${this.currentPeriodStart()}`;
  if (this.firedAlerts.has(periodKey)) return false;
  this.firedAlerts.add(periodKey);
  return true;
}
```

### Anti-Patterns to Avoid
- **LLM-based importance scoring:** Doubles token cost on writes. Use deterministic heuristics only.
- **Blocking on Discord alert delivery:** Budget alert sending must be fire-and-forget (don't block escalation response path).
- **Shared budget state across processes:** Each agent has its own DB. Budget tracking lives in the shared daemon-level usage DB (same as AdvisorBudget pattern).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token pricing | Live API pricing fetch | Hardcoded map (per user decision) | Pricing changes rarely; API adds unnecessary dependency |
| Date period boundaries | Manual date math | date-fns startOfDay/startOfWeek | DST edge cases handled |
| Discord embeds | Raw message formatting | discord.js EmbedBuilder | Color, fields, footer are built-in |

## Common Pitfalls

### Pitfall 1: Cost Estimation Drift
**What goes wrong:** Hardcoded prices become stale after Anthropic pricing updates
**Why it happens:** No automatic sync with current pricing
**How to avoid:** Put pricing map in a single `pricing.ts` file with a comment noting the last-verified date. Easy to update in one place.
**Warning signs:** Dashboard costs diverge from Anthropic billing dashboard

### Pitfall 2: Importance Score Retroactivity
**What goes wrong:** Someone expects existing memories to get rescored
**Why it happens:** Decision says "existing memories keep their current scores"
**How to avoid:** Only score on insert. Don't add a migration that rescores old memories. Document this clearly.
**Warning signs:** Old memories all have 0.5 importance

### Pitfall 3: Budget Period Boundary Race
**What goes wrong:** Agent escalates right as daily budget resets, gets double-counted or missed
**Why it happens:** Period boundary calculation races with usage recording
**How to avoid:** Use consistent period boundaries (UTC midnight for daily, Monday UTC for weekly). Query with >= start AND < end.
**Warning signs:** Budget alerts fire immediately after reset

### Pitfall 4: Alert Spam on Sustained Overage
**What goes wrong:** Alert fires every time budget is checked while over limit
**Why it happens:** No deduplication of alert per threshold per period
**How to avoid:** Track fired alerts with a Set keyed by agent+threshold+period_start. One alert per threshold per period.
**Warning signs:** Discord channel flooded with identical alerts

### Pitfall 5: SemanticSearch Importance Weighting Distorts Ranking
**What goes wrong:** High-importance but semantically irrelevant memories rank above relevant ones
**Why it happens:** Importance weight is too strong relative to semantic similarity
**How to avoid:** Use multiplicative weighting (importance as a boost factor) rather than additive. Keep the weight modest (e.g., `combinedScore * (0.7 + 0.3 * importance)`).
**Warning signs:** Search returns irrelevant highly-scored memories

## Code Examples

### Pricing Map
```typescript
// src/usage/pricing.ts
// Last verified: 2026-04-10 (Anthropic pricing page)

export type ModelPricing = {
  readonly inputPerMToken: number;  // USD per million input tokens
  readonly outputPerMToken: number; // USD per million output tokens
};

export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  haiku: { inputPerMToken: 0.25, outputPerMToken: 1.25 },
  sonnet: { inputPerMToken: 3.0, outputPerMToken: 15.0 },
  opus: { inputPerMToken: 15.0, outputPerMToken: 75.0 },
};

export function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  return (tokensIn * pricing.inputPerMToken + tokensOut * pricing.outputPerMToken) / 1_000_000;
}
```

### CLI Costs Command (following existing pattern)
```typescript
// src/cli/commands/costs.ts
export function registerCostsCommand(program: Command): void {
  program
    .command("costs")
    .description("Show per-agent token costs")
    .option("--period <period>", "today, week, or month", "today")
    .option("--agent <name>", "Filter by agent name")
    .action(async (opts) => {
      const result = await sendIpcRequest(SOCKET_PATH, "costs", {
        period: opts.period,
        agent: opts.agent,
      });
      // Format as table: agent | model | tokens_in | tokens_out | cost
      cliLog(formatCostsTable(result));
    });
}
```

### Budget Config Schema Extension
```typescript
// Addition to src/config/schema.ts agentSchema
const escalationBudgetSchema = z.object({
  daily: z.object({
    sonnet: z.number().int().positive().optional(),
    opus: z.number().int().positive().optional(),
  }).optional(),
  weekly: z.object({
    sonnet: z.number().int().positive().optional(),
    opus: z.number().int().positive().optional(),
  }).optional(),
}).optional();
```

### Discord Budget Alert Embed
```typescript
import { EmbedBuilder } from "discord.js";

function buildBudgetAlertEmbed(data: {
  agent: string;
  model: string;
  tokensUsed: number;
  tokenLimit: number;
  period: string;
  threshold: "warning" | "exceeded";
}): EmbedBuilder {
  const pct = Math.round((data.tokensUsed / data.tokenLimit) * 100);
  return new EmbedBuilder()
    .setTitle(`Budget ${data.threshold === "warning" ? "Warning" : "Exceeded"}`)
    .setColor(data.threshold === "warning" ? 0xFFCC00 : 0xFF0000)
    .addFields(
      { name: "Agent", value: data.agent, inline: true },
      { name: "Model", value: data.model, inline: true },
      { name: "Usage", value: `${data.tokensUsed.toLocaleString()} / ${data.tokenLimit.toLocaleString()} (${pct}%)`, inline: true },
      { name: "Period", value: data.period, inline: true },
    )
    .setTimestamp();
}
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (latest) |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| COST-01 | Per-agent/per-model aggregate queries return correct sums | unit | `npx vitest run src/usage/tracker.test.ts -t "costs"` | Extend existing |
| COST-01 | CLI costs command formats table correctly | unit | `npx vitest run src/cli/commands/costs.test.ts` | Wave 0 |
| COST-01 | Dashboard /api/costs endpoint returns JSON | unit | `npx vitest run src/dashboard/server.test.ts -t "costs"` | Wave 0 |
| COST-02 | Importance scoring produces correct scores for various inputs | unit | `npx vitest run src/memory/importance.test.ts` | Wave 0 |
| COST-02 | MemoryStore.insert() auto-calculates importance when not provided | unit | `npx vitest run src/memory/store.test.ts -t "importance"` | Extend existing |
| COST-02 | SemanticSearch weights results by importance | unit | `npx vitest run src/memory/search.test.ts -t "importance"` | Extend existing |
| TIER-04 | Budget check blocks escalation when over limit | unit | `npx vitest run src/usage/budget.test.ts` | Wave 0 |
| TIER-04 | Alert fires at 80% and 100% thresholds, once per period | unit | `npx vitest run src/usage/budget.test.ts -t "alert"` | Wave 0 |
| TIER-04 | Config schema validates escalationBudget correctly | unit | `npx vitest run src/config/schema.test.ts -t "budget"` | Extend existing |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before verification

### Wave 0 Gaps
- [ ] `src/usage/budget.test.ts` -- covers TIER-04 budget enforcement
- [ ] `src/memory/importance.test.ts` -- covers COST-02 scoring heuristics
- [ ] `src/cli/commands/costs.test.ts` -- covers COST-01 CLI formatting

## Sources

### Primary (HIGH confidence)
- Existing codebase: `src/usage/tracker.ts`, `src/usage/advisor-budget.ts`, `src/memory/store.ts`, `src/memory/search.ts`, `src/memory/relevance.ts`, `src/manager/escalation.ts`, `src/config/schema.ts`
- Project CLAUDE.md technology stack documentation

### Secondary (MEDIUM confidence)
- discord.js EmbedBuilder API (standard usage from discord.js 14.x docs)
- date-fns period boundary utilities (startOfDay, startOfWeek)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all dependencies already installed, zero new packages needed
- Architecture: HIGH - clear integration points in existing code, established patterns to follow
- Pitfalls: HIGH - based on direct code analysis of existing patterns and common time-boundary issues

**Research date:** 2026-04-10
**Valid until:** 2026-05-10 (stable -- internal project, no external API changes expected)
