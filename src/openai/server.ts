/**
 * Phase 69 Plan 02 — OpenAI-compatible HTTP server on node:http.
 *
 * Routes:
 *   OPTIONS *                      → 204 + CORS preflight headers.
 *   GET     /v1/models             → list of top-level agents as OpenAI models
 *                                    (no auth — fleet listing is public per
 *                                    CONTEXT "all configured agents appear
 *                                    regardless of key permissions").
 *   POST    /v1/chat/completions   → JSON or SSE completion, bearer-auth.
 *   *                              → 404 OpenAI-shape error.
 *
 * Dependencies are INJECTED via `OpenAiServerConfig`:
 *   - `apiKeysStore`      — from Plan 01 (src/openai/keys.ts)
 *   - `driver`            — an `OpenAiSessionDriver` impl (Plan 03 wires real)
 *   - `agentNames`        — a function returning top-level agent names
 *
 * Zero imports from src/manager/, src/memory/, src/config/ — this module is
 * fully unit-testable in vitest with a :memory: ApiKeysStore and a mock driver.
 *
 * Pitfalls guarded here (see 69-RESEARCH.md):
 *   - Pitfall 2: OpenAI error shape on every 4xx/5xx.
 *   - Pitfall 4/5: SSE framing delegated to stream.ts which sets the right
 *     headers + double-newline terminator.
 *   - Pitfall 6: bearer-key extraction hashes via ApiKeysStore (timing-safe
 *     lookup lives in Plan 01's keys.ts).
 *   - Pitfall 8: translator.ts emits `clientSystemAppend` — we forward it
 *     verbatim to the driver as the systemPrompt APPEND field (NEVER override).
 *   - Pitfall 9: Content-Type check via .toLowerCase().startsWith()
 *     (charset-tolerant).
 *   - Pitfall 10: graceful-shutdown loop — `activeStreams` Set is closed
 *     BEFORE `server.close()`.
 */

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { nanoid } from "nanoid";
import pino, { type Logger } from "pino";

import type { ApiKeysStore } from "./keys.js";
import {
  chatCompletionRequestSchema,
  type ChatCompletionRequest,
  type ChatCompletionToolCall,
  type ClaudeToolChoice,
  type ClaudeToolDef,
  type ClaudeToolResultBlock,
  type ModelsListResponse,
  type OpenAiError,
  type SdkStreamEvent,
} from "./types.js";
import {
  NoUserMessageError,
  createStreamingTranslator,
  makeNonStreamResponse,
  newChatCompletionId,
  translateClaudeToolUseToOpenAi,
  translateRequest,
} from "./translator.js";
import { startOpenAiSse, type OpenAiSseHandle } from "./stream.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Contract for the session driver the server delegates turn execution to.
 * Plan 03 implements this over SessionManager + ConversationStore. Plan 02
 * tests pass a fixture-based mock that replays recorded SDK events.
 */
export interface OpenAiSessionDriver {
  /**
   * Open a session for the bearer key / agent pair and stream SDK events.
   * Caller provides an AbortSignal; when aborted the driver must stop the
   * underlying query promptly.
   */
  dispatch(input: {
    agentName: string;
    keyHash: string;
    lastUserMessage: string;
    clientSystemAppend: string | null;
    tools: ClaudeToolDef[] | null;
    toolChoice: ClaudeToolChoice | null;
    toolResults: ClaudeToolResultBlock[];
    signal: AbortSignal;
    xRequestId: string;
  }): AsyncIterable<SdkStreamEvent>;
}

