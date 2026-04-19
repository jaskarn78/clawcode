---
phase: 260419-jtk
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/openai/translator.ts
  - src/openai/server.ts
  - src/openai/__tests__/translator.test.ts
  - src/openai/__tests__/server.test.ts
  - src/openai/__tests__/fixtures/sdk-stream-tool-use-terminal.json
  - src/manager/session-manager.ts
autonomous: true
requirements:
  - QUICK-260419-jtk-01  # stream_options.include_usage trailing-chunk emission
  - QUICK-260419-jtk-02  # tool-call streaming end-to-end (terminal finish_reason + usage trailer interop)
  - QUICK-260419-jtk-03  # warm-path startup race → bounded wait + 503 Retry-After
---

<objective>
Three post-v2.0 hardening fixes for the OpenAI-compatible endpoint so OpenClaw agents running on clawdy can consume `/v1/chat/completions` as a drop-in OpenAI replacement under realistic conditions:

1. **Emit `stream_options.include_usage` trailing chunk** (OPENAI-01/02 spec parity gap called out in `src/openai/types.ts:213` — "Plan 02 does not implement that trailing chunk yet"). Without it, clients that opt in to usage accounting over SSE get nothing.
2. **Verify tool-call streaming end-to-end** and add a server-level test asserting `finish_reason:"tool_calls"` on the terminal chunk plus usage-trailer interop. The translator already maps deltas per-index; this task pins the contract and catches regressions at the SSE seam.
3. **Resolve the warm-path startup race** where `/v1/chat/completions` returns `500 driver_error` during the ~5s window between daemon start and the agent's warm path completing. Solution: short bounded poll on `sessionManager.isRunning(agent)` up to 2000ms, then `503 Retry-After: 2` with a clean OpenAI error envelope.

Purpose: OpenClaw clients (and any OpenAI SDK client) see spec-conformant streaming usage, stable tool-call terminations, and a correct transient-vs-permanent signal on boot races — not a misleading 500.

Output:
- `translator.ts`: trailing usage chunk builder + `finalize()` accepts an `includeUsage` flag.
- `server.ts`: streaming path passes `stream_options.include_usage` into `finalize()`; non-stream path unchanged; `handleChatCompletions` wraps driver errors to detect `SessionError` "not running" and either wait-and-retry or emit 503. NO `retry-loops` inside `SessionManager`.
- `session-manager.ts`: one new public helper `isRunning(name: string): boolean` (~3 lines, thin wrapper over `this.sessions.has(name)`).
- Tests: new fixture for tool-use-with-terminal-finish_reason, translator unit tests for usage chunk emission shape, server integration tests for warm-path 503 + wait-then-dispatch + tool-call `finish_reason:"tool_calls"` + usage trailer interop.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md

<interfaces>
<!-- Contracts the executor needs. Extracted from the codebase — no exploration required. -->

From `src/openai/types.ts:216-231` — `ChatCompletionChunk` type ALREADY permits the trailing usage shape:
```typescript
export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: { role?: "assistant"; content?: string; tool_calls?: ChatCompletionToolCallDelta[] };
    finish_reason: "stop" | "length" | "tool_calls" | null;
  }>;
  usage?: ChatCompletionUsage;   // <-- Optional — absent on content chunks, present on the trailing usage chunk.
}
```
The doc comment at line 213 explicitly says: *"Plan 02 does not implement that trailing chunk yet; the type permits it for Plan 03 extension."* — we are implementing it now.

From `src/openai/types.ts:123-125` — `stream_options` request shape (already parsed by the request schema):
```typescript
export const streamOptionsSchema = z.object({
  include_usage: z.boolean().optional(),
});
```
`body.stream_options?.include_usage` is a `boolean | undefined` at the server seam — NO schema change needed.

From `src/openai/types.ts:174-178` — the usage shape to emit:
```typescript
export interface ChatCompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}
```

From `src/openai/translator.ts:258-272` — reuse `deriveUsage(claude)` (already exported):
```typescript
export function deriveUsage(claude: ClaudeUsage | undefined): {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};
// prompt = input_tokens + cache_read_input_tokens
// completion = output_tokens
// total = prompt + completion
// Missing fields → 0 (never `{}`)
```

From `src/openai/translator.ts:376-385` — `StreamingTranslator` contract that this plan extends:
```typescript
export interface StreamingTranslator {
  onEvent(event: SdkStreamEvent): ChatCompletionChunk[];
  finalize(finishReason?: "stop" | "tool_calls" | "length"): ChatCompletionChunk[];
  readonly hadToolUse: boolean;
  readonly collectedText: string;
  readonly collectedToolCalls: ReadonlyArray<ChatCompletionToolCall>;
  readonly usage: ClaudeUsage | undefined;
}
```
**Change in this plan:** `finalize(options?: { finishReason?: ...; includeUsage?: boolean })` — widen to object arg while remaining backward-compatible (positional `"stop"|"tool_calls"|"length"` still accepted for existing test callers). Existing tests in `translator.test.ts` pass positional or no arg; both forms continue to work.

From `src/openai/server.ts:525-579` — `runStreaming` is where `finalize()` is called (line 562). The body has already been parsed as `ChatCompletionRequest` at line 390 and passed the schema, so `body.stream_options?.include_usage` is accessible. **Current `runStreaming` signature does NOT take the request body** — it takes `driverInput` + `model` + `turnId`. We add ONE new arg: `streamIncludeUsage: boolean` (extracted at the call site at line 468).

