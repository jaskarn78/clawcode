/**
 * TurnDispatcher — the single chokepoint for every agent-turn initiation.
 *
 * Phase 57 foundation. Wraps SessionManager.sendToAgent / streamFromAgent
 * with:
 *   1. origin-prefixed turnId generation (via makeRootOrigin)
 *   2. caller-owned Turn lifecycle (opens + ends the Turn on behalf of the
 *      caller so a new turn source doesn't duplicate the boilerplate)
 *   3. TurnOrigin threading (stored on the Turn via Turn.id === rootTurnId
 *      and forwarded to the trace row in Plan 57-02)
 *
 * Downstream (Plans 57-02, 57-03, Phases 58-63) plug new sources in by
 * calling turnDispatcher.dispatch(origin, agentName, payload) — no new
 * trace/Turn/session boilerplate per source.
 *
 * This plan (57-01) does NOT migrate DiscordBridge or TaskScheduler —
 * those call sites move in Plan 57-03 after Plan 57-02 threads TurnOrigin
 * through the trace store.
 */

import type { Logger } from "pino";
import { logger } from "../shared/logger.js";
import type { SessionManager } from "./session-manager.js";
import type { TurnOrigin } from "./turn-origin.js";
import type { Turn } from "../performance/trace-collector.js";
import type { EffortLevel } from "../config/schema.js";
import type { MemoryRetrievalResult } from "../memory/memory-retrieval.js";
import { detectCue, extractCueContext } from "../memory/memory-cue.js";
import { wrapMcpToolError, type ErrorClass, type ToolCallError } from "./tool-call-error.js";
import { findAlternativeAgents, type McpStateProvider } from "./find-alternative-agents.js";

/** Thrown when dispatch is called with invalid arguments. */
export class TurnDispatcherError extends Error {
  readonly agentName: string | undefined;
  readonly originRootTurnId: string | undefined;
  constructor(message: string, agentName?: string, originRootTurnId?: string) {
    super(`TurnDispatcher: ${message}`);
    this.name = "TurnDispatcherError";
    this.agentName = agentName;
    this.originRootTurnId = originRootTurnId;
  }
}

export type DispatchOptions = {
  /** Discord channel id when this turn is Discord-originated; else null. */
  readonly channelId?: string | null;
  /**
   * Phase 57 Plan 03: caller-owned Turn opt-out.
   *
   * When provided, TurnDispatcher:
   *   1. Does NOT open a new Turn via the TraceCollector (avoids duplicate).
   *   2. Calls `turn.recordOrigin(origin)` exactly once to attach provenance.
   *   3. Does NOT call `turn.end()` — caller retains lifecycle ownership
   *      (mirrors the Phase 50 caller-owned Turn contract used by DiscordBridge
   *      and bench-run-prompt so the caller can stamp additional spans BEFORE
   *      the record is committed).
   *
   * Leave undefined to get the default lifecycle (dispatcher opens + ends Turn).
   */
  readonly turn?: Turn;
  /**
   * Phase 59 -- optional AbortSignal. When provided, the target agent's turn
   * is aborted when the signal fires. TaskManager passes its per-task signal
   * here to enforce chain-wide deadlines (HAND-03) and explicit cancellations.
   *
   * Plumbs through to session-adapter's wrapSdkQuery which wires it onto
   * the SDK's native Options.abortController (sdk.d.ts:957).
   */
  readonly signal?: AbortSignal;
  /**
   * Phase 83 EFFORT-05 — per-skill effort override for this single turn.
   *
   * When set, the dispatcher:
   *   1. Snapshots the agent's current effort via sessionManager.getEffortForAgent.
   *   2. Calls setEffortForAgent(agentName, skillEffort) BEFORE sendToAgent /
   *      streamFromAgent — the SDK's q.setMaxThinkingTokens fires before
   *      the turn starts (Plan 01 wired the synchronous path).
   *   3. After the send completes (success OR error, via try/finally),
   *      calls setEffortForAgent(agentName, priorEffort) to restore.
   *
   * Intended caller: Discord slash-command dispatch site that resolves
   * `skillsCatalog.get(commandName)?.effort` and threads it here. When
   * the invoked skill has no `effort:` frontmatter (or the command isn't
   * a skill at all), omit the field / pass undefined — the dispatcher
   * short-circuits to zero effort-touching side effects.
   *
   * Turn-boundary revert (not tool-call / interrupt granularity) — the SDK's
   * serialTurnQueue guarantees at most one turn per handle at a time, so
   * pre-turn apply + post-turn revert is the correct locking window.
   */
  readonly skillEffort?: EffortLevel;
};

