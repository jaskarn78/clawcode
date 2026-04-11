import type { AgentSessionConfig } from "./types.js";
import type { SdkModule, SdkQueryOptions, SdkQuery, SdkStreamMessage } from "./sdk-types.js";

/**
 * Callback invoked after each SDK send/sendAndCollect with usage data
 * extracted from the result message.
 */
export type UsageCallback = (data: {
  readonly tokens_in: number;
  readonly tokens_out: number;
  readonly cost_usd: number;
  readonly turns: number;
  readonly model: string;
  readonly duration_ms: number;
}) => void;

/**
 * A handle to an active agent session.
 * Provides methods to interact with and monitor the session lifecycle.
 */
export type SessionHandle = {
  readonly sessionId: string;
  send: (message: string) => Promise<void>;
  sendAndCollect: (message: string) => Promise<string>;
  sendAndStream: (message: string, onChunk: (accumulated: string) => void) => Promise<string>;
  close: () => Promise<void>;
  onError: (handler: (error: Error) => void) => void;
  onEnd: (handler: () => void) => void;
};

/**
 * Interface for creating and resuming agent sessions.
 * Abstracts the underlying SDK so that tests can use MockSessionAdapter
 * and production uses SdkSessionAdapter.
 */
export type SessionAdapter = {
  createSession(config: AgentSessionConfig, usageCallback?: UsageCallback): Promise<SessionHandle>;
  resumeSession(sessionId: string, config: AgentSessionConfig, usageCallback?: UsageCallback): Promise<SessionHandle>;
};

// ---------------------------------------------------------------------------
// Mock implementation for testing
// ---------------------------------------------------------------------------

/**
 * A mock session handle that simulates session lifecycle events.
 * Exposes simulateCrash() and simulateEnd() to trigger callbacks in tests.
 */
export class MockSessionHandle implements SessionHandle {
  readonly sessionId: string;
  private errorHandler: ((error: Error) => void) | null = null;
  private endHandler: (() => void) | null = null;
  private closed = false;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  async send(_message: string): Promise<void> {
    if (this.closed) {
      throw new Error(`Session ${this.sessionId} is closed`);
    }
  }

  async sendAndCollect(_message: string): Promise<string> {
    if (this.closed) {
      throw new Error(`Session ${this.sessionId} is closed`);
    }
    return `Mock response from ${this.sessionId}`;
  }

  async sendAndStream(_message: string, onChunk: (accumulated: string) => void): Promise<string> {
    if (this.closed) {
      throw new Error(`Session ${this.sessionId} is closed`);
    }
    const response = `Mock response from ${this.sessionId}`;
    onChunk(response);
    return response;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.endHandler?.();
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler;
  }

  onEnd(handler: () => void): void {
    this.endHandler = handler;
  }

  /**
   * Simulate a session crash. Triggers the onError callback.
   */
  simulateCrash(error?: Error): void {
    const err = error ?? new Error(`Session ${this.sessionId} crashed`);
    this.closed = true;
    this.errorHandler?.(err);
  }

  /**
   * Simulate a session ending normally. Triggers the onEnd callback.
   */
  simulateEnd(): void {
    this.closed = true;
    this.endHandler?.();
  }
}

/**
 * Mock implementation of SessionAdapter for testing without the real SDK.
 * Tracks all active sessions in a Map for inspection.
 */
export class MockSessionAdapter implements SessionAdapter {
  readonly sessions: Map<string, MockSessionHandle> = new Map();
  readonly usageCallbacks: Map<string, UsageCallback> = new Map();
  private counter = 0;

  async createSession(config: AgentSessionConfig, usageCallback?: UsageCallback): Promise<SessionHandle> {
    this.counter += 1;
    const sessionId = `mock-${config.name}-${this.counter}`;
    const handle = new MockSessionHandle(sessionId);
    this.sessions.set(sessionId, handle);
    if (usageCallback) {
      this.usageCallbacks.set(sessionId, usageCallback);
    }
    return handle;
  }

  async resumeSession(
    sessionId: string,
    config: AgentSessionConfig,
    usageCallback?: UsageCallback,
  ): Promise<SessionHandle> {
    const existing = this.sessions.get(sessionId);
    if (usageCallback) {
      this.usageCallbacks.set(sessionId, usageCallback);
    }
    if (existing) {
      return existing;
    }
    // Create a new session if the old one is not found
    const handle = new MockSessionHandle(sessionId);
    this.sessions.set(sessionId, handle);
    return handle;
  }
}

/**
 * Factory function for creating a MockSessionAdapter.
 */
export function createMockAdapter(): MockSessionAdapter {
  return new MockSessionAdapter();
}

// ---------------------------------------------------------------------------
// SDK implementation (real adapter) — uses query() API
// ---------------------------------------------------------------------------

/**
 * Build a clean environment for the SDK subprocess.
 *
 * Strips ANTHROPIC_API_KEY from the inherited process.env so the Claude CLI
 * subprocess uses OAuth subscription auth instead of a potentially stale
 * external API key.
 */
