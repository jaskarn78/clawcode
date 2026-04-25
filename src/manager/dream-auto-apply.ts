/**
 * Phase 95 Plan 02 Task 2 — D-04 dream-result auto-applier.
 *
 * Pure-DI module:
 *   - No SDK imports
 *   - No fs imports (writeDreamLog is dependency-injected)
 *   - No MEMORY.md mutations (pinned by static-grep regression rule —
 *     promotionCandidates + suggestedConsolidations SURFACE only)
 *
 * D-04 contract (intentionally narrow):
 *   - newWikilinks → applied via deps.applyAutoLinks (Phase 36-41 idiom)
 *   - promotionCandidates + themedReflection + suggestedConsolidations →
 *     SURFACED to the dream log for operator review; never auto-applied
 *
 * The 3-variant DreamPassOutcome union (completed | skipped | failed) is
 * consumed via the same exhaustive switch idiom established in Plan 95-01.
 */

import type { DreamPassOutcome } from "./dream-pass.js";
import type { WriteDreamLogFn } from "./dream-log-writer.js";

/**
 * Discriminated outcome of a single auto-apply attempt. The CLI / Discord
 * renderers (Plan 95-03) match on `kind` for human-readable surfacing.
 */
export type DreamApplyOutcome =
  | {
      readonly kind: "applied";
      readonly appliedWikilinkCount: number;
      readonly surfacedPromotionCount: number;
      readonly surfacedConsolidationCount: number;
      readonly logPath: string;
    }
  | {
      readonly kind: "skipped";
      readonly reason: "no-completed-result";
    }
  | {
      readonly kind: "failed";
      readonly error: string;
    };

export interface DreamApplyLog {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

/**
 * DI surface. The auto-applier itself stays pure: production wiring at the
 * daemon edge maps `applyAutoLinks` to the Phase 36-41 link applier and
 * `writeDreamLog` to the dream-log-writer module.
 *
 * NOTE: deliberately NO `applyPromotion` or `applyConsolidation` field —
 * surfacing-only invariant pinned at the type level.
 */
export interface ApplyDreamResultDeps {
  readonly applyAutoLinks: (
    agent: string,
    links: ReadonlyArray<{ from: string; to: string }>,
  ) => Promise<{ added: number }>;
  readonly writeDreamLog: WriteDreamLogFn;
  readonly memoryRoot: string;
  readonly now: () => Date;
  readonly log: DreamApplyLog;
}

/**
 * Apply a dream-pass outcome.
 *
 * Returns a 3-variant DreamApplyOutcome — never throws. Application failures
 * fold into `{kind:'failed', error}`. Wikilinks already persisted are NOT
 * rolled back when the dream-log write subsequently fails (operator-surface
 * reasoning: links are valuable on their own; the operator can investigate
 * the missing log via the structured log line).
 */
export async function applyDreamResult(
  agentName: string,
  outcome: DreamPassOutcome,
  deps: ApplyDreamResultDeps,
): Promise<DreamApplyOutcome> {
  if (outcome.kind !== "completed") {
    deps.log.info(
      `dream-apply: ${agentName} skipped (no completed result; outcome.kind=${outcome.kind})`,
    );
    return { kind: "skipped", reason: "no-completed-result" };
  }

  // Build the entry that flows into the dream log regardless of outcome
  // path (success or failed-application).
  const entry = {
    timestamp: deps.now(),
    idleMinutes: 0, // caller (cron tick) supplies actual; primitive doesn't recompute
    model: outcome.model,
    result: outcome.result,
    tokensIn: outcome.tokensIn,
    tokensOut: outcome.tokensOut,
    durationMs: outcome.durationMs,
  };

  let appliedCount = 0;
  let linkErr: unknown = null;
  try {
    const linkArgs = outcome.result.newWikilinks.map((w) => ({
      from: w.from,
      to: w.to,
    }));
    const applyResult = await deps.applyAutoLinks(agentName, linkArgs);
    appliedCount = applyResult.added;
  } catch (err) {
    linkErr = err;
    deps.log.error(
      `dream-apply: ${agentName} applyAutoLinks failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  // Write the dream log even when applyAutoLinks failed — operator gets a
  // log entry surfacing the failure for diagnosis.
  let logPath: string | null = null;
  let logErr: unknown = null;
  try {
    const logResult = await deps.writeDreamLog({
      agentName,
      memoryRoot: deps.memoryRoot,
      entry,
    });
    logPath = logResult.logPath;
  } catch (err) {
    logErr = err;
    deps.log.error(
      `dream-apply: ${agentName} writeDreamLog failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  // Failure precedence: applyAutoLinks failure first (more user-facing).
  if (linkErr !== null) {
    return {
      kind: "failed",
      error: linkErr instanceof Error ? linkErr.message : String(linkErr),
    };
  }
  if (logErr !== null) {
    // Wikilinks ARE persisted — no rollback. Operator surfaces the missing
    // log via the structured error message.
    return {
      kind: "failed",
      error: `dream-log-write-failed: ${
        logErr instanceof Error ? logErr.message : String(logErr)
      }`,
    };
  }

  // Both succeeded — applied outcome.
  // Non-null assertion: logErr === null implies logPath was assigned.
  const finalLogPath = logPath as string;
  deps.log.info(
    `dream-apply: ${agentName} applied ${appliedCount} wikilinks; surfaced ${outcome.result.promotionCandidates.length} promotions + ${outcome.result.suggestedConsolidations.length} consolidations; log=${finalLogPath}`,
  );
  return {
    kind: "applied",
    appliedWikilinkCount: appliedCount,
    surfacedPromotionCount: outcome.result.promotionCandidates.length,
    surfacedConsolidationCount: outcome.result.suggestedConsolidations.length,
    logPath: finalLogPath,
  };
}
