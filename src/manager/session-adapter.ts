import type { AgentSessionConfig } from "./types.js";
import type { SdkModule, SdkSession, SdkStreamMessage } from "./sdk-types.js";

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
// SDK implementation (real adapter)
// ---------------------------------------------------------------------------

/**
 * SessionAdapter backed by the Claude Agent SDK V2 unstable API.
 * Uses dynamic imports so the file compiles even without the SDK installed.
 *
 * SDK installed in Plan 02.
 */
export class SdkSessionAdapter implements SessionAdapter {
  async createSession(config: AgentSessionConfig, usageCallback?: UsageCallback): Promise<SessionHandle> {
    const sdk = await loadSdk();
    const session = await sdk.unstable_v2_createSession({
      model: config.model,
      cwd: config.workspace,
      systemPrompt: config.systemPrompt,
      permissionMode: "bypassPermissions",
    });
    return wrapSdkSession(session, usageCallback);
  }

  async resumeSession(
    sessionId: string,
    config: AgentSessionConfig,
    usageCallback?: UsageCallback,
  ): Promise<SessionHandle> {
    const sdk = await loadSdk();
    const session = await sdk.unstable_v2_resumeSession(sessionId, {
      model: config.model,
      cwd: config.workspace,
      systemPrompt: config.systemPrompt,
      permissionMode: "bypassPermissions",
    });
    return wrapSdkSession(session, usageCallback);
  }
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
 * Safely extract session ID from an SDK session object.
 * The V2 unstable API may not have sessionId available immediately —
 * it becomes available after the first message exchange.
 */
function getSdkSessionId(session: SdkSession): string {
  try {
    return session.sessionId ?? session.id ?? `pending-${Date.now()}`;
  } catch {
    return `pending-${Date.now()}`;
  }
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
 * Wrap an SDK session object into a SessionHandle.
 */
function wrapSdkSession(session: SdkSession, usageCallback?: UsageCallback): SessionHandle {
  return {
    get sessionId(): string {
      return getSdkSessionId(session);
    },
    async send(message: string): Promise<void> {
      // Enqueue message and drain stream to drive the agent's turn.
      // The SDK requires stream() consumption for the agent to process
      // the message and execute tool calls.
      session.send(message);
      if (typeof session.stream === "function") {
        for await (const msg of session.stream()) {
          if (msg.type === "result") {
            extractUsage(msg, usageCallback);
            break;
          }
        }
      }
    },
    async sendAndCollect(message: string): Promise<string> {
      // Enqueue message and drain stream, collecting the text result.
      session.send(message);
      if (typeof session.stream !== "function") {
        return "";
      }
      // Collect assistant text blocks as they stream, since the final
      // result.result may be empty for tool-use-only turns.
      const textParts: string[] = [];
      for await (const msg of session.stream()) {
        // Capture assistant text messages as they arrive
        if (msg.type === "assistant") {
          if (typeof msg.content === "string" && msg.content.length > 0) {
            textParts.push(msg.content);
          }
        }
        if (msg.type === "result") {
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
    },
    async sendAndStream(message: string, onChunk: (accumulated: string) => void): Promise<string> {
      // Like sendAndCollect, but calls onChunk with accumulated text as it streams.
      session.send(message);
      if (typeof session.stream !== "function") {
        return "";
      }
      const textParts: string[] = [];
      for await (const msg of session.stream()) {
        if (msg.type === "assistant") {
          if (typeof msg.content === "string" && msg.content.length > 0) {
            textParts.push(msg.content);
            onChunk(textParts.join("\n"));
          }
        }
        if (msg.type === "result") {
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
    },
    async close(): Promise<void> {
      if (typeof session.close === "function") {
        await session.close();
      }
    },
    onError(handler: (error: Error) => void): void {
      if (typeof session.on === "function") {
        session.on("error", handler as (...args: unknown[]) => unknown);
      }
    },
    onEnd(handler: () => void): void {
      if (typeof session.on === "function") {
        session.on("end", handler as (...args: unknown[]) => unknown);
      }
    },
  };
}
