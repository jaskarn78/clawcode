# Phase 69: OpenAI-Compatible Endpoint — Research

**Researched:** 2026-04-18
**Domain:** OpenAI-compatible HTTP surface over Claude Agent SDK sessions (auth + SSE + tool-use translation)
**Confidence:** HIGH (stack, patterns) / MEDIUM (tool-delta edge cases) / HIGH (existing code integration)

## Summary

Phase 69 adds a NEW HTTP listener on the existing daemon that speaks OpenAI's `/v1/chat/completions` and `/v1/models` wire format, translates requests into Claude Agent SDK `query()` calls, and streams responses back as OpenAI `chat.completion.chunk` SSE events. Session continuity is by bearer key (one API key = one ConversationStore session = one resumable Claude SDK `resume:` handle). Tool-use is bidirectional: OpenAI `tools: [{type:"function"}]` → Claude tool definitions; Claude `tool_use` content blocks → OpenAI `tool_calls[]`; client `role:"tool"` replies → Claude `tool_result` blocks on the same session.

The research is load-bearing on three things being right: (1) the OpenAI chunk shape matches what the official Python SDK expects byte-for-byte, because that is the headline compatibility proof; (2) Claude Agent SDK streaming deltas surface `input_json_delta` events that we can accumulate per-tool-call and re-emit as OpenAI `tool_calls[i].function.arguments` partial strings; (3) the existing `TurnDispatcher.dispatchStream` path we already rely on for Discord will pass through unchanged once we add the `"openai-api"` kind to `SOURCE_KINDS`.

**Primary recommendation:** Build `src/openai/server.ts` mirroring `src/dashboard/server.ts` structure (same `node:http`, same route-switching, same `SseManager`-style connection tracking). Create a new `SOURCE_KINDS` entry, a new `api-keys.db` at daemon level, an `api_key_sessions` index table in each agent's `memories.db`, and a caller-owned `Turn` path so `TurnDispatcher.dispatchStream` carries trace lineage unchanged. Accumulate Claude `input_json_delta` partial_json per `tool_use.id`, re-emit as OpenAI `tool_calls[i].function.arguments` partial strings. SHA-256 for key storage (high-entropy keys don't need Argon2), `crypto.timingSafeEqual` for comparison.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**HTTP Surface & Lifecycle**
- New listener on the existing daemon process — NOT a separate service, NOT a reuse of the dashboard server. A dedicated `openai-endpoint` module registered alongside `dashboard`, owned by `startDaemon()`, with the same shutdown hooks and log scope.
- Reuse Node.js built-in `http.createServer` — same pattern as `src/dashboard/server.ts`. Zero new HTTP framework dependencies. If a router helper is useful, build a minimal internal one.
- Separate port from dashboard — dashboard is 3100, the OpenAI endpoint gets its own default port (3101), configurable via `openai.port` in the defaults section of `clawcode.yaml` and `openai.host` for bind address (default `0.0.0.0`).
- One binary, one socket, one lifecycle — daemon boot registers the endpoint after agents are ready; daemon shutdown tears it down gracefully.

**Auth & Session Mapping (OPENAI-04, OPENAI-05)**
- Bearer key is the session boundary. One API key = one isolated ConversationStore session with the agent the key is pinned to.
- Per-key mapping stored in new daemon-level SQLite: `~/.clawcode/manager/api-keys.db` with schema `(key_hash PRIMARY KEY, agent_name, label, created_at, last_used_at, expires_at NULLABLE, disabled_at NULLABLE)`. Keys stored as SHA-256 hash, never plaintext.
- Key format: `ck_<prefix>_<32-char-random>` where `<prefix>` is the first 6 chars of the agent name (slugified). Visual ID only — runtime lookup is by hash.
- Key lifecycle CLI: `clawcode openai-key create <agent> [--label X] [--expires 30d]`, `clawcode openai-key list`, `clawcode openai-key revoke <key-or-label>`. Writes to `api-keys.db`, never prints key twice (one-shot create).
- Session-id mapping via separate index table `api_key_sessions (key_hash, session_id)` in the agent's memories.db (no change to `conversation_sessions`).
- Unknown key → 401. Known key but wrong `model` in body → 403. Error body is OpenAI-shape: `{"error": {"message": "...", "type": "...", "code": "..."}}`.

**Streaming (OPENAI-02)**
- SSE format: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`. Each chunk is `data: {...}\n\n`, final chunk is `data: [DONE]\n\n` then `\n` close.
- Chunk shape: OpenAI `chat.completion.chunk` — `id`, `object: "chat.completion.chunk"`, `created`, `model`, `choices: [{ index, delta: { role?, content? }, finish_reason? }]`. `role: "assistant"` only on the FIRST chunk.
- Backpressure: stream writes via `res.write()`; on client disconnect (`req.on('close')`), abort the underlying agent stream via the existing Turn abort path.
- Keepalive: emit a zero-width SSE comment line (`: keepalive\n\n`) every 15s if no real delta has been sent yet.

**Tool-Use Translation (OPENAI-06)**
- Request (OpenAI → Claude): `tools: [{type: "function", function: {name, description, parameters}}]` → Claude-format tools. `tool_choice: "auto" | "none" | {type: "function", function: {name}}` → Claude `tool_choice`.
- Response (Claude → OpenAI): Claude `tool_use` blocks → OpenAI `tool_calls: [{id, type: "function", function: {name, arguments (JSON string)}}]`. Claude `text` blocks → OpenAI `content` string.
- Client tool-result reply: `{role: "tool", tool_call_id, content}` → Claude `tool_result` block keyed by matching `tool_use_id`, continues same session.
- Parallel tool calls: preserve order. Both OpenAI and Claude support multiple parallel calls.
- Streaming tool deltas: accumulate across deltas and emit OpenAI-style `choices[0].delta.tool_calls[i].function.arguments` partial strings.

**TurnOrigin (OPENAI-07)**
- Add `"openai-api"` as a 5th `SOURCE_KINDS` value in `src/manager/turn-origin.ts`. Update `TURN_ID_REGEX` to include the new kind.
- Source id = first 8 chars of the key_hash hex.
- `X-Request-Id`: echo client-sent value in response header; fold into trace `metadata_json.client_request_id`. If missing, daemon generates a nanoid.
- Full trace participation — every OpenAI endpoint turn flows through `TurnDispatcher.dispatchStream`.

**Tool Registry for `/v1/chat/completions`**
- MCP tools NOT auto-exposed as OpenAI functions to the client. Agent uses MCP tools server-side via normal Claude tool-use; client sees clean assistant text.
- Exception: `tools: ["*clawcode"]` reserved pseudo-tool (defer full impl to follow-up if it bloats scope).

**ConversationStore Integration (OPENAI-05)**
- Reuse ConversationStore 100% — OpenAI-endpoint turns call `recordTurn` with `channel_id: null`, `discord_user_id: null`, `discord_message_id: null`, `is_trusted_channel: true`, and a new `origin_kind: "openai-api"` field.
- Session resume on restart via `api_key_sessions` index + ConversationStore `startSession` / `resumeSession`.
- Instruction-pattern detection (SEC-02) runs on user-message content just like Discord.

**Config Schema Additions** (under `defaults:`):
```yaml
openai:
  enabled: true           # default: true
  port: 3101              # default: 3101
  host: "0.0.0.0"         # default: "0.0.0.0"
  maxRequestBodyBytes: 1048576  # 1 MiB
  streamKeepaliveMs: 15000      # 15s