function buildCleanEnv(): Record<string, string | undefined> {
  const { ANTHROPIC_API_KEY: _stripped, ...rest } = process.env;
  // Ensure PATH includes standard bin dirs (detached daemon may inherit stripped PATH)
  if (!rest.PATH || !rest.PATH.includes("/usr/bin")) {
    rest.PATH = `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin${rest.PATH ? `:${rest.PATH}` : ""}`;
  }
  return rest;
}

/**
 * SessionAdapter backed by the Claude Agent SDK query() API.
 * Uses dynamic imports so the file compiles even without the SDK installed.
 *
 * Each send/sendAndCollect/sendAndStream call creates a fresh query() with
 * the `resume` option for session continuity. This per-turn-query approach
 * avoids complex async coordination while preserving multi-turn context.
 */
export class SdkSessionAdapter implements SessionAdapter {
  async createSession(config: AgentSessionConfig, usageCallback?: UsageCallback): Promise<SessionHandle> {
    const sdk = await loadSdk();
    const mcpServers = transformMcpServersForSdk(config.mcpServers);
    const thinkingConfig = config.thinking === "adaptive"
      ? { type: "adaptive" as const }
      : config.thinking === "disabled"
        ? { type: "disabled" as const }
        : { type: "adaptive" as const }; // "enabled" also maps to adaptive for simplicity

    const baseOptions: SdkQueryOptions = {
      model: config.model,
      cwd: config.workspace,
      systemPrompt: config.systemPrompt,
      permissionMode: "bypassPermissions",
      settingSources: ["project"],
      env: buildCleanEnv(),
      thinking: thinkingConfig,
      effort: config.effort ?? "high",
      ...(mcpServers ? { mcpServers } : {}),
    };

    // Initial query to establish the session
    const initialQuery = sdk.query({ prompt: "Session initialized.", options: baseOptions });
    const { sessionId, query } = await drainInitialQuery(initialQuery);

    return wrapSdkQuery(query, sdk, baseOptions, sessionId, usageCallback);
  }

  async resumeSession(
    sessionId: string,
    config: AgentSessionConfig,
    usageCallback?: UsageCallback,
  ): Promise<SessionHandle> {
    const sdk = await loadSdk();
    const mcpServers = transformMcpServersForSdk(config.mcpServers);
    const baseOptions: SdkQueryOptions = {
      model: config.model,
      cwd: config.workspace,
      systemPrompt: config.systemPrompt,
      permissionMode: "bypassPermissions",
      settingSources: ["project"],
      resume: sessionId,
      env: buildCleanEnv(),
      ...(mcpServers ? { mcpServers } : {}),
    };

    return wrapSdkQuery(undefined, sdk, baseOptions, sessionId, usageCallback);
  }
}

/**
 * Transform the mcpServers array from AgentSessionConfig into the SDK's
 * expected Record format (keyed by server name).
 * Returns undefined if no servers are configured.
 */
function transformMcpServersForSdk(
  mcpServers?: readonly { readonly name: string; readonly command: string; readonly args: readonly string[]; readonly env: Readonly<Record<string, string>> }[],
): Record<string, { command: string; args: string[]; env: Record<string, string> }> | undefined {
  if (!mcpServers || mcpServers.length === 0) {
    return undefined;
  }
  return Object.fromEntries(
    mcpServers.map((s) => [s.name, { command: s.command, args: [...s.args], env: { ...s.env } }]),
  );
}

let cachedSdk: SdkModule | null = null;

/**
 * Dynamically import the Claude Agent SDK.
 * Caches the module after first load.
 */
async function loadSdk(): Promise<SdkModule> {
  if (cachedSdk) {
    return cachedSdk;
  }
  try {
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    cachedSdk = sdk as unknown as SdkModule;
    return cachedSdk;
  } catch {
    throw new Error(
      "Claude Agent SDK is not installed. Run: npm install @anthropic-ai/claude-agent-sdk",
    );
  }
}

/**
 * Drain the initial query to extract the session ID from the first result message.
 * Returns the session ID and the (now consumed) query reference.
 */
async function drainInitialQuery(
  query: SdkQuery,
): Promise<{ readonly sessionId: string; readonly query: SdkQuery }> {
  let sessionId = `pending-${Date.now()}`;
  try {
    for await (const msg of query) {
      if (msg.type === "result" && msg.session_id) {
        sessionId = msg.session_id;
        break;
      }
    }
  } catch {
    // If the initial drain fails, proceed with the pending ID.
    // The next per-turn query will establish the session.
  }
  return { sessionId, query };
}

/**
 * Extract usage data from an SDK result message and invoke the callback.
 * Wrapped in try/catch so extraction failures never break the send flow.
 */
