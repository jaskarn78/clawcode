---
phase: quick
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/manager/session-adapter.ts
  - src/manager/session-manager.ts
  - src/discord/bridge.ts
  - src/discord/slash-commands.ts
  - src/discord/streaming.ts
autonomous: true
requirements: []
must_haves:
  truths:
    - "Discord shows typing indicator immediately when a message is received"
    - "Agent responses appear progressively in Discord as text streams in"
    - "Message edits are throttled to avoid Discord rate limits"
    - "Long responses are split correctly at 2000 char boundary"
    - "Existing send/sendAndCollect methods are unchanged"
    - "Slash command responses update progressively instead of appearing all at once"
  artifacts:
    - path: "src/discord/streaming.ts"
      provides: "Throttled progressive message editor utility"
    - path: "src/manager/session-adapter.ts"
      provides: "sendAndStream method on SessionHandle"
    - path: "src/manager/session-manager.ts"
      provides: "streamFromAgent method on SessionManager"
    - path: "src/discord/bridge.ts"
      provides: "Typing indicator + streaming response in handleMessage"
    - path: "src/discord/slash-commands.ts"
      provides: "Progressive edit during slash command execution"
  key_links:
    - from: "src/discord/bridge.ts"
      to: "src/manager/session-manager.ts"
      via: "streamFromAgent callback"
      pattern: "streamFromAgent.*onChunk"
    - from: "src/discord/streaming.ts"
      to: "discord.js Message.edit"
      via: "throttled edit calls"
      pattern: "ProgressiveMessageEditor"
---

<objective>
Add typing indicators and streaming responses to the Discord bridge so users see immediate feedback and progressive text updates instead of waiting for the complete agent response.

Purpose: Eliminate the multi-second dead silence between sending a message and receiving a response in Discord. Typing indicator provides immediate feedback; streaming edits show the response building in real time.

Output: New streaming utility, updated session adapter/manager with streaming method, updated bridge and slash commands with progressive response delivery.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/manager/session-adapter.ts
@src/manager/session-manager.ts
@src/discord/bridge.ts
@src/discord/slash-commands.ts

<interfaces>
From src/manager/session-adapter.ts:
```typescript
export type SessionHandle = {
  readonly sessionId: string;
  send: (message: string) => Promise<void>;
  sendAndCollect: (message: string) => Promise<string>;
  close: () => Promise<void>;
  onError: (handler: (error: Error) => void) => void;
  onEnd: (handler: () => void) => void;
};

export type UsageCallback = (data: {
  readonly tokens_in: number;
  readonly tokens_out: number;
  readonly cost_usd: number;
  readonly turns: number;
  readonly model: string;
  readonly duration_ms: number;
}) => void;
```

From src/manager/session-manager.ts:
```typescript
async sendToAgent(name: string, message: string): Promise<string>
async forwardToAgent(name: string, message: string): Promise<void>
```

From src/discord/bridge.ts:
```typescript
// handleMessage calls sendToAgent, then sendResponse
// sendResponse splits at 2000 chars and calls channel.send
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add streaming primitives (session-adapter, session-manager, streaming utility)</name>
  <files>src/manager/session-adapter.ts, src/manager/session-manager.ts, src/discord/streaming.ts</files>
  <action>
**1. Create `src/discord/streaming.ts` — Progressive message editor utility:**

```typescript
export type StreamChunkCallback = (accumulated: string) => void;