```
Zod schema → `src/config/schema.ts` as `openaiEndpointSchema`. **Name-collision note:** the YAML key `openai:` already exists under `mcpServers:` as a user-configurable MCP server entry (see `src/config/__tests__/loader.test.ts:464`). These are at different nesting levels (`mcpServers.openai` vs `defaults.openai`), so there is no actual collision — but DO keep the new endpoint section under `defaults.openai` explicitly so the two paths never get confused in docs or error messages.

**Agent Visibility**
- All configured agents appear in `/v1/models` regardless of whether any keys are assigned.
- Key-to-agent auth check happens per-request.
- Sub-agents (with `-sub-` or `-thread-` infix) NOT exposed in `/v1/models`.

**Error Shape**
```json
{
  "error": {
    "message": "Human-readable message",
    "type": "invalid_request_error | authentication_error | permission_error | server_error | rate_limit_exceeded",
    "code": "optional_machine_code"
  }
}
```
Status codes: 400 malformed, 401 missing/invalid key, 403 key-agent mismatch, 404 unknown route, 429 rate limit (future), 500 internal, 503 agent unavailable.

### Claude's Discretion

- Route parsing helper shape (inline vs extracted `route.ts`).
- Internal chunk assembly helpers (streaming-state-machine granularity).
- Exact column layout for `api_key_sessions` (beyond `key_hash` + `session_id`).
- `X-Request-Id` storage location in the trace row (new column vs `metadata_json`).
- Whether `clawcode openai-key` talks over IPC or reads/writes `api-keys.db` directly.

### Deferred Ideas (OUT OF SCOPE)

- Admin API for key management (v2.1 multi-user)
- Per-user / per-key rate limiting (v2.1)
- Billing / usage metering per key (v2.1)
- `/v1/embeddings` endpoint
- Legacy `/v1/completions` endpoint
- `tools: ["*clawcode"]` pseudo-tool (may do if simple, else defer)
- Web UI for key creation (CLI-only for v2.0)
- OAuth / OIDC authentication (v2.1+)

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OPENAI-01 | `POST /v1/chat/completions` non-stream with `model: "<agent>"` returns OpenAI-shape response populated from the agent's Claude session. | Exact non-streaming response shape documented below (Section: Standard Stack → OpenAI API Shape). `TurnDispatcher.dispatch()` already collects full response string. |
| OPENAI-02 | `stream: true` returns `text/event-stream` chunks as OpenAI SSE format with assistant deltas as agent generates. | Exact chunk shape + `[DONE]` terminator documented. Claude SDK `includePartialMessages: true` emits `stream_event` → `content_block_delta` → `text_delta` events that feed `delta.content`. `src/dashboard/sse.ts` is the reference pattern. |
| OPENAI-03 | `GET /v1/models` lists every configured agent as `{id, object: "model", owned_by: "clawcode"}`. | `resolvedAgents` already filtered to top-level agents; response shape is trivial. |
| OPENAI-04 | Per-client bearer API keys pinned to agents; missing/unknown/mismatched → 401/403. | SHA-256 hash + `crypto.timingSafeEqual` pattern; `api-keys.db` schema locked in CONTEXT.md. |
| OPENAI-05 | Same bearer key across multiple requests retains conversational memory (per-bearer-key session). | `ConversationStore.startSession/resumeSession` + Claude SDK `resume: sessionId` option already wired in `SdkSessionAdapter`; add thin `api_key_sessions` index table. |
| OPENAI-06 | OpenAI-format `tool_calls` in responses; `role: "tool"` replies translate bidirectionally. | Detailed translation mapping in Section "Tool-Use Translation Algorithm". Claude SDK already surfaces `tool_use` content blocks on `SDKAssistantMessage.message.content[]`. |
| OPENAI-07 | Every trace row has `TurnOrigin.source.kind = "openai-api"`, carries bearer fingerprint + `X-Request-Id`. | One-line update to `SOURCE_KINDS` + `TURN_ID_REGEX` in `src/manager/turn-origin.ts`; existing trace pipeline passes through unchanged. |

</phase_requirements>

## Standard Stack

### Core (already in tree — no new deps required for Phase 69)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:http` | built-in | HTTP server | Matches `src/dashboard/server.ts` — zero framework weight, works with existing pino logger + graceful shutdown. |
| `node:crypto` | built-in | SHA-256 hash, `randomBytes`, `timingSafeEqual` | SHA-256 is sufficient for high-entropy API keys (32 bytes = 256 bits of entropy). Don't reach for Argon2 — keys are not passwords. |
| `@anthropic-ai/claude-agent-sdk` | 0.2.114 (verified npm) | `query()` streaming, `resume` option | Already the foundation for every agent turn; `SDKAssistantMessage.message.content` carries `tool_use` blocks, `SDKPartialAssistantMessage` (`stream_event`) carries `content_block_delta` → `input_json_delta` for streamed tool arguments. |
| `better-sqlite3` | 12.8.0 | `api-keys.db` + `api_key_sessions` table | Same pattern as `tasks.db` (Phase 58), `delivery-queue.db`, `escalation-budget.db`. Synchronous, single-writer, perfect fit. |
| `zod` v4 | 4.3.6 | Request body validation + config schema | Already used throughout. Validate request body at the boundary before handing off to the agent — fail fast with OpenAI-shape error. |
| `nanoid` | 5.x | `X-Request-Id` fallback, session ids | Already the project id standard. |
| `pino` | 9.x | Structured logs | Match dashboard's `log.child({ name: "openai-endpoint" })` pattern. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `commander` | 14.0.3 (already) | CLI for `clawcode openai-key` subcommands | Mirror `src/cli/commands/send.ts` pattern. |
| `yaml` | 2.8.3 (already) | If you extend config examples in docs | Same loader already handles the `defaults.openai` block once the zod schema is added. |

### Alternatives Considered (for the record — DO NOT USE)

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `node:http` | **Hono** 4.12.14 | Hono is delightful (15KB, middleware, typed routes). BUT: adds a dep, the dashboard is already `node:http`, and consistency matters more than ergonomics for a second listener inside the same process. If we ever rewrite the dashboard to Hono, revisit — not today. |
| `node:http` | **Fastify** 5.8.5 | Overkill. Schema validation overlaps with zod; we'd run validation twice. |
| SHA-256 + random | **bcrypt / Argon2id** | Wrong tool for random high-entropy tokens. OWASP password guidance does not apply to 32-byte random strings — verification cost for every request would be severe (14-agent fleet × hot path). |
| Plain `===` for hash compare | `crypto.timingSafeEqual` | Timing side-channels on byte-by-byte compare. Use `timingSafeEqual` — both args MUST be same-length Buffers. |
| `jose` / JWT | opaque random bearer | JWTs imply stateless validation and revocation headaches. Opaque keys + server-side hash table is the OpenAI model and matches our locked decisions. |
| Streaming via WebSocket | SSE over `text/event-stream` | OpenAI clients expect SSE. Period. |

### Installation

Zero new runtime dependencies for core functionality — everything required already ships in the current `package.json` (`better-sqlite3`, `zod`, `nanoid`, `pino`, `@anthropic-ai/claude-agent-sdk`, `commander`).

For the headline E2E smoke test (Python OpenAI SDK), install OUTSIDE the project:

```bash
# Headline E2E smoke — not a runtime dep
pip install openai
```

For dev-only smoke against the endpoint from Node.js (optional, test-only):

```bash
npm install --save-dev openai@6.34.0
```

**Version verification (npm view, 2026-04-18):**
- `@anthropic-ai/claude-agent-sdk@0.2.114` — latest
- `openai@6.34.0` — latest (dev-only peer for smoke tests)
- `hono@4.12.14` — latest (NOT used)
- `fastify@5.8.5` — latest (NOT used)

## Architecture Patterns

### Recommended Project Structure