/**
 * Phase 90 MEM-03 — pre-turn memory retriever.
 *
 * Optional DI hook wired by daemon.ts: given an agent name + the user's
 * query text, returns a (frozen) list of relevant memory chunks to
 * prepend to the user's message as a `<memory-context>` block. Lands
 * in the mutable-suffix region (per-turn), NEVER the stable prefix —
 * v1.7 cache stability depends on the stable prefix staying byte-identical
 * across turns.
 *
 * Errors from the retriever are caught and logged — retrieval is strictly
 * best-effort (fail-open): the turn proceeds with the raw user message
 * if retrieval throws.
 */
export type MemoryRetriever = (
  agentName: string,
  query: string,
) => Promise<readonly MemoryRetrievalResult[]>;

/**
 * Phase 90 MEM-05 — cue-memory writer DI signature. Mirrors
 * writeCueMemory(...) from src/memory/memory-cue.ts. When wired, the
 * post-turn hook fires this on every user message whose text matches
 * MEMORY_CUE_REGEX. Fire-and-forget — rejection is warn-logged and does
 * NOT propagate.
 */
export type MemoryCueWriter = (
  args: Readonly<{
    workspacePath: string;
    cue: string;
    context: string;
    turnIso: string;
    messageLink?: string;
  }>,
) => Promise<string>;

/**
 * Phase 90 MEM-06 — subagent-return capture DI signature. Mirrors
 * captureSubagentReturn(...) from src/memory/subagent-capture.ts.
 * Returns null when the subagent_type is gsd-* (D-35 exclusion).
 */
export type SubagentCapture = (
  args: Readonly<{
    workspacePath: string;
    subagent_type: string;
    task_description: string;
    return_summary: string;
    spawned_at_iso: string;
    duration_ms: number;
  }>,
) => Promise<string | null>;

/**
 * Phase 90 MEM-05 — per-agent workspace resolver. Injected by daemon.ts
 * so the dispatcher can derive the on-disk memory/ path without reaching
 * into SessionManager state. Returns undefined when the agent is unknown
 * (daemon not finished registering) — hook short-circuits to no-op.
 */
export type WorkspaceResolver = (agentName: string) => string | undefined;

/**
 * Phase 90 MEM-05 D-32 — Discord reaction adder. When wired, the cue
 * hook fires `discordReact({channelId, messageId}, emoji)` on success of
 * the cue write. Rejection is warn-logged and does NOT propagate
 * (fire-and-forget). OpenAI-endpoint turns and task-scheduled turns skip
 * this entirely (no messageId available).
 */
export type DiscordReactFn = (
  target: Readonly<{ channelId: string; messageId: string }>,
  emoji: string,
) => Promise<void>;

/**
 * Phase 90 MEM-06 — Task tool-return event. Payload the observer needs to
 * construct a captureSubagentReturn call. Shape matches captureSubagentReturn
 * minus workspacePath (resolved via workspaceForAgent).
 */
export type TaskToolReturnEvent = Readonly<{
  subagent_type: string;
  task_description: string;
  return_summary: string;
  spawned_at_iso: string;
  duration_ms: number;
}>;

