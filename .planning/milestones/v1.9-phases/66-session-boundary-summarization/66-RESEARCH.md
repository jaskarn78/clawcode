# Phase 66: Session-Boundary Summarization - Research

**Researched:** 2026-04-18
**Domain:** LLM-based session summarization, SDK one-shot invocation, MemoryEntry dual-write
**Confidence:** HIGH

## Summary

Phase 66 inserts a `SessionSummarizer` service in the daemon, invoked from `SessionManager`'s two existing conversation-lifecycle handoff points (`stopAgent` for clean end, `handle.onError` for crashes). The summarizer reads turns from `ConversationStore.getTurnsForSession()`, invokes a one-shot Haiku `sdk.query()` with a 10-second `AbortController` timeout and a structured two-stage prompt, then writes a standard `MemoryEntry` via `memoryStore.insert()` tagged `["session-summary", "session:{id}"]`, finishing by calling `conversationStore.markSummarized(sessionId, memoryId)` to link the session row to its summary.

The project already has every building block needed: (1) `@anthropic-ai/claude-agent-sdk` 0.2.97 is installed and loaded via `loadSdk()` in `session-adapter.ts`; (2) `MemoryStore.insert()` already produces embeddings (via caller-supplied `Float32Array`) and triggers eager `autoLinkMemory()` for graph linking; (3) tier defaults to `warm`, giving automatic tier participation; (4) `ConversationStore` already has state transitions (`ended` → `summarized`, `crashed` → `summarized`) and the `summary_memory_id` FK. The *only* gap is that `MemoryStore.insert()` currently hard-codes `source_turn_ids: null` — the summary writer needs to propagate turn IDs, which requires extending `CreateMemoryInput` + `insertMemory` prepared statement (or doing a follow-up `UPDATE memories SET source_turn_ids=?`).

**Primary recommendation:** Create `src/memory/session-summarizer.ts` modeled on `consolidation.ts` (injected `summarize` dep, pure prompt builders, dual-write via `memoryStore.insert()` + `conversationStore.markSummarized()`). Hook it into `SessionManager.stopAgent` and `handle.onError` BEFORE `conversationStore.endSession/crashSession` would normally cleanup context. Use `sdk.query()` directly (not `manager.sendToAgent`) so summarization is a one-shot model call isolated from the agent's session history.

## User Constraints (from CONTEXT.md)

### Locked Decisions

- All implementation choices are at Claude's discretion — infrastructure phase. Use ROADMAP phase goal, success criteria, and research findings to guide decisions.

Key research guidance from CONTEXT.md:
- SessionSummarizer uses haiku via SDK --print from daemon process (NOT the agent)
- Structured two-stage extraction prompt: first extract raw items, then categorize (preferences, decisions, open threads, commitments)
- 10s hard timeout on haiku call — summarization failure is non-fatal
- Sessions with < 3 turns produce no summary (insufficient signal)
- Summary stored as standard MemoryEntry (source="conversation", tagged `["session-summary", "session:{id}"]`)
- importance=0.75-0.8 for session summaries
- Hook into SessionManager stop/crash handlers
- Follows consolidation.ts pattern for LLM-based summarization

### Claude's Discretion

Everything (infrastructure phase, no user-specific locks).

### Deferred Ideas (OUT OF SCOPE)

None — discuss phase skipped.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SESS-01 | On session end or restart, raw conversation turns are compressed into a structured summary (preferences, decisions, open threads, commitments) via haiku LLM call from the daemon | `sdk.query()` with Haiku model ID via `model-resolver.resolveModelId("haiku")`; two-stage structured prompt adapted from `consolidation.buildWeeklySummarizationPrompt`; 10s `AbortController` timeout (SDK supports `abortController` option per `sdk-types.ts:74`) |
| SESS-04 | Session summaries are stored as standard MemoryEntry objects (source="conversation") so they automatically participate in semantic search, relevance decay, tier management, and knowledge graph auto-linking | `memoryStore.insert({ source: "conversation", tags: ["session-summary", "session:{id}"], ... }, embedding)` — all existing machinery (warm tier default, `autoLinkMemory` eager call, decay scoring, tier promotion) engages automatically |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @anthropic-ai/claude-agent-sdk | ^0.2.97 | One-shot Haiku call for summarization | Already installed, loaded via `loadSdk()`. Supports `model`, `systemPrompt`, `abortController`, `allowDangerouslySkipPermissions` — everything needed for a daemon-side prompt-only LLM call with no tool use. |
| better-sqlite3 | ^12.8.0 | Read turns, write summary row | Already the DB layer for `ConversationStore` and `MemoryStore` sharing one `memories.db` connection. |
| nanoid | ^5.1.7 | (No new IDs) | `MemoryStore.insert()` generates its own ID; `markSummarized` takes that ID. Mentioned for completeness. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| zod | ^4.3.6 | Config schema extension | If adding a new `sessionSummary` sub-schema to `memoryConfigSchema` for tunables (timeout, min turn threshold, model override). Optional — defaults in code are equally fine for an infrastructure phase. |
| @anthropic-ai/tokenizer | ^0.0.4 | Token counting | Prompt truncation if conversation is huge. `performance/token-count.ts` already wraps it via `countTokens(text)`. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `sdk.query()` from a fresh call | `manager.sendToAgent(name, prompt)` (the existing consolidation pattern) | Reject. Routing summarization through the live agent session (a) pollutes the agent's own context with summarization prompts, (b) couples summary generation to the agent's model choice (we want Haiku specifically), (c) runs INSIDE the session we're trying to close, defeating the purpose. The `consolidation.ts` choice was acceptable because consolidation runs during a running agent's cron — session-end cannot assume the session still exists. |
| `abortController` via SDK option (sdk-types.ts:74) | `Promise.race([queryPromise, timeoutPromise])` | Use abortController. The SDK natively supports it (added in Phase 59 already). Promise.race leaks the still-running LLM call; AbortController cancels the underlying HTTP request. |
| Two-stage extraction prompt | Single-stage JSON-structured output | Two-stage per CONTEXT.md guidance. Haiku's JSON-mode reliability is weaker than Sonnet/Opus; staging "extract → categorize" gives it smaller chunks of reasoning per call. Alternative keep it as a single well-structured markdown prompt if two-stage proves latency-heavy in validation. |
| Extending `CreateMemoryInput` to accept `sourceTurnIds` | Follow-up `UPDATE memories SET source_turn_ids=?` after insert | Extending `CreateMemoryInput` + `insertMemory` prepared statement is cleaner (atomic, 1 transaction, usable by future phases for fact extraction). The UPDATE path works but adds a round trip and leaves `source_turn_ids` transiently NULL. Recommend extending `CreateMemoryInput`. |