```
src/openai/                        # NEW directory
├── server.ts                      # node:http listener — mirrors src/dashboard/server.ts
├── routes.ts                      # inline route table: /v1/chat/completions, /v1/models
├── auth.ts                        # bearer-key extraction, hash + timingSafeEqual lookup
├── translator.ts                  # OpenAI↔Claude tool-use translation (pure fns)
├── stream.ts                      # SSE writer: chunk shape, keepalive, client-disconnect
├── api-keys-store.ts              # api-keys.db CRUD (SHA-256 storage)
├── session-index.ts               # api_key_sessions table ops (per-agent memories.db)
├── types.ts                       # OpenAI request/response zod schemas + TS types
└── __tests__/
    ├── server.test.ts
    ├── translator.test.ts
    ├── stream.test.ts
    └── auth.test.ts

src/cli/commands/
└── openai-key.ts                  # NEW — create | list | revoke subcommands

src/manager/turn-origin.ts         # ADD "openai-api" to SOURCE_KINDS + TURN_ID_REGEX
src/config/schema.ts               # ADD openaiEndpointSchema under defaults
src/manager/daemon.ts              # ADD startOpenAiServer() after dashboard, before final return
```

### Pattern 1: Mirror the Dashboard Server Shape

**What:** Use `createServer((req, res) => handleRequest(...))` + `server.listen(port, host)`, same close hook as dashboard, same pino child logger.

**When to use:** Every route in this phase. Do NOT introduce a framework.

**Example (load-bearing structure):**
```typescript
// Source: src/dashboard/server.ts (lines 74-112 — existing pattern)
export async function startOpenAiServer(config: OpenAiServerConfig): Promise<{
  readonly server: ReturnType<typeof createServer>;
  readonly close: () => Promise<void>;
}> {
  const log = pino({ name: "openai-endpoint", level: "info" });
  const server = createServer((req, res) => {
    void handleRequest(req, res, config, log);
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(config.port, config.host, () => {
      log.info({ port: config.port, host: config.host }, "OpenAI endpoint started");
      resolve({
        server,
        close: async () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}
```

### Pattern 2: Caller-Owned Turn via TurnDispatcher

**What:** Open a Turn via `TraceCollector.startTurn(turnId, agentName, null)`, pass it to `dispatchStream` via `options.turn` so the dispatcher does NOT end it on our behalf. We call `turn.end("success"|"error")` after SSE completion/abort. This is the same contract DiscordBridge uses (Phase 57 Plan 03).

**When to use:** Every OpenAI request. This is how prompt caching + first-token SLO + cache telemetry all come along for free.

**Example:**
```typescript
// Source: src/manager/turn-dispatcher.ts:107-126 (existing contract)
const origin = makeRootOriginWithTurnId(
  "openai-api",
  /* sourceId */ keyHashHexPrefix8,
  /* turnId */ `openai-api:${nanoid(10)}`,
);
const collector = sessionManager.getTraceCollector(agentName);
const turn = collector?.startTurn(origin.rootTurnId, agentName, null);
try {
  await turnDispatcher.dispatchStream(
    origin,
    agentName,
    userMessage,
    (accumulated) => { emitOpenAIDelta(res, accumulated, lastEmitted); },
    { turn, signal: abortController.signal, channelId: null },
  );
  turn?.end("success");
} catch (err) {
  turn?.end("error");
  throw err;
}
```

### Pattern 3: OpenAI API Shape (HIGH confidence — pinned to current spec)

**Non-streaming response** (`POST /v1/chat/completions` with `stream: false`):
```json
{
  "id": "chatcmpl-<nanoid>",
  "object": "chat.completion",
  "created": 1744934400,
  "model": "clawdy",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "Hello, human.",
      "tool_calls": null
    },
    "finish_reason": "stop",
    "logprobs": null
  }],
  "usage": {
    "prompt_tokens": 0,
    "completion_tokens": 0,
    "total_tokens": 0
  },
  "system_fingerprint": null
}
```

**Streaming chunk** (`Content-Type: text/event-stream`, line format `data: {...}\n\n`):
```json
// First chunk — role appears EXACTLY ONCE
{"id":"chatcmpl-xyz","object":"chat.completion.chunk","created":1744934400,"model":"clawdy","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}

// Subsequent content chunks — no role, just content delta
{"id":"chatcmpl-xyz","object":"chat.completion.chunk","created":1744934400,"model":"clawdy","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

// Final chunk — empty delta, finish_reason populated
{"id":"chatcmpl-xyz","object":"chat.completion.chunk","created":1744934400,"model":"clawdy","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

// Terminator (literal bytes)
data: [DONE]\n\n
```

**Valid `finish_reason` values:** `"stop"` (normal completion), `"length"` (max tokens hit), `"tool_calls"` (model chose a tool — assistant message emits tool_calls), `"content_filter"` (safety filter), `"function_call"` (deprecated, legacy).

**Tool-call streaming chunk shape:**
```json
// First tool-call chunk for each index — id + type + function.name appear here
{"id":"chatcmpl-xyz","object":"chat.completion.chunk","created":1744934400,"model":"clawdy","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_abc","type":"function","function":{"name":"get_weather","arguments":""}}]},"finish_reason":null}]}

// Subsequent chunks — only arguments partial string, keyed by tool_calls[].index
{"id":"chatcmpl-xyz","object":"chat.completion.chunk","created":1744934400,"model":"clawdy","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"city\":"}}]},"finish_reason":null}]}

{"id":"chatcmpl-xyz","object":"chat.completion.chunk","created":1744934400,"model":"clawdy","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"NYC\"}"}}]},"finish_reason":null}]}

// Final chunk for a tool-call turn — finish_reason = "tool_calls", delta is empty
{"id":"chatcmpl-xyz","object":"chat.completion.chunk","created":1744934400,"model":"clawdy","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}
```

**Usage in streaming:** ONLY included if the request had `stream_options: {"include_usage": true}`. When present, it appears in a separate final chunk after the `finish_reason` chunk, with `choices: []` (empty) and `usage: {...}` populated. Most clients don't set this.

**ChatCompletionMessage (tool_calls in non-streaming):**
```json
{
  "role": "assistant",
  "content": null,
  "tool_calls": [
    {
      "id": "call_abc",
      "type": "function",
      "function": {
        "name": "get_weather",
        "arguments": "{\"city\":\"NYC\"}"
      }
    }
  ]
}
```

Note that `content` is `null` when there are tool_calls AND no assistant text (common case). `arguments` is a JSON string (client parses it).

**Client tool-result request shape:**
```json
{
  "model": "clawdy",
  "messages": [
    { "role": "user", "content": "What's the weather?" },
    { "role": "assistant", "content": null, "tool_calls": [{"id":"call_abc","type":"function","function":{"name":"get_weather","arguments":"{\"city\":\"NYC\"}"}}] },
    { "role": "tool", "tool_call_id": "call_abc", "content": "72F, sunny" }
  ]
}
```

### Pattern 4: Tool-Use Translation Algorithm

**Request translation (client OpenAI body → Claude SDK call):**

| OpenAI field | Claude equivalent | Notes |
|--------------|-------------------|-------|
| `messages: [{role:"user", content:"..."}]` | `prompt: "..."` (string) | Take LAST user message only per session (session already has prior turns via `resume:`). |
| `messages: [{role:"system", content:"..."}]` | Appended via `systemPrompt.append` | DO NOT override — the agent's identity/soul/skills stablePrefix is cached. Only append. |
| `messages: [{role:"assistant", ...}]` prior to last user | IGNORE — session has state | Client may send full history; our `resume:` path already has it. |
| `messages: [{role:"tool", tool_call_id, content}]` | Claude `tool_result` block | Construct `{type: "tool_result", tool_use_id: tool_call_id, content}` in the SDK input. |
| `tools: [{type:"function", function:{name, description, parameters}}]` | Per-turn tool list on SDK query | **Only if agent config supports it.** Locked decision: client-declared tools only (no MCP passthrough) unless `tools:["*clawcode"]`. |
| `tool_choice: "auto"` | Claude default | Default. |
| `tool_choice: "none"` | Set `tool_choice: {type:"none"}` on SDK | |
| `tool_choice: {type:"function", function:{name}}` | Set `tool_choice: {type:"tool", name}` | Note Claude uses `type:"tool"`, not `type:"function"`. |

