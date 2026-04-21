---
phase: 73-openclaw-endpoint-latency
plan: 03
subsystem: openai
tags: [latency, tracing, ttfb, prompt-cache-regression, e2e-smoke, LAT-03, LAT-05]
requirements: [LAT-03, LAT-05]
dependency_graph:
  requires:
    - "src/manager/persistent-session-handle.ts (Plan 01) — createPersistentSessionHandle that propagates SDK cache telemetry unchanged across turns"
    - "src/performance/trace-collector.ts — Turn.startSpan + Span.setMetadata + Span.end (idempotent close) primitives"
    - "src/openai/driver.ts runDispatch — Turn lifecycle, onChunk callback, dispatchPromise settle, onAbort handler (pre-existing)"
    - "Node.js 22 native fetch + ReadableStream + parseArgs (node:util) — zero-dep E2E smoke foundation"
  provides:
    - "openai.chat_completion trace span — ttfb_ms + total_turn_ms + error metadata on every dispatch"
    - "LAT-05 regression contract test — persistent handle does not swallow cache telemetry across turns"
    - "scripts/smoke-openai-latency.mjs — zero-dep operator one-liner for post-deploy TTFB validation"
  affects:
    - "src/openai/driver.ts runDispatch — new span opened after Turn creation; endChatSpanOnce wired into success, rejection, and abort paths"
    - "No behavior change for Discord — driver.ts is OpenAI-only; TurnDispatcher signature untouched"
tech-stack:
  added: []  # zero new dependencies
  patterns:
    - "Sibling span pattern — openai.chat_completion lives beside end_to_end + first_token (session-adapter) for driver-vs-adapter divergence analysis"
    - "Idempotent close guard via chatSpanEnded boolean — mirrors turnEnded (Pitfall 8 from 73-RESEARCH.md)"
    - "TTFB captured at FIRST onChunk invocation via firstDeltaMs guard (undefined → stamp once)"
    - "Zero-dep Node ESM smoke — parseArgs + native fetch + ReadableStream reader; distinct exit codes for infra-skip vs assertion-fail"
key-files:
  created:
    - "src/manager/__tests__/persistent-session-cache.test.ts (229 LOC, 1 integration test)"
    - "scripts/smoke-openai-latency.mjs (150 LOC, zero-dep E2E smoke)"
    - ".planning/phases/73-openclaw-endpoint-latency/73-03-SUMMARY.md (this file)"
  modified:
    - "src/openai/driver.ts — 375 → 433 LOC (+58). Adds dispatchStartMs + firstDeltaMs + chatSpan + endChatSpanOnce. Wires span-close into dispatch-promise settle (success + reject) and onAbort."
    - "src/openai/__tests__/driver.test.ts — 572 → 783 LOC (+211). Adds SpanEntry recorder + makeTurn.startSpan mock; 4 new tests under \"openai.chat_completion span (LAT-03)\"."
