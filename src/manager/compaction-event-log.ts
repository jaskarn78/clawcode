/**
 * Phase 124 Plan 04 — in-memory record of the last compaction timestamp per
 * agent. Single source of truth for both the `heartbeat-status` telemetry
 * surface AND the heartbeat auto-trigger cooldown gate.
 *
 * No event bus is involved: the daemon's `case "compact-session"` handler
 * calls `record(agent)` directly after `handleCompactSession` returns
 * `ok: true`. Both the IPC path and the heartbeat-auto-trigger path flow
 * through that handler, so a successful auto-fire updates the same map.
 *
 * Lifecycle: a single instance is constructed at daemon boot. State is
 * lost on daemon restart — operators view `last_compaction_at: null`
 * after restart, which matches the "best effort" observability semantics
 * the operator asked for in 124-CONTEXT D-07. Persistence is a Phase 125
 * concern, not 124.
 */
export class CompactionEventLog {
  private readonly entries: Map<string, string> = new Map();

  /**
   * Record a compaction event for `agent`. When `at` is omitted, the
   * current wall-clock time is used. Returns the stored ISO string so
   * callers can log/return the exact value persisted (avoids the
   * caller-vs-store clock-skew confusion).
   */
  record(agent: string, at?: string): string {
    const value = at ?? new Date().toISOString();
    this.entries.set(agent, value);
    return value;
  }

  /** ISO timestamp of the most recent compaction, or null if never compacted. */
  getLastCompactionAt(agent: string): string | null {
    return this.entries.get(agent) ?? null;
  }

  /**
   * Milliseconds elapsed since the most recent compaction at `now`, or
   * null when never compacted. Used by the heartbeat context-fill check
   * to enforce the 5-min auto-trigger cooldown.
   */
  getMillisSinceLast(agent: string, now: number): number | null {
    const iso = this.entries.get(agent);
    if (iso === undefined) return null;
    return now - Date.parse(iso);
  }
}
