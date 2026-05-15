# Phase 127: No-Useful-Tokens Stream Timeout — Context

**Gathered:** 2026-05-15
**Status:** Ready for planning
**Mode:** Auto-generated from BACKLOG.md (autonomous workflow — operator pre-specified spec via 2026-05-14 incident report)

<canonical_refs>
## Canonical References

| Ref | Why | Path |
|-----|-----|------|
| BACKLOG.md (authoritative spec) | Operator-written 2026-05-14 20:17 PT after the fin-acq incident; acceptance criteria + symptoms + investigation directions | `.planning/phases/127-no-useful-tokens-stream-timeout/BACKLOG.md` |
| ROADMAP.md Phase 127 entry | Goal + Success Criteria + dependencies | `.planning/ROADMAP.md` — Phase Details (v3.0) section |
| Stream wrap point | The SDK iteration loop where `content_block_delta` / `message_delta` events are consumed today | `src/manager/session-adapter.ts:1913-1932` (existing `stream_event` handling for partial-message streaming) |
| Anthropic SDK message types | Reference for `content_block_delta` + `message_delta` event shapes | `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (search `content_block_delta`) + `src/manager/session-adapter.ts:2164` comments |
| Phase 117 advisor pattern | When agent calls `advisor()`, parent stream pauses while child runs. Affects clock-pause decision (D-09 deferred to research). | CLAUDE.md §"Advisor pattern (Phase 117)" + `src/advisor/` |
| Phase 124 / 125 compaction | Stall reason persisted in session JSONL so compaction can detect this pattern | `src/manager/compact-extractors/` + `src/memory/session-log.ts` |
| feedback_silent_path_bifurcation.md | Anti-pattern — must wrap at the SDK iteration chokepoint, not at multiple call sites | memory |
| feedback_ramy_active_no_deploy.md | Deploy hold — code lands locally; production verification gated on Ramy-quiet window | memory |
</canonical_refs>

<domain>
## Phase Boundary

Add SDK-level "no useful content tokens for N seconds → fail turn" supervisor extension to the Claude Agent SDK process supervisor. Closes the 2026-05-14 fin-acquisition 16-minute stall pattern where the stream emitted keepalive bytes / empty deltas but never produced a usable token, yet the dead-stream timeout never fired because the connection had "traffic."

**In scope:**
- Per-turn last-useful-token timestamp tracking, distinct from last-byte timestamp.
- Per-agent + per-model configurable threshold (default 180000ms = 3 min) in `clawcode.yaml`.
- Trip behavior: emit structured stall event → persist stall reason in session JSONL → surface single-line Discord notification → kill in-flight turn only (NOT agent process).
- Telemetry: stall events logged with last-useful-token-age, advisor-active flag, model name, effort level.
- Test: synthetic keepalive-only stream fixture triggers turn-failure at threshold.

**Out of scope (deferred):**
- Provider failover chain (retry with shorter effort or alternate provider). Adjacent operator desire — fold into v3.1 (Phase 137 AnthropicApiKey + Phase 138 failover) where it belongs.
- Killing the agent process / restarting the session. The stall protection only kills the in-flight turn; the agent stays alive (matches normal turn-completion blast radius).
- Threshold auto-tuning from session-log p99 inter-token gap analysis. Plan-phase research may produce a recommendation, but auto-tuning is its own follow-up phase.

</domain>

<decisions>
## Implementation Decisions

### Mechanism (what to track)

- **D-01:** Track **last-useful-token timestamp** per active turn, distinct from last-byte timestamp. Reset on every "useful token" event; trip when `Date.now() - lastUsefulTokenAt > thresholdMs`.
- **D-02:** **"Useful token" definition** — any `content_block_delta` OR `message_delta` event with non-empty `text` (in `text_delta`) OR non-empty `partial_json` (in `input_json_delta`). NOT: keepalives, empty deltas, ping events, message_start/message_stop frames, content_block_start/stop frames.

### Wrap point

- **D-03:** **Single chokepoint at `src/manager/session-adapter.ts:1913+`** — the existing `stream_event` handler in the SDK iteration loop. Add `lastUsefulTokenAt` tracker alongside `firstTokenEnded` + `streamedText`. Resets on `event.delta?.text || event.delta?.partial_json` (the SAME predicate already extending `streamedText` for the editor pipeline). Per `feedback_silent_path_bifurcation.md`: no per-call-site wrapping — one chokepoint, one tracker.

### Config shape

- **D-04:** **Per-agent `streamStallTimeoutMs`** field in `clawcode.yaml` agent schema (Zod). Optional; default 180000ms (3 min). Per-model override via `defaults.modelOverrides.<model>.streamStallTimeoutMs` (Opus-with-advisor may legitimately need longer). Resolver merges per-agent → per-model → default.
- **D-04a:** **Reloadable** via ConfigWatcher hot-reload path. The tracker reads the threshold at trip-check time, not at session start, so a config change applies to the next stall check.

### Trip behavior

- **D-05:** **On trip:**
  1. Emit structured `stream_stall` event (logged via `console.info("phase127-stream-stall", JSON.stringify({...}))` matching Phase 115 quickwin + Phase 999.54 precedent).
  2. Persist stall reason in session JSONL — extend session-log writer with `stallReason: "no-useful-tokens-timeout"` field. Phase 124/125 compaction extractor picks this up.
  3. Surface single-line Discord notification via webhook: `"⚠️ stream stall — turn aborted, send the message again"`. Per-agent Discord routing (existing `WebhookManager.sendAsAgent` path).
  4. **Kill in-flight turn only** — abort the SDK query, reset the supervisor to idle, do NOT call `stopAgent` or kill the process. Match the blast radius of a normal turn-completion. Existing `Query.cancel()` or AbortController on the SDK query (verify SDK shape during plan-research).

### Telemetry

- **D-06:** **Stall event payload** for the structured log line includes: `agentName`, `sessionName`, `turnId`, `lastUsefulTokenAgeMs`, `thresholdMs`, `advisorActive` (boolean — is the agent mid-advisor-consult per `AdvisorService`?), `model` (current model), `effort` (current `maxThinkingTokens` setting).

### Advisor interaction (DEFERRED to plan-phase research)

- **D-07:** When agent calls `advisor()` (Phase 117), the parent stream pauses while the advisor's child stream runs. The last-useful-token clock for the parent turn either:
  - **(a) Pauses while advisor is active** — preferred; the advisor consult is legitimate work, not a stall.
  - **(b) Threshold is high enough to cover Opus advisor consults** (e.g., 300s) — simpler, but couples the stall threshold to advisor latency.
  - **(c) Per-model `advisorPauseMs` budget added to threshold while advisor is active** — middle ground.
  - **Decision deferred to plan-phase research.** Plan-research reads `src/advisor/` (`AdvisorService`, `AnthropicSdkAdvisor`, `LegacyForkAdvisor`) to determine which call sites emit "advisor active" telemetry the supervisor can read. If no telemetry signal exists, option (b) is the fallback.

### Test approach

- **D-08:** **Synthetic keepalive-only stream fixture** — vitest test with a mock SDK iterator that emits only `content_block_start` / `content_block_stop` / `ping` events (no `text_delta` or `partial_json`). Confirm the supervisor's `lastUsefulTokenAt` doesn't update, and at `thresholdMs + 100ms` the abort fires + stall event is emitted.

### Threshold default tuning

- **D-09:** Default 180000ms is a starting guess. Plan-phase research SHOULD pull last 7 days of agent turn telemetry (`traces.db` if Phase 50/52 latency instrumentation captured inter-token gaps; OR session JSONL inter-token timestamps if available) to find p99 inter-token gap on healthy turns. Set threshold at ~2× p99. If research data isn't available, ship with 180000ms and tune post-deploy.

### NON-reloadable: NONE

- **D-10:** All Phase 127 fields are **reloadable** (per `RELOADABLE_FIELDS` classification in `differ.ts`). The tracker re-reads on each stall-check, so config changes apply mid-session without restart. Doc-of-intent entry in `RELOADABLE_FIELDS` set documents this.

### Claude's Discretion

- File locations: schema field in `src/config/schema.ts` near existing `heartbeat` / `memoryRetrievalTopK` fields. Type field in `src/shared/types.ts` `ResolvedAgentConfig`. Tracker + abort logic in `src/manager/session-adapter.ts` near line 1913. Discord notification via existing `WebhookManager` path. Session-log stall-reason via existing session-log writer.
- Test pins: extend existing `session-adapter.test.ts` (or sibling) with the synthetic stream fixture.
- Default model overrides: `defaults.modelOverrides.opus.streamStallTimeoutMs: 300000` (5 min for Opus + advisor consults), `defaults.modelOverrides.haiku.streamStallTimeoutMs: 90000` (90s — Haiku turns should be fast).

</decisions>

<code_context>
## Existing Code Insights

- **SDK iteration loop:** `src/manager/session-adapter.ts:1913-1932` — existing `stream_event` handler reads `content_block_delta` events for the editor pipeline (`streamedText += event.delta.text`). The exact predicate already isolates the "useful token" condition needed for D-02.
- **Stall detection cannot use existing `firstToken` tracker** — `firstToken` is one-shot (sets `firstTokenEnded = true` after first text_delta). The new tracker must update on EVERY useful token, not just the first.
- **Phase 117 `AdvisorService` is provider-neutral** at `src/advisor/` — three backends (`native`, `fork`, scaffold `portable-fork`). The native backend uses the Anthropic `advisor_20260301` beta tool in-request; the executor model decides timing. For D-07, the question is: does the parent's SDK iteration loop see ANY signal when the in-request advisor is consulted? Likely yes via `content_block_start` of type `tool_use` with `name === "advisor"`. Plan-research confirms.
- **Existing Discord webhook send path** is the chokepoint for D-05 step 3 — `WebhookManager.sendAsAgent(channelId, content)` already handles per-agent identity. No new send-site needed; per `feedback_silent_path_bifurcation.md` reuse the single chokepoint.
- **Phase 124/125 compaction** consumes session-log events for tier-2 extraction. Persisting `stallReason: "no-useful-tokens-timeout"` in the session-log row makes stalls observable in compaction summaries (operator can see "agent had 3 stalls this week" in the active-state.yaml).

</code_context>

<specifics>
## Specific Ideas

- **Field naming:** `streamStallTimeoutMs` (NOT `noUsefulTokensTimeoutMs` — too long; NOT `streamIdleTimeoutMs` — collides with the existing dead-stream timeout semantics; NOT `streamHealthTimeoutMs` — vague). The name matches the operator-observable symptom ("stream stalled").
- **Default value:** 180000ms (3 min) per BACKLOG. Per-model overrides: Opus 300000ms, Haiku 90000ms.
- **Discord notification phrasing:** `"⚠️ stream stall — turn aborted, send the message again"` per BACKLOG line 19 verbatim.
- **Telemetry log key:** `phase127-stream-stall` matching Phase 115 / Phase 999.54 grep-friendly precedent.

</specifics>

<deferred>
## Deferred Ideas

- **Provider failover chain** — Anthropic stall → retry with shorter effort or alternate provider. Belongs in v3.1 (Phase 137 AnthropicApiKey + Phase 138 failover orchestration), NOT v3.0 Phase 127.
- **Threshold auto-tuning from p99 inter-token gap analysis** — plan-research may surface a recommendation; auto-tuning is its own follow-up phase.
- **Stall-recovery prompt suffix** — when the next turn fires after a stall, prepend a system note: "previous turn stalled and was aborted; you have N seconds this time." Deferred — adds prompt-engineering surface area beyond the supervisor.
- **Per-MCP-server stall tracking** — MCP tool calls can also stall (e.g., 1Password lookup hangs). Different surface; deferred.

</deferred>

<scope_creep_guardrail>
## Scope Guardrail

Phase 127 scope per BACKLOG:
- **YES:** SDK-level supervisor extension; per-turn tracking; trip behavior; config field; telemetry; one Discord notification.
- **NO:** New failover backend (v3.1). MCP-tool stall protection (separate phase). Stall-aware prompt engineering. Auto-tuning. Session-restart-on-stall.

Reject scope-creep suggestions like "while we're at it, add HTTP-level retries" — that's v3.1 backend territory.

</scope_creep_guardrail>
