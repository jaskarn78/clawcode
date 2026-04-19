# Phase 73: OpenClaw Endpoint Latency - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped — ROADMAP phase goal + 5 success criteria are a complete spec)

<domain>
## Phase Boundary

Reduce `/v1/chat/completions` per-turn latency to sub-2s TTFB on warm agents for synchronous OpenClaw-agent consumption. Baseline: ~7s per turn for trivial prompts on clawdy, dominated by per-turn `sdk.query()` subprocess spawn + session-resume-from-disk (see `src/manager/session-adapter.ts:508-511`). The Discord path is latency-tolerant and must NOT regress; OpenClaw is the motivating consumer and is synchronous.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — discuss phase skipped per user intent ("handle all of this autonomously"). Use the ROADMAP phase goal, 5 success criteria (LAT-01 through LAT-05), and codebase conventions to guide decisions.

### Locked constraints (from user instruction)
- No regression on Discord bridge path (same `session-adapter.ts` is shared).
- No regression on v1.7 prompt-cache hit-rate SLO.
- All existing 2900+ tests stay green.
- No new `tsc --noEmit` errors beyond the pre-existing daemon.ts issues (lines 128, 665, 2576).
- Changes deployable via `git pull && sudo -u clawcode npm ci && npm run build && sudo systemctl restart clawcode` on clawdy.

### Out of scope (explicit)
Plumbing other OpenAI params — `temperature`, `max_tokens`, `reasoning_effort`, `stop`, `response_format` — belongs in a separate follow-up phase. This phase is latency-only.

</decisions>

<code_context>
## Existing Code Insights

### Known hot spots
- `src/manager/session-adapter.ts:508-511` — **per-turn `sdk.query()` pattern** explicitly chosen over `streamInput()` at the time for simplicity. Every `sendAndStream` call spawns a fresh Claude Code subprocess + resumes session from disk. This IS the dominant latency source.
- `src/manager/session-config.ts:330-356` — builds `conversation_context` via `assembleConversationBrief` on every session start. Already fast (<1ms per observation) but recomputed per-turn when every turn is a new subprocess.
- `src/openai/endpoint-bootstrap.ts` — `agentReadinessWaitMs` defaulted to 2000ms (landed in quick task 260419-jtk as a safety gate). Warm-path actual latency is 15ms (sqlite 3ms + embedder 12ms, from journal traces).

### Existing instrumentation
- Trace spans exist — `src/performance/trace-collector.ts`, `src/performance/context-audit.ts`, `src/cli/commands/trace.ts`. TTFB fields are NOT yet on the `openai.chat_completion` span.
- Cost + token tracking — `src/usage/tracker.ts`. Cache-usage fields exist (`cache_read_input_tokens`, `cache_creation_input_tokens`) in `src/manager/sdk-types.ts` but the OpenAI endpoint's non-stream response currently reports `usage:{0,0,0}` — unrelated pre-existing gap, out of scope here but measurement hook is available.

### Integration points
- OpenAI endpoint lifecycle: `src/openai/endpoint-bootstrap.ts` → `src/openai/server.ts` → `src/openai/driver.ts` → `SessionManager.streamFromAgent` → `SdkSessionAdapter.sendAndStream`.
- Discord path enters at `src/manager/turn-dispatcher.ts` and shares `sendAndStream` downstream — changes to the adapter MUST preserve the Discord contract.

### Reusable assets
- `src/openai/__tests__/fixtures/sdk-stream-*.json` — SDK stream event fixtures useful for testing the persistent-query behavior without booting real Claude Code.
- `SessionManager.isRunning(name)` — added in 260419-jtk; useful for readiness-wait tuning.
- Pitfall list from the Phase 69 research (`.planning/phases/69-openai-compatible-endpoint/69-RESEARCH.md`) — informative for further adapter changes.

### External research needed (explicit request from user)
OpenClaw itself — its repo, its consumption pattern, how it calls OpenAI-compatible endpoints, streaming vs non-stream preference, retry/timeout/concurrency behavior, which latency metric matters most to its UX. Research this during the plan-phase step.

</code_context>

<specifics>
## Specific Ideas

- Use `streamInput()` API on the Claude Agent SDK for the persistent generator. This is the SDK's documented long-lived-session primitive.
- Preserve per-turn session resumption on crash — if the persistent subprocess dies, the next turn must spawn a fresh one via `resume: sessionId` cleanly. Design for recovery.
- Measure before/after: add `ttfb_ms` + `total_turn_ms` to the `openai.chat_completion` span (new fields) so the v1.7 context-audit CLI can produce comparable before/after reports.
- Brief cache can use a simple per-agent `{ fingerprint: string, briefBlock: string }` map keyed by the set of terminated session IDs considered — invalidate when that set changes.

</specifics>

<canonical_refs>
## Canonical References

- Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`): https://github.com/anthropics/claude-agent-sdk-typescript — source of `streamInput()` contract.
- Prior art: `src/openai/__tests__/` test fixtures + Phase 69 stream test for the SSE contract that must remain byte-identical.
- Prior research (Phase 69): `.planning/phases/69-openai-compatible-endpoint/69-RESEARCH.md` — pitfalls 1–8 still apply.
- Prior quick task (260419-jtk): `.planning/quick/260419-jtk-harden-openai-streaming-for-openclaw-emi/260419-jtk-SUMMARY.md` — this phase builds on its warm-path wait + tool-call test scaffolding.

</canonical_refs>

<deferred>
## Deferred Ideas

- Plumbing `temperature`, `max_tokens`, `reasoning_effort`, `stop`, `response_format` through the translator → SDK session call. Explicitly out of scope for this phase.
- Fixing the `usage:{0,0,0}` gap in the non-stream response (SDK result usage not populated in OpenAI envelope). Separate bug, touches the same area but different concern.
- Reducing startup-race wait further via a readiness signal push (rather than polling). Only pursue if even a short wait shows up as a hot spot after the persistent-subprocess change.

</deferred>
