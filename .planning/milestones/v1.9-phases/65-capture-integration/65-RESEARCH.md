# Phase 65: Capture Integration - Research

**Researched:** 2026-04-17
**Domain:** Discord message capture into ConversationStore + instruction-pattern detection (SEC-02)
**Confidence:** HIGH

## Summary

Phase 65 wires the ConversationStore (built in Phase 64) into the live Discord message path so every user/assistant exchange is automatically persisted. The integration touches four files: SessionManager needs a `getConversationStore()` accessor (1 line), BridgeConfig gains an optional ConversationStore accessor type, DiscordBridge.streamAndPostResponse gets a fire-and-forget capture block (~15 lines), and a new `instruction-detector.ts` module provides regex-based pattern matching for SEC-02. The daemon wires it all at bridge construction time.

The capture is intentionally non-blocking: `try/catch` with `log.warn` on failure, inserted AFTER `turn?.end("success")` on line 625 of bridge.ts. The instruction-pattern detector runs synchronously on user message content before the `recordTurn` call, setting a flag on the persisted turn. No schema migration is needed -- the `is_flagged` column is added via an idempotent ALTER TABLE migration in MemoryStore, and the `RecordTurnInput` type extends with an optional `instructionFlags` field.

**Primary recommendation:** Keep the capture block trivially small in bridge.ts (delegate to a helper), keep the instruction detector as a pure function with zero dependencies, and add the `getConversationStore` accessor to SessionManager following the exact pattern of `getDocumentStore`/`getEpisodeStore`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SEC-02 | Instruction-pattern detection runs on turn content before storage to flag potential injection attempts in persisted conversation data | Instruction detector module (pure regex), flag field on RecordTurnInput, detection runs before recordTurn call |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | 12.8.0 | Turn persistence | Already in use by ConversationStore (Phase 64). Synchronous writes are ideal for fire-and-forget capture. |
| vitest | (existing) | Testing | Project standard test framework. |

### Supporting
No new dependencies required. This phase uses only existing project infrastructure.

## Architecture Patterns

### Capture Point Location

The capture point is `DiscordBridge.streamAndPostResponse()`, lines 624-625 of `src/discord/bridge.ts`. The insertion happens AFTER `turn?.end("success")` (line 625) and BEFORE the catch block (line 626). This ensures:

1. The Discord response has already been posted to the channel
2. The performance trace has already been recorded
3. Failure in capture cannot affect the Discord message delivery
4. Both user message content (`formattedMessage`) and agent response (`response`) are in scope

```
// Current code (lines 624-625):
try { turn?.end("success"); } catch { /* non-fatal */ }

// CAPTURE POINT: insert here
// try {
//   recordDiscordExchange(sessionName, formattedMessage, response, message, this.sessionManager, this.log);
// } catch { /* logged, never thrown */ }
```

### Data Available at Capture Point

Within `streamAndPostResponse()`, these variables are in scope:

| Variable | Type | Value |
|----------|------|-------|
| `message` | `Message` | Discord.js message object -- has `.channelId`, `.author.id`, `.id` |
| `sessionName` | `string` | Agent name (used as ConversationStore lookup key) |
| `formattedMessage` | `string` | The formatted user message (includes XML tags from `formatDiscordMessage`) |
| `response` | `string` | The agent's response text |
| `channelId` | `string` | Discord channel ID (already destructured) |
| `this.sessionManager` | `SessionManager` | Access to `getConversationStore(name)` (new accessor) |
| `this.log` | `Logger` | Pino logger for capture failures |

### Session Lifecycle Wiring

ConversationStore sessions need to be started/ended alongside agent sessions. Two options:

**Option A (Recommended): Lazy session creation at first capture**
- When `recordDiscordExchange` is called and no active session exists for this agent, call `convStore.startSession(agentName)` and cache the session ID
- On agent stop/crash, end the session
- Pro: Zero changes to SessionManager.startAgent/stopAgent
- Con: Need to track active session IDs somewhere

**Option B: Eager session creation at agent start**
- Call `convStore.startSession(agentName)` in `SessionManager.startAgent()`
- Call `convStore.endSession(sessionId)` in `SessionManager.stopAgent()`
- Call `convStore.crashSession(sessionId)` in the crash handler
- Pro: Clean lifecycle alignment
- Con: Requires threading sessionId through SessionManager, touching the start/stop flow

