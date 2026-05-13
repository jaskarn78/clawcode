import type { AgentSessionConfig } from "./types.js";
import type { SdkModule, SdkQueryOptions, SdkQuery, SdkStreamMessage, SlashCommand, PermissionMode } from "./sdk-types.js";
import { resolveModelId } from "./model-resolver.js";
import type { Turn, Span } from "../performance/trace-collector.js";
import type { EffortLevel } from "../config/schema.js";
import type { McpServerState } from "../mcp/readiness.js";
import type { FlapHistoryEntry } from "./filter-tools-by-capability-probe.js";
import type { AttemptRecord } from "./recovery/types.js";
import type { FsCapabilitySnapshot } from "./persistent-session-handle.js";
import type { RateLimitTracker } from "../usage/rate-limit-tracker.js";
import {
  type SkillUsageTracker,
  extractSkillMentions,
} from "../usage/skill-usage-tracker.js";
// Phase 117 Plan 04 T03/T04 — native advisor budget observer (typed deps).
// `EventEmitter` is the bus exposed on SessionManager.advisorEvents; the
// adapter emits the two observational events on it. `AdvisorBudget`
// receives recordCall per `usage.iterations[].type === "advisor_message"`
// entry at the terminal `result` event (ground-truth count per RESEARCH §13.6).
import type { EventEmitter } from "node:events";
import type { AdvisorBudget } from "../usage/advisor-budget.js";
import type {
  AdvisorInvokedEvent,
  AdvisorResultedEvent,
} from "../advisor/types.js";
import { createPersistentSessionHandle } from "./persistent-session-handle.js";
// Phase 115 sub-scope 14 — fs/os/path imports for the diagnostic baseopts
// dump helper. T03 collapsed the previous TWO separate imports (a top-of-
// file standalone writeFile from the 2026-05-07 hotfix + a separate mkdir)
// into a single combined import. The hardcoded agent-name set that those
// imports originally enabled has been removed — gating now lives entirely
// in `agents[*].debug.dumpBaseOptionsOnSpawn`.
import { writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join as pathJoin } from "node:path";

/**
 * Phase 115 sub-scope 14 — secret redaction helper for diagnostic dumps.
 *
 * Walks a value structurally; for any object key matching the secret-key
 * regex, replaces its value with "<REDACTED>". For string leaves whose
 * content begins with a known secret value-prefix (sk-ant-, Bearer , etc.),
 * also replaces with "<REDACTED>". Circular references emit "<CIRCULAR>"
 * exactly once and do not loop.
 *
 * Permanent (kept after T03 removes the hardcoded allowlist) — every dump
 * call routes through this helper before serialization.
 */
function redactSecrets<T>(value: T): T {
  // REDACTED targets per Phase 115 threat model: ANTHROPIC_API_KEY (env var), OAuth bearer (Bearer prefix), Discord token (*_TOKEN/DISCORD_TOKEN key match).
  // Each is HIGH severity in the 115-02 threat-model table; tests assert redaction for all three.
  const SECRET_KEYS =
    /^(ANTHROPIC_API_KEY|OPENAI_API_KEY|DISCORD_TOKEN|DISCORD_BOT_TOKEN|GITHUB_TOKEN|.*_TOKEN|.*_KEY|.*_SECRET|password|credentials)$/i;
  const SECRET_VALUE_PREFIXES = [
    "sk-ant-", // Anthropic API key
    "sk-", // OpenAI / generic API key
    "ghp_", // GitHub personal access token
    "ghs_", // GitHub server token
    "Bearer ", // OAuth bearer literal (e.g. ~/.claude/.credentials.json)
  ];

  const seen = new WeakSet<object>();

  function recurse(node: unknown): unknown {
    if (node === null || node === undefined) return node;
    if (typeof node === "string") {
      for (const prefix of SECRET_VALUE_PREFIXES) {
        if (node.startsWith(prefix)) return "<REDACTED>";
      }
      return node;
    }
    if (typeof node !== "object") return node;
    if (seen.has(node as object)) return "<CIRCULAR>";
    seen.add(node as object);
    if (Array.isArray(node)) return node.map(recurse);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (SECRET_KEYS.test(k)) {
        out[k] = "<REDACTED>";
      } else {
        out[k] = recurse(v);
      }
    }
    return out;
  }

  return recurse(value) as T;
}

