import type { AgentSessionConfig } from "./types.js";
import type { SdkModule, SdkQueryOptions, SdkQuery, SdkStreamMessage, SlashCommand, PermissionMode } from "./sdk-types.js";
import { resolveModelId } from "./model-resolver.js";
import type { Turn, Span } from "../performance/trace-collector.js";
import type { EffortLevel } from "../config/schema.js";
import type { McpServerState } from "../mcp/readiness.js";
import type { FlapHistoryEntry } from "./filter-tools-by-capability-probe.js";
import type { AttemptRecord } from "./recovery/types.js";
import {
  type SkillUsageTracker,
  extractSkillMentions,
} from "../usage/skill-usage-tracker.js";
import { createPersistentSessionHandle } from "./persistent-session-handle.js";

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
/** Phase 59 -- optional signal bag threaded through send variants. */
export type SendOptions = { readonly signal?: AbortSignal };

export type SessionHandle = {
  readonly sessionId: string;
  send: (message: string, turn?: Turn, options?: SendOptions) => Promise<void>;
  sendAndCollect: (message: string, turn?: Turn, options?: SendOptions) => Promise<string>;
  sendAndStream: (message: string, onChunk: (accumulated: string) => void, turn?: Turn, options?: SendOptions) => Promise<string>;
  close: () => Promise<void>;
  onError: (handler: (error: Error) => void) => void;
  onEnd: (handler: () => void) => void;
  // Phase 83 EFFORT-04 — widened to full v2.2 EffortLevel set.
  setEffort: (level: EffortLevel) => void;
  getEffort: () => EffortLevel;
  /**
   * Phase 86 MODEL-03 — mid-session model mutation (spy-test pinned).
   * Accepts the resolved SDK model id (e.g. "claude-sonnet-4-5"), not the
   * alias. Allowlist validation happens upstream in
   * `SessionManager.setModelForAgent` before this handle method fires.
   */
  setModel: (modelId: string) => void;
  /**
   * Phase 86 MODEL-07 — current model alias/id surfaced in /clawcode-status.
   * Returns the value most recently passed to setModel, or the session-start
   * default captured from baseOptions.model. Undefined when neither is set.
   */
  getModel: () => string | undefined;
  /**
   * Phase 87 CMD-02 — mid-session permission-mode mutation (spy-test pinned).
   * Accepts one of the 6 PermissionMode values. Validation happens upstream
   * in `SessionManager.setPermissionModeForAgent` before this handle method
   * fires.
   */
  setPermissionMode: (mode: PermissionMode) => void;
  /**
   * Phase 87 CMD-02 — current permission mode, surfaced by
   * /clawcode-permissions and future status reporters. Returns the value
   * most recently passed to setPermissionMode, or the session-start default
   * captured from baseOptions.permissionMode (or "default" when neither is
   * set).
   */
  getPermissionMode: () => PermissionMode;
  /**
   * Phase 73 extension (quick task 260419-nic) — mid-turn abort primitive.
   *
   * When a turn is in-flight, fires the SDK Query.interrupt() and the
   * awaiting send/sendAndCollect/sendAndStream rejects with AbortError
   * within the 2s interrupt-deadline window. When no turn is in-flight,
   * returns without side effects (idempotent no-op).
   *
   * Never throws — interrupt failure is swallowed (matches fireInterruptOnce).
   */
  interrupt: () => void;
  /**
   * Phase 73 extension (quick task 260419-nic) — in-flight turn probe.
   *
   * Returns true when there is an active iterateUntilResult() consuming
   * driverIter, false otherwise (handle freshly created OR last turn resolved
   * OR handle closed). Backed by the depth-1 SerialTurnQueue.inFlight slot.
   */
  hasActiveTurn: () => boolean;
  /**
   * Phase 85 Plan 01 TOOL-01 — per-handle MCP server state accessor.
   *
   * Mirrors `SessionManager.getMcpStateForAgent(name)` so TurnDispatcher-
   * scope consumers (Plan 02 prompt-builder, Plan 03 slash commands)
   * can read live MCP health without reaching into the SessionManager's
   * private maps. The state map is owned by SessionManager; the handle
   * is a thin mirror updated at warm-path gate + per heartbeat tick.
   */
  getMcpState: () => ReadonlyMap<string, McpServerState>;
  setMcpState: (state: ReadonlyMap<string, McpServerState>) => void;
  /**
   * Phase 94 Plan 02 TOOL-03 — per-handle flap-history Map for the D-12
   * 5min flap-stability window. Stable Map identity across calls (the
   * filter mutates in-place per tick). Read by session-config.ts when
   * assembling the LLM-visible MCP server list.
   */
  getFlapHistory: () => Map<string, FlapHistoryEntry>;
  /**
   * Phase 94 Plan 03 TOOL-04/05/06 — per-handle recovery-attempt history.
   *
   * Keyed by serverName; values are append-only AttemptRecord arrays
   * pruned to the rolling 1hr window by the registry on each call. Stable
   * Map identity across the handle's lifetime so the bounded budget
   * counter (3 attempts/hour) accumulates correctly across heartbeat
   * ticks. Read+mutated by `runRecoveryForServer` in
   * `src/manager/recovery/registry.ts`.
   */
  getRecoveryAttemptHistory: () => Map<string, AttemptRecord[]>;
  /**
   * Phase 87 CMD-01 — enumerate SDK-reported slash commands for this session.
   *
   * First call invokes the SDK's Query.initializationResult() once and caches
   * the resulting `commands` array; subsequent calls return the cache. The
   * SlashCommandHandler.register() loop reads this per-agent and merges the
   * results with CONTROL_COMMANDS + DEFAULT_SLASH_COMMANDS.
   *
   * SDK-reject paths leave the cache null so the next call retries — useful
   * when the SDK init handshake races the first caller.
   */
  getSupportedCommands: () => Promise<readonly SlashCommand[]>;
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
  // Phase 83 EFFORT-04 — widened to full v2.2 EffortLevel set.
  private effort: EffortLevel = "low";
  /**
   * Quick task 260419-nic — track whether a send is "in-flight".
   *
   * The mock's send variants are effectively synchronous, so this flag
   * flips true → false within a single send(). Tests that exercise the
   * SessionManager.interruptAgent positive path flip this directly via
   * __testSetActiveTurn(true) to simulate a hanging SDK turn.
   */
  private activeTurn: boolean = false;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  async send(_message: string, _turn?: Turn, _options?: SendOptions): Promise<void> {
    if (this.closed) {
      throw new Error(`Session ${this.sessionId} is closed`);
    }
    if (_options?.signal?.aborted) {
      const err = new Error("MockSessionHandle: signal aborted");
      err.name = "AbortError";
      throw err;
    }
    this.activeTurn = true;
    try {
      // Mock has no SDK work to do — resolve immediately.
    } finally {
      this.activeTurn = false;
    }
  }

  async sendAndCollect(_message: string, _turn?: Turn, _options?: SendOptions): Promise<string> {
    if (this.closed) {
      throw new Error(`Session ${this.sessionId} is closed`);
    }
    if (_options?.signal?.aborted) {
      const err = new Error("MockSessionHandle: signal aborted");
      err.name = "AbortError";
      throw err;
    }
    this.activeTurn = true;
    try {
      return `Mock response from ${this.sessionId}`;
    } finally {
      this.activeTurn = false;
    }
  }

  async sendAndStream(
    _message: string,
    onChunk: (accumulated: string) => void,
    _turn?: Turn,
    _options?: SendOptions,
  ): Promise<string> {
    if (this.closed) {
      throw new Error(`Session ${this.sessionId} is closed`);
    }
    if (_options?.signal?.aborted) {
      const err = new Error("MockSessionHandle: signal aborted");
      err.name = "AbortError";
      throw err;
    }
    this.activeTurn = true;
    try {
      const response = `Mock response from ${this.sessionId}`;
      onChunk(response);
      return response;
    } finally {
      this.activeTurn = false;
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

  setEffort(level: EffortLevel): void {
    this.effort = level;
  }

  getEffort(): EffortLevel {
    return this.effort;
  }

  // Phase 86 MODEL-03 — in-memory mock of the real handle's setModel/getModel
  // contract. Tests can spy on this method directly to verify SessionManager
  // dispatch; no SDK interaction.
  private _model: string | undefined;
  setModel(modelId: string): void {
    this._model = modelId;
  }
  getModel(): string | undefined {
    return this._model;
  }

  // Phase 87 CMD-02 — in-memory mock of the real handle's
  // setPermissionMode/getPermissionMode contract. Default "default" so
  // getPermissionMode never returns undefined. Tests spy directly to verify
  // SessionManager dispatch.
  private _permissionMode: PermissionMode = "default";
  setPermissionMode(mode: PermissionMode): void {
    this._permissionMode = mode;
  }
  getPermissionMode(): PermissionMode {
    return this._permissionMode;
  }

  /**
   * Quick task 260419-nic — mock interrupt is a no-op.
   *
   * Tests that care about real abort mechanics drive the real handle
   * (createPersistentSessionHandle). SessionManager.interruptAgent tests
   * use this mock to verify the dispatch + logging path.
   */
  interrupt(): void {
    /* no-op — mock has no SDK query to interrupt */
  }

  /**
   * Quick task 260419-nic — expose the activeTurn flag.
   */
  hasActiveTurn(): boolean {
    return this.activeTurn;
  }

  /**
   * Phase 85 Plan 01 TOOL-01 — test-mock MCP state accessor.
   *
   * In-memory map, no SDK interaction. Tests can drive setMcpState to
   * exercise downstream consumers that read getMcpState (prompt-
   * builder + slash commands in Plans 02/03).
   */
  private mcpState: ReadonlyMap<string, McpServerState> = new Map();
  getMcpState(): ReadonlyMap<string, McpServerState> {
    return this.mcpState;
  }
  setMcpState(state: ReadonlyMap<string, McpServerState>): void {
    this.mcpState = new Map(state);
  }

  /**
   * Phase 94 Plan 02 TOOL-03 — test-mock flap-history accessor.
   * Stable Map identity across calls (matches the production handle
   * contract); filter mutates in-place per tick.
   */
  private flapHistoryMap: Map<string, FlapHistoryEntry> = new Map();
  getFlapHistory(): Map<string, FlapHistoryEntry> {
    return this.flapHistoryMap;
  }

  /**
   * Phase 94 Plan 03 — test-mock recovery-attempt history accessor.
   * Stable Map identity matches the production handle contract; the
   * registry mutates in-place per heartbeat tick.
   */
  private recoveryAttemptHistoryMap: Map<string, AttemptRecord[]> = new Map();
  getRecoveryAttemptHistory(): Map<string, AttemptRecord[]> {
    return this.recoveryAttemptHistoryMap;
  }

  /**
   * Phase 87 CMD-01 — test-mock SDK slash-command enumeration.
   *
   * Default: empty array (no native commands). Tests can override via
   * __testSetSupportedCommands to drive SlashCommandHandler.register()
   * merge paths without standing up a real SDK query.
   */
  private supportedCommandsValue: readonly SlashCommand[] = [];
  async getSupportedCommands(): Promise<readonly SlashCommand[]> {
    return this.supportedCommandsValue;
  }

  /** Test-only hook — seed supported commands for register() tests. */
  __testSetSupportedCommands(cmds: readonly SlashCommand[]): void {
    this.supportedCommandsValue = cmds;
  }

  /**
   * Test-only hook — flip activeTurn to drive interruptAgent tests.
   * Never called from production. Prefixed __test to match existing
   * test-only conventions (see browser-mcp __testOnly_*).
   */
  __testSetActiveTurn(v: boolean): void {
    this.activeTurn = v;
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
export function buildCleanEnv(): Record<string, string | undefined> {
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
 * Phase 73 Plan 01: `createSession`/`resumeSession` both route through
 * `createPersistentSessionHandle` — one long-lived `sdk.query({ prompt:
 * asyncIterable })` per agent lifetime (streaming input mode). Eliminates the
 * per-turn CLI subprocess spawn that dominated TTFB on warm agents. The
 * legacy per-turn-query shape (`wrapSdkQuery`) is retained ONLY as the backing
 * factory for `createTracedSessionHandle` (test-only export).
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

    // Phase 73 Plan 01 — initial drain establishes the session ID from disk,
    // then the persistent handle owns ONE long-lived sdk.query({ prompt:
    // asyncIterable }) for the rest of the agent's lifetime. The drain query
    // is a throwaway — its CLI subprocess exits after emitting the `result`.
    const initialQuery = sdk.query({ prompt: "Session initialized.", options: stripHandleOnlyFields(baseOptions) });
    const { sessionId } = await drainInitialQuery(initialQuery);

    return createPersistentSessionHandle(
      sdk,
      baseOptions,
      sessionId,
      usageCallback,
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

    // Phase 73 Plan 01 — persistent handle (no per-turn sdk.query spawn).
    return createPersistentSessionHandle(
      sdk,
      baseOptions,
      sessionId,
      usageCallback,
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
 * Phase 83 EFFORT-04 — narrow a v2.2 EffortLevel down to the subset the SDK's
 * session-start `effort` option accepts (sdk.d.ts:435 — "low"|"medium"|"high"|"max").
 *
 * The full v2.2 set (adds "xhigh", "auto", "off") is only expressible via
 * runtime `q.setMaxThinkingTokens` (sdk.d.ts:1728). When the legacy
 * wrapSdkQuery path needs to project back into the SDK's start-option type:
 *   - "xhigh" → "high"      (closest-supported session-start level)
 *   - "auto"  → undefined   (omit; SDK uses model default)
 *   - "off"   → undefined   (omit; runtime zeroing handled by setMaxThinkingTokens)
 *   - others  → pass-through
 */
function narrowEffortForSdkOption(
  level: EffortLevel,
): "low" | "medium" | "high" | "max" | undefined {
  switch (level) {
    case "low":
    case "medium":
    case "high":
    case "max":
      return level;
    case "xhigh":
      return "high";
    case "auto":
    case "off":
      return undefined;
  }
}

/**
 * Wrap the SDK query() API into a SessionHandle — **legacy per-turn-query**.
 *
 * @deprecated Phase 73 Plan 01 — production `SdkSessionAdapter.createSession`
 * and `resumeSession` now route through `createPersistentSessionHandle` (one
 * long-lived `sdk.query({ prompt: asyncIterable })` per agent lifetime). This
 * function is retained ONLY as the backing factory for `createTracedSessionHandle`,
 * a test-only export used by existing per-turn span + cache telemetry tests.
 * NO production code path reaches this function anymore.
 *
 * Uses a per-turn-query pattern: each send/sendAndCollect/sendAndStream creates
 * a fresh query() call with `resume: sessionId` for session continuity.
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
  // Phase 83 EFFORT-04 — widened to v2.2 EffortLevel set.
  let currentEffort: EffortLevel = (baseOptions.effort ?? "low") as EffortLevel;
  const mutableSuffix = baseOptions.mutableSuffix;
  const errorHandlers: Array<(error: Error) => void> = [];
  const endHandlers: Array<() => void> = [];
  let closed = false;
  // Phase 85 Plan 01 TOOL-01 — legacy handle mirrors same MCP-state
  // contract as createPersistentSessionHandle for SessionHandle interface
  // parity. wrapSdkQuery is test-only (createTracedSessionHandle) so this
  // is effectively dormant in production paths.
  let legacyMcpState: ReadonlyMap<string, McpServerState> = new Map();
  // Phase 94 Plan 03 — legacy recovery-attempt history (test-only path).
  const legacyRecoveryAttemptHistory: Map<string, AttemptRecord[]> = new Map();
  // Phase 94 Plan 02 TOOL-03 — legacy flap-history Map (test-only path).
  const legacyFlapHistory: Map<string, FlapHistoryEntry> = new Map();

  /**
   * Build options for a per-turn query, adding resume for session continuity.
   * Uses the current (possibly runtime-updated) effort level. Strips
   * adapter-only fields (mutableSuffix) before forwarding to sdk.query.
   *
   * Phase 83 EFFORT-04 — the SDK's session-start `effort` option only
   * accepts the v2.1 level set (low|medium|high|max). For the v2.2-extended
   * levels ("xhigh"|"auto"|"off") we narrow for the start-option field here;
   * runtime control happens via q.setMaxThinkingTokens on the persistent
   * handle (which is the production path). The legacy wrapSdkQuery spawns
   * a per-turn query and has no persistent handle to set tokens on, so
   * narrowing is the conservative choice for this test-only path.
   */
  function turnOptions(signal?: AbortSignal): SdkQueryOptions {
    const sdkEffort = narrowEffortForSdkOption(currentEffort);
    const opts: SdkQueryOptions & { readonly mutableSuffix?: string } = {
      ...baseOptions,
      ...(sdkEffort !== undefined ? { effort: sdkEffort } : {}),
      resume: sessionId,
    };
    if (signal) {
      const abortController = new AbortController();
      if (signal.aborted) {
        abortController.abort();
      } else {
        signal.addEventListener("abort", () => abortController.abort(), { once: true });
      }
      return stripHandleOnlyFields({ ...opts, abortController });
    }
    return stripHandleOnlyFields(opts);
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
    /**
     * Phase 55 Plan 02 — per-active-tool tracking. Each entry carries the
     * Span handle plus the Turn's `toolCache.hitCount()` captured at span
     * open. When the matching `tool_use_result` arrives we compare the
     * current hitCount to the captured baseline — if it incremented, the
     * handler returned a cached value and we enrich the span with
     * `cached: true` + `cache_hit_duration_ms` BEFORE calling span.end().
     */
    const activeTools = new Map<
      string,
      {
        readonly span: Span;
        readonly hitCountAtOpen: number;
        readonly openedAtMs: number;
      }
    >();
    const textParts: string[] = [];
    // Phase 53 Plan 03 — per-turn skill-mention capture. We also buffer
    // any block-level text from the SDK's `message.content[]: [{ type: 'text', text }]`
    // shape so the scan covers text that never lands in the narrowed
    // `msg.content: string` path.
    const blockTextParts: string[] = [];
    // Token-level streaming accumulator. When the SDK emits stream_event
    // messages (enabled via `includePartialMessages: true` on the query),
    // text_delta events land here and we push the running total to
    // `onAssistantText` so the Discord ProgressiveMessageEditor edits in
    // near-real-time instead of once per complete assistant message.
    let streamedText = "";

    const closeAllSpans = () => {
      for (const entry of activeTools.values()) entry.span.end();
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

            // Phase 55 Plan 02 — pre-scan for tool_use blocks in this assistant
            // message. Multiple blocks in the SAME message == parallel dispatch
            // by the SDK, so all tool_call spans opened below are tagged
            // `is_parallel: true`. Single-block messages are sequential.
            const toolUseCount = contentBlocks.filter(
              (b) => (b as { type?: string }).type === "tool_use",
            ).length;
            const isParallelBatch = toolUseCount > 1;

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
                // Phase 55 Plan 02 — span metadata enrichment. No new span
                // types; just extra keys on existing `tool_call.<name>` spans
                // so per-tool queryability (tool_name) + parallel vs serial
                // (is_parallel) + cache hit observability (cached) are surfaced
                // in the trace_spans table for CLI + dashboard rendering.
                const span = turn?.startSpan(`tool_call.${block.name}`, {
                  tool_use_id: block.id,
                  tool_name: block.name,
                  is_parallel: isParallelBatch,
                  cached: false, // default — updated to true on hit (see user-message branch)
                });
                if (span) {
                  // Guarded: some tests pass a minimal mock Turn without a
                  // toolCache field. In production the Turn always has one
                  // (see src/performance/trace-collector.ts — lazy getter).
                  const hitCountAtOpen =
                    (turn as { toolCache?: { hitCount: () => number } } | undefined)
                      ?.toolCache?.hitCount() ?? 0;
                  activeTools.set(block.id, {
                    span,
                    hitCountAtOpen,
                    openedAtMs: Date.now(),
                  });
                }
              }
            }
          }
          // Preserve the narrowed-type text accumulation path used today.
          // Guard: when streaming is active (onAssistantText !== null), the
          // token-level `stream_event` branch already emits progressive text.
          // Pushing msg.content here would double-emit — skip.
          if (typeof msg.content === "string" && msg.content.length > 0) {
            textParts.push(msg.content);
            if (onAssistantText === null) {
              // Non-streaming path: this is the only signal we get.
              // (Streaming path fires via stream_event above.)
            }
          }
        }

        // Token-level streaming via SDKPartialAssistantMessage
        // (requires `includePartialMessages: true` on the sdk.query options).
        // Only the PARENT session's stream events drive the editor — subagent
        // stream_events are filtered out the same way first_token is.
        // Cast: local SdkMessage type is narrower than the real SDK union
        // (missing 'stream_event'); see deferred-items.md.
        if ((msg as { type?: string }).type === "stream_event" && onAssistantText !== null) {
          const parentToolUseId =
            (msg as { parent_tool_use_id?: string | null }).parent_tool_use_id ?? null;
          if (parentToolUseId === null) {
            const event = (msg as { event?: { type?: string; delta?: { type?: string; text?: string } } }).event;
            if (
              event?.type === "content_block_delta" &&
              event.delta?.type === "text_delta" &&
              typeof event.delta.text === "string" &&
              event.delta.text.length > 0
            ) {
              // First text_delta is the true first visible token from the model.
              if (!firstTokenEnded) {
                firstToken?.end();
                firstTokenEnded = true;
              }
              streamedText += event.delta.text;
              onAssistantText(streamedText);
            }
          }
        }

        if (msg.type === "user") {
          // Close the tool_call span when the matching tool_use_result arrives.
          // SDK emits user messages with `parent_tool_use_id` set to the tool_use_id.
          const toolUseId = (msg as { parent_tool_use_id?: string | null }).parent_tool_use_id;
          if (toolUseId) {
            const entry = activeTools.get(toolUseId);
            if (entry) {
              // Phase 55 Plan 02 — cache-hit delta detection. If the Turn's
              // tool-cache hit count increased while this span was open, the
              // MCP wrapper (invokeWithCache in src/mcp/server.ts) served the
              // call from cache. Enrich span metadata with `cached: true` +
              // `cache_hit_duration_ms` BEFORE calling end() so the committed
              // span record carries the enriched keys.
              try {
                const hitCountNow =
                  (turn as { toolCache?: { hitCount: () => number } } | undefined)
                    ?.toolCache?.hitCount() ?? entry.hitCountAtOpen;
                if (hitCountNow > entry.hitCountAtOpen) {
                  entry.span.setMetadata({
                    cached: true,
                    cache_hit_duration_ms: Date.now() - entry.openedAtMs,
                  });
                }
              } catch {
                // Observational path MUST NEVER break the message path
                // (Phase 50 invariant mirrored on cache telemetry).
              }
              entry.span.end();
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
          // Streaming path: streamedText has the canonical token-level output.
          // Non-streaming path: fall back to the block/content accumulator.
          return streamedText.length > 0 ? streamedText : textParts.join("\n");
        }
      }
      // Stream ended without a `result` message — still close spans and return whatever we collected.
      closeAllSpans();
      return streamedText.length > 0 ? streamedText : textParts.join("\n");
    } catch (err) {
      closeAllSpans();
      throw err;
    }
  }

  return {
    get sessionId(): string {
      return sessionId;
    },

    async send(message: string, turn?: Turn, options?: SendOptions): Promise<void> {
      if (closed) throw new Error(`Session ${sessionId} is closed`);
      try {
        const q = sdk.query({
          prompt: promptWithMutable(message),
          options: turnOptions(options?.signal),
        });
        await iterateWithTracing(q, turn ?? boundTurn, null);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        notifyError(error);
        throw error;
      }
    },

    async sendAndCollect(message: string, turn?: Turn, options?: SendOptions): Promise<string> {
      if (closed) throw new Error(`Session ${sessionId} is closed`);
      try {
        const q = sdk.query({
          prompt: promptWithMutable(message),
          options: turnOptions(options?.signal),
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
      options?: SendOptions,
    ): Promise<string> {
      if (closed) throw new Error(`Session ${sessionId} is closed`);
      try {
        // Phase 54 follow-up — token-level streaming. `includePartialMessages`
        // tells the SDK to emit `SDKPartialAssistantMessage` (type: 'stream_event')
        // with `content_block_delta` / `text_delta` events as the model produces
        // tokens. iterateWithTracing forwards those deltas to `onChunk` via its
        // stream_event branch so the Discord ProgressiveMessageEditor sees
        // tokens progressively instead of a single complete-message callback.
        // Cast: local SdkQueryOptions type is narrower than the real SDK
        // type (missing includePartialMessages); see deferred-items.md.
        const q = sdk.query({
          prompt: promptWithMutable(message),
          options: { ...turnOptions(options?.signal), includePartialMessages: true } as SdkQueryOptions,
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

    setEffort(level: EffortLevel): void {
      currentEffort = level;
    },

    getEffort(): EffortLevel {
      return currentEffort;
    },

    /**
     * Phase 86 MODEL-03 — legacy wrapSdkQuery predates the mid-turn model
     * primitive. The per-turn-query shape has no persistent Query reference
     * to setModel() cleanly, so we mirror the interrupt/hasActiveTurn pattern:
     * no-op for setModel, undefined for getModel. This legacy factory is
     * test-only (createTracedSessionHandle) — production routes through
     * createPersistentSessionHandle where the real wire lives.
     */
    setModel(_modelId: string): void {
      /* no-op — legacy per-turn-query handle lacks mid-session model swap */
    },

    getModel(): string | undefined {
      return undefined;
    },

    /**
     * Phase 87 CMD-02 — legacy wrapSdkQuery predates the mid-turn
     * permission-mode primitive. The per-turn-query shape has no persistent
     * Query reference to setPermissionMode cleanly across turns. This legacy
     * factory is test-only (createTracedSessionHandle) — production routes
     * through createPersistentSessionHandle where the real wire lives. We
     * mirror the setModel/getModel pattern: no-op setter, "default" getter.
     */
    setPermissionMode(_mode: PermissionMode): void {
      /* no-op — legacy per-turn-query handle lacks mid-session permission swap */
    },

    getPermissionMode(): PermissionMode {
      return "default";
    },

    /**
     * Quick task 260419-nic — legacy wrapSdkQuery predates the mid-turn
     * interrupt primitive. The per-turn-query shape has no persistent Query
     * reference to interrupt() cleanly across all send variants. This legacy
     * factory is test-only (createTracedSessionHandle) — production routes
     * through createPersistentSessionHandle. Treat as a no-op here; callers
     * that need the real primitive must use the persistent handle.
     */
    interrupt(): void {
      /* no-op — legacy per-turn-query handle lacks mid-turn interrupt */
    },

    hasActiveTurn(): boolean {
      return false;
    },

    /**
     * Phase 85 Plan 01 TOOL-01 — legacy per-turn-query handle carries the
     * same mirror contract as the persistent handle so SessionHandle stays
     * a single interface. Simple closure-scoped map, not observed in
     * production paths (wrapSdkQuery is test-only via
     * `createTracedSessionHandle`).
     */
    getMcpState(): ReadonlyMap<string, McpServerState> {
      return legacyMcpState;
    },
    setMcpState(state: ReadonlyMap<string, McpServerState>): void {
      legacyMcpState = new Map(state);
    },

    /**
     * Phase 94 Plan 02 TOOL-03 — legacy flap-history accessor (test-only).
     * Stable Map identity matches the persistent-handle contract.
     */
    getFlapHistory(): Map<string, FlapHistoryEntry> {
      return legacyFlapHistory;
    },

    /**
     * Phase 94 Plan 03 — legacy recovery-attempt history accessor.
     * Stable Map identity matches the persistent-handle contract.
     */
    getRecoveryAttemptHistory(): Map<string, AttemptRecord[]> {
      return legacyRecoveryAttemptHistory;
    },

    /**
     * Phase 87 CMD-01 — legacy wrapSdkQuery predates the persistent-handle
     * SDK primitive. Per-turn-query shape has no durable Query reference
     * to call initializationResult on, so this legacy factory returns an
     * empty SlashCommand list. Production routes through
     * createPersistentSessionHandle where the real wire lives.
     */
    async getSupportedCommands(): Promise<readonly SlashCommand[]> {
      return [];
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
