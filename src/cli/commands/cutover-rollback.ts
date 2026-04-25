/**
 * Phase 92 Plan 06 — `clawcode cutover rollback` subcommand (CUT-10 + D-10).
 *
 * Rewinds cutover-ledger.jsonl rows newer than `--ledger-to <ISO timestamp>`
 * in LIFO order:
 *   - apply-additive missing-skill        → remove from skills[] + delete dir
 *   - apply-additive missing-memory-file  → unlink target file
 *   - apply-additive missing-upload       → unlink target file
 *   - apply-additive model-not-in-allowlist → remove from allowedModels[]
 *   - apply-destructive outdated-memory-file (with preChangeSnapshot, < 64KB)
 *                                         → restore pre-change content from snapshot
 *   - apply-destructive mcp-credential-drift / tool-permission-gap (audit-only,
 *                                          no preChangeSnapshot) → log
 *                                          rollback-skipped-irreversible audit row
 *
 * Idempotency mechanism (D-10):
 *   The ledger is APPEND-ONLY — rollback never mutates existing rows. Instead
 *   a NEW row with `action: "rollback"` AND `reason: "rollback-of:<origTimestamp>"`
 *   is appended for each successful revert. The "is this row already rolled back?"
 *   check scans the ledger for any prior `action: "rollback"` row whose reason
 *   contains the literal `rollback-of:<origTimestamp>` marker. Re-running
 *   rollback over already-rewound rows yields zero new reverts.
 *
 * Production invocation requires the same atomic YAML writers + rsync helpers
 * the additive applier consumed in Plan 92-03 — until those are wired, this
 * CLI surface emits a clear "daemon required" error analogous to cutover-verify.
 *
 * The IDEMPOTENCY MARKER literal "rollback-of:" is pinned by static-grep in
 * source so reviewers can grep for it without diving into runtime traces.
 */

import type { Command } from "commander";
import pino, { type Logger } from "pino";

import { cliError, cliLog } from "../output.js";
import { DEFAULT_CUTOVER_LEDGER_PATH } from "../../cutover/ledger.js";

/**
 * Idempotency reason marker — every rollback row's `reason` field begins
 * with this literal string followed by the original row's timestamp.
 * Pinned by static-grep so the convention can't drift silently.
 */
export const ROLLBACK_OF_REASON_PREFIX = "rollback-of:";

export type RunCutoverRollbackArgs = Readonly<{
  agent: string;
  ledgerTo: string;
  ledgerPath?: string;
  log?: Logger;
}>;

export async function runCutoverRollbackAction(
  args: RunCutoverRollbackArgs,
): Promise<number> {
  const log = args.log ?? (pino({ level: "info" }) as unknown as Logger);
  const ledgerPath = args.ledgerPath ?? DEFAULT_CUTOVER_LEDGER_PATH;

  // First-pass: surface the same "daemon required" gate cutover-verify uses.
  // The full LIFO rewind requires DI for atomic YAML writers + filesystem
  // operations the daemon owns. The CLI scaffolding + idempotency marker +
  // ledger path resolution are pinned here for the follow-up wiring plan.
  cliError(
    `cutover rollback requires daemon-IPC for the atomic YAML writers + filesystem rewind primitives — invoke via daemon IPC handler (follow-up plan) or pass DI hooks programmatically. ledgerPath=${ledgerPath}, ledgerTo=${args.ledgerTo}, idempotency marker prefix=${ROLLBACK_OF_REASON_PREFIX}<origTimestamp>.`,
  );
  log.warn(
    { agent: args.agent, ledgerTo: args.ledgerTo, ledgerPath },
    "cutover rollback: daemon-IPC not yet wired; CLI standalone invocation is a no-op",
  );
  return 1;
}

export function registerCutoverRollbackCommand(parent: Command): void {
  parent
    .command("rollback")
    .description(
      "Rewind cutover-ledger.jsonl rows newer than --ledger-to in LIFO order. Idempotent via rollback-of:<ts> reason markers; re-running yields zero new reverts.",
    )
    .requiredOption("--agent <name>", "Agent whose cutover rows to rewind")
    .requiredOption(
      "--ledger-to <iso-timestamp>",
      "Rewind all rows newer than this ISO 8601 timestamp (LIFO order)",
    )
    .option(
      "--ledger-path <path>",
      `Override cutover-ledger.jsonl path (default: ${DEFAULT_CUTOVER_LEDGER_PATH})`,
    )
    .action(
      async (opts: {
        agent: string;
        ledgerTo: string;
        ledgerPath?: string;
      }) => {
        const code = await runCutoverRollbackAction({
          agent: opts.agent,
          ledgerTo: opts.ledgerTo,
          ...(opts.ledgerPath !== undefined
            ? { ledgerPath: opts.ledgerPath }
            : {}),
        });
        cliLog(`cutover rollback exit code: ${code}`);
        process.exit(code);
      },
    );
}
