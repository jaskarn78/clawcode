/**
 * Phase 74 Plan 01 — OpenClaw template driver.
 *
 * Implements the `OpenAiSessionDriver` contract (src/openai/server.ts) for the
 * NAMESPACE-PREFIXED path (`body.model="openclaw:<slug>[:<tier>]"`). Completely
 * separate code path from the Phase 69 ClawCode-native driver — literal
 * agent-name traffic continues to flow through createOpenAiSessionDriver
 * unchanged.
 *
 * Design (74-CONTEXT D-01/D-02/D-03 + 74-RESEARCH Pattern 2 + Pitfall 2/4):
 *
 *   1. Per-caller persistent SDK session — reuses Phase 73's
 *      createPersistentSessionHandle VERBATIM so the SDK subprocess + prompt
 *      cache survive across turns for the same (bearer, callerSlug, soulFp,
 *      tier) tuple. Sub-2s TTFB SLO preserved.
 *
 *   2. Cache-key components (D-03):
 *        - bearer key hash
 *        - caller slug
 *        - sha256(SOUL).slice(0,16)
 *        - tier (sonnet|opus|haiku)
 *      A change in ANY of the four forces a fresh handle. The stale handle
 *      eventually ages out via LRU or 30-min idle TTL (wired in bootstrap).
 *
 *   3. systemPrompt MUST be the STRING form of the caller's SOUL — NEVER the
 *      preset object form (Pitfall 2 — `{preset: "claude_code", append}` would
 *      inject the Claude Code kernel prompt into OpenClaw's turn and burn
 *      tokens). The STRING form REPLACES the SDK's default prompt entirely;
 *      the SOUL IS the whole instruction surface for transient agents.
 *
 *   4. cwd is a FIXED module-scope constant — NEVER caller-derived
 *      (Pitfall 4). The driver never reads body.workspace / body.cwd /
 *      body.metadata.workspace — grep-enforced.
 *
 *   5. mcpServers:{} + settingSources:[] + tools:[] — OpenClaw-side tools
 *      travel as OpenAI tool_calls round-trips via Phase 69's translator, not
 *      as ClawCode MCP mounts. The SDK's built-in tools are explicitly off.
 *
 *   6. Event bridging — createPersistentSessionHandle's sendAndStream uses a
 *      `(accumulated: string) => void` callback. This module converts that
 *      into `AsyncIterable<SdkStreamEvent>` via a bounded queue + pending
 *      resolver (same pattern as src/openai/driver.ts uses to bridge
 *      TurnDispatcher.dispatchStream into the server's stream contract).
 */

import path from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type { Logger } from "pino";

import type { OpenAiSessionDriver } from "./server.js";
import type { SdkStreamEvent, TemplateDriverInput } from "./types.js";
import { TIER_MODEL_MAP } from "./types.js";
import type { SessionHandle, UsageCallback } from "../manager/session-adapter.js";
import type { SdkModule, SdkQueryOptions } from "../manager/sdk-types.js";
import { createPersistentSessionHandle } from "../manager/persistent-session-handle.js";
import {
  TransientSessionCache,
  makeTransientCacheKey,
} from "./transient-session-cache.js";

/**
 * Fixed cwd for every transient handle. Never caller-derived (Pitfall 4).
 * Created lazily by the template driver via ensureCwd (default: mkdirSync
 * with recursive). The daemon bootstrap is free to precreate it — idempotent.
 */
export const CLAWCODE_TRANSIENT_CWD = path.join(
  homedir(),
  ".clawcode",
  "manager",
  "transient",
);

/** Dependency bag for createOpenClawTemplateDriver. */
export interface TemplateDriverDeps {
  /** Same SdkModule handle the native driver / SdkSessionAdapter uses. */
  readonly sdk: SdkModule;
  /** LRU+TTL cache owning the per-caller persistent handles. */
  readonly cache: TransientSessionCache;
  /** Structured logger (pino). */
  readonly log: Logger;
  /**
   * Optional per-turn usage hook — Plan 02 will thread the real UsageTracker
   * here so `openclaw:<slug>` rows land in the costs DB. Plan 01 leaves it a
   * no-op (undefined).
   */
  readonly onUsage?: (
    input: TemplateDriverInput,
    usage: Parameters<UsageCallback>[0],
    sessionId: string,
    elapsedMs: number,
  ) => void;
  /**
   * Test seam — default: createPersistentSessionHandle.
   * Tests inject a factory that returns a mocked SessionHandle without booting
   * the real SDK.
   */
  readonly createHandle?: typeof createPersistentSessionHandle;
  /**
   * Test seam — default: no-op (tests that assert cwd creation inject this;
   * production bootstrap precreates CLAWCODE_TRANSIENT_CWD at daemon boot).
   */
  readonly ensureCwd?: (absPath: string) => void;
}