export type ProgressiveEditorOptions = {
  readonly editIntervalMs?: number;  // Default 1500ms (safe under 5 edits/5s limit)
  readonly maxLength?: number;       // Default 2000 (Discord limit)
};
```

Create a `ProgressiveMessageEditor` class that:
- Accepts a `editFn: (content: string) => Promise<void>` in constructor (abstracts Discord message.edit or interaction.editReply)
- Has `update(accumulated: string): void` — called whenever new text arrives; sets a pending update
- Uses a throttle timer: when `update` is called, if no edit is pending, schedule one after `editIntervalMs`. When the timer fires, call `editFn` with the latest accumulated text (truncated to `maxLength` with "..." suffix if over limit)
- Has `flush(): Promise<void>` — sends the final accumulated text immediately (cancels pending timer). If text exceeds maxLength, this is fine — the bridge's `sendResponse` handles splitting for the final message
- Has `dispose(): void` — cancels any pending timer without sending
- Track whether any edit has been sent yet via a boolean. The first call to `update` should be forwarded immediately (no delay) so the user sees something fast

**2. Add `sendAndStream` to `SessionHandle` in `src/manager/session-adapter.ts`:**

Add to the `SessionHandle` type:
```typescript
sendAndStream: (message: string, onChunk: (accumulated: string) => void) => Promise<string>;
```

Add to `MockSessionHandle`:
```typescript
async sendAndStream(_message: string, onChunk: (accumulated: string) => void): Promise<string> {
  if (this.closed) throw new Error(`Session ${this.sessionId} is closed`);
  const response = `Mock response from ${this.sessionId}`;
  onChunk(response);
  return response;
}
```

In `wrapSdkSession`, implement `sendAndStream` by adapting the existing `sendAndCollect` logic. The key difference: when an `assistant` message with content arrives, immediately call `onChunk` with the accumulated text so far (join all textParts collected up to that point with "\n"). Still return the final complete text at the end (same as sendAndCollect — prefer result.result if non-empty, fall back to collected textParts). The usageCallback extraction remains identical.

**3. Add `streamFromAgent` to `SessionManager` in `src/manager/session-manager.ts`:**

```typescript
async streamFromAgent(
  name: string,
  message: string,
  onChunk: (accumulated: string) => void,
): Promise<string> {
  const handle = this.sessions.get(name);
  if (!handle) {
    throw new SessionError(`Agent '${name}' is not running`, name);
  }
  this.log.info({ agent: name, messageLength: message.length }, "streaming message to agent");
  const response = await handle.sendAndStream(message, onChunk);
  this.log.info({ agent: name, responseLength: response.length }, "agent stream complete");
  return response;
}
```

Do NOT modify existing `send`, `sendAndCollect`, or `sendToAgent` methods.
  </action>
  <verify>
    <automated>cd /home/jjagpal/.openclaw/workspace-coding && npx tsx --eval "import('./src/discord/streaming.js')" && npx tsx --eval "import('./src/manager/session-adapter.js')" && npx tsx --eval "import('./src/manager/session-manager.js')" && echo "All imports OK"</automated>
  </verify>
  <done>
    - SessionHandle type has sendAndStream method
    - MockSessionHandle implements sendAndStream
    - SdkSessionAdapter wrapSdkSession implements sendAndStream with chunk callbacks
    - SessionManager has streamFromAgent method
    - ProgressiveMessageEditor utility exists with throttled edit, flush, dispose
    - Existing send/sendAndCollect/sendToAgent unchanged
  </done>
</task>

<task type="auto">
  <name>Task 2: Integrate streaming into Discord bridge and slash commands</name>
  <files>src/discord/bridge.ts, src/discord/slash-commands.ts</files>
  <action>
**1. Update `src/discord/bridge.ts` — handleMessage with typing + streaming:**

In `handleMessage`, immediately after the `if (message.author.bot)` guard and channel/agent resolution (but before the try block that sends to agent), add:

```typescript
// Show typing indicator immediately
if ("sendTyping" in message.channel && typeof message.channel.sendTyping === "function") {
  void message.channel.sendTyping();
}
```

Also start a typing refresh interval inside the try block (Discord typing lasts 10s, refresh every 8s):
```typescript
const typingInterval = setInterval(() => {
  if ("sendTyping" in message.channel && typeof message.channel.sendTyping === "function") {
    void message.channel.sendTyping();
  }
}, 8000);
```

Clear it in both the success path and the catch block: `clearInterval(typingInterval)`.

Replace the `sendToAgent` + `sendResponse` flow with streaming:

```typescript
import { ProgressiveMessageEditor } from "./streaming.js";

