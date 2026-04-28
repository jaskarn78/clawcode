/**
 * Phase 100 follow-up — per-agent pending-message coalescer.
 *
 * Operator-reported bug 2026-04-28: rapid-fire messages while the agent is
 * busy hit `SerialTurnQueue.QUEUE_FULL` (depth-1) and get ❌-reacted instead
 * of being processed. Coalescer buffers messages per agent at the bridge
 * layer (upstream of SerialTurnQueue) so the depth-1 queue never overflows.
 *
 * Semantics:
 *   - addMessage(agentName, content, messageId) — appends to agent's pending list
 *   - takePending(agentName) — atomically returns ALL pending messages for the
 *     agent + clears the list. Caller dispatches the joined payload as ONE turn.
 *
 * No persistence: in-memory only. Daemon restart drops pending messages
 * (acceptable — operator can resend after restart, and restart is rare).
 *
 * Per-agent cap: optional safety bound (default 50 pending messages) to
 * prevent runaway memory if dispatch is broken. When cap is hit, falls back
 * to the existing QUEUE_FULL → ❌ behavior at the bridge layer.
 */

/** A single pending message captured by the coalescer. */
export type CoalescedMessage = Readonly<{
  content: string;
  messageId: string;
  receivedAt: number;
}>;

/** Default per-agent buffer cap — guards against runaway memory. */
export const DEFAULT_PER_AGENT_CAP = 50;

export class MessageCoalescer {
  private readonly pending = new Map<string, CoalescedMessage[]>();
  private readonly perAgentCap: number;

  constructor(opts?: { readonly perAgentCap?: number }) {
    this.perAgentCap = opts?.perAgentCap ?? DEFAULT_PER_AGENT_CAP;
  }

  /**
   * Append a message to the agent's pending buffer.
   *
   * @returns true if added, false if cap reached (caller should fall back to ❌)
   */
  addMessage(agentName: string, content: string, messageId: string): boolean {
    const list = this.pending.get(agentName) ?? [];
    if (list.length >= this.perAgentCap) return false;
    // Immutable append — create a new list rather than mutating the existing array.
    const next: CoalescedMessage[] = [
      ...list,
      { content, messageId, receivedAt: Date.now() },
    ];
    this.pending.set(agentName, next);
    return true;
  }

  /**
   * Atomically remove and return all pending messages for an agent.
   * Returns empty array if agent has none pending.
   */
  takePending(agentName: string): readonly CoalescedMessage[] {
    const list = this.pending.get(agentName) ?? [];
    this.pending.delete(agentName);
    return list;
  }

  /** Test/debug inspector — does not mutate state. */
  getPendingCount(agentName: string): number {
    return this.pending.get(agentName)?.length ?? 0;
  }
}
