/**
 * Phase 77 apply-preflight orchestrator. Runs the 4 guards in canonical
 * order, writes one ledger row per invoked guard, and returns a numeric
 * exit code + the first-refusal diagnostics for the CLI (Plan 03).
 *
 * Guard order (fail-fast sequential, do NOT reorder):
 *   1. checkDaemonRunning     (fastest fail — no fs work)
 *   2. pre-flight:readonly    (witness row only — runtime fs-writeFile
 *                              interceptor is installed by Plan 03's CLI
 *                              entry BEFORE this orchestrator runs. This
 *                              file never installs process-global hooks.)
 *   3. scanSecrets            (pure PlanReport walk)
 *   4. detectChannelCollisions (loadConfig + set intersection)
 *
 * DO NOT:
 *   - Reorder guards — operator expectation is "fastest fail first".
 *   - Append rows out of order — ledger ordering is forensic evidence.
 *   - Continue past a refuse — short-circuit is the point.
 *   - Install the fs interceptor here — Plan 03 owns that (commander
 *     action scope, with a single install/uninstall pair per command).
 *   - Recompute `sourceHash` — the caller owns derivation (PlanReport.planHash
 *     or a dedicated hash of openclaw.json); the orchestrator passes it
 *     verbatim to every guard for witness correlation.
 */
import { appendRow } from "./ledger.js";
import {
  checkDaemonRunning,
  scanSecrets,
  detectChannelCollisions,
} from "./guards.js";
import type { PlanReport } from "./diff-builder.js";
import type { OpenclawSourceInventory } from "./openclaw-config-reader.js";

export type ApplyPreflightArgs = {
  readonly inventory: OpenclawSourceInventory;
  readonly report: PlanReport;
  readonly existingConfigPath: string;
  readonly ledgerPath: string;
  readonly sourceHash: string;
  readonly filter?: string;
  readonly ts?: () => string;
  readonly execaRunner?: (
    cmd: string,
    args: string[],
  ) => Promise<{ stdout: string; exitCode: number | null }>;
};

export type ApplyPreflightResult = {
  readonly exitCode: 0 | 1;
  readonly firstRefusal?: {
    readonly step: string;
    readonly message: string;
    readonly reportBody?: string;
  };
  readonly ranGuards: readonly string[];
};

export async function runApplyPreflight(
  args: ApplyPreflightArgs,
): Promise<ApplyPreflightResult> {
  const ts = args.ts ?? (() => new Date().toISOString());
  const agent = args.filter ?? "ALL";
  const ranGuards: string[] = [];

  // --- Guard 1: daemon ------------------------------------------------
  const daemon = await checkDaemonRunning({
    ts,
    agent,
    source_hash: args.sourceHash,
    execaRunner: args.execaRunner,
  });
  await appendRow(args.ledgerPath, daemon.ledgerRow);
  ranGuards.push("pre-flight:daemon");
  if (!daemon.pass) {
    return {
      exitCode: 1,
      firstRefusal: {
        step: "pre-flight:daemon",
        message: daemon.message,
        reportBody: daemon.reportBody,
      },
      ranGuards,
    };
  }

  // --- Guard 2: read-only witness ------------------------------------
  // The actual fs-writeFile interceptor is installed by Plan 03's CLI
  // entry point (once, for the lifetime of the `apply` command). This
  // orchestrator only records a witness row to keep ledger order
  // consistent with the canonical 4-guard sequence. If the interceptor
  // fired, a `ReadOnlySourceError` would already have aborted the CLI
  // with its own refuse row — this witness is the "no attempted writes
  // under ~/.openclaw/ during guard evaluation" positive assertion.
  await appendRow(args.ledgerPath, {
    ts: ts(),
    action: "apply",
    agent,
    status: "pending",
    source_hash: args.sourceHash,
    step: "pre-flight:readonly",
    outcome: "allow",
    notes:
      "runtime fs-guard installed by CLI entry (Plan 03); orchestrator records witness only",
  });
  ranGuards.push("pre-flight:readonly");

  // --- Guard 3: secret scan ------------------------------------------
  const secret = scanSecrets({
    ts,
    report: args.report,
    source_hash: args.sourceHash,
  });
  await appendRow(args.ledgerPath, secret.ledgerRow);
  ranGuards.push("pre-flight:secret");
  if (!secret.pass) {
    return {
      exitCode: 1,
      firstRefusal: {
        step: "pre-flight:secret",
        message: secret.message,
        reportBody: secret.reportBody,
      },
      ranGuards,
    };
  }

  // --- Guard 4: channel collision ------------------------------------
  const channel = await detectChannelCollisions({
    ts,
    inventory: args.inventory,
    existingConfigPath: args.existingConfigPath,
    source_hash: args.sourceHash,
    filter: args.filter,
  });
  await appendRow(args.ledgerPath, channel.ledgerRow);
  ranGuards.push("pre-flight:channel");
  if (!channel.pass) {
    return {
      exitCode: 1,
      firstRefusal: {
        step: "pre-flight:channel",
        message: channel.message,
        reportBody: channel.reportBody,
      },
      ranGuards,
    };
  }

  return { exitCode: 0, ranGuards };
}