function extractUsage(
  msg: SdkStreamMessage,
  callback?: UsageCallback,
): void {
  if (!callback) return;
  if (msg.type !== "result") return;
  try {
    const costUsd = typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : 0;
    const usage = msg.usage;
    const tokensIn = typeof usage?.input_tokens === "number" ? usage.input_tokens : 0;
    const tokensOut = typeof usage?.output_tokens === "number" ? usage.output_tokens : 0;
    const numTurns = typeof msg.num_turns === "number" ? msg.num_turns : 0;
    const durationMs = typeof msg.duration_ms === "number" ? msg.duration_ms : 0;
    const model = typeof msg.model === "string" ? msg.model : "";
    callback({
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      cost_usd: costUsd,
      turns: numTurns,
      model,
      duration_ms: durationMs,
    });
  } catch {
    // Never break the send flow due to usage extraction failure
  }
}

/**
 * Wrap the SDK query() API into a SessionHandle.
 *
 * Uses a per-turn-query pattern: each send/sendAndCollect/sendAndStream creates
 * a fresh query() call with `resume: sessionId` for session continuity. This is
 * simpler than managing a persistent generator with streamInput() and avoids
 * complex async coordination.
 */
function wrapSdkQuery(
  _initialQuery: SdkQuery | undefined,
  sdk: SdkModule,
  baseOptions: SdkQueryOptions,
  initialSessionId: string,
  usageCallback?: UsageCallback,
): SessionHandle {
  let sessionId = initialSessionId;
  const errorHandlers: Array<(error: Error) => void> = [];
  const endHandlers: Array<() => void> = [];
  let closed = false;

  /**
   * Build options for a per-turn query, adding resume for session continuity.
   */
  function turnOptions(): SdkQueryOptions {
    return { ...baseOptions, resume: sessionId };
  }

  /**
   * Notify error handlers. Called when a query throws during iteration.
   */
  function notifyError(error: Error): void {
    for (const handler of errorHandlers) {
      try {
        handler(error);
      } catch {
        // Error handler itself threw -- ignore to avoid cascading failures
      }
    }
  }

  return {
    get sessionId(): string {
      return sessionId;
    },

    async send(message: string): Promise<void> {
      if (closed) throw new Error(`Session ${sessionId} is closed`);
      try {
        const q = sdk.query({ prompt: message, options: turnOptions() });
        for await (const msg of q) {
          if (msg.type === "result") {
            if (msg.session_id) sessionId = msg.session_id;
            extractUsage(msg, usageCallback);
            break;
          }
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        notifyError(error);
        throw error;
      }
    },

    async sendAndCollect(message: string): Promise<string> {
      if (closed) throw new Error(`Session ${sessionId} is closed`);
      try {
        const q = sdk.query({ prompt: message, options: turnOptions() });
        const textParts: string[] = [];
        for await (const msg of q) {
          if (msg.type === "assistant") {
            if (typeof msg.content === "string" && msg.content.length > 0) {
              textParts.push(msg.content);
            }
          }
          if (msg.type === "result") {
            if (msg.session_id) sessionId = msg.session_id;
            extractUsage(msg, usageCallback);
            // Prefer the result.result field if non-empty
            if ("result" in msg && typeof msg.result === "string" && msg.result.length > 0) {
              return msg.result;
            }
            // Check for error results
            if (msg.subtype !== "success") {
              if ("is_error" in msg && msg.is_error) {
                throw new Error(`Agent error: ${msg.subtype}`);
              }
            }
            break;
          }
        }
        // Fall back to collected assistant text
        return textParts.join("\n");
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        notifyError(error);
        throw error;
      }
    },

    async sendAndStream(message: string, onChunk: (accumulated: string) => void): Promise<string> {
      if (closed) throw new Error(`Session ${sessionId} is closed`);
      try {
        const q = sdk.query({ prompt: message, options: turnOptions() });
        const textParts: string[] = [];
        for await (const msg of q) {
          if (msg.type === "assistant") {
            if (typeof msg.content === "string" && msg.content.length > 0) {
              textParts.push(msg.content);
              onChunk(textParts.join("\n"));
            }
          }
          if (msg.type === "result") {
            if (msg.session_id) sessionId = msg.session_id;
            extractUsage(msg, usageCallback);
            if ("result" in msg && typeof msg.result === "string" && msg.result.length > 0) {
              return msg.result;
            }
            if (msg.subtype !== "success") {
              if ("is_error" in msg && msg.is_error) {
                throw new Error(`Agent error: ${msg.subtype}`);
              }
            }
            break;
          }
        }
        return textParts.join("\n");
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        notifyError(error);
        throw error;
      }
    },

    async close(): Promise<void> {
      closed = true;
      for (const handler of endHandlers) {
        try {
          handler();
        } catch {
          // End handler threw -- ignore
        }
      }
    },

    onError(handler: (error: Error) => void): void {
      errorHandlers.push(handler);
    },

    onEnd(handler: () => void): void {
      endHandlers.push(handler);
    },
  };
}
