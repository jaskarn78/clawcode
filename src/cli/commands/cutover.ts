/**
 * Phase 92 Plan 01 — `clawcode cutover` top-level command group (D-11 amended).
 *
 * Registers the operator-facing subcommands that drive the OpenClaw →
 * ClawCode fin-acquisition cutover parity verifier:
 *
 *   clawcode cutover ingest   — pull conversation history into local JSONL
 *                               staging (MC API primary, Discord fallback)
 *   clawcode cutover profile  — chunked LLM pass over the staged history
 *                               → AGENT-PROFILE.json
 *
 * Plans 92-02..92-06 register:
 *   probe / diff / apply-additive / canary / verify / rollback
 *
 * Mirrors the Phase 91 sync.ts subcommand-group skeleton: each subcommand
 * exports its action as a pure async function (`run*Action`) returning the
 * exit code. Thin `register*Command` wrappers are the only place that
 * touches `process.exit`, keeping action functions hermetic for tests.
 */
import type { Command } from "commander";
import { registerCutoverIngestCommand } from "./cutover-ingest.js";
import { registerCutoverProfileCommand } from "./cutover-profile.js";

/**
 * Attach the `cutover` command group (and all its subcommands) to
 * `parent`. Called from src/cli/index.ts alongside other
 * `register*Command` functions. No side effects beyond command
 * registration — safe to call from tests via
 * `const c = new Command(); registerCutoverCommand(c);` and inspect
 * `c.commands` to verify wiring.
 */
export function registerCutoverCommand(parent: Command): void {
  const cutover = parent
    .command("cutover")
    .description(
      "OpenClaw → ClawCode cutover parity verifier — ingest (MC API + Discord), profile, probe, diff, fix, canary, verify",
    );

  registerCutoverIngestCommand(cutover);
  registerCutoverProfileCommand(cutover);
  // Plans 92-02..92-06 add: probe, diff, apply-additive, canary, verify, rollback
}
