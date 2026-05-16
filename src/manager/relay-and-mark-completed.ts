/**
 * Phase 999.25 — relay-and-mark-completed helper.
 *
 * Single source of truth for the subagent completion flow. Used by:
 *
 *   1. The `subagent-complete` IPC handler (explicit
 *      `mcp__clawcode__subagent_complete` tool fires this path).
 *   2. The daemon's quiescence sweep (`subagent-completion-sweep.ts`)
 *      wired into the 60s `onTickAfter` callback.
 *
 * Both paths compete to be the first relay. The dedupe is the
 * `binding.completedAt` flag — read-then-write semantics; the second
 * caller sees `completedAt !== null` and skips. Last-writer-wins on the
 * underlying file is fine because the relay itself is idempotent
 * (`relayCompletionToParent` walks Discord history newest→oldest, so
 * repeated calls produce the same content) and the sweep filters at
 * scan time so it rarely re-fires.
 *
 * The session-end callback in `subagent-thread-spawner.ts` ALSO checks
 * `binding.completedAt` and skips if set — that's the third dedupe
 * site, kept inline there because it's part of the spawner's own
 * lifecycle.
 *
 * No side effects beyond Discord post + thread-bindings.json write.
 * Pure deps so unit tests pass `vi.fn()` without a daemon or Discord.
 */

import type { Logger } from "pino";
import type {
  ThreadBinding,
  ThreadBindingRegistry,
} from "../discord/thread-types.js";

export type RelayAndMarkCompletedResult =
  | { readonly ok: true; readonly reason: "relayed" }
  | { readonly ok: true; readonly reason: "already-completed" }
  | { readonly ok: false; readonly reason: "no-binding" }
  | { readonly ok: false; readonly reason: "disabled" }
  | { readonly ok: false; readonly reason: "spawner-unavailable" }
  | { readonly ok: false; readonly reason: "delivery-not-confirmed" };

export type RelayAndMarkCompletedDeps = {
  readonly readThreadRegistry: () => Promise<ThreadBindingRegistry>;
  readonly writeThreadRegistry: (
    next: ThreadBindingRegistry,
  ) => Promise<void>;
  /**
   * The spawner-side relay function. Production binds to
   * `subagentThreadSpawner.relayCompletionToParent(threadId)`.
   * `null` indicates the spawner is unavailable (Discord bridge
   * disabled) — handler returns `spawner-unavailable`.
   */
  readonly relayCompletionToParent:
    | ((threadId: string) => Promise<void>)
    | null;
  readonly now: () => number;
  readonly log: Logger;
  /** When `false`, returns `{ ok: false, reason: "disabled" }` immediately. */
  readonly enabled: boolean;
};

/**
 * Look up the binding for `threadId`, fire the relay, stamp
 * `completedAt`. Idempotent: if `completedAt` is already set, returns
 * `{ ok: true, reason: "already-completed" }` without re-firing.
 *
 * Throws ONLY on unexpected errors (Discord post fatal, registry write
 * fatal). Callers wrap in try/catch — sweep + IPC handler both log at
 * error level on throw, but never propagate (would crash the tick or
 * the IPC server).
 */
export async function relayAndMarkCompletedByThreadId(
  deps: RelayAndMarkCompletedDeps,
  threadId: string,
): Promise<RelayAndMarkCompletedResult> {
  if (!deps.enabled) {
    return { ok: false, reason: "disabled" };
  }
  if (deps.relayCompletionToParent === null) {
    return { ok: false, reason: "spawner-unavailable" };
  }

  const registry = await deps.readThreadRegistry();
  const idx = registry.bindings.findIndex((b) => b.threadId === threadId);
  if (idx === -1) {
    return { ok: false, reason: "no-binding" };
  }
  const binding = registry.bindings[idx]!;
  if (binding.completedAt !== undefined && binding.completedAt !== null) {
    return { ok: true, reason: "already-completed" };
  }

  // Phase 999.36 sub-bug D (D-13) — gate completion on delivery
  // confirmation. Without this, a tool-result-with-no-followup or a
  // heartbeat-quiescence sweep can fire the relay before the subagent's
  // actual final chunks reach Discord — operator sees confident "Phase 2
  // complete" while the last 2 minutes of work silently disappeared
  // (compound failure with sub-bug B).
  //
  // Backstop: the session-end callback in daemon.ts stamps
  // lastDeliveryAt = Date.now() before invoking relayCompletionToParent,
  // treating session-end as delivery-equivalent (the agent has stopped
  // streaming; whatever was delivered is the final state).
  if (
    binding.lastDeliveryAt === undefined ||
    binding.lastDeliveryAt === null
  ) {
    return { ok: false, reason: "delivery-not-confirmed" };
  }

  await deps.relayCompletionToParent(threadId);

  // Stamp completedAt and persist. We re-read here would race with
  // concurrent updates (e.g. lastActivity bumps); but writeThreadRegistry
  // is atomic-via-rename, and the sweep filters by completedAt at scan
  // time so a missed lastActivity update won't cause a double-relay.
  const now = deps.now();
  const updatedBinding: ThreadBinding = { ...binding, completedAt: now };
  const nextBindings = registry.bindings.map((b, i) =>
    i === idx ? updatedBinding : b,
  );
  const next: ThreadBindingRegistry = {
    bindings: nextBindings,
    updatedAt: now,
  };
  await deps.writeThreadRegistry(next);

  deps.log.info(
    {
      component: "subagent-completion",
      action: "marked-completed",
      threadId,
      sessionName: binding.sessionName,
      agentName: binding.agentName,
    },
    "subagent completion relayed and marked",
  );

  return { ok: true, reason: "relayed" };
}

/**
 * Convenience wrapper for the IPC handler — takes `agentName` (which
 * is the binding's `sessionName` for subagent threads) and resolves to
 * `threadId` before delegating to `relayAndMarkCompletedByThreadId`.
 *
 * Returns the same `RelayAndMarkCompletedResult` shape so the IPC
 * handler can pass through.
 */
export async function relayAndMarkCompletedByAgentName(
  deps: RelayAndMarkCompletedDeps,
  agentName: string,
): Promise<RelayAndMarkCompletedResult> {
  if (!deps.enabled) {
    return { ok: false, reason: "disabled" };
  }
  if (deps.relayCompletionToParent === null) {
    return { ok: false, reason: "spawner-unavailable" };
  }
  const registry = await deps.readThreadRegistry();
  const binding = registry.bindings.find((b) => b.sessionName === agentName);
  if (!binding) {
    return { ok: false, reason: "no-binding" };
  }
  return relayAndMarkCompletedByThreadId(deps, binding.threadId);
}