From `src/openai/server.ts:289-473` — `handleChatCompletions`: the seam where warm-path-retry logic belongs. Body is validated first; model↔key pinning check (line 393) runs BEFORE dispatch. The wait-for-running happens AFTER auth + validation + model pin check, BEFORE `runStreaming`/`runNonStreaming` — i.e., we already have the `row.agent_name` at that point.

From `src/openai/server.ts:94-105` — `OpenAiServerConfig`:
```typescript
export interface OpenAiServerConfig {
  port: number;
  host: string;
  maxRequestBodyBytes: number;
  streamKeepaliveMs: number;
  apiKeysStore: ApiKeysStore;
  driver: OpenAiSessionDriver;
  agentNames: () => ReadonlyArray<string>;   // <-- Exists.
  log?: Logger;
}
```
**Change in this plan:** add one optional field `agentIsRunning?: (agentName: string) => boolean` — when absent, the server skips the readiness wait (preserves Plan 02's hermetic test harness). When present (production), the wait-and-poll logic activates. `endpoint-bootstrap.ts` wires it to `sessionManager.isRunning.bind(sessionManager)`.

From `src/manager/session-manager.ts:648` — existing `getRunningAgents(): readonly string[]`. Current API surface has no single-name boolean, but the private `requireSession` at line 688 already does `this.sessions.get(name)`. The new public helper mirrors that:
```typescript
/** Phase post-v2.0 hardening — boolean readiness probe for the OpenAI endpoint warm-path race. */
isRunning(name: string): boolean {
  return this.sessions.has(name);
}
```
Insert adjacent to `getRunningAgents` (line 648). Zero new state, no Map iteration, no allocation.

From `src/shared/errors.ts:115-123` — the exception thrown on warm-path miss:
```typescript
export class SessionError extends Error {
  readonly agentName: string;
  // "Agent '<name>' is not running"
}
```
This is the discriminator: `err instanceof SessionError && err.message.includes("is not running")`. Prefer checking by class PLUS the `.message.includes(" is not running")` substring (NOT the "already running" sibling message from line 218).

From `src/openai/__tests__/fixtures/sdk-stream-tool-use.json` — existing tool-use fixture is sufficient for translator tests but has NO explicit terminal-finish-reason scenario tied to the SERVER. The new fixture `sdk-stream-tool-use-terminal.json` is a minimal copy that exercises the server's finalize-path tool_calls terminator.

From `src/openai/__tests__/server.test.ts:567-661` — existing tool-use streaming server test (`describe("POST /v1/chat/completions — tool-use streaming (OPENAI-06)")`). We ADD to this describe block (not create a new one) so the structure stays consistent with Plan 02's existing org.

From `src/openai/endpoint-bootstrap.ts:140-160` — where the driver is wired. We extend the `startOpenAiServer({...})` call to also pass `agentIsRunning: sessionManager.isRunning.bind(sessionManager)`. This is a one-line addition.
</interfaces>

</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Emit stream_options.include_usage trailing chunk</name>
  <files>src/openai/translator.ts, src/openai/__tests__/translator.test.ts, src/openai/server.ts</files>
  <behavior>
- **Translator behavior**:
  - `StreamingTranslator.finalize()` accepts an optional object arg `{ finishReason?: "stop"|"tool_calls"|"length"; includeUsage?: boolean }`. Positional string arg stays supported for backward compat (all existing tests use that form).
  - When `includeUsage === true`, `finalize()` returns `[terminalChunk, usageChunk]` — TWO chunks, in that order. The terminal chunk is unchanged (delta `{}`, finish_reason set). The usage chunk has `choices: []` (NOT `choices[0]`), same `id`/`object`/`created`/`model`, and `usage: { prompt_tokens, completion_tokens, total_tokens }`.
  - When `includeUsage === true` AND `this.usage` is undefined (no `result` event captured — e.g., driver emitted no result), `finalize()` returns ONLY the terminal chunk — i.e., NO usage chunk is emitted. Document rationale: emitting `{0,0,0}` misleads clients; absence is more honest. (Spec allows either; we choose absence. Record in JSDoc.)
  - When `includeUsage === false` or absent, behavior is IDENTICAL to today (one terminal chunk).

- **Translator tests** (add to `src/openai/__tests__/translator.test.ts` in a new `describe("createStreamingTranslator — usage trailer (stream_options.include_usage)", ...)` block):
  - Test U1: `finalize()` with no arg → 1 chunk, delta `{}`, finish_reason derived (existing behavior — regression guard).
  - Test U2: `finalize("stop")` (positional, existing call style) → 1 chunk, finish_reason "stop" — regression guard for existing callers.
  - Test U3: `finalize({ includeUsage: false })` → 1 chunk, no usage chunk (absent flag identical to false).
  - Test U4: `finalize({ includeUsage: true })` after consuming `toolUseStreamFixture` → 2 chunks. First chunk: delta `{}`, finish_reason "tool_calls". Second chunk: `choices` is `[]`, `usage.prompt_tokens === 20` (input_tokens:20 + cache_read:0), `usage.completion_tokens === 10` (output_tokens:10), `usage.total_tokens === 30`.
  - Test U5: `finalize({ includeUsage: true })` after consuming `textStreamFixture` → 2 chunks. Usage chunk: `prompt_tokens: 12`, `completion_tokens: 3`, `total_tokens: 15`. Terminal chunk finish_reason "stop".
  - Test U6: `finalize({ includeUsage: true })` when no `result` event was consumed (synthesize a stream of just `content_block_start` + `content_block_delta:text_delta` + `content_block_stop` — no `result` event, so `t.usage` is `undefined`) → 1 chunk only (terminal). NO usage chunk.
  - Test U7: Both params passed: `finalize({ finishReason: "length", includeUsage: true })` → terminal finish_reason "length", usage chunk present.
  - Test U8: Every chunk (terminal + usage) shares the same `id`, `object:"chat.completion.chunk"`, `model`, `created` (same `id` assertion is load-bearing — OpenAI clients group by `id`).

- **Server behavior**:
  - `runStreaming` takes one new arg `streamIncludeUsage: boolean` (after the other args, before `xRequestId`/`log`). `handleChatCompletions` extracts this at line ~468 via `const streamIncludeUsage = body.stream_options?.include_usage === true;` and passes it through.
  - In `runStreaming`, change `const finals = translator.finalize();` to `const finals = translator.finalize({ includeUsage: streamIncludeUsage });`.
  - No change to `runNonStreaming` — non-stream responses already include `usage` in the final `ChatCompletionResponse` body.
  </behavior>
  <action>
1. **RED — write failing translator tests**. Append the new `describe("createStreamingTranslator — usage trailer (stream_options.include_usage)", ...)` block to `src/openai/__tests__/translator.test.ts` (after the existing `describe` at line ~643). Use the same fixture-loading helpers already imported at the top of the file. Run `npx vitest run src/openai/__tests__/translator.test.ts` — expect 8 new tests to FAIL (finalize arg shape mismatch or missing usage chunk).

2. **GREEN — implement in `src/openai/translator.ts`**.

   a. Add a private builder helper ABOVE the `createStreamingTranslator` function (near `makeChunk`):
      ```typescript
      /**
       * Build the OpenAI `stream_options.include_usage` trailing chunk:
       *
       *   { id, object:"chat.completion.chunk", created, model,
       *     choices: [],
       *     usage: { prompt_tokens, completion_tokens, total_tokens } }
       *
       * Spec: https://platform.openai.com/docs/api-reference/chat/streaming
       * `choices` is intentionally the empty array on this final usage chunk.
       */
      function makeUsageChunk(params: {
        id: string;
        model: string;
        usage: ChatCompletionUsage;
        created?: number;
      }): ChatCompletionChunk {
        return {
          id: params.id,
          object: "chat.completion.chunk",
          created: params.created ?? epochSeconds(),
          model: params.model,
          choices: [],
          usage: params.usage,
        };
      }
      ```
      Import `ChatCompletionUsage` from `./types.js` (already in the existing import list at line 47 — add it if missing).

   b. Change the `finalize` signature in the `StreamingTranslator` interface (line ~378):
      ```typescript
      finalize(
        options?:
          | "stop" | "tool_calls" | "length"                                 // legacy positional (deprecated)
          | { finishReason?: "stop" | "tool_calls" | "length"; includeUsage?: boolean },
      ): ChatCompletionChunk[];
      ```
      JSDoc comment: *"The legacy string-literal form is kept only for backward compat with Plan 02 tests; prefer the object form in new code."*

   c. Update the implementation at line ~553:
      ```typescript
      finalize(options): ChatCompletionChunk[] {
        // Normalize legacy positional form.
        const normalized: { finishReason?: "stop"|"tool_calls"|"length"; includeUsage?: boolean } =
          typeof options === "string" ? { finishReason: options } : (options ?? {});
        const finishReason =
          normalized.finishReason ?? (hadToolUse ? "tool_calls" : "stop");
        const terminal = makeChunk({ id, model, delta: {}, finishReason });
        if (!normalized.includeUsage) return [terminal];
        // When client opted in but we never got a result event → omit usage
        // chunk rather than emit {0,0,0} (OpenAI spec permits absence).
        if (usage === undefined) return [terminal];
        const usageChunk = makeUsageChunk({
          id,
          model,
          usage: deriveUsage(usage),
        });
        return [terminal, usageChunk];
      }
      ```

   d. Run `npx vitest run src/openai/__tests__/translator.test.ts` — all 8 new tests plus every existing test in that file must pass.

3. **GREEN — wire server.ts to pass the flag**.

   a. In `src/openai/server.ts`, at line ~467 (inside `handleChatCompletions`), compute:
      ```typescript
      const streamIncludeUsage = body.stream_options?.include_usage === true;
      ```
      Place this right before the `if (body.stream) { await runStreaming(...) }` branch.

   b. Thread the arg: change the `runStreaming` call to pass `streamIncludeUsage` as a new named position. Recommended order:
      ```typescript
      await runStreaming(
        res, config, activeStreams, body.model, turnId, driverInput,
        streamIncludeUsage, xRequestId, log,
      );
      ```

   c. Update the `runStreaming` signature (line ~525) to accept `streamIncludeUsage: boolean` and change the single `translator.finalize()` call (line ~562) to `translator.finalize({ includeUsage: streamIncludeUsage })`. No other edits in that function.

4. **Verify**.
   - `npx vitest run src/openai/__tests__/translator.test.ts src/openai/__tests__/server.test.ts` — existing Plan 02 tests pass unchanged (the only server test change from this task is the parameter threading, which is a no-op behavior-wise when `include_usage` is absent).
   - `npx tsc --noEmit` — zero errors.

5. **Coding style**.
   - Keep `makeUsageChunk` a module-private helper (NOT exported) — it's a one-call primitive with no downstream reuse.
   - NO mutation of the existing terminal chunk; build both chunks fresh.
   - JSDoc on `finalize` documents BOTH call shapes and the `usage === undefined` absence rule.
  </action>
  <verify>
    <automated>npx vitest run src/openai/__tests__/translator.test.ts src/openai/__tests__/server.test.ts && npx tsc --noEmit</automated>
  </verify>
  <done>
- `StreamingTranslator.finalize` accepts object arg with `includeUsage` flag; legacy positional form still works.
- 8 new translator tests pass; all existing translator tests pass (no regressions).
- `runStreaming` threads the flag through and calls `finalize({ includeUsage })`.
- `usage` chunk has `choices: []` and non-zero token numbers derived via `deriveUsage`.
- When `usage` was never captured, NO usage chunk emitted (even if flag true).
- Zero TS errors, no behavior change when `stream_options.include_usage` is absent.
  </done>
</task>

<task type="auto">
  <name>Task 2: Verify tool-call streaming end-to-end + usage-trailer interop</name>
  <files>src/openai/__tests__/fixtures/sdk-stream-tool-use-terminal.json, src/openai/__tests__/server.test.ts</files>
  <action>
Nothing in `src/openai/translator.ts` needs to change for this task — the translator already maps `content_block_start:tool_use` → first tool_calls delta with `id`+`function.name`+`arguments:""` and `content_block_delta:input_json_delta` → arguments partials (verified in translator.test.ts:513-611). We pin that contract at the SERVER seam and add a usage-trailer interop test.

1. **Add a fixture** `src/openai/__tests__/fixtures/sdk-stream-tool-use-terminal.json` — a minimal realistic single-tool-call stream:

   ```json
   [
     {"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tu_bn1","name":"browser_navigate"}}},
     {"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"url\":"}}},
     {"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\"https://example.com\"}"}}},
     {"type":"stream_event","event":{"type":"content_block_stop","index":0}},
     {"type":"assistant","parent_tool_use_id":null,"message":{"content":[{"type":"tool_use","id":"tu_bn1","name":"browser_navigate","input":{"url":"https://example.com"}}]},"session_id":"sess_tc"},
     {"type":"result","session_id":"sess_tc","usage":{"input_tokens":15,"output_tokens":5,"cache_read_input_tokens":0}}
   ]
   ```

   Rationale: single tool call ensures `finish_reason:"tool_calls"` derivation is unambiguous; mirrors the real clawcode MCP `browser_navigate` signature (see Phase 70). No `assistant` message with text — this is a pure tool-call terminal turn.

2. **Add server tests** to `src/openai/__tests__/server.test.ts` — append new `it(...)` blocks inside the existing `describe("POST /v1/chat/completions — tool-use streaming (OPENAI-06)", ...)` (line ~567). Load the new fixture at the top of the file next to the existing fixture imports:

   ```typescript
   const toolUseTerminalStream: SdkStreamEvent[] = JSON.parse(
     readFileSync(join(FIXTURES_DIR, "sdk-stream-tool-use-terminal.json"), "utf8"),
   );
   ```

   **Test T1** — "streams a realistic tool_use sequence (content_block_start → input_json_delta → stop → assistant → result) and terminates with finish_reason:tool_calls":
   - Boot harness with `toolUseTerminalStream`.
   - Send POST with `messages:[{role:"user",content:"go to example.com"}]`, `stream:true`.
   - Parse SSE via existing `parseSseBody` helper.
   - Assert: First non-primer chunk carries `tool_calls[0] = { index:0, id:"tu_bn1", type:"function", function:{ name:"browser_navigate" } }`.
   - Assert: Subsequent `tool_calls` deltas carry ONLY `{ index:0, function:{ arguments:<partial> } }` — NO `id`, NO `type` (regression guard).
   - Assert: Concatenated arguments across all chunks with `index:0` === `'{"url":"https://example.com"}'` and `JSON.parse` of that concatenation succeeds.
   - Assert: Final chunk (before `[DONE]`) has `delta:{}` AND `finish_reason:"tool_calls"`.
   - Assert: `parsed.seenDone === true`.

   **Test T2** — "trailing usage chunk fires when stream_options.include_usage:true on a tool-call stream":
   - Boot harness with `toolUseTerminalStream`.
   - Send POST with `stream:true` AND `stream_options:{ include_usage: true }`.
   - Assert: `parsed.chunks` contains AT LEAST two final chunks — the terminal (`finish_reason:"tool_calls"`, `delta:{}`) followed by the usage chunk (`choices:[]`, `usage.prompt_tokens === 15`, `usage.completion_tokens === 5`, `usage.total_tokens === 20`).
   - Assert: The usage chunk has the SAME `id` as the preceding terminal chunk.
   - Assert: `parsed.seenDone === true` (DONE sentinel fires AFTER the usage chunk).

   **Test T3** — "no trailing usage chunk when stream_options absent":
   - Boot harness with `toolUseTerminalStream`.
   - Send POST with `stream:true` and NO `stream_options`.
   - Assert: Final chunk has `finish_reason:"tool_calls"`, and the chunk BEFORE `[DONE]` has NO `usage` field (`chunks[chunks.length-1].usage === undefined`).
   - Assert: No chunk has `choices:[]` (no usage trailer).

   **Test T4** — "no trailing usage chunk when stream_options.include_usage:false":
   - Same as T3 but with `stream_options:{ include_usage: false }` explicitly.
   - Assert: No usage chunk.

   Parse helper note: the existing `parseSseBody` helper (line ~396 of `server.test.ts`) already handles `choices:[]` correctly — it JSON-parses each `data:` block into the `chunks` array regardless of `choices` shape. No helper change needed.

3. **Verify**.
   - `npx vitest run src/openai/__tests__/server.test.ts` — all 4 new tests pass plus every existing test.
   - `npx tsc --noEmit` — zero errors.

4. **Scope guard**. If any of the assertions above FAIL against the current translator, fix the translator in Task 1 BEFORE proceeding. Given the existing translator.test.ts coverage (tests at lines 513-611), we expect no translator fix is required — this task is a pure server-level pin + regression guard. Document any translator adjustments in the task SUMMARY.
  </action>
  <verify>
    <automated>npx vitest run src/openai/__tests__/server.test.ts && npx tsc --noEmit</automated>
  </verify>
  <done>
- New fixture `sdk-stream-tool-use-terminal.json` exists with a realistic single-tool-call sequence.
- 4 new server-level tests (T1–T4) pass inside the `(OPENAI-06)` describe block.
- Terminal chunk asserts `finish_reason:"tool_calls"` and `delta:{}` on a tool-call-only turn.
- Usage trailer interop verified: correct token numbers, `choices:[]`, same id as terminal, fires BEFORE `[DONE]`.
- No regressions in existing translator or server tests; zero TS errors.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Resolve warm-path startup race — bounded poll + 503 Retry-After</name>
  <files>src/manager/session-manager.ts, src/openai/server.ts, src/openai/__tests__/server.test.ts</files>
  <behavior>
- **`SessionManager.isRunning(name)`** — new public helper. Thin wrapper: `return this.sessions.has(name)`. No behavior change, no new state. Inserted adjacent to `getRunningAgents` at line 648. JSDoc explains the intended use (single-name boolean probe for OpenAI endpoint readiness check). Semantics of `streamFromAgent` / `nonStreamFromAgent` are UNCHANGED — `requireSession` still throws `SessionError` on miss. **NO retry/backoff loops inside session-manager.ts.**

- **`OpenAiServerConfig.agentIsRunning?: (agentName: string) => boolean`** — new optional config field. When absent, the server skips the readiness wait entirely (preserves Plan 02's hermetic test harness). When present, the wait-and-poll logic activates.

- **`OpenAiServerConfig.agentReadinessWaitMs?: number`** — new optional field, defaults to `2000`. Max time the handler will block waiting for `agentIsRunning(agent) === true` before responding 503. Tests override this to 50–200ms for speed.

- **`OpenAiServerConfig.agentReadinessPollIntervalMs?: number`** — new optional field, defaults to `50`. Poll cadence during the wait window.

- **`handleChatCompletions` behavior change** — between model-pin check (line ~403) and `translateRequest` call (line ~414), insert a readiness wait block:
  - If `config.agentIsRunning === undefined` → skip (test harness path; unchanged).
  - If `config.agentIsRunning(row.agent_name) === true` → proceed immediately (hot path; zero latency added).
  - Else: poll `agentIsRunning(row.agent_name)` every `agentReadinessPollIntervalMs` ms for up to `agentReadinessWaitMs` ms. First poll that flips to `true` → proceed. If budget expires: respond `503 Service Unavailable` with header `Retry-After: 2` and body `{"error":{"message":"Agent warming up, retry shortly","type":"server_error","code":"agent_warming"}}`.
  - The 503 uses the existing `sendError` helper BUT must also set `Retry-After: 2` before `writeHead`. Since `sendError` calls `writeHead`, extend its signature with an optional `extraHeaders?: Record<string,string>` param (backward compat — existing callers pass nothing).

- **503 code value**: `"agent_warming"` — matches the scope doc. Response `error.type` is `"server_error"` (503 belongs in that family per our `OpenAiError` type union — see `types.ts:240-247`, which does NOT include a dedicated `service_unavailable` literal). Using `server_error` keeps the type union stable.

- **Defensive guard on the SessionError path**: if the wait window EXPIRED but the dispatch still somehow fires and `streamFromAgent`/`nonStreamFromAgent` throws `SessionError` with `.message.includes(" is not running")`, `runStreaming` / `runNonStreaming` catch blocks should ALSO surface a 503 shape (not `driver_error` / 500). This is belt-and-suspenders — the pre-dispatch wait is the primary guard.
  - For `runNonStreaming`: catch `err instanceof SessionError` and "is not running" → `sendError(res, 503, "server_error", "Agent warming up, retry shortly", "agent_warming", xRequestId, { "Retry-After": "2" })`.
  - For `runStreaming`: by the time the driver starts iterating, the SSE headers may already have been written. If the FIRST driver error is `SessionError not-running`, we haven't emitted any chunk yet — we can still write a 503 cleanly. Gate on `firstChunkEmitted === false` (track locally) — only then can we route to the 503 path; otherwise use the existing `handle.emitError` mid-stream path. Simplest impl: check `err instanceof SessionError && err.message.includes(" is not running")` before `handle` was touched. If so, `res.writeHead(503, {...Retry-After + OpenAiError})` instead of `emitError`. If `handle.emit` was already called, use `emitError` (existing behavior preserved).
  </behavior>
  <action>
1. **SessionManager — add `isRunning`**. Edit `src/manager/session-manager.ts`, insert after line 648:

   ```typescript
   /**
    * Post-v2.0 hardening — single-name boolean readiness probe.
    * Used by the OpenAI endpoint to bound the warm-path startup race
    * (SessionManager throws `SessionError('not running')` during the
    * ~5s window between daemon start and the agent's warm path
    * completing). The endpoint polls this to decide wait-then-dispatch
    * vs 503 Retry-After.
    *
    * Deliberately does NOT differentiate "starting" vs "fully warm" —
    * `this.sessions.has(name)` flips to true AFTER warmupAgent returns,
    * which is exactly the gate the endpoint needs.
    */
   isRunning(name: string): boolean {
     return this.sessions.has(name);
   }
   ```

   **Do NOT** modify `requireSession`, `streamFromAgent`, `sendToAgent`, or `forwardToAgent` — session-manager semantics stay pure (per scope doc: "The wait belongs in the OpenAI bootstrap/handler seam").

2. **RED — write failing server tests**. Append a new describe block to `src/openai/__tests__/server.test.ts`:

   ```typescript
   describe("POST /v1/chat/completions — warm-path startup race", () => {
     // Tests use fake timers + a controllable isRunning mock.
   });
   ```

   **Test W1** — "agent already running → immediate dispatch (no wait)":
   - Boot harness with `agentIsRunning: () => true`, `agentReadinessWaitMs: 1000`, `agentReadinessPollIntervalMs: 50`.
   - Send POST, measure elapsed time — assert < 100ms (no poll cycles happened; budget not consumed).
   - Assert: 200 OK, driver.calls.length === 1.

   **Test W2** — "agent never warms within budget → 503 with Retry-After:2 and agent_warming code":
   - Boot harness with `agentIsRunning: () => false` (permanent false), `agentReadinessWaitMs: 150`, `agentReadinessPollIntervalMs: 25`.
   - Send POST.
   - Assert: res.status === 503.
   - Assert: res.headers.get("retry-after") === "2".
   - Assert: body.error.type === "server_error", body.error.code === "agent_warming", body.error.message matches /warming/i.
   - Assert: driver.calls.length === 0 (driver was never invoked — the pre-dispatch wait gate held).

   **Test W3** — "agent warms within budget → dispatch succeeds":
   - Mock `agentIsRunning` as `vi.fn()` returning false for the first 3 calls then true thereafter (simulates warm-path completing partway through the poll window).
   - Use `agentReadinessWaitMs: 500`, `agentReadinessPollIntervalMs: 25`.
   - Send POST.
   - Assert: 200 OK.
   - Assert: `agentIsRunning` called ≥ 3 times (proves polling happened) and ≤ `(500/25)+2` times (proves it stopped after seeing true).
   - Assert: driver.calls.length === 1.

   **Test W4** — "no agentIsRunning config → wait gate disabled (Plan 02 hermetic test harness preserved)":
   - Boot harness with NO `agentIsRunning` config field (the default bootHarness helper already omits it — pre-Task-3 behavior must be preserved for every existing Plan 02 test to keep passing).
   - Send POST. Assert: 200 OK, latency < 100ms, driver.calls.length === 1.

   **Test W5** — "SessionError 'not running' from driver mid-non-stream path surfaces as 503 agent_warming":
   - Boot harness WITHOUT `agentIsRunning` (so the pre-dispatch gate is disabled and we hit the defensive catch path).
   - Inject a custom driver whose `dispatch` throws `new SessionError("Agent 'clawdy' is not running", "clawdy")` (import from `src/shared/errors.js`).
   - Send POST (non-stream).
   - Assert: res.status === 503, `retry-after` === "2", body.error.code === "agent_warming".

   Modify `bootHarness` to accept new optional fields:
   ```typescript
   async function bootHarness(opts: {
     /* existing */
     agentIsRunning?: (agentName: string) => boolean;
     agentReadinessWaitMs?: number;
     agentReadinessPollIntervalMs?: number;
   }): Promise<TestHarness>
   ```
   and pass these through to `startOpenAiServer` when present. Do NOT change defaults for existing callers.

   Run `npx vitest run src/openai/__tests__/server.test.ts` — expect 5 new tests to FAIL until server.ts is updated.

3. **GREEN — implement in `src/openai/server.ts`**.

   a. Extend `OpenAiServerConfig`:
      ```typescript
      /** Post-v2.0 hardening — readiness probe for warm-path race. When absent, the wait gate is disabled (tests). */
      agentIsRunning?: (agentName: string) => boolean;
      /** Max wait before 503 Retry-After (default 2000ms). */
      agentReadinessWaitMs?: number;
      /** Poll interval during wait (default 50ms). */
      agentReadinessPollIntervalMs?: number;
      ```

   b. Extend `sendError` signature with optional `extraHeaders`:
      ```typescript
      function sendError(
        res: ServerResponse,
        status: number,
        type: OpenAiError["error"]["type"],
        message: string,
        code: string | null = null,
        xRequestId?: string,
        extraHeaders?: Record<string, string>,
      ): void {
        const { body } = buildOpenAiError(status, type, message, code);
        sendJson(res, status, body, xRequestId, extraHeaders);
      }
      ```
      And extend `sendJson` to merge `extraHeaders` INTO `applyCorsAndXrid`'s result before `writeHead` (so `Retry-After: 2` lands in the response).

   c. Add a helper `waitForAgentReady`:
      ```typescript
      async function waitForAgentReady(
        agentName: string,
        isRunning: (name: string) => boolean,
        waitMs: number,
        pollMs: number,
      ): Promise<boolean> {
        if (isRunning(agentName)) return true;
        const deadline = Date.now() + waitMs;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, pollMs));
          if (isRunning(agentName)) return true;
        }
        return false;
      }
      ```
      Module-private. No exports.

   d. In `handleChatCompletions`, right AFTER the model-pin check (the `if (row.agent_name !== body.model)` block ending ~line 403) and BEFORE the `touchLastUsed` call (line ~406), insert:
      ```typescript
      if (config.agentIsRunning) {
        const ready = await waitForAgentReady(
          row.agent_name,
          config.agentIsRunning,
          config.agentReadinessWaitMs ?? 2000,
          config.agentReadinessPollIntervalMs ?? 50,
        );
        if (!ready) {
          sendError(
            res,
            503,
            "server_error",
            "Agent warming up, retry shortly",
            "agent_warming",
            xRequestId,
            { "Retry-After": "2" },
          );
          return;
        }
      }
      ```

   e. In `runNonStreaming`, update the catch block at line ~495 to detect the SessionError-not-running shape:
      ```typescript
      } catch (err) {
        if (
          err instanceof Error &&
          err.name === "SessionError" &&
          err.message.includes(" is not running")
        ) {
          sendError(
            res, 503, "server_error",
            "Agent warming up, retry shortly",
            "agent_warming", xRequestId,
            { "Retry-After": "2" },
          );
          return;
        }
        log.warn({ err }, "driver failed on non-stream path");
        sendError(res, 500, "server_error", "Driver failed to produce a response", "driver_error", xRequestId);
        return;
      }
      ```
      Prefer `err.name === "SessionError"` check (works even with module duplication) over `instanceof SessionError` (which would require importing `SessionError` into server.ts — we want session-manager decoupling preserved per Plan 02 decisions).

   f. In `runStreaming`, update the catch block at line ~567 similarly. Track a local `let firstChunkEmitted = false;` and flip it after the first successful `handle.emit(c)` returns truthy. In catch:
      ```typescript
      const isWarming = err instanceof Error && err.name === "SessionError" && err.message.includes(" is not running");
      if (isWarming && !firstChunkEmitted) {
        // No chunks emitted yet — we can still write a clean 503.
        if (!res.writableEnded) {
          res.setHeader("Retry-After", "2");
          sendError(res, 503, "server_error", "Agent warming up, retry shortly", "agent_warming", xRequestId, { "Retry-After": "2" });
        }
        return;
      }
      log.warn({ err }, "driver failed mid-stream");
      handle.emitError({ error: { message: "Driver failed mid-stream", type: "server_error", code: "driver_error" } });
      ```
      Note: `startOpenAiSse` already called `res.writeHead(200, ...)` by this point in the current code — if we write headers twice we'll get an error. Mitigation: move `startOpenAiSse` creation from line ~544 to LATER — after the first driver event is successfully consumed. Simpler: re-order `runStreaming` so the try/catch has TWO phases:
        - **Phase A (pre-SSE)**: Start iterating the driver. Only call `startOpenAiSse` AFTER the first event arrives successfully. If the driver throws before any event → 503/500 JSON response (no SSE headers written yet).
        - **Phase B (in-SSE)**: Once SSE headers written, any further driver error goes through `handle.emitError`.
      This refactor is ~20 lines but cleanly separates the two error states.

   g. Wire `endpoint-bootstrap.ts`: in `startOpenAiServer({...})` call (line ~140), add `agentIsRunning: deps.sessionManager.isRunning.bind(deps.sessionManager)`. **Out-of-scope for this task** — the scope doc limits this plan to `src/openai/` + tests + `src/manager/session-manager.ts`. The `endpoint-bootstrap.ts` wire is a ONE-LINE addition that MUST land in this same commit so production picks up the behavior.

4. **Verify**.
   - `npx vitest run src/openai/__tests__/server.test.ts src/openai/__tests__/translator.test.ts src/manager/__tests__/` — all pass.
   - `npx tsc --noEmit` — zero errors.
   - Manual smoke (user runs after deploy): start daemon, immediately curl `/v1/chat/completions` — first request should either succeed (if warm-path finished in <2s) OR return 503 with `Retry-After: 2` (NOT 500 `driver_error`). Old behavior was 500 `driver_error`.

5. **Coding style**.
   - `waitForAgentReady` is pure (takes `isRunning` as a fn param — easy to test in isolation if we choose to).
   - No new exports from session-manager except `isRunning`. No new classes, no new state on SessionManager.
   - The 503 path mirrors the existing OpenAI error envelope exactly — no schema drift.
   - `extraHeaders` threading through `sendJson`/`sendError` is defensively typed (`Record<string, string> | undefined`).
  </action>
  <verify>
    <automated>npx vitest run src/openai/__tests__/server.test.ts src/openai/__tests__/translator.test.ts src/manager/__tests__/session-manager.test.ts && npx tsc --noEmit</automated>
  </verify>
  <done>
- `SessionManager.isRunning(name): boolean` added (adjacent to `getRunningAgents`). No other session-manager changes. No retry loops inside session-manager.
- `OpenAiServerConfig` has new OPTIONAL fields `agentIsRunning`, `agentReadinessWaitMs`, `agentReadinessPollIntervalMs` — Plan 02 hermetic tests still pass with no config changes.
- Handler polls `agentIsRunning` up to 2000ms (configurable) before responding 503.
- 503 response: status 503, `Retry-After: 2` header, body `{"error":{"message":"Agent warming up, retry shortly","type":"server_error","code":"agent_warming"}}`.
- Defensive catch in both `runNonStreaming` and `runStreaming` (pre-first-chunk) maps `SessionError not-running` → same 503 shape.
- `endpoint-bootstrap.ts` wires `sessionManager.isRunning.bind(...)` into the server config (one-line addition in same commit).
- 5 new server tests (W1–W5) pass; every existing test still passes.
- Zero TS errors; no regressions in `src/manager/__tests__/`.
  </done>
</task>

</tasks>

<verification>
Run the targeted suites plus tsc:

```bash
npx tsc --noEmit
npx vitest run src/openai/__tests__/translator.test.ts
npx vitest run src/openai/__tests__/server.test.ts
npx vitest run src/manager/__tests__/session-manager.test.ts
```

All four must pass.

**Deploy-after-land (orchestrator runs)**:
```bash
# From jjagpal shell on clawdy:
cd /opt/clawcode
sudo -u clawcode git pull
sudo -u clawcode npm ci
npm run build     # as jjagpal — /opt/clawcode ownership note applies
sudo systemctl restart clawcode
journalctl -u clawcode -f   # verify clean boot
```

**Manual smoke (optional, user runs after deploy)**:
1. `systemctl restart clawcode && sleep 0; curl -sS -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{"model":"clawdy","messages":[{"role":"user","content":"ping"}]}' http://localhost:PORT/v1/chat/completions -o /tmp/resp.json -w "%{http_code}\n"` — response code should be 200 OR 503 (never 500). If 503, `Retry-After: 2` must be in response headers.
2. `curl -sS -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{"model":"clawdy","messages":[{"role":"user","content":"hi"}],"stream":true,"stream_options":{"include_usage":true}}' http://localhost:PORT/v1/chat/completions` — final `data:` chunk before `[DONE]` should contain `"usage":{"prompt_tokens":...,"completion_tokens":...,"total_tokens":...}` and `"choices":[]`.
</verification>

<success_criteria>
- `stream_options.include_usage:true` → trailing chunk with `choices:[]` and non-zero `usage` numbers emitted between last content chunk and `[DONE]`. Absent/false → no trailing chunk (behavior unchanged).
- Tool-call streaming: first delta carries `{id, type:"function", function:{name}}`; subsequent deltas carry ONLY `{index, function:{arguments}}`; terminal chunk `finish_reason:"tool_calls"`; usage trailer fires when requested.
- Warm-path race: OpenAI endpoint handler waits up to 2000ms (default) for `sessionManager.isRunning(agent) === true`, then either dispatches cleanly or responds `503 Retry-After:2` with `agent_warming` code. `SessionError not-running` never surfaces as `500 driver_error` to OpenAI clients.
- Session-manager semantics unchanged: `streamFromAgent`/`nonStreamFromAgent` still throw `SessionError` on miss; no retry/backoff loops inside session-manager. The only addition is the pure `isRunning(name): boolean` helper.
- Zero TypeScript errors; every existing test passes; 17 new tests added (8 translator + 4 server tool-call + 5 server warm-path).
- Three atomic commits, one per task, matching commit types (feat/fix/test).
</success_criteria>

<output>
After completion, create `.planning/quick/260419-jtk-harden-openai-streaming-for-openclaw-emi/260419-jtk-SUMMARY.md` with:
- Files changed (6 production + test files) and line-count deltas.
- Test additions (17 new tests across translator.test.ts and server.test.ts).
- Three commit SHAs (one per task).
- Deploy-after-land checklist status (who ran `systemctl restart clawcode`, journalctl excerpt confirming clean boot).
- Any deviation from the plan (e.g., if `runStreaming` Phase-A/Phase-B refactor turned out to be unnecessary because headers weren't pre-written, document the simpler path taken).
- Smoke-test output from the two curl commands (status codes, presence/absence of usage trailer, Retry-After header value).
</output>
