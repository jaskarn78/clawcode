---
phase: 69-openai-compatible-endpoint
plan: 02
subsystem: openai-endpoint-core
tags: [openai-api, http-server, sse, tool-use-translation, wave-2, node-http, zod-v4, wave-2]

requires:
  - phase: 69-openai-compatible-endpoint
    provides: "openaiEndpointSchema, ApiKeysStore, SOURCE_KINDS extension"

provides:
  - "src/openai/types.ts — Zod v4 request schema + TS types for OpenAI wire format + Claude intermediate types + minimal SdkStreamEvent shape"
  - "src/openai/translator.ts — pure-function bidirectional OpenAI<->Claude translator; createStreamingTranslator with Map<tool_use_id, openaiIndex> accumulator (Pitfall 1) and firstDeltaSent role primer (Pitfall 3); translateRequest emits clientSystemAppend for systemPrompt.append — NEVER override (Pitfall 8)"
  - "src/openai/stream.ts — startOpenAiSse writer with keepalive + backpressure drain + [DONE] terminator (Pitfall 4) + X-Accel-Buffering (Pitfall 5) + onClose hook + graceful close (Pitfall 10)"
  - "src/openai/server.ts — startOpenAiServer on node:http; routes OPTIONS + GET /v1/models + POST /v1/chat/completions + 404; full CORS; bearer auth via injected ApiKeysStore; fully DI — zero imports from src/manager/, src/memory/, src/config/"
  - "OpenAiSessionDriver interface — contract Plan 03's SessionManager-backed driver implements"
  - "Fixture pair: sdk-stream-text.json + sdk-stream-tool-use.json for fixture-driven translator/stream/server tests"

affects:
  - "Plan 03 (daemon integration + CLI + E2E smoke) — consumes OpenAiSessionDriver contract, wires startOpenAiServer into daemon boot sequence, and adds the Python openai SDK smoke test"

tech-stack:
  added: []
  patterns:
    - "Pure-function translator with injected state factory (createStreamingTranslator) — streaming translation separated from I/O so tests replay fixtures"
    - "Map<tool_use_id, openaiIndex> + Map<sdkBlockIndex, openaiIndex> dual-indexing for streamed tool-call accumulation — Pitfall 1 guard"
    - "Set<OpenAiSseHandle> activeStreams on server handle — Pitfall 10 graceful-shutdown loop (close each BEFORE server.close())"
    - "DI-first server: all external state (ApiKeysStore, driver, agentNames) passed via config — server module has zero imports from src/manager/, src/memory/, src/config/"
    - "Both req.on('close') AND res.on('close') wired to the same AbortController — robust to Node.js event-ordering differences on SSE connections"

key-files:
  created:
    - src/openai/types.ts
    - src/openai/translator.ts
    - src/openai/stream.ts
    - src/openai/server.ts
    - src/openai/__tests__/translator.test.ts
    - src/openai/__tests__/stream.test.ts
    - src/openai/__tests__/server.test.ts
    - src/openai/__tests__/fixtures/sdk-stream-text.json
    - src/openai/__tests__/fixtures/sdk-stream-tool-use.json
  modified: []

key-decisions:
  - "OpenAiSessionDriver is a new interface on the translator/server side, NOT a SessionAdapter extension. Plan 03 writes the real driver; Plan 02 tests pass a fixture-driven mock. Keeps server.ts hermetic from src/manager/."
  - "createStreamingTranslator maintains TWO maps: Map<tool_use_id, openaiIndex> (Pitfall 1 primary) + Map<sdkBlockIndex, openaiIndex> (so input_json_delta can route to correct openai index using the SDK's block index, which is what the SDK actually emits)."
  - "Mock driver in server.test.ts uses event listener on signal.abort (not just in-loop polling) so lastAborted is set deterministically even when the consumer bails out mid-stream and generator.return() short-circuits the loop."
  - "Client disconnect test uses node:http directly rather than fetch/undici — undici may not close TCP sockets promptly on AbortController, making req.on('close') timing flakey; http.request + explicit socket destroy is deterministic."
  - "Body-too-large guard pauses the stream (req.pause()) but does NOT destroy the socket — caller needs a live response to send the 413 error body. Letting req.destroy() run inside readBody left the fetch client hanging with SocketError."
  - "Both req.on('close') AND res.on('close') wired to ac.abort() — for SSE responses res.writableEnded stays false throughout streaming, and either req or res can emit 'close' first depending on Node version; wiring both is the robust path."

