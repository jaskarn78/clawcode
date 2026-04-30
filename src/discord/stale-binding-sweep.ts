/**
 * Phase 999.14 — MCP-09 Wave 0 declaration shim.
 *
 * This module's runtime is a stub that throws — Wave 1 replaces every
 * function below with a real implementation. The TYPES and CONTRACTS here
 * are load-bearing: they are the exact signatures Wave 1 must conform to.
 *
 * Contract pinned by `src/discord/__tests__/stale-binding-sweep.test.ts`.
 */

import type { Logger } from "pino";
import type { ThreadBinding, ThreadBindingRegistry } from "./thread-types.js";
import type { ThreadCleanupSpawner } from "./thread-cleanup.js";

export interface ScanStaleBindingsArgs {
  readonly registry: ThreadBindingRegistry;
  readonly now: number;
  /** Idle threshold in ms. <= 0 disables sweep (returns []). */
  readonly idleMs: number;
}

/**
 * Pure function — return entries where `now - lastActivity > idleMs`.
 * Sorted by oldest first (deterministic for log output).
 * If idleMs <= 0, returns [] (sweep disabled).
 */
export function scanStaleBindings(
  _args: ScanStaleBindingsArgs,
): readonly ThreadBinding[] {
  throw new Error(
    "scanStaleBindings: not implemented in Wave 0 — Wave 1 lands the GREEN code",
  );
}

/**
 * Parse an idle-duration string like "24h" / "6h" / "30m" / "0".
 * Returns the duration in milliseconds. "0" maps to 0 (sweep disabled).
 * Throws on unparseable input.
 */
export function parseIdleDuration(_input: string): number {
  throw new Error(
    "parseIdleDuration: not implemented in Wave 0 — Wave 1 lands the GREEN code",
  );
}

export interface SweepStaleBindingsArgs {
  readonly spawner: ThreadCleanupSpawner;
  readonly registryPath: string;
  readonly now: number;
  readonly idleMs: number;
  readonly log: Logger;
}

export interface SweepStaleBindingsResult {
  readonly staleCount: number;
  readonly prunedCount: number;
  readonly agents: Readonly<Record<string, number>>;
}

/**
 * Periodic sweep — reads registry, calls scanStaleBindings, invokes
 * cleanupThreadWithClassifier per stale entry, emits a single summary
 * warn log per cycle:
 *   { component: 'thread-cleanup', action: 'stale-sweep', staleCount,
 *     prunedCount, agents:{...alphabetical}, idleMs,
 *     msg: 'stale-binding sweep complete' }
 *
 * Behavior:
 *   - idleMs <= 0 → returns immediately, no log (sweep disabled).
 *   - staleCount === 0 → debug-level log only (no warn).
 *   - Individual cleanup failures do not abort the sweep — sweep continues
 *     and the failed entry is excluded from prunedCount.
 */
export async function sweepStaleBindings(
  _args: SweepStaleBindingsArgs,
): Promise<SweepStaleBindingsResult> {
  throw new Error(
    "sweepStaleBindings: not implemented in Wave 0 — Wave 1 lands the GREEN code",
  );
}
