/**
 * Phase 60 Plan 01 — trigger engine data types.
 *
 * Provides the TriggerEvent Zod schema (validated at ingress), the
 * TriggerSource interface (implemented by Phase 61 source adapters),
 * and TriggerEngineOptions (constructor shape for the engine).
 *
 * These are pure-data definitions with zero runtime side effects.
 * Plans 60-02 and 60-03 depend on every export here — do NOT rename
 * without updating downstream plan references.
 */

import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// TriggerEvent — the universal shape for every trigger source emission.
// ---------------------------------------------------------------------------

export const TriggerEventSchema = z.object({
  sourceId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  targetAgent: z.string().min(1),
  payload: z.unknown(),
  timestamp: z.number().int().min(0),
});

export type TriggerEvent = z.infer<typeof TriggerEventSchema>;

// ---------------------------------------------------------------------------
// TriggerSource — plugin interface for Phase 61 source adapters.
// ---------------------------------------------------------------------------

/**
 * Every trigger source (scheduler, webhook, MySQL poller, inbox watcher,
 * calendar) implements this interface. The engine is source-agnostic.
 *
 * `poll` is optional — only needed for sources that support watermark-based
 * replay on daemon restart (TRIG-06).
 */
export type TriggerSource = {
  readonly sourceId: string;
  start(): void;
  stop(): void;
  /** Called on daemon restart to replay missed events since watermark. */
  poll?(since: string | null): Promise<readonly TriggerEvent[]>;
};

// ---------------------------------------------------------------------------
// TriggerEngineOptions — constructor shape for TriggerEngine (Plan 60-02).
// ---------------------------------------------------------------------------

export type TriggerEngineOptions = Readonly<{
  turnDispatcher: import("../manager/turn-dispatcher.js").TurnDispatcher;
  taskStore: import("../tasks/store.js").TaskStore;
  log: import("pino").Logger;
  config: Readonly<{
    replayMaxAgeMs: number;
    dedupLruSize: number;
    defaultDebounceMs: number;
  }>;
}>;

// ---------------------------------------------------------------------------
// Default constants — exported for use by config schema and tests.
// ---------------------------------------------------------------------------

/** Max LRU entries for Layer 1 idempotency dedup. */
export const DEFAULT_DEDUP_LRU_SIZE = 10_000;

/** Default per-source debounce window in milliseconds (Layer 2). */
export const DEFAULT_DEBOUNCE_MS = 5_000;

/** Default max age for watermark-based replay on restart (24 hours). */
export const DEFAULT_REPLAY_MAX_AGE_MS = 86_400_000;
