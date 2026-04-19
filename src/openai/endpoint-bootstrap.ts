/**
 * Phase 69 Plan 03 Task 3 — Daemon-integration bootstrap for the OpenAI endpoint.
 *
 * Exposes `startOpenAiEndpoint(deps, config)` — a self-contained helper that
 * the daemon (src/manager/daemon.ts) calls after SessionManager + ConversationStore
 * are ready. Factored out so tests can exercise boot ordering, env overrides,
 * EADDRINUSE handling, and shutdown semantics without booting the full daemon.
 *
 * Contract:
 *
 *   - Read `config.defaults.openai` (port/host/maxRequestBodyBytes/streamKeepaliveMs).
 *   - Honor `CLAWCODE_OPENAI_HOST` / `CLAWCODE_OPENAI_PORT` env overrides. `PORT`
 *     parses as integer; non-parseable → fall back to config value.
 *   - `config.defaults.openai.enabled === false` short-circuits: returns a
 *     disabled handle with a no-op `close()`. Logs `{enabled:false}`.
 *   - EADDRINUSE during `startOpenAiServer.listen()` is NON-FATAL: log warn +
 *     return a disabled handle. Daemon boot continues (mirrors dashboard pattern
 *     at src/manager/daemon.ts:1184-1189).
 *   - On clean start: return `OpenAiEndpointHandle` with `close()` that
 *     (1) iterates `activeStreams` and closes each, then (2) closes the server,
 *     then (3) closes `apiKeysStore` (Pitfall 10 — graceful shutdown).
 *
 * The helper constructs the ApiKeysStore + the OpenAiSessionDriver internally
 * so the daemon only has to provide the primitives (sessionManager,
 * turnDispatcher, agentNames function, log). This keeps daemon.ts diff minimal
 * and the unit-test surface tight.
 */

import { join } from "node:path";
import type { Logger } from "pino";

import { ApiKeysStore } from "./keys.js";
import { createOpenAiSessionDriver } from "./driver.js";
import { ApiKeySessionIndex } from "./session-index.js";
import type { SessionManager } from "../manager/session-manager.js";
import type { TurnDispatcher } from "../manager/turn-dispatcher.js";

/** Config block consumed by the helper — mirrors `openaiEndpointSchema`. */
export interface OpenAiEndpointConfig {
  readonly enabled: boolean;
  readonly port: number;
  readonly host: string;
  readonly maxRequestBodyBytes: number;
  readonly streamKeepaliveMs: number;
}

/** Dependency bag injected by daemon.ts. */
export interface OpenAiEndpointDeps {
  readonly managerDir: string;
  readonly sessionManager: SessionManager;
  readonly turnDispatcher: TurnDispatcher;
  readonly agentNames: () => ReadonlyArray<string>;
  readonly log: Logger;
  /**
   * Injected factory for `startOpenAiServer` — tests override to inject an
   * EADDRINUSE-throwing mock or a handle with observable close() order. The
   * default is the real `startOpenAiServer` from `./server.js`.
   */
  readonly startServer?: typeof import("./server.js").startOpenAiServer;
  /** Injected factory for ApiKeysStore — tests pass a `:memory:` path stub. */
  readonly apiKeysStoreFactory?: (dbPath: string) => ApiKeysStore;
}

/** Returned handle — `enabled:false` means startup was skipped or failed. */
export interface OpenAiEndpointHandle {
  readonly enabled: boolean;
  readonly port?: number;
  readonly host?: string;
  /**
   * Exposed so IPC / CLI handlers can reuse the already-opened store
   * without re-opening the SQLite file.
   */
  readonly apiKeysStore?: ApiKeysStore;
  close(): Promise<void>;
}

const NOOP_HANDLE: OpenAiEndpointHandle = {
  enabled: false,
  close: async () => {
    /* no-op */
  },
};

/**
 * Env-var override reader. `CLAWCODE_OPENAI_PORT` parses as integer; anything
 * non-integer (empty, NaN, negative, >65535) falls back to the config value.
 */