/**
 * Phase 115 sub-scope 14 — debug dump baseopts on agent spawn.
 *
 * **History.** Pre-Phase-115: a hardcoded set of two production agent
 * names plus a top-of-file standalone writeFile import, deployed during
 * the 2026-05-07 incident response.
 * **Phase 115 sub-scope 14 (this plan).** Replaced with config flag
 * `agents[*].debug.dumpBaseOptionsOnSpawn` (default false). T01 plumbed
 * the flag alongside the agent-name set (transition state). T03 removed
 * the agent-name set + collapsed the duplicate writeFile import — the
 * flag is now the SOLE gate.
 *
 * **To enable for an agent**: set `debug: { dumpBaseOptionsOnSpawn: true }`
 * in `clawcode.yaml` under that agent's entry, then deploy. No code
 * change required.
 *
 * **Output**: per-agent under
 * `~/.clawcode/agents/<agent>/diagnostics/baseopts-<flow>-<ts>.json`
 * (slugified agent name, ts in unix-epoch milliseconds). Operator-
 * readable; never written to /tmp (the original 2026-05-07 path was
 * /tmp — Phase 115 moves it under the daemon's home tree for easier
 * cleanup + permission isolation).
 *
 * **Redaction**: secrets are stripped via `redactSecrets` (regex-match on
 * key names + value-prefix detection — ANTHROPIC_API_KEY, OAuth bearer,
 * Discord token; threat-model HIGH severity for each). Defense-in-depth:
 * env + mcpServers[].env are wholesale-stripped (set to "<stripped>")
 * BEFORE redactSecrets walks the rest of the structure, so unknown env
 * vars still get blanked even when the regex doesn't match.
 *
 * **Failure semantics**: failures are silenced — diagnostic capture MUST
 * NEVER break session boot. The catch swallows mkdir / write errors.
 */
async function debugDumpBaseOptions(
  flow: "create" | "resume",
  agentName: string,
  baseOptions: SdkQueryOptions & { readonly mutableSuffix?: string },
  dumpEnabled: boolean,
): Promise<void> {
  // T03 final state — flag is the SOLE gate. The hardcoded agent-name set
  // that previously fell through this branch has been removed; an operator
  // who wants the dump for any agent (the two previously-special-cased
  // production agents included) sets `debug.dumpBaseOptionsOnSpawn: true`
  // in clawcode.yaml and redeploys.
  if (!dumpEnabled) return;
  try {
    // Wholesale strip env + mcpServers[].env BEFORE redactSecrets walks the
    // rest. Defense-in-depth: regex catches known secret-key patterns; the
    // wholesale strip catches everything else in the env namespace.
    const sanitizedMcp = Array.isArray(baseOptions.mcpServers)
      ? baseOptions.mcpServers.map((s) => ({ ...s, env: "<stripped>" }))
      : Object.fromEntries(
          Object.entries(baseOptions.mcpServers ?? {}).map(([k, v]) => [
            k,
            { ...(v as object), env: "<stripped>" },
          ]),
        );
    const dumpInput = {
      ts: new Date().toISOString(),
      flow,
      agent: agentName,
      baseOptions: {
        ...baseOptions,
        env: "<stripped>",
        mcpServers: sanitizedMcp,
      },
    };
    // Apply redactSecrets to catch any remaining secret-shaped values
    // anywhere in the structure (e.g., a stray Bearer token in headers,
    // an ANTHROPIC_API_KEY captured in a comment, etc.).
    const redacted = redactSecrets(dumpInput);
    const slug = agentName.replace(/\s+/g, "_");
    const dirPath = pathJoin(
      homedir(),
      ".clawcode",
      "agents",
      slug,
      "diagnostics",
    );
    await mkdir(dirPath, { recursive: true });
    const filePath = pathJoin(
      dirPath,
      `baseopts-${flow}-${Date.now()}.json`,
    );
    await writeFile(filePath, JSON.stringify(redacted, null, 2));
  } catch {
    /* non-fatal — diagnostic capture MUST NEVER break session boot */
  }
}

/**
 * Phase 115 sub-scope 13(a) — `prompt-bloat-suspected` classifier.
 *
 * Pure function: callers supply the SDK error + the latest known stable-
 * prefix length for the agent + a logger; the classifier decides whether
 * to emit a `[diag] likely-prompt-bloat` warn line. Threshold 20,000 chars
 * is initial; future plans (115-08) may refine based on observed false-
 * positive rate.
 *
 * The daemon-side log line is the operator-visible contract — it surfaces
 * in the `clawcode-status` slash command + dashboard via TraceCollector
 * counter (when wired by 115-00-T02; until then the counter is best-effort
 * and silently no-ops on missing column).
 *
 * Trigger conditions (BOTH must hold):
 *   1. Error message contains "invalid_request_error" OR "400"
 *   2. latestStablePrefixChars > PROMPT_BLOAT_THRESHOLD
 *
 * Returns `true` when the classifier fires (test-friendly handle), `false`
 * when the error doesn't match either condition.
 */
export const PROMPT_BLOAT_THRESHOLD = 20_000; // chars — D-04 baseline

export interface PromptBloatLogger {
  warn(obj: Record<string, unknown>, msg?: string): void;
}

export interface PromptBloatTraceSink {
  /**
   * Best-effort counter increment. Implementations MUST swallow internal
   * errors (e.g. missing `prompt_bloat_warnings_24h` column when 115-00-T02
   * has not landed yet). Classifier is operator-visibility-first; the trace
   * counter is a follow-on metric, not a correctness invariant.
   */
  incrementPromptBloatWarning(agentName: string): void;
}

