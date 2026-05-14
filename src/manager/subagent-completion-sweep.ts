/**
 * Phase 999.25 — Subagent completion sweep (quiescence-timer relay).
 *
 * Catches the case where a subagent finishes its work but does NOT call
 * the explicit `subagent_complete` MCP tool — operator-visible result
 * shouldn't wait until session-end (hours later, after the Phase 999.X
 * 2h reaper). After a subagent's binding has been quiet for
 * `quiescenceMinutes` (default 5), the sweep fires
 * `relayCompletionToParent` and stamps `binding.completedAt` so the
 * other relay paths (explicit tool, session-end callback) become no-ops.
 *
 * Hosted in the same 60s `onTickAfter` callback in `daemon.ts:4609`
 * alongside the orphan-claude reaper, subagent-session reaper, and
 * stale-binding sweep. Pure scan + DI'd side effects so unit tests
 * don't need a full daemon.
 *
 * False-positive guards:
 *   - `isSubagentThreadName(binding.sessionName)` — operator-defined
 *     agent bindings are never touched.
 *   - `binding.completedAt` already set → skip (idempotent).
 *   - Session must be `"running"` in the registry (skip
 *     `starting`/`stopping`/`stopped`/`crashed`/`restarting`/`failed`).
 *     Stopped sessions are handled by the existing session-end relay
 *     path in `daemon.ts:6258`; starting sessions are skipped to avoid
 *     racing the spawner.
 *   - Env kill-switch: `CLAWCODE_SUBAGENT_COMPLETION_DISABLE=1`. When
 *     set, the sweep noops (the explicit tool also returns
 *     `{ ok: false, reason: "disabled" }`).
 *
 * Canonical log shape (pinned by tests):
 *   { component: "subagent-completion-sweep",
 *     action: "alert" | "relayed" | "skip",
 *     agent, sessionName, threadId, idleSec, msg }
 */

import type { Logger } from "pino";
import type { ThreadBinding } from "../discord/thread-types.js";
import { isSubagentThreadName } from "./subagent-name.js";

/**
 * Minimal slice of a registry entry the sweep reads. Defined as a
 * structural type so tests don't need a full RegistryEntry mock —
 * mirrors the shape `subagent-session-reaper` uses.
 */
export type RunningSessionInfo = {
  readonly name: string;
  readonly status: string;
};

export type CompletionSweepCandidate = {
  readonly sessionName: string;
  readonly threadId: string;
  readonly idleSec: number;
};

export type ScanArgs = {
  /** Snapshot of running sessions at tick start. */
  readonly sessions: readonly RunningSessionInfo[];
  /** Snapshot of thread bindings at tick start. */
  readonly bindings: readonly ThreadBinding[];
  readonly quiescenceMinutes: number;
  /** Test seam — defaults to Date.now(). */
  readonly now?: number;
};

/**
 * Pure scan — return bindings that should fire the quiescence relay.
 * No side effects, deterministic ordering by binding input order.
 */
export function scanQuiescentBindings(
  args: ScanArgs,
): readonly CompletionSweepCandidate[] {
  const now = args.now ?? Date.now();
  const quiescenceMs = args.quiescenceMinutes * 60_000;

  // O(1) lookups by sessionName.
  const runningByName = new Map<string, RunningSessionInfo>();
  for (const s of args.sessions) {
    if (s.status === "running") runningByName.set(s.name, s);
  }

  const out: CompletionSweepCandidate[] = [];
  for (const b of args.bindings) {
    if (!isSubagentThreadName(b.sessionName)) continue;
    if (b.completedAt !== undefined && b.completedAt !== null) continue;
    if (!runningByName.has(b.sessionName)) continue;
    const idleMs = now - b.lastActivity;
    if (idleMs < quiescenceMs) continue;
    out.push({
      sessionName: b.sessionName,
      threadId: b.threadId,
      idleSec: Math.round(idleMs / 1000),
    });
  }
  return out;
}

export type TickArgs = ScanArgs & {
  readonly enabled: boolean;
  readonly log: Logger;
  /**
   * Per-candidate handler. Phase 999.36 sub-bug D changed the contract:
   * the sweep is NO LONGER a relay-firing path. The handler is now the
   * operator-visibility hook — production wires this to emit a
   * `subagent_idle_warning` log line with in-memory dedupe so a stuck
   * subagent doesn't generate a warning every tick. Tests pass a
   * `vi.fn()`.
   *
   * Real completion paths: explicit `subagent_complete` tool,
   * `postInitialMessage` delivery-confirmed stamp, OR session-end
   * backstop. Quiescence is observational only.
   *
   * Resolves to `{ ok: true }` on every invocation (the handler is
   * a soft observer, not a side-effect operator). Reserved for
   * forward-compat with handlers that might surface a result. Throws
   * only on unexpected errors — caller logs at error level.
   */
  readonly onQuiescent: (
    c: CompletionSweepCandidate,
  ) => Promise<{ readonly ok: boolean; readonly reason?: string }>;
};

/**
 * One tick of the subagent-completion sweep.
 *
 * In disabled state (yaml `enabled: false` OR env kill-switch): noop.
 *
 * Otherwise: scan candidates, invoke onQuiescent per candidate. The
 * sweep itself does NOT log "firing completion relay" anymore (Phase
 * 999.36 sub-bug D — quiescence is no longer a completion signal). The
 * onQuiescent handler is the operator-visibility surface (production
 * wires to `subagent_idle_warning` with dedupe). Failures are logged
 * but never propagate.
 */
export async function tickSubagentCompletionSweep(
  args: TickArgs,
): Promise<void> {
  if (!args.enabled) return;
  if (process.env.CLAWCODE_SUBAGENT_COMPLETION_DISABLE === "1") return;

  const candidates = scanQuiescentBindings(args);
  if (candidates.length === 0) return;

  for (const c of candidates) {
    try {
      await args.onQuiescent(c);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      args.log.error(
        {
          component: "subagent-completion-sweep",
          action: "onQuiescent-failed",
          agent: c.sessionName,
          threadId: c.threadId,
          err: msg,
        },
        "completion-sweep onQuiescent handler failed unexpectedly",
      );
    }
  }
}