**Response translation (Claude SDK events → OpenAI chunks):**

| Claude event | OpenAI emit | Notes |
|--------------|-------------|-------|
| First `stream_event` with `content_block_start` of type `text` | Emit first chunk `delta: {role:"assistant", content:""}` | Role appears exactly once. |
| `stream_event` with `content_block_delta.delta.type === "text_delta"` and `delta.text` | Emit `delta: {content: delta.text}` | Append-only content stream. |
| `stream_event` with `content_block_start` of type `tool_use` (fields: `id`, `name`) | Emit `delta: {tool_calls:[{index, id, type:"function", function:{name, arguments:""}}]}` | Assign `index` based on order encountered; track by `tool_use.id` → `index`. |
| `stream_event` with `content_block_delta.delta.type === "input_json_delta"` and `delta.partial_json` | Emit `delta: {tool_calls:[{index, function:{arguments: partial_json}}]}` | OpenAI clients concatenate these. |
| `stream_event` with `content_block_stop` | (no OpenAI emit) | Boundary marker only; wait for final `result` to decide `finish_reason`. |
| `result` message with text-only content and no tool_use | Emit final chunk `delta: {}, finish_reason:"stop"` then `data: [DONE]` | |
| `result` message whose last assistant message contained any `tool_use` blocks | Emit final chunk `delta: {}, finish_reason:"tool_calls"` then `data: [DONE]` | After emitting this chunk, the server closes; the client will POST back a tool message with `tool_call_id`. |
| SDK error message (`result.is_error` or `subtype !== "success"`) | Emit OpenAI error shape as a final chunk OR close stream with an error event | Pragmatic: emit final chunk with `finish_reason:"stop"` + best-effort content, log server-side. Strict: emit OpenAI error-event SSE frame. Recommend pragmatic — matches OpenAI's own behavior of degrading rather than failing mid-stream. |

**Parallel tool calls:** When Claude emits multiple `tool_use` content blocks in the same assistant message, each gets its own `index` in the OpenAI `tool_calls` array (0, 1, 2, ...). Arguments for each are interleaved — use the `tool_use.id` to map back to the correct `index`. Both providers support parallel; preserve order.

### Pattern 5: SSE Writer with Keepalive + Backpressure

**Structure:**
```typescript
// Source: patterns derived from src/dashboard/sse.ts:47-66 and Anthropic SDK docs
function startOpenAiSse(res: ServerResponse, config: { keepaliveMs: number }): {
  emit: (chunk: OpenAiChunk) => boolean;
  emitDone: () => void;
  close: () => void;
} {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no", // nginx: disable response buffering
  });

  let firstDeltaSent = false;
  const keepalive = setInterval(() => {
    if (!firstDeltaSent) {
      try { res.write(": keepalive\n\n"); } catch { /* socket closed */ }
    }
  }, config.keepaliveMs);

  return {
    emit(chunk) {
      firstDeltaSent = true;
      const body = `data: ${JSON.stringify(chunk)}\n\n`;
      return res.write(body); // false => pause source until 'drain'
    },
    emitDone() {
      res.write("data: [DONE]\n\n");
      res.end();
      clearInterval(keepalive);
    },
    close() {
      clearInterval(keepalive);
      if (!res.writableEnded) res.end();
    },
  };
}
```

**Client-disconnect wiring:**
```typescript
const ac = new AbortController();
req.on("close", () => ac.abort());
// Pass ac.signal to turnDispatcher.dispatchStream options.signal
// Existing path: src/manager/session-adapter.ts:544-548 already wires signal → SDK abortController.
```

### Anti-Patterns to Avoid

- **Mutating Claude's cached stable prefix.** The agent's identity/soul/skills prefix is where prompt-cache hits come from. NEVER override `systemPrompt` based on the OpenAI request's `role: "system"` message — only `append`. (CONTEXT already states this; enforce in translator.)
- **Per-request session creation.** Session MUST be looked up by `key_hash` in `api_key_sessions`, created lazily on first request only, then reused forever. Creating a new session per request breaks OPENAI-05 and defeats prompt caching.
- **Trusting request body `messages` for history.** Client may send `[user1, asst1, user2]`; the agent SDK already has that via `resume:`. Extract only the last user message and any `role:"tool"` reply. Fully-stateful clients will be correct; stateless clients will get duplicate context. Document: "send only the newest turn".
- **Blocking the event loop on SSE writes.** `res.write()` returns `false` when the buffer is full. Respect backpressure: if false, wait for `"drain"` before emitting the next chunk. For a Claude agent generating at ~50 tokens/sec, this rarely triggers but MUST be handled.
- **Swallowing client-disconnects.** A disconnected client that keeps the agent generating burns budget for nothing. Wire `req.on("close")` → `AbortController.abort()` → SDK `options.abortController.abort()`.
- **Printing API keys more than once.** `clawcode openai-key create` MUST print the key to stdout exactly once, then never again. Storage is hash-only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP request routing | Custom framework | `node:http` + manual if-branches (mirror dashboard) | Already the project pattern; we have <10 routes total. |
| Request body parsing | Naive `on("data")` concat without size limit | Cap at `maxRequestBodyBytes` (1 MiB) — abort request with 413 if exceeded | Prevents slow-loris + memory blowup. |
| Claude tool-use parsing | Regex or string split on SDK output | Walk `SDKAssistantMessage.message.content: BetaContentBlock[]` discriminated union | SDK gives you typed blocks; parsing text is a bug factory. |
| Partial JSON accumulation for tool args | Roll your own JSON repair | Accumulate raw `partial_json` strings per `tool_use.id`, only `JSON.parse` when you need the full object (you never do — OpenAI wants the JSON string anyway) | Claude's `input_json_delta.partial_json` is safe to concatenate; final assembled string == valid JSON. Per Anthropic docs, don't parse mid-stream. |
| SSE framing | `res.write` of plain JSON lines | Strict `data: <json>\n\n` + terminal `data: [DONE]\n\n` + final `\n` | Python SDK's parser is strict — missing blank line delimiter breaks it. |
| Session ID generation | Invent a new id | Use Claude SDK's `result.session_id` (already flows into ConversationStore; `SdkSessionAdapter` captures it) | Single source of truth. |
| API key hashing | Argon2 / bcrypt | SHA-256 with `crypto.timingSafeEqual` compare | High-entropy random tokens do not need slow hashing; verification would throttle the hot path. |
| Key-format parsing to pre-filter | Regex `^ck_[a-z]{6}_[a-zA-Z0-9]{32}$` before hash lookup | Just hash whatever came in and look up | Saves exactly nothing (hash is ~microsecond); parsing creates a false sense of validation and a bug surface. |
| Bearer-token extraction | Naive `split(" ")[1]` | `auth.startsWith("Bearer ") ? auth.slice(7).trim() : null` + case-insensitive header lookup | Node.js lowercases all request headers; use `req.headers.authorization`. |
| Per-endpoint Zod + runtime type casts | Double-validation | Parse request body once at the boundary; pass typed objects downstream | Consistent with project pattern; `zod v4` schemas in `src/openai/types.ts`. |

**Key insight:** every piece of the OpenAI surface has a "clever" shortcut that fails in production. The SDK is the source of truth for tool-use shape; `crypto.timingSafeEqual` is the only safe comparator; `data: ...\n\n` is load-bearing down to the exact whitespace. Be boring here.

## Runtime State Inventory