**Installation:** None — zero new npm dependencies per v1.9 milestone commitment.

**Version verification:** All versions confirmed in `package.json` at the workspace root. No registry lookups needed — this phase uses only libraries already resolved in Phase 64/65.

## Architecture Patterns

### Recommended Module Layout

```
src/memory/
├── session-summarizer.ts          # NEW — pure pipeline + injected summarize dep
├── session-summarizer.types.ts    # NEW — SessionSummary, SummarizeDeps types
└── __tests__/
    └── session-summarizer.test.ts # NEW — unit tests w/ mock summarize

src/manager/
├── session-manager.ts             # MODIFIED — call summarizer in stopAgent + onError
└── daemon.ts                      # MODIFIED — wire summarize (sdk.query wrapper)

src/memory/
├── store.ts                       # MODIFIED — extend insert() to accept sourceTurnIds
└── types.ts                       # MODIFIED — CreateMemoryInput.sourceTurnIds?
```

### Pattern 1: Injected `summarize` Dependency (from consolidation.ts)

**What:** The summarizer module defines `SummarizeFn = (prompt: string, opts: { signal?: AbortSignal, model: string }) => Promise<string>` as an injected dep. Production wires this to an `sdk.query()` call; tests wire a mock.

**When to use:** Any LLM-invoking module. Keeps the pipeline deterministic and testable.

**Example (production wiring in `daemon.ts`):**
```typescript
// New helper src/manager/haiku-summarize.ts (or inline in daemon.ts)
import { query } from "@anthropic-ai/claude-agent-sdk";
import { resolveModelId } from "./model-resolver.js";

export async function summarizeWithHaiku(
  prompt: string,
  opts: { readonly signal?: AbortSignal },
): Promise<string> {
  const controller = opts.signal ? undefined : new AbortController();
  const signal = opts.signal ?? controller!.signal;
  const timer = setTimeout(() => controller?.abort(), 10_000);
  try {
    const q = query({
      prompt,
      options: {
        model: resolveModelId("haiku"),
        systemPrompt: "You are a concise summarizer. Respond with only the requested markdown sections.",
        allowDangerouslySkipPermissions: true,  // no tool use needed
        abortController: controller ?? new AbortController(),
      },
    });
    let result = "";
    for await (const msg of q) {
      if (msg.type === "result" && msg.subtype === "success" && msg.result) {
        result = msg.result;
        break;
      }
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
}
```

### Pattern 2: Dual-Write on Session Boundary

**What:** Summarization triggers a two-step write in a specific order:
1. `memoryStore.insert({ content, source: "conversation", importance: 0.78, tags: ["session-summary", `session:${sid}`], sourceTurnIds }, embedding)` → returns `MemoryEntry` with fresh `id`
2. `conversationStore.markSummarized(sid, memoryEntry.id)` → updates `conversation_sessions.summary_memory_id` FK + sets status to `summarized`

Order matters: the FK constraint on `summary_memory_id` requires the memory to exist first. This is why the existing `ConversationStore.test.ts` uses `createMemoryEntry()` helper before calling `markSummarized`.

**Example:**
```typescript
const entry = memoryStore.insert(
  {
    content: summaryMarkdown,
    source: "conversation",
    importance: 0.78,
    tags: ["session-summary", `session:${sessionId}`],
    sourceTurnIds: turnIds,  // NEW field — see Anti-Pattern 1 below
  },
  embedding,
);
conversationStore.markSummarized(sessionId, entry.id);
```

### Pattern 3: Non-Blocking Crash-Path Summarization

**What:** In `handle.onError`, the current Phase 65 code calls `conversationStore.crashSession(convSessionId)` synchronously BEFORE `recovery.handleCrash`. Phase 66 must insert summarization AFTER `crashSession` but BEFORE the restart trigger, and MUST NOT await — wrap in fire-and-forget `void summarize().catch(noop)` so crash recovery isn't blocked by a 10-second LLM call. The summarizer's internal await fires on a detached promise; recovery proceeds immediately.

**When to use:** Anywhere a non-critical async operation hangs off a lifecycle hook.

**Example:**
```typescript
handle.onError((error: Error) => {
  const convSessionId = this.activeConversationSessionIds.get(name);
  const convStoreForCrash = this.memory.conversationStores.get(name);
  if (convStoreForCrash && convSessionId) {
    try { convStoreForCrash.crashSession(convSessionId); } catch { /* best-effort */ }
    // Phase 66 — fire-and-forget summarization (non-fatal, non-blocking)
    void this.summarizeSession(name, convSessionId).catch((err) => {
      this.log.warn({ agent: name, session: convSessionId, error: (err as Error).message }, "crash-path summarization failed (non-fatal)");
    });
  }
  this.activeConversationSessionIds.delete(name);
  this.recovery.handleCrash(name, config, error, this.sessions);
  // ... existing session-end callback logic ...
});
```

### Pattern 4: `stopAgent` Path — Await Summarization (Bounded by Timeout)

