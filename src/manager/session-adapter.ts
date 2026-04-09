import type { AgentSessionConfig } from "./types.js";

/**
 * A handle to an active agent session.
 * Provides methods to interact with and monitor the session lifecycle.
 */
export type SessionHandle = {
  readonly sessionId: string;
  send(message: string): Promise<void>;
  close(): Promise<void>;
  onError(handler: (error: Error) => void): void;
  onEnd(handler: () => void): void;
};

/**
 * Interface for creating and resuming agent sessions.
 * Abstracts the underlying SDK so that tests can use MockSessionAdapter
 * and production uses SdkSessionAdapter.
 */
export type SessionAdapter = {
  createSession(config: AgentSessionConfig): Promise<SessionHandle>;
  resumeSession(sessionId: string, config: AgentSessionConfig): Promise<SessionHandle>;
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
  private counter = 0;

  async createSession(config: AgentSessionConfig): Promise<SessionHandle> {
    this.counter += 1;
    const sessionId = `mock-${config.name}-${this.counter}`;
    const handle = new MockSessionHandle(sessionId);
    this.sessions.set(sessionId, handle);
    return handle;
  }

  async resumeSession(
    sessionId: string,
    config: AgentSessionConfig,
  ): Promise<SessionHandle> {
    const existing = this.sessions.get(sessionId);
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
  async createSession(config: AgentSessionConfig): Promise<SessionHandle> {
    const sdk = await loadSdk();
    const session = await sdk.unstable_v2_createSession({
      model: config.model,
      cwd: config.workspace,
      systemPrompt: config.systemPrompt,
      permissionMode: "bypassPermissions",
    });
    return wrapSdkSession(session);
  }

  async resumeSession(
    sessionId: string,
    config: AgentSessionConfig,
  ): Promise<SessionHandle> {
    const sdk = await loadSdk();
    const session = await sdk.unstable_v2_resumeSession(sessionId, {
      model: config.model,
      cwd: config.workspace,
      systemPrompt: config.systemPrompt,
      permissionMode: "bypassPermissions",
    });
    return wrapSdkSession(session);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SdkModule = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SdkSession = any;

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
    // @ts-expect-error -- SDK installed in Plan 02
    cachedSdk = await import("@anthropic-ai/claude-agent-sdk");
    return cachedSdk;
  } catch {
    throw new Error(
      "Claude Agent SDK is not installed. Run: npm install @anthropic-ai/claude-agent-sdk",
    );
  }
}

/**
 * Wrap an SDK session object into a SessionHandle.
 */
function wrapSdkSession(session: SdkSession): SessionHandle {
  return {
    sessionId: session.sessionId ?? session.id ?? "unknown",
    async send(message: string): Promise<void> {
      await session.send(message);
    },
    async close(): Promise<void> {
      if (typeof session.close === "function") {
        await session.close();
      }
    },
    onError(handler: (error: Error) => void): void {
      if (typeof session.on === "function") {
        session.on("error", handler);
      }
    },
    onEnd(handler: () => void): void {
      if (typeof session.on === "function") {
        session.on("end", handler);
      }
    },
  };
}