This phase introduces state; it does not rename or refactor existing state. Included for completeness to flag the NEW artifacts the planner must include in backup/restore docs and plan setup tasks for.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | NEW: `~/.clawcode/manager/api-keys.db` (daemon-scoped, SQLite). NEW: `api_key_sessions (key_hash TEXT, session_id TEXT)` table in each agent's `memories.db`. | New migration + schema constants; add to backup scripts if they exist. No data migration (greenfield tables). |
| Live service config | Existing dashboard port 3100 unchanged. NEW listener on 3101 (configurable). Document the new bind address in the README + Tailscale ACL examples. | Document port. Update any firewall/Tailscale guidance. |
| OS-registered state | None — service is part of existing daemon. | None. |
| Secrets/env vars | NEW env overrides: `CLAWCODE_OPENAI_HOST`, `CLAWCODE_OPENAI_PORT` (mirror `CLAWCODE_DASHBOARD_*` convention). No new secret keys (API keys are stored in `api-keys.db`, not env). | Document env vars in README. |
| Build artifacts | New `dist/openai/*.js` from the build. No static assets. | tsup already scans `src/` — no config change needed. |

**Notes on migrations:**
- `api-keys.db` — create-if-missing on daemon boot, with a versioned `schema_version` table in the same DB (follow the pattern used by `tasks.db` in Phase 58).
- `api_key_sessions` — add via `MemoryStore.migrateConversationTables()` pattern (see `src/memory/store.ts`). Read it to confirm the exact migration hook name; typically a new `migrateApiKeySessionsTable()` method or a named migration in a migration list.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | ✓ | 22 LTS (project locked) | — |
| `@anthropic-ai/claude-agent-sdk` | SDK streaming | ✓ | 0.2.114 (npm latest) | — |
| `better-sqlite3` | api-keys.db | ✓ | 12.8.0 | — |
| `zod` v4 | Request validation | ✓ | 4.3.6 | — |
| Port 3101 on host | HTTP listener | ⚠️ host-dependent | — | If taken, operator sets `CLAWCODE_OPENAI_PORT` — daemon should log a clear error and continue (mirror dashboard's "non-fatal if port taken" pattern at `src/manager/daemon.ts:1184-1189`). |
| Python `openai` SDK | Headline E2E smoke test | ⚠️ test host only | 6.x (pip) | Fallback: `curl` + `jq` scripted test that issues the same requests. Recommend both. |
| `openai` npm | Test-only smoke in Vitest | optional | 6.34.0 | Fallback: raw `fetch` to `/v1/chat/completions` from vitest. Recommend not adding a dev dep — vitest tests can call the endpoint with `fetch()` directly once the server is up. |

**Missing dependencies with no fallback:** none — project already ships everything needed.
**Missing dependencies with fallback:** Python `openai` SDK for the headline E2E proof. If Python isn't on the dev machine, use `curl` scripts in a `scripts/openai-smoke.sh`.

## Common Pitfalls

### Pitfall 1: Partial JSON Accumulation Across Multiple Tool Calls
**What goes wrong:** Claude emits `input_json_delta` events interleaved across multiple parallel `tool_use` blocks, but OpenAI's `tool_calls[].index` field indexes into a SINGLE assistant message's tool-call array. If the translator uses `tool_use.id` directly as the OpenAI index, non-deterministic ordering breaks client reassembly.
**Why it happens:** Claude identifies blocks by `id`; OpenAI identifies them by position (`index`).
**How to avoid:** Maintain a `Map<tool_use_id, openaiIndex>` per assistant message. First time you see a `content_block_start` of type `tool_use`, assign the next sequential index (starting from 0). Every subsequent `input_json_delta` for that id emits under the assigned index. Reset the map at each `result` message boundary.
**Warning signs:** Python SDK raises `ValidationError: tool_calls[1].id missing` — you emitted the id on index 0 but never on index 1.

### Pitfall 2: OpenAI SDK Strict Field Requirements
**What goes wrong:** Python `openai` SDK v1.x+ uses Pydantic models with `model_config = ConfigDict(extra="allow")` but still validates types strictly. Missing `id`, `object`, `created`, `model` at the top level → `ValidationError`. Missing `index` on a choice → `ValidationError`. `usage` field populated as empty dict `{}` instead of either the full object or absent → `ValidationError`.
**Why it happens:** OpenAI's Pydantic schemas are strict about presence, loose about extra.
**How to avoid:** Always emit `id`, `object`, `created`, `model` on every chunk. Emit `usage` as EITHER a fully-populated `{prompt_tokens, completion_tokens, total_tokens}` object OR omit it entirely (not `{}`). For our case (we don't have token counts): send `usage: {prompt_tokens: 0, completion_tokens: 0, total_tokens: 0}` on the non-stream response, and OMIT `usage` on stream chunks unless the client requested `stream_options: {include_usage: true}`.
**Warning signs:** Python client `ValidationError: ... field required` errors on the first response.

### Pitfall 3: Role Field on Non-First Chunk
**What goes wrong:** Emitting `role: "assistant"` on every streaming delta. Some SDK parsers tolerate it; some raise.
**Why it happens:** The OpenAI spec is explicit — `role` is in the delta of the FIRST chunk only, omitted on subsequent chunks.
**How to avoid:** Track `firstDeltaSent` bool in the stream writer. First content delta carries `{role: "assistant", content: ""}` (empty string is explicit). Every subsequent delta carries only the new content / tool_calls fields.
**Warning signs:** LibreChat shows duplicate "assistant" badges; LangChain throws an exception.

### Pitfall 4: Missing `\n\n` SSE Delimiter
**What goes wrong:** `res.write("data: " + JSON.stringify(chunk) + "\n")` — single newline. Python SDK expects `\n\n` (blank line after data). Result: SDK buffers forever waiting for the delimiter, then times out.
**Why it happens:** SSE spec mandates double-newline as event boundary. Easy to typo.
**How to avoid:** Centralize SSE writing through one function (`emit(chunk)` above). Unit test: string ends with `\n\n`.
**Warning signs:** Python SDK appears to hang; no error; no chunks received.

### Pitfall 5: Nginx/Cloudflare Buffering Destroying Stream
**What goes wrong:** Reverse proxies buffer the entire response before forwarding. `stream: true` turns into a single huge payload delivered after generation completes. Users see no tokens until completion.
**Why it happens:** Nginx default `proxy_buffering on`. Cloudflare adds its own buffering.
**How to avoid:** Set `X-Accel-Buffering: no` response header (tells Nginx). Set `Cache-Control: no-cache, no-transform` (tells CDNs). Tailscale-direct deployments are fine; the header is cheap insurance.
**Warning signs:** `curl` sees streaming, but the same endpoint through a reverse proxy appears to block.

### Pitfall 6: Timing-Safe Comparison With Wrong Buffer Length
**What goes wrong:** `crypto.timingSafeEqual(a, b)` throws synchronously if `a.byteLength !== b.byteLength`. A malicious client sending a short key crashes the request handler.
**Why it happens:** Node's `timingSafeEqual` does not itself compare lengths safely — it requires pre-equal lengths.
**How to avoid:** Always hash the incoming token first (produces a fixed-length SHA-256 digest), then compare hashes. Both digests are 32 bytes — always equal length.
```typescript
const incomingHash = crypto.createHash("sha256").update(tokenBytes).digest(); // 32 bytes
const storedHash = Buffer.from(storedHashHex, "hex"); // 32 bytes
const match = crypto.timingSafeEqual(incomingHash, storedHash);
```
**Warning signs:** `RangeError: Input buffers must have the same byte length` under attack-shaped requests.

### Pitfall 7: Session Continuity Broken by SDK Version Drift
**What goes wrong:** `@anthropic-ai/claude-agent-sdk` is pre-1.0 (0.2.x). Between minor versions, the shape of `SDKPartialAssistantMessage.event` has changed. The OpenAI translator locks into a specific event-tag shape and silently produces empty deltas after an SDK bump.
**Why it happens:** Pre-1.0 stability.
**How to avoid:** Pin `@anthropic-ai/claude-agent-sdk` to an exact version (not caret). Add a regression test in `src/openai/__tests__/translator.test.ts` that asserts on a recorded-fixture of SDK stream messages → expected OpenAI chunks.
**Warning signs:** Clients receive `[DONE]` with no content after an SDK upgrade.

### Pitfall 8: Prompt-Cache Miss on OpenAI Path
**What goes wrong:** Discord's cached stable prefix is 10-15K tokens of identity/soul/skills. If the OpenAI translator mutates `systemPrompt` (e.g., overwrites it with the client's `role:"system"` message), the prefix hash changes and every request pays full input cost.
**Why it happens:** Careless translation treating `role:"system"` as an override.
**How to avoid:** Client `role:"system"` content ONLY appends to the stablePrefix via `systemPrompt.append`, never replaces. Match the existing `buildSystemPromptOption(stablePrefix)` helper in `src/manager/session-adapter.ts:306-315`.
**Warning signs:** `clawcode cache` shows hit-rate drop after OpenAI endpoint deploys; first_token p95 regresses.

### Pitfall 9: Request Body Truncation (Content-Type charset)
**What goes wrong:** Client sends `Content-Type: application/json; charset=utf-8`. Naive check `if (contentType === "application/json")` fails, server returns 400.
**Why it happens:** HTTP allows parameters on the media type.
**How to avoid:** `req.headers["content-type"]?.toLowerCase().startsWith("application/json")`. Or parse via a helper that ignores parameters.
**Warning signs:** Python `requests` / `httpx` work; Node `fetch` with explicit charset fails.

### Pitfall 10: Graceful Shutdown With In-Flight Streams
**What goes wrong:** `server.close()` waits for all connections to drain. SSE connections live indefinitely. Daemon shutdown hangs.
**Why it happens:** `server.close()` does not forcibly close active connections.
**How to avoid:** On shutdown signal, iterate active SSE connections and call `res.end()` first, THEN call `server.close()`. Maintain a `Set<ServerResponse>` of live streams (same pattern as `SseManager.clients` in `src/dashboard/sse.ts:31`).
**Warning signs:** `systemctl stop clawcode` takes longer than the configured timeout; requires `SIGKILL`.

## Code Examples

Verified patterns from official sources.

### A. Extracting Session ID from Claude Agent SDK

```typescript
// Source: src/manager/session-adapter.ts:456-471 (already in-tree pattern)
// SDK yields a 'result' message at the end of each query with session_id populated.
for await (const msg of query) {
  if (msg.type === "result" && msg.session_id) {
    sessionId = msg.session_id;
    break;
  }
}
```

### B. Resuming a Session

```typescript
// Source: https://code.claude.com/docs/en/agent-sdk/typescript (verified 2026-04-18)
// Already used at src/manager/session-adapter.ts:380
const q = query({
  prompt: userMessage,
  options: {
    model: "claude-sonnet-4-5",
    resume: sessionId,            // re-enter existing session
    // forkSession: true,          // OPTIONAL — branch without consuming original
    systemPrompt: { type: "preset", preset: "claude_code", append: stablePrefix },
    includePartialMessages: true, // required for stream_event/token-level deltas
    abortController,
  },
});
```

### C. Tool-Use Content Block Iteration

```typescript
// Source: Claude Agent SDK docs — SDKAssistantMessage.message.content is BetaContentBlock[]
// Existing usage at src/manager/session-adapter.ts:659-694
for await (const msg of query) {
  if (msg.type === "assistant" && msg.parent_tool_use_id === null) {
    for (const block of msg.message.content) {
      if (block.type === "text") {
        // emit OpenAI content delta
      } else if (block.type === "tool_use") {
        // block.id, block.name, block.input (fully assembled at message end)
        // In streaming, input is built up via input_json_delta events
      }
    }
  }
  if (msg.type === "stream_event") {
    const event = msg.event; // BetaRawMessageStreamEvent
    // event.type === "content_block_delta"
    // event.delta.type === "text_delta" OR "input_json_delta"
    // event.delta.text OR event.delta.partial_json
  }
}
```

### D. Bearer Key Hash Lookup

```typescript
// Source: Node.js crypto docs + OWASP API key guidance (verified 2026-04-18)
import crypto from "node:crypto";

function hashApiKey(key: string): Buffer {
  return crypto.createHash("sha256").update(key, "utf8").digest();
}

function verifyKey(incoming: string, storedHashHex: string): boolean {
  const incomingHash = hashApiKey(incoming);
  const storedHash = Buffer.from(storedHashHex, "hex");
  if (incomingHash.byteLength !== storedHash.byteLength) return false;
  return crypto.timingSafeEqual(incomingHash, storedHash);
}

function generateApiKey(agentPrefix: string): { key: string; hashHex: string } {
  const random = crypto.randomBytes(24).toString("base64url"); // ~32 chars
  const slug = agentPrefix.slice(0, 6).toLowerCase().replace(/[^a-z0-9]/g, "");
  const key = `ck_${slug}_${random}`;
  const hashHex = hashApiKey(key).toString("hex");
  return { key, hashHex };
}
```

### E. SSE Chunk Emit with Backpressure

```typescript
// Source: Node.js docs (nodejs.org/learn/modules/backpressuring-in-streams)
async function emitChunk(res: ServerResponse, chunk: object): Promise<void> {
  const body = `data: ${JSON.stringify(chunk)}\n\n`;
  if (!res.write(body)) {
    // Buffer full — wait for 'drain' before returning, so the caller doesn't race ahead.
    await new Promise<void>((resolve) => res.once("drain", () => resolve()));
  }
}
```

### F. OpenAI Python SDK Smoke Test (Headline Proof — OPENAI-01/02)

```python
# Source: CONTEXT.md — canonical acceptance test
from openai import OpenAI

# Non-streaming
client = OpenAI(base_url="http://clawdy:3101/v1", api_key="ck_clawdy_XXXX")
r = client.chat.completions.create(model="clawdy", messages=[{"role": "user", "content": "hi"}])
assert r.choices[0].message.content
assert r.id.startswith("chatcmpl-")

# Streaming
stream = client.chat.completions.create(
    model="clawdy",
    messages=[{"role": "user", "content": "hi"}],
    stream=True,
)
for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
```

If this script runs clean against the endpoint, OPENAI-01 and OPENAI-02 are satisfied.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Polling + WebSockets for LLM streaming | Server-Sent Events over `text/event-stream` | Industry consensus 2023+ | OpenAI's wire format is SSE-only for chat completions. WebSocket is reserved for Realtime API (out of scope here). |
| `function_call` (singular, deprecated) | `tool_calls: [...]` array | OpenAI deprecated `function_call` in 2024 | Support `tool_calls` only. `finish_reason: "function_call"` is legacy — emit `"tool_calls"`. |
| `@xenova/transformers` | `@huggingface/transformers` | 2025 package rename | Only affects embeddings path; not relevant to Phase 69. |
| `sqlite-vss` | `sqlite-vec` | 2024 deprecation | Already handled by project. |
| bcrypt for all tokens | SHA-256 for high-entropy random tokens, Argon2id for passwords | OWASP 2024+ API key guidance | SHA-256 is correct here. |
| Single-shot tool call in completion | Streaming tool_calls with `delta.tool_calls[index].function.arguments` partial strings | OpenAI added streaming tools in 2024 | Must implement; the Python SDK client-side concatenates partial `arguments` strings per-index. |

**Deprecated / outdated:**
- `function_call` field (singular) — legacy only; emit `tool_calls` array.
- `role: "function"` legacy response messages — use `role: "tool"` with `tool_call_id`.
- `openai.Completion.create` legacy endpoint — out of scope.

## Open Questions

1. **Should `usage` ever be populated with real token counts?**
   - What we know: Claude Agent SDK's `result` message carries `usage.input_tokens` and `usage.output_tokens` (see `src/manager/session-adapter.ts:487-488`). We could translate these to `prompt_tokens` and `completion_tokens`.
   - What's unclear: Whether the token semantics align (Claude counts cache-read tokens separately; OpenAI has `prompt_tokens_details.cached_tokens`).
   - Recommendation: Populate `usage` with Claude's counts on the NON-STREAM response always. On streaming, only emit if `stream_options.include_usage: true`. Document the mapping: `prompt_tokens = usage.input_tokens + usage.cache_read_input_tokens`, `completion_tokens = usage.output_tokens`, `total_tokens = prompt + completion`, `prompt_tokens_details.cached_tokens = usage.cache_read_input_tokens`.

2. **Should `clawcode openai-key` use IPC to the daemon, or read/write `api-keys.db` directly?**
   - What we know: CLI-vs-daemon coordination is already a pattern — `clawcode costs`, `clawcode latency` etc. use IPC.
   - What's unclear: Does `api-keys.db` require exclusive access that would conflict with the daemon's connection?
   - Recommendation: **IPC when daemon is up, direct file read/write when daemon is down.** better-sqlite3 in WAL mode allows concurrent reads; writes are serialized. Use IPC methods `openai-key-create`, `openai-key-list`, `openai-key-revoke` when available; fall back to direct DB ops (read-only for `list`) if IPC fails. This matches `clawcode status` which gracefully handles "daemon not running".

3. **How to surface OpenAI errors from mid-stream Claude errors?**
   - What we know: SDK emits `result` with `is_error: true` and `subtype` like `error_max_turns`. No content was streamed.
   - What's unclear: OpenAI spec does not define a mid-stream error format in common SSE — clients vary in how they handle a broken stream.
   - Recommendation: Pragmatic approach: emit final chunk with `finish_reason: "stop"` + whatever content was generated, log the error server-side, surface it via the daemon log + `clawcode trace <turn_id>`. If the error happens BEFORE any content chunk, close with `finish_reason: "stop"` and empty content — client sees a "model replied with nothing" which they can diagnose. Document this behavior explicitly in README. Revisit if real users hit it.

4. **Should `/v1/models` include Claude model names or only ClawCode agent names?**
   - What we know: CONTEXT.md locks "all configured agents appear". But OpenAI convention is `gpt-4o`, not a user-chosen name.
   - What's unclear: Does any client expect a standard model id format?
   - Recommendation: Use agent names as `id`. Add `owned_by: "clawcode"` to make the non-OpenAI origin clear. A client that hard-codes `gpt-4o` won't work — that's intentional, the user has to configure `model: "clawdy"` explicitly.

5. **Retry semantics on SDK abort during stream.**
   - What we know: Aborted SDK query throws; we catch and call `turn.end("error")`.
   - What's unclear: If the client reconnects with the same session key, do they expect to pick up where the stream ended, or is the turn lost?
   - Recommendation: Treat each HTTP request as an atomic turn. A client that disconnects mid-stream and reconnects starts a new turn. The ConversationStore may or may not have captured the partial assistant output (depends on whether `result` arrived). Document: "aborted streams are not resumable". Follow-up phase if users complain.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.3 |
| Config file | `vitest.config.ts` (repo root — confirm; all existing tests run via `npm test`) |
| Quick run command | `npx vitest run src/openai --reporter=verbose` |
| Full suite command | `npm test` |
| Phase gate | Full suite green before `/gsd:verify-work`; Python OpenAI-SDK smoke (`pytest scripts/openai-smoke/` or `python scripts/openai-smoke.py`) green before phase close. |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OPENAI-01 | POST /v1/chat/completions (non-stream) returns OpenAI-shape response. | integration | `npx vitest run src/openai/__tests__/server.test.ts -t "non-stream chat completion"` | ❌ Wave 0 |
| OPENAI-02 | stream:true emits OpenAI SSE chunks with correct first/middle/final shapes + `[DONE]`. | integration | `npx vitest run src/openai/__tests__/server.test.ts -t "streaming chat completion"` | ❌ Wave 0 |
| OPENAI-02 | First chunk has `role: "assistant"`; subsequent chunks do not. | unit (translator) | `npx vitest run src/openai/__tests__/translator.test.ts -t "role on first chunk only"` | ❌ Wave 0 |
| OPENAI-02 | SSE keepalive fires at configured interval when no content yet. | unit (stream writer) | `npx vitest run src/openai/__tests__/stream.test.ts -t "keepalive"` | ❌ Wave 0 |
| OPENAI-02 | Client disconnect triggers AbortSignal → SDK abort → Turn.end("error"). | integration | `npx vitest run src/openai/__tests__/server.test.ts -t "client disconnect aborts agent"` | ❌ Wave 0 |
| OPENAI-03 | GET /v1/models returns every configured top-level agent; sub-agents hidden. | unit | `npx vitest run src/openai/__tests__/server.test.ts -t "models endpoint"` | ❌ Wave 0 |
| OPENAI-04 | Missing Authorization header → 401 with OpenAI error shape. | unit | `npx vitest run src/openai/__tests__/auth.test.ts -t "missing bearer 401"` | ❌ Wave 0 |
| OPENAI-04 | Unknown key → 401. | unit | `npx vitest run src/openai/__tests__/auth.test.ts -t "unknown key 401"` | ❌ Wave 0 |
| OPENAI-04 | Known key + wrong `model` in body → 403 permission_error. | unit | `npx vitest run src/openai/__tests__/auth.test.ts -t "mismatched agent 403"` | ❌ Wave 0 |
| OPENAI-04 | Revoked / expired key → 401. | unit | `npx vitest run src/openai/__tests__/auth.test.ts -t "revoked key 401"` | ❌ Wave 0 |
| OPENAI-04 | `timingSafeEqual` is used for hash comparison (mutation test: swap to `===` should still pass but linter rule / code review catches). | unit | `npx vitest run src/openai/__tests__/auth.test.ts -t "timing-safe equal path"` | ❌ Wave 0 |
| OPENAI-05 | Second request with same bearer key resumes same Claude session (same sessionId). | integration | `npx vitest run src/openai/__tests__/server.test.ts -t "session continuity"` | ❌ Wave 0 |
| OPENAI-05 | Daemon restart preserves session mapping via `api_key_sessions`. | integration | `npx vitest run src/openai/__tests__/server.test.ts -t "session survives restart"` | ❌ Wave 0 |
| OPENAI-05 | Two different keys pinned to the same agent have fully isolated sessions. | integration | `npx vitest run src/openai/__tests__/server.test.ts -t "key isolation"` | ❌ Wave 0 |
| OPENAI-06 | OpenAI `tools:[{type:"function"...}]` request produces Claude-format tool definition on SDK call. | unit (translator) | `npx vitest run src/openai/__tests__/translator.test.ts -t "tools request translation"` | ❌ Wave 0 |
| OPENAI-06 | Claude `tool_use` block → OpenAI `tool_calls: [{id,type,function:{name,arguments}}]`. | unit (translator) | `npx vitest run src/openai/__tests__/translator.test.ts -t "tool_use to tool_calls"` | ❌ Wave 0 |
| OPENAI-06 | Streaming `input_json_delta` events accumulate into partial `tool_calls[i].function.arguments` chunks preserving `index` per tool_use. | unit (translator) | `npx vitest run src/openai/__tests__/translator.test.ts -t "streamed tool args"` | ❌ Wave 0 |
| OPENAI-06 | Parallel tool calls preserve order as `tool_calls[0], [1], [2]...`. | unit (translator) | `npx vitest run src/openai/__tests__/translator.test.ts -t "parallel tool calls"` | ❌ Wave 0 |
| OPENAI-06 | Client `role:"tool"` reply translates to Claude `tool_result` block with matching `tool_use_id`. | unit (translator) | `npx vitest run src/openai/__tests__/translator.test.ts -t "tool result translation"` | ❌ Wave 0 |
| OPENAI-06 | `tool_choice` auto/none/named all translate correctly. | unit (translator) | `npx vitest run src/openai/__tests__/translator.test.ts -t "tool_choice translation"` | ❌ Wave 0 |
| OPENAI-07 | Every trace row has `TurnOrigin.source.kind === "openai-api"`. | integration | `npx vitest run src/openai/__tests__/server.test.ts -t "turn origin openai-api"` | ❌ Wave 0 |
| OPENAI-07 | Trace carries bearer fingerprint (first 8 hex of key_hash) in `source.id`. | integration | `npx vitest run src/openai/__tests__/server.test.ts -t "trace source fingerprint"` | ❌ Wave 0 |
| OPENAI-07 | Client-sent `X-Request-Id` is preserved in trace metadata + echoed in response header. | integration | `npx vitest run src/openai/__tests__/server.test.ts -t "X-Request-Id echo"` | ❌ Wave 0 |
| OPENAI-07 | TURN_ID_REGEX accepts `openai-api:*` turnIds. | unit | `npx vitest run src/manager/__tests__/turn-origin.test.ts -t "openai-api kind"` | ✅ (file exists, add case) |
| cross-cutting | Non-regression: first_token p95 of Discord path unchanged after endpoint deploys. | manual-only (bench) | `npx tsx src/cli/commands/bench.ts` — compare before/after | N/A |
| cross-cutting | Prompt cache hit-rate unchanged on the shared stable prefix. | manual-only | `clawcode cache --since 24h` after cross-path traffic — verify no regression | N/A |
| E2E headline | Python OpenAI SDK can round-trip (non-stream + stream). | e2e | `python scripts/openai-smoke.py` (checked in, runs against a running daemon) | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run src/openai --reporter=verbose` (fast — module-scoped unit + integration tests, no network).
- **Per wave merge:** `npm test` (full suite — ensures no regression in `turn-origin.ts`, `trace-store.ts`, `daemon.ts`).
- **Phase gate:** `npm test` green + `python scripts/openai-smoke.py` green against a running daemon + `clawcode cache --since 1h` shows no hit-rate regression.

### Wave 0 Gaps

- [ ] `src/openai/__tests__/server.test.ts` — covers OPENAI-01, OPENAI-02, OPENAI-03, OPENAI-05, OPENAI-07 (integration via ephemeral daemon on a random port, mocked SessionAdapter injected to return pre-recorded SDK stream fixtures)
- [ ] `src/openai/__tests__/translator.test.ts` — covers OPENAI-06 (pure-function tests over translation fns)
- [ ] `src/openai/__tests__/stream.test.ts` — covers OPENAI-02 keepalive + backpressure + SSE framing
- [ ] `src/openai/__tests__/auth.test.ts` — covers OPENAI-04 (hash + timingSafeEqual + key lifecycle)
- [ ] `src/openai/__tests__/fixtures/` — recorded SDK stream messages as JSON fixtures (replay into MockSessionAdapter to drive translator deterministically). Capture from a live run of `clawcode send` via a small recording helper.
- [ ] `scripts/openai-smoke.py` — Python OpenAI SDK headline E2E; boots `clawcode start`, creates a test key via CLI, runs both non-stream + stream test, asserts output.
- [ ] Extend `src/manager/__tests__/turn-origin.test.ts` — add a case covering the new `"openai-api"` kind passes TURN_ID_REGEX.
- [ ] `src/cli/commands/__tests__/openai-key.test.ts` — covers key create/list/revoke CLI happy-paths.

## Sources

### Primary (HIGH confidence)

- [Claude Agent SDK TypeScript Reference (code.claude.com)](https://code.claude.com/docs/en/agent-sdk/typescript) — full API: `query()` signature, Options fields, SDKMessage types, content block types, `includePartialMessages`, `resume`/`forkSession`, `abortController`. Fetched 2026-04-18.
- [Streaming Messages (Anthropic)](https://platform.claude.com/docs/en/build-with-claude/streaming) — `message_start`, `content_block_start/delta/stop`, `message_delta`, `message_stop`; `input_json_delta.partial_json` semantics.
- [OpenAI API: Create Chat Completion](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) — non-stream response shape (id, object, created, model, choices, usage, tool_calls format), tool role reply format.
- [OpenAI API: Chat Completions Streaming Events](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events) — `chat.completion.chunk` shape, role-on-first-chunk rule, `finish_reason` values, streaming `tool_calls[].index` + partial `function.arguments`.
- [Node.js `node:http`](https://nodejs.org/api/http.html) + [Node.js Backpressuring in Streams](https://nodejs.org/learn/modules/backpressuring-in-streams) — authoritative for `res.write()` return value semantics + `drain` event.
- [Node.js `node:crypto`](https://nodejs.org/api/crypto.html) — `createHash`, `randomBytes`, `timingSafeEqual` signatures; pre-equal-length requirement.
- `src/dashboard/server.ts` + `src/dashboard/sse.ts` — in-tree reference for `node:http` + SSE pattern.
- `src/manager/session-adapter.ts` — in-tree SDK streaming iteration pattern; `resume:`, `includePartialMessages`, abortController wiring, tool_use block handling.
- `src/manager/turn-dispatcher.ts` — caller-owned Turn contract (`options.turn`, `options.signal`).
- `src/memory/conversation-store.ts` — ConversationStore API (`startSession`, `recordTurn`, schema shape of `conversation_turns.origin`).
- `src/config/__tests__/loader.test.ts` (line 464) — confirms existing `mcpServers.openai` YAML key (no collision with new `defaults.openai` section, but documented as a naming hazard).
- npm registry (`npm view`, 2026-04-18) — verified: `@anthropic-ai/claude-agent-sdk@0.2.114`, `openai@6.34.0`, `hono@4.12.14`, `fastify@5.8.5`.

### Secondary (MEDIUM confidence — web-verified against authoritative sources)

- [LiteLLM proxy documentation](https://docs.litellm.ai/docs/providers/openai_compatible) — production OpenAI-compatible proxy patterns; confirms usage field handling + tool_calls translation approach used by a mature reference implementation.
- [SSE production gotchas (Nginx / Cloudflare buffering)](https://dev.to/miketalbot/server-sent-events-are-still-not-production-ready-after-a-decade-a-lesson-for-me-a-warning-for-you-2gie) — reverse-proxy buffering + `X-Accel-Buffering: no` prescription.
- [OWASP API key storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) — hash-not-password distinction; SHA-256 for high-entropy tokens.
- [OpenAI Python SDK on GitHub](https://github.com/openai/openai-python) — client validation strictness.

### Tertiary (LOW confidence — surfaced for completeness)

- Blog posts / community comparisons of Hono/Fastify/`node:http` — directional only; decision locked to `node:http` by project convention regardless.
- 2026 API key management blog posts (oneuptime.com) — reinforced OWASP guidance, not relied on solo.

## Metadata

**Confidence breakdown:**
- **Standard stack:** HIGH — every dep is already in-tree at a verified version; zero new runtime deps required.
- **OpenAI wire format:** HIGH — cross-verified between official reference docs (non-stream + streaming) and known-behavior from LiteLLM's production implementation.
- **Claude Agent SDK API:** HIGH — official `code.claude.com` reference verified with current repo's actual usage in `src/manager/session-adapter.ts`; `SDKAssistantMessage.message.content` shape + `stream_event`/`input_json_delta` behavior both documented and in-use.
- **Tool-use bidirectional translation:** MEDIUM — the algorithm is clear; the edge cases around parallel tool-call ordering across streamed `input_json_delta` events are the highest-risk area. Recommendation: record real SDK event fixtures and pin unit tests to them.
- **Pitfalls:** HIGH for SSE framing / charset / `timingSafeEqual` / prompt-cache preservation; MEDIUM for SDK-version-drift (pre-1.0 risk is real but manageable with fixtures + pinning).
- **Environment:** HIGH — no new external tooling beyond Python OpenAI SDK for the headline smoke.

**Research date:** 2026-04-18
**Valid until:** 2026-05-18 for OpenAI wire format (stable); 2026-05-02 for Claude Agent SDK (pre-1.0, bump expected before then).
