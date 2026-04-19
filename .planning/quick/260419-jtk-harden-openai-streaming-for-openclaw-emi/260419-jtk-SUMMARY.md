---
phase: 260419-jtk
plan: 01
subsystem: openai-endpoint
tags: [openai-api, streaming, hardening, v2.0-polish]
requires: [v2.0 OpenAI endpoint (Phases 69/70/71/72)]
provides:
  - stream_options.include_usage trailing chunk (OpenAI spec parity)
  - server-level tool-call streaming contract pin
  - bounded warm-path wait + 503 Retry-After (no more startup-race 500s)
affects:
  - src/openai/translator.ts
  - src/openai/server.ts
  - src/openai/endpoint-bootstrap.ts
  - src/openai/__tests__/translator.test.ts
  - src/openai/__tests__/server.test.ts
  - src/openai/__tests__/fixtures/sdk-stream-tool-use-terminal.json
  - src/manager/session-manager.ts
tech-stack:
  added: []
  patterns:
    - "Legacy-compatible finalize() overload: positional string | FinalizeOptions object"
    - "Boolean readiness probe — isRunning(name) thin wrapper over this.sessions.has(name)"
    - "Bounded-poll gate in HTTP handler (NOT in session-manager — session semantics stay pure)"
    - "Dual 503 paths: pre-dispatch JSON envelope + in-stream emitError envelope with agent_warming code"
key-files:
  created:
    - src/openai/__tests__/fixtures/sdk-stream-tool-use-terminal.json
  modified:
    - src/openai/translator.ts (+93 -9 lines)
    - src/openai/server.ts (+146 -16 lines)
    - src/openai/endpoint-bootstrap.ts (+5 -0 lines)
    - src/manager/session-manager.ts (+17 -0 lines)
    - src/openai/__tests__/translator.test.ts (+117 -0 lines)
    - src/openai/__tests__/server.test.ts (+378 -8 lines)
decisions:
  - "Preserve SSE-headers-immediately architecture — keepalive pings must fire during preFirstEventDelayMs; a Phase A/B refactor delaying SSE headers breaks the keepalive contract. The in-stream emitError envelope with agent_warming code is the right shape once headers are committed."
  - "Defense-in-depth warm-path guard: pre-dispatch waitForAgentReady is the primary gate (clean 503 JSON); defensive catches in runNonStreaming + runStreaming handle race-past-gate with the same agent_warming code."
  - "No retry loops inside SessionManager — isRunning is the only new API, 3 lines, no new state. Wait logic lives in the HTTP handler seam where it belongs."
  - "finalize() object-form arg is preferred; legacy positional string form kept for Plan 02 backward compat (all existing tests use that form)."
  - "When includeUsage:true but result event never fired → omit usage chunk rather than emit {0,0,0} (spec allows absence; zeros mislead token-cost UI)."
metrics:
  duration: ~35 min
  completed: 2026-04-19
  tasks: 3
  files_created: 1
  files_modified: 6
  tests_added: 17 (8 translator + 4 tool-call server + 5 warm-path server)
---

# Quick Task 260419-jtk: Harden OpenAI Streaming for OpenClaw End-to-End

Three post-v2.0 hardening fixes so OpenClaw agents running on clawdy can consume `/v1/chat/completions` as a drop-in OpenAI replacement under realistic conditions: usage-trailer parity, tool-call contract pin, and warm-path 503 instead of 500.

## Files Changed

