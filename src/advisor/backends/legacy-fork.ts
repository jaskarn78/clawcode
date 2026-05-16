/**
 * LegacyForkAdvisor — wraps the extracted `forkAdvisorConsult()` primitive
 * as an `AdvisorBackend` implementation. This is the operator rollback
 * path for Phase 117 — agents whose `advisor.backend` is set to `"fork"`
 * (default is `"native"` once Plan 117-06 lands the config schema) take
 * the same code path as pre-117 production: fork the agent under an
 * Opus override, dispatch one turn, kill the fork.
 *
 * The real fork logic lives in `src/manager/daemon.ts:forkAdvisorConsult`
 * (extracted in Plan 117-03 T02 from the inline body that previously
 * lived at `daemon.ts:9843–9854`). This class is a thin adapter — it
 * exists so:
 *   1. The provider-neutral `AdvisorService` can dispatch to legacy
 *      behavior through the same `AdvisorBackend.consult({...})` shape
 *      as the native and (future) portable backends.
 *   2. `BackendId === "fork"` resolves to a real callable in the
 *      registry (Plan 117-02 / 117-06 wiring).
 *
 * Plan reference: CONTEXT.md `<scope>` —
 *   "`LegacyForkAdvisor` — wraps today's daemon fork logic extracted
 *    into a function. Preserves current behavior as the rollback path."
 *
 * RESEARCH §3 file map row for `src/advisor/backends/legacy-fork.ts`.
 *
 * Circular-dependency note (RESEARCH §3, Plan 117-03 T03 step 4):
 *   `legacy-fork.ts` imports `forkAdvisorConsult` from
 *   `src/manager/daemon.ts`. `daemon.ts` imports nothing from
 *   `src/advisor/backends/` and only depends on `src/advisor/prompts.ts`
 *   for the system-prompt builder — so the dep graph is a tree:
 *
 *     legacy-fork.ts → daemon.ts → advisor/prompts.ts
 *
 *   No cycle exists. If a future change adds `daemon.ts → backends/*`
 *   the escape hatch documented in the plan is to move
 *   `forkAdvisorConsult` into a new file `src/manager/fork-advisor.ts`
 *   and re-export from daemon.ts.
 */

import type { AdvisorBackend } from "./types.js";
import type { BackendId } from "../types.js";
import type { SessionManager } from "../../manager/session-manager.js";
import { forkAdvisorConsult } from "../../manager/daemon.js";

/**
 * `AdvisorBackend` implementation that dispatches via the legacy
 * `forkSession` + `dispatchTurn` + `stopAgent` primitive.
 *
 * The backend itself owns no state — it just forwards `consult()` to
 * `forkAdvisorConsult(this.manager, args)`. The injected `manager` is
 * the daemon-wide `SessionManager` singleton (constructed in
 * `daemon.ts:bootstrap` and registered into the `BackendRegistry` by
 * Plan 117-06/117-07).
 */
export class LegacyForkAdvisor implements AdvisorBackend {
  readonly id: BackendId = "fork";

  constructor(private readonly manager: SessionManager) {}

  /**
   * Perform one fork-based advisor consultation.
   *
   * Behavior is identical to the pre-117 inline IPC body — see
   * `forkAdvisorConsult` in `src/manager/daemon.ts` for the contract
   * (try/finally stopAgent invariant, no truncation/budget here).
   *
   * Returns the raw (untruncated) answer; the caller — today the IPC
   * handler in `daemon.ts:ask-advisor`, Plan 117-07 the
   * `AdvisorService` — owns truncation and budget recording.
   */
  async consult(args: {
    agent: string;
    question: string;
    systemPrompt: string;
    advisorModel: string;
  }): Promise<{ answer: string }> {
    return forkAdvisorConsult(this.manager, args);
  }
}
