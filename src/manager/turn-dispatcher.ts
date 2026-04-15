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
};

export type TurnDispatcherOptions = {
  readonly sessionManager: SessionManager;
  readonly log?: Logger;
};

/**
 * TurnDispatcher — construct once at daemon boot; call dispatch() from
 * every turn source (DiscordBridge, TaskScheduler, future Phase 59 handoff
 * receiver, future Phase 60 trigger engine).
 */
export class TurnDispatcher {
  private readonly sessionManager: SessionManager;
  private readonly log: Logger;

  constructor(options: TurnDispatcherOptions) {
    this.sessionManager = options.sessionManager;
    this.log = (options.log ?? logger).child({ component: "TurnDispatcher" });
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
    const turn = this.openTurn(origin, agentName, options.channelId ?? null);
    try {
      const response = await this.sessionManager.sendToAgent(agentName, message, turn);
      try { turn?.end("success"); } catch { /* non-fatal — trace write is best-effort */ }
      return response;
    } catch (err) {
      try { turn?.end("error"); } catch { /* non-fatal */ }
      throw err;
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
    const turn = this.openTurn(origin, agentName, options.channelId ?? null);
    try {
      const response = await this.sessionManager.streamFromAgent(
        agentName,
        message,
        onChunk,
        turn,
      );
      try { turn?.end("success"); } catch { /* non-fatal */ }
      return response;
    } catch (err) {
      try { turn?.end("error"); } catch { /* non-fatal */ }
      throw err;
    }
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