**What:** In `stopAgent`, summarization CAN be awaited because `stopAgent` is user-initiated and already blocks (handle.close() takes time). The 10-second timeout puts an upper bound on stop latency. Placing it BEFORE `cleanupMemory()` is critical because `cleanupMemory` deletes the ConversationStore from the map.

**Example (order):**
```typescript
async stopAgent(name: string): Promise<void> {
  const handle = this.requireSession(name);
  this.recovery.clearStabilityTimer(name);
  this.recovery.clearRestartTimer(name);

  const convSessionId = this.activeConversationSessionIds.get(name);
  const convStoreForStop = this.memory.conversationStores.get(name);
  if (convStoreForStop && convSessionId) {
    try { convStoreForStop.endSession(convSessionId); } catch { /* session may already be ended */ }
    // Phase 66 — await summarization (bounded by 10s timeout in summarizer)
    try {
      await this.summarizeSession(name, convSessionId);
    } catch (err) {
      this.log.warn({ agent: name, session: convSessionId, error: (err as Error).message }, "stop-path summarization failed (non-fatal)");
    }
  }
  this.activeConversationSessionIds.delete(name);

  this.memory.cleanupMemory(name);  // this deletes the conversationStore!
  // ... rest of stopAgent
}
```

### Anti-Patterns to Avoid

- **Writing sourceTurnIds via a follow-up UPDATE:** Leaves a race window where a concurrent reader (e.g., graph linker heartbeat) sees a freshly-inserted memory with `source_turn_ids=NULL`. Prefer extending `insertMemory` to include the column in the single atomic transaction.
- **Running summarization inside `handle.onError` without detaching:** The onError callback must complete quickly so `recovery.handleCrash` can schedule restart. A 10-second LLM call blocks restart. Use `void promise.catch()`.
- **Calling `sdk.query()` without `allowDangerouslySkipPermissions: true`:** The daemon-side summarizer is a pure prompt-only LLM call with no tool use. Default SDK permissions can hang on interactive approval prompts.
- **Forgetting to call `markSummarized` after `insert`:** Leaves `conversation_sessions.status` stuck at `ended`/`crashed` forever, creating unbounded work for any future "resummarize" logic and breaking the ended→summarized invariant Phase 67 will rely on.
- **Summarizing sessions with 0 turns created by the `startSession` call but zero recordTurn calls:** The turn_count check is cheap (`session.turnCount < 3`) — do it before building the prompt, not after wasting an LLM call.
- **Emitting JSON for the LLM response:** Haiku's plain-markdown output is more reliable. Parse categories from `## User Preferences` / `## Decisions` / `## Open Threads` / `## Commitments` headers if downstream needs structured access, OR store the markdown verbatim in `content` (search-ready, human-readable).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Embedding generation | Custom vector code | `agentMemoryManager.embedder.embed(content)` → `Float32Array` | 384-dim MiniLM already warmed, works offline, free |
| Graph auto-linking | Manual similarity queries | Nothing — `memoryStore.insert()` calls `autoLinkMemory()` eagerly | Already wired in `store.ts:177` |
| Tier management | Manual hot/warm/cold logic | Nothing — default tier is `warm`, `TierManager` promotes based on access | `store.ts:712` sets `tier='warm'` on insert |
| Relevance decay scoring | Custom time-weighted ranking | Nothing — `decay.ts` runs during search automatically | `TierManager` reads `decayConfig` from `memoryConfigSchema` |
| LLM cancellation/timeout | Promise.race gymnastics | `AbortController` passed to `sdk.query({ options: { abortController } })` | SDK supports it natively per `sdk-types.ts:74` (Phase 59 added it) |
| Session ID generation for summary row | `uuid`, `crypto.randomUUID` | Nothing — `memoryStore.insert()` generates its own `nanoid()` for memory ID | `store.ts:146` |
| Prompt template string assembly | Handlebars / mustache | Plain template literals with `buildSessionSummarizationPrompt()` | Already the pattern in `consolidation.ts:199-281` |
| Token counting for prompt truncation | Custom heuristics | `countTokens(text)` from `performance/token-count.ts` (wraps `@anthropic-ai/tokenizer`) | Already installed |

**Key insight:** This phase is a thin coordinator over four existing subsystems (ConversationStore, SDK, MemoryStore, SessionManager lifecycle). Resist the urge to invent. The `consolidation.ts` file at 587 lines is the existence proof — session summarization should land in ~250 lines total (summarizer module + lifecycle wiring).

## Runtime State Inventory

> Greenfield phase — no rename/refactor/migration. Section omitted per protocol.

## Common Pitfalls

### Pitfall 1: `CreateMemoryInput` Doesn't Accept `sourceTurnIds`

**What goes wrong:** The `CreateMemoryInput` type (in `src/memory/types.ts:39-45`) has no `sourceTurnIds` field. The `insertMemory` prepared statement (`store.ts:710-713`) does NOT insert into the `source_turn_ids` column. The return value on line 194 hard-codes `sourceTurnIds: null`. A naive implementation will silently drop turn lineage.

**Why it happens:** Phase 64 added the column but only half-wired it — the schema exists, but the write path skipped it (`getById` and `listRecent` DO read it, just not `insert`). CONV-03 is partially fulfilled today.

**How to avoid:** Plan 01 of Phase 66 MUST:
1. Add `readonly sourceTurnIds?: readonly string[];` to `CreateMemoryInput`
2. Update `insertMemory` prepared statement to include `source_turn_ids` column
3. Update the `insert()` body to pass `JSON.stringify(input.sourceTurnIds ?? null)` (or `null` literal) to the prepared run
4. Update the return value to propagate `input.sourceTurnIds ?? null` instead of hard-coded `null`
5. Add a regression test to `store.test.ts` covering roundtrip.

**Warning signs:** Session summaries appear in search but `getById(summaryId).sourceTurnIds` returns `null`. `PRAGMA table_info(memories)` shows the column exists but `SELECT source_turn_ids FROM memories WHERE source='conversation'` returns all NULLs.

