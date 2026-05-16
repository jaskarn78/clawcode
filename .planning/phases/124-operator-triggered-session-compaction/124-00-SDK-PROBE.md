# Phase 124 — SDK Compaction Primitive Probe
**Probed:** 2026-05-14
**SDK version:** @anthropic-ai/claude-agent-sdk@0.2.140
**SDK file:** node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts

## Hits

| Line  | Token | Context (1 line) |
|-------|-------|------------------|
| 336   | PostCompactHookInput | Re-exported hook input type (event after compaction) |
| 344   | PreCompactHookInput | Re-exported hook input type (event before compaction) |
| 352   | SDKCompactBoundaryMessage | Re-exported boundary message emitted on the stream |
| 622   | forkSession | `export declare function forkSession(_sessionId: string, _options?: ForkSessionOptions): Promise<ForkSessionResult>;` |
| 627   | ForkSessionOptions | `SessionMutationOptions & { upToMessageId?: string; title?: string }` |
| 637   | ForkSessionResult | `{ sessionId: string }` — new fork UUID, resumable via `resumeSession(sessionId)` |
| 738   | PreCompact / PostCompact | Listed in `HOOK_EVENTS` readonly tuple |
| 757   | PreCompact / PostCompact | Members of the `HookEvent` union |
| 855   | `load_reason: ... 'compact'` | Compact appears as a memory-load reason |
| 1297  | forkSession?: boolean | Option flag on `SessionMutationOptions` (not on `Query`) |
| 1566  | forkSession | Doc reference for custom-ID forks |
| 1854  | interrupt?: boolean | Option flag (not a verb) |
| 1867  | interrupt?: boolean | Option flag (not a verb) |
| 1914  | PostCompactHookInput | Hook payload — fires AFTER compaction completes |
| 1920  | compact_summary: string | "The conversation summary produced by compaction" (result-only) |
| 2033  | interrupt() | `interrupt(): Promise<void>` on `Query` — verb, but it interrupts the turn, not compacts |
| 2483  | SDKCompactBoundaryMessage | Stream message with `subtype: 'compact_boundary'` (result-only event) |
| 2486  | compact_metadata | `{ messagesToKeep, anchor_uuid }` on the boundary message |
| 2653  | autoCompactThreshold?: number | Options flag (configures auto-compact threshold) |
| 2654  | isAutoCompactEnabled | Options boolean |
| 2747-2749 | SDKControlInterruptRequest | Internal control-request type for `interrupt` verb |
| 2893  | SDKControlRequestInner | Full union of EVERY internal control-request type — see exhaustive scan below |
| 3508  | SDKStatus = 'compacting' \| 'requesting' \| null | Read-only status indicator |
| 3515  | compact_result?: 'success' \| 'failed' | Result-only field |
| 3516  | compact_error?: string | Result-only field |
| 3750  | source: 'startup' \| 'resume' \| 'clear' \| 'compact' | `SessionStart` hook input source enum (post-compact resume marker) |
| 5119  | autoCompactWindow?: number | Options flag |
| 5311  | autoCompactEnabled?: boolean | Options flag |

## Callable Primitives Identified

The `Query` interface (lines 2023-2250) is the complete public surface for daemon→worker control on a live session. Methods present: `interrupt()`, `setPermissionMode()`, `setModel()`, `setMaxThinkingTokens()`, `applyFlagSettings()`, `initializationResult()`, `supportedCommands()`, `supportedModels()`, `supportedAgents()`, `mcpServerStatus()`, `getContextUsage()`, `readFile()`, `reloadPlugins()`, `accountInfo()`, `rewindFiles()`, `seedReadState()`, `reconnectMcpServer()`, `toggleMcpServer()`, `setMcpServers()`, `streamInput()`, `stopTask()`, `backgroundTasks()`, `close()`.

**No `compact()` method exists on `Query`.**

The internal `SDKControlRequestInner` union (line 2893) is the exhaustive set of dispatchable control verbs. Scanning every member:
`Interrupt, Permission, Initialize, SetPermissionMode, SetModel, SetMaxThinkingTokens, RenameSession, SetColor, McpStatus, GetContextUsage, GetSessionCost, GetBinaryVersion, McpCall, FileSuggestions, HookCallback, McpMessage, RewindFiles, CancelAsyncMessage, ReadFile, SeedReadState, McpSetServers, ReloadPlugins, McpReconnect, McpToggle, ChannelEnable, EndSession, McpAuthenticate, McpClearAuth, McpOAuthCallbackUrl, ClaudeAuthenticate, ClaudeOAuthCallback, ClaudeOAuthWaitForCompletion, RemoteControl, GenerateSessionTitle, SideQuestion, UltrareviewLaunch, MessageRated, OAuthTokenRefresh, StopTask, BackgroundTasks, ApplyFlagSettings, GetSettings, Elicitation, RequestUserDialog, SubmitFeedback`.

