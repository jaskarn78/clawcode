# Phase 69: OpenAI-Compatible Endpoint - Context

**Gathered:** 2026-04-18
**Status:** Ready for planning
**Mode:** Auto (--auto) — decisions locked in milestone scoping, auto-confirmed

<domain>
## Phase Boundary

Deliver a stable OpenAI-compatible HTTP surface on the existing daemon process so any client that speaks the OpenAI API (Python `openai` SDK, Node SDK, LibreChat, OpenClaw's own `openai:default` provider, curl, custom apps) can reach a named ClawCode agent as if it were a model. The endpoint exposes:

- `POST /v1/chat/completions` (sync + SSE streaming, tool-use round-trip)
- `GET /v1/models` (every configured agent listed)
- Bearer-key auth with **per-key session continuity** (same key ⇒ same persistent session with the pinned agent)

This is a NEW HTTP surface, NOT a refactor of the Discord bridge, NOT a separate service, NOT a gateway layer.

Satisfies: **OPENAI-01, OPENAI-02, OPENAI-03, OPENAI-04, OPENAI-05, OPENAI-06, OPENAI-07**.

</domain>

<decisions>
## Implementation Decisions

### HTTP Surface & Lifecycle

- **New listener on the existing daemon process** — NOT a separate service, NOT a reuse of the dashboard server. A dedicated `openai-endpoint` module registered alongside `dashboard`, owned by `startDaemon()`, with the same shutdown hooks and log scope.
- **Reuse Node.js built-in `http.createServer`** — same pattern as `src/dashboard/server.ts`. Zero new HTTP framework dependencies. If a router helper is useful, build a minimal internal one (the dashboard does its own routing and works fine).
- **Separate port from dashboard** — dashboard is 3100, the OpenAI endpoint gets its own default port (recommend **3101**), configurable via `openai.port` in the defaults section of `clawcode.yaml` and `openai.host` for bind address (default `0.0.0.0` — matches dashboard; Tailscale/localhost-only users override).
- **One binary, one socket, one lifecycle** — daemon boot registers the endpoint after agents are ready; daemon shutdown tears it down gracefully.

### Auth & Session Mapping (OPENAI-04, OPENAI-05)

- **Bearer key is the session boundary.** One API key = one isolated ConversationStore session with the agent the key is pinned to. Different keys to the same agent = fully isolated sessions.
- **Per-key mapping stored in new daemon-level SQLite:** `~/.clawcode/manager/api-keys.db` with schema `(key_hash PRIMARY KEY, agent_name, label, created_at, last_used_at, expires_at NULLABLE, disabled_at NULLABLE)`. Keys stored as SHA-256 hash, never plaintext (parity with OPs-grade auth).
- **Key format:** `ck_<prefix>_<32-char-random>` where `<prefix>` is the first 6 chars of the agent name (slugified). This is for *visual identification only* — not parsed at runtime. Runtime lookup is by hash.
- **Key lifecycle CLI:** `clawcode openai-key create <agent> [--label X] [--expires 30d]`, `clawcode openai-key list`, `clawcode openai-key revoke <key-or-label>`. Writes to `api-keys.db`, never prints key twice (one-shot create).
- **Session-id mapping:** new column on `conversation_sessions` is NOT needed — we use a separate index table `api_key_sessions (key_hash, session_id)` in the agent's memories.db. On every request, daemon looks up the session for (key_hash, agent) pair, creating it lazily if not present.
- **Unknown key → 401.** Known key but wrong `model` in body → 403 (key not authorized for that agent). Other errors → 400/500 as appropriate. Error body is OpenAI-shape: `{"error": {"message": "...", "type": "...", "code": "..."}}`.

### Streaming (OPENAI-02)

- **Server-Sent Events format:** `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`. Each chunk is `data: {...}\n\n`, final chunk is `data: [DONE]\n\n` then `\n` close.
- **Chunk shape:** OpenAI `chat.completion.chunk` — object with `id`, `object: "chat.completion.chunk"`, `created`, `model`, `choices: [{ index, delta: { role?, content? }, finish_reason? }]`. `role: "assistant"` only on the FIRST chunk.
- **Backpressure:** stream writes via `res.write()`; if the client disconnects (`req.on('close')`), abort the underlying agent stream via the existing Turn abort path — do NOT let the agent keep producing tokens into the void.
- **Keepalive:** emit a zero-width SSE comment line (`: keepalive\n\n`) every 15s if no real delta has been sent yet — prevents LB/proxy timeout before first token arrives.

### Tool-Use Translation (OPENAI-06)

- **Request translation (OpenAI → Claude):** `tools: [{type: "function", function: {name, description, parameters}}]` on the request body → Claude-format tools on the SDK call. `tool_choice: "auto" | "none" | {type: "function", function: {name}}` → `tool_choice` on the Claude SDK.
- **Response translation (Claude → OpenAI):** Claude `tool_use` content blocks → OpenAI `tool_calls: [{id, type: "function", function: {name, arguments (JSON string)}}]` on the choice. Claude `text` blocks → OpenAI `content` string.
- **Client tool-result reply:** Client sends `{role: "tool", tool_call_id, content}` in a follow-up request. Daemon translates this to a Claude `tool_result` block keyed by the matching `tool_use_id` and continues the same session.
- **Parallel tool calls:** OpenAI uses a `tool_calls` array in one message; Claude uses multiple `tool_use` blocks. Both supported in the translator — preserve order.
- **Streaming tool deltas:** when an agent emits a `tool_use` block during streaming, accumulate arguments across deltas and emit OpenAI-style `choices[0].delta.tool_calls[i].function.arguments` partial strings. OpenAI clients concat these.

### TurnOrigin (OPENAI-07)

- **Add `"openai-api"` as a 5th `SOURCE_KINDS` value** in `src/manager/turn-origin.ts`. Update `TURN_ID_REGEX` to include the new kind. Update the downstream pattern-matches (Phase 60 trigger engine, Phase 63 trace walker, etc.) to handle the new kind as an unknown-but-valid source (ignored by trigger-specific logic, rendered as-is by trace walker).
- **Source id = bearer-key fingerprint** — first 8 chars of the key_hash hex. Lets operators trace activity back to a specific client without exposing the key.
- **X-Request-Id** — if the client sends `X-Request-Id`, preserve it verbatim in trace metadata (new `metadata_json.client_request_id` column? — simpler: fold into existing metadata_json blob). If not sent, daemon generates a nanoid. The request-id is returned in the response header `X-Request-Id` for client-side correlation.
- **Full trace participation** — every OpenAI endpoint turn flows through `TurnDispatcher.dispatchStream` (same path as Discord) so prompt caching, tool-call timing, latency SLOs, ConversationStore capture, and cross-agent trace chains all work *for free*.

### Tool Registry for `/v1/chat/completions`

- **Auto-injected MCP tools are NOT automatically exposed as OpenAI functions.** An API client using `tools: [...]` in their request body sees only tools the client itself declares. This avoids confusing clients that use the endpoint as a plain "model" (no tools expected).
- **But:** the agent's internal MCP tools (memory_lookup, etc.) still fire server-side via normal Claude tool-use — the agent *can* use them on its own behalf, just not via the client-declared tools path. The client sees clean assistant text, same as a plain chat.
- **Exception:** if the client explicitly sends `tools: ["*clawcode"]` (reserved pseudo-tool), daemon auto-includes all of the agent's MCP tools in the request. Defer full implementation of this to a follow-up phase if it bloats scope.

### ConversationStore Integration (OPENAI-05)

- **Reuse ConversationStore 100%** — OpenAI-endpoint turns call `recordTurn` with `channel_id: null`, `discord_user_id: null`, `discord_message_id: null`, `is_trusted_channel: true`, and a new `origin_kind: "openai-api"` field (add to ConversationStore schema as a new column if needed, else fold into the existing `source` field pattern).
- **Session resume on restart** — the `api_key_sessions` table + ConversationStore `startSession` / `resumeSession` handles restarts: on first request after restart, daemon finds the existing session-id for the key, calls `resumeSession`, Claude SDK passes `resume` option.
- **Instruction-pattern detection (SEC-02)** — runs on the user-message content just like Discord. Any medium/high-risk flag is stored in `instruction_flags`, same format.

### Config Schema Additions

New optional section under `defaults:` and overridable per-agent (though typically set globally):

```yaml
openai:
  enabled: true                          # default: true (start the listener)
  port: 3101                             # default: 3101
  host: "0.0.0.0"                        # default: "0.0.0.0"
  maxRequestBodyBytes: 1048576           # default: 1 MiB (OpenAI-scale messages)
  streamKeepaliveMs: 15000               # default: 15s
```

Zod schema goes in `src/config/schema.ts` as `openaiEndpointSchema`. Resolved agent config doesn't need per-agent overrides for v2.0.

### Agent Visibility

- **All configured agents appear in `/v1/models`** regardless of whether any keys are assigned to them. The models list describes the fleet, not the key-permissions.
- **Key-to-agent auth check happens per-request** — the key's `agent_name` column must match the request body `model`. Mismatch = 403.
- **Sub-agents (thread/sub- names)** are NOT exposed in `/v1/models`. Only configured top-level agents. (Pattern match: names without `-sub-` or `-thread-` infix.)

### Error Shape

All errors return OpenAI-shape JSON body:

```json
{
  "error": {
    "message": "Human-readable message",
    "type": "invalid_request_error | authentication_error | permission_error | server_error | rate_limit_exceeded",
    "code": "optional_machine_code"
  }
}
```

Status codes: 400 malformed, 401 missing/invalid key, 403 key-agent mismatch, 404 unknown route, 429 rate limit (future), 500 internal, 503 agent unavailable (warm-path not ready).

### Non-Goals (carried from REQUIREMENTS.md out-of-scope)

- NOT implementing `/v1/embeddings` or legacy `/v1/completions`
- NOT implementing per-user rate limits (v2.1)
- NOT implementing billing / usage metering (v2.1)
- NOT touching the Discord bridge
- NOT refactoring TurnDispatcher contract — just adding a new kind
- NOT exposing admin API (key mgmt is CLI only)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src/dashboard/server.ts`** — the reference implementation for a secondary HTTP listener on the daemon. Uses `node:http` built-in, parses routes manually, serves JSON + SSE + static. The OpenAI endpoint should parallel this file structure at `src/openai/server.ts` (new directory `src/openai/`).
- **`src/manager/turn-dispatcher.ts`** — the `dispatchStream` method is the direct equivalent of what the OpenAI endpoint needs. It's the same path Discord uses for streaming.
- **`src/manager/turn-origin.ts`** — `SOURCE_KINDS`, `TURN_ID_REGEX`, `makeRootOrigin` all need a new `"openai-api"` value added.
- **`src/memory/conversation-store.ts`** — `recordTurn`, `startSession`, `endSession`, `resumeSession` all exist and handle ConversationStore integration. New code just needs to call them with `channel_id: null` and a new `origin_kind`.
- **`src/config/schema.ts`** — existing `openai:` key in `mcpServers` (unrelated MCP config) vs our new top-level `openai:` endpoint section — ensure NO name collision. Use `openaiEndpoint:` if the YAML `openai:` key is already taken.
- **`src/ipc/server.ts`** — daemon IPC server. If we want `clawcode openai-key list` CLI to talk to the daemon, we add new IPC methods. Alternative: CLI reads/writes `api-keys.db` directly when daemon is down and via IPC when daemon is up.

### Established Patterns
- **Dashboard port** is configurable via `CLAWCODE_DASHBOARD_HOST` env var; adopt same pattern with `CLAWCODE_OPENAI_HOST` / `CLAWCODE_OPENAI_PORT`.
- **MCP server auto-injection pattern** in `src/manager/daemon.ts` lines ~200-300 — used for `clawcode` and `1password`. The OpenAI endpoint is different (it's an HTTP listener, not an MCP server) but follow the same "registered at daemon boot, torn down at shutdown" lifecycle.
- **SSE pattern** already exists in the dashboard; study `src/dashboard/sse.ts` (or equivalent SseManager) for the write + keepalive + client-disconnect pattern.
- **Better-sqlite3 for `api-keys.db`** — daemon-level, separate from per-agent memory.db. Follows the `tasks.db` pattern from Phase 58.

### Integration Points
- **Daemon boot sequence (src/manager/daemon.ts):** add OpenAI endpoint startup AFTER ConversationStore is ready (since requests immediately need session lookup) and AFTER SessionManager is ready.
- **TurnDispatcher new origin** — zero refactor, just update SOURCE_KINDS. Existing Turn/TraceStore code will pass through the new kind without modification.
- **CLI** — new top-level command `clawcode openai-key <subcommand>` in `src/cli/commands/openai-key.ts`.

</code_context>

<specifics>
## Specific Ideas

- **OpenAI Python SDK smoke test** is the headline proof. Must pass:
  ```python
  from openai import OpenAI
  client = OpenAI(base_url="http://clawdy:3101/v1", api_key="ck_clawdy_XXXX")
  response = client.chat.completions.create(model="clawdy", messages=[{"role": "user", "content": "hello"}])
  print(response.choices[0].message.content)
  ```
  No custom headers, no tricks. Standard SDK.

- **LibreChat / OpenClaw hookup** — document in README how to wire these. OpenClaw's `openai:default` provider needs `baseUrl: http://clawdy:3101/v1` and the bearer key. LibreChat similar.

- **Prompt cache preservation** — the OpenAI endpoint must NOT break v1.7 prompt caching. The stable prefix (identity + soul + skills header) is controlled by the agent config, not the request body. OpenAI endpoint's user message goes into the mutable-suffix append, same as Discord.

- **First-token p95 non-regression** — the OpenAI endpoint's streaming path must match Discord's first-token p95. Measure with bench after landing.

</specifics>

<deferred>
## Deferred Ideas

- Admin API for key management (v2.1 multi-user)
- Per-user / per-key rate limiting (v2.1)
- Billing / usage metering per key (v2.1)
- `/v1/embeddings` endpoint (out of scope)
- Legacy `/v1/completions` endpoint (out of scope)
- Agent-specific tool exposure via `tools: ["*clawcode"]` pseudo-tool (may do if simple, else defer)
- Web UI for key creation (CLI-only for v2.0)
- OAuth / OIDC authentication (v2.1+)

</deferred>
