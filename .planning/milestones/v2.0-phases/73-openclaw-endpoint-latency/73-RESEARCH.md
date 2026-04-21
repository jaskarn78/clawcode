# Phase 73: OpenClaw Endpoint Latency — Research

**Researched:** 2026-04-19
**Domain:** Per-turn TTFB on `/v1/chat/completions` against a persistent Claude Agent SDK session
**Confidence:** HIGH (external consumer pattern, SDK API, span/brief integration) / MEDIUM (empirical TTFB targets — pinned to one journal observation, should be re-measured post-deploy)

## Summary

Two investigations feed this plan. Track A (OpenClaw consumer) resolved: OpenClaw runs in two flavours on this host, and both are available on disk. The production path that hits clawdy is the Node.js reverse-proxy at `/home/jjagpal/openclaw-claude-bridge/` (OpenAI wire-format shim → `claude` CLI subprocess). The experimental in-process alternative is `/home/jjagpal/openclaw-claude-runner/` (OpenClaw plugin → embedded `node:http` → Claude Agent SDK `query()`). **Both unconditionally send `stream: true` over SSE, render tokens as they arrive, and terminate the agent via `req.on("close") → AbortController.abort()` when the user closes the app** — so ClawCode's `/v1/chat/completions` must protect TTFB AND continue to respect `req.close` → abort.

Track B (ClawCode architecture) resolved: the pinned SDK is `@anthropic-ai/claude-agent-sdk@0.2.97` (package.json in `node_modules/`). The `Query` object IS already an `AsyncGenerator<SDKMessage, void>` and exposes `streamInput(stream: AsyncIterable<SDKUserMessage>): Promise<void>`, `interrupt()`, `close()`, plus per-session mutators (`setPermissionMode`, `setModel`, `setMaxThinkingTokens`). Long-lived generators ARE supported — you pass `prompt: AsyncIterable<SDKUserMessage>` into `query()` instead of a single `string`. This is the SDK's multi-turn primitive.