| File | Delta | Purpose |
|------|-------|---------|
| `src/openai/translator.ts` | +93 -9 | `FinalizeOptions` type + `makeUsageChunk` helper + `finalize()` widened to object arg (legacy positional preserved) |
| `src/openai/server.ts` | +146 -16 | `agentIsRunning` config field + `waitForAgentReady` + `sendAgentWarming` + `isSessionNotRunningError` + `stream_options.include_usage` wiring through `runStreaming` + defensive catches in runNon/Streaming |
| `src/openai/endpoint-bootstrap.ts` | +5 | Wires `sessionManager.isRunning.bind(...)` into production server config |
| `src/manager/session-manager.ts` | +17 | New public `isRunning(name): boolean` — thin `this.sessions.has(name)` wrapper |
| `src/openai/__tests__/translator.test.ts` | +117 | 8 new usage-trailer unit tests (U1–U8) |
| `src/openai/__tests__/server.test.ts` | +378 -8 | bootHarness harness extensions + T1–T4 tool-call tests + W1–W5 warm-path tests + SessionError import |
| `src/openai/__tests__/fixtures/sdk-stream-tool-use-terminal.json` | +8 (new) | Realistic single-tool-call stream for T1–T4 |

**Total:** 773 insertions, 24 deletions across 7 files.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | `a47979e` | `feat(openai-stream): emit stream_options.include_usage trailing chunk` |
| Task 2 | `20e2f60` | `test(openai-stream): pin tool-call terminal + usage-trailer interop at server seam` |
| Task 3 | `18252fe` | `fix(openai-stream): bounded warm-path wait + 503 Retry-After on startup race` |

## Test Additions

**Translator (8 new — src/openai/__tests__/translator.test.ts):**
- U1: `finalize()` no-arg → 1 chunk (regression guard)
- U2: `finalize("stop")` positional → 1 chunk (backward compat)
- U3: `finalize({ includeUsage: false })` → 1 chunk
- U4: `finalize({ includeUsage: true })` on tool-use stream → 2 chunks, usage.prompt=20/completion=10/total=30
- U5: `finalize({ includeUsage: true })` on text stream → 2 chunks, usage.prompt=12/completion=3/total=15
- U6: `finalize({ includeUsage: true })` with no `result` event → 1 chunk only (omit usage rather than emit zeros)
- U7: `finalize({ finishReason: "length", includeUsage: true })` → terminal "length" + usage
- U8: terminal + usage chunks share id/object/model invariant

**Server tool-call (4 new — src/openai/__tests__/server.test.ts):**
- T1: realistic single tool_use sequence → `finish_reason:"tool_calls"` + delta shape contract (id on first, arguments-only on rest, concatenated JSON parses)
- T2: `stream_options.include_usage:true` on tool-call stream → terminal + usage trailer (choices:[], prompt=15/completion=5/total=20, same id)
- T3: no `stream_options` → no usage trailer
- T4: `stream_options.include_usage:false` explicit → no usage trailer

**Server warm-path (5 new — src/openai/__tests__/server.test.ts):**
- W1: agent already running → immediate dispatch, <500ms elapsed
- W2: agent never warms within budget → 503, `Retry-After: 2`, `code:"agent_warming"`, driver never invoked
- W3: agent flips ready mid-poll → dispatch succeeds, poll count bounded
- W4: no `agentIsRunning` config → wait gate skipped (Plan 02 hermetic harness preserved)
- W5: `SessionError not-running` thrown from driver on non-stream path → 503 `agent_warming` via defensive catch

**Total:** 17 net new tests.

## Verification Results

```
$ npx vitest run src/openai/__tests__/translator.test.ts src/openai/__tests__/server.test.ts src/manager/__tests__/session-manager.test.ts
Test Files  3 passed (3)
     Tests  113 passed (113)
     
$ npx vitest run src/openai/
Test Files  6 passed (6)
     Tests  164 passed (164)

$ npx tsc --noEmit  # src/openai/* + src/manager/session-manager.ts
(no errors)  # 45 pre-existing errors elsewhere (daemon.ts:128/665/2576, task-manager, usage, cli tests) — acceptance allows

$ npm run build
ESM ⚡️ Build success in 185ms
```

## Deviations from Plan

### Streaming runStreaming refactor — reverted from Phase A/B split

The plan proposed splitting `runStreaming` into Phase A (pre-SSE, JSON error surface) and Phase B (in-SSE, `emitError` surface) so a `SessionError not-running` thrown mid-stream could be mapped to a clean JSON 503.