/**
 * OpenClawTemplateDriver is a drop-in OpenAiSessionDriver. The server
 * passes a `TemplateDriverInput` (superset of OpenAiSessionDriver.dispatch's
 * native input — the extra fields callerSlug/tier/soulPrompt/soulFp carry
 * the template identity).
 *
 * The shape is declared as OpenAiSessionDriver directly so OpenAiServerConfig
 * can accept either driver interchangeably — the template driver simply
 * reads additional fields off the input object that the native driver
 * ignores.
 */
export type OpenClawTemplateDriver = OpenAiSessionDriver;

export function createOpenClawTemplateDriver(
  deps: TemplateDriverDeps,
): OpenClawTemplateDriver {
  const mkHandle = deps.createHandle ?? createPersistentSessionHandle;
  return {
    dispatch(input) {
      // Template path — server.ts guarantees TemplateDriverInput shape on
      // the openclaw-template branch.
      return dispatchTemplate(
        input as unknown as TemplateDriverInput,
        deps,
        mkHandle,
      );
    },
  };
}

/**
 * Core dispatch: materialize (or reuse) the per-caller handle, then bridge
 * its callback-based sendAndStream into an AsyncIterable<SdkStreamEvent>.
 */
function dispatchTemplate(
  input: TemplateDriverInput,
  deps: TemplateDriverDeps,
  mkHandle: typeof createPersistentSessionHandle,
): AsyncIterable<SdkStreamEvent> {
  return {
    [Symbol.asyncIterator]() {
      return runTemplateDispatch(input, deps, mkHandle);
    },
  };
}

type QueueItem =
  | { kind: "event"; event: SdkStreamEvent }
  | { kind: "end"; sessionId: string }
  | { kind: "error"; error: Error };

