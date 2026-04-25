/**
 * Phase 92 Plan 06 — `clawcode cutover verify` subcommand (CUT-09).
 *
 * The single operator-facing entry point that orchestrates Plans 92-01..05
 * end-to-end via `runVerifyPipeline`. Emits CUTOVER-REPORT.md with the
 * `cutover_ready: true|false` binary signal in BOTH the YAML frontmatter
 * AND the literal end-of-document line `Cutover ready: true|false`.
 *
 * Production invocation requires daemon-IPC for the dispatcher / dispatchStream
 * / probe primitives — until the daemon-side IPC handler lands, this command
 * is callable only from hermetic tests OR daemon contexts that inject the
 * required dependencies. Standalone CLI invocation surfaces a clear "daemon
 * required" error (matching the precedent set by `clawcode cutover canary`).
 */

import type { Command } from "commander";
import { homedir } from "node:os";
import { join } from "node:path";
import pino, { type Logger } from "pino";

import { cliError, cliLog } from "../output.js";
import {
  CANARY_API_ENDPOINT,
  CANARY_CHANNEL_ID,
  CANARY_TIMEOUT_MS,
} from "../../cutover/types.js";

export type RunCutoverVerifyArgs = Readonly<{
  agent: string;
  applyAdditive?: boolean;
  outputDir?: string;
  stagingDir?: string;
  depthMsgs?: number;
  log?: Logger;
}>;

/**
 * Run one cutover verify cycle. Daemon-side IPC dispatch is required to wire
 * the LLM dispatcher / Discord stream / MCP IPC — this CLI surface remains
 * thin until a follow-up plan adds the daemon-IPC handler (mirrors
 * `cutover canary` which has the same constraint).
 */
export async function runCutoverVerifyAction(
  args: RunCutoverVerifyArgs,
): Promise<number> {
  const log = args.log ?? (pino({ level: "info" }) as unknown as Logger);

  cliError(
    "cutover verify requires daemon-IPC for the LLM dispatcher + Discord stream + MCP probe — invoke via daemon IPC handler (follow-up plan) or pass DI hooks programmatically. " +
      `Defaults: outputDir=~/.clawcode/manager/cutover-reports/${args.agent}/, stagingDir=~/.clawcode/manager/cutover-staging/${args.agent}/, canary=${CANARY_API_ENDPOINT} + channel ${CANARY_CHANNEL_ID} + timeout ${CANARY_TIMEOUT_MS}ms.`,
  );
  log.warn(
    { agent: args.agent },
    "cutover verify: daemon-IPC not yet wired; CLI standalone invocation is a no-op",
  );
  return 1;
}

export function registerCutoverVerifyCommand(parent: Command): void {
  parent
    .command("verify")
    .description(
      "Run the full cutover verify pipeline (ingest → profile → probe → diff → apply-additive[dry-run-default] → canary[opt-in] → report). Emits CUTOVER-REPORT.md with cutover_ready signal.",
    )
    .requiredOption("--agent <name>", "Agent under verification")
    .option(
      "--apply-additive",
      "Apply the 4 additive CutoverGap kinds (default: dry-run; destructive gaps NEVER auto-applied)",
    )
    .option(
      "--output-dir <path>",
      `Override CUTOVER-REPORT.md output directory (default: ~/.clawcode/manager/cutover-reports/<agent>/)`,
    )
    .option(
      "--staging-dir <path>",
      `Override staging directory for ingestor JSONL (default: ~/.clawcode/manager/cutover-staging/<agent>/)`,
    )
    .option(
      "--depth-msgs <n>",
      "Discord history depth cap per channel (default: 10000)",
      (v) => parseInt(v, 10),
    )
    .action(
      async (opts: {
        agent: string;
        applyAdditive?: boolean;
        outputDir?: string;
        stagingDir?: string;
        depthMsgs?: number;
      }) => {
        const code = await runCutoverVerifyAction({
          agent: opts.agent,
          ...(opts.applyAdditive !== undefined
            ? { applyAdditive: opts.applyAdditive }
            : {}),
          ...(opts.outputDir !== undefined
            ? { outputDir: opts.outputDir }
            : {
                outputDir: join(
                  homedir(),
                  ".clawcode",
                  "manager",
                  "cutover-reports",
                  opts.agent,
                ),
              }),
          ...(opts.stagingDir !== undefined
            ? { stagingDir: opts.stagingDir }
            : {
                stagingDir: join(
                  homedir(),
                  ".clawcode",
                  "manager",
                  "cutover-staging",
                  opts.agent,
                ),
              }),
          ...(opts.depthMsgs !== undefined
            ? { depthMsgs: opts.depthMsgs }
            : {}),
        });
        cliLog(`cutover verify exit code: ${code}`);
        process.exit(code);
      },
    );
}
