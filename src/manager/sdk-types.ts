/**
 * Local type definitions for the Claude Agent SDK v2 unstable API.
 *
 * These mirror the subset of types used by session-adapter.ts.
 * The SDK is pre-1.0 and these types may change between minor versions.
 *
 * MIGRATION NOTES (when SDK stabilizes):
 * 1. Replace SdkModule with direct named imports from '@anthropic-ai/claude-agent-sdk'
 * 2. Replace SdkSession with SDK's exported SDKSession type
 * 3. Replace SdkStreamMessage with SDK's exported SDKMessage type
 * 4. Replace SdkSessionOptions with SDK's exported SDKSessionOptions type
 * 5. Remove this file entirely once SDK types are stable
 * 6. Update loadSdk() in session-adapter.ts to use named imports instead of dynamic import
 *
 * SDK version at time of writing: 0.2.97
 * SDK repo: https://github.com/anthropics/claude-agent-sdk-typescript
 */

/**
 * Options passed to unstable_v2_createSession and unstable_v2_resumeSession.
 * Subset of SDK's SDKSessionOptions -- only fields we actually use.
 */
export type SdkSessionOptions = {
  readonly model: string;
  readonly cwd?: string;
  readonly systemPrompt?: string;
  readonly permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan";
  readonly mcpServers?: Record<string, {
    readonly command: string;
    readonly args?: readonly string[];
    readonly env?: Readonly<Record<string, string>>;
  }>;
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
 * Union of message types we handle from session.stream().
 *
 * The SDK's full SDKMessage union has ~25 variants. We only discriminate on
 * "assistant" and "result" types in session-adapter -- all other message types
 * are ignored during stream consumption. This narrowed union keeps our adapter
 * focused on what it actually processes.
 */
export type SdkStreamMessage = SdkAssistantMessage | SdkResultMessage;

/**
 * The session object returned by unstable_v2_createSession / unstable_v2_resumeSession.
 * Mirrors SDK's SDKSession interface with the subset of members we use.
 */
export type SdkSession = {
  readonly sessionId: string;
  /** Runtime alias -- SDK exposes both sessionId and id */
  readonly id?: string;
  send(message: string): Promise<void>;
  stream(): AsyncGenerator<SdkStreamMessage, void>;
  close(): void;
  /** Event listener -- optional since it is not part of the official SDKSession interface */
  on?(event: string, handler: (...args: unknown[]) => unknown): void;
};

/**
 * Shape of the dynamically imported SDK module.
 * Contains only the functions we call from session-adapter.
 */
export type SdkModule = {
  unstable_v2_createSession(options: SdkSessionOptions): SdkSession;
  unstable_v2_resumeSession(sessionId: string, options: SdkSessionOptions): SdkSession;
};