/** Configuration for `startOpenAiServer`. Every dependency is injected. */
export interface OpenAiServerConfig {
  port: number;
  host: string;
  maxRequestBodyBytes: number;
  streamKeepaliveMs: number;
  apiKeysStore: ApiKeysStore;
  driver: OpenAiSessionDriver;
  /** Returns the full list of agent names currently configured. */
  agentNames: () => ReadonlyArray<string>;
  /** Optional logger — defaults to a pino child when absent. */
  log?: Logger;
  /**
   * Post-v2.0 hardening — boolean readiness probe for warm-path startup race.
   * Production wires this to `SessionManager.isRunning.bind(sessionManager)`.
   * When absent (test harness path), the wait gate is disabled and the handler
   * dispatches immediately (preserves Plan 02 hermetic tests).
   */
  agentIsRunning?: (agentName: string) => boolean;
  /**
   * Phase 73 Plan 02 — max wait before 503 Retry-After on warm-path race.
   * Default 300ms (tuned down from 2000ms post-persistent-subprocess).
   * Tests override to 50–200ms for speed. Override at runtime via
   * CLAWCODE_OPENAI_READINESS_WAIT_MS env var (see endpoint-bootstrap.ts).
   */
  agentReadinessWaitMs?: number;
  /**
   * Post-v2.0 hardening — poll cadence during the readiness wait window.
   * Default 50ms.
   */
  agentReadinessPollIntervalMs?: number;
}

/** Handle returned by `startOpenAiServer`. */
export interface OpenAiServerHandle {
  readonly server: ReturnType<typeof createServer>;
  readonly activeStreams: Set<OpenAiSseHandle>;
  readonly address: { port: number; host: string };
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// CORS + error helpers
// ---------------------------------------------------------------------------

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-request-id",
  "Access-Control-Expose-Headers": "x-request-id",
};

/** Build a typed OpenAI error body + status pair (exported for tests). */
export function buildOpenAiError(
  status: number,
  type: OpenAiError["error"]["type"],
  message: string,
  code: string | null = null,
): { status: number; body: OpenAiError } {
  return {
    status,
    body: { error: { message, type, code } },
  };
}

function applyCorsAndXrid(
  res: ServerResponse,
  extra: Record<string, string> = {},
  xRequestId?: string,
): Record<string, string> {
  const headers: Record<string, string> = { ...CORS_HEADERS, ...extra };
  if (xRequestId) headers["x-request-id"] = xRequestId;
  return headers;
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  xRequestId?: string,
  extraHeaders?: Record<string, string>,
): void {
  if (res.writableEnded) return;
  const payload = JSON.stringify(body);
  const headers = applyCorsAndXrid(
    res,
    {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(payload).toString(),
      ...(extraHeaders ?? {}),
    },
    xRequestId,
  );
  res.writeHead(status, headers);
  res.end(payload);
}

function sendError(
  res: ServerResponse,
  status: number,
  type: OpenAiError["error"]["type"],
  message: string,
  code: string | null = null,
  xRequestId?: string,
  extraHeaders?: Record<string, string>,
): void {
  const { body } = buildOpenAiError(status, type, message, code);
  sendJson(res, status, body, xRequestId, extraHeaders);
}

/**
 * Post-v2.0 hardening — bounded poll on `isRunning(agentName)` for the
 * warm-path startup race. Resolves `true` as soon as the probe flips, or
 * `false` when `waitMs` elapses.
 *
 * Pure — takes `isRunning` as a fn param so tests can drive the gate without
 * booting a real SessionManager.
 */
async function waitForAgentReady(
  agentName: string,
  isRunning: (name: string) => boolean,
  waitMs: number,
  pollMs: number,
): Promise<boolean> {
  if (isRunning(agentName)) return true;
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    if (isRunning(agentName)) return true;
  }
  return false;
}

/**
 * Post-v2.0 hardening — shared 503 emitter used by the pre-dispatch gate AND
 * the defensive `SessionError not-running` catch in `runNonStreaming`.
 * Keeps the error envelope and Retry-After header consistent in one place.
 */
function sendAgentWarming(
  res: ServerResponse,
  xRequestId?: string,
): void {
  sendError(
    res,
    503,
    "server_error",
    "Agent warming up, retry shortly",
    "agent_warming",
    xRequestId,
    { "Retry-After": "2" },
  );
}

