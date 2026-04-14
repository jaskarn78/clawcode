# Phase 54: Streaming & Typing Indicator - Context

**Gathered:** 2026-04-14
**Status:** Ready for planning
**Mode:** Smart discuss — all 4 grey areas accepted as recommended

<domain>
## Phase Boundary

Users see activity and tokens sooner on every Discord turn. Promote `first_token` to a first-class reported metric (CLI + dashboard prominence), tighten `ProgressiveMessageEditor` cadence with a per-agent config knob, fire the typing indicator at message arrival (before session dispatch) within a 500ms SLO, and measure user-perceived first-token latency as a distinct `first_visible_token` span to catch plumbing overhead.

Scope lines:
- IN: CLI/dashboard elevation of first_token, per-agent `perf.streaming` config, move typing fire to `DiscordBridge.handleMessage` entry, `typing_indicator` + `first_visible_token` spans + SLOs, rate-limit backoff inside ProgressiveMessageEditor, rate-limit-error regression assertion in bench.
- OUT: Discord-side WebSocket tuning (discord.js owns it), replacing ProgressiveMessageEditor with a different library, alternative deliveries (DMs, embeds), multi-message chunking strategy changes (existing split-at-2000 stays).

</domain>

<decisions>
## Implementation Decisions

### First-Token as First-Class Metric
- **CLI surfacing:** `clawcode latency` gains a "First Token Latency" block printed ABOVE the existing 4-row percentile table — shows p50 / p95 / p99 for `first_token` with SLO color (cyan/red/gray). Both the block and the full-segments table render by default. `--json` includes a `first_token_percentiles` top-level object.
- **Dashboard surfacing:** New "First Token" card at the top of each agent tile. Large p50 number, SLO color, subtitle "first user-visible token". Separate from the Latency panel; visually prominent. Prompt Cache panel stays where it is.
- **SLO threshold:** Keep Phase 51's default `first_token p50 ≤ 2000ms`. No tightening — the success criterion is elevation, not a stricter bar.
- **Query convenience:** `TraceStore.getFirstTokenPercentiles(agent, since)` wraps `getPercentiles` filtered to `name='first_token'`. Returns the existing `PercentileRow`-like shape augmented with `slo_status` / `slo_threshold_ms` / `slo_metric` via the Phase 51 `augmentWithSloStatus` pipeline.

### Streaming Cadence (ProgressiveMessageEditor)
- **Default `editIntervalMs`:** Drop from 1500ms → 750ms. Still safely under Discord's "5 edits / 5s" limit (1 edit/s) with headroom for burst tolerance.
- **Per-agent config:** New `perf.streaming?: { editIntervalMs?: number, maxLength?: number }` on agent Zod schema. Floor `editIntervalMs >= 300` (absolute rate-limit safety). Per-agent merge mirrors Phase 51's `perf.slos?` override pattern.
- **Rate-limit backoff:** When `editFn` rejects with a Discord rate-limit error (error code 429 or discord.js `RateLimitError`), DOUBLE the editor's `editIntervalMs` for the remainder of the current turn only. Reset on turn completion. Log a single pino WARN per turn with `{ agent, turnId, original_ms, backoff_ms, error }`. No panic, no message drop.
- **First-chunk behavior:** First `editFn` call STILL fires immediately (keeps perceived speed). Only subsequent chunks respect the tighter interval. No change to `hasSentFirst` early-out logic.

### Early Typing Indicator
- **Fire point:** Move from `streamAndPostResponse` (post-dispatch) to `DiscordBridge.handleMessage` — right after channel routing confirms an agent + ACL check passes. BEFORE session dispatch / session creation / any LLM plumbing. This is the earliest point where we know the message is ours to answer.
- **Guard conditions:**
  - Channel routed to a known agent (required)
  - ACL check passes (required — skip typing for blocked messages to avoid false signals)
  - Not our own message (required — skip for bot-authored echoes)
  - Message type is a user message (not system/pin/etc)
