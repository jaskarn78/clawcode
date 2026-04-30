/**
 * Phase 999.14 — MCP-08 Wave 0 declaration shim.
 *
 * This module's runtime is a stub that throws — Wave 1 replaces every
 * function below with a real implementation. The TYPES and CONTRACTS here
 * are load-bearing: they are the exact signatures Wave 1 must conform to.
 *
 * Why a thrower stub instead of a missing module?
 *   - Keeps `tsc --noEmit` clean (RED tests can import these symbols
 *     without "Cannot find module" errors).
 *   - Tests still RED at runtime — every test that exercises the helper
 *     hits the "not implemented in Wave 0" throw and fails.
 *   - Wave 1 deletes this file's body and writes the real implementation,
 *     turning the RED tests green.
 *
 * Contract pinned by `src/discord/__tests__/thread-cleanup.test.ts` —
 * see those tests for the canonical truth table.
 */

import type { Logger } from "pino";
import type { ThreadBindingRegistry } from "./thread-types.js";

/**
 * Classification of a Discord cleanup error.
 *   - "prune"   — Discord says the thread is gone server-side. Safe to
 *                 prune the registry binding.
 *   - "retain"  — Transient error (5xx, 429, network). Leave registry
 *                 intact so the next sweep can retry.
 *   - "unknown" — Anything else. Caller treats as retain (conservative).
 */
export type DiscordCleanupClassification = "prune" | "retain" | "unknown";

/**
 * Classification including the success path (used by cleanupThreadWithClassifier
 * return value to distinguish "archived OK" from the error paths).
 */
export type CleanupClassification =
  | "success"
  | DiscordCleanupClassification;

/**
 * Pure function — given an error from a Discord setArchived attempt,
 * classify whether the binding should be pruned, retained, or unknown.
 *
 * @returns "prune" for Discord codes 50001 / 10003 / HTTP 404.
 * @returns "retain" for HTTP 5xx / 429 / network codes (ECONNRESET,
 *          ETIMEDOUT, ENOTFOUND, EAI_AGAIN).
 * @returns "unknown" for everything else (caller treats as retain).
 */
export function classifyDiscordCleanupError(
  _err: unknown,
): DiscordCleanupClassification {
  throw new Error(
    "classifyDiscordCleanupError: not implemented in Wave 0 — Wave 1 lands the GREEN code",
  );
}

/**
 * Minimal spawner surface needed by the cleanup helper (the existing
 * SubagentThreadSpawner.archiveThread signature). Defined here as a
 * structural type so tests can pass `vi.fn()` without instantiating the
 * full class.
 */
export interface ThreadCleanupSpawner {
  archiveThread(
    threadId: string,
    opts?: { lock?: boolean },
  ): Promise<{ bindingPruned: boolean }>;
}

export interface CleanupThreadArgs {
  readonly spawner: ThreadCleanupSpawner;
  readonly registryPath: string;
  readonly threadId: string;
  readonly agentName: string;
  readonly log: Logger;
  readonly lock?: boolean;
}

export interface CleanupThreadResult {
  readonly archived: boolean;
  readonly bindingPruned: boolean;
  readonly classification: CleanupClassification;
}

/**
 * Archive a Discord thread with classified-error cleanup semantics.
 *
 * Behavior contract (pinned by thread-cleanup.test.ts):
 *   - Happy path: spawner.archiveThread resolves → returns
 *     { archived:true, bindingPruned:true, classification:"success" }.
 *     No warn log emitted.
 *   - Discord 50001 / 10003 / 404 → registry pruned via removeBinding +
 *     writeThreadRegistry, returns
 *     { archived:false, bindingPruned:true, classification:"prune" }.
 *     Canonical warn log emitted: { component:'thread-cleanup',
 *     action:'prune-after-discord-error', discordCode, threadId, agentName }.
 *   - 5xx / 429 / network → registry NOT pruned, returns
 *     { archived:false, bindingPruned:false, classification:"retain" }.
 *     Info-level log only (5xx storms must not blow up logs).
 *   - Unknown error → registry NOT pruned, returns
 *     { archived:false, bindingPruned:false, classification:"unknown" }.
 */
export async function cleanupThreadWithClassifier(
  _args: CleanupThreadArgs,
): Promise<CleanupThreadResult> {
  throw new Error(
    "cleanupThreadWithClassifier: not implemented in Wave 0 — Wave 1 lands the GREEN code",
  );
}

/**
 * Re-export so the sweep helper (MCP-09) and the IPC handler (MCP-10)
 * can use a single ThreadBindingRegistry symbol when wired in Wave 1.
 */
export type { ThreadBindingRegistry };
