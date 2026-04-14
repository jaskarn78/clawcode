# Phase 52: Prompt Caching - Context

**Gathered:** 2026-04-13
**Status:** Ready for planning
**Mode:** Smart discuss — all 4 grey areas accepted as recommended

<domain>
## Phase Boundary

Cut input tokens and first-token latency by exploiting the Anthropic prompt cache. Structure the system prompt so stable content (identity, soul, skills header, stable hot-tier memory) sits in a deterministic prefix the SDK can cache, while mutable content (recent session history, per-turn summary, user message) stays outside the cache boundary. Capture per-turn cache telemetry (cacheRead / cacheCreation / input tokens) through the SDK result message, store it alongside traces, expose hit rate on CLI + dashboard, and validate that eviction correctly follows identity/soul/skills/hot-tier changes.

Scope lines:
- IN: Context-assembly reordering (stable prefix vs mutable suffix), hot-tier `stable_token` tracking, per-turn cache telemetry capture in SdkSessionAdapter, new cache columns on `traces` table, `TraceStore.getCacheTelemetry`, `clawcode cache` CLI, dashboard "Prompt Cache" panel, daily summary extension, prefix_hash eviction detection, first-token cache-effect validation.
- OUT: Directly emitting raw `cache_control` markers (SDK doesn't expose that surface — use its preset+append + let SDK auto-cache), cross-agent prompt prefix sharing (deferred — requires identity model rework), disk-backed KV cache (deferred), custom HTTP proxy (rejected earlier milestone).

</domain>

<decisions>
## Implementation Decisions

### Cache Telemetry Capture
- **Capture point:** Hook in `SdkSessionAdapter.sendAndStream` SDK result-message handler. Read `msg.usage.cacheReadInputTokens`, `cacheCreationInputTokens`, `inputTokens` per turn. Integrate into the existing `Turn.end()` flow (already batches per-turn writes) so no extra transaction.
- **Storage shape:** Extend the existing `traces` table with three new nullable INTEGER columns: `cache_read_input_tokens`, `cache_creation_input_tokens`, `input_tokens`. One row per turn, cumulative totals for the turn. Backfill default 0 on insert so old rows don't break queries.
- **Hit-rate formula:** `hit_rate = cache_read_input_tokens / (cache_read_input_tokens + cache_creation_input_tokens + input_tokens)` — fraction of input tokens served from cache. Matches Anthropic billing semantics.
- **Query API:** New `TraceStore.getCacheTelemetry({ agent, since })` returning `{ totalTurns, avgHitRate, p50HitRate, p95HitRate, trendByDay[] }`. Mirrors `getPercentiles` shape so CLI/dashboard formatters stay symmetric.

### Prompt Stability Strategy
- **System prompt construction:** Use `systemPrompt: { type: 'preset', preset: 'claude_code', append: <agent-stable-prefix> }`. The SDK's `claude_code` preset handles core tool definitions and caches them. The `append` string concatenates the agent's identity + soul + skills-header + stable hot-tier memory — stable across turns, SDK auto-caches the preset+append block.
- **Context assembly order:** Strict two-block ordering in `ContextAssembler.assemble`:
  1. STABLE PREFIX (returned as the `systemPrompt.append` value): identity, soul, skills header, hot-tier memory entries marked `stable_token` matching last turn.
  2. MUTABLE SUFFIX (prepended to user message, outside cache): recent session history, per-turn summary, current user message.
  Assembly returns both blocks separately; session-adapter plugs them into their correct positions.
- **Hot-tier stability:** Add a `stable_token` column to hot-tier memory records (or a computed hash of the hot-tier record set at assembly time). If the hot-tier set changes between turns, the `stable_token` changes → `ContextAssembler` omits hot-tier from the stable prefix FOR THAT TURN ONLY and places it in the mutable suffix. Next turn with unchanged hot-tier re-enters the stable prefix cleanly. This prevents mid-session cache thrashing on a single hot-tier update.
- **Skills/tool definitions:** Tool schemas are handled by the SDK preset — not reimplemented. The `append` block only carries skills DESCRIPTIONS (the human-readable catalog header that tells the model which skills are available). This keeps the stable block small and avoids duplicating tool-schema JSON.

### Hit-Rate Surfacing
- **CLI:** New `clawcode cache` subcommand. Positional `<agent>` + `--all` + `--since 24h` + `--json` flags. Output columns: `Hit Rate | Cache Reads | Cache Writes | Input Tokens | Turns`. CLI shape mirrors `clawcode latency`.
- **Dashboard:** New "Prompt Cache" section in the per-agent card adjacent to Latency. Renders hit rate % with SLO-style coloring: healthy ≥ 60%, breach < 30%, no_data (turns=0). Subtitle explains the formula for operator clarity.
- **Daily summary:** Extend the existing Phase 40 Discord cost summary embed with a single line: `💾 Cache: {hitRate}% over {turns} turns`. No breaking schema change — purely additive.
- **Time window:** `--since 24h` default (matches Latency CLI). Accepts `1h/6h/24h/7d` via the shared `parseSinceDuration` helper. Dashboard fixed last-24h.

### Eviction Detection & First-Token Validation
- **Prefix-change detection:** Compute `prefix_hash = sha256(stable_prefix_string)` per turn. Store in new `traces.prefix_hash` TEXT column. When a turn's `prefix_hash` differs from the immediately prior turn's for the same agent, tag the turn `cache_eviction_expected = true` (stored in `traces.cache_eviction_expected INTEGER` 0/1).
- **Eviction test:** New integration test `src/performance/__tests__/cache-eviction.test.ts`. Mock SdkSessionAdapter → run a turn → swap identity config → run another turn → assert `prefix_hash` differs AND `cache_eviction_expected = true`. Live-daemon confirmation deferred to manual verification (requires Anthropic auth).
- **First-token validation (ROADMAP criterion 5):** Compute `cache_effect_ms` as `avg(first_token_ms WHERE cache_read_input_tokens>0) - avg(first_token_ms WHERE cache_read_input_tokens=0)` over the recent 20+ turns. Surface in the CLI + dashboard. If the delta is < 0 after 20 eligible turns, log a WARN noting caching isn't delivering expected latency improvement.
- **Dashboard eviction indicator:** When a turn has `cache_eviction_expected=true` AND `cache_read_input_tokens=0`, the Prompt Cache panel shows a small "prefix changed" annotation next to that turn's bucket so operators can correlate config edits with cache flushes. Minor UI nicety.

### Claude's Discretion
- Exact file layout within `src/performance/`: likely a new `cache-telemetry.ts` next to existing `trace-store.ts`; can also live inside trace-store if cohesive.
- SQL migration strategy for adding columns to existing `traces.db` files. Use `ALTER TABLE IF NOT EXISTS ADD COLUMN` with default 0 — SQLite supports this cleanly. Idempotent at store construction.
- How `stable_token` is computed — hash of the hot-tier row IDs + updated_at timestamps, or explicit boolean. Prefer hash for robustness.
- Whether to expose a `stableTokenSalt` config knob for debugging. YAGNI unless needed.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src/performance/trace-store.ts`** — schema already established with CASCADE retention. Adding columns is cheap. `writeTurn` path already takes a metadata object — extend it.
- **`src/performance/trace-collector.ts`** — `Turn` already buffers spans and flushes at `end()`. Extend it to also buffer cache telemetry snapshot captured from SDK usage field.
- **`src/manager/session-adapter.ts`** — SDK result message handler already feeds into the trace flow. Existing `iterateWithTracing` helper is the right place to slot in `usage.cacheReadInputTokens` capture.
- **`src/manager/context-assembler.ts`** — Already assembles context per-turn (wrapped by `assembleContextTraced` in Phase 50). Refactor to return `{ stablePrefix, mutableSuffix }` instead of a single blob.
- **`src/cli/commands/latency.ts`** + **`src/cli/commands/bench.ts`** — CLI command precedents for `clawcode cache`.
- **`src/dashboard/static/app.js`** — Existing Latency panel pattern. Add a `renderCachePanel` function next to it.
- **`src/dashboard/server.ts`** — Existing `/api/agents/:name/latency` endpoint. Add `/api/agents/:name/cache`.
- **`src/ipc/protocol.ts`** — Register the new `cache` IPC method (Phase 50 regression lesson).
- **Discord cost summary emitter (from Phase 40)** — append the cache hit-rate line to the existing embed.
- **`src/performance/slos.ts`** — SLO infrastructure is reusable; add a default cache-hit-rate SLO (`healthy ≥ 60%, breach < 30%`).

### Established Patterns
- Per-agent SQLite with idempotent schema, prepared statements, `Object.freeze` returns.
- `iterateWithTracing` helper captures SDK stream events — extend in session-adapter to also capture usage fields.
- CLI + REST + dashboard flow: CLI → IPC → daemon → TraceStore; dashboard → REST → IPC → daemon → TraceStore.
- Phase 50/51 lesson: ANY new IPC method must appear in `src/ipc/protocol.ts` IPC_METHODS AND `src/ipc/__tests__/protocol.test.ts` expected list.
- Zod v4 (`zod/v4`) for new schema surfaces.
- ESM `.js` extension on relative imports.

### Integration Points
- `src/manager/context-assembler.ts` — split return type into `{ stablePrefix, mutableSuffix }`.
- `src/manager/session-config.ts` / `src/manager/session-adapter.ts` — consume the two-block assembly and pass `append` to `systemPrompt`.
- `src/manager/daemon.ts` — new `cache` IPC handler method + extend daily cost summary emitter.
- `src/discord/bridge.ts` — no change (passes through).
- `src/dashboard/server.ts` — new REST endpoint `/api/agents/:name/cache`.
- `src/dashboard/static/app.js` + `styles.css` — render Prompt Cache panel.
- `src/cli/index.ts` — register `cache` command.
- `src/performance/trace-store.ts` — ALTER TABLE to add `cache_read_input_tokens`, `cache_creation_input_tokens`, `input_tokens`, `prefix_hash`, `cache_eviction_expected` columns.
- `src/ipc/protocol.ts` + `__tests__/protocol.test.ts` — register `"cache"` IPC method.

</code_context>

<specifics>
## Specific Ideas

- **SDK's systemPrompt preset is load-bearing.** The `type: 'preset', preset: 'claude_code', append: <stable>` form is what makes automatic caching work — do NOT switch to raw string systemPrompt (that loses the preset's cache scaffolding).
- **Hot-tier `stable_token`** is the subtle bit. Naïve inclusion of hot-tier in the stable block would cause cache thrashing on every memory write. The `stable_token` comparison approach means: hot-tier goes in the stable prefix ONLY when it didn't change since last turn; otherwise it flows through the mutable suffix. Over long sessions this means hot-tier joins the cached block within a turn or two of any update.
- **prefix_hash is ONLY for eviction diagnostics, not cache correctness.** The SDK handles actual cache invalidation. Our hash is an operator-facing signal that lets us verify the SDK's behavior matches our intent.
- **First-token validation has a noise floor.** Model latency variance is high; 20+ turns is the minimum sample to trust the comparison. The WARN log is advisory, not a hard failure.
- **Dashboard column order on the cache panel:** Hit Rate first (the primary signal), then cumulative Cache Reads / Cache Writes / Input Tokens. Turns count last.

</specifics>

<deferred>
## Deferred Ideas

- Cross-agent prompt prefix sharing (requires identity model rework — distinct work stream).
- Disk-backed KV cache persistence across daemon restarts (large architectural change).
- Speculative decoding or multi-model racing (depends on Anthropic primitives not yet exposed).
- Auto-eviction timing knob (forcing cache refresh on a timer) — only add if we actually see issues.
- Manual `cache_control` breakpoint override — not exposed by the SDK surface; revisit only if the SDK gains it.
- Per-skill cache-ability annotations — YAGNI until skills actually churn.

</deferred>