export type TurnDispatcherOptions = {
  readonly sessionManager: SessionManager;
  readonly log?: Logger;
  /**
   * Phase 90 MEM-03 — optional pre-turn retrieval hook. When undefined,
   * dispatch proceeds with zero memory augmentation (no <memory-context>
   * block, no perf cost). Wired by daemon.ts once both TurnDispatcher and
   * MemoryScanner/SessionManager are constructed.
   */
  readonly memoryRetriever?: MemoryRetriever;
  /**
   * Phase 90 MEM-05 — cue write hook. When wired, every user message
   * that matches MEMORY_CUE_REGEX (D-30) triggers a background write to
   * {workspace}/memory/YYYY-MM-DD-remember-<nanoid>.md (D-31).
   */
  readonly memoryCueWriter?: MemoryCueWriter;
  /**
   * Phase 90 MEM-05 — per-agent workspace resolver. Required when
   * memoryCueWriter is wired (otherwise the hook has nowhere to write).
   * Also consumed by MEM-06 subagent-capture for the same reason.
   */
  readonly workspaceForAgent?: WorkspaceResolver;
  /**
   * Phase 90 MEM-05 D-32 — Discord reaction post-turn. When wired, a
   * successful cue write triggers a ✅ reaction (or config-overridden
   * emoji) on the originating Discord message.
   */
  readonly discordReact?: DiscordReactFn;
  /**
   * Phase 90 MEM-06 — subagent final-report capture. When wired,
   * handleTaskToolReturn forwards Task tool returns (non-gsd-*) to this
   * hook for disk persistence. D-35 gsd-* exclusion is enforced inside
   * the hook itself (isGsdSubagent).
   */
  readonly subagentCapture?: SubagentCapture;
  /**
   * Phase 94 Plan 04 D-06/D-07 — per-agent MCP state provider for
   * cross-agent alternatives lookup. When wired, `executeMcpTool`'s
   * wrap path populates `ToolCallError.alternatives` with healthy agent
   * names whose backing MCP server has `capabilityProbe.status === "ready"`
   * for the named tool. Absent when not yet wired (Plan 94-04 ships the
   * primitive; daemon edge wiring lives where SessionManager is constructed).
   */
  readonly mcpStateProvider?: McpStateProvider;
  /**
   * Phase 94 Plan 04 D-06 — optional per-class suggestion registry.
   * Daemon edge wires a `Record<ErrorClass, string>` (or callable
   * equivalent) here so the LLM receives operator-actionable hints in
   * the `ToolCallError.suggestion` field. Absent when no suggestions
   * are configured — the LLM still receives the structured wrap with
   * verbatim message + classification + alternatives.
   */
  readonly toolErrorSuggestion?: (errorClass: ErrorClass) => string | undefined;
};

/**
 * Phase 94 Plan 04 — return shape from `TurnDispatcher.executeMcpTool`.
 * Mirrors the SDK tool_result slot conceptually:
 *   - `content`: the string the LLM sees (raw success result OR JSON-
 *                stringified ToolCallError on failure)
 *   - `isError`: `true` when content is a wrapped ToolCallError; `false`
 *                on success. Maps directly to the SDK's `is_error` flag
 *                on tool_result blocks so the LLM's tool-result rendering
 *                renders the failure path correctly.
 */
export interface ExecuteMcpToolResult {
  readonly content: string;
  readonly isError: boolean;
}

/**
 * TurnDispatcher — construct once at daemon boot; call dispatch() from
 * every turn source (DiscordBridge, TaskScheduler, future Phase 59 handoff
 * receiver, future Phase 60 trigger engine).
 */
export class TurnDispatcher {
  private readonly sessionManager: SessionManager;
  private readonly log: Logger;
  private readonly memoryRetriever: MemoryRetriever | undefined;
  private readonly memoryCueWriter: MemoryCueWriter | undefined;
  private readonly workspaceForAgent: WorkspaceResolver | undefined;
  private readonly discordReact: DiscordReactFn | undefined;
  private readonly subagentCapture: SubagentCapture | undefined;
  private readonly mcpStateProvider: McpStateProvider | undefined;
  private readonly toolErrorSuggestion: ((errorClass: ErrorClass) => string | undefined) | undefined;

