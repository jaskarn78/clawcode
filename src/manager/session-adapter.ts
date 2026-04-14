import type { AgentSessionConfig } from "./types.js";
import type { SdkModule, SdkQueryOptions, SdkQuery, SdkStreamMessage } from "./sdk-types.js";
import { resolveModelId } from "./model-resolver.js";
import type { Turn, Span } from "../performance/trace-collector.js";
import {
  type SkillUsageTracker,
  extractSkillMentions,
} from "../usage/skill-usage-tracker.js";

/**
 * Phase 52 Plan 02 — per-turn prefixHash provider contract.
 *
 * SessionManager constructs this closure and attaches it to the handle via
 * `TracedSessionHandleOptions.prefixHashProvider`. On every turn inside
 * `iterateWithTracing`, the adapter calls `.get()` to read the current
 * stablePrefix hash AND the prior turn's hash for the same agent, computes
 * `cacheEvictionExpected = current !== last` (false on first turn), then
 * calls `.persist(currentHash)` so the NEXT turn can compare.
 *
 * The provider exists so the adapter stays framework-agnostic: tests pass a
 * plain object; production wires SessionManager's per-agent maps.
 *
 * Observational contract: provider errors are swallowed inside the adapter.
 * Cache observability MUST NEVER break the parent message path.
 */
export type PrefixHashProvider = {
  get(): { current: string; last: string | undefined };
  persist(hash: string): void;
};

/**
 * Phase 53 Plan 03 — per-turn skill-mention capture wiring.
 *
 * Threaded into the adapter so `iterateWithTracing` can record which
 * skills appear in the assistant text + user text per turn. Lives on
 * the handle options (not global state) so tests can pass stubs and
 * SessionManager owns the tracker lifecycle.
 *
 * Observational contract (Phase 50 invariant): any error raised by
 * the tracker is silent-swallowed. Skill-tracking MUST NEVER break
 * the parent message path.
 */
export type SkillTrackingConfig = {
  readonly skillUsageTracker: SkillUsageTracker;
  readonly agentName: string;
  readonly skillCatalogNames: readonly string[];
};

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
 *
 * Phase 50 (50-02): send/sendAndCollect/sendAndStream accept an OPTIONAL
 * caller-owned Turn parameter. When provided, the handle opens per-turn
 * tracing spans (end_to_end, first_token, tool_call.<name>) inside the SDK
 * iteration loop. The handle NEVER calls `turn.end()` — turn lifecycle is
 * caller-owned (DiscordBridge / Scheduler, wired in 50-02b).
 */
export type SessionHandle = {
  readonly sessionId: string;
  send: (message: string, turn?: Turn) => Promise<void>;
  sendAndCollect: (message: string, turn?: Turn) => Promise<string>;
  sendAndStream: (message: string, onChunk: (accumulated: string) => void, turn?: Turn) => Promise<string>;
  close: () => Promise<void>;
  onError: (handler: (error: Error) => void) => void;
  onEnd: (handler: () => void) => void;
  setEffort: (level: "low" | "medium" | "high" | "max") => void;
  getEffort: () => "low" | "medium" | "high" | "max";
};

/**
 * Interface for creating and resuming agent sessions.
 * Abstracts the underlying SDK so that tests can use MockSessionAdapter
 * and production uses SdkSessionAdapter.
 *
 * Phase 52 Plan 02 — optional `prefixHashProvider` threads per-agent
 * prefix-hash state from SessionManager into the handle's per-turn
 * iteration loop so CACHE-04 eviction detection can fire. Mocks ignore it.
 */