**Issue discovered:** the existing "SSE keepalive when driver stalls" test (server.test.ts:513) relies on SSE headers being committed IMMEDIATELY so the keepalive timer can fire `: keepalive\n\n` comments during `preFirstEventDelayMs`. A Phase A/B split that delays `startOpenAiSse` until after the first event arrives breaks that contract — the test failed with `expected 0 to be greater than or equal to 1` keepalive count.

**Decision taken:** keep the existing SSE-open-immediately architecture. The **primary** warm-path guard is the pre-dispatch `waitForAgentReady` gate (runs BEFORE `runStreaming` — no SSE headers committed yet; 503 JSON works cleanly). The defensive catch in `runStreaming` now routes `SessionError not-running` to `handle.emitError` with the `agent_warming` code inside the standard in-stream OpenAI error envelope. Clients still get the retry signal; they just parse it from the SSE error frame rather than an HTTP 503 status. This is a documented trade-off in the `runStreaming` JSDoc.

Net effect: Task 3 done criteria still met — `SessionError not-running` never surfaces as plain `500 driver_error` to clients. The non-stream path (W5) uses the 503 JSON; the stream path uses the `agent_warming` code in-stream. Pre-dispatch gate covers the dominant case (stream or non-stream) before headers are committed.

### No other deviations

- No auto-fixed bugs discovered outside the task scope.
- No Rule 4 architectural changes triggered.
- No pre-existing `tsc` errors fixed (out of scope per constraints).
- No untracked files created outside the task scope.

## Deploy-after-Land Checklist

Status: **deferred to orchestrator**. Per task constraints: "Do NOT push to origin yet (orchestrator handles push + deploy)."

Pending orchestrator actions (from plan's `<verification>` block):
- [ ] `git push origin master`
- [ ] On clawdy: `cd /opt/clawcode && sudo -u clawcode git pull`
- [ ] `sudo -u clawcode npm ci`
- [ ] `npm run build` (as jjagpal — /opt/clawcode ownership note)
- [ ] `sudo systemctl restart clawcode`
- [ ] `journalctl -u clawcode -f` — verify clean boot

## Manual Smoke Tests

Status: **deferred** (user runs after deploy per plan). Pending outputs:
1. Post-deploy warm-path curl: `systemctl restart clawcode; curl -sS /v1/chat/completions ...` — expect 200 OR 503-with-Retry-After:2 (never 500).
2. Usage-trailer curl: `curl ... stream_options:{include_usage:true}` — expect final `data:` chunk before `[DONE]` to contain `"usage":{...}` and `"choices":[]`.

## Known Stubs

None. All behavior is fully wired end-to-end:
- `stream_options.include_usage` → `translator.finalize({ includeUsage })` → SSE emit
- Warm-path gate → `sessionManager.isRunning` via `endpoint-bootstrap.ts`
- Both 503 paths use the real `sendAgentWarming` helper with shared envelope + header.

## Self-Check: PASSED

**Files verified:**
- src/openai/translator.ts — FOUND (modified)
- src/openai/server.ts — FOUND (modified)
- src/openai/endpoint-bootstrap.ts — FOUND (modified)
- src/manager/session-manager.ts — FOUND (modified)
- src/openai/__tests__/translator.test.ts — FOUND (modified)
- src/openai/__tests__/server.test.ts — FOUND (modified)
- src/openai/__tests__/fixtures/sdk-stream-tool-use-terminal.json — FOUND (new)

**Commits verified:**
- a47979e — FOUND (Task 1 feat)
- 20e2f60 — FOUND (Task 2 test)
- 18252fe — FOUND (Task 3 fix)

**Automated verification verified:**
- 113/113 tests pass across translator + server + session-manager suites
- 164/164 tests pass across all src/openai/ suites (zero regressions)
- Zero new tsc errors in src/openai/ or src/manager/session-manager.ts
- `npm run build` succeeds (ESM bundle 981 KB)