**No `SDKControlCompactRequest` exists in the union.** Compaction is not a control-protocol verb in SDK 0.2.140.

### Primitive: `forkSession` (free function, off-session)
- Signature: `export declare function forkSession(_sessionId: string, _options?: ForkSessionOptions): Promise<ForkSessionResult>;`
- Parameters: `_sessionId: string` — UUID of source session; `_options?: { upToMessageId?: string; title?: string; dir?: string }` (extends `SessionMutationOptions`).
- Returns: `Promise<{ sessionId: string }>` — new fork UUID, resumable via `resumeSession(sessionId)`.
- Bypasses turn loop?: yes — operates on session JSONL on disk, not on the live `Query` stream. Does NOT directly invoke compaction; it slices/copies session state. Compaction artifacts (`compact_summary`, `compact_boundary`) come from the natural auto-compact path or from a session that has already compacted.
- Source line: 622.

### Primitive: `Query.interrupt()` (on-session)
- Signature: `interrupt(): Promise<void>`
- Parameters: none.
- Returns: `Promise<void>`.
- Bypasses turn loop?: yes — interrupts the current turn. Does NOT trigger compaction. Listed only to rule it out: it ends a turn, it does not summarize one.
- Source line: 2033.

### Primitive: `Query.applyFlagSettings({ autoCompactEnabled, autoCompactThreshold })` (on-session)
- Signature: `applyFlagSettings(settings: { [K in keyof Settings]?: Settings[K] | null; }): Promise<void>`
- Parameters: a partial `Settings` object (flag-layer settings).
- Returns: `Promise<void>`.
- Bypasses turn loop?: yes — mid-session flag-layer mutation, applies immediately.
- Source line: 2083. **Indirect-only.** Setting `autoCompactThreshold` to ~0 cannot force-trigger compaction mid-session per the option's doc (it changes the threshold for the SDK's own auto-compact pass; the SDK still decides when to invoke). Not a verb.

## Recommendation for Plan 124-01 T-03

**Primitive:** `forkSession(sessionId, { upToMessageId?, title? })`
**Why:** SDK 0.2.140 exposes no callable verb to force compaction on a live `Query` — confirmed by exhaustive scan of (a) the public `Query` interface and (b) the internal `SDKControlRequestInner` union. Auto-compaction is option-driven (`autoCompactEnabled` / `autoCompactThreshold`) and result-readable (`PostCompactHookInput.compact_summary`, `SDKCompactBoundaryMessage`), but the SDK reserves the trigger. Per CONTEXT D-11 the fallback is `forkSession`: daemon stops the worker's live `Query` (`close()` or `interrupt()`), forks the session JSONL via `forkSession(sessionId)`, and resumes the worker against the fork's UUID. The fork inherits any compaction boundary the source had at fork time; if the source has not yet auto-compacted, the worker resumes against a sliced transcript (`upToMessageId`) rather than a true `compact_summary`. This is a one-shot operator escape hatch, not a perfect compaction equivalent — Phase 125's tiered-retention algorithm will need to revisit this when SDK 0.3.x lands a public compact verb.
**Fallback if primitive fails at runtime:** None — `forkSession` is itself the D-11 fallback. If it fails, surface `ERR_FORK_FAILED` to the operator and abort.
**BLOCKED-sdk-feature annotation required for 124-01?:** yes
  - Annotation text for Plan 01 to embed verbatim:
    > **BLOCKED-sdk-feature:** SDK 0.2.140 (@anthropic-ai/claude-agent-sdk) does not expose a callable `compact()` verb on the `Query` interface, nor an `SDKControlCompactRequest` in the internal control-request union (verified at `sdk.d.ts:2023-2250` and `sdk.d.ts:2893`). Compaction is option-driven (`autoCompactEnabled` / `autoCompactThreshold`) and result-readable (`PostCompactHookInput.compact_summary`, `SDKCompactBoundaryMessage`), but the SDK reserves the trigger. Phase 124-01 implements the daemon→worker control verb via `forkSession(sessionId, { upToMessageId? })` per CONTEXT D-11: the daemon stops the live `Query`, forks the session JSONL, and resumes the worker against the fork UUID. This is a one-shot operator escape hatch, not a true compaction. Revisit when SDK 0.3.x exposes a public compact control API (track `SDKControlRequestInner` union for a new `Compact` member, or `Query` for a new `compact()` method).