export type SessionAdapter = {
  createSession(
    config: AgentSessionConfig,
    usageCallback?: UsageCallback,
    prefixHashProvider?: PrefixHashProvider,
    skillTracking?: SkillTrackingConfig,
  ): Promise<SessionHandle>;
  resumeSession(
    sessionId: string,
    config: AgentSessionConfig,
    usageCallback?: UsageCallback,
    prefixHashProvider?: PrefixHashProvider,
    skillTracking?: SkillTrackingConfig,
  ): Promise<SessionHandle>;
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
  private effort: "low" | "medium" | "high" | "max" = "low";

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  async send(_message: string, _turn?: Turn): Promise<void> {
    if (this.closed) {
      throw new Error(`Session ${this.sessionId} is closed`);
    }
  }

  async sendAndCollect(_message: string, _turn?: Turn): Promise<string> {
    if (this.closed) {
      throw new Error(`Session ${this.sessionId} is closed`);
    }
    return `Mock response from ${this.sessionId}`;
  }

  async sendAndStream(
    _message: string,
    onChunk: (accumulated: string) => void,
    _turn?: Turn,
  ): Promise<string> {
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

  setEffort(level: "low" | "medium" | "high" | "max"): void {
    this.effort = level;
  }

  getEffort(): "low" | "medium" | "high" | "max" {
    return this.effort;
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
  readonly prefixHashProviders: Map<string, PrefixHashProvider> = new Map();
  readonly skillTrackingConfigs: Map<string, SkillTrackingConfig> = new Map();
  private counter = 0;

  async createSession(
    config: AgentSessionConfig,
    usageCallback?: UsageCallback,
    prefixHashProvider?: PrefixHashProvider,
    skillTracking?: SkillTrackingConfig,
  ): Promise<SessionHandle> {
    this.counter += 1;
    const sessionId = `mock-${config.name}-${this.counter}`;
    const handle = new MockSessionHandle(sessionId);
    this.sessions.set(sessionId, handle);
    if (usageCallback) {
      this.usageCallbacks.set(sessionId, usageCallback);
    }
    if (prefixHashProvider) {
      this.prefixHashProviders.set(sessionId, prefixHashProvider);
    }
    if (skillTracking) {
      this.skillTrackingConfigs.set(sessionId, skillTracking);
    }
    return handle;
  }

  async resumeSession(
    sessionId: string,
    config: AgentSessionConfig,
    usageCallback?: UsageCallback,
    prefixHashProvider?: PrefixHashProvider,
    skillTracking?: SkillTrackingConfig,
  ): Promise<SessionHandle> {
    const existing = this.sessions.get(sessionId);
    if (usageCallback) {
      this.usageCallbacks.set(sessionId, usageCallback);
    }
    if (prefixHashProvider) {
      this.prefixHashProviders.set(sessionId, prefixHashProvider);
    }
    if (skillTracking) {
      this.skillTrackingConfigs.set(sessionId, skillTracking);
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
  return rest;
}

/**
 * Phase 52 Plan 02 — construct the SDK preset+append systemPrompt option.
 *
 * Always emits `{ type: "preset", preset: "claude_code" }` so the SDK's
 * claude_code preset scaffolds automatic caching. When the stable prefix is
 * non-empty, it is appended verbatim via the `append` key.
 *
 * Exported for tests + external callers; internal callers (createSession /
 * resumeSession) use it below. NEVER replace with a raw `string` systemPrompt —
 * that loses the preset's cache scaffolding (CONTEXT D-01 LOCKED).
 */
export function buildSystemPromptOption(
  stablePrefix: string,
):
  | { readonly type: "preset"; readonly preset: "claude_code"; readonly append: string }
  | { readonly type: "preset"; readonly preset: "claude_code" } {
  if (stablePrefix.length > 0) {
    return { type: "preset" as const, preset: "claude_code" as const, append: stablePrefix };
  }
  return { type: "preset" as const, preset: "claude_code" as const };
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
  async createSession(
    config: AgentSessionConfig,
    usageCallback?: UsageCallback,
    prefixHashProvider?: PrefixHashProvider,
    skillTracking?: SkillTrackingConfig,
  ): Promise<SessionHandle> {
    const sdk = await loadSdk();
    const mcpServers = transformMcpServersForSdk(config.mcpServers);
    const baseOptions: SdkQueryOptions & { readonly mutableSuffix?: string } = {
      model: resolveModelId(config.model),
      effort: config.effort,
      cwd: config.workspace,
      // Phase 52 Plan 02: preset+append form — SDK claude_code preset auto-caches.
      systemPrompt: buildSystemPromptOption(config.systemPrompt),
      permissionMode: "bypassPermissions",
      settingSources: ["project"],
      env: buildCleanEnv(),
      ...(config.mutableSuffix ? { mutableSuffix: config.mutableSuffix } : {}),
      ...(mcpServers ? { mcpServers } : {}),
    };

    // Initial query to establish the session
    const initialQuery = sdk.query({ prompt: "Session initialized.", options: stripHandleOnlyFields(baseOptions) });
    const { sessionId, query } = await drainInitialQuery(initialQuery);

    return wrapSdkQuery(
      query,
      sdk,
      baseOptions,
      sessionId,
      usageCallback,
      undefined,
      prefixHashProvider,
      skillTracking,
    );
  }

  async resumeSession(
    sessionId: string,
    config: AgentSessionConfig,
    usageCallback?: UsageCallback,
    prefixHashProvider?: PrefixHashProvider,
    skillTracking?: SkillTrackingConfig,
  ): Promise<SessionHandle> {
    const sdk = await loadSdk();
    const mcpServers = transformMcpServersForSdk(config.mcpServers);
    const baseOptions: SdkQueryOptions & { readonly mutableSuffix?: string } = {
      model: resolveModelId(config.model),
      effort: config.effort,
      cwd: config.workspace,
      // Phase 52 Plan 02: preset+append form — SDK claude_code preset auto-caches.
      systemPrompt: buildSystemPromptOption(config.systemPrompt),
      permissionMode: "bypassPermissions",
      settingSources: ["project"],
      resume: sessionId,
      env: buildCleanEnv(),
      ...(config.mutableSuffix ? { mutableSuffix: config.mutableSuffix } : {}),
      ...(mcpServers ? { mcpServers } : {}),
    };

    return wrapSdkQuery(
      undefined,
      sdk,
      baseOptions,
      sessionId,
      usageCallback,
      undefined,
      prefixHashProvider,
      skillTracking,
    );
  }
}

/**
 * Phase 52 Plan 02 — strip adapter-only fields before forwarding to sdk.query.
 *
 * `mutableSuffix` is carried in our baseOptions for per-turn prompt
 * prepending but is NOT a real SDK option — remove it before handing
 * options to `sdk.query` so the SDK doesn't complain about an unknown key.
 */
function stripHandleOnlyFields(
  opts: SdkQueryOptions & { readonly mutableSuffix?: string },
): SdkQueryOptions {
  const { mutableSuffix: _mutable, ...rest } = opts as SdkQueryOptions & {
    mutableSuffix?: string;
  };
  return rest;
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
  baseOptions: SdkQueryOptions & { readonly mutableSuffix?: string },
  initialSessionId: string,
  usageCallback?: UsageCallback,
  boundTurn?: Turn,
  prefixHashProvider?: PrefixHashProvider,
  skillTracking?: SkillTrackingConfig,
): SessionHandle {
  let sessionId = initialSessionId;
  let currentEffort = baseOptions.effort ?? "low";
  const mutableSuffix = baseOptions.mutableSuffix;
  const errorHandlers: Array<(error: Error) => void> = [];
  const endHandlers: Array<() => void> = [];
  let closed = false;

  /**
   * Build options for a per-turn query, adding resume for session continuity.
   * Uses the current (possibly runtime-updated) effort level. Strips
   * adapter-only fields (mutableSuffix) before forwarding to sdk.query.
   */
  function turnOptions(): SdkQueryOptions {
    return stripHandleOnlyFields({
      ...baseOptions,
      effort: currentEffort,
      resume: sessionId,
    });
  }

  /**
   * Phase 52 Plan 02 — prepend the mutableSuffix to the user message when
   * present. Sits OUTSIDE the cached stable prefix so the SDK treats it as
   * per-turn content.
   */
  function promptWithMutable(message: string): string {
    return mutableSuffix && mutableSuffix.length > 0
      ? `${mutableSuffix}\n\n${message}`
      : message;
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

  /**
   * Shared SDK stream iteration with optional tracing (Phase 50, Pitfall 2 guard).
   *
   * Called by all three send variants (send, sendAndCollect, sendAndStream) so the
   * tracing hook points cannot diverge by construction. When `turn` is provided,
   * opens end_to_end + first_token + tool_call.<name> spans inside the loop.
   * Subagent-generated assistant messages (parent_tool_use_id !== null) are
   * filtered — first_token ends on the first PARENT text block only (Pitfall 6).
   *
   * IMPORTANT: does NOT call turn.end() — caller owns Turn lifecycle (50-02b).
   * Only opens and closes its own spans; the parent Turn is unaffected.
   *
   * @returns the resolved assistant text (msg.result if present, else collected text blocks)
   */
  async function iterateWithTracing(
    q: SdkQuery,
    turn: Turn | undefined,
    onAssistantText: ((accumulated: string) => void) | null,
  ): Promise<string> {
    const endToEnd = turn?.startSpan("end_to_end", {});
    const firstToken = turn?.startSpan("first_token", {});
    let firstTokenEnded = false;
    const activeTools = new Map<string, Span>();
    const textParts: string[] = [];
    // Phase 53 Plan 03 — per-turn skill-mention capture. We also buffer
    // any block-level text from the SDK's `message.content[]: [{ type: 'text', text }]`
    // shape so the scan covers text that never lands in the narrowed
    // `msg.content: string` path.
    const blockTextParts: string[] = [];

    const closeAllSpans = () => {
      for (const span of activeTools.values()) span.end();
      activeTools.clear();
      if (!firstTokenEnded) {
        firstToken?.end();
        firstTokenEnded = true;
      }
      endToEnd?.end();
    };

    try {
      for await (const msg of q) {
        if (msg.type === "assistant") {
          // Subagent filter (Pitfall 6): only PARENT messages drive first_token + tool_call.
          const parentToolUseId =
            (msg as { parent_tool_use_id?: string | null }).parent_tool_use_id ?? null;
          if (parentToolUseId === null) {
            // The SDK's real shape is `msg.message.content[]: BetaContentBlock[]`
            // (not the narrowed local type where `msg.content` is a string). We
            // inspect content blocks for text (first_token) and tool_use (span start).
            const contentBlocks = ((msg as { message?: { content?: unknown[] } }).message?.content ?? []) as unknown[];
            for (const raw of contentBlocks) {
              const block = raw as { type?: string; name?: string; id?: string; text?: string };
              if (block.type === "text" && !firstTokenEnded) {
                firstToken?.end();
                firstTokenEnded = true;
              }
              if (block.type === "text" && typeof block.text === "string") {
                blockTextParts.push(block.text);
              }
              if (block.type === "tool_use" && block.id && block.name) {
                const span = turn?.startSpan(`tool_call.${block.name}`, {
                  tool_use_id: block.id,
                });
                if (span) activeTools.set(block.id, span);
              }
            }
          }
          // Preserve the narrowed-type text accumulation path used today.
          if (typeof msg.content === "string" && msg.content.length > 0) {
            textParts.push(msg.content);
            onAssistantText?.(textParts.join("\n"));
          }
        }

        if (msg.type === "user") {
          // Close the tool_call span when the matching tool_use_result arrives.
          // SDK emits user messages with `parent_tool_use_id` set to the tool_use_id.
          const toolUseId = (msg as { parent_tool_use_id?: string | null }).parent_tool_use_id;
          if (toolUseId) {
            const span = activeTools.get(toolUseId);
            if (span) {
              span.end();
              activeTools.delete(toolUseId);
            }
          }
        }

        if (msg.type === "result") {
          if (msg.session_id) sessionId = msg.session_id;
          extractUsage(msg, usageCallback);
          // Phase 52 Plan 01: capture cache telemetry snapshot from msg.usage
          // onto the parent Turn. Caller-owned lifecycle preserved — we call
          // recordCacheUsage, NEVER turn.end() (50-02 invariant).
          //
          // Missing usage fields default to 0 (not NaN / undefined) so the
          // hit-rate denominator cannot become invalid downstream.
          //
          // Wrapped in try/catch — cache capture MUST NEVER break the message
          // path (same observational-only contract as Phase 50 spans, mirrors
          // extractUsage's silent-swallow pattern above).
          if (turn) {
            try {
              const u = msg.usage ?? {};
              const cacheRead =
                typeof u.cache_read_input_tokens === "number"
                  ? u.cache_read_input_tokens
                  : 0;
              const cacheCreation =
                typeof u.cache_creation_input_tokens === "number"
                  ? u.cache_creation_input_tokens
                  : 0;
              const input =
                typeof u.input_tokens === "number" ? u.input_tokens : 0;

              // Phase 52 Plan 02 — per-turn prefixHash comparison (CONTEXT D-04).
              // Re-read the current stablePrefix hash on EVERY turn so mid-session
              // config drift (skills hot-reload, hot-tier mutation, identity swap)
              // is visible. Session-boundary comparison would miss all of these.
              // Wrapped in its own try/catch so provider errors do not disturb
              // the token-count capture — observational contract preserved.
              let prefixHash: string | undefined;
              let cacheEvictionExpected: boolean | undefined;
              try {
                if (prefixHashProvider) {
                  const probe = prefixHashProvider.get();
                  if (
                    probe &&
                    typeof probe.current === "string" &&
                    probe.current.length > 0
                  ) {
                    prefixHash = probe.current;
                    cacheEvictionExpected =
                      probe.last === undefined
                        ? false
                        : probe.current !== probe.last;
                  }
                }
              } catch {
                // Provider threw — leave prefix fields undefined, continue
                // capturing token counts. CACHE observability MUST NEVER
                // break the message path (CONTEXT invariant from Phase 50).
              }

              turn.recordCacheUsage({
                cacheReadInputTokens: cacheRead,
                cacheCreationInputTokens: cacheCreation,
                inputTokens: input,
                prefixHash,
                cacheEvictionExpected,
              });

              // Persist the new hash AFTER recordCacheUsage so the NEXT turn
              // can compare. Wrapped in try/catch mirroring the provider-get
              // guard — persistence failure must not disturb the message path.
              try {
                if (prefixHash !== undefined) {
                  prefixHashProvider?.persist(prefixHash);
                }
              } catch {
                // ignore
              }
            } catch {
              // Never break the send flow due to cache-capture failure.
            }
          }

          // Phase 53 Plan 03 — skill-mention capture per turn.
          //
          // Scan the assistant text we accumulated this turn against the
          // agent's skill catalog, then record the word-boundary matches
          // on the tracker. Wrapped in try/catch so tracker errors NEVER
          // break the parent message path (Phase 50 observational invariant).
          //
          // We scan BOTH the narrowed `msg.content` text accumulator AND
          // the block-level `message.content[].text` buffer so the capture
          // is robust against SDK shape variance.
          try {
            if (skillTracking) {
              const assistantText = [
                ...textParts,
                ...blockTextParts,
              ].join("\n");
              const mentioned = extractSkillMentions(
                assistantText,
                skillTracking.skillCatalogNames,
              );
              skillTracking.skillUsageTracker.recordTurn(
                skillTracking.agentName,
                { mentionedSkills: mentioned },
              );
            }
          } catch {
            // Silent-swallow — observational path MUST NEVER break message path
            // (invariant from Phase 50, mirrored on cache capture).
          }

          closeAllSpans();
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
          return textParts.join("\n");
        }
      }
      // Stream ended without a `result` message — still close spans and return whatever we collected.
      closeAllSpans();
      return textParts.join("\n");
    } catch (err) {
      closeAllSpans();
      throw err;
    }
  }

  return {
    get sessionId(): string {
      return sessionId;
    },

    async send(message: string, turn?: Turn): Promise<void> {
      if (closed) throw new Error(`Session ${sessionId} is closed`);
      try {
        const q = sdk.query({
          prompt: promptWithMutable(message),
          options: turnOptions(),
        });
        await iterateWithTracing(q, turn ?? boundTurn, null);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        notifyError(error);
        throw error;
      }
    },

    async sendAndCollect(message: string, turn?: Turn): Promise<string> {
      if (closed) throw new Error(`Session ${sessionId} is closed`);
      try {
        const q = sdk.query({
          prompt: promptWithMutable(message),
          options: turnOptions(),
        });
        return await iterateWithTracing(q, turn ?? boundTurn, null);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        notifyError(error);
        throw error;
      }
    },

    async sendAndStream(
      message: string,
      onChunk: (accumulated: string) => void,
      turn?: Turn,
    ): Promise<string> {
      if (closed) throw new Error(`Session ${sessionId} is closed`);
      try {
        const q = sdk.query({
          prompt: promptWithMutable(message),
          options: turnOptions(),
        });
        return await iterateWithTracing(q, turn ?? boundTurn, onChunk);
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

    setEffort(level: "low" | "medium" | "high" | "max"): void {
      currentEffort = level;
    },

    getEffort(): "low" | "medium" | "high" | "max" {
      return currentEffort;
    },
  };
}

// ---------------------------------------------------------------------------
// Traced factory (Phase 50) — test-friendly handle builder with bound Turn
// ---------------------------------------------------------------------------

/**
 * Options accepted by {@link createTracedSessionHandle}.
 *
 * `turn` binds a caller-owned Turn into the returned handle's closure so that
 * subsequent `send`/`sendAndCollect`/`sendAndStream` calls automatically thread
 * it into `iterateWithTracing`. Tests use this to avoid passing the turn on
 * every call; production code paths (SessionManager) still prefer the explicit
 * per-call `turn?` parameter because it matches the caller-owned lifecycle.
 */
export type TracedSessionHandleOptions = {
  readonly sdk: SdkModule;
  readonly baseOptions: SdkQueryOptions & { readonly mutableSuffix?: string };
  readonly sessionId: string;
  readonly turn?: Turn;
  readonly usageCallback?: UsageCallback;
  /**
   * Phase 52 Plan 02 — optional per-turn prefixHash provider.
   *
   * Invoked from inside `iterateWithTracing` on every turn to compute
   * `cache_eviction_expected` and attach `prefix_hash` to the buffered
   * telemetry snapshot. `persist(hash)` is called AFTER recordCacheUsage
   * so the next turn's comparison has a fresh baseline. SessionManager
   * owns the per-agent map behind this closure.
   */
  readonly prefixHashProvider?: PrefixHashProvider;
  /**
   * Phase 53 Plan 03 — optional skill-mention capture config.
   *
   * When present, `iterateWithTracing` scans the assistant text per turn
   * against `skillCatalogNames` and records word-boundary matches on the
   * tracker under `agentName`. Errors silent-swallowed per observational
   * contract.
   */
  readonly skillTracking?: SkillTrackingConfig;
};

/**
 * Build a SessionHandle with a pre-bound Turn and the shared iterateWithTracing
 * stream loop. This is the Wave 2-added export that Wave 0 tests import.
 *
 * The returned handle threads the bound turn through every send variant unless
 * a per-call turn is provided — in which case the per-call value wins.
 *
 * SessionHandle NEVER calls turn.end(); the caller owns lifecycle (50-02b).
 */
export function createTracedSessionHandle(opts: TracedSessionHandleOptions): SessionHandle {
  return wrapSdkQuery(
    undefined,
    opts.sdk,
    opts.baseOptions,
    opts.sessionId,
    opts.usageCallback,
    opts.turn,
    opts.prefixHashProvider,
    opts.skillTracking,
  );
}