export function classifyPromptBloat(
  error: unknown,
  latestStablePrefixChars: number,
  agentName: string,
  log: PromptBloatLogger,
  traceSink?: PromptBloatTraceSink,
): boolean {
  const msg = (error as { message?: string } | null)?.message ?? "";
  const isInvalidReq =
    msg.includes("invalid_request_error") || msg.includes("400");
  if (!isInvalidReq) return false;
  if (latestStablePrefixChars <= PROMPT_BLOAT_THRESHOLD) return false;

  log.warn(
    {
      agent: agentName,
      promptChars: latestStablePrefixChars,
      threshold: PROMPT_BLOAT_THRESHOLD,
      action: "prompt-bloat-suspected",
    },
    "[diag] likely-prompt-bloat",
  );

  if (traceSink) {
    try {
      traceSink.incrementPromptBloatWarning(agentName);
    } catch {
      /*
       * Phase 115 dependency note: traces.db.prompt_bloat_warnings_24h
       * column is added by 115-00-T02 (separate plan, possibly different
       * worktree/wave). Until that DDL lands, the increment may throw
       * SQLITE_ERROR "no such column". The classifier's primary contract
       * is the operator-visible log line above; the counter is a follow-
       * on metric, so a missing column degrades gracefully without
       * breaking the warn path.
       */
    }
  }

  return true;
}

/**
 * Phase 115 sub-scope 14 — exported for unit testing (redaction + gate
 * behaviour). Production code calls `debugDumpBaseOptions` above.
 *
 * T03 dropped the previously-exported agent-name set from this bundle —
 * the hardcoded allowlist no longer exists and the test surface no
 * longer needs it.
 */
export const _internal_phase115 = {
  redactSecrets,
  debugDumpBaseOptions,
} as const;

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
 * Phase 117 Plan 04 T03/T04 — native advisor observer wiring.
 *
 * Threaded into the adapter so `iterateWithTracing` can:
 *
 *   1. Scan each parent assistant message's `content[]` for the pair
 *      `server_tool_use{name:"advisor"}` + `advisor_tool_result` and
 *      emit `advisor:invoked` / `advisor:resulted` on `advisorEvents`
 *      (RESEARCH §13.1 — `server_tool_use.input` is always empty `{}`;
 *      §13.3 — both blocks arrive in the SAME assistant message's
 *      `content[]`; §13.4 — three result-content variants).
 *
 *   2. At the terminal `result` event, count
 *      `usage.iterations[].type === "advisor_message"` entries and call
 *      `advisorBudget.recordCall(agentName)` ONCE PER ITERATION (ground-
 *      truth count per RESEARCH §13.6). The per-block scan in step 1 is
 *      the EARLY signal for Discord visibility; only the terminal event
 *      charges the budget — they must NOT double-record (RESEARCH §6
 *      Pitfall 4 boundary). The block scan emits events; the result
 *      iteration parser records the call. Different responsibilities.
 *
 * Observational ONLY (RESEARCH §6 Pitfall 1 + Pitfall 7 invariant):
 * every emit and recordCall is wrapped in try/catch in the adapter so a
 * listener throw or a DB write failure cannot break the parent message
 * path. The adapter mirrors the existing `skillTracking` observational
 * contract — same fail-silent guardrails (line 1722 in this file).
 *
 * Optional throughout — when absent (test paths, agents with the fork
 * backend, agents that explicitly disabled the advisor in config), the
 * observer is a no-op. Production SessionManager threads this in via
 * `makeAdvisorObserver(agentName)` once `advisorBudget` is wired through
 * `SessionManagerOptions` (daemon edge).
 *
 * See:
 *   - `src/advisor/types.ts` — `AdvisorInvokedEvent`, `AdvisorResultedEvent`
 *     event payload shapes.
 *   - `src/usage/advisor-budget.ts` — `AdvisorBudget.recordCall(agent)`.
 *   - `.planning/phases/117-claude-code-advisor-pattern-multi-backend-scaffold-anthropic/117-RESEARCH.md`
 *     §2.1 (parse strategy), §13.1/13.3/13.4 (block shapes), §13.6
 *     (terminal-event iterations), §13.10 (emitter ownership).
 */
