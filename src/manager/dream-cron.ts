/**
 * Phase 95 Plan 02 Task 2 — D-06 per-agent dream cron timer.
 *
 * Pure-DI module mirroring the src/manager/daily-summary-cron.ts pattern:
 *   - cronFactory is dependency-injected (production wraps `new Cron()`;
 *     tests pass a stub that captures the callback for synchronous trigger)
 *   - isAgentIdle is dependency-injected (the idle-window detector primitive
 *     from Plan 95-01)
 *   - runDreamPass + applyDreamResult are dependency-injected (production
 *     wiring at the daemon edge bridges to the dream-pass + dream-auto-apply
 *     primitives plus the daemon's TurnDispatcher / auto-linker / writeDreamLog)
 *
 * Per-agent schedule label = "dream" — visible in /clawcode-status schedule
 * list per D-06.
 *
 * Note on placement: Plan 95-02 originally referred to a non-existent
 * `src/manager/agent-bootstrap.ts` file. The repo's per-agent cron pattern
 * lives in standalone modules (e.g. daily-summary-cron.ts) wired by the
 * daemon at startup, so this module follows that pattern. Production
 * wiring will be done at the daemon-edge in Plan 95-03 (or in a follow-up
 * to the daemon's startAgent() flow).
 */

import { Cron } from "croner";
import type { DreamPassOutcome } from "./dream-pass.js";
import type { DreamApplyOutcome } from "./dream-auto-apply.js";
import type {
  IsAgentIdleDeps,
  IsAgentIdleResult,
} from "./idle-window-detector.js";

/**
 * Cron handle returned by the factory — trims the surface to just `.stop()`.
 */
export interface DreamCronHandle {
  readonly stop: () => void;
}

/**
 * Cron factory signature. Production passes a wrapper over `new Cron(...)`;
 * tests pass a stub that captures the callback for deterministic triggering.
 */
export type DreamCronFactory = (
  pattern: string,
  opts: { readonly name: string },
  callback: () => void | Promise<void>,
) => DreamCronHandle;

/** Default production factory — thin wrapper over `new Cron(...)`. */
const DEFAULT_DREAM_CRON_FACTORY: DreamCronFactory = (
  pattern,
  opts,
  callback,
) => {
  const cron = new Cron(pattern, { name: opts.name }, async () => {
    await callback();
  });
  return {
    stop: () => cron.stop(),
  };
};

/**
 * Dream-cron registration deps.
 */
export interface DreamCronDeps {
  readonly agentName: string;
  readonly dreamConfig: {
    readonly enabled: boolean;
    readonly idleMinutes: number;
    readonly model: string;
  };
  readonly getLastTurnAt: () => Date | null;
  readonly runDreamPass: (agent: string) => Promise<DreamPassOutcome>;
  readonly applyDreamResult: (
    agent: string,
    outcome: DreamPassOutcome,
  ) => Promise<DreamApplyOutcome>;
  readonly isAgentIdle: (deps: IsAgentIdleDeps) => IsAgentIdleResult;
  readonly now: () => Date;
  readonly log: {
    readonly info: (msg: string) => void;
    readonly warn: (msg: string) => void;
    readonly error: (msg: string) => void;
  };
  /** Override for tests — defaults to real croner. */
  readonly cronFactory?: DreamCronFactory;
}

export interface DreamCronRegistration {
  readonly registered: boolean;
  readonly reason?: string;
  readonly unregister?: () => void;
  readonly label: "dream";
}

/**
 * Register a per-agent dream cron timer.
 *
 * Behavior:
 *   - dream.enabled === false → no Cron created; returns
 *     {registered:false, reason:'disabled', label:'dream'}
 *   - dream.enabled === true → schedules `*\/${idleMinutes} * * * *` cron;
 *     each tick consults isAgentIdle, fires runDreamPass + applyDreamResult
 *     when idle, logs a skip when active
 *
 * Errors thrown by runDreamPass or applyDreamResult are caught and logged
 * — a single mis-fire does not crash the cron (subsequent ticks keep firing).
 */
export function registerDreamCron(deps: DreamCronDeps): DreamCronRegistration {
  if (!deps.dreamConfig.enabled) {
    return { registered: false, reason: "disabled", label: "dream" };
  }

  const factory = deps.cronFactory ?? DEFAULT_DREAM_CRON_FACTORY;
  const pattern = `*/${deps.dreamConfig.idleMinutes} * * * *`;

  const handle = factory(pattern, { name: "dream" }, async () => {
    const idle = deps.isAgentIdle({
      lastTurnAt: deps.getLastTurnAt(),
      idleMinutes: deps.dreamConfig.idleMinutes,
      now: deps.now,
    });
    if (!idle.idle) {
      deps.log.info(
        `[dream] skip — agent ${deps.agentName} active (${idle.reason})`,
      );
      return;
    }
    try {
      const outcome = await deps.runDreamPass(deps.agentName);
      const applied = await deps.applyDreamResult(deps.agentName, outcome);
      deps.log.info(
        `[dream] ${deps.agentName} ${applied.kind}: ${JSON.stringify(applied)}`,
      );
    } catch (err) {
      deps.log.error(
        `[dream] ${deps.agentName} crashed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  });

  return {
    registered: true,
    label: "dream",
    unregister: () => handle.stop(),
  };
}
