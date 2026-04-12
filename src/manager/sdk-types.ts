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
 * Options passed to sdk.query().
 * Subset of SDK's Options -- only fields we actually use.
 */
export type SdkQueryOptions = {
  readonly cwd?: string;
  readonly model?: string;
  readonly effort?: "low" | "medium" | "high" | "max";
  readonly systemPrompt?: string;
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
  };
  readonly num_turns?: number;
  readonly duration_ms?: number;
  readonly model?: string;
  readonly uuid?: string;
  readonly session_id?: string;
};

/**
 * An error result message from the SDK stream.
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
};

/**
 * Shape of the dynamically imported SDK module.
 * Contains only the functions we call from session-adapter.
 */
export type SdkModule = {
  query(params: { prompt: string | AsyncIterable<SdkUserMessage>; options?: SdkQueryOptions }): SdkQuery;
};