// Inside try block, after typingInterval setup:
let sentMessage: Message | null = null;
const editor = new ProgressiveMessageEditor({
  editFn: async (content: string) => {
    if (!sentMessage) {
      // First chunk: send a new message
      if ("send" in channel && typeof channel.send === "function") {
        sentMessage = await channel.send(content);
      }
    } else {
      // Subsequent chunks: edit the existing message
      await sentMessage.edit(content);
    }
  },
});

const response = await this.sessionManager.streamFromAgent(
  agentName,
  formattedMessage,
  (accumulated) => editor.update(accumulated),
);

clearInterval(typingInterval);
await editor.flush();

// If the final response is longer than what was shown via streaming edits,
// send the full response properly (handles splitting for >2000 chars)
if (response && response.trim().length > 0) {
  if (sentMessage && response.length <= 2000) {
    // Final edit with complete text
    await sentMessage.edit(response);
  } else if (response.length > 2000) {
    // Delete the streaming preview and send properly split messages
    if (sentMessage) {
      try { await sentMessage.delete(); } catch { /* ignore */ }
    }
    await this.sendResponse(originalMessage, response);
  }
} else if (!sentMessage) {
  this.log.warn({ agent: agentName, channel: channelId }, "agent returned empty response");
}
```

Make sure to also clear the typing interval and dispose the editor in the catch block.

Also add typing indicator for thread-routed messages (the thread routing block near the top of handleMessage). Before `this.sessionManager.forwardToAgent(sessionName, formattedMessage)`, add:
```typescript
if ("sendTyping" in message.channel && typeof message.channel.sendTyping === "function") {
  void message.channel.sendTyping();
}
```
Thread messages use `forwardToAgent` (fire-and-forget), so no streaming there — just typing indicator.

**2. Update `src/discord/slash-commands.ts` — progressive edits:**

In `handleInteraction`, after `deferReply()` succeeds, add an immediate "thinking" edit:
```typescript
await interaction.editReply("Thinking...");
```

Replace the `sendToAgent` call with `streamFromAgent`:

```typescript
import { ProgressiveMessageEditor } from "./streaming.js";

const editor = new ProgressiveMessageEditor({
  editFn: async (content: string) => {
    const truncated = content.length > DISCORD_MAX_LENGTH
      ? content.slice(0, DISCORD_MAX_LENGTH - 3) + "..."
      : content;
    await interaction.editReply(truncated);
  },
  editIntervalMs: 1500,
});

const response = await this.sessionManager.streamFromAgent(
  agentName,
  formattedMessage,
  (accumulated) => editor.update(accumulated),
);

await editor.flush();
```

Then keep the existing empty-response and truncation logic for the final `editReply`.

In the catch block, call `editor.dispose()` before the error editReply.
  </action>
  <verify>
    <automated>cd /home/jjagpal/.openclaw/workspace-coding && npx tsc --noEmit --pretty 2>&1 | head -30</automated>
  </verify>
  <done>
    - Bridge shows typing indicator immediately on message receipt
    - Bridge refreshes typing every 8s during agent processing
    - Bridge progressively edits a sent message as chunks arrive
    - Bridge handles final response correctly (edit if short, split if long)
    - Slash commands show "Thinking..." immediately after defer
    - Slash commands progressively edit reply as chunks arrive
    - Typing interval always cleaned up (success and error paths)
    - Thread messages get typing indicator (no streaming — fire-and-forget)
  </done>
</task>

</tasks>

<verification>
- `npx tsc --noEmit` passes with no type errors
- Existing SessionHandle methods (send, sendAndCollect) unchanged
- ProgressiveMessageEditor throttles edits to 1 per 1.5s (safe for Discord 5/5s limit)
- No new external dependencies added
</verification>

<success_criteria>
- Discord users see typing indicator within 100ms of sending a message
- Response text appears progressively (first chunk immediately, updates every ~1.5s)
- Messages over 2000 chars are properly split in the final delivery
- Slash command responses show "Thinking..." then progressive updates
- No Discord rate limit violations (edits throttled to ~0.67/s per channel)
- All existing bridge/session functionality unchanged for non-streaming paths
</success_criteria>

<output>
After completion, create `.planning/quick/260409-lop-add-typing-indicator-and-streaming-respo/260409-lop-SUMMARY.md`
</output>