### Pitfall 2: Summary Runs Before Turn Count Is Known

**What goes wrong:** `conversationStore.recordTurn` is fire-and-forget in the Discord bridge (Phase 65 decision). If stopAgent races a still-pending recordTurn, the `session.turnCount` read by the summarizer may be stale (lower than actual turn count), causing a perfectly valid 3-turn session to be skipped as "< 3 turns".

**Why it happens:** `captureDiscordExchange` in the bridge uses `void convStore.recordTurn(...)` — no await, no ordering guarantee w.r.t. session lifecycle events.

**How to avoid:** Query the actual turn count with `conversationStore.getTurnsForSession(sessionId)` and use `turns.length` instead of `session.turnCount`. The turns table is a write-through record, while `turn_count` on session is eventually-consistent under fire-and-forget writes. (Both are in the same WAL-mode SQLite connection, so the lag window is tiny but non-zero.)

**Warning signs:** Tests intermittently fail with "expected summary, got skipped". Production logs show "session turnCount=2, skipping" for sessions that visibly had 3+ turns.

### Pitfall 3: Haiku Invocation Picks Up Agent Settings Sources

**What goes wrong:** If `sdk.query()` is called without explicitly setting `settingSources`, the SDK may load the calling agent's `.claude/settings.json`, pulling in MCP servers, custom system prompts, skills, etc. This bloats the prompt, adds latency, and may bias the summary. We want Haiku to see ONLY the summarization prompt.

**Why it happens:** Default `settingSources` discovery scans upwards from `cwd`. The daemon's cwd is typically the agent's workspace.

**How to avoid:** Explicitly set `settingSources: []` (empty array) in `sdk.query` options. Also set `cwd` to the daemon's workspace, not the agent's.

**Warning signs:** Summaries contain phrases the agent's system prompt would produce ("According to my identity as..."). Haiku calls take 5+ seconds instead of 1-2.

### Pitfall 4: Embedding Length Mismatch