/**
 * Post-v2.0 hardening — classifier for the warm-path defensive catch.
 * Uses `.name === "SessionError"` (not `instanceof`) so session-manager module
 * duplication across build boundaries does not defeat the check.
 */
function isSessionNotRunningError(err: unknown): boolean {
  return (
    err instanceof Error &&
    err.name === "SessionError" &&
    err.message.includes(" is not running")
  );
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

/** Extract x-request-id header, or generate a fresh nanoid(16). */
function resolveXRequestId(req: IncomingMessage): string {
  const existing = req.headers["x-request-id"];
  if (typeof existing === "string" && existing.length > 0 && existing.length <= 256) {
    return existing;
  }
  if (Array.isArray(existing) && existing[0]) return existing[0];
  return nanoid(16);
}

/** Content-Type check (Pitfall 9 — charset-tolerant). */
function isJsonContentType(req: IncomingMessage): boolean {
  const ct = req.headers["content-type"];
  if (typeof ct !== "string") return false;
  return ct.toLowerCase().startsWith("application/json");
}

/** Read request body with a hard byte cap; rejects with `BodyTooLarge` when exceeded. */
class BodyTooLargeError extends Error {
  constructor(public readonly limit: number) {
    super(`request body exceeded ${limit} bytes`);
    this.name = "BodyTooLargeError";
  }
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const onData = (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        cleanup();
        // Pause the stream but do NOT destroy the socket — the caller needs
        // a live response to send the 413 error body. The caller is
        // responsible for draining any further data from the source (we drop
        // bytes on the floor via the unregistered data handler).
        req.pause();
        reject(new BodyTooLargeError(maxBytes));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks));
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
    };
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}