patterns-established:
  - "Pattern: Pure translator + stateful factory — src/openai/translator.ts exports only pure functions plus one stateful factory (createStreamingTranslator); server.ts reaches into the factory once per turn."
  - "Pattern: DI-only boundary modules — src/openai/server.ts gets ApiKeysStore, OpenAiSessionDriver, agentNames via config. Plan 03 wires the real impls; Plan 02 unit-tests with :memory: + mocks."
  - "Pattern: SSE framing = stream.ts's job, chunk shape = translator.ts's job — complete separation so stream.ts can be unit-tested without a translator and translator can be unit-tested without a socket."
  - "Pattern: Fixture-driven replay tests — recorded SDK events in JSON, fed to translator for deterministic chunk-shape assertions (Pitfall 7 mitigation: SDK version drift caught by fixture diff)."

requirements-completed: [OPENAI-01, OPENAI-02, OPENAI-03, OPENAI-06]

duration: 24 min
completed: 2026-04-18
---

# Phase 69 Plan 02: OpenAI HTTP Surface Summary

**Landed the OpenAI-compatible HTTP server on `node:http` — `POST /v1/chat/completions` (JSON + SSE) and `GET /v1/models` — with pure-function bidirectional OpenAI<->Claude translator (Map<tool_use_id, openaiIndex> accumulator), SSE writer with keepalive + backpressure + `[DONE]` terminator, and full bearer-auth delegation to Plan 01's ApiKeysStore. Zero imports from src/manager/, src/memory/, src/config/ — fully testable in vitest with mock driver.**

## Performance

- **Duration:** 24 min
- **Started:** 2026-04-18T23:26:05Z
- **Completed:** 2026-04-18T23:49:38Z
- **Tasks:** 4
- **Files created:** 9 (types, translator, stream, server + 3 tests + 2 fixtures)
- **Tests added:** 87 (46 translator + 15 stream + 26 server + fixture validation)

## Accomplishments

- Four core modules that together form the executable core of Phase 69: types, translator, SSE writer, HTTP server.
- Pure-function bidirectional OpenAI↔Claude translation with Pitfalls 1/2/3/8 guarded by explicit test cases (20 unit tests specifically for the translator-stream state machine).
- SSE writer honors backpressure (`drain` wait), X-Accel-Buffering (Pitfall 5), `[DONE]` terminator with double-newline (Pitfall 4), and graceful close for shutdown (Pitfall 10).
- Full node:http server with OpenAI-shape errors (Pitfall 2), Content-Type charset tolerance (Pitfall 9), bearer key extraction + model pinning (403 never leaks agent name), X-Request-Id echo/generate, CORS on all responses.
- 122 tests across the src/openai suite — all green. No failures; no regressions in unrelated subsystems caused by this plan.

## Task Commits

Each task was committed atomically:

1. **Task 1: types.ts + fixtures** — `f07d1aa` (feat)
2. **Task 2: translator.ts + translator.test.ts** — `640250f` (feat)
3. **Task 3: stream.ts + stream.test.ts** — `4d992fc` (feat)
4. **Task 4: server.ts + server.test.ts** — `31a6947` (feat)

## Public API Contracts

### translator.ts exports