decisions:
  - "Span metadata schema: { agent, keyHashPrefix, xRequestId, stream:true, tools } at open; { ttfb_ms, total_turn_ms, error? } merged at close. Mirrors Phase 55's cache-hit-duration_ms enrichment pattern — setMetadata before end() is load-bearing for the one-write-per-span trace contract."
  - "ttfb_ms captured at FIRST onChunk invocation (the `accumulated: string` callback TurnDispatcher fires per text delta). This is driver-level TTFB; session-adapter's first_token span measures SDK-level TTFB. Divergence between the two = driver-queue overhead."
  - "ttfb_ms is null (not 0) when no delta fired before terminal settle — distinguishes 'never-started-streaming' from 'streamed-zero-ms'. Error-path tests assert this explicitly on the pure-reject branch (dispatchStream throws before any onChunk)."
  - "chatSpanEnded idempotent guard mirrors turnEnded (driver.ts pre-existing pattern). Abort path and dispatch-promise settle may BOTH call endChatSpanOnce; second call is silent no-op so metadata captured at first call is preserved."
  - "Cache-telemetry test uses a self-contained fake SDK with a pushable AsyncIterator (no imports outside node: + manager/). Turn 1 emits cache_creation_input_tokens=80 (first-turn cache build); Turn 2 emits cache_read_input_tokens=80 (stable-prefix warm cache hit). Asserts (1) usageCallback fires twice, (2) sdk.query called exactly ONCE across both turns (LAT-01 regression proof), (3) turn-2 result carries cache_read_input_tokens > 0 through the handle unchanged."
  - "Smoke script exit codes — 0/1/2 for success/regression/infra-skip. Separate codes let CI or operator tooling distinguish 'budget missed' from 'daemon down' from 'missing key'. Matches the pattern established by scripts/search-smoke.mjs + scripts/browser-smoke.mjs + scripts/image-smoke.mjs."
  - "Smoke script default budget 2000ms — LAT-01's sub-2s TTFB goal. Operators can override via --ttfb-budget-ms to set tighter (regression-detection) or looser (cold-boot) thresholds without editing source."
  - "Smoke uses native fetch + ReadableStream (Node 22). NOT curl subprocess — keeps the script self-contained, portable, and lets us measure TTFB on the exact byte boundary (first content-delta frame) rather than first TCP byte."
metrics:
  duration_minutes: 8
  tasks_completed: 3
  commits: 4  # 3 task commits + 1 tsc-fix commit
  new_tests: 5  # 4 driver span + 1 cache integration
  new_loc: 379  # driver.ts delta 58 + driver.test.ts delta 211 + cache.test.ts 229 + smoke 150 − driver.test.ts mock-turn delta ~40 already counted; net ≈ 58 + 211 + 229 + 150 − 269 (offset for pre-existing infra)
  completed_date: 2026-04-19
---

# Phase 73 Plan 03: TTFB span + cache regression test + E2E smoke — Summary

> Instrumented the OpenAI endpoint with a dedicated `openai.chat_completion`
> trace span carrying `ttfb_ms` + `total_turn_ms` (LAT-03), pinned the v1.7
> prompt-cache non-regression contract on the persistent session handle via
> a 2-turn integration test (LAT-05), and shipped a zero-dep Node 22 ESM
> smoke script for post-deploy TTFB validation on clawdy.

## What Was Built

### Task 1 — `openai.chat_completion` span (LAT-03)

**Modified: `src/openai/driver.ts` (+58 LOC, 375 → 433)**

- Capture `dispatchStartMs = Date.now()` at dispatch entry (after Turn creation).
- Open `chatSpan = turn.startSpan("openai.chat_completion", { agent, keyHashPrefix, xRequestId, stream:true, tools })` — metadata set at open; any later span lookup sees the bucket before close.
- Add `firstDeltaMs: number | undefined` — stamped once at the FIRST `onChunk` invocation via an idempotent guard.
- Add `chatSpanEnded: boolean` + `endChatSpanOnce(metadata)` — mirrors the existing `turnEnded` + `endTurnOnce` pattern. Pitfall 8 guard from 73-RESEARCH.md: success + abort paths may both call close; second call is silent no-op.
- Wire `endChatSpanOnce` into:
  - `dispatchPromise.then` (success) — `{ ttfb_ms, total_turn_ms }`
  - `dispatchPromise.catch` (rejection) — `{ ttfb_ms, total_turn_ms, error:true }`
  - `onAbort` (client disconnect) — `{ ttfb_ms, total_turn_ms, error:true }`
- Graceful degrade when `traceCollectorFor` returns `null` — no Turn, no span; all `chatSpan?.…` calls no-op via optional chaining.

**Modified: `src/openai/__tests__/driver.test.ts` (+211 LOC)**

