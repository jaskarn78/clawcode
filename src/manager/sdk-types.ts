/**
 * Local type definitions for the Claude Agent SDK query() API.
 *
 * These mirror the subset of types used by session-adapter.ts.
 * The SDK is pre-1.0 and these types may change between minor versions.
 *
 * MIGRATION NOTES (when SDK stabilizes):
 * 1. Replace SdkModule with direct named imports from '@anthropic-ai/claude-agent-sdk'
 * 2. Replace SdkQuery with SDK's exported Query type
 * 3. Replace SdkStreamMessage with SDK's exported SDKMessage type
 * 4. Replace SdkQueryOptions with SDK's exported Options type
 * 5. Remove this file entirely once SDK types are stable
 * 6. Update loadSdk() in session-adapter.ts to use named imports instead of dynamic import
 *
 * API migration: unstable_v2_createSession/unstable_v2_resumeSession -> query()
 * The query() API supports mcpServers, settingSources, resume, streamInput() for
 * multi-turn, and mcpServerStatus() — capabilities the unstable_v2 API lacked.
 *
 * SDK version at time of writing: 0.2.97
 * SDK repo: https://github.com/anthropics/claude-agent-sdk-typescript
 */

/**
 * A user message sent via streamInput() for multi-turn conversations.
 */
export type SdkUserMessage = {
  readonly type: "user";
  readonly content: string;
};

/**
 * Phase 87 CMD-01 — local projection of the SDK's `SlashCommand` type
 * (sdk.d.ts:4239-4252). Returned by Query.initializationResult().commands
 * and Query.supportedCommands(). Used by native-cc-commands.ts to build
 * Discord SlashCommandDef[] entries for each agent.
 *
 * `name` is the bare command (without leading slash); `description` is the
 * human-readable summary; `argumentHint` is a template (e.g. "<file>") for
 * any arguments the command accepts.
 */
export type SlashCommand = {
  readonly name: string;
  readonly description: string;
  readonly argumentHint: string;
};

/**
 * Phase 87 CMD-02 — SDK PermissionMode union.
 * Mirrors @anthropic-ai/claude-agent-sdk@0.2.97 sdk.d.ts:1512.
 * Exported for consumption by SessionHandle, SessionManager, daemon IPC,
 * and Discord slash-command dispatch — single source of truth.
 */
export type PermissionMode =
  | "default"
  | "acceptEdits"
  | "bypassPermissions"
  | "plan"
  | "dontAsk"
  | "auto";

/**
 * Options passed to sdk.query().
 * Subset of SDK's Options -- only fields we actually use.
 */
/**
 * Phase 52 Plan 02: `systemPrompt` widened to accept the SDK's preset+append
 * form. Matches node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:
 *
 *   systemPrompt?: string | {
 *     type: 'preset';
 *     preset: 'claude_code';
 *     append?: string;
 *     excludeDynamicSections?: boolean;
 *   };
 *
 * SdkSessionAdapter emits the preset-object form so the SDK's claude_code
 * preset scaffolds cache markers automatically; `append` concatenates our
 * stable prefix (identity + soul + skills header + stable hot-tier).
 */
export type SdkQueryOptions = {
  readonly cwd?: string;
  readonly model?: string;
  readonly effort?: "low" | "medium" | "high" | "max";
  readonly systemPrompt?:
    | string
    | {
        readonly type: "preset";
        readonly preset: "claude_code";
        readonly append?: string;
        readonly excludeDynamicSections?: boolean;
      };
  readonly permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan";
  readonly mcpServers?: Record<string, {
    readonly command: string;
    readonly args?: readonly string[];
    readonly env?: Readonly<Record<string, string>>;
  }>;
  readonly settingSources?: readonly string[];
  readonly resume?: string;
  readonly sessionId?: string;
  readonly allowDangerouslySkipPermissions?: boolean;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Phase 59 -- native SDK abort support (sdk.d.ts:957 Options.abortController). */
  readonly abortController?: AbortController;
};

/**
 * An assistant-type message from the SDK stream.
 * The SDK's actual SDKAssistantMessage has a nested `message: BetaMessage` structure,
 * but at the stream level the adapter checks for a `content` property.
 * We type this loosely to match runtime usage.
 */
export type SdkAssistantMessage = {
  readonly type: "assistant";
  readonly content?: string;
  readonly message?: unknown;
  readonly uuid?: string;
  readonly session_id?: string;
};

/**
 * A successful result message from the SDK stream.
 *
 * Phase 52 Plan 01: `usage` is extended with `cache_creation_input_tokens`
 * and `cache_read_input_tokens` — BetaUsage (snake_case) as reported by the
 * SDK. session-adapter reads these to populate the per-turn cache telemetry
 * snapshot via `Turn.recordCacheUsage`.
 */