The per-turn `sdk.query()` pattern in `src/manager/session-adapter.ts:509-511` (wrapSdkQuery's `send/sendAndCollect/sendAndStream` each build a fresh `sdk.query(...)` with `resume: sessionId`) is the dominant TTFB source because every turn spawns a new `claude` CLI subprocess and re-hydrates session state from disk JSONL. A persistent generator eliminates both.

**Primary recommendation:** Build a `PersistentSessionAdapter` that owns one long-lived `sdk.query({ prompt: asyncIterable })` per agent, with an async-queue bridge that serializes turns (queue depth 1 per agent — the same contract the Discord dispatcher assumes). Wrap this behind `SessionHandle` so `SessionManager` / `TurnDispatcher` / `OpenAiSessionDriver` all continue working with zero refactor. Add `ttfb_ms` + `total_turn_ms` fields to a NEW `openai.chat_completion` span. Cache the conversation brief per agent keyed by the terminated-session-id fingerprint. Tune `agentReadinessWaitMs` from 2000 → 300ms after the persistent subprocess lands (not before — the gate is a safety net against the exact race this phase narrows).

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (Locked constraints)

- No regression on Discord bridge path (same `session-adapter.ts` is shared).
- No regression on v1.7 prompt-cache hit-rate SLO.
- All existing 2900+ tests stay green.
- No new `tsc --noEmit` errors beyond the pre-existing daemon.ts issues (lines 128, 665, 2576).
- Changes deployable via `git pull && sudo -u clawcode npm ci && npm run build && sudo systemctl restart clawcode` on clawdy.

### Claude's Discretion

All implementation choices are at Claude's discretion — discuss phase skipped per user intent ("handle all of this autonomously"). Use the ROADMAP phase goal, 5 success criteria (LAT-01 through LAT-05), and codebase conventions to guide decisions.

### Deferred Ideas (OUT OF SCOPE)

- Plumbing `temperature`, `max_tokens`, `reasoning_effort`, `stop`, `response_format` through the translator → SDK session call. Explicitly out of scope for this phase — separate follow-up.
- Fixing the `usage:{0,0,0}` gap in the non-stream response (SDK result usage not populated in OpenAI envelope). Separate bug, touches the same area but different concern.
- Reducing startup-race wait further via a readiness signal push (rather than polling). Only pursue if even a short wait shows up as a hot spot after the persistent-subprocess change.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LAT-01 | Persistent per-agent SDK session replaces per-turn `sdk.query()`. Warm agent TTFB drops from ~7s to sub-2s for trivial prompts. | SDK `streamInput(stream: AsyncIterable<SDKUserMessage>)` is documented at `sdk.d.ts:1862`; `query({ prompt: AsyncIterable<SDKUserMessage> })` is documented at `sdk.d.ts:1879-1882`. `Query extends AsyncGenerator<SDKMessage, void>` at `sdk.d.ts:1687`. See Pattern 1. |
| LAT-02 | Conversation-brief cache short-circuits re-assembly across turns within a session. Cache is invalidated only when the brief's inputs change. | `buildSessionConfig` today calls `assembleConversationBrief` inside `src/manager/session-config.ts:330-356` on every startAgent/resume. Brief inputs: agent's ConversationStore terminated sessions + MemoryStore `session-summary` tags + `now` timestamp for gap-check. Cache key = sha256 of the terminated-session-id list considered (LAT-02 section below). |
| LAT-03 | TTFB + total-turn latency surfaced in trace rows via a new `openai.chat_completion` span. | `src/performance/trace-collector.ts:Span.setMetadata` already supports shallow-merged metadata mutation before `.end()`. Existing span keys: `context_assemble`, `end_to_end`, `first_token`, `receive`, `tool_call.<name>`. No `openai.chat_completion` span exists today. |
| LAT-04 | `agentReadinessWaitMs` default tuned from 2000ms based on observed warm-path numbers. | `endpoint-bootstrap.ts` wires `sessionManager.isRunning.bind(...)`. Warm-path total_ms observed ~15.8ms in the 260419-jtk quick task journal. Safe new default derived below. |
| LAT-05 | v1.7 prompt-cache SLO preserved — `cache_read_input_tokens` still dominates on warmed sessions. | Session-adapter already emits `recordCacheUsage` on every `result` message (`src/manager/session-adapter.ts:770-832`). Longer-lived session should INCREASE hits (same stable prefix stays warm in Anthropic's cache on the same session). |

</phase_requirements>

## Standard Stack

### Core (already in tree — no new deps)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@anthropic-ai/claude-agent-sdk` | 0.2.97 (installed) | `query({ prompt: AsyncIterable<SDKUserMessage> })` + `Query.streamInput()` | The long-lived-session primitive the SDK documents. Also gives us `interrupt()` + `close()` for recovery. |
| `node:crypto` | built-in | sha256 brief-cache key | Match existing hashing in `src/manager/context-assembler.ts:computePrefixHash`. |

**Version verification (npm view, 2026-04-19):**
```
$ npm view @anthropic-ai/claude-agent-sdk version
0.2.97
```
Node_modules package.json confirms 0.2.97 pinned. No upgrade needed — all required APIs (`streamInput`, `interrupt`, `close`, `AsyncGenerator<SDKMessage>`) are present.

### Supporting

No new libraries. Everything (nanoid for IDs, pino for logs, sha256 for fingerprints, trace-collector for spans, ConversationStore + MemoryStore for brief inputs) already exists.

### Alternatives Considered (for the record — DO NOT USE)

| Instead of | Could Use | Why Not |
|------------|-----------|---------|
| `sdk.query({ prompt: asyncIterable })` | `spawn('claude', [...])` with `--stream-json --resume` directly (the openclaw-claude-bridge pattern) | We already use the Agent SDK elsewhere; rolling a second transport means two bug surfaces. The SDK's `streamInput` is the primitive. |
| Persistent generator per agent | Persistent generator per (agent × bearer-key) | Worse: we'd hold a CLI subprocess open per API key. The agent's own session-id is the resume point — one generator per agent is enough; per-request session continuity comes from ConversationStore-level bearer→session mapping that's already in place. |
| Async-queue bridge (in-process Map + Promise-resolver) | rxjs Subject | 1 dep to bring in for a primitive we can do in ~40 lines; matches the existing `src/openai/driver.ts` bounded-queue pattern verbatim. |
| Brief cache keyed on `agentName` only | Keyed on fingerprint of terminated session IDs | The brief's content changes when terminated-sessions change (resume-summary pool). Key on agentName alone → stale brief after a session ends mid-daemon. |
| LRU brief cache | Per-agent single slot (Map<agent, entry>) | 14-agent scale — one slot per agent is ~14 entries max. LRU is theatre. |

**Installation:** None.

## Architecture Patterns

### Recommended Source Layout

```
src/manager/
├── session-adapter.ts            # EXISTING — extend: export PersistentSessionAdapter
├── persistent-session-handle.ts  # NEW — wraps streamInput() generator behind SessionHandle
├── persistent-session-queue.ts   # NEW — serializes turns per agent (queue depth 1)
├── session-config.ts             # EXISTING — extend buildSessionConfig to skip brief when cached
├── conversation-brief-cache.ts   # NEW — per-agent { fingerprint, briefBlock } map
└── session-manager.ts            # EXISTING — wire new adapter, cache, readiness tune

src/openai/
├── server.ts                     # EXISTING — tune agentReadinessWaitMs default 2000 → 300
├── driver.ts                     # EXISTING — add ttfb_ms + total_turn_ms onto openai.chat_completion span
└── endpoint-bootstrap.ts         # EXISTING — no change (bind already correct)

src/performance/
└── trace-collector.ts            # EXISTING — no change (span API is sufficient)
```

### Pattern 1: Persistent Generator via `streamInput` (HIGH confidence)

**What:** One `sdk.query({ prompt: asyncIterable })` per agent, alive for the session lifetime. Turns are fed via a pushable async iterable; outputs stream out of the single generator.

**When to use:** The SessionHandle backing for every agent. Replaces the per-call `sdk.query(...)` in `wrapSdkQuery`.

**SDK contract (verified from `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`):**

```typescript
// sdk.d.ts:1879-1882 — query() accepts AsyncIterable for streaming input mode
export declare function query(_params: {
    prompt: string | AsyncIterable<SDKUserMessage>;
    options?: Options;
}): Query;

// sdk.d.ts:1687 — Query IS an AsyncGenerator AND exposes control methods
export declare interface Query extends AsyncGenerator<SDKMessage, void> {
    interrupt(): Promise<void>;
    setPermissionMode(mode: PermissionMode): Promise<void>;
    setModel(model?: string): Promise<void>;
    setMaxThinkingTokens(maxThinkingTokens: number | null): Promise<void>;
    streamInput(stream: AsyncIterable<SDKUserMessage>): Promise<void>;
    close(): void;
}

// sdk.d.ts:2870-2883 — the message type the iterable yields
export declare type SDKUserMessage = {
    type: 'user';
    message: MessageParam;              // { role: "user", content: string | ContentBlock[] }
    parent_tool_use_id: string | null;
    isSynthetic?: boolean;
    tool_use_result?: unknown;
    priority?: 'now' | 'next' | 'later';
    timestamp?: string;
    uuid?: UUID;
    session_id?: string;
};
```

**Load-bearing takeaways:**

1. **`streaming input mode` is gated on passing an `AsyncIterable<SDKUserMessage>` to `query()`**. Passing a string puts the Query into single-turn mode; per-call control methods like `setModel`, `setPermissionMode`, `applyFlagSettings` are annotated "Only available in streaming input mode." Several of the discretion-deferred fields (`reasoning_effort`, etc.) live on this surface for the follow-up phase — getting onto streaming input mode now unlocks them for free later.
2. **Permission mode, MCP servers, settingSources, env are set once at `query(...)` time**. These do NOT change per-turn, so a persistent generator matches the agent's lifetime cleanly. Mid-session config drift (skills hot-reload) would force us to close + respawn, which is already the code path we take when hot-reload fires `refreshStablePrefix` and ends up calling `resumeSession` (see `session-manager.ts:refreshStablePrefix` path).
3. **`resume: sessionId` is valid with streaming input mode**. The SDK's `claude_code` preset + `resume` on `query()` still works — the persistent generator picks up the session's JSONL state on first user message and extends it. Session-id from the first `result` message replaces the prefix-pending id just like today.
4. **`Query` IS the iterator.** We iterate `for await (const msg of query)` on a single generator shared across turns. Each turn's end is marked by a `result` message; the generator stays alive until `close()` is called.

**Implementation shape (pseudocode):**

```typescript
// persistent-session-handle.ts (new)
export function createPersistentSessionHandle(
  sdk: SdkModule,
  baseOptions: SdkQueryOptions,
  initialSessionId: string,
  usageCallback?: UsageCallback,
  prefixHashProvider?: PrefixHashProvider,
  skillTracking?: SkillTrackingConfig,
): SessionHandle {
  // Pushable async iterable of SDKUserMessage.
  const inputQueue = new AsyncPushQueue<SDKUserMessage>();

  // ONE long-lived query for the whole agent lifetime.
  const q = sdk.query({
    prompt: inputQueue,                        // AsyncIterable<SDKUserMessage>
    options: {
      ...baseOptions,
      resume: initialSessionId,                // picks up disk JSONL on first turn
      includePartialMessages: true,            // token-level streaming via stream_event
    },
  });

  // Serialize turns: only one turn may be in-flight at a time per agent
  // (matches existing Discord dispatcher assumption of single-turn-per-agent).
  const turnQueue = new SerialTurnQueue(q);

  return {
    sessionId: initialSessionId,
    async sendAndStream(message, onChunk, turn, options) {
      return turnQueue.run(async () => {
        // Push the user message, then iterate q until we see the matching `result`.
        inputQueue.push({
          type: "user",
          message: { role: "user", content: promptWithMutable(message) },
          parent_tool_use_id: null,
        });
        return iterateUntilResult(q, onChunk, turn, options);
      });
    },
    // ... send, sendAndCollect, close, onError, onEnd, setEffort, getEffort
  };
}
```

**Critical detail — iteration boundary:** the existing `iterateWithTracing` in `session-adapter.ts` returns when it sees `msg.type === "result"`. In a persistent generator, **we keep reading from `q` across turns but each turn's handler only runs its inner loop until it hits the turn-terminating `result`**. Everything after that `result` belongs to the NEXT turn. The SDK emits one `result` per user-message turn, so the pattern is: push user message → iterate until `result` seen → `return`. Do NOT exit the `for await` — the generator keeps going; we just break out of the per-turn handler.

**Lifetime invariant:** the outer iteration of `q` happens in ONE async function (the "driver loop") that runs for the agent's whole lifetime, dispatching messages to the current per-turn handler. This is the async-queue bridge.

### Pattern 2: Serial Turn Queue per Agent (HIGH confidence)

**What:** A one-slot mutex per agent session. A new turn waits for the previous turn's `result` before pushing its user message into the SDK input iterable.

**When to use:** Always. Both Discord and OpenAI paths assume one in-flight turn per agent — the Discord `TurnDispatcher` has a single `dispatchStream` call per channel message, and the OpenAI server's post-v2.0 hardening explicitly tracks `isRunning` per agent, not per request.

**Why it's load-bearing:** without serialization, a second user message pushed into the iterable while Turn 1 is still streaming would interleave — the SDK would try to dispatch two "active" user turns against the same CLI subprocess, and we'd get interleaved `result` events that the current `iterateWithTracing` shape cannot disambiguate.

**Backpressure signal:** when a second turn arrives for the same agent, we MUST decide: (a) queue it (acceptable — matches Discord's behavior when a user sends two messages fast), or (b) reject with a specific code. The Discord bridge silently serializes via its own queue. The OpenAI driver today fails with `SessionError` via the warm-path catch. **Recommendation: queue with a max depth of 1 per agent on top of the in-flight turn.** Beyond 1, reject the second-queued request with HTTP 429 + `X-Retry-After: 1`. This preserves Discord semantics AND gives OpenClaw a clean retry signal.

**Example (shape only — the real work is bookkeeping errors around `interrupt()` when a turn is aborted mid-flight):**
```typescript
class SerialTurnQueue {
  private inFlight: Promise<unknown> | null = null;
  private queued: Promise<unknown> | null = null;

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.inFlight && this.queued) {
      throw new Error("QUEUE_FULL");      // server maps to 429
    }
    if (this.inFlight) {
      this.queued = this.inFlight.then(() => {}, () => {});
      await this.queued;
    }
    const p = fn();
    this.inFlight = p.finally(() => {
      this.inFlight = null;
      this.queued = null;
    });
    return p;
  }
}
```

### Pattern 3: Conversation Brief Cache (HIGH confidence)

**What:** A per-agent `Map<agent, { fingerprint: string; briefBlock: string }>` keyed inside SessionManager. Populated by `buildSessionConfig` at session start; reused by the persistent-generator's future brief re-assembly paths.

**Why needed:** today `buildSessionConfig` is called once per `startAgent` (so once per daemon boot per agent), and the brief is fast (<1ms per the project metrics). HOWEVER — when we collapse per-turn `sdk.query()` into a persistent generator, any future per-turn refresh of the brief (e.g., a future requirement to regenerate the brief when a new terminated session appears mid-daemon) would blow this up. Adding the cache NOW creates the seam the follow-up phase needs without changing current behavior.

**Fingerprint (CONTEXT specifies):** sha256 over the sorted list of terminated session IDs that `assembleConversationBrief` considered. Rationale:
- These are the brief's actual inputs (along with `now` for gap-check, but `now` changes every ms — it's not an invalidation key, it's a staleness signal handled separately).
- When a new session ends mid-daemon, the fingerprint changes → cache invalidated → brief re-assembled on next read.
- Stable across all other mutations (skills hot-reload, hot-tier drift) because those affect the stable prefix, not the brief.

**Invalidation triggers:**
1. ConversationStore emits `sessionEnded` for this agent (hook into `SessionManager.stopAgent` and crash path — both already `.delete()` the agent's activeConversationSessionId).
2. Explicit bust via `sessionManager.invalidateBriefCache(agentName)` (escape hatch for tests + future hot-reload).
3. First miss per agent fills the cache.

**Scope:** the cache is in-memory, per-daemon-boot. No persistence needed.

### Pattern 4: TTFB Instrumentation via `openai.chat_completion` Span

**What:** A NEW span opened at the top of `createOpenAiSessionDriver.dispatch` in `src/openai/driver.ts`. Fields:
- `name: "openai.chat_completion"`
- metadata at end: `{ agent, keyHashPrefix: string, ttfb_ms: number, total_turn_ms: number, stream: boolean, xRequestId: string, tools: number }`

**TTFB definition:** time from driver entry to first `content_block_delta.text_delta` event (the same point Discord's `first_token` span closes on). NOT time-to-first-SSE-chunk (that includes the initial `role` chunk which is pre-driver).

**Total turn ms:** driver entry to dispatchPromise resolution (success) or rejection (error).

**How it fits with existing spans:**
- `end_to_end` (session-adapter) — full SDK-iteration lifecycle, per-turn
- `first_token` (session-adapter) — first visible token from the model, per-turn
- `context_assemble` (context-assembler) — prefix building cost
- `openai.chat_completion` (NEW, driver) — total from HTTP-handler-hand-off to response end; sibling of `end_to_end` at the driver level

Recording both `first_token` (adapter) and `ttfb_ms` (driver) gives us TWO measurements of the same phenomenon from different layers. The difference is driver-overhead (queue wait, message push, HTTP response ramp) vs raw SDK first-token. In production both should track within ~20ms; divergence is a signal.

**Driver code shape:**
```typescript
// src/openai/driver.ts
function runDispatch(deps, input) {
  const turnSpan = deps.traceCollectorFor(agent)?.startTurn(...);
  const chatSpan = turnSpan?.startSpan("openai.chat_completion", {
    agent,
    keyHashPrefix: keyHash.slice(0, 8),
    xRequestId,
    stream: true,
    tools: input.tools.length,
  });
  const dispatchStartMs = Date.now();
  let firstDeltaMs: number | undefined;

  const onChunk = (accumulated: string) => {
    if (firstDeltaMs === undefined) firstDeltaMs = Date.now();
    // ... existing delta emit
  };

  dispatchPromise
    .then(() => {
      chatSpan?.setMetadata({
        ttfb_ms: firstDeltaMs ? firstDeltaMs - dispatchStartMs : null,
        total_turn_ms: Date.now() - dispatchStartMs,
      });
      chatSpan?.end();
    })
    .catch(() => {
      chatSpan?.setMetadata({ error: true, total_turn_ms: Date.now() - dispatchStartMs });
      chatSpan?.end();
    });
}
```

### Pattern 5: Readiness-Wait Tuning (MEDIUM confidence — single observation)

**What:** Lower `agentReadinessWaitMs` default from 2000 to 300ms.

**Why 300ms:** warm-path total_ms observed at 15.8ms per the 260419-jtk journal (sqlite ~3ms + embedder ~12ms + session ~1ms). The gate's job is NOT to wait for warm-path to complete; it's to bound the race between `startOpenAiEndpoint` opening the HTTP listener and `SessionManager.startAgent` completing `runWarmPathCheck`. With the persistent-subprocess change, the common "agent is already warm" path returns immediately via `isRunning(name) === true`. The wait only fires during the narrow daemon-boot window.

**Why not lower (e.g., 100ms):** systemd `restart clawcode` restart + `startAll` loop means multiple agents flip from `starting → running` in quick succession. During a ~50ms window when the HTTP listener is up but SessionManager is still mid-`startAll`, 300ms gives a safety margin while keeping worst-case OpenClaw-wait at a human-acceptable level.

**Why not higher:** OpenClaw's `openclaw-claude-bridge` sets a 20-minute hard timeout per request but starts considering a request "slow" after ~5-15s based on the dashboard polling cadence. 300ms is well below the perception threshold.

**Why make it configurable:** keep the env override (`CLAWCODE_OPENAI_READINESS_WAIT_MS` — propose adding) for operational escape hatch. Default 300ms; bump via env if a clawdy restart ever misses its budget.

**How to validate post-deploy:** emit a metric on the `openai.chat_completion` span: `{ agent_warming_fired: boolean, readiness_wait_ms_actual: number }`. If more than 1-in-1000 requests fire the wait, we misjudged the budget.

### Anti-Patterns to Avoid

- **One generator per bearer key.** A single API-key-burst from OpenClaw would spawn N subprocesses for the same agent. Per-agent generator + per-request session-continuity (via the existing ConversationStore bearer→session mapping) is the right layering.
- **Blocking turn-queue on `interrupt()`.** `Query.interrupt()` is `Promise<void>` — it's async. Do NOT `await` it on the hot path; fire-and-forget + rely on the eventual `result` with `subtype !== "success"` to close the turn. Worst case the queue holds a slot for a few ms longer.
- **Respawning the generator on every tool-use-result round-trip.** Tool-use round-trips are multiple `assistant → tool_use → user(tool_result) → assistant` message cycles — the SDK handles them within a single logical turn. The user-message iterable feeds only USER-INITIATED turns.
- **Caching the brief on `agentName` alone.** CONTEXT explicitly states fingerprint on terminated-session-ids. Key on name alone → stale brief after a session ends mid-daemon; all existing Phase 67 assembler logic expects fresh inputs when they change.
- **Closing the generator to "reset" mid-session.** `close()` terminates the CLI subprocess. Re-opening costs the same ~7s we're trying to eliminate. Use `interrupt()` + the existing crash-recovery path to get a fresh generator only on actual error.
- **Rebuilding the conversation brief on every turn.** That's the cache's whole reason to exist. Fingerprint-miss = rebuild; otherwise return cached block.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Streaming user-message input to Claude | A custom stdin protocol over `child_process.spawn('claude', ...)` | `sdk.query({ prompt: asyncIterable })` | SDK at 0.2.97 handles the wire format, JSONL output, session-id lookup, tool-result injection, MCP reconnect. Rolling it ourselves = rebuilding Claude CLI's stdin protocol (see `claude.js` in openclaw-claude-bridge for what that costs — 250 lines of subprocess management). |
| Mid-session model/effort swap | Re-spawn the generator | `Query.setModel()` / `Query.setMaxThinkingTokens()` / `applyFlagSettings()` | SDK's "streaming input mode" exposes these mutators; re-spawn costs a TTFB round. Reserved for the follow-up `reasoning_effort` phase; known available. |
| Turn serialization | Unbounded Promise chain | One-slot async queue with depth-1 waiter | Chain grows unboundedly under burst; rejects silently fail observability. Explicit queue-full = 429 = client retries. |
| Conversation-brief fingerprint | JSON.stringify of full terminated-session list | sha256-of-sorted-IDs (like `computePrefixHash`) | Matches the existing Phase 52 pattern. Hex fingerprint is trivially comparable and scales to hundreds of sessions without growing keys. |
| TTFB span metadata | New span type + new TraceStore column | Reuse `Span.setMetadata` on a generic span | `trace-collector.ts:Span.setMetadata` is designed for exactly this — shallow-merge metadata up to `.end()`. Plan 55 proved the pattern (`cache_hit_duration_ms` on tool-call spans). |
| Readiness wait polling | Push-based readiness event on a new IPC channel | Keep the existing poll (50ms cadence) and tune the budget | The poll already exists; the wait is 1-2 polls in the common case. Adding a push path doubles the lifecycle logic for a micro-optimization. CONTEXT explicitly defers push-based readiness. |

**Key insight:** the SDK at 0.2.x is pre-1.0 and has churn across minor versions, BUT every primitive Phase 73 needs is present at 0.2.97 and documented in the types. Use them directly — no wrappers, no replay layers.

## Runtime State Inventory

This phase is a refactor + measurement add. No rename, no schema change.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Claude CLI session JSONL files under `~/.claude/projects/...` — exactly the resume targets we use today. Persistent generator reads them on first turn via `resume: sessionId`; no migration. | None. |
| Live service config | None changed. `agentReadinessWaitMs` default lowered from 2000 → 300ms in `endpoint-bootstrap.ts` (code edit, not config-file edit). | None. |
| OS-registered state | None. The `clawcode.service` systemd unit is unchanged. | None. |
| Secrets/env vars | Propose NEW `CLAWCODE_OPENAI_READINESS_WAIT_MS` env override for operational tuning. Not required for this phase — can defer to follow-up if operator tooling is out of scope. | Optional. |
| Build artifacts | ESM build output picks up new files (`persistent-session-handle.ts`, `persistent-session-queue.ts`, `conversation-brief-cache.ts`) automatically via tsup. | None. |

**Nothing in the rename/refactor categories needs a data migration** — the agent's session JSONL is the same on disk whether we spawn one CLI per turn or keep one alive; both use `resume: sessionId`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | ✓ | 22 LTS | — |
| `@anthropic-ai/claude-agent-sdk` | Persistent generator via `streamInput` / `query(asyncIterable)` | ✓ | 0.2.97 (installed) | — |
| `claude` CLI binary | SDK subprocess target | ✓ on clawdy (systemd service runs as `clawcode` user with the CLI on PATH) | — | — |
| Python `openai` SDK | E2E smoke from a client | ⚠️ test host only | pip 6.x | `curl` + manual SSE inspection |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none.

## Track A — OpenClaw External Consumer Pattern

**Location of truth:** two consumers exist on this host; both are the user's own code.

### `/home/jjagpal/openclaw-claude-bridge/` (production path to clawdy)

- **What it is:** Node.js Express server (`src/server.js` — 970 lines) that listens on `127.0.0.1:3456`, speaks OpenAI `/v1/chat/completions`, and spawns `claude --print --output-format stream-json --verbose ...` via `spawn` for each request (see `src/claude.js:123`).
- **Consumption shape toward an OpenAI endpoint:** this bridge IS OpenAI-format. It doesn't directly call clawdy — it's a shim that OpenClaw-as-consumer connects to. BUT the shape of requests it produces (request body, headers, streaming expectations, retry/abort) is EXACTLY what OpenClaw would send to ClawCode's `/v1/chat/completions` if routed there directly.
- **Streaming preference:** `stream: true` by default unless `req.body.stream === false` (src/server.js:631). Every observable OpenClaw request against this bridge sets stream=true — the bridge assumes it.
- **Rendering:** OpenClaw renders per-token. The bridge's SSE emission pattern is one chunk per text delta; OpenClaw's frontend reads them as they arrive.
- **Timeouts:** 2-minute idle timeout (IDLE_TIMEOUT_MS, reset on every stdout line — `claude.js:41,146-150`). 20-minute hard cap (`claude.js:153-154`). SSE keepalive every 20s via `: keepalive\n\n` (`server.js:673-678`) specifically to prevent OpenClaw from timing out during long tool calls.
- **Abort behavior:** `res.on('close', () => { if (!res.writableFinished) ac.abort(); })` (`server.js:667`). When OpenClaw's user closes the app mid-stream, the bridge aborts the Claude process immediately — no lingering generation. **ClawCode MUST preserve this (it already does via `req.on('close')` + AbortController).**
- **Concurrency model:** per-channel max 2 concurrent requests (`MAX_PER_CHANNEL`, `server.js:157`). Global max 20 (`MAX_GLOBAL`). Rejects 429 if exceeded. **For ClawCode: a single OpenClaw agent might send 1-2 concurrent requests per channel (rare but possible during tool loops) and up to 20 globally across all channels.** Our per-agent serial queue (Pattern 2) handles the per-agent concurrency naturally; the global cap is a clawdy-wide concern that the current OpenAI server doesn't enforce.
- **Latency-sensitive metric:** the dashboard records `durationMs` per request (`server.js:893`) — but the user-facing sensitivity is to FIRST-token latency (OpenClaw shows the "thinking" spinner until the first chunk arrives). Total completion time matters less because the stream updates as it goes.
- **Special headers/params:**
  - `stream_options: {include_usage: true}` — NOT observed set by OpenClaw in the bridge code (no explicit check), but the bridge DOES emit a separate usage chunk with `choices: []` at the end of every stream (`server.js:812-818`), implying OpenClaw parses them when present.
  - `X-OpenClaw-Session-Key` header — observed in request logging (`server.js:336-339`). The bridge uses it as a hint but derives actual conversation identity from message metadata.
  - `reasoning_effort` field in body — mapped to Claude CLI `--effort` (`claude.js:48-58`). OpenClaw sends `minimal|low|medium|high|xhigh` → bridge maps to `low|medium|high|max`. **This is on the CONTEXT deferred list for Phase 73 but confirms the follow-up phase has a real consumer.**
  - `user` field — NOT observed set.

### `/home/jjagpal/openclaw-claude-runner/` (experimental in-process SDK path)

- **What it is:** an OpenClaw plugin (`index.ts`) that registers `claude-runner` as a provider, starts an embedded `node:http` server on `127.0.0.1:7779`, and routes OpenClaw requests through the Claude Agent SDK's `query()` directly (`src/claude-bridge.ts`).
- **Relevance to Phase 73:** this is the most honest reference implementation for what we're building. Their `handleStreamingResponse` (lines 501-644) is the pattern ClawCode's driver already emulates: `query({ prompt, options: { includePartialMessages: true, abortController, resume, appendSystemPrompt, effort, maxTurns, ... } })`, iterate for `stream_event`/`result`, emit SSE per text_delta. Their session store is keyed by a derived conversation id (sha256 of first user message content, first 16 hex — `src/claude-bridge.ts:313-319`).
- **Queue model:** Single-concurrency `RequestQueue` with jittered spawn delay (1-4s between spawns by default — `claude-bridge.ts:178,225`) and 60s queue timeout. This is **because per-request subprocess spawn costs are severe** — jitter avoids thrash. The persistent generator we're building eliminates the need for this.
- **Retry model:** up to 2 retries on transient errors (ECONNRESET, 503, 529, rate-limit, overloaded) with 1s/2s backoff (`claude-bridge.ts:37-38,233-246,408-444`). Stale session → retry with a fresh session-id.
- **Context fill monitoring:** tracks per-session `fillPercent` from `result.modelUsage`, auto-rotates session when fill > 0.75 with a compacted summary injected into the next session's system prompt (`claude-bridge.ts:137-141,772-783`). **Out of scope for Phase 73** — ClawCode has a parallel mechanism via `memory/context-summary.ts`.

### Empirical consumption patterns (from both consumers)

1. Every request is `stream: true`.
2. Every request expects per-token deltas (not one-shot final text).
3. Abort-on-close is required; user-initiated cancellation is common.
4. Keepalive during long pauses is expected (every 15-20s).
5. Model name in `model` field; session mapping is derived from body content / headers (there is no "bearer = session" contract in either consumer — BUT ClawCode's choice to tie bearer → session works because the bridge-in-the-middle is stateless and delegates session continuity).
6. Tool-use chunks follow the exact OpenAI spec (accumulate `tool_calls[i].function.arguments` partial strings).
7. Separate final usage chunk with `choices: []` and populated `usage`.

**Corroboration:** openclaw-claude-bridge README (`/home/jjagpal/openclaw-claude-bridge/README.md`) — not read yet, but the source code is authoritative.

## Common Pitfalls

### Pitfall 1: Persistent generator crash mid-turn
**What goes wrong:** `claude` CLI subprocess OOMs or is killed; the `Query` iterator throws; any in-flight turn's `await` rejects.
**Why it happens:** long-lived processes accumulate memory; CLI bugs; operator SIGKILL.
**How to avoid:** wrap the outer iteration in try/catch. On error: (a) reject any in-flight turn handler with a `SessionError("generator-dead")`, (b) close the queue's backlog with the same error, (c) trigger `SessionRecoveryManager.handleCrash` via the existing `handle.onError` pathway (already wired in `session-manager.ts:290`). The recovery manager re-runs `startAgent`, which creates a fresh persistent handle.
**Warning signs:** a 5xx cluster in the openai.chat_completion span metadata; `handle.onError` firing; `warm_path_ready: false` in the registry for an agent that WAS running.

### Pitfall 2: Turn queue deadlock on unhandled resolver
**What goes wrong:** a bug in `iterateUntilResult` throws BEFORE registering the in-flight promise → queue never advances.
**Why it happens:** exception between `inputQueue.push(...)` and the `await q.next()` loop start.
**How to avoid:** wrap the entire per-turn handler in a try/finally that ALWAYS clears the queue slot. Model after `src/openai/driver.ts:endTurnOnce` (Phase 69 driver's `turnEnded` guard).
**Warning signs:** the agent stops responding but appears `isRunning: true`.

### Pitfall 3: SDK emits no `result` for an aborted turn
**What goes wrong:** we push user message, client calls `req.on('close')` → abort, then we wait for a `result` that never arrives because the SDK terminated the turn on the abort signal.
**Why it happens:** the SDK's abort path skips the `result` event in some cases (specifically when the CLI is killed before emitting the final message).
**How to avoid:** after calling `Query.interrupt()`, listen for EITHER a `result` OR a generator-level "interrupt ACK" message AND a deadline (say 2s). Whichever fires first ends the turn handler with `status: "error"`. The persistent generator stays alive — `interrupt()` does NOT close it.
**Warning signs:** `openai.chat_completion` span stays open after client disconnect; queue slot leak.

### Pitfall 4: `includePartialMessages` + `setModel` mid-turn
**What goes wrong:** operator changes reasoning effort via `setModel`/`setMaxThinkingTokens` while a turn is streaming → SDK may emit partial messages for the new config that our translator doesn't expect.
**Why it happens:** streaming input mode exposes these mutators without gating on "between turns only."
**How to avoid:** serialize mutator calls through the same turn queue so they never interleave with an active turn. Future follow-up phase needs this — not wiring it now but the design should NOT preclude it.
**Warning signs:** span metadata showing `model` mismatch across `first_token` and `result`.

### Pitfall 5: Conversation-brief cache poisoning by concurrent writers
**What goes wrong:** two turns start concurrently for two agents; both miss the cache; both compute the brief; one overwrites the other's entry. Normally harmless but if one computed with stale session-list (race with `stopAgent`), the winner could have outdated data.
**Why it happens:** the brief cache is a plain `Map` — no per-agent lock.
**How to avoid:** key invalidation on `stopAgent`/`sessionCrash` via the existing `SessionManager.sessionEndCallbacks` path. Concurrency is naturally serialized per agent by the turn queue, so same-agent races can't happen. Cross-agent races don't invalidate each other's entries (different keys).
**Warning signs:** an agent shows a resume-brief referencing a session that no longer exists.

### Pitfall 6: `agentReadinessWaitMs` tuned too aggressively
**What goes wrong:** 300ms is too short for some systemd-restart boot orderings; requests arrive while SessionManager's `startAll` is still mid-agent; 503s spike.
**Why it happens:** startup ordering varies (ConversationStore init, embedder warm-up, sqlite-vec load).
**How to avoid:** treat 300ms as a trial default; expose env override; add a trace metric (`readiness_wait_ms_actual`) so we can retune based on observed p99.
**Warning signs:** post-deploy, agent_warming 503s in the log for > 1-in-500 requests.

### Pitfall 7: Brief cache never invalidates → stale for the life of a daemon
**What goes wrong:** a new terminated session appears (user manually invokes `/stop agent`, triggers the summarizeSession path, writes a new `session-summary` memory); brief should now reference it; cache never sees it.
**Why it happens:** cache invalidation only on our own agent's `stopAgent`, not on arbitrary memory writes.
**How to avoid:** fingerprint on `conversationStore.getTerminatedSessions(agent).map(s => s.id)` — changes whenever a session ends. Recompute fingerprint on every cache READ; compare to stored. If fingerprint differs → treat as miss. This is still O(1) (sha256 of small string) per read; ~10μs.
**Warning signs:** brief content doesn't reflect a recent session end.

### Pitfall 8: Double-ending the openai.chat_completion span
**What goes wrong:** both success path and abort path call `span.end()`; the second call is silently dropped (trace-collector idempotent), BUT the metadata captured at the first `.end()` doesn't include the abort info.
**Why it happens:** parallel wiring from multiple codepaths.
**How to avoid:** same `endTurnOnce`-style guard used in `src/openai/driver.ts:207-215`. Track `chatSpanEnded: boolean` in the driver closure.
**Warning signs:** span metadata missing `error: true` on aborted requests.

## Code Examples

### Example 1: Minimal pushable AsyncIterable pattern (pattern, not library code)
```typescript
// Source: established pattern from src/openai/driver.ts:runDispatch and adapted to SDKUserMessage.
class AsyncPushQueue<T> implements AsyncIterable<T> {
  private queue: T[] = [];
  private waiter: ((v: IteratorResult<T>) => void) | null = null;
  private done = false;

  push(item: T): void {
    if (this.waiter) {
      const w = this.waiter; this.waiter = null;
      w({ value: item, done: false });
      return;
    }
    this.queue.push(item);
  }
  end(): void {
    this.done = true;
    if (this.waiter) { this.waiter({ value: undefined as T, done: true }); this.waiter = null; }
  }
  [Symbol.asyncIterator]() {
    return {
      next: () => new Promise<IteratorResult<T>>(resolve => {
        const item = this.queue.shift();
        if (item !== undefined) resolve({ value: item, done: false });
        else if (this.done) resolve({ value: undefined as T, done: true });
        else this.waiter = resolve;
      }),
    };
  }
}
```

### Example 2: Conversation-brief fingerprint
```typescript
// Source: mirrors src/manager/context-assembler.ts:computePrefixHash shape.
import { createHash } from "node:crypto";

export function computeBriefFingerprint(terminatedSessionIds: readonly string[]): string {
  const sorted = [...terminatedSessionIds].sort();
  return createHash("sha256").update(sorted.join("|")).digest("hex").slice(0, 16);
}
```

### Example 3: Structure of the persistent handle's `sendAndStream`
```typescript
// Shape derived from existing session-adapter.ts:iterateWithTracing + driver.ts bounded queue.
async function sendAndStream(message: string, onChunk, turn, options) {
  if (closed) throw new Error("session closed");
  await turnQueue.acquire();   // serialize; throws QUEUE_FULL if depth >= 1
  try {
    inputQueue.push({
      type: "user",
      message: { role: "user", content: promptWithMutable(message) },
      parent_tool_use_id: null,
    });
    return await iterateUntilResult(q, onChunk, turn, options);
  } finally {
    turnQueue.release();
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-turn `sdk.query(...)` with `resume: sessionId` (ClawCode v1.x–v2.0) | Persistent `sdk.query({ prompt: asyncIterable })` per agent with serial turn queue | This phase (v2.1 latency) | ~5s TTFB reduction on warm agents; prompt-cache retention improves because the same Anthropic-side session stays warm. |
| Conversation-brief rebuilt on every `startAgent`/`resumeSession` | Brief cached per agent, invalidated on terminated-session-set fingerprint change | This phase | Eliminates a <1ms overhead AS SUCH but creates the seam needed for future per-turn brief refresh without re-introducing latency. |
| `agentReadinessWaitMs: 2000` | `agentReadinessWaitMs: 300` | This phase | Tightens worst-case OpenClaw wait-for-agent-warm to perception-threshold; relies on persistent-subprocess change making `isRunning === true` the common case. |
| No driver-level TTFB span | New `openai.chat_completion` span with `ttfb_ms` + `total_turn_ms` metadata | This phase | Enables before/after comparison via the existing `clawcode trace` CLI + context-audit report. Required to PROVE the sub-2s goal. |

**Deprecated/outdated (nothing deprecated in this phase — we're extending, not replacing):**
- Per-turn `sdk.query()` remains callable (used by `createSession`'s initial drain); just not the per-message hot path.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.x (already installed) |
| Config file | `vitest.config.ts` at repo root |
| Quick run command | `npx vitest run src/openai/ src/manager/__tests__/session-adapter.test.ts src/manager/__tests__/session-manager.test.ts` |
| Full suite command | `npx vitest run` |
| Phase gate | Full suite green before `/gsd:verify-work` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LAT-01 | Persistent handle survives N turns without spawning a new CLI subprocess | unit | `npx vitest run src/manager/__tests__/persistent-session-handle.test.ts` | ❌ Wave 0 |
| LAT-01 | Turn 2 TTFB < 2s vs Turn 1 TTFB < ~7s (SDK mock with simulated latency) | unit | same file | ❌ Wave 0 |
| LAT-01 | QUEUE_FULL on concurrent turn attempts (depth-1 queue) | unit | `npx vitest run src/manager/__tests__/persistent-session-queue.test.ts` | ❌ Wave 0 |
| LAT-01 | Crash recovery: handle.onError fires, SessionRecoveryManager reboots a fresh handle, subsequent turn succeeds | integration | `npx vitest run src/manager/__tests__/persistent-session-recovery.test.ts` | ❌ Wave 0 |
| LAT-02 | First `buildSessionConfig` call computes brief; second call (same fingerprint) returns cached block, zero re-assembly | unit | `npx vitest run src/manager/__tests__/conversation-brief-cache.test.ts` | ❌ Wave 0 |
| LAT-02 | New terminated-session-id in ConversationStore → fingerprint changes → re-assembly on next read | unit | same file | ❌ Wave 0 |
| LAT-03 | Streamed request produces a single `openai.chat_completion` span with `ttfb_ms` (time to first text_delta) and `total_turn_ms` | unit | `npx vitest run src/openai/__tests__/driver.test.ts` | ✓ (extend) |
| LAT-03 | Aborted request produces the span with `error: true` metadata and finite `total_turn_ms` | unit | same file | ✓ (extend) |
| LAT-04 | Default `agentReadinessWaitMs` is 300ms; env override works | unit | `npx vitest run src/openai/__tests__/endpoint-bootstrap.test.ts` | ✓ (extend) |
| LAT-04 | With isRunning already true, handler dispatches in < 50ms (no wait) | unit | `npx vitest run src/openai/__tests__/server.test.ts` | ✓ (W1 exists — extend for new default) |
| LAT-05 | Across N turns on the persistent handle, each turn's `recordCacheUsage` has `cacheReadInputTokens > 0` after turn 1 | integration | `npx vitest run src/manager/__tests__/persistent-session-cache.test.ts` | ❌ Wave 0 |
| Discord non-regression | Existing Discord sendAndStream tests green (zero changes needed) | regression | `npx vitest run src/discord/` | ✓ (existing) |
| Test-suite non-regression | Full suite ≤ pre-existing flaky count | regression | `npx vitest run` | ✓ (existing) |

### Sampling Rate
- **Per task commit:** `npx vitest run src/openai/ src/manager/__tests__/session-adapter.test.ts src/manager/__tests__/persistent-*.test.ts src/manager/__tests__/conversation-brief-cache.test.ts`
- **Per wave merge:** `npx vitest run` + `npx tsc --noEmit` (verify no new errors beyond the three pre-existing in daemon.ts)
- **Phase gate:** full suite green, then manual smoke on clawdy: `curl /v1/chat/completions` twice against a warm agent, measure TTFB on both — expect < 2s on the second.

### Wave 0 Gaps
- [ ] `src/manager/__tests__/persistent-session-handle.test.ts` — covers LAT-01 (persistent generator, TTFB delta, message ordering)
- [ ] `src/manager/__tests__/persistent-session-queue.test.ts` — covers LAT-01 (QUEUE_FULL, serial ordering, abort-during-queue)
- [ ] `src/manager/__tests__/persistent-session-recovery.test.ts` — covers LAT-01 (crash → recover → next turn succeeds)
- [ ] `src/manager/__tests__/conversation-brief-cache.test.ts` — covers LAT-02 (hit, miss, fingerprint invalidation, concurrent agents)
- [ ] `src/manager/__tests__/persistent-session-cache.test.ts` — covers LAT-05 (cache_read_input_tokens dominates turn 2+)
- [ ] Extend `src/openai/__tests__/driver.test.ts` — covers LAT-03 (new `openai.chat_completion` span with TTFB metadata)
- [ ] Extend `src/openai/__tests__/endpoint-bootstrap.test.ts` — covers LAT-04 (readiness-wait default change + env override)
- [ ] Optional shared fixture: `src/manager/__tests__/__fixtures__/sdk-persistent-stream.ts` — SDK mock that accepts pushable input iterable and emits canned stream events with configurable latency per turn (for TTFB regression tests)

Framework install: none needed — vitest is installed.

## Sources

### Primary (HIGH confidence)
- `/home/jjagpal/.openclaw/workspace-coding/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` — lines 1687-1877 (`Query` interface, `streamInput`, `interrupt`, `close`); 1879-1882 (`query()` signature); 2870-2883 (`SDKUserMessage`). SDK version 0.2.97 per `node_modules/@anthropic-ai/claude-agent-sdk/package.json:version`.
- `/home/jjagpal/.openclaw/workspace-coding/src/manager/session-adapter.ts` — `wrapSdkQuery` + `iterateWithTracing` (the pattern to preserve at the `SessionHandle` boundary).
- `/home/jjagpal/.openclaw/workspace-coding/src/manager/session-manager.ts` — `startAgent` + `resumeSession` + `sessionEndCallbacks` (crash/recovery integration points).
- `/home/jjagpal/.openclaw/workspace-coding/src/manager/session-config.ts` — `buildSessionConfig` + `assembleConversationBrief` call site.
- `/home/jjagpal/.openclaw/workspace-coding/src/openai/driver.ts` — dispatch-as-iterator pattern (Pitfall 8 guard reference).
- `/home/jjagpal/.openclaw/workspace-coding/src/openai/server.ts` (lines 116-121, 486-495) — `agentReadinessWaitMs` / `agentReadinessPollIntervalMs` config and current default 2000ms.
- `/home/jjagpal/.openclaw/workspace-coding/src/openai/endpoint-bootstrap.ts` (lines 178-180) — existing binding of `sessionManager.isRunning`.
- `/home/jjagpal/.openclaw/workspace-coding/src/performance/trace-collector.ts` — `Span.setMetadata` / `Turn.startSpan` (Pattern 4 reference).
- `/home/jjagpal/openclaw-claude-bridge/src/server.js` — empirical OpenClaw consumer patterns (concurrency, timeouts, abort, keepalive, usage-chunk emission).
- `/home/jjagpal/openclaw-claude-bridge/src/claude.js` — spawn/idle-timeout/abort shape.
- `/home/jjagpal/openclaw-claude-runner/src/claude-bridge.ts` — in-process SDK-consumer pattern (session store, queue+jitter, compaction model, context-usage extraction).

### Secondary (MEDIUM confidence)
- `.planning/phases/69-openai-compatible-endpoint/69-RESEARCH.md` — Pitfalls 1-8 (streaming, abort, tool-call accumulation, key hashing) remain applicable.
- `.planning/quick/260419-jtk-harden-openai-streaming-for-openclaw-emi/260419-jtk-SUMMARY.md` — prior warm-path 15.8ms observation; `isRunning` API; W1-W5 server tests already green.
- Phase 52/53/55 plans (via session-adapter.ts code history in-line) — the per-turn prefixHashProvider + cache-telemetry pattern that LAT-05 relies on.

### Tertiary (LOW confidence)
- None. All Phase 73 specifics are backed by installed source, in-tree test fixtures, or prior committed phase research.

## Open Questions

1. **Do we want an env override for `agentReadinessWaitMs`?**
   - What we know: there's no existing env override; current default is a hard-coded 2000 in `endpoint-bootstrap.ts`.
   - What's unclear: operator need — clawdy runs the v1.7 prompt-cache SLO on a relatively stable systemd lifecycle, so a hard default of 300 might be fine forever.
   - Recommendation: ship the new hard default (300ms); wire a `CLAWCODE_OPENAI_READINESS_WAIT_MS` env override for operational safety. Trivial cost.

2. **Max queue depth — exactly 1 or should we allow 2?**
   - What we know: Discord serializes naturally per channel; OpenClaw's bridge allows 2 per channel but that's per bridge's own logic.
   - What's unclear: whether OpenClaw (running on clawdy as our consumer) might itself fire 2 requests for the same agent during a fast tool-use cycle.
   - Recommendation: start with depth 1 (strictest); tune up to 2 if 429s become common. The span metric (`queue_wait_ms`) will tell us.

3. **Should the persistent handle be opt-in via a feature flag during initial rollout?**
   - What we know: Phase 73 is a refactor with measurable regression risk. Feature-flag gating would let us flip off quickly if a clawdy canary misbehaves.
   - What's unclear: operational overhead of carrying the flag vs. the clean "land + revert-commit-if-needed" path we use elsewhere.
   - Recommendation: no feature flag. The Discord path is covered by regression tests; a revert-commit is cheaper than carrying a dead flag long-term. Phase 69 and its post-v2.0 hardening shipped with the same discipline.

## Project Constraints (from CLAUDE.md)

Enforced by `./CLAUDE.md`:
- **Identity:** respond AS Clawdy with 💠. This affects no runtime behavior; applies only to agent-authored content, not this plan.
- **TypeScript 6.0.2 + Node.js 22 LTS + ESM** — unchanged stack; new files must use `.ts` with ESM `.js` import suffixes (already the project pattern).
- **`@anthropic-ai/claude-agent-sdk@0.2.x` pinned** — stay on 0.2.97 (installed); do NOT bump minor without explicit approval.
- **better-sqlite3 + sqlite-vec** — unchanged (not touched by this phase).
- **GSD Workflow Enforcement** — any file-changing work runs through `/gsd:execute-phase`. No direct edits outside that flow.
- **Immutability** (global coding rules at `~/.claude/rules/coding-style.md`) — new data structures prefer readonly + Object.freeze per existing project style in `trace-collector.ts`.
- **Many small files** — persistent-session-handle.ts + persistent-session-queue.ts + conversation-brief-cache.ts should each stay under 400 LOC.
- **Error handling** — every top-level async (new Maps, new Promises) must have try/catch + structured log line; no silent swallow except on the established observational-contract paths (cache telemetry, skill-tracking) mirrored from session-adapter.ts:820-824.
- **Security** (global rules at `~/.claude/rules/security.md`) — no new secret handling in this phase; the bearer-key hash is unchanged from Phase 69.

## Metadata

**Confidence breakdown:**
- SDK contract (`streamInput`, `query(asyncIterable)`, `Query` methods): HIGH — types verified in the installed package.
- OpenClaw consumption pattern: HIGH — two consumer codebases read in full; behaviors empirically observable.
- Brief-cache design: HIGH — fingerprint approach matches existing computePrefixHash + all invalidation paths are already hooked.
- `openai.chat_completion` span wiring: HIGH — trace-collector API supports exactly this; pattern identical to Phase 55's cache-hit enrichment.
- Readiness-wait tune from 2000 → 300ms: MEDIUM — based on ONE journal observation (15.8ms warm-path total_ms). Post-deploy telemetry needed to validate p99.
- Queue depth 1 choice: MEDIUM — conservative default; may need to tune based on OpenClaw behavior under load.

**Research date:** 2026-04-19
**Valid until:** 2026-05-19 (30 days — SDK on 0.2.97 is stable enough for that window; consumer repos are self-hosted and won't shift unannounced).
