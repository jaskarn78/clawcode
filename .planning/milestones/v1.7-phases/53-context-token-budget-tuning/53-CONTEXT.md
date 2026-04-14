# Phase 53: Context & Token Budget Tuning - Context

**Gathered:** 2026-04-14
**Status:** Ready for planning
**Mode:** Smart discuss — all 4 grey areas accepted as recommended

<domain>
## Phase Boundary

Shrink per-turn payload without measurable response-quality regression. Build a reproducible context-audit that measures p50/p95 payload sizes by section (identity, soul, skills, hot-tier, recent-history, per-turn-summary, resume-summary), tighten default memory-assembly budgets based on the audit, make skills and MCP tool definitions lazy-loadable/compressible when they haven't been used recently, and enforce a strict upper bound on the session-resume summary payload.

Scope lines:
- IN: New `clawcode context-audit` CLI, `@anthropic-ai/tokenizer`-based token counting (or the claude-agent-sdk's bundled tokenizer), per-section budget Zod surface on agent config, assembler-side truncation strategies per section, lazy-skill compression with usage tracking + re-inflate on mention, `bench --context-audit` regression validation mode, resume-summary hard cap with regeneration loop.
- OUT: Model-side context-window optimizations (that's on Anthropic), cross-agent memory sharing (rejected), rewriting the hot-tier/tier-manager fundamentals (Phase 37-38 substrate is adequate), changing the ContextAssembler's two-block contract from Phase 52 (stablePrefix / mutableSuffix).

</domain>

<decisions>
## Implementation Decisions

### Context Audit Script
- **Form:** New `clawcode context-audit <agent>` CLI subcommand. Mirrors the `clawcode bench` shape. Samples recent turns from `traces.db` for the target agent, reconstructs each section the assembler produced (re-running assembly against the saved state where needed), and measures token counts.
- **Token counter:** `src/performance/token-count.ts` helper wrapping `@anthropic-ai/tokenizer` (the tokenizer Anthropic ships with their SDK family). Verify the package is available; if not, use the sdk's internal tokenizer or install `@anthropic-ai/tokenizer`. Measures each section: `identity`, `soul`, `skills_header`, `hot_tier`, `recent_history`, `per_turn_summary`, `resume_summary`.
- **Output:** JSON report at `.planning/audits/context-<timestamp>.json` + pretty console table (rows: sections × cols: p50 / p95 / count). `--json` flag toggles to machine-readable mode. Report carries the run's `git_sha`, `agent`, `sampled_turns`, and a `recommendations` array flagging sections whose p95 exceeds a configurable ceiling.
- **Sampling:** `--since 24h` default; `--turns <N>` explicit count; minimum 20 turns or emit a WARN and allow operator to proceed.

### Budget Tightening + Regression Validation
- **Budget config:** Extend agent `perf` Zod with `memoryAssemblyBudgets?: { identity?, soul?, skillsHeader?, hotTier?, recentHistory?, perTurnSummary? }` all numbers in tokens. Merge default + per-agent override using the same pattern as `perf.slos?` from Phase 51.
- **Default values:** Populated empirically after the first audit run. Phase 53 plan ships conservative starter defaults; operator tunes per agent after viewing audit output.
- **Tightening mechanism:** `ContextAssembler` reads budgets from resolved agent config. Per section, truncate when over budget using section-specific strategies:
  - `hot_tier` → drop lowest-importance rows until within budget
  - `recent_history` → drop oldest messages (keep most recent)
  - `per_turn_summary` → regenerate under stricter "one-paragraph" prompt
  - `identity` / `soul` → warn-and-keep (never truncate user-authored persona text — log WARN instead)
  - `skills_header` → delegate to lazy-skill compression (Grey Area 3)
  All truncations are logged via pino with `{ agent, turnId, section, before_tokens, after_tokens }`.
- **Regression validation:** Reuse the Phase 51 `clawcode bench` infra. Add flag `clawcode bench --context-audit` that runs the prompt set before + after the budget change, diffs response length per prompt. Response-length drop > 15% on any prompt fails the gate (quality proxy — ok for this phase; later milestones can add content-level quality judges).
- **Picking defaults:** The audit report output includes a `recommendations.new_defaults` object = `{ section: max(p95_tokens) * 1.2 }` per section. Operator reviews, edits `clawcode.yaml`, runs bench --context-audit to validate. No auto-apply.

### Lazy / Compressed Skills & MCP Tool Definitions
- **Usage tracking:** Extend the existing `UsageTracker` (or add a sibling `SkillUsageTracker` in `src/usage/skill-usage-tracker.ts`) to record which skill/tool names appear in turn responses (grep on known catalog names in model output + SDK tool-use events). Ring buffer: last N turns (N = `usageThresholdTurns`, default 20).
- **Compression rule:** At assembly time, `ContextAssembler` inspects the usage window. Skills/MCP tool definitions NOT used in last N turns render as a compressed one-line catalog entry (`- <name>: <description>`) instead of full content. Used skills keep full SKILL.md inclusion.
- **Re-inflate on mention:** If the current user message OR the last assistant message mentions a compressed skill name (word boundary match), the assembler upgrades that skill to full-content for THIS turn. Next turn with no mention and still outside the usage window, it re-compresses. Keeps cache hot for frequently-used skills.
- **Config surface:** Per-agent `perf.lazySkills: { enabled: boolean, usageThresholdTurns: number, reinflateOnMention: boolean }`. Defaults: `{ enabled: true, usageThresholdTurns: 20, reinflateOnMention: true }`. Zod validation enforces `usageThresholdTurns >= 5`.
- **Telemetry:** New span metadata on the existing `context_assemble` span: `metadata_json.skills_included_count` + `metadata_json.skills_compressed_count`. `context-audit` report surfaces total token savings from compression across the sample.

### Session-Resume Summary Budget
- **Hard cap:** 1500 tokens default. Configurable per agent via `perf.resumeSummaryBudget?: number` (hard floor 500 — reject smaller values at Zod validation).
- **Enforcement:** `src/memory/context-summary.ts` — after summary generation, call `countTokens(summary)`. If over budget, regenerate with a stricter "max 1000 tokens, one paragraph" prompt. Retry up to 2 times. If still over after 2 retries, hard-truncate to budget with an ellipsis marker and log a WARN.
- **Audit integration:** `context-audit` script samples recent resume-summary records (from session logs / memory store where available) and reports p50/p95 tokens + count of over-budget summaries. Agents exceeding budget are flagged in the recommendations section.

### Claude's Discretion
- Exact placement of `token-count.ts` — under `src/performance/` or a new `src/tokens/` module. Lean toward `src/performance/` (already houses SLOs, percentiles, cache telemetry).
- Whether `SkillUsageTracker` is a new class or merged into `UsageTracker`. Prefer a new class for cohesion.
- Exact SQL schema for persisting skill usage if needed (can also live in-memory for a session + reconstruct from recent turns).
- Report output column alignment / formatting details.
- Whether the audit CLI invokes the daemon IPC or reads `traces.db` directly via filesystem. Filesystem is simpler and deterministic; pick that.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src/performance/percentiles.ts`** — `parseSinceDuration`, percentile math. Reuse for audit sampling window + per-section percentiles.
- **`src/performance/trace-store.ts`** — schema already has span metadata JSON. Extend `context_assemble` span to include the per-section token counts per turn so the audit can aggregate from trace data.
- **`src/manager/context-assembler.ts`** — owner of the per-section assembly. This phase adds truncation + compression + budget lookup. Phase 52's `AssembledContext` two-block contract stays intact.
- **`src/memory/context-summary.ts`** — resume summary generation; extend with budget enforcement.
- **`src/memory/tier-manager.ts`** — hot-tier already exposes importance-ordered retrieval; leverage `getHotMemoriesByImportance(limit)` or similar for hot-tier truncation strategy.
- **`src/cli/commands/bench.ts`** — precedent for `--context-audit` mode and JSON report generation.
- **`src/cli/commands/latency.ts`** + **`src/cli/commands/cache.ts`** — precedents for CLI shape of the new `context-audit` command.
- **`src/config/schema.ts`** — extend `perf` with `memoryAssemblyBudgets?`, `lazySkills?`, `resumeSummaryBudget?`. Mirror the `slos?` override pattern from Phase 51.
- **`src/shared/types.ts`** — mirror new fields on `ResolvedAgentConfig.perf`.
- **`src/usage/tracker.ts`** — precedent for per-agent persistent tracking if skill usage needs persistence.
- **`src/ipc/protocol.ts`** — register `"context-audit"` IPC method if the CLI is daemon-routed (currently leaning filesystem-direct — no IPC needed).

### Established Patterns
- Per-agent SQLite, prepared statements, `Object.freeze`.
- Zod v4 (`zod/v4`).
- ESM `.js` imports.
- CLI pattern: `src/cli/commands/<name>.ts` + registration in `src/cli/index.ts`.
- Phase 50 regression lesson: ANY new IPC method → add to BOTH `src/ipc/protocol.ts` IPC_METHODS AND `src/ipc/__tests__/protocol.test.ts` expected list.
- Phase 52 pattern: pure helpers with public exports + unit tests (context-assembler changes must preserve `{ stablePrefix, mutableSuffix, hotStableToken }` shape).

### Integration Points
- `src/manager/context-assembler.ts` — budget enforcement + lazy-skill compression.
- `src/memory/context-summary.ts` — resume-summary budget enforcement.
- `src/cli/commands/context-audit.ts` — new CLI.
- `src/cli/commands/bench.ts` — add `--context-audit` mode.
- `src/performance/token-count.ts` — new helper.
- `src/usage/skill-usage-tracker.ts` — optional new tracker for the lazy-skill window.
- `src/config/schema.ts` + `src/shared/types.ts` — new perf fields.
- `src/ipc/protocol.ts` + `__tests__/protocol.test.ts` — ONLY if the audit command ends up daemon-routed (leaning filesystem-direct for reproducibility).

</code_context>

<specifics>
## Specific Ideas

- **Reproducibility first.** The audit must produce identical output for identical input (same traces.db state). Filesystem-direct reads avoid the flakiness of needing a running daemon. The audit is a developer tool, not an operator dashboard.
- **Section naming is canonical.** Use EXACTLY these section names in audit output + config: `identity`, `soul`, `skills_header` (the descriptions block), `hot_tier`, `recent_history`, `per_turn_summary`, `resume_summary`. These map 1:1 to the assembler blocks. Do not invent new names.
- **Compression is per-skill, not per-skill-set.** If only skills A and B were used in the last 20 turns and C/D/E weren't, then A and B remain full-content while C/D/E compress to one-line entries. The assembler does NOT drop unused skills entirely from the catalog header — compressing preserves discoverability.
- **Re-inflate uses word-boundary regex.** `/\b<skillName>\b/i` match on user message + last assistant response. Avoids false positives on substrings.
- **Recommended defaults shipped conservative.** Don't ship aggressive budget cuts in Phase 53 until real audit data validates them. The phase delivers the MACHINERY; operators tune the knobs.

</specifics>

<deferred>
## Deferred Ideas

- Quality-judge regression validation (LLM-as-judge on response quality) — post-milestone.
- Cross-agent budget learning (fleet-wide recommendation aggregation) — needs multi-agent telemetry pipeline.
- Automatic compression-threshold tuning per agent — needs multi-variant A/B scaffolding.
- Budget enforcement for MCP tool schemas themselves — out of scope; SDK owns tool-schema caching.
- Historical trend view in dashboard — deferred; the audit is CLI-only for now.

</deferred>