- New `SpanEntry` recorder type + `events.spanCalls` array + `makeTurn.startSpan` mock — captures name, initial metadata, every `setMetadata` delta, and `end()` invocation count.
- 4 new tests under `describe("openai.chat_completion span (LAT-03)")`:
  1. `successful dispatch produces span with ttfb_ms + total_turn_ms` — asserts initial metadata shape (agent, keyHashPrefix="abcdef01" from 8-hex slice, xRequestId, stream:true, tools:1) AND close-time metadata delta (ttfb_ms + total_turn_ms are numbers ≥ 0, no error field). Span ends exactly once.
  2. `aborted dispatch produces span with error:true and finite total_turn_ms` — never-emit dispatch + client abort → asserts at least one setMetadata carries error:true + finite total_turn_ms. end called exactly once (idempotent guard).
  3. `dispatch-promise rejection produces span with error:true + total_turn_ms` — throwing dispatchStream → single setMetadata with error:true, total_turn_ms (number), ttfb_ms (null — no delta fired). end called once.
  4. `no span opened when traceCollectorFor returns null` — asserts request still completes end-to-end, zero spans recorded, zero Turns opened.

**Commit:** `00aa294` — `feat(73-03): openai.chat_completion span with ttfb_ms + total_turn_ms (LAT-03)`

### Task 2 — LAT-05 persistent-session cache regression test

**Created: `src/manager/__tests__/persistent-session-cache.test.ts` (229 LOC, 1 test)**

- Self-contained `buildFakeSdk(turnOutputs)` helper — pushable AsyncIterator that drives the persistent handle's prompt iterable in the background, yielding the next canned turn's messages whenever a user message arrives. `getYielded()` exposes every message the handle observed for test assertions.
- Single integration test: `turn 2 result carries cache_read_input_tokens from the SDK`. Drives 2 sequential `sendAndStream` calls through `createPersistentSessionHandle`:
  - **Turn 1** result: `cache_creation_input_tokens=80`, `cache_read_input_tokens=0` — first turn builds the cache.
  - **Turn 2** result: `cache_read_input_tokens=80`, `cache_creation_input_tokens=0` — stable prefix warm in Anthropic's cache.
- Three contracts asserted:
  1. `usageCallback` fires exactly twice with tokens_in=100 each turn.
  2. `sdk.query` invoked exactly ONCE (persistent-handle invariant from Plan 01).
  3. Turn 2 result's `cache_read_input_tokens > 0` — LAT-05 contract that the handle propagates cache telemetry without mangling.

**Commit:** `5415f1c` — `test(73-03): LAT-05 persistent-session cache-telemetry contract`

### Task 3 — Zero-dep E2E TTFB smoke script

**Created: `scripts/smoke-openai-latency.mjs` (150 LOC, executable)**

- Zero npm deps — `node:util` parseArgs + native fetch + ReadableStream reader.
- CLI: `--agent <name>` (default `test-agent`), `--key <bearer>` (default `$CLAWCODE_OPENAI_KEY`), `--host <url>` (default `http://127.0.0.1:3100`), `--ttfb-budget-ms <n>` (default 2000).
- Sends 2 sequential POST `/v1/chat/completions` requests, both `stream:true`, both with the same bearer key + agent → second request exercises the warmed persistent subprocess (Plan 01).
- Per request: TTFB = first SSE `data:` frame carrying a non-empty `choices[0].delta.content` minus request-start epoch. Total duration = request-start to response-done.
- Exit codes (distinguish operational surface):
  - `0` — turn 2 TTFB within budget (success).
  - `1` — turn 2 TTFB exceeded budget OR hard HTTP failure.
  - `2` — infra skip: daemon unreachable (ECONNREFUSED / ENOTFOUND), HTTP 401/403, bearer key missing.
- Output is plain text to stdout; assertion-fail prints a hint toward `clawcode trace percentiles --span openai.chat_completion` for Plan 03's span.