**Recommendation: Option B.** The ConversationStore session lifecycle maps 1:1 onto agent sessions. The session ID needs to be accessible from the bridge for `recordTurn`, so SessionManager should track it. The changes to startAgent/stopAgent are small (~5 lines each) and follow the existing pattern of memory initialization.

### Accessor Pattern

SessionManager already exposes per-agent stores via one-liner accessors:

```typescript
// Existing pattern (session-manager.ts, lines 572-577):
getEpisodeStore(agentName: string) { return this.memory.episodeStores.get(agentName); }
getDocumentStore(agentName: string): DocumentStore | undefined { return this.memory.documentStores.get(agentName); }
getTraceCollector(agentName: string): TraceCollector | undefined { return this.memory.traceCollectors.get(agentName); }

// New accessor (same pattern):
getConversationStore(agentName: string): ConversationStore | undefined { return this.memory.conversationStores.get(agentName); }
```

### Instruction-Pattern Detector Design

SEC-02 requires instruction-pattern detection on turn content before storage. This is a pure function -- no state, no side effects, no dependencies beyond string matching.

**What it detects:**
- System/instruction prompt injection markers (`<system>`, `[SYSTEM]`, `<<INSTRUCTIONS>>`, etc.)
- Role impersonation (`You are now`, `Ignore previous instructions`, `Act as if`)
- Explicit jailbreak patterns (`IGNORE ALL ABOVE`, `disregard your training`)
- Encoded instructions (base64 blocks that decode to injection patterns)

**What it does NOT do:**
- Block the message (detection only, never blocks storage)
- Use LLM for detection (too slow for a synchronous capture path)
- Generate false positives on normal conversation (patterns must be specific)

**Interface:**
```typescript
export type InstructionDetectionResult = {
  readonly detected: boolean;
  readonly patterns: readonly string[];  // names of matched patterns
  readonly riskLevel: "none" | "low" | "medium" | "high";
};

export function detectInstructionPatterns(content: string): InstructionDetectionResult;
```

**Pattern Categories (with risk levels):**

| Category | Pattern Examples | Risk |
|----------|-----------------|------|
| System tag injection | `<system>`, `<<SYS>>`, `[INST]` | high |
| Role override | `Ignore previous instructions`, `You are now a` | high |
| Prompt leak attempt | `Repeat your system prompt`, `What are your instructions` | medium |
| Encoded payload | Base64 blocks > 100 chars | low |
| Delimiter abuse | `---\nNew conversation\n---` | medium |

### Schema Extension for Flags

The `conversation_turns` table needs an `instruction_flags` column to persist detection results. This is a nullable TEXT column (JSON) added via idempotent migration:

```sql
-- In MemoryStore migration (idempotent, same pattern as migrateSourceTurnIds):
ALTER TABLE conversation_turns ADD COLUMN instruction_flags TEXT;
```

The `RecordTurnInput` type extends with:
```typescript
readonly instructionFlags?: string;  // JSON string of InstructionDetectionResult
```

And `ConversationTurn` extends with:
```typescript
readonly instructionFlags: string | null;
```

### Recommended Project Structure

```
src/
  security/
    instruction-detector.ts       # NEW: pure detection function + patterns
    instruction-detector.test.ts  # NEW: pattern matching tests
  memory/
    conversation-store.ts         # MODIFIED: add instructionFlags to statements
    conversation-types.ts         # MODIFIED: add instructionFlags field
  discord/
    bridge.ts                     # MODIFIED: capture block in streamAndPostResponse
    capture.ts                    # NEW: recordDiscordExchange helper (testable)
    __tests__/
      capture.test.ts             # NEW: capture integration tests
  manager/
    session-manager.ts            # MODIFIED: getConversationStore + session lifecycle
    session-memory.ts             # NO CHANGE (already creates ConversationStore)
  memory/
    store.ts                      # MODIFIED: add migrateInstructionFlags column
```

### Anti-Patterns to Avoid

- **Capturing inside TurnDispatcher:** TurnDispatcher handles ALL turn sources (Discord, scheduler, handoffs). Only Discord turns are user conversations. Capture in DiscordBridge only.
- **Synchronous embedding on capture:** Phase 65 does NOT embed turns. Per-turn embedding is explicitly out of scope (REQUIREMENTS.md). Session summaries get embedded in Phase 66.
- **Blocking on detection:** Instruction detection must be synchronous and fast (< 1ms). No LLM calls, no async operations.
- **Mutating RecordTurnInput:** All types are readonly per project convention. Create new objects, never mutate.
- **Skipping the try/catch:** Every line in the capture block must be wrapped. A crash here would break Discord message delivery for ALL subsequent messages in the event loop tick.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Session ID tracking | Custom Map in DiscordBridge | ConversationStore.startSession + SessionManager lifecycle | Session lifecycle already exists; just wire it |
| Content sanitization | Custom HTML/XML strippers | Store raw content as-is | Sanitization loses data; the flag is sufficient |
| Async capture queue | Custom job queue for capture writes | Synchronous better-sqlite3 write | better-sqlite3 is synchronous by design; a queue adds complexity with no benefit for a single INSERT |