export type AdvisorObserverConfig = {
  readonly agentName: string;
  readonly advisorEvents: EventEmitter;
  readonly advisorBudget: AdvisorBudget;
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
   * Phase 96 Plan 01 D-CONTEXT — per-handle filesystem capability snapshot
   * accessor. Lazy-init: returns an empty Map until the first runFsProbe
   * outcome is populated by SessionManager (boot probe + heartbeat tick +
   * on-demand). Read by Plan 96-02 prompt-builder, Plan 96-03
   * clawcode_list_files, Plan 96-04 share-file boundary check.
   *
   * 6th application of the post-construction DI mirror pattern.
   */
  getFsCapabilitySnapshot: () => ReadonlyMap<string, FsCapabilitySnapshot>;
  setFsCapabilitySnapshot: (snapshot: ReadonlyMap<string, FsCapabilitySnapshot>) => void;
  /**
   * Phase 103 OBS-04 / OBS-05 — per-handle RateLimitTracker mirror (DI'd
   * post-construction by SessionManager so `iterateUntilResult` can dispatch
   * rate_limit_event messages without reaching into SessionManager's private
   * maps). 7th application of the post-construction DI mirror pattern (after
   * McpState, FlapHistory, RecoveryAttemptHistory, SupportedCommands,
   * ModelMirror, FsCapability).
   *
   * `getRateLimitTracker` returns undefined until `setRateLimitTracker` has
   * been called. The dispatch path uses optional-chaining so the race window
   * between handle construction and tracker injection silently drops events
   * (Pitfall 8 — best-effort capture).
   */
  getRateLimitTracker: () => RateLimitTracker | undefined;
  setRateLimitTracker: (tracker: RateLimitTracker) => void;
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
    // Phase 117 Plan 04 T03/T04 — native advisor observer. Optional so
    // mock adapters / test paths / fork-backend agents skip it.
    advisorObserver?: AdvisorObserverConfig,
  ): Promise<SessionHandle>;
  resumeSession(
    sessionId: string,
    config: AgentSessionConfig,
    usageCallback?: UsageCallback,
    prefixHashProvider?: PrefixHashProvider,
    skillTracking?: SkillTrackingConfig,
    advisorObserver?: AdvisorObserverConfig,
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
   * Phase 96 Plan 01 D-CONTEXT — test-mock filesystem capability snapshot
   * accessor. In-memory map, no fs interaction. Tests can drive
   * setFsCapabilitySnapshot to exercise downstream consumers (Plans
   * 96-02/03/04 prompt-builder / list-files / share-file).
   */
  private fsCapabilitySnapshot: ReadonlyMap<string, FsCapabilitySnapshot> = new Map();
  getFsCapabilitySnapshot(): ReadonlyMap<string, FsCapabilitySnapshot> {
    return this.fsCapabilitySnapshot;
  }
  setFsCapabilitySnapshot(snapshot: ReadonlyMap<string, FsCapabilitySnapshot>): void {
    this.fsCapabilitySnapshot = new Map(snapshot);
  }

  /**
   * Phase 103 OBS-04 — test-mock RateLimitTracker accessor. Tests can drive
   * setRateLimitTracker to exercise downstream consumers (Plan 03 IPC +
   * /clawcode-status / /clawcode-usage renderers).
   */
  private rateLimitTracker: RateLimitTracker | undefined = undefined;
  getRateLimitTracker(): RateLimitTracker | undefined {
    return this.rateLimitTracker;
  }
  setRateLimitTracker(tracker: RateLimitTracker): void {
    this.rateLimitTracker = tracker;
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
  // Phase 117 Plan 04 T03/T04 — mirror the observer wiring on the mock
  // so test paths can assert "advisor observer wired" without spinning
  // up the SDK. Captured per-session for inspection by tests.
  readonly advisorObservers: Map<string, AdvisorObserverConfig> = new Map();
  private counter = 0;

  async createSession(
    config: AgentSessionConfig,
    usageCallback?: UsageCallback,
    prefixHashProvider?: PrefixHashProvider,
    skillTracking?: SkillTrackingConfig,
    advisorObserver?: AdvisorObserverConfig,
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
    if (advisorObserver) {
      this.advisorObservers.set(sessionId, advisorObserver);
    }
    return handle;
  }

  async resumeSession(
    sessionId: string,
    config: AgentSessionConfig,
    usageCallback?: UsageCallback,
    prefixHashProvider?: PrefixHashProvider,
    skillTracking?: SkillTrackingConfig,
    advisorObserver?: AdvisorObserverConfig,
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
    if (advisorObserver) {
      this.advisorObservers.set(sessionId, advisorObserver);
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
 *
 * # SDK shape invariant (LOCKED — DO NOT MODIFY)
 *
 *   { type: "preset",
 *     preset: "claude_code",
 *     append: <stablePrefix>,
 *     excludeDynamicSections: <bool> }
 *
 * This shape is locked across phases because the Claude Code CLI subprocess
 * owns the actual API request; the daemon hands it the preset+append form
 * as a *routing instruction* — "this stuff is stable, please cache it."
 * Replacing this with a raw `string` systemPrompt would strip the preset's
 * cache scaffolding and bypass `excludeDynamicSections`.
 *
 * Phase history (lock invariants — each phase only adds bytes / flags
 * INSIDE the locked shape; none has changed the shape itself):
 *
 *   - **Phase 52 Plan 02:** introduced the preset+append separation.
 *     `append` carries the daemon-assembled stable prefix; mutable
 *     content goes through the user-message preamble instead.
 *   - **Phase 115 sub-scope 2 (Plan 115-01):** added the
 *     `excludeDynamicSections` flag (defaults true). When true, the
 *     SDK strips per-machine dynamic sections (cwd, auto-memory paths,
 *     git status) from the cached system prompt and re-injects them
 *     as the first user message — improves cross-agent prompt-cache
 *     reuse. Has no effect when systemPrompt is a string (custom
 *     prompt), but our preset shape honors it. Per Phase 115 D-02 the
 *     flag is default-on with explicit revert path via per-agent /
 *     defaults config.
 *   - **Phase 115 sub-scope 5 (Plan 115-04):** the `append` value now
 *     contains a `<!-- phase115-cache-breakpoint -->` HTML-comment
 *     marker between the static and dynamic portions of the stable
 *     prefix (when `cacheBreakpointPlacement === "static-first"`,
 *     which is the default). The marker is INSIDE the cached append
 *     bytes — Anthropic's prompt cache sees it as just bytes; the
 *     marker's only role is letting downstream observability
 *     (Plan 115-08) hash-split the static vs dynamic portions for
 *     diagnostics. The SDK call shape itself is UNCHANGED — only the
 *     content of `stablePrefix` carries the marker.
 *
 * NEVER replace this with a raw `string` systemPrompt — that loses the
 * preset's cache scaffolding AND silently drops the breakpoint marker.
 */
export function buildSystemPromptOption(
  stablePrefix: string,
  excludeDynamicSections?: boolean,
):
  | {
      readonly type: "preset";
      readonly preset: "claude_code";
      readonly append: string;
      readonly excludeDynamicSections?: boolean;
    }
  | {
      readonly type: "preset";
      readonly preset: "claude_code";
      readonly excludeDynamicSections?: boolean;
    } {
  // Spread-conditional: omit excludeDynamicSections when the caller did
  // not pass a value (legacy callers / tests stay byte-identical to the
  // pre-115 shape). When passed, forward verbatim — SDK accepts true|false.
  const dyn =
    excludeDynamicSections !== undefined
      ? { excludeDynamicSections }
      : ({} as Record<string, never>);
  if (stablePrefix.length > 0) {
    return {
      type: "preset" as const,
      preset: "claude_code" as const,
      append: stablePrefix,
      ...dyn,
    };
  }
  return {
    type: "preset" as const,
    preset: "claude_code" as const,
    ...dyn,
  };
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
    advisorObserver?: AdvisorObserverConfig,
  ): Promise<SessionHandle> {
    const sdk = await loadSdk();
    const mcpServers = transformMcpServersForSdk(config.mcpServers);
    // Phase 100 GSD-02 + GSD-04 (RESEARCH.md Architecture Pattern 5 —
    // per-agent cwd plumbing): cwd and settingSources are now config-driven.
    //   - cwd: config.gsd?.projectDir overrides config.workspace when the
    //     agent has a gsd block (e.g. Admin Clawdy → /opt/clawcode-projects/sandbox).
    //     The fleet (no gsd) keeps cwd === config.workspace as before.
    //   - settingSources: config.settingSources overrides ["project"] when
    //     set (e.g. Admin Clawdy → ["project","user"] to load
    //     ~/.claude/commands/ + ~/.claude/skills/). The fleet (no
    //     settingSources) keeps the ["project"] default.
    // Symmetric edit pattern: resumeSession (below) MUST receive identical
    // treatment — Rule 3 (RESEARCH.md Pitfall ordering pin).
    const baseOptions: SdkQueryOptions & { readonly mutableSuffix?: string } = {
      model: resolveModelId(config.model),
      // Phase 83 EFFORT-04 — narrow v2.2 EffortLevel ("xhigh"/"auto"/"off")
      // to the SDK's start-option subset before assignment. Runtime control
      // for the wider set lives on q.setMaxThinkingTokens.
      effort: narrowEffortForSdkOption(config.effort),
      cwd: config.gsd?.projectDir ?? config.workspace,
      // Phase 52 Plan 02: preset+append form — SDK claude_code preset auto-caches.
      // Phase 115 sub-scope 2 — `excludeDynamicSections` forwarded so the SDK
      // strips per-machine dynamic sections (cwd, auto-memory, git status) out
      // of the cached system prompt and re-injects them as the first user
      // message; resumeSession (below) MUST mirror this — Rule 3 symmetric edit.
      systemPrompt: buildSystemPromptOption(
        config.systemPrompt,
        config.excludeDynamicSections,
      ),
      permissionMode: "bypassPermissions",
      settingSources: config.settingSources ?? ["project"],
      env: buildCleanEnv(),
      ...(config.mutableSuffix ? { mutableSuffix: config.mutableSuffix } : {}),
      ...(mcpServers ? { mcpServers } : {}),
      // Phase 99 sub-scope N (2026-04-26) — SDK-level deny-list. When set
      // (subagent recursion guard injects this in
      // src/discord/subagent-thread-spawner.ts), the LLM physically cannot
      // invoke the listed tools. Empty/undefined → field omitted from
      // baseOptions so the existing 15+ agent fleet stays byte-identical
      // (matches mutableSuffix / settingSources spread-conditional pattern
      // above). Symmetric edit: resumeSession (below) MUST receive identical
      // treatment — Rule 3.
      ...(config.disallowedTools && config.disallowedTools.length > 0
        ? { disallowedTools: [...config.disallowedTools] }
        : {}),
    };

    // Phase 115 sub-scope 2 (115-sub2-flag) — diagnostic trace so the first
    // production deploy can confirm the flag is reaching the SDK. console.info
    // chosen over pino because session-adapter intentionally has no DI'd
    // logger (matches the existing PromptBloatLogger interface pattern at
    // line 192 — adapter stays framework-agnostic). Daemon captures stdout
    // into structured logs via systemd. Single-line JSON for grep + dashboard.
    console.info(
      "phase115-quickwin",
      JSON.stringify({
        agent: config.name,
        excludeDynamicSections: config.excludeDynamicSections,
        action: "115-sub2-flag",
        flow: "create",
      }),
    );

    // Phase 115 sub-scope 14 — diagnostic baseopts dump (T01 transition state).
    // Both gates active: hardcoded allowlist OR per-agent flag. T03 removes the
    // allowlist; flag becomes sole gate. Failure is non-fatal (helper swallows).
    const dumpEnabled = config.debug?.dumpBaseOptionsOnSpawn ?? false;
    await debugDumpBaseOptions("create", config.name, baseOptions, dumpEnabled);

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
      advisorObserver,
    );
  }

  async resumeSession(
    sessionId: string,
    config: AgentSessionConfig,
    usageCallback?: UsageCallback,
    prefixHashProvider?: PrefixHashProvider,
    skillTracking?: SkillTrackingConfig,
    advisorObserver?: AdvisorObserverConfig,
  ): Promise<SessionHandle> {
    const sdk = await loadSdk();
    const mcpServers = transformMcpServersForSdk(config.mcpServers);
    // Phase 100 GSD-02 + GSD-04 (RESEARCH.md Architecture Pattern 5 —
    // per-agent cwd plumbing): SAME treatment as createSession. Reading cwd
    // from config.gsd?.projectDir and settingSources from config.settingSources
    // ensures a resumed session uses the SAME values the original was created
    // with — no drift on resume. Rule 3 symmetric-edits enforced.
    const baseOptions: SdkQueryOptions & { readonly mutableSuffix?: string } = {
      model: resolveModelId(config.model),
      // Phase 83 EFFORT-04 — narrow same as createSession path. Symmetric
      // edits enforced by RESEARCH.md Pitfall ordering pin.
      effort: narrowEffortForSdkOption(config.effort),
      cwd: config.gsd?.projectDir ?? config.workspace,
      // Phase 52 Plan 02: preset+append form — SDK claude_code preset auto-caches.
      // Phase 115 sub-scope 2 — symmetric mirror of createSession above
      // (Rule 3 symmetric-edits). A resumed session MUST carry the same
      // excludeDynamicSections setting as the original create call.
      systemPrompt: buildSystemPromptOption(
        config.systemPrompt,
        config.excludeDynamicSections,
      ),
      permissionMode: "bypassPermissions",
      settingSources: config.settingSources ?? ["project"],
      resume: sessionId,
      env: buildCleanEnv(),
      ...(config.mutableSuffix ? { mutableSuffix: config.mutableSuffix } : {}),
      ...(mcpServers ? { mcpServers } : {}),
      // Phase 99 sub-scope N (2026-04-26) — symmetric mirror of createSession's
      // disallowedTools wiring above. A resumed session MUST carry the same
      // SDK deny-list as the original create call so a daemon restart cannot
      // unlock the recursion tool on a previously-locked subagent. Rule 3
      // symmetric-edits enforced.
      ...(config.disallowedTools && config.disallowedTools.length > 0
        ? { disallowedTools: [...config.disallowedTools] }
        : {}),
    };

    // Phase 115 sub-scope 2 (115-sub2-flag) — symmetric diagnostic mirror of
    // createSession (Rule 3). flow:"resume" so operator can distinguish.
    console.info(
      "phase115-quickwin",
      JSON.stringify({
        agent: config.name,
        excludeDynamicSections: config.excludeDynamicSections,
        action: "115-sub2-flag",
        flow: "resume",
      }),
    );

    // Phase 115 sub-scope 14 — diagnostic baseopts dump on resume (T01
    // transition state). Symmetric mirror of createSession above — Rule 3
    // symmetric-edits enforced. Same gate semantics: allowlist OR flag in
    // T01; flag-only after T03.
    const dumpEnabled = config.debug?.dumpBaseOptionsOnSpawn ?? false;
    await debugDumpBaseOptions("resume", config.name, baseOptions, dumpEnabled);

    // Phase 73 Plan 01 — persistent handle (no per-turn sdk.query spawn).
    return createPersistentSessionHandle(
      sdk,
      baseOptions,
      sessionId,
      usageCallback,
      prefixHashProvider,
      skillTracking,
      advisorObserver,
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
 *
 * Phase 117 Plan 04 T04 — ALSO counts `usage.iterations[].type ===
 * "advisor_message"` entries on the terminal `result` event and calls
 * `advisorObserver.advisorBudget.recordCall(agent)` once per iteration.
 * Mirrors the production-path implementation in
 * `persistent-session-handle.ts:extractUsage` so test-only callers
 * (`createTracedSessionHandle`) exercise the same budget accounting.
 * The per-block scan inside `iterateWithTracing` is the early Discord
 * signal; this is the ground-truth budget charge (RESEARCH §13.6 +
 * §6 Pitfall 4 — no double-record).
 */
function extractUsage(
  msg: SdkStreamMessage,
  callback?: UsageCallback,
  advisorObserver?: AdvisorObserverConfig,
): void {
  if (msg.type !== "result") return;

  // Advisor iteration counting (observational; same fail-silent
  // contract as the rest of this function and as the production
  // implementation in persistent-session-handle.ts).
  if (advisorObserver) {
    try {
      const iterations = (msg as { usage?: { iterations?: unknown[] | null } })
        .usage?.iterations;
      if (Array.isArray(iterations)) {
        for (const entry of iterations) {
          if (
            entry !== null &&
            typeof entry === "object" &&
            (entry as { type?: unknown }).type === "advisor_message"
          ) {
            try {
              advisorObserver.advisorBudget.recordCall(
                advisorObserver.agentName,
              );
            } catch {
              // observational — never break message path
            }
          }
        }
      }
    } catch {
      // observational — never break message path
    }
  }

  if (!callback) return;
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
  // Phase 117 Plan 04 T03/T04 — test-path mirror of the production
  // observer wiring. `createTracedSessionHandle` accepts this on
  // TracedSessionHandleOptions and forwards it here; the legacy
  // iterateWithTracing loop emits the same advisor events + budget
  // calls as createPersistentSessionHandle so both paths converge.
  // No production caller reaches wrapSdkQuery (see @deprecated above).
  advisorObserver?: AdvisorObserverConfig,
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
  // Phase 96 Plan 01 D-CONTEXT — legacy fs-capability snapshot (test-only).
  let legacyFsCapabilitySnapshot: ReadonlyMap<string, FsCapabilitySnapshot> = new Map();
  // Phase 103 OBS-04 — legacy per-turn-query handle carries the same
  // RateLimitTracker mirror contract as the persistent handle (test-only
  // path; production routes through createPersistentSessionHandle).
  let legacyRateLimitTracker: RateLimitTracker | undefined;

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
    /**
     * Phase 115 Plan 08 T01 — per-batch roundtrip timer for sub-scope 17(a).
     *
     * `batchOpenedAtMs` holds the wall-clock instant at which the LATEST
     * parent assistant message emitted a tool_use block (i.e., the moment
     * the LLM stopped generating that turn). It is closed when the NEXT
     * parent assistant message arrives — ANY content (text or new
     * tool_use), capturing the SDK dispatch + actual tool runtime + result
     * delivery + LLM resume cost.
     *
     * Per-batch (not per-tool) so parallel batches collapse to one
     * wall-clock interval — the right semantic when 3 tools dispatch in
     * parallel and `next parent assistant` arrives once after the LAST
     * tool_result.
     *
     * Multi-batch turns (model emits sequential tool_use → tool_result →
     * tool_use cycles) accumulate via Turn.addToolRoundtripMs sums.
     */
    let batchOpenedAtMs: number | null = null;
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
      for (const entry of activeTools.values()) {
        entry.span.end();
        // Phase 115 Plan 08 T01 — final-batch execution-side fallback. If
        // the SDK terminated mid-tool (error / abort / timeout) the
        // user-message tool_result branch never fired, so addToolExecutionMs
        // would be skipped for these spans. Compute a best-effort duration
        // from openedAtMs at termination so the column doesn't undercount
        // pathological turns.
        try {
          const executionMs = Date.now() - entry.openedAtMs;
          (turn as { addToolExecutionMs?: (ms: number) => void })
            .addToolExecutionMs?.(executionMs);
        } catch {
          // Observational only — never break.
        }
      }
      activeTools.clear();
      // Phase 115 Plan 08 T01 — final-batch roundtrip fallback. If the run
      // terminated before the LLM emitted a "next parent assistant" message
      // (terminal error, normal completion, or final result-only path), the
      // currently-open batch timer would otherwise be lost. Close it here
      // so the column reflects every batch the run observed.
      try {
        if (batchOpenedAtMs !== null && turn) {
          const roundtripMs = Date.now() - batchOpenedAtMs;
          (turn as { addToolRoundtripMs?: (ms: number) => void })
            .addToolRoundtripMs?.(roundtripMs);
          batchOpenedAtMs = null;
        }
      } catch {
        // Observational only — never break.
      }
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

            // Phase 115 Plan 08 T01 — sub-scope 17(a/b) split-latency.
            //
            // (1) Close the prior batch's roundtrip timer FIRST. This parent
            //     assistant message represents the LLM resuming after the
            //     previous batch's tool_results — exactly the wall-clock
            //     interval we want to record. Wrapped in try/catch so an
            //     observability failure cannot break the dispatch path
            //     (Phase 50 invariant mirrored on every observability hook).
            try {
              if (batchOpenedAtMs !== null && turn) {
                const roundtripMs = Date.now() - batchOpenedAtMs;
                (turn as { addToolRoundtripMs?: (ms: number) => void })
                  .addToolRoundtripMs?.(roundtripMs);
                batchOpenedAtMs = null;
              }
            } catch {
              // Observational only — never break the message path.
            }
            // (2) Record the parallel batch size for sub-scope 17(b). Only
            //     fire when this message HAS tool_use blocks; pure-text
            //     parent assistant messages don't contribute to the MAX.
            try {
              if (toolUseCount > 0 && turn) {
                (turn as { recordParallelToolCallCount?: (n: number) => void })
                  .recordParallelToolCallCount?.(toolUseCount);
                // (3) Open the next batch's roundtrip timer at the moment
                //     this message was observed — closest available proxy
                //     for "LLM finished generating tool_use." Will be
                //     closed when the NEXT parent assistant arrives.
                batchOpenedAtMs = Date.now();
              }
            } catch {
              // Observational only — never break the message path.
            }

            // Phase 117 Plan 04 T03 — pending advisor tool_use id, scoped
            // to THIS assistant message's content[]. See production
            // mirror in persistent-session-handle.ts and RESEARCH §13.3.
            let pendingAdvisorToolUseId: string | null = null;
            const messageUuid =
              typeof (msg as { uuid?: unknown }).uuid === "string"
                ? (msg as { uuid: string }).uuid
                : sessionId;

            for (const raw of contentBlocks) {
              const block = raw as {
                type?: string;
                name?: string;
                id?: string;
                text?: string;
                tool_use_id?: string;
                content?: unknown;
              };
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
              // Phase 117 Plan 04 T03 — native advisor observation.
              // Test-path mirror of the production-path implementation
              // in persistent-session-handle.ts (single source of truth
              // for the block-shape contract: RESEARCH §13.1 + §13.3 +
              // §13.4). Both paths emit the same two events on the same
              // EventEmitter (passed in via advisorObserver) so a test
              // that uses createTracedSessionHandle exercises the exact
              // listener wiring production uses.
              if (
                advisorObserver &&
                block.type === "server_tool_use" &&
                block.name === "advisor" &&
                typeof block.id === "string"
              ) {
                pendingAdvisorToolUseId = block.id;
                try {
                  const payload: AdvisorInvokedEvent = {
                    agent: advisorObserver.agentName,
                    turnId: messageUuid,
                    toolUseId: block.id,
                  };
                  advisorObserver.advisorEvents.emit(
                    "advisor:invoked",
                    payload,
                  );
                } catch {
                  // observational only — never break the message path
                }
              }
              if (
                advisorObserver &&
                block.type === "advisor_tool_result" &&
                typeof block.tool_use_id === "string" &&
                block.tool_use_id === pendingAdvisorToolUseId
              ) {
                try {
                  const content = block.content as
                    | { type: "advisor_result"; text: string }
                    | { type: "advisor_redacted_result"; encrypted_content: string }
                    | { type: "advisor_tool_result_error"; error_code: string }
                    | null
                    | undefined;
                  const kind =
                    content && typeof content === "object" && "type" in content
                      ? content.type
                      : undefined;
                  if (
                    kind === "advisor_result" ||
                    kind === "advisor_redacted_result" ||
                    kind === "advisor_tool_result_error"
                  ) {
                    const payload: AdvisorResultedEvent = {
                      agent: advisorObserver.agentName,
                      turnId: messageUuid,
                      toolUseId: pendingAdvisorToolUseId,
                      kind,
                      text:
                        kind === "advisor_result"
                          ? (content as { text: string }).text
                          : undefined,
                      errorCode:
                        kind === "advisor_tool_result_error"
                          ? (content as { error_code: string }).error_code
                          : undefined,
                    };
                    advisorObserver.advisorEvents.emit(
                      "advisor:resulted",
                      payload,
                    );
                  }
                } catch {
                  // observational only — never break the message path
                }
                pendingAdvisorToolUseId = null;
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

        // Local SdkMessage union narrows away "user" (matches the
        // stream_event note above) but the runtime SDK does emit user
        // messages with `parent_tool_use_id` for tool_use_result delivery.
        // Recover the runtime shape via a string-typed read — same pattern
        // already used for stream_event handling at line ~1089.
        if ((msg as { type?: string }).type === "user") {
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
              // Phase 115 Plan 08 T01 — sub-scope 17(a) execution-side
              // latency aggregation. The span's duration is exactly the
              // pure-execution interval (tool_use_emitted →
              // tool_result_arrived) per the audit; sum across every tool
              // call in the turn. Wrapped in try/catch so observability
              // never breaks the message path (Phase 50 invariant).
              try {
                const executionMs = Date.now() - entry.openedAtMs;
                (turn as { addToolExecutionMs?: (ms: number) => void })
                  .addToolExecutionMs?.(executionMs);
              } catch {
                // Observational only — never break the message path.
              }
              activeTools.delete(toolUseId);
            }
          }
        }

        if (msg.type === "result") {
          if (msg.session_id) sessionId = msg.session_id;
          extractUsage(msg, usageCallback, advisorObserver);
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
     * Phase 96 Plan 01 D-CONTEXT — legacy fs-capability snapshot accessor.
     * Test-only path; production routes through the persistent handle.
     */
    getFsCapabilitySnapshot(): ReadonlyMap<string, FsCapabilitySnapshot> {
      return legacyFsCapabilitySnapshot;
    },
    setFsCapabilitySnapshot(snapshot: ReadonlyMap<string, FsCapabilitySnapshot>): void {
      legacyFsCapabilitySnapshot = new Map(snapshot);
    },

    /**
     * Phase 103 OBS-04 — legacy RateLimitTracker accessor. Test-only path;
     * production routes through createPersistentSessionHandle where the SDK
     * rate_limit_event dispatch lives.
     */
    getRateLimitTracker(): RateLimitTracker | undefined {
      return legacyRateLimitTracker;
    },
    setRateLimitTracker(tracker: RateLimitTracker): void {
      legacyRateLimitTracker = tracker;
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
   * Phase 117 Plan 04 T03/T04 — native advisor observer for the test
   * path. Forwarded into wrapSdkQuery so the legacy `iterateWithTracing`
   * loop fires the SAME `advisor:invoked` / `advisor:resulted` events
   * AND records the SAME budget calls as the production
   * `createPersistentSessionHandle` path. Tests can subscribe to
   * `advisorObserver.advisorEvents` directly to assert observer behavior.
   */
  readonly advisorObserver?: AdvisorObserverConfig;
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
    opts.advisorObserver,
  );
}