- **500ms budget verification:** New `typing_indicator` span added to Phase 50 trace tree — captures time from `handleMessage` entry → `sendTyping()` call. New SLO entry in `slos.ts`: `{ segment: 'typing_indicator', metric: 'p95', thresholdMs: 500 }`. Breach when p95 exceeds 500ms. Surface in CLI + dashboard alongside existing SLOs.
- **Failure handling:** Wrap `sendTyping()` in try/catch, swallow errors silently with pino debug log (`{ agent, channelId, error }`). Typing indicator failures must NEVER block the actual response path — typing is observational only. The 8-second re-typing interval in `streamAndPostResponse` stays as-is (separate concern).

### First-Token-Visible-in-Discord + Rate-Limit Guard
- **`first_visible_token` span:** Measures `handleMessage` entry → first `editFn` invocation in `ProgressiveMessageEditor` (the moment text actually appears in Discord). Distinct from `first_token` (which measures model's first output arrival at the adapter). The delta between `first_visible_token` and `first_token` captures Discord-plumbing overhead.
- **Surfacing:** `first_visible_token` is the 5th canonical segment. Appears as an additional row in the latency percentile table and in percentile JSON. NOT promoted to a headline card — that stays `first_token`. `first_visible_token` is the debug/support metric.
- **Rate-limit regression guard:** During `clawcode bench` runs, count Discord rate-limit errors in logs / WARN counters. New bench assertion: if rate-limit error count > 0 after the prompt set completes, fail `--check-regression` with a message: "Streaming cadence triggered {N} Discord rate-limit error(s) — consider raising `perf.streaming.editIntervalMs` or reverting the cadence change". Counter lives on the existing bench report as `rate_limit_errors: number` alongside response-length checks.
- **Hot-reload safety:** `perf.streaming` values validate at Zod load time. Existing config hot-reload picks up cadence changes without daemon restart. Invalid values (e.g. `editIntervalMs < 300`) reject the entire config update with the Zod error, leaving the prior values in effect. Runtime applies new values on the NEXT turn (never mid-turn).

### Claude's Discretion
- Exact file layout for the streaming config type — likely inline in `src/discord/streaming.ts` or extend existing shared types.
- Whether `rate_limit_errors` is tracked via a global counter + pino child logger tagged with `{agent, turnId}` or via the existing TraceCollector span metadata. Pick whichever is cleaner.
- Backoff reset mechanism — timer-based, turn-end callback, or natural via new editor instance per turn. Prefer new editor instance per turn (matches existing architecture; no cross-turn state).
- Whether the typing-indicator span buffers into the existing `turn.recordCacheUsage`-style snapshot path or becomes a dedicated span type.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src/discord/bridge.ts`** — `handleMessage` (line ~200+ entry) + `streamAndPostResponse` (line 403+) currently. Typing fires inside `streamAndPostResponse`; move to `handleMessage`.
- **`src/discord/streaming.ts`** — `ProgressiveMessageEditor` class. `editIntervalMs` already configurable per instance — add agent-config plumbing and rate-limit backoff.
- **`src/performance/slos.ts`** — Phase 51's `DEFAULT_SLOS` + `augmentWithSloStatus`. Extend with `typing_indicator` + optionally elevate `first_token` card rendering.
- **`src/performance/trace-store.ts`** — `getPercentiles` already supports canonical segments. Add `typing_indicator` + `first_visible_token` to CANONICAL_SEGMENTS if enumerated, else data-driven.
- **`src/performance/trace-collector.ts`** — `Turn.startSpan` already supports arbitrary span names. New span types are a no-code-change addition at that layer.
- **`src/config/schema.ts`** + **`src/shared/types.ts`** — extend `perf` with `streaming?`. Mirror the `slos?`/`lazySkills?` override pattern.
- **`src/cli/commands/latency.ts`** — add First Token block above segments table.
- **`src/dashboard/server.ts`** + **`src/dashboard/static/app.js`** — `/api/agents/:name/latency` response extends with `first_token_headline`; dashboard renders new card.
- **`src/benchmarks/harness.ts`** + **`src/benchmarks/runner.ts`** — instrument the rate-limit error counter.

### Established Patterns
- Per-agent SQLite, prepared statements, `Object.freeze` returns.
- Phase 50/51 pattern: new SLO → `slos.ts` export + dashboard color + CLI color.
- Phase 52 pattern: observational traces never block hot path (try/catch silent swallow).
- Phase 53 pattern: per-agent config override via `perf.*` Zod field with safety floor.
- ESM `.js` imports, Zod v4 (`zod/v4`), readonly types.
- Phase 50 REGRESSION LESSON: any new IPC method → update BOTH `src/ipc/protocol.ts` IPC_METHODS AND `src/ipc/__tests__/protocol.test.ts`. This phase likely ADDS NONE (all extensions go through existing `latency` + `cache` + REST endpoints), but double-check during planning.

### Integration Points
- `src/discord/bridge.ts` — relocate typing fire; add guard conditions; wrap typing span around the existing turn.
- `src/discord/streaming.ts` — per-agent `editIntervalMs`; rate-limit backoff; `first_visible_token` span emission on first `editFn` call.
- `src/performance/slos.ts` — add `typing_indicator` SLO entry (500ms p95); optional `first_token` SLO elevation.
- `src/config/schema.ts` + `src/shared/types.ts` — `perf.streaming?` Zod.
- `src/manager/daemon.ts` — `latency` handler augments response with `first_token_headline` object OR client fetches and derives — prefer server-emit for consistency with Phase 51's data-driven pattern.
- `src/cli/commands/latency.ts` — render First Token block.
- `src/dashboard/static/app.js` — add First Token headline card; add `typing_indicator` + `first_visible_token` rows to existing Latency panel.
- `src/benchmarks/harness.ts` / `src/benchmarks/runner.ts` — `rate_limit_errors` counter + report field + `--check-regression` assertion.

</code_context>

<specifics>
## Specific Ideas

- **Canonical segment order (updated):** `end_to_end, first_token, first_visible_token, context_assemble, tool_call, typing_indicator`. Existing 4-segment order from Phases 50-51 stays; the 2 new ones append. Dashboard + CLI rendering must handle 6 rows without breaking layout.
- **Rate-limit detection:** discord.js surfaces 429s via `DiscordAPIError` with `code: 20028` (for interaction rate limits) and HTTP 429 with `retry_after`. Both should count. Add a small helper `isDiscordRateLimitError(err): boolean` to centralize.
- **Per-turn editor instance:** `streamAndPostResponse` already creates a new `ProgressiveMessageEditor` per call. This means backoff state naturally resets — no cross-turn leak.
- **`first_token` headline card** is RED when breach, not when agent is merely warming up. Use `no_data` (gray) for `totalTurns < 5` to avoid alarming operators on cold starts. Same rule as Phase 51's SLO treatment.
- **typing_indicator 500ms budget is aggressive.** Allow measurement-only for the first week of real traffic; operators can observe p95 before treating the SLO as blocking. Default is observational breach color, not a hard gate.

</specifics>

<deferred>
## Deferred Ideas

- Discord-side gateway / shard tuning — owned by discord.js, out of scope.
- Alternative delivery surfaces (voice, DMs, thread-forwarding) — not a performance win.
- Dropping multi-message chunking in favor of follow-ups / embeds — separate design question.
- Adaptive editIntervalMs per channel based on observed rate-limit history — premature; manual config per agent is enough.
- Streaming-cadence A/B telemetry framework — out of scope; bench + manual review is adequate.
- Cross-shard typing indicator coordination — not applicable to single-process agents.

</deferred>