**Verify** (the plan's automated check):
```
node --check scripts/smoke-openai-latency.mjs && \
  CLAWCODE_OPENAI_KEY='' node scripts/smoke-openai-latency.mjs 2>&1 | grep -q 'SKIP:'
```
Both pass — syntax valid, exit 2 + `SKIP:` diagnostic on missing key without a live daemon.

**Commit:** `aea8436` — `feat(73-03): zero-dep E2E TTFB smoke script for /v1/chat/completions`

### Task 1.5 — Tsc non-regression fix

**Modified: `src/openai/__tests__/driver.test.ts` (−1 line)** — initial Task 1 test fixture used the OpenAI tool-def shape (`{type:"function", parameters}`) on what is actually a `ClaudeToolDef` field (`{name, description, input_schema}`). Fixture replaced; driver only reads `input.tools?.length` so the metadata-path test is unaffected. Restored tsc error count from 30 → 29 baseline.

**Commit:** `4914813` — `fix(73-03): use ClaudeToolDef shape in new driver test fixture`

## Span Metadata Schema (LAT-03)

Open-time (at dispatch entry, `turn.startSpan`):
```
{
  agent: string,
  keyHashPrefix: string,      // first 8 hex chars of bearer-key hash
  xRequestId: string,
  stream: boolean,            // always true at current driver (SSE-only)
  tools: number,              // input.tools?.length ?? 0
}
```

Close-time (merged via `chatSpan.setMetadata` before `.end()`):
```
{
  ttfb_ms: number | null,     // firstDeltaMs - dispatchStartMs; null if no delta fired
  total_turn_ms: number,      // Date.now() - dispatchStartMs at settle
  error?: true,               // present on reject + abort paths
}
```

## Span Relationship Table

| Span                     | Layer          | Opens at                          | Closes at                            | Purpose                                |
|--------------------------|----------------|-----------------------------------|--------------------------------------|----------------------------------------|
| `end_to_end`             | session-adapter| iterateUntilResult start          | `result` message observed            | Full SDK-iteration lifecycle per turn  |
| `first_token`            | session-adapter| iterateUntilResult start          | FIRST text content block observed    | SDK-level time-to-first-token          |
| `context_assemble`       | context-assembler| prefix assembly start           | prefix build complete                | Prefix assembly cost                   |
| `tool_call.<name>`       | session-adapter| `tool_use` assistant block        | matching `tool_result` user block    | Per-tool-call duration                 |
| **`openai.chat_completion`** (NEW) | **driver**     | **dispatch entry (post Turn)**    | **dispatch-promise settle / abort**  | **Driver-level total + TTFB**          |

Divergence between `first_token` (adapter) and `ttfb_ms` (driver) surfaces the driver-queue / TurnDispatcher overhead. In production both should track within ~20ms; sustained >50ms divergence is a signal to investigate the TurnDispatcher path.

## Smoke Script Contract

| Aspect            | Value                                                                |
|-------------------|----------------------------------------------------------------------|
| Path              | `scripts/smoke-openai-latency.mjs`                                   |
| Dependencies      | Zero npm (Node 22 native fetch + ReadableStream + node:util)         |
| Executable        | `chmod +x` applied; shebang `#!/usr/bin/env node`                    |
| Args              | `--agent` `--key` `--host` `--ttfb-budget-ms`                        |
| Env key           | `CLAWCODE_OPENAI_KEY`                                                |
| Default budget    | 2000ms (turn 2 TTFB)                                                 |
| Exit 0            | turn 2 TTFB within budget                                            |
| Exit 1            | turn 2 TTFB exceeded budget OR hard HTTP failure                     |
| Exit 2            | infra skip: daemon down, auth rejected, bearer key missing           |
| Output            | Plain text; 3 lines (header + turn 1 + turn 2) + final OK/FAIL/SKIP  |

**Retirement / CI-promotion path:** once Phase 73 goals stabilize on clawdy (~2 weeks of green daily smoke from operator ops), consider:
- Promoting to a scheduled clawdy cron (hourly run, alert on non-zero exit).
- Lifting into CI gated on a mock-daemon fixture (requires test infra for streaming SSE from the vitest harness — non-trivial).
- Retiring if the vitest `openai.chat_completion` span assertions in Plan 03 Task 1 + v1.7 cache regression tests prove sufficient in practice.

## Phase-Wide Must-Haves Verification

Cross-reference of phase requirements → plan coverage:

| Requirement | Covered by       | Evidence                                                                 |
|-------------|------------------|--------------------------------------------------------------------------|
| LAT-01      | Plan 01          | `persistent-session-handle.test.ts` (8 tests) — 1-query invariant, N turns |
| LAT-02      | Plan 02          | `conversation-brief-cache.test.ts` (11 tests) + `session-config.test.ts` (4 new) |
| **LAT-03**  | **Plan 03**      | `driver.test.ts` (4 new span tests) — ttfb_ms + total_turn_ms metadata   |
| LAT-04      | Plan 02          | `endpoint-bootstrap.test.ts` (11 tests) + `server.test.ts` (2 new)        |
| **LAT-05**  | **Plan 01 + 03** | Plan 01's handle propagates SDK cache fields; Plan 03 pins the contract via `persistent-session-cache.test.ts` |

Phase 73 requirements — all 5 — covered by automated tests. The E2E smoke script is the post-deploy operator validation of LAT-01 + LAT-03 together (sub-2s TTFB observable from a real client against a live daemon).

## Test Coverage Delta

| File                                                              | New tests | Total tests | Assertion target                              |
|-------------------------------------------------------------------|-----------|-------------|-----------------------------------------------|
| `src/openai/__tests__/driver.test.ts`                             | 4         | 18          | openai.chat_completion span lifecycle         |
| `src/manager/__tests__/persistent-session-cache.test.ts` (new)    | 1         | 1           | LAT-05 cache-telemetry contract               |
| **Plan 73-03 total**                                              | **5**     | —           | —                                             |

**Full suite:** 3026 pass / 7 pre-existing failures (all in `daemon-openai.test.ts` — startup-mocking tests unrelated to Phase 73; confirmed pre-existing via 73-01 + 73-02 summaries).

**`npx tsc --noEmit`:** 29 errors (baseline unchanged vs 73-02 — zero new errors from Plan 03 code).

**`npm run build`:** ESM `dist/cli/index.js` built in 209ms (success).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Wrong tool-def shape in initial Task 1 fixture**

- **Found during:** tsc --noEmit after Task 3 commit.
- **Issue:** First draft of the new span test passed `{type:"function", parameters:{...}}` to the driver — the OpenAI wire shape. But `DispatchInput.tools` is typed `ClaudeToolDef[]` (`{name, description, input_schema}`), introducing one new tsc error beyond baseline.
- **Fix:** Replaced with the Claude-native shape. Driver only reads `input.tools?.length`, so the metadata assertion (`tools: 1`) is unchanged.
- **Files modified:** `src/openai/__tests__/driver.test.ts`
- **Commit:** `4914813` (separate fix commit, not amended — per CLAUDE.md git workflow).

### Non-Auto-Fix Deviations

None. Plan 03 executed exactly as written otherwise. Span metadata shape, close-guard pattern, cache-test contracts, smoke-script exit codes — all match the plan's `<action>` blocks verbatim.

No architectural changes, no new dependencies, no TurnDispatcher surface drift, no Discord path regression.

## Deferred / Out of Scope

- **`reasoning_effort` / `temperature` / `max_tokens` / `stop` / `response_format` translator wiring** — explicitly deferred per 73-CONTEXT.md Deferred Ideas. A follow-up phase will plumb these through `Query.setMaxThinkingTokens` + `setModel` on the persistent generator (SDK primitives available — see 73-RESEARCH.md Pattern 1).
- **`usage:{0,0,0}` gap in non-stream OpenAI response** — separate pre-existing bug; touches the same area but different concern.
- **Push-based readiness signal** — defer if even the tuned 300ms wait shows up as a hot spot after Plan 02's change lands on clawdy.
- **Promote smoke to CI** — requires a mock-daemon fixture with streaming SSE; the vitest `openai.chat_completion` span coverage + LAT-05 contract test in this plan arguably cover the same ground without a live-daemon dependency.

## Integration Points for Post-Deploy

### Operator runbook (clawdy)

```bash
# 1. Deploy
ssh clawdy 'cd /opt/clawcode && git pull && sudo -u clawcode npm ci && \
  sudo -u clawcode npm run build && sudo systemctl restart clawcode'

# 2. Smoke turn-2 TTFB against a warm agent (test-agent is a common fixture)
ssh clawdy 'CLAWCODE_OPENAI_KEY=$(cat ~/.clawcode/openai-key) \
  node /opt/clawcode/scripts/smoke-openai-latency.mjs --agent test-agent'
# Expected: OK: turn 2 TTFB <NNN>ms < budget 2000ms.

# 3. Pull percentiles for the new span
ssh clawdy 'clawcode trace percentiles --span openai.chat_completion'
```

### Rollback path

Each plan 01/02/03 is an atomic set of commits; `git revert <commit-range>` backs out the whole phase. Rollback DOES NOT require a DB migration — Plan 01's persistent-subprocess refactor reads the same Claude CLI session JSONL files whether `sdk.query()` is per-turn or long-lived.

## Self-Check: PASSED

- `src/openai/driver.ts` FOUND — modifications applied (433 LOC, ≤500 budget)
- `src/openai/__tests__/driver.test.ts` FOUND — 18 tests (14 prior + 4 new) all green
- `src/manager/__tests__/persistent-session-cache.test.ts` FOUND (229 LOC, 1 test green)
- `scripts/smoke-openai-latency.mjs` FOUND (150 LOC, executable, `node --check` clean, SKIP on empty key works)
- Commits in `git log`:
  - `00aa294` feat(73-03): openai.chat_completion span with ttfb_ms + total_turn_ms (LAT-03)
  - `5415f1c` test(73-03): LAT-05 persistent-session cache-telemetry contract
  - `aea8436` feat(73-03): zero-dep E2E TTFB smoke script for /v1/chat/completions
  - `4914813` fix(73-03): use ClaudeToolDef shape in new driver test fixture
- `npx vitest run src/openai/__tests__/driver.test.ts`: 18 pass
- `npx vitest run src/openai/`: 181 pass
- `npx vitest run src/manager/__tests__/persistent-session-cache.test.ts`: 1 pass
- `npx vitest run`: 3026 pass / 7 pre-existing failures (baseline 7, no new failures introduced)
- `npx tsc --noEmit`: 29 errors (baseline unchanged — zero new)
- `npm run build`: ESM `dist/cli/index.js` built in 209ms
- `grep -c "openai\.chat_completion" src/openai/driver.ts`: 2 (≥ 1 required)
- `grep -c "ttfb_ms" src/openai/driver.ts`: 4 (≥ 3 required)
- `grep -c "total_turn_ms" src/openai/driver.ts`: 3 (≥ 3 required)
- `grep -c "firstDeltaMs" src/openai/driver.ts`: 7 (≥ 4 required)
- `grep -c "chatSpanEnded\|endChatSpanOnce" src/openai/driver.ts`: 8 (≥ 4 required)
- `grep -c "cache_read_input_tokens" src/manager/__tests__/persistent-session-cache.test.ts`: 9 (≥ 2 required)
- `grep -c "cache_creation_input_tokens" src/manager/__tests__/persistent-session-cache.test.ts`: 6 (≥ 2 required)
- `grep -c "toHaveBeenCalledTimes(1)" src/manager/__tests__/persistent-session-cache.test.ts`: 1 (≥ 1 required)
- `grep -c "parseArgs" scripts/smoke-openai-latency.mjs`: 2 (≥ 1 required)
- `grep -c "stream: true" scripts/smoke-openai-latency.mjs`: 2 (≥ 1 required)
- `grep -c "ECONNREFUSED\|exit(2" scripts/smoke-openai-latency.mjs`: 4 (≥ 2 required)
- `grep -c "TTFB_BUDGET_MS\|ttfb_budget_ms" scripts/smoke-openai-latency.mjs`: 5 (≥ 2 required)
- `node --check scripts/smoke-openai-latency.mjs`: exit 0
- `CLAWCODE_OPENAI_KEY='' node scripts/smoke-openai-latency.mjs`: exit 2 + `SKIP:` message (validated manually)