## Common Pitfalls

### Pitfall 1: Bridge Constructor Signature Bloat
**What goes wrong:** Adding ConversationStore directly to BridgeConfig creates a tight coupling.
**Why it happens:** Temptation to pass the store directly instead of going through SessionManager.
**How to avoid:** Use the existing `this.sessionManager.getConversationStore(sessionName)` accessor pattern. The bridge already calls `this.sessionManager.getTraceCollector()` and `this.sessionManager.getAgentConfig()` the same way. No new constructor parameter needed.
**Warning signs:** Adding `conversationStore` to BridgeConfig type.

### Pitfall 2: Missing Session on Capture
**What goes wrong:** `getConversationStore(agentName)` returns undefined because memory was cleaned up or agent is stopping.
**Why it happens:** Race between agent stop and a final capture call.
**How to avoid:** Null-check the store AND the active session ID. If either is missing, log.warn and return silently. The capture is fire-and-forget.
**Warning signs:** Uncaught errors from `recordTurn` propagating up.

### Pitfall 3: Active Session ID Not Available
**What goes wrong:** The capture code needs a `sessionId` to call `recordTurn`, but ConversationStore sessions are not wired to agent sessions yet.
**Why it happens:** Phase 64 built ConversationStore but did not wire lifecycle.
**How to avoid:** Wire session start/end in SessionManager.startAgent/stopAgent. Store the conversation session ID on a Map in SessionManager (or AgentMemoryManager). Expose via `getActiveConversationSessionId(agentName)`.
**Warning signs:** Attempting to start a ConversationStore session at capture time (lazy init) creates a session per turn if not tracked.

### Pitfall 4: Instruction Detection False Positives
**What goes wrong:** Normal messages like "Can you ignore the previous suggestion?" get flagged as injection.
**Why it happens:** Overly broad regex patterns.
**How to avoid:** Require multi-word phrase matches, not single-word. Test against a corpus of normal Discord messages. Keep risk levels -- "low" is informational, only "high" is actionable.
**Warning signs:** High flag rate on normal conversation.

### Pitfall 5: Forgetting the Error Path
**What goes wrong:** Capture only runs on success (after `turn?.end("success")`), not on error.
**Why it happens:** The error catch block (line 626-645) does not have the `response` variable.
**How to avoid:** Only capture on success. On error, there is no agent response to record. The user message was already sent to Discord before the error. If partial capture is desired, it can be added later. For now, capture = success path only.
**Warning signs:** Trying to capture in both success and error paths without the response text.