function runTemplateDispatch(
  input: TemplateDriverInput,
  deps: TemplateDriverDeps,
  mkHandle: typeof createPersistentSessionHandle,
): AsyncIterator<SdkStreamEvent> {
  const cacheKey = makeTransientCacheKey({
    keyHash: input.keyHash,
    callerSlug: input.callerSlug,
    soulFp: input.soulFp,
    tier: input.tier,
  });

  // Resolve (or materialize) the persistent handle. Any synchronous throw
  // from createPersistentSessionHandle (e.g. SDK init failure) propagates
  // through the async iterator's first .next() call below — we capture it
  // into `pendingCtorError` so the iterator can reject cleanly.
  let handle: SessionHandle | undefined = deps.cache.get(cacheKey);
  let pendingCtorError: Error | undefined;
  const startedAt = Date.now();

  if (!handle) {
    try {
      if (deps.ensureCwd) deps.ensureCwd(CLAWCODE_TRANSIENT_CWD);
      const modelId = TIER_MODEL_MAP[input.tier];
      // Build baseOptions — Pitfall 2 (string systemPrompt) + Pitfall 4 (fixed
      // cwd) + isolation (mcpServers:{}, settingSources:[], tools:[]).
      // Phase 74 hotfix — inherit process.env (minus ANTHROPIC_API_KEY) and
      // keep settingSources:["project"] to match the native agent path. Empty
      // settingSources made the CLI subprocess crash with
      // `error_during_execution`. The "project" source is required for the
      // Claude Code kernel to bootstrap; we still isolate from caller
      // workspace by using a fixed CLAWCODE_TRANSIENT_CWD.
      const { ANTHROPIC_API_KEY: _stripped, ...cleanEnv } = process.env;
      const baseOptions = {
        systemPrompt: input.soulPrompt, // STRING — REPLACES kernel prompt.
        model: modelId,
        cwd: CLAWCODE_TRANSIENT_CWD,
        permissionMode: "bypassPermissions" as const,
        allowDangerouslySkipPermissions: true,
        mcpServers: {},
        settingSources: ["project"] as ReadonlyArray<string>,
        env: cleanEnv,
      } satisfies SdkQueryOptions;

      // Bind a usage callback that reports back via deps.onUsage — Plan 02
      // hooks UsageTracker here so `openclaw:<slug>` rows land in the DB.
      const usageCb: UsageCallback | undefined = deps.onUsage
        ? (u) => {
            try {
              if (handle) {
                deps.onUsage!(input, u, handle.sessionId, Date.now() - startedAt);
              }
            } catch (err) {
              deps.log.warn({ err }, "transient usage callback threw (non-fatal)");
            }
          }
        : undefined;

      handle = mkHandle(
        deps.sdk,
        baseOptions as SdkQueryOptions,
        randomUUID(),
        usageCb,
      );
      deps.cache.set(cacheKey, handle);
    } catch (err) {
      pendingCtorError = err instanceof Error ? err : new Error(String(err));
    }
  }

  // --- Bridge handle.sendAndStream (callback) → AsyncIterable<SdkStreamEvent> ---
  const queue: QueueItem[] = [];
  let pendingResolve: ((v: IteratorResult<SdkStreamEvent>) => void) | null = null;
  let pendingReject: ((err: Error) => void) | null = null;
  let done = false;
  let accumulatedSoFar = "";
  let emittedTextBlockStart = false;

  const flushNext = (): boolean => {
    if (!pendingResolve) return false;
    const item = queue.shift();
    if (!item) return false;
    const resolve = pendingResolve;
    const reject = pendingReject;
    pendingResolve = null;
    pendingReject = null;
    if (item.kind === "event") {
      resolve({ value: item.event, done: false });
      return true;
    }
    if (item.kind === "end") {
      done = true;
      const finalEvent: SdkStreamEvent = {
        type: "result",
        session_id: item.sessionId,
      };
      resolve({ value: finalEvent, done: false });
      return true;
    }
    // error
    if (reject) reject(item.error);
    else resolve({ value: undefined, done: true });
    return true;
  };

  const pushEvent = (event: SdkStreamEvent): void => {
    queue.push({ kind: "event", event });
    flushNext();
  };
  const pushEnd = (sessionId: string): void => {
    queue.push({ kind: "end", sessionId });
    flushNext();
  };
  const pushError = (err: Error): void => {
    queue.push({ kind: "error", error: err });
    flushNext();
  };

  // If handle materialization failed, surface the error on first next().
  if (pendingCtorError) {
    queue.push({ kind: "error", error: pendingCtorError });
  } else if (handle) {
    // Kick off the turn. The SDK emits chunks via onChunk(accumulated); we
    // convert each delta into a content_block_delta event.
    const onChunk = (accumulated: string): void => {
      if (!emittedTextBlockStart) {
        emittedTextBlockStart = true;
        pushEvent({
          type: "stream_event",
          event: {
            type: "content_block_start",
            index: 0,
            content_block: { type: "text" },
          },
        });
      }
      if (accumulated.length <= accumulatedSoFar.length) return;
      const delta = accumulated.slice(accumulatedSoFar.length);
      accumulatedSoFar = accumulated;
      if (delta.length === 0) return;
      pushEvent({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: delta },
        },
      });
    };

    void handle
      .sendAndStream(input.lastUserMessage, onChunk, undefined, {
        signal: input.signal,
      })
      .then(() => {
        // handle.sessionId is stable for the life of the handle (Phase 73).
        pushEnd(handle!.sessionId);
      })
      .catch((err: unknown) => {
        pushError(err instanceof Error ? err : new Error(String(err)));
      });

    // Abort plumbing — handle.sendAndStream already honors options.signal
    // (SendOptions.signal races the SDK's interrupt deadline). Nothing else
    // to wire here — the .catch path above translates AbortError into the
    // iterator's error channel.
  }

  const iterator: AsyncIterator<SdkStreamEvent> = {
    next(): Promise<IteratorResult<SdkStreamEvent>> {
      return new Promise<IteratorResult<SdkStreamEvent>>((resolve, reject) => {
        if (done && queue.length === 0) {
          resolve({ value: undefined, done: true });
          return;
        }
        pendingResolve = resolve;
        pendingReject = reject;
        flushNext();
      });
    },
    return(): Promise<IteratorResult<SdkStreamEvent>> {
      done = true;
      return Promise.resolve({ value: undefined, done: true });
    },
  };
  return iterator;
}