export type SdkResultSuccess = {
  readonly type: "result";
  readonly subtype: "success";
  readonly result?: string;
  readonly is_error?: boolean;
  readonly total_cost_usd?: number;
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
    readonly cache_creation_input_tokens?: number;
    readonly cache_read_input_tokens?: number;
  };
  readonly num_turns?: number;
  readonly duration_ms?: number;
  readonly model?: string;
  readonly uuid?: string;
  readonly session_id?: string;
};

/**
 * An error result message from the SDK stream.
 *
 * Phase 52 Plan 01: `usage` extended with cache fields (same shape as
 * SdkResultSuccess). Error results can still carry partial token counts.
 */
export type SdkResultError = {
  readonly type: "result";
  readonly subtype: "error_during_execution" | "error_max_turns" | "error_max_budget_usd" | "error_max_structured_output_retries" | string;
  readonly is_error: boolean;
  readonly result?: string;
  readonly total_cost_usd?: number;
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
    readonly cache_creation_input_tokens?: number;
    readonly cache_read_input_tokens?: number;
  };
  readonly num_turns?: number;
  readonly duration_ms?: number;
  readonly model?: string;
  readonly uuid?: string;
  readonly session_id?: string;
};

/**
 * Union of result message types from the SDK stream.
 */
export type SdkResultMessage = SdkResultSuccess | SdkResultError;

/**
 * Union of message types we handle from query() iteration.
 *
 * The SDK's full SDKMessage union has ~25 variants. We only discriminate on
 * "assistant" and "result" types in session-adapter -- all other message types
 * are ignored during stream consumption. This narrowed union keeps our adapter
 * focused on what it actually processes.
 */
export type SdkStreamMessage = SdkAssistantMessage | SdkResultMessage;

/**
 * The Query object returned by sdk.query().
 * An async generator that yields SDK messages, with methods for multi-turn
 * interaction and MCP server management.
 */
export type SdkQuery = AsyncGenerator<SdkStreamMessage, void> & {
  interrupt(): Promise<void>;
  close(): void;
  streamInput(stream: AsyncIterable<SdkUserMessage>): Promise<void>;
  mcpServerStatus(): Promise<unknown[]>;
  setMcpServers(servers: Record<string, unknown>): Promise<unknown>;
  /**
   * Phase 83 EFFORT-01 — SDK mid-session thinking-token control.
   * Mirrors @anthropic-ai/claude-agent-sdk@0.2.97 Query.setMaxThinkingTokens
   * (sdk.d.ts:1728). Pass `null` to reset to model default, `0` to disable
   * thinking outright, or a positive integer for an explicit budget.
   * Consumed by persistent-session-handle.ts:setEffort.
   */
  setMaxThinkingTokens(maxThinkingTokens: number | null): Promise<void>;
  /**
   * Phase 86 MODEL-03 — SDK mid-session model swap.
   * Mirrors @anthropic-ai/claude-agent-sdk@0.2.97 Query.setModel
   * (sdk.d.ts:1711). Passing undefined resets to the session default;
   * a string must be a valid Claude model id. Consumed by
   * persistent-session-handle.ts:setModel.
   */
  setModel(model?: string): Promise<void>;
  /**
   * Phase 87 CMD-02 — SDK mid-session permission-mode swap.
   * Mirrors @anthropic-ai/claude-agent-sdk@0.2.97 Query.setPermissionMode
   * (sdk.d.ts:1704). Control-plane control request, safe by the same design
   * as setModel/setMaxThinkingTokens (CMD-00 spike confirmation). Consumed
   * by persistent-session-handle.ts:setPermissionMode.
   */
  setPermissionMode(mode: PermissionMode): Promise<void>;
  /**
   * Phase 87 CMD-01 — enumerate SDK-reported slash commands at init time.
   * Mirrors @anthropic-ai/claude-agent-sdk@0.2.97 Query.initializationResult
   * (sdk.d.ts:1748). Returns the full SDKControlInitializeResponse which
   * includes commands + agents + models + skills — preferred over
   * supportedCommands() because one round-trip covers Plan 02/03 needs.
   * Consumed by persistent-session-handle.ts:getSupportedCommands (cached).
   */
  initializationResult(): Promise<{
    readonly commands: readonly SlashCommand[];
    readonly agents?: readonly unknown[];
    readonly models?: readonly unknown[];
  }>;
  /**
   * Phase 87 CMD-01 — narrower enumeration post-init (no agents/models).
   * Mirrors @anthropic-ai/claude-agent-sdk@0.2.97 Query.supportedCommands
   * (sdk.d.ts:1754). Available for callers that only need the commands list
   * after initialization has completed.
   */
  supportedCommands(): Promise<readonly SlashCommand[]>;
};

/**
 * Shape of the dynamically imported SDK module.
 * Contains only the functions we call from session-adapter.
 */
export type SdkModule = {
  query(params: { prompt: string | AsyncIterable<SdkUserMessage>; options?: SdkQueryOptions }): SdkQuery;
};