  constructor(options: TurnDispatcherOptions) {
    this.sessionManager = options.sessionManager;
    this.log = (options.log ?? logger).child({ component: "TurnDispatcher" });
    this.memoryRetriever = options.memoryRetriever;
    this.memoryCueWriter = options.memoryCueWriter;
    this.workspaceForAgent = options.workspaceForAgent;
    this.discordReact = options.discordReact;
    this.subagentCapture = options.subagentCapture;
    this.mcpStateProvider = options.mcpStateProvider;
    this.toolErrorSuggestion = options.toolErrorSuggestion;
  }

  /**
   * Phase 94 Plan 04 D-06 — single-source-of-truth MCP tool-call wrap site.
   *
   * Runs the supplied executor exactly ONCE. On success, returns the
   * verbatim content the executor resolved. On rejection, routes the
   * failure through `wrapMcpToolError` (populating alternatives via
   * `findAlternativeAgents` when a state provider is wired) and returns
   * the JSON-stringified `ToolCallError` shape with `isError: true`.
   *
   * NO SILENT RETRY here. Recovery (Plan 94-03) is heartbeat-driven and
   * lives at the connection layer; this method's contract is single-
   * attempt-then-wrap so the LLM sees the structured failure and adapts
   * naturally (asks the user, switches to an alternative agent, etc.).
   *
   * Production tool-call execution paths funnel through this method so
   * the wrap behavior is uniform across every MCP-backed tool. Direct
   * invocation of MCP tool calls without this wrap is a regression and
   * pinned by static-grep against the call site.
   */
  async executeMcpTool(
    toolName: string,
    executor: () => Promise<string>,
  ): Promise<ExecuteMcpToolResult> {
    try {
      const content = await executor();
      return { content, isError: false };
    } catch (err) {
      const wrapped: ToolCallError = wrapMcpToolError(err as Error, {
        tool: toolName,
        findAlternatives: this.mcpStateProvider
          ? () => findAlternativeAgents(toolName, this.mcpStateProvider!)
          : undefined,
        suggestionFor: this.toolErrorSuggestion,
      });
      // Best-effort log so operators can correlate the wrap with the
      // upstream symptom; observational only — never breaks the wrap path.
      try {
        this.log.warn(
          {
            tool: toolName,
            errorClass: wrapped.errorClass,
            alternatives: wrapped.alternatives,
          },
          "mcp tool call rejected — wrapped as ToolCallError",
        );
      } catch {
        // observational path — never block the wrap
      }
      return { content: JSON.stringify(wrapped), isError: true };
    }
  }