```typescript
// Pure translators
export function translateRequest(body: ChatCompletionRequest): TranslatedRequest;
// TranslatedRequest: { lastUserMessage, clientSystemAppend, tools, toolChoice, toolResults }
export function translateToolResult(msg: { tool_call_id; content }): ClaudeToolResultBlock;
export function translateClaudeToolUseToOpenAi(block): ChatCompletionToolCall;

// Response builders
export function makeNonStreamResponse(params): ChatCompletionResponse;
export function makeChunk(params): ChatCompletionChunk;
export function newChatCompletionId(): string;               // "chatcmpl-<nanoid(16)>"
export function deriveUsage(claude): { prompt_tokens; completion_tokens; total_tokens };

// Stateful streaming factory
export function createStreamingTranslator({ id, model }): StreamingTranslator;

export interface StreamingTranslator {
  onEvent(event: SdkStreamEvent): ChatCompletionChunk[];
  finalize(finishReason?: "stop" | "tool_calls" | "length"): ChatCompletionChunk[];
  readonly hadToolUse: boolean;
  readonly collectedText: string;
  readonly collectedToolCalls: ReadonlyArray<ChatCompletionToolCall>;
  readonly usage: ClaudeUsage | undefined;
}

export class NoUserMessageError extends Error {}
```

The `Map<tool_use_id, openaiIndex>` assigns sequential openai indices (0, 1, 2, ...) in order-of-first-sighting of `content_block_start` events for `tool_use` blocks. A second `Map<sdkBlockIndex, openaiIndex>` routes subsequent `input_json_delta` events (keyed by SDK block index) to the correct openai index — this is Pitfall 1's exact mechanical guard.

### stream.ts exports

```typescript
export function startOpenAiSse(
  res: ServerResponse,
  opts: { keepaliveMs: number },
): OpenAiSseHandle;

export interface OpenAiSseHandle {
  emit(chunk: ChatCompletionChunk): Promise<boolean>;   // awaits 'drain'
  emitDone(): void;                                     // writes 'data: [DONE]\n\n' + end
  emitError(err: OpenAiError): void;                     // writes err frame + [DONE]
  onClose(cb: () => void): void;                         // registers close/error handler
  close(): void;                                         // graceful shutdown
}
```

SSE headers written once on construction:

- `Content-Type: text/event-stream`
- `Cache-Control: no-cache, no-transform`
- `Connection: keep-alive`
- `X-Accel-Buffering: no`          (Pitfall 5 — nginx buffering kill)

Keepalive fires every `keepaliveMs` while `firstDeltaSent === false`; clears on first emit, emitDone, emitError, or close. Timer is `unref()`-ed so it can never keep the Node event loop alive.

`[DONE]` terminator is the literal bytes `data: [DONE]\n\n` (Pitfall 4 — double newline mandatory).

### server.ts exports

```typescript
export function startOpenAiServer(config: OpenAiServerConfig): Promise<OpenAiServerHandle>;

export interface OpenAiServerConfig {
  port: number;
  host: string;
  maxRequestBodyBytes: number;
  streamKeepaliveMs: number;
  apiKeysStore: ApiKeysStore;              // from Plan 01
  driver: OpenAiSessionDriver;             // Plan 03 provides real impl
  agentNames: () => ReadonlyArray<string>;
  log?: pino.Logger;
}

export interface OpenAiServerHandle {
  readonly server: ReturnType<typeof createServer>;
  readonly activeStreams: Set<OpenAiSseHandle>;
  readonly address: { port: number; host: string };
  close(): Promise<void>;                   // closes activeStreams BEFORE server.close() (Pitfall 10)
}

export interface OpenAiSessionDriver {
  dispatch(input: {
    agentName: string;
    keyHash: string;
    lastUserMessage: string;
    clientSystemAppend: string | null;
    tools: ClaudeToolDef[] | null;
    toolChoice: ClaudeToolChoice | null;
    toolResults: ClaudeToolResultBlock[];
    signal: AbortSignal;
    xRequestId: string;
  }): AsyncIterable<SdkStreamEvent>;
}

export function buildOpenAiError(status, type, message, code?): { status; body: OpenAiError };
```

#### Routing Table

| Method | Path | Auth | Response |
| --- | --- | --- | --- |
| `OPTIONS` | `*` | none | 204 + CORS preflight headers |
| `GET`  | `/v1/models` | **none** (public fleet listing) | `{object:"list", data:[...]}` — top-level agents only, sub/thread excluded, `owned_by: "clawcode"` |
| `POST` | `/v1/chat/completions` | `Authorization: Bearer <key>` | JSON or SSE (per `stream` field); 401 missing/invalid, 403 agent mismatch (no agent name leak), 400 body/validation, 413 too large, 500 driver error |
| `*`    | `*` | — | 404 OpenAI-shape `{error:{type:"not_found_error", code:"route_not_found"}}` |