function resolveEnvOverrides(config: OpenAiEndpointConfig): {
  port: number;
  host: string;
} {
  const hostEnv = process.env.CLAWCODE_OPENAI_HOST;
  const host = hostEnv && hostEnv.length > 0 ? hostEnv : config.host;
  const portEnv = process.env.CLAWCODE_OPENAI_PORT;
  let port = config.port;
  if (portEnv) {
    const parsed = Number.parseInt(portEnv, 10);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) {
      port = parsed;
    }
  }
  return { port, host };
}

/** Detect EADDRINUSE across Node error surface shapes. */
function isAddrInUse(err: unknown): boolean {
  if (err && typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    if (code === "EADDRINUSE") return true;
    const message =
      (err as { message?: unknown }).message instanceof String ||
      typeof (err as { message?: unknown }).message === "string"
        ? String((err as { message: string }).message)
        : "";
    if (message.includes("EADDRINUSE")) return true;
  }
  return false;
}

/**
 * Start the OpenAI HTTP endpoint after SessionManager + ConversationStore are
 * ready. Returns a handle whose `close()` is safe to call during daemon
 * shutdown.
 */
export async function startOpenAiEndpoint(
  deps: OpenAiEndpointDeps,
  config: OpenAiEndpointConfig,
): Promise<OpenAiEndpointHandle> {
  const { log } = deps;

  if (!config.enabled) {
    log.info({ enabled: false }, "OpenAI endpoint disabled via config");
    return NOOP_HANDLE;
  }

  const { port, host } = resolveEnvOverrides(config);

  // Open the daemon-level api-keys store exactly once; close it on shutdown.
  const apiKeysPath = join(deps.managerDir, "api-keys.db");
  const apiKeysStore = deps.apiKeysStoreFactory
    ? deps.apiKeysStoreFactory(apiKeysPath)
    : new ApiKeysStore(apiKeysPath);

  // Build the production OpenAiSessionDriver using the real SessionManager.
  const driver = createOpenAiSessionDriver({
    sessionManager: deps.sessionManager,
    turnDispatcher: deps.turnDispatcher,
    sessionIndexFor: (agentName: string) => {
      const store = deps.sessionManager.getMemoryStore(agentName);
      if (!store) {
        throw new Error(
          `OpenAi endpoint: no MemoryStore for agent '${agentName}' — cannot build ApiKeySessionIndex`,
        );
      }
      return new ApiKeySessionIndex(store.getDatabase());
    },
    traceCollectorFor: (agentName: string) =>
      deps.sessionManager.getTraceCollector(agentName) ?? null,
    log,
  });

  const startServer = deps.startServer ?? (await import("./server.js")).startOpenAiServer;

  let handle: Awaited<ReturnType<typeof startServer>>;
  try {
    handle = await startServer({
      port,
      host,
      maxRequestBodyBytes: config.maxRequestBodyBytes,
      streamKeepaliveMs: config.streamKeepaliveMs,
      apiKeysStore,
      driver,
      agentNames: deps.agentNames,
      log,
    });
  } catch (err) {
    if (isAddrInUse(err)) {
      log.warn(
        { port, host, error: (err as Error).message },
        "OpenAI endpoint port in use — set CLAWCODE_OPENAI_PORT to a different port; continuing without endpoint",
      );
    } else {
      log.error(
        { port, host, error: (err as Error).message },
        "OpenAI endpoint failed to start — continuing without endpoint",
      );
    }
    // Keep apiKeysStore open? No — if the listener failed, close the store so
    // we don't leak the SQLite handle. CLI operations that need the store
    // will open it directly (the fallback path).
    try {
      apiKeysStore.close();
    } catch {
      /* non-fatal */
    }
    return NOOP_HANDLE;
  }

  log.info({ port: handle.address.port, host: handle.address.host }, "OpenAI endpoint started");

  return {
    enabled: true,
    port: handle.address.port,
    host: handle.address.host,
    apiKeysStore,
    close: async () => {
      // Pitfall 10 order: activeStreams first, then server, then store.
      try {
        await handle.close();
      } catch (err) {
        log.warn(
          { err: (err as Error).message },
          "OpenAI endpoint server close failed (non-fatal)",
        );
      }
      try {
        apiKeysStore.close();
      } catch (err) {
        log.warn(
          { err: (err as Error).message },
          "OpenAI endpoint api-keys-store close failed (non-fatal)",
        );
      }
    },
  };
}