/** Extract the bearer key from `Authorization: Bearer <key>`. Returns null on miss. */
function extractBearer(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (typeof auth !== "string") return null;
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const key = auth.slice(7).trim();
  return key.length > 0 ? key : null;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/** Filter out sub/thread agents; return the top-level fleet. */
function topLevelAgents(names: ReadonlyArray<string>): ReadonlyArray<string> {
  return names.filter((n) => !n.includes("-sub-") && !n.includes("-thread-"));
}

function handleOptions(res: ServerResponse, xRequestId: string): void {
  res.writeHead(204, applyCorsAndXrid(res, {}, xRequestId));
  res.end();
}

function handleModels(
  res: ServerResponse,
  config: OpenAiServerConfig,
  xRequestId: string,
  bootEpochSeconds: number,
): void {
  const agents = topLevelAgents(config.agentNames());
  const body: ModelsListResponse = {
    object: "list",
    data: agents.map((id) => ({
      id,
      object: "model",
      created: bootEpochSeconds,
      owned_by: "clawcode",
    })),
  };
  sendJson(res, 200, body, xRequestId);
}

async function handleChatCompletions(
  req: IncomingMessage,
  res: ServerResponse,
  config: OpenAiServerConfig,
  activeStreams: Set<OpenAiSseHandle>,
  xRequestId: string,
  log: Logger,
): Promise<void> {
  // 1. Content-Type (Pitfall 9).
  if (!isJsonContentType(req)) {
    sendError(
      res,
      400,
      "invalid_request_error",
      "Content-Type must be application/json",
      "invalid_content_type",
      xRequestId,
    );
    return;
  }

  // 2. Auth — bearer key required.
  const bearer = extractBearer(req);
  if (bearer === null) {
    sendError(
      res,
      401,
      "authentication_error",
      "Missing bearer token in Authorization header",
      "missing_key",
      xRequestId,
    );
    return;
  }
  const row = config.apiKeysStore.lookupByIncomingKey(bearer);
  if (row === null) {
    sendError(
      res,
      401,
      "authentication_error",
      "Invalid or revoked API key",
      "invalid_key",
      xRequestId,
    );
    return;
  }

  // 3. Body read + parse.
  let raw: Buffer;
  try {
    raw = await readBody(req, config.maxRequestBodyBytes);
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      sendError(
        res,
        413,
        "invalid_request_error",
        "Request body too large",
        "body_too_large",
        xRequestId,
      );
      return;
    }
    sendError(
      res,
      400,
      "invalid_request_error",
      "Failed to read request body",
      "body_read_error",
      xRequestId,
    );
    return;
  }

  let bodyJson: unknown;
  try {
    bodyJson = JSON.parse(raw.toString("utf8"));
  } catch {
    sendError(
      res,
      400,
      "invalid_request_error",
      "Request body is not valid JSON",
      "body_parse_error",
      xRequestId,
    );
    return;
  }

  const parseResult = chatCompletionRequestSchema.safeParse(bodyJson);
  if (!parseResult.success) {
    sendError(
      res,
      400,
      "invalid_request_error",
      `Invalid request body: ${parseResult.error.issues.map((i) => i.message).join("; ")}`,
      "body_validation_error",
      xRequestId,
    );
    return;
  }
  const body = parseResult.data as ChatCompletionRequest;

  // 4. Model-to-key pinning. CONTEXT.md: "never leak agent name".
  if (row.agent_name !== body.model) {
    sendError(
      res,
      403,
      "permission_error",
      "API key is not authorized for the requested model",
      "agent_mismatch",
      xRequestId,
    );
    return;
  }

  // 4b. Post-v2.0 hardening — warm-path startup race gate.
  // When `agentIsRunning` is provided (production path), bound the wait on
  // the agent becoming ready before dispatching. Plan 02 tests omit the
  // config field and skip the wait entirely — hermetic path preserved.
  if (config.agentIsRunning) {
    const ready = await waitForAgentReady(
      row.agent_name,
      config.agentIsRunning,
      config.agentReadinessWaitMs ?? 300,
      config.agentReadinessPollIntervalMs ?? 50,
    );
    if (!ready) {
      sendAgentWarming(res, xRequestId);
      return;
    }
  }

  // Fire-and-forget last-used stamp.
  try {
    config.apiKeysStore.touchLastUsed(row.key_hash);
  } catch (err) {
    log.debug({ err }, "touchLastUsed failed (non-fatal)");
  }

  // 5. Translate OpenAI request → Claude inputs.
  let translated;
  try {
    translated = translateRequest(body);
  } catch (err) {
    if (err instanceof NoUserMessageError) {
      sendError(
        res,
        400,
        "invalid_request_error",
        "messages[] must contain at least one role:'user' entry",
        "no_user_message",
        xRequestId,
      );
      return;
    }
    sendError(
      res,
      400,
      "invalid_request_error",
      "Failed to translate request",
      "translate_error",
      xRequestId,
    );
    return;
  }

  // 6. Open AbortController for client-disconnect + shutdown.
  const ac = new AbortController();
  const onClientClose = (): void => {
    // Fire abort on every `close` event from the request. Guarding on
    // res.writableEnded is wrong for SSE: the response remains writable
    // (writableEnded === false) throughout the stream, so every real
    // client-close should always flow through to ac.abort(). If the
    // response is already ended cleanly via emitDone(), abort() on an
    // already-settled AC is a no-op.
    ac.abort();
  };
  req.on("close", onClientClose);
  res.on("close", onClientClose);

  // 7. Dispatch + branch on stream vs non-stream.
  const turnId = newChatCompletionId();
  const driverInput = {
    agentName: row.agent_name,
    keyHash: row.key_hash,
    lastUserMessage: translated.lastUserMessage,
    clientSystemAppend: translated.clientSystemAppend,
    tools: translated.tools,
    toolChoice: translated.toolChoice,
    toolResults: translated.toolResults,
    signal: ac.signal,
    xRequestId,
  };

  if (body.stream) {
    // Post-v2.0 hardening — honor stream_options.include_usage when present.
    const streamIncludeUsage = body.stream_options?.include_usage === true;
    await runStreaming(
      res,
      config,
      activeStreams,
      body.model,
      turnId,
      driverInput,
      streamIncludeUsage,
      xRequestId,
      log,
    );
    return;
  }

  await runNonStreaming(res, body.model, turnId, driverInput, config, xRequestId, log);
}