#### CORS Headers (every response)

- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET, POST, OPTIONS`
- `Access-Control-Allow-Headers: authorization, content-type, x-request-id`
- `Access-Control-Expose-Headers: x-request-id`

#### Error Shape (every 4xx/5xx body)

```json
{
  "error": {
    "message": "human-readable",
    "type": "invalid_request_error | authentication_error | permission_error | not_found_error | server_error | rate_limit_exceeded",
    "code": "optional_machine_code_or_null"
  }
}
```

## Pitfall Coverage

| Pitfall | Guarded by | Test |
|---------|-----------|------|
| 1 (partial-JSON across parallel tool calls) | `Map<tool_use_id, openaiIndex>` + `Map<sdkBlockIndex, openaiIndex>` in createStreamingTranslator | `translator.test.ts` "interleaved deltas across indices preserve per-index correctness", "re-ordered starts" |
| 2 (strict OpenAI SDK fields) | TS types mark all required fields; `makeNonStreamResponse` emits present-but-null logprobs/system_fingerprint; `deriveUsage` defaults missing to 0 | `translator.test.ts` "created is seconds", "system_fingerprint null", "content null when tool_calls + empty text" |
| 3 (role on non-first chunk) | `firstDeltaSent` flag + `maybeEmitRolePrimer` single-shot | `translator.test.ts` "first chunk carries role exactly once", `server.test.ts` streaming |
| 4 (missing `\n\n` SSE delimiter) | stream.ts always writes `data: ${json}\n\n` | `stream.test.ts` "emit writes data: <json>\\n\\n format exactly" |
| 5 (nginx buffering) | stream.ts writes `X-Accel-Buffering: no` | `stream.test.ts` "writes X-Accel-Buffering: no" + `server.test.ts` streaming header check |
| 6 (timingSafeEqual mismatched length) | Delegated to Plan 01 `verifyKey` length-guard | Plan 01 `auth.test.ts` |
| 8 (prompt-cache miss on OpenAI path) | translator.ts `clientSystemAppend` flows to `systemPrompt.append` — NEVER override | `translator.test.ts` "concatenates all system messages into clientSystemAppend (APPEND, never OVERRIDE)" |
| 9 (Content-Type charset) | server.ts `isJsonContentType` uses `.toLowerCase().startsWith()` | `server.test.ts` "accepts Content-Type: application/json; charset=utf-8" |
| 10 (graceful shutdown with in-flight streams) | server.handle.close() iterates activeStreams Set and calls close() BEFORE server.close() | `server.test.ts` "activeStreams are closed before server.close() completes" |

## Files Created/Modified

Files created (9):

- `src/openai/types.ts` — Zod + TS types for the OpenAI wire format + Claude intermediate types
- `src/openai/translator.ts` — pure-function translator + streaming factory
- `src/openai/stream.ts` — SSE writer
- `src/openai/server.ts` — node:http listener
- `src/openai/__tests__/translator.test.ts` — 46 tests
- `src/openai/__tests__/stream.test.ts` — 15 tests
- `src/openai/__tests__/server.test.ts` — 26 tests
- `src/openai/__tests__/fixtures/sdk-stream-text.json` — 7-event recorded text stream
- `src/openai/__tests__/fixtures/sdk-stream-tool-use.json` — 9-event recorded parallel-tool-use stream

Files modified (0):

- None. Plan 02 is fully hermetic.

## Decisions Made

See frontmatter `key-decisions` — six decisions locked this plan:

1. OpenAiSessionDriver is a new interface separate from SessionAdapter (keeps server.ts hermetic).
2. Translator uses TWO maps for tool-call accumulation (primary by id, secondary by SDK block index).
3. Mock driver uses signal abort-event listener (not just in-loop polling) for deterministic `lastAborted` observation.
4. Client disconnect test uses node:http directly (fetch/undici too flaky on abort).
5. Body-too-large guard uses `req.pause()` not `req.destroy()` (so the response can still send the 413 body).
6. Both `req.on('close')` AND `res.on('close')` wired to the AbortController (Node's event ordering for SSE connections varies; wiring both is the robust path).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Body-too-large destroyed socket before 413 response could be sent**
- **Found during:** Task 4 (server.test.ts "body larger than maxRequestBodyBytes → 413")
- **Issue:** Initial implementation used `req.destroy()` on overflow, which closed the TCP connection before `sendError(res, 413, ...)` could write the response. Test observed `TypeError: fetch failed` with `UND_ERR_SOCKET other side closed` instead of a 413 status.
- **Fix:** Changed readBody overflow path to `req.pause()` (stops data events without closing the socket). The response can still be written.
- **Files modified:** `src/openai/server.ts`
- **Verification:** Test now passes — server returns 413 with `{error:{code:"body_too_large"}}`.
- **Committed in:** `31a6947` (part of Task 4 commit)

**2. [Rule 1 - Bug] Client-disconnect guard `!res.writableEnded` blocked AbortController.abort()**
- **Found during:** Task 4 ("AbortController on client side flips driver.signal.aborted")
- **Issue:** The initial `req.on("close", () => { if (!res.writableEnded) ac.abort() })` was correct in isolation, but for SSE responses `res.writableEnded` stays false throughout the stream, so the guard SHOULD have worked. However, the real issue was that for fetch/undici-driven requests the `close` event fired on `res` (not always on `req`) depending on Node's socket state. I also observed that the guard risked silently skipping abort if a future `emitDone()` raced with the close event.
- **Fix:** Removed the `!res.writableEnded` guard and wired BOTH `req.on("close")` AND `res.on("close")` to call `ac.abort()`. AbortController.abort() is idempotent, so double-firing is harmless.
- **Files modified:** `src/openai/server.ts`
- **Verification:** Test now passes using node:http + explicit socket destroy.
- **Committed in:** `31a6947` (part of Task 4 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — bugs caught by the integration tests).
**Impact on plan:** Both fixes are correctness-critical and fit within the originally-planned scope of server.ts. No scope creep. Both behaviors are documented in the test file so future regressions will be caught.

## Issues Encountered

**1. Pre-existing test timeouts in `src/cli/commands/__tests__/triggers.test.ts`** — 29 tests in Phase 60/61 trigger CLI code failing with 5s timeout in the full-suite run. Logged to `.planning/phases/69-openai-compatible-endpoint/deferred-items.md` — out of scope (Phase 69 Plan 02 does not touch `src/cli/commands/triggers.ts` or `src/triggers/*`). All `src/openai/**` tests (122) pass. All other subsystems pass (2498/2527 overall).

**2. Pre-existing TypeScript errors in the repo** — 45 errors across various test files (e.g., `src/config/__tests__/differ.test.ts`, `src/config/__tests__/loader.test.ts`, `src/tasks/task-manager.ts`, `src/manager/daemon.ts`) introduced by Plan 01 (openai config field + causationId on TurnOrigin) and legacy tests. Not blocking vitest runs (tsc errors vs runtime behavior). Out of scope per CLAUDE.md rule "only auto-fix issues DIRECTLY caused by the current task's changes".

## User Setup Required

None — no external service configuration required for this plan. Plan 03 will add the `clawcode openai-key` CLI that operators use to create/list/revoke keys.

## Non-Regression Guard (v1.7 SLOs)

Confirmed via `git diff --stat` across the four task commits:

- **No src/manager/ files touched** — TurnDispatcher / SessionAdapter / SessionManager / daemon.ts all unchanged.
- **No src/memory/ files touched** — ConversationStore / MemoryStore / prompt-cache paths unchanged.
- **No src/config/ files touched** — schema.ts unchanged (Plan 01 modified it; Plan 02 just re-uses it).
- **No Discord files touched** — `git diff --name-only src/discord/` empty.
- **server.ts has ZERO imports from src/manager/, src/memory/, src/config/** — verified via grep; the server module is a pure HTTP boundary that will be composed into the daemon by Plan 03.
- **Prompt-cache preservation (Pitfall 8)** — translator.ts emits `clientSystemAppend` with the explicit naming contract "APPEND, never OVERRIDE"; unit-tested.

## Known Stubs

None. All four modules are fully functional. The `OpenAiSessionDriver` interface is implemented by mock drivers in the test suite; Plan 03 will provide the production implementation that wires to `SessionManager` + `ConversationStore`. That's a deliberate interface boundary, not a stub.

## Next Phase Readiness

- Plan 03 (daemon integration + CLI + E2E smoke) can proceed immediately.
- Plan 03's only work inside `src/openai/` is to write a production `OpenAiSessionDriver` implementation (new file, e.g. `src/openai/driver.ts`) that:
  1. Looks up or lazily creates the `api_key_sessions` row for the given `keyHash`.
  2. Calls `SessionManager.dispatchStream(...)` with the translated inputs.
  3. Yields `SdkStreamEvent` values from the SDK's stream.
- Plan 03 additionally wires `startOpenAiServer` into `src/manager/daemon.ts` boot, registers the shutdown hook, and adds the `clawcode openai-key <create|list|revoke>` CLI.
- All of Plan 02's code can remain unchanged during Plan 03's wiring — the DI surface was built specifically so daemon integration is a one-module delta.

## Self-Check

- [x] `src/openai/types.ts` exists
- [x] `src/openai/translator.ts` exists
- [x] `src/openai/stream.ts` exists
- [x] `src/openai/server.ts` exists
- [x] `src/openai/__tests__/translator.test.ts` exists (46 tests green)
- [x] `src/openai/__tests__/stream.test.ts` exists (15 tests green)
- [x] `src/openai/__tests__/server.test.ts` exists (26 tests green)
- [x] `src/openai/__tests__/fixtures/sdk-stream-text.json` exists
- [x] `src/openai/__tests__/fixtures/sdk-stream-tool-use.json` exists
- [x] Commit `f07d1aa` in git log (Task 1 — types + fixtures)
- [x] Commit `640250f` in git log (Task 2 — translator + test)
- [x] Commit `4d992fc` in git log (Task 3 — stream + test)
- [x] Commit `31a6947` in git log (Task 4 — server + test)
- [x] `grep -q "chatCompletionRequestSchema" src/openai/types.ts` passes
- [x] `grep -q "ChatCompletionChunk" src/openai/types.ts` passes
- [x] `grep -q "createStreamingTranslator" src/openai/translator.ts` passes
- [x] `grep -q "input_json_delta" src/openai/translator.ts` passes
- [x] `grep -q "new Map" src/openai/translator.ts` passes (tool-call accumulator)
- [x] `grep -q "startOpenAiSse" src/openai/stream.ts` passes
- [x] `grep -q "text/event-stream" src/openai/stream.ts` passes
- [x] `grep -q "X-Accel-Buffering" src/openai/stream.ts` passes
- [x] `grep -q "\\[DONE\\]" src/openai/stream.ts` passes
- [x] `grep -q "keepalive" src/openai/stream.ts` passes
- [x] `grep -Eq "drain|setImmediate" src/openai/stream.ts` passes
- [x] `grep -q "startOpenAiServer" src/openai/server.ts` passes
- [x] `grep -q "/v1/chat/completions" src/openai/server.ts` passes
- [x] `grep -q "/v1/models" src/openai/server.ts` passes
- [x] `grep -q "Access-Control-Allow-Origin" src/openai/server.ts` passes
- [x] `grep -q "OpenAiSessionDriver" src/openai/server.ts` passes
- [x] `grep -q "activeStreams" src/openai/server.ts` passes
- [x] `grep -q "buildOpenAiError" src/openai/server.ts` passes
- [x] `! grep -qE "from [\\\"']\\.\\./manager|\\.\\./memory|\\.\\./config" src/openai/server.ts` passes (NO forbidden imports)
- [x] Full `npx vitest run src/openai` — 122 tests green (46 translator + 15 stream + 26 server + 35 auth).

## Self-Check: PASSED