  /**
   * Dispatch a non-streaming turn. Mirrors SessionManager.sendToAgent's
   * return shape (the collected response string).
   *
   * Opens a Turn via the agent's TraceCollector (if wired), sets id to
   * origin.rootTurnId (already source-prefixed), and ends the Turn with
   * success/error before returning/throwing. If no collector is wired
   * for `agentName` (test scenarios / agent not yet running), dispatch
   * still succeeds — it forwards `undefined` for the Turn arg.
   */
  async dispatch(
    origin: TurnOrigin,
    agentName: string,
    message: string,
    options: DispatchOptions = {},
  ): Promise<string> {
    if (agentName.length === 0) {
      throw new TurnDispatcherError("agentName must be non-empty", agentName, origin.rootTurnId);
    }

    // Phase 83 EFFORT-05 — capture prior effort + apply per-skill override.
    // Only reaches into the session handle when options.skillEffort is set
    // (zero side effects on the normal path). Snapshot happens AT dispatch
    // time so live /clawcode-effort changes between turns propagate correctly.
    const priorEffort = this.applySkillEffort(agentName, options.skillEffort);

    // Phase 90 MEM-05 — fire-and-forget cue detection on the RAW user
    // message (not the augmented one). Runs BEFORE the SDK send so the
    // cue write races the turn; scanner picks it up on the next poll
    // (but the current turn still sees any prior standing rules via MEM-03
    // retrieval). Synchronous caller: no await — .catch on the inner
    // Promise swallows rejections with a warn log.
    this.maybeFireCueHook(origin, agentName, message, options.channelId ?? null);

    // Phase 90 MEM-03 — pre-turn hybrid RRF retrieval. Prepends a
    // <memory-context> block to the user message when chunks are found.
    // Lands in mutable suffix — stable prefix cache untouched. Fail-open.
    const augmentedMessage = await this.augmentWithMemoryContext(agentName, message);

    // Phase 57 Plan 03: caller-owned Turn branch. When the caller provided
    // their own Turn (DiscordBridge pre-opens the Turn + receive-span before
    // calling us), attach the origin and forward — caller retains end() ownership.
    if (options.turn) {
      try { options.turn.recordOrigin(origin); } catch { /* non-fatal — trace side-effect */ }
      try {
        return await this.sessionManager.sendToAgent(agentName, augmentedMessage, options.turn, { signal: options.signal });
      } finally {
        this.restoreEffort(agentName, priorEffort);
      }
    }

    const turn = this.openTurn(origin, agentName, options.channelId ?? null);
    if (turn) {
      try { turn.recordOrigin(origin); } catch { /* non-fatal */ }
    }
    try {
      const response = await this.sessionManager.sendToAgent(agentName, augmentedMessage, turn, { signal: options.signal });
      try { turn?.end("success"); } catch { /* non-fatal — trace write is best-effort */ }
      return response;
    } catch (err) {
      try { turn?.end("error"); } catch { /* non-fatal */ }
      throw err;
    } finally {
      this.restoreEffort(agentName, priorEffort);
    }
  }

  /**
   * Dispatch a streaming turn. Mirrors SessionManager.streamFromAgent.
   * Same Turn lifecycle contract as dispatch().
   */
  async dispatchStream(
    origin: TurnOrigin,
    agentName: string,
    message: string,
    onChunk: (accumulated: string) => void,
    options: DispatchOptions = {},
  ): Promise<string> {
    if (agentName.length === 0) {
      throw new TurnDispatcherError("agentName must be non-empty", agentName, origin.rootTurnId);
    }

    // Phase 83 EFFORT-05 — same pre/post wrap as dispatch().
    const priorEffort = this.applySkillEffort(agentName, options.skillEffort);

    // Phase 90 MEM-05 — fire-and-forget cue hook (same contract as dispatch).
    this.maybeFireCueHook(origin, agentName, message, options.channelId ?? null);

    // Phase 90 MEM-03 — pre-turn retrieval + <memory-context> wrap.
    const augmentedMessage = await this.augmentWithMemoryContext(agentName, message);

    // Phase 57 Plan 03: caller-owned Turn branch (see dispatch() for rationale).
    if (options.turn) {
      try { options.turn.recordOrigin(origin); } catch { /* non-fatal */ }
      try {
        return await this.sessionManager.streamFromAgent(agentName, augmentedMessage, onChunk, options.turn, { signal: options.signal });
      } finally {
        this.restoreEffort(agentName, priorEffort);
      }
    }

    const turn = this.openTurn(origin, agentName, options.channelId ?? null);
    if (turn) {
      try { turn.recordOrigin(origin); } catch { /* non-fatal */ }
    }
    try {
      const response = await this.sessionManager.streamFromAgent(
        agentName,
        augmentedMessage,
        onChunk,
        turn,
        { signal: options.signal },
      );
      try { turn?.end("success"); } catch { /* non-fatal */ }
      return response;
    } catch (err) {
      try { turn?.end("error"); } catch { /* non-fatal */ }
      throw err;
    } finally {
      this.restoreEffort(agentName, priorEffort);
    }
  }