/**
 * Non-streaming path: drain the driver to completion, then emit a single
 * `chat.completion` response body. The translator accumulates `collectedText`
 * and `collectedToolCalls` as the stream replays so we can build the final
 * response without a second pass.
 */
async function runNonStreaming(
  res: ServerResponse,
  model: string,
  turnId: string,
  driverInput: Parameters<OpenAiSessionDriver["dispatch"]>[0],
  config: OpenAiServerConfig,
  xRequestId: string,
  log: Logger,
): Promise<void> {
  const translator = createStreamingTranslator({ id: turnId, model });
  try {
    for await (const event of config.driver.dispatch(driverInput)) {
      translator.onEvent(event);
    }
  } catch (err) {
    // Post-v2.0 hardening — defensive belt-and-suspenders: if the driver
    // somehow throws SessionError("not running") after the pre-dispatch
    // gate (race, no gate configured, etc.), surface a clean 503 rather
    // than the generic 500 driver_error. OpenAI clients can't distinguish
    // a transient warm-path miss from a permanent failure otherwise.
    if (isSessionNotRunningError(err)) {
      sendAgentWarming(res, xRequestId);
      return;
    }
    log.warn({ err }, "driver failed on non-stream path");
    sendError(
      res,
      500,
      "server_error",
      "Driver failed to produce a response",
      "driver_error",
      xRequestId,
    );
    return;
  }

  const toolCalls: ReadonlyArray<ChatCompletionToolCall> = translator.collectedToolCalls;
  const response = makeNonStreamResponse({
    id: turnId,
    model,
    text: translator.collectedText,
    toolCalls,
    usage: translator.usage,
  });
  sendJson(res, 200, response, xRequestId);
}

/**
 * Streaming path: wrap `res` via `startOpenAiSse`, drive the translator event
 * by event, emit each chunk. On driver error mid-stream, call `emitError` so
 * the client sees a clean termination. Register/deregister on the
 * activeStreams set so the shutdown hook can close in-flight connections.
 *
 * Post-v2.0 hardening note — the primary warm-path guard is the
 * `waitForAgentReady` gate in `handleChatCompletions` (pre-dispatch, before
 * SSE headers are committed). By the time we're in `runStreaming`, SSE is
 * open and any `SessionError not-running` surfaces through the in-stream
 * `emitError` envelope with `agent_warming` code rather than a clean 503.
 * Keeping SSE headers committed immediately is required so keepalive pings
 * can start before the first driver event (see the keepalive test).
 */