### Pitfall 6: Thread Messages Not Captured
**What goes wrong:** Messages routed through threads (`threadManager.routeMessage`) call `streamAndPostResponse` with a different session name.
**Why it happens:** Thread sessions have names like `agent-a:thread-123`.
**How to avoid:** The capture block is inside `streamAndPostResponse`, which is the common path for BOTH channel and thread messages. The `sessionName` parameter already resolves correctly for both. Verify that `getConversationStore(sessionName)` works for thread session names too (thread sessions share the parent agent's memory).
**Warning signs:** Thread messages silently failing to capture because the thread session name doesn't map to a ConversationStore.

## Code Examples

### Example 1: SessionManager Accessor (1 line)

```typescript
// src/manager/session-manager.ts -- add after getDocumentStore (line 573)
// Source: existing pattern from getDocumentStore/getEpisodeStore/getTraceCollector
getConversationStore(agentName: string): ConversationStore | undefined {
  return this.memory.conversationStores.get(agentName);
}
```

### Example 2: Fire-and-Forget Capture in streamAndPostResponse

```typescript
// src/discord/bridge.ts -- after line 625 (turn?.end("success"))
// Source: architecture research ARCHITECTURE.md capture point
try {
  const convStore = this.sessionManager.getConversationStore(sessionName);
  const activeSessionId = this.sessionManager.getActiveConversationSessionId(sessionName);
  if (convStore && activeSessionId) {
    captureDiscordExchange({
      convStore,
      sessionId: activeSessionId,
      userContent: formattedMessage,
      assistantContent: response,
      channelId,
      discordUserId: message.author.id,
      discordMessageId: message.id,
      log: this.log,
    });
  }
} catch (err) {
  this.log.warn(
    { agent: sessionName, error: (err as Error).message },
    "conversation capture failed (non-fatal)",
  );
}
```

### Example 3: Instruction Detection Pure Function

```typescript
// src/security/instruction-detector.ts
const HIGH_RISK_PATTERNS: readonly RegExp[] = [
  /<\s*system\s*>/i,
  /<<\s*SYS\s*>>/i,
  /\[INST\]/i,
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /you\s+are\s+now\s+(a|an)\s+/i,
  /disregard\s+(your|all)\s+(previous\s+)?(training|instructions)/i,
];

const MEDIUM_RISK_PATTERNS: readonly RegExp[] = [
  /repeat\s+your\s+(system\s+)?prompt/i,
  /what\s+are\s+your\s+instructions/i,
  /---\s*\n\s*new\s+conversation\s*\n\s*---/i,
  /\[\s*SYSTEM\s*\]/i,
];

export function detectInstructionPatterns(content: string): InstructionDetectionResult {
  const matched: string[] = [];
  let riskLevel: "none" | "low" | "medium" | "high" = "none";

  for (const pattern of HIGH_RISK_PATTERNS) {
    if (pattern.test(content)) {
      matched.push(pattern.source);
      riskLevel = "high";
    }
  }
  for (const pattern of MEDIUM_RISK_PATTERNS) {
    if (pattern.test(content)) {
      matched.push(pattern.source);
      if (riskLevel === "none") riskLevel = "medium";
    }
  }

  return Object.freeze({
    detected: matched.length > 0,
    patterns: Object.freeze(matched),
    riskLevel,
  });
}
```

### Example 4: Capture Helper (Testable, Extracted from Bridge)

```typescript
// src/discord/capture.ts
import type { ConversationStore } from "../memory/conversation-store.js";
import type { Logger } from "pino";
import { detectInstructionPatterns } from "../security/instruction-detector.js";

export type CaptureInput = {
  readonly convStore: ConversationStore;
  readonly sessionId: string;
  readonly userContent: string;
  readonly assistantContent: string;
  readonly channelId: string;
  readonly discordUserId: string;
  readonly discordMessageId: string;
  readonly log: Logger;
};

export function captureDiscordExchange(input: CaptureInput): void {
  const { convStore, sessionId, log } = input;

  // SEC-02: detect instruction patterns on user content
  const detection = detectInstructionPatterns(input.userContent);
  const instructionFlags = detection.detected
    ? JSON.stringify(detection)
    : null;

  if (detection.detected) {
    log.warn(
      { risk: detection.riskLevel, patterns: detection.patterns, channel: input.channelId },
      "instruction pattern detected in user message",
    );
  }

  // Record user turn
  convStore.recordTurn({
    sessionId,
    role: "user",
    content: input.userContent,
    channelId: input.channelId,
    discordUserId: input.discordUserId,
    discordMessageId: input.discordMessageId,
    instructionFlags,
  });

  // Record assistant turn
  convStore.recordTurn({
    sessionId,
    role: "assistant",
    content: input.assistantContent,
    channelId: input.channelId,
  });
}
```

### Example 5: Session Lifecycle Wiring in SessionManager

```typescript
// In SessionManager.startAgent(), after memory.initMemory(name, config):
const convStore = this.memory.conversationStores.get(name);
if (convStore) {
  const convSession = convStore.startSession(name);
  this.activeConversationSessionIds.set(name, convSession.id);
}

// In SessionManager.stopAgent(), before memory.cleanupMemory(name):
const convSessionId = this.activeConversationSessionIds.get(name);
const convStore = this.memory.conversationStores.get(name);
if (convStore && convSessionId) {
  try { convStore.endSession(convSessionId); } catch { /* session may already be ended */ }
}
this.activeConversationSessionIds.delete(name);

// In crash handler (handle.onError callback):
const convSessionId = this.activeConversationSessionIds.get(name);
const convStore = this.memory.conversationStores.get(name);
if (convStore && convSessionId) {
  try { convStore.crashSession(convSessionId); } catch { /* best-effort */ }
}
this.activeConversationSessionIds.delete(name);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| SessionLogger markdown files | ConversationStore SQLite (Phase 64) | Phase 64 | Turns are now query-ready, not just human-readable |
| No capture | Fire-and-forget capture in bridge | Phase 65 (this) | Every Discord exchange persisted |
| No injection detection | Regex-based instruction detector | Phase 65 (this) | SEC-02 compliance |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEC-02 | Instruction patterns detected before storage | unit | `npx vitest run src/security/instruction-detector.test.ts -x` | Wave 0 |
| SEC-02 | Detection result stored on turn record | unit | `npx vitest run src/discord/__tests__/capture.test.ts -x` | Wave 0 |
| SEC-02 | Detection does not block storage | unit | `npx vitest run src/discord/__tests__/capture.test.ts -x` | Wave 0 |
| (implicit) | Capture fires after successful response | unit | `npx vitest run src/discord/__tests__/capture.test.ts -x` | Wave 0 |
| (implicit) | Capture failure does not affect Discord delivery | unit | `npx vitest run src/discord/__tests__/bridge.test.ts -x` | Existing (extend) |
| (implicit) | Session lifecycle (start/end/crash) wired | unit | `npx vitest run src/manager/__tests__/session-manager.test.ts -x` | Existing (extend) |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/security/instruction-detector.test.ts` -- covers SEC-02 pattern matching
- [ ] `src/discord/__tests__/capture.test.ts` -- covers capture helper + detection integration

## Project Constraints (from CLAUDE.md)

- **Immutability:** All returned objects must use Object.freeze(). Never mutate existing objects -- create new ones.
- **File size:** 200-400 lines typical, 800 max. The capture helper and instruction detector should each be their own files.
- **Error handling:** Handle errors explicitly at every level. The capture block must have its own try/catch.
- **Input validation:** Validate at system boundaries. The instruction detector IS a validation boundary.
- **No hardcoded secrets:** N/A for this phase.
- **Security:** All user inputs validated (instruction detector validates message content).
- **GSD Workflow:** All changes through GSD workflow.
- **Zero new npm dependencies:** Per REQUIREMENTS.md and CLAUDE.md stack constraints.

## Open Questions

1. **Thread session ConversationStore mapping**
   - What we know: Thread sessions have names like `agent-a:thread-123`. AgentMemoryManager keys ConversationStore by agent name (not session name).
   - What's unclear: Does `getConversationStore("agent-a:thread-123")` return undefined because the key is `"agent-a"`?
   - Recommendation: The capture helper should strip the thread suffix to resolve the parent agent's store. Thread messages belong to the parent agent's conversation history.

2. **Active session ID for thread sessions**
   - What we know: Thread sessions may have their own conversation session IDs vs sharing the parent's.
   - What's unclear: Should thread turns go into the parent's session or a separate session?
   - Recommendation: Thread turns go into the parent agent's active session. Threads are sub-conversations, not separate sessions. The `channelId` field on the turn distinguishes thread vs channel messages.

## Sources

### Primary (HIGH confidence)
- `src/discord/bridge.ts` -- full DiscordBridge implementation, capture point at line 625
- `src/memory/conversation-store.ts` -- ConversationStore API, recordTurn signature
- `src/memory/conversation-types.ts` -- RecordTurnInput, ConversationTurn, ConversationSession types
- `src/manager/session-manager.ts` -- accessor patterns (getDocumentStore, getTraceCollector), lifecycle hooks
- `src/manager/session-memory.ts` -- AgentMemoryManager.conversationStores Map, initMemory/cleanupMemory
- `src/manager/daemon.ts` -- bridge construction, wiring order (lines 1048-1058)
- `src/memory/store.ts` -- schema migration patterns (migrateConversationTables, migrateSourceTurnIds)
- `src/security/allowlist-matcher.ts` -- existing security module pattern (pure functions + class)
- `.planning/research/ARCHITECTURE.md` -- capture flow, anti-patterns, component boundaries

### Secondary (MEDIUM confidence)
- `.planning/REQUIREMENTS.md` -- SEC-02 definition, out-of-scope items
- `65-CONTEXT.md` -- fire-and-forget capture, detection flags not blocks

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all existing libraries
- Architecture: HIGH -- capture point is precisely identified, all data in scope, accessor pattern established
- Pitfalls: HIGH -- based on direct codebase analysis of race conditions and error paths

**Research date:** 2026-04-17
**Valid until:** 2026-05-17 (stable -- internal architecture, no external API changes)