  /**
   * Phase 90 MEM-03 — augment the user message with retrieved memory
   * chunks as a `<memory-context>` prefix. Runs only when a memoryRetriever
   * was wired (DI), the message is non-trivially short, and retrieval
   * returns chunks. Fail-open: any retriever error or no-chunks-found
   * result yields the original message unchanged.
   *
   * Landing region: mutable suffix (the per-turn user message body). The
   * stable prefix (system prompt / SOUL / IDENTITY / MEMORY.md auto-load
   * per Plan 90-01) is NOT touched — v1.7 two-block cache stability is
   * preserved.
   */
  private async augmentWithMemoryContext(
    agentName: string,
    message: string,
  ): Promise<string> {
    if (!this.memoryRetriever) return message;
    const query = message.trim();
    if (query.length === 0) return message;
    try {
      const chunks = await this.memoryRetriever(agentName, query);
      if (chunks.length === 0) return message;
      const rendered = chunks
        .map((c) => {
          const heading = c.heading ?? c.path;
          return `### ${heading}\n${c.body}`;
        })
        .join("\n\n");
      const wrapper = `<memory-context source="hybrid-rrf" chunks="${chunks.length}">\n${rendered}\n</memory-context>\n\n`;
      return wrapper + message;
    } catch (err) {
      this.log.warn(
        { agent: agentName, error: (err as Error).message },
        "memory retrieval failed — continuing without context (fail-open)",
      );
      return message;
    }
  }

  /**
   * Phase 83 EFFORT-05 — apply a per-skill effort override, returning the
   * prior level so the caller can revert in a finally block.
   *
   * Returns null when no override is requested (skillEffort undefined) —
   * the caller uses this sentinel to short-circuit the revert. Never
   * throws: if the snapshot or setEffort calls fail (agent not running,
   * SDK rejection), we log a warning and return null so the turn still
   * proceeds without the override. The revert path is gated on non-null,
   * so a failed apply means a failed no-op revert — state stays coherent.
   */
  private applySkillEffort(agentName: string, skillEffort: EffortLevel | undefined): EffortLevel | null {
    if (!skillEffort) return null;
    try {
      const prior = this.sessionManager.getEffortForAgent(agentName);
      this.sessionManager.setEffortForAgent(agentName, skillEffort);
      return prior;
    } catch (err) {
      this.log.warn(
        { agent: agentName, skillEffort, error: (err as Error).message },
        "turn-dispatcher: skill-effort apply failed — continuing without override",
      );
      return null;
    }
  }

  /**
   * Phase 83 EFFORT-05 — revert to the prior effort level in the finally block.
   *
   * Pairs with applySkillEffort: invoked even on error paths so a runaway
   * turn cannot leave an agent stuck at an elevated level. Null priorEffort
   * means "no override was applied" → no-op. Revert failures are logged
   * and swallowed (same rationale as apply: a transient SDK failure must
   * never propagate past the turn boundary as a hidden exception on top
   * of whatever the original dispatch returned).
   */
  private restoreEffort(agentName: string, priorEffort: EffortLevel | null): void {
    if (priorEffort === null) return;
    try {
      this.sessionManager.setEffortForAgent(agentName, priorEffort);
    } catch (err) {
      this.log.warn(
        { agent: agentName, priorEffort, error: (err as Error).message },
        "turn-dispatcher: skill-effort revert failed — agent may be at wrong level",
      );
    }
  }