**What goes wrong:** `memoryStore.insert()` requires `Float32Array` of exactly 384 dimensions. If `embedder.embed(summaryMarkdown)` returns a different length (shouldn't happen with MiniLM-L6-v2, but if the model is swapped, it will), the sqlite-vec write fails with a cryptic error.

**Why it happens:** `sqlite-vec` vec_memories column is created with a fixed dimensionality tied to the embedding model.

**How to avoid:** Pre-check `embedding.length === 384` before calling `insert`. Log a warning and skip summarization if not. Tests should assert on the embedding length.

**Warning signs:** `MemoryError: Failed to insert memory: vec0: unexpected dimension` — cryptic sqlite-vec error.

### Pitfall 5: Idempotency — Agent Restart Loop Resummarizing Same Session

**What goes wrong:** A crashed session transitions `active → crashed`. If the crash-path summarization fires AND the recovery restart ALSO fires and succeeds, then the next crash → another summarize attempt could target the already-summarized session, throwing "Cannot mark session as summarized: not in ended/crashed status".

**Why it happens:** `markSummarized` correctly rejects sessions that are already `summarized`. But the error propagating up a detached `void ... .catch()` is swallowed silently. More concerning: if a FIRST summarize attempt times out mid-insert (leaves memory row but never calls markSummarized), a subsequent attempt creates a DUPLICATE summary memory.

**How to avoid:** Wrap the summarizer in a try/finally that always calls `markSummarized`, AND pre-check `getSession(sid)?.status === "ended" || === "crashed"` before starting summarization. Also: a "skip if already summarized" guard (return early if `session.status === "summarized"`).

**Warning signs:** Multiple memories in the DB with tag `session:{sid}` for the same session ID. Duplicate summaries in search results.

### Pitfall 6: Prompt Exceeds Haiku Context Window

**What goes wrong:** A long agent conversation (hundreds of turns, tens of thousands of tokens) overflows Haiku's context window when assembled into the prompt. The SDK returns an error or silently truncates.

**Why it happens:** No upper bound on turn content length in ConversationStore. Raw turn content from Discord is stored verbatim.

**How to avoid:** Follow `consolidation.ts:35` — set a `MAX_PROMPT_CHARS = 30000` constant and truncate proportionally per turn if total exceeds it. Or use `countTokens()` for a more accurate cap at e.g. 100K tokens (Haiku 4.5 has 200K context, leaving headroom).

**Warning signs:** Summarization silently fails for long conversations. Haiku returns `error_max_input_tokens` subtype in result message.

## Code Examples

Verified patterns from existing source files:

### SDK one-shot query (adapted from `session-adapter.ts:348`)

```typescript
// Source: src/manager/session-adapter.ts:348 (pattern — drainInitialQuery)
const sdk = await loadSdk();
const q = sdk.query({
  prompt: summarizationPrompt,
  options: {
    model: "claude-haiku-4-5",  // from model-resolver
    systemPrompt: "You are a concise summarizer...",
    allowDangerouslySkipPermissions: true,
    abortController,
    settingSources: [],  // don't inherit agent settings
  },
});
let result = "";
for await (const msg of q) {
  if (msg.type === "result" && msg.subtype === "success" && msg.result) {
    result = msg.result;
    break;
  }
}
```

### MemoryStore insert with embedding (adapted from `consolidation.ts:320`)

```typescript
// Source: src/memory/consolidation.ts:320
const embedding = await deps.embedder.embed(llmContent);
deps.memoryStore.insert(
  {
    content: llmContent,
    source: "conversation",           // NEW — session summaries use "conversation"
    importance: 0.78,                 // per CONTEXT.md: 0.75-0.8 range
    tags: ["session-summary", `session:${sessionId}`],
    sourceTurnIds: turns.map(t => t.id),  // NEW — requires CreateMemoryInput extension
  },
  embedding,
);
```

### State machine transition (from `conversation-store.ts:186-207`)

```typescript
// Source: src/memory/conversation-store.ts:190
// After insert, link the summary back to the session
const memoryEntry = memoryStore.insert(input, embedding);
conversationStore.markSummarized(sessionId, memoryEntry.id);
// Throws if session not in 'ended' or 'crashed' status — guard upstream.
```

### Lifecycle hook (adapted from `session-manager.ts:274-292`)

```typescript
// Source: src/manager/session-manager.ts:274 (Phase 65 pattern)
handle.onError((error: Error) => {
  const convSessionId = this.activeConversationSessionIds.get(name);
  const convStoreForCrash = this.memory.conversationStores.get(name);
  if (convStoreForCrash && convSessionId) {
    try { convStoreForCrash.crashSession(convSessionId); } catch { /* best-effort */ }
    // Phase 66 insertion point (fire-and-forget)
    void this.summarizeSession(name, convSessionId).catch((err) => {
      this.log.warn({ agent: name, session: convSessionId, error: (err as Error).message }, "crash summarization failed");
    });
  }
  this.activeConversationSessionIds.delete(name);
  this.recovery.handleCrash(name, config, error, this.sessions);
  // ... existing onEnd callback logic
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Route summarization through `manager.sendToAgent` (used by consolidation) | Direct `sdk.query()` for one-shot daemon-side LLM call | Phase 66 introduces this pattern | Isolates summarization model from agent model, doesn't pollute agent context, explicit Haiku selection |
| Sync `onError` handlers running heavy work | Fire-and-forget `void promise.catch()` pattern | Already established in Phase 65 for `endCallback` | Crash recovery stays fast, non-critical work doesn't block restart |
| `CreateMemoryInput` without lineage | Extended with `sourceTurnIds` field | Phase 66 (this plan) | Fulfills CONV-03 lineage, enables future FACT-01/02 phases |
| Promise.race for cancellation | Native `AbortController` via SDK option | Phase 59 added this to the SDK | Proper cancellation of underlying HTTP request, no hanging processes |

**Deprecated/outdated:**
- Using `heartbeat/checks/consolidation.ts` as an execution path — per Phase 46 it's a no-op; consolidation migrated to `TaskScheduler`. Do NOT model Phase 66 after the heartbeat check module.

## Open Questions

1. **Should summary prompts cache the agent's identity/soul context for better personalization?**
   - What we know: Haiku is invoked with empty `settingSources` per Pitfall 3. The conversation turns themselves don't include the agent's identity — just user messages and assistant responses.
   - What's unclear: Would pre-pending `agent.identity` / `agent.soul` to the prompt produce better summaries (e.g., "Clawdy decided X" vs "the assistant decided X")?
   - Recommendation: Defer. Start with a pure turn-only prompt. Add identity context in a follow-up plan if summaries feel generic in real usage. An open decision the executor can revisit.

2. **Does `importance=0.78` land summaries in the hot tier automatically, or do we need to force promote?**
   - What we know: `TierManager` promotes based on `hotAccessThreshold` (default 3 accesses in 7 days) AND relevance score. Fresh summaries have `accessCount=0`. Default tier on insert is `warm`.
   - What's unclear: Will Phase 67's resume auto-injection generate enough access counts to naturally promote session summaries, or will they languish in warm?
   - Recommendation: Start with default `warm` tier. If Phase 67 injection pulls top-N by relevance (not by tier), it won't matter. If Phase 68's `memory_lookup` needs hot-tier bias, revisit then.

3. **How does the fallback "raw-turn extraction" work when Haiku times out?**
   - What we know: CONTEXT.md says "summary is generated within 10 seconds or falls back to raw-turn extraction" and "summarization failure is non-fatal."
   - What's unclear: What does "raw-turn extraction" literally produce? Options: (a) concatenate all turn contents verbatim with role markers, (b) take first sentence of each turn, (c) skip summary entirely and write a placeholder marker.
   - Recommendation: Go with (a) — a deterministic structured dump: `## Raw Turns\n\n### User (t0)\n{content}\n\n### Assistant (t1)\n{content}\n...` — preserves signal for Phase 67/68 even without LLM processing, still embeds and becomes searchable. Add a tag `["session-summary", "session:{id}", "raw-fallback"]` so operators can identify fallback-generated summaries in the DB.

4. **Should the summarizer deduplicate turns flagged as `instruction_flags` (potentially-directive)?**
   - What we know: Phase 65 flags turns matching prompt-injection patterns. The flag is in the `conversation_turns.instruction_flags` column.
   - What's unclear: Should flagged turns be redacted from the summarization prompt to prevent summary poisoning? Or included with a warning label?
   - Recommendation: Include with a visible `[FLAGGED as potentially-directive]` label in the prompt so Haiku can ignore them explicitly. Don't redact silently — too much info loss. Defer to plan executor.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| @anthropic-ai/claude-agent-sdk | Haiku SDK call | ✓ | ^0.2.97 (in package.json) | — (required) |
| Claude Haiku API key (ANTHROPIC_API_KEY) | SDK query() | Env-dependent | — | Fallback: raw-turn extraction |
| better-sqlite3 + sqlite-vec | MemoryStore.insert | ✓ | 12.8.0 / 0.1.9 | — |
| @huggingface/transformers (MiniLM-L6-v2) | embed(summary) | ✓ (downloads on first warmup) | ^4.0.1 | — |
| Node.js 22 LTS | Runtime | Env-dependent | — | — |

**Missing dependencies with no fallback:** None — all required libraries are already installed per v1.9 zero-new-deps commitment.

**Missing dependencies with fallback:**
- If `ANTHROPIC_API_KEY` is missing or network is unreachable: summarizer falls back to raw-turn extraction (deterministic, no LLM needed). This is aligned with CONTEXT.md "summarization failure is non-fatal" and the 10s timeout producing a fallback.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest ^4.1.3 |
| Config file | `vitest.config.ts` at repo root |
| Quick run command | `npx vitest run src/memory/__tests__/session-summarizer.test.ts --reporter=verbose` |
| Full suite command | `npm test` (→ `vitest run --reporter=verbose`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SESS-01 | Haiku call produces structured summary within 10s | unit | `npx vitest run src/memory/__tests__/session-summarizer.test.ts -t "produces structured summary" -x` | ❌ Wave 0 |
| SESS-01 | 10s timeout triggers raw-turn fallback | unit | `npx vitest run src/memory/__tests__/session-summarizer.test.ts -t "falls back on timeout" -x` | ❌ Wave 0 |
| SESS-01 | Haiku error triggers raw-turn fallback (non-fatal) | unit | `npx vitest run src/memory/__tests__/session-summarizer.test.ts -t "falls back on LLM error" -x` | ❌ Wave 0 |
| SESS-01 | Sessions with < 3 turns produce no summary | unit | `npx vitest run src/memory/__tests__/session-summarizer.test.ts -t "skips short sessions" -x` | ❌ Wave 0 |
| SESS-04 | Summary written as MemoryEntry with source="conversation", correct tags | unit | `npx vitest run src/memory/__tests__/session-summarizer.test.ts -t "writes MemoryEntry" -x` | ❌ Wave 0 |
| SESS-04 | Summary is retrievable via tag search | integration | `npx vitest run src/memory/__tests__/session-summarizer.test.ts -t "tag-based retrieval" -x` | ❌ Wave 0 |
| SESS-04 | Summary receives warm tier by default + auto-links fire | integration | `npx vitest run src/memory/__tests__/session-summarizer.test.ts -t "auto-links on insert" -x` | ❌ Wave 0 |
| SESS-04 | markSummarized updates session.summary_memory_id FK | unit | `npx vitest run src/memory/__tests__/session-summarizer.test.ts -t "links summary to session" -x` | ❌ Wave 0 |
| lifecycle | SessionManager.stopAgent triggers summarization before cleanupMemory | integration | `npx vitest run src/manager/__tests__/session-manager.test.ts -t "summarizes on stop" -x` | ❌ Wave 0 |
| lifecycle | SessionManager.onError triggers fire-and-forget summarization | integration | `npx vitest run src/manager/__tests__/session-manager.test.ts -t "summarizes on crash" -x` | ❌ Wave 0 |
| resilience | Already-summarized session does not double-summarize | unit | `npx vitest run src/memory/__tests__/session-summarizer.test.ts -t "idempotent on already-summarized" -x` | ❌ Wave 0 |
| resilience | CreateMemoryInput roundtrip preserves sourceTurnIds | unit | `npx vitest run src/memory/__tests__/store.test.ts -t "roundtrips sourceTurnIds" -x` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run src/memory/__tests__/session-summarizer.test.ts src/memory/__tests__/store.test.ts src/memory/__tests__/conversation-store.test.ts --reporter=verbose`
- **Per wave merge:** `npx vitest run src/memory/ src/manager/ --reporter=verbose`
- **Phase gate:** `npm test` — full suite green before `/gsd:verify-work`

### Critical Test Scenarios

**Happy Path (SESS-01 + SESS-04):**
- Given: a `ConversationSession` with 5 turns (mix of user + assistant), status=`ended`
- When: `summarizeSession(agentName, sessionId)` is invoked with a mock `summarize` fn returning structured markdown
- Then: (a) exactly one memory row created with `source="conversation"`, `tags=["session-summary", "session:{id}"]`, `sourceTurnIds=[turn1.id, turn2.id, ...]`; (b) `conversation_sessions.status="summarized"`; (c) `conversation_sessions.summary_memory_id` points to the memory ID; (d) summary is returned by `memoryStore.searchByTags(["session-summary"])`; (e) auto-link fired (verify via `memory_links` table row count delta).

**Crash Recovery Path (SESS-01):**
- Given: a live agent session with 4 turns; `handle.onError` fires
- When: the onError handler runs through Phase 65 crash logic + Phase 66 summarization hook
- Then: (a) `conversation_sessions.status="crashed"` BEFORE summarization starts; (b) summarization fires but does NOT block `recovery.handleCrash`; (c) after summarization completes, status transitions to `summarized`; (d) if summarization times out, session stays `crashed` (acceptable — Phase 67 auto-inject can still use `listRecentSessions` and filter on `status IN ('summarized', 'crashed')` if needed).

**Short Session Skip (SESS-01):**
- Given: a session with 2 turns (below threshold)
- When: `summarizeSession()` is invoked
- Then: (a) NO `sdk.query` call is made (assert mock.calls.length === 0); (b) NO memory row is created; (c) session status remains at `ended`/`crashed` (NOT transitioned to `summarized`); (d) returns early with a structured skip reason (e.g., `{ skipped: true, reason: "insufficient-turns", turnCount: 2 }`) for observability.

**Haiku Timeout → Fallback (SESS-01):**
- Given: a session with 5 turns; mock `summarize` that hangs forever (returns `new Promise(() => {})`)
- When: `summarizeSession()` is invoked with a 100ms test-tuned timeout override
- Then: (a) AbortController fires after 100ms; (b) fallback produces a deterministic "## Raw Turns\n\n### user\n..." string; (c) memory row IS created with the fallback content, tagged `["session-summary", "session:{id}", "raw-fallback"]`; (d) `conversation_sessions.status="summarized"` — we DID produce a summary, just not an LLM one.

**MemoryEntry Tier Participation (SESS-04):**
- Given: a completed summarization writing a memory row
- When: `memoryStore.getById(summaryId)` is called
- Then: (a) `entry.tier === "warm"` (default); (b) `entry.source === "conversation"`; (c) `entry.importance === 0.78` (or configured value); (d) `entry.embedding` is a 384-dim Float32Array; (e) `entry.sourceTurnIds` is a frozen array of the turn IDs.

**Tag-Based Retrieval (SESS-04):**
- Given: 3 sessions each with their own summary memory
- When: a search over tags `["session-summary"]` runs
- Then: all 3 summaries appear in the results, ordered by decay-weighted relevance (existing behavior — we're just validating nothing special-cases out of it).

**Auto-Links Fire (SESS-04):**
- Given: an existing memory tagged `[topic]` semantically similar to the new summary
- When: summarization inserts the new memory
- Then: `memory_links` table contains a bidirectional `auto:similar` edge between the summary and the topic memory (verify by counting rows before/after insert).

**Idempotency Guard:**
- Given: a session already in status=`summarized`
- When: `summarizeSession()` is invoked again (e.g., recovery loop fires twice)
- Then: (a) early return, no LLM call; (b) no duplicate memory rows; (c) no thrown error (log-only warning).

**Prompt Overflow (defensive):**
- Given: a session with 50 turns, total content 100KB
- When: `summarizeSession()` builds the prompt
- Then: (a) prompt is truncated to MAX_PROMPT_CHARS via the same proportional-truncation pattern as `consolidation.ts:199-244`; (b) a note `[...truncated due to length]` is appended per turn; (c) summarization succeeds.

### Mock / Stub Strategy for Haiku LLM Call

The summarize dependency is injected per `consolidation.ts` pattern. Tests never invoke the real SDK.

**Mock signature:**
```typescript
type SummarizeFn = (prompt: string, opts: { signal?: AbortSignal }) => Promise<string>;
```

**Per-test stubs:**
```typescript
// Happy path
const mockSummarize: SummarizeFn = vi.fn().mockResolvedValue(
  "## User Preferences\n- Prefers terse responses\n\n## Decisions\n- Decided to use SQLite\n\n## Open Threads\n- Phase 67 auto-injection\n\n## Commitments\n- Will complete by Friday"
);

// Timeout simulation
const mockTimeout: SummarizeFn = (prompt, opts) => new Promise((_, reject) => {
  opts.signal?.addEventListener("abort", () => reject(new Error("AbortError")));
  // never resolves
});

// Error simulation
const mockError: SummarizeFn = vi.fn().mockRejectedValue(new Error("Anthropic API 500"));

// Slow but successful (for measuring that timeout tolerance works)
const mockSlow: SummarizeFn = () => new Promise(resolve =>
  setTimeout(() => resolve("## ...summary..."), 50)
);
```

**Embedder mock (already established pattern from `consolidation.test.ts:29`):**
```typescript
function createMockEmbedder(): EmbeddingService {
  return {
    embed: vi.fn().mockResolvedValue(new Float32Array(384).fill(0.1)),
    warmup: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockReturnValue(true),
  } as unknown as EmbeddingService;
}
```

**Real MemoryStore + ConversationStore (in-memory SQLite):**
Use real stores over `:memory:` DB — they're fast, zero-fixture, and exercise the actual SQL schema. Pattern from `conversation-store.test.ts` (37 passing tests at present):
```typescript
beforeEach(() => {
  memStore = new MemoryStore(":memory:", { enabled: false, similarityThreshold: 0.85 });
  convStore = new ConversationStore(memStore.getDatabase());
});
afterEach(() => memStore?.close());
```

**Fake timers for timeout tests:**
```typescript
vi.useFakeTimers();
const promise = summarizeSession(...);
vi.advanceTimersByTime(10_001);  // trigger AbortController
await expect(promise).resolves.toMatchObject({ fallback: true });
vi.useRealTimers();
```

### Wave 0 Gaps

- [ ] `src/memory/__tests__/session-summarizer.test.ts` — covers SESS-01, SESS-04, short-session skip, timeout fallback, LLM-error fallback, idempotency
- [ ] `src/manager/__tests__/session-manager.test.ts` — extend existing test file with lifecycle tests for summarize-on-stop, summarize-on-crash (check mocks for MemoryStore.insert call); MAY already exist — verify, add cases, don't duplicate
- [ ] `src/memory/__tests__/store.test.ts` — extend with `sourceTurnIds` roundtrip test (verify insert → getById preserves the array); new test after CreateMemoryInput extension
- [ ] No new framework install — vitest ^4.1.3 already configured. No fixtures needed beyond existing ConversationStore helpers.

## Project Constraints (from CLAUDE.md)

- **Identity injection:** Session starts with reading `clawcode.yaml` for `test-agent` — not relevant to Phase 66 (infrastructure, not agent-facing).
- **GSD workflow enforcement:** All file changes must go through a GSD workflow. Phase 66's plans will execute under `/gsd:execute-phase` — this research is the upstream of that.
- **No direct edits outside GSD workflow:** Plans must be created, reviewed, and executed through the pipeline.
- **Coding style (~/.claude/rules/coding-style.md):**
  - Immutability: use `Object.freeze()`, never mutate (matches existing ConversationStore pattern)
  - Small files: 200-400 lines typical, 800 max — session-summarizer.ts should land well under this
  - Error handling: handle errors comprehensively; never silently swallow (EXCEPT where CONTEXT explicitly marks failures as non-fatal, use log-warn instead)
  - Input validation: validate at system boundaries (sessionId exists, turn count > 0)
- **Security (~/.claude/rules/security.md):**
  - No hardcoded secrets (ANTHROPIC_API_KEY must come from env)
  - Validate inputs (sessionId format, turn content not null/undefined)
  - Error messages must not leak turn contents in logs
- **Git workflow:** Feat-prefixed commits per atomic task (`feat(66-01)`, `feat(66-02)`), ending with the standard `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer per `.claude/settings.json` global config.
- **File organization:** Per-domain (put summarizer in `src/memory/`, lifecycle wiring in `src/manager/`), many small files over few large files.

## Sources

### Primary (HIGH confidence)
- `src/memory/consolidation.ts` (587 lines) — existing LLM-based summarization pipeline; direct pattern to mirror (injected summarize dep, prompt builder, dual-write memory+markdown, idempotency guards)
- `src/manager/session-manager.ts` (lines 200-294, 447-493) — existing Phase 65 ConversationStore lifecycle wiring; insertion points for summarization calls identified
- `src/memory/conversation-store.ts` (407 lines) — full API available: `startSession`, `endSession`, `crashSession`, `markSummarized`, `getSession`, `listRecentSessions`, `recordTurn`, `getTurnsForSession`; state machine already enforced
- `src/memory/store.ts:97-202` — `MemoryStore.insert()` with embedding, eager `autoLinkMemory` call, warm-tier default; confirmed `sourceTurnIds` write path gap (line 194 hard-codes null)
- `src/memory/types.ts` — `CreateMemoryInput` definition (lines 39-45) needs extension for `sourceTurnIds`
- `src/manager/sdk-types.ts` — SDK query/options type shape, including `abortController` option (line 74) added in Phase 59
- `src/manager/session-adapter.ts:437-450` — existing `loadSdk()` dynamic import pattern
- `src/manager/model-resolver.ts:11-15` — Haiku resolves to `claude-haiku-4-5`
- `src/memory/schema.ts:25` — `summaryModel: z.enum(["sonnet", "opus", "haiku"])` already exists on `consolidationConfigSchema` as precedent for model choice in config
- `src/memory/__tests__/consolidation.test.ts:37-49` — exact mock pattern for injected `summarize`
- `src/memory/__tests__/conversation-store.test.ts` (37 tests) — test harness pattern using `:memory:` SQLite + `createMemoryEntry()` helper for FK-constrained tests
- `package.json` — version-lock confirmation for all deps

### Secondary (MEDIUM confidence)
- `src/manager/daemon.ts:585-624` — existing consolidation scheduler wiring shows exactly how `manager.sendToAgent` gets closured into a `summarize` dep; useful counter-example for why session summarization should NOT use the same pattern
- Claude Agent SDK 0.2.97 source (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`) — referenced from `sdk-types.ts` comments

### Tertiary (LOW confidence)
- None — this research relies entirely on verified in-repo source code and already-landed Phase 64/65 artifacts.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified in `package.json`, no new dependencies needed
- Architecture: HIGH — direct pattern exists in `consolidation.ts`; lifecycle hooks verified in `session-manager.ts`
- Pitfalls: HIGH — pitfalls 1 (sourceTurnIds insert path gap), 2 (fire-and-forget recordTurn), and 5 (idempotency) are verified by reading the actual code; pitfall 3 (settingSources) is HIGH confidence from SDK docs; pitfall 6 (prompt overflow) is directly analogous to `consolidation.ts:35`
- Validation: HIGH — test patterns borrowed from `consolidation.test.ts` and `conversation-store.test.ts`, both of which are currently green

**Research date:** 2026-04-18
**Valid until:** 2026-05-18 (30 days — stable domain, no fast-moving externals)

## RESEARCH COMPLETE

**Phase:** 66 - Session-Boundary Summarization
**Confidence:** HIGH

### Key Findings
- **Pattern ready:** `consolidation.ts` is a direct architectural template (injected `summarize` fn, prompt builder, dual-write memory+DB, idempotency). Phase 66 summarizer lands in ~250 lines total.
- **Lifecycle hooks exist:** Phase 65 already wired `ConversationStore.startSession`/`endSession`/`crashSession` into `SessionManager.startAgent`/`stopAgent`/`handle.onError`. Phase 66 only needs to insert a summarize call at the crash/stop points (one fire-and-forget, one awaited).
- **SDK one-shot is the right invocation path:** Use `sdk.query()` with explicit `model: "claude-haiku-4-5"`, `allowDangerouslySkipPermissions: true`, `settingSources: []`, and `abortController` — NOT the existing `manager.sendToAgent` pattern (that's for consolidation which has a running agent; session-end does not).
- **MemoryStore write path gap:** `CreateMemoryInput` does not accept `sourceTurnIds`; `MemoryStore.insert()` hard-codes `source_turn_ids: null` at line 194. Phase 66 must extend the input type and the `insertMemory` prepared statement to actually persist lineage. This is a CONV-03 completion — Phase 64 only delivered the column, not the write path.
- **Zero new dependencies:** Entire phase uses existing stack (@anthropic-ai/claude-agent-sdk 0.2.97, better-sqlite3, sqlite-vec, @huggingface/transformers, zod 4, nanoid).

### Risks the Planner Should Know
1. **CONV-03 completion creep:** Extending `CreateMemoryInput` touches `src/memory/types.ts`, `src/memory/store.ts` (prepared statement), and any place that constructs inputs — not scope creep, but a non-trivial sub-task. Plan 01 should cover this so Plan 02 can consume the extended API.
2. **Turn count race:** Fire-and-forget `recordTurn` in Phase 65 means `session.turnCount` may lag the actual turn count at stopAgent time. Summarizer must use `getTurnsForSession(sid).length` not `session.turnCount` for the `< 3 turns` check.
3. **Crash path must detach:** `handle.onError` is synchronous; blocking it on a 10-second LLM call breaks restart scheduling. Use `void promise.catch()` for the crash path, but `await` is safe (and desirable for latency bounds) in the `stopAgent` path.
4. **Idempotency:** No current mechanism prevents a second summarization attempt. Guard with `if (session.status === "summarized") return` at the top of the summarizer, AND test this with a mock double-invocation.
5. **Haiku quality unknown:** STATE.md explicitly notes "Haiku empirical viability unknown for session-boundary summarization quality — validate with real conversation samples in Phase 66." Plan should include a manual validation step (e.g., feed a real captured session through the pipeline, eyeball the summary).
6. **Fallback design is underspecified:** CONTEXT.md says "falls back to raw-turn extraction" but doesn't define format. Recommendation: deterministic markdown concatenation with a `raw-fallback` tag. This is an open question Plan 01 or Plan 02 needs to nail down.