async function runStreaming(
  res: ServerResponse,
  config: OpenAiServerConfig,
  activeStreams: Set<OpenAiSseHandle>,
  model: string,
  turnId: string,
  driverInput: Parameters<OpenAiSessionDriver["dispatch"]>[0],
  streamIncludeUsage: boolean,
  xRequestId: string,
  log: Logger,
): Promise<void> {
  // SSE headers need x-request-id too; startOpenAiSse writes its own
  // writeHead call, but we inject the x-request-id here by setting it on the
  // response before write occurs. node:http allows setHeader prior to
  // writeHead.
  res.setHeader("x-request-id", xRequestId);
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    res.setHeader(k, v);
  }

  const handle = startOpenAiSse(res, { keepaliveMs: config.streamKeepaliveMs });
  activeStreams.add(handle);
  handle.onClose(() => {
    activeStreams.delete(handle);
  });

  const translator = createStreamingTranslator({ id: turnId, model });
  try {
    for await (const event of config.driver.dispatch(driverInput)) {
      const chunks = translator.onEvent(event);
      for (const c of chunks) {
        const ok = await handle.emit(c);
        if (!ok) {
          // Client disconnected — abort driver iteration.
          return;
        }
      }
    }
    const finals = translator.finalize({ includeUsage: streamIncludeUsage });
    for (const c of finals) {
      await handle.emit(c);
    }
    handle.emitDone();
  } catch (err) {
    // Post-v2.0 hardening — if the driver slipped past the pre-dispatch
    // gate and threw SessionError("not running"), surface the warm-path
    // signal through the in-stream error envelope rather than generic
    // driver_error. Headers are already committed at this point, so we
    // can't write a 503 cleanly — but the `agent_warming` code in the
    // OpenAI error envelope still tells the client this is retryable.
    if (isSessionNotRunningError(err)) {
      log.warn({ err }, "driver SessionError not-running mid-stream (post-gate race)");
      handle.emitError({
        error: {
          message: "Agent warming up, retry shortly",
          type: "server_error",
          code: "agent_warming",
        },
      });
    } else {
      log.warn({ err }, "driver failed mid-stream");
      handle.emitError({
        error: {
          message: "Driver failed mid-stream",
          type: "server_error",
          code: "driver_error",
        },
      });
    }
  } finally {
    activeStreams.delete(handle);
  }
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

/**
 * Start the OpenAI HTTP listener. Returns a handle with `close()` that
 * gracefully ends all active SSE streams before closing the server (Pitfall 10).
 *
 * `port: 0` instructs the OS to choose a free ephemeral port — tests use this.
 */
export async function startOpenAiServer(
  config: OpenAiServerConfig,
): Promise<OpenAiServerHandle> {
  const log = config.log ?? pino({ name: "openai-endpoint", level: "info" });
  const bootEpochSeconds = Math.floor(Date.now() / 1000);
  const activeStreams = new Set<OpenAiSseHandle>();

  const server = createServer((req, res) => {
    const xRequestId = resolveXRequestId(req);
    void route(req, res, config, activeStreams, xRequestId, bootEpochSeconds, log);
  });

  return new Promise<OpenAiServerHandle>((resolve, reject) => {
    const onError = (err: Error) => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.off("error", onError);
      const addr = server.address();
      const boundPort =
        typeof addr === "object" && addr ? addr.port : config.port;
      log.info({ port: boundPort, host: config.host }, "OpenAI endpoint started");
      resolve({
        server,
        activeStreams,
        address: { port: boundPort, host: config.host },
        close: async () => {
          // Pitfall 10: close all active streams FIRST.
          for (const h of activeStreams) {
            try {
              h.close();
            } catch {
              // ignore
            }
          }
          activeStreams.clear();
          await new Promise<void>((r) => server.close(() => r()));
        },
      });
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(config.port, config.host);
  });
}

/**
 * Top-level request router. Exported as `route` at module scope so the
 * handler functions stay small and composable.
 */
async function route(
  req: IncomingMessage,
  res: ServerResponse,
  config: OpenAiServerConfig,
  activeStreams: Set<OpenAiSseHandle>,
  xRequestId: string,
  bootEpochSeconds: number,
  log: Logger,
): Promise<void> {
  try {
    const method = req.method ?? "GET";
    const url = (req.url ?? "/").split("?")[0] ?? "/";

    if (method === "OPTIONS") {
      handleOptions(res, xRequestId);
      return;
    }

    if (method === "GET" && url === "/v1/models") {
      handleModels(res, config, xRequestId, bootEpochSeconds);
      return;
    }

    if (method === "POST" && url === "/v1/chat/completions") {
      await handleChatCompletions(req, res, config, activeStreams, xRequestId, log);
      return;
    }

    sendError(res, 404, "not_found_error", "Not Found", "route_not_found", xRequestId);
  } catch (err) {
    log.error({ err }, "unhandled error in openai route");
    if (!res.writableEnded) {
      sendError(
        res,
        500,
        "server_error",
        "Internal Server Error",
        "unhandled_error",
        xRequestId,
      );
    }
  }
}