  /**
   * Phase 90 MEM-05 — cue detection + writeCueMemory + Discord ✅ reaction,
   * all wrapped in a fire-and-forget canary per Phase 83/86/87/89 blueprint.
   *
   * The synchronous caller returns immediately — the cue write + reaction
   * race the agent turn. The scanner picks up the new memory file within
   * ≤1s (chokidar awaitWriteFinish 300ms + stabilityThreshold + ready),
   * so the standing rule is available on the NEXT turn's retrieval pass.
   *
   * Rejections on any leg (cue writer throw, Discord reaction failure) are
   * warn-logged and DO NOT propagate — the user's turn must complete
   * regardless of the cue-capture side-channel's health.
   */
  private maybeFireCueHook(
    origin: TurnOrigin,
    agentName: string,
    userMessage: string,
    channelId: string | null,
  ): void {
    if (!this.memoryCueWriter || !this.workspaceForAgent) return;
    const detection = detectCue(userMessage);
    if (!detection.match || !detection.captured) return;
    const workspace = this.workspaceForAgent(agentName);
    if (!workspace) return; // agent not yet registered / workspace unknown
    const turnIso = new Date().toISOString();
    const context = extractCueContext(userMessage);
    // Extract the originating Discord message id (if any) so the reaction
    // and discord_link frontmatter land correctly. The TurnOrigin shape
    // carries the sourceId under source.id; we only fire the reaction for
    // discord-originated turns (OpenAI / scheduler / task / trigger have
    // nothing to react to).
    const messageId: string | undefined =
      origin.source.kind === "discord" ? origin.source.id : undefined;
    // discord_link frontmatter — left undefined here because constructing
    // a canonical discord.com/channels/<guild>/<channel>/<message> URL
    // requires the guildId which TurnDispatcher doesn't carry. Consumers
    // (memory retrieval / operators) can look up the link via the
    // message_id if needed. Future plan can add the full URL by threading
    // guildId through DispatchOptions.
    const messageLink: string | undefined = undefined;

    const writer = this.memoryCueWriter;
    const reactor = this.discordReact;
    void writer({
      workspacePath: workspace,
      cue: detection.captured,
      context,
      turnIso,
      messageLink,
    })
      .then(() => {
        if (messageId && channelId && reactor) {
          void reactor({ channelId, messageId }, "✅").catch((err) => {
            this.log.warn(
              { err: (err as Error).message, agent: agentName, messageId },
              "cue discord reaction failed (non-fatal)",
            );
          });
        }
      })
      .catch((err) => {
        this.log.warn(
          { err: (err as Error).message, agent: agentName },
          "cue memory write failed (non-fatal)",
        );
      });
  }

  /**
   * Phase 90 MEM-06 — public entry point for Task-tool-return observers.
   *
   * Invoked by the session adapter (or its tool-return stream-observer)
   * when a Task tool call resolves with a subagent's final report. Does
   * NOT take an AbortSignal — this is a persistence side-channel, not a
   * turn-lifecycle operation.
   *
   * D-35 exclusion lives inside captureSubagentReturn itself (isGsdSubagent
   * short-circuits there), so we don't re-check here; keeps the public
   * interface decoupled from the exclusion policy.
   */
  async handleTaskToolReturn(
    agentName: string,
    event: TaskToolReturnEvent,
  ): Promise<void> {
    if (!this.subagentCapture || !this.workspaceForAgent) return;
    const workspace = this.workspaceForAgent(agentName);
    if (!workspace) return;
    const capture = this.subagentCapture;
    // Fire-and-forget discipline — never reject back to the caller. The
    // SDK's Task tool call continues regardless of whether this persists.
    void capture({
      workspacePath: workspace,
      subagent_type: event.subagent_type,
      task_description: event.task_description,
      return_summary: event.return_summary,
      spawned_at_iso: event.spawned_at_iso,
      duration_ms: event.duration_ms,
    }).catch((err) => {
      this.log.warn(
        {
          err: (err as Error).message,
          agent: agentName,
          subagent_type: event.subagent_type,
        },
        "subagent capture failed (non-fatal)",
      );
    });
  }

  /**
   * Open a Turn for this dispatch via the agent's TraceCollector. Returns
   * undefined when no collector is wired for the agent (tests / agent not
   * running). Non-fatal failure path — matches the existing DiscordBridge
   * + TaskScheduler pattern of wrapping startTurn in try/catch.
   */
  private openTurn(origin: TurnOrigin, agentName: string, channelId: string | null) {
    try {
      const collector = this.sessionManager.getTraceCollector(agentName);
      if (!collector) return undefined;
      return collector.startTurn(origin.rootTurnId, agentName, channelId);
    } catch (err) {
      this.log.warn(
        { agent: agentName, rootTurnId: origin.rootTurnId, error: (err as Error).message },
        "turn-dispatcher: trace setup failed — continuing without tracing",
      );
      return undefined;
    }
  }
}
