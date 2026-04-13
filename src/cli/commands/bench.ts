/**
 * `clawcode bench` — latency regression gate CLI (Plan 51-02).
 *
 * Runs the bench harness against an isolated daemon, writes a JSON report,
 * prints a diff table, and offers three orthogonal output modes:
 *
 *   --json              → raw BenchReport JSON (for piping into other tools)
 *   --check-regression  → compare vs baseline + thresholds; exit 1 on breach
 *   --update-baseline   → diff, prompt y/N, write baseline.json on confirm,
 *                         print copy-pasteable commit hint
 *
 * The baseline update flow NEVER auto-writes. Operator confirmation is
 * mandatory so baseline changes stay reviewable via git commit history.
 *
 * SECURITY: all three flags are idempotent and read-only until the
 * operator types "y"/"yes" at the confirm prompt. The commit hint is a
 * string emitted to stdout; Claude/the CLI never executes it.
 */

import type { Command } from "commander";
import os from "node:os";
import readline from "node:readline";

import { runBench } from "../../benchmarks/runner.js";
import {
  readBaseline,
  writeBaseline,
  formatDiffTable,
} from "../../benchmarks/baseline.js";
import {
  loadThresholds,
  evaluateRegression,
  type Regression,
} from "../../benchmarks/thresholds.js";
import { BenchmarkConfigError, type Baseline } from "../../benchmarks/types.js";
import { cliLog, cliError } from "../output.js";

const DEFAULT_PROMPTS_PATH = ".planning/benchmarks/prompts.yaml";
const DEFAULT_BASELINE_PATH = ".planning/benchmarks/baseline.json";
const DEFAULT_THRESHOLDS_PATH = ".planning/benchmarks/thresholds.yaml";
const DEFAULT_REPORTS_DIR = ".planning/benchmarks/reports";

/**
 * Render a regression table for `--check-regression` failure output.
 * Columns: Segment / Baseline p95 / Current p95 / Delta % / Threshold %.
 *
 * Returns `"(no regressions)"` when `regressions` is empty — callers
 * normally check `result.status === "regressed"` before calling this,
 * but the empty-case string is a sensible default for tests.
 */
export function formatRegressionTable(
  regressions: readonly Regression[],
): string {
  if (regressions.length === 0) return "(no regressions)";
  const headers = [
    "Segment",
    "Baseline p95",
    "Current p95",
    "Delta %",
    "Threshold %",
  ];
  const rows = regressions.map((r) => [
    r.segment,
    `${r.baselineMs} ms`,
    `${r.currentMs} ms`,
    `+${r.deltaPct.toFixed(1)}%`,
    `${r.thresholdPct.toFixed(1)}%`,
  ]);
  const allRows: string[][] = [headers, ...rows];
  const widths = headers.map((_, col) =>
    Math.max(...allRows.map((r) => (r[col] ?? "").length)),
  );
  const separator = widths.map((w) => "-".repeat(w)).join("  ");
  const formatted = allRows.map((row, idx) => {
    const line = row
      .map((cell, col) =>
        col === 0 ? cell.padEnd(widths[col]!) : cell.padStart(widths[col]!),
      )
      .join("  ");
    return idx === 0 ? `${line}\n${separator}` : line;
  });
  return formatted.join("\n");
}

/**
 * Build the copy-pasteable commit hint emitted after a successful
 * `--update-baseline` write. Shape matches the CONTEXT.md spec:
 *
 *   git add <baselinePath> && git commit -m "perf(bench): update baseline (run <runId>, sha <sha7>)"
 *
 * `sha7` is the first 7 chars of gitSha (or the full sha if shorter — the
 * "unknown" fallback from runBench is passed through verbatim).
 */
export function buildCommitHint(
  baselinePath: string,
  runId: string,
  gitSha: string,
): string {
  const sha7 = gitSha.length >= 7 ? gitSha.slice(0, 7) : gitSha;
  return `git add ${baselinePath} && git commit -m "perf(bench): update baseline (run ${runId}, sha ${sha7})"`;
}

/**
 * Ask the operator to confirm a baseline write. Returns `true` only on
 * an explicit "y" or "yes" (case-insensitive). Anything else — including
 * timeout / EOF — is a hard NO.
 *
 * In tests pass `stdinReader` to avoid touching real stdin. In
 * production the readline.question path is used.
 */
export async function confirmBaselineUpdate(
  prompt: string,
  stdinReader?: () => Promise<string>,
): Promise<boolean> {
  if (stdinReader) {
    const answer = (await stdinReader()).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  }
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await new Promise<string>((resolve) => {
    rl.question(prompt, (ans) => {
      rl.close();
      resolve(ans);
    });
  });
  const trimmed = answer.trim().toLowerCase();
  return trimmed === "y" || trimmed === "yes";
}

/**
 * Options injectable into the bench action for testing. Production uses
 * defaults (real runner, real baseline I/O, real readline). Tests pass
 * stubs to avoid spawning daemons / touching real files.
 */
export type BenchActionDeps = {
  readonly runBench?: typeof runBench;
  readonly readBaseline?: typeof readBaseline;
  readonly writeBaseline?: typeof writeBaseline;
  readonly loadThresholds?: typeof loadThresholds;
  readonly evaluateRegression?: typeof evaluateRegression;
  readonly confirmBaselineUpdate?: typeof confirmBaselineUpdate;
  readonly getUsername?: () => string;
  readonly exit?: (code: number) => void;
};

/**
 * Register the `clawcode bench` command on a Commander program. The deps
 * parameter exists solely for tests — production callers pass nothing.
 */
export function registerBenchCommand(
  program: Command,
  deps: BenchActionDeps = {},
): void {
  const runBenchFn = deps.runBench ?? runBench;
  const readBaselineFn = deps.readBaseline ?? readBaseline;
  const writeBaselineFn = deps.writeBaseline ?? writeBaseline;
  const loadThresholdsFn = deps.loadThresholds ?? loadThresholds;
  const evaluateRegressionFn = deps.evaluateRegression ?? evaluateRegression;
  const confirmFn = deps.confirmBaselineUpdate ?? confirmBaselineUpdate;
  const getUsername = deps.getUsername ?? (() => os.userInfo().username);
  const exit = deps.exit ?? ((code) => process.exit(code));

  program
    .command("bench")
    .description(
      "Run the latency benchmark suite (PERF-04). See .planning/benchmarks/.",
    )
    .option("--prompts <path>", "Path to prompts YAML", DEFAULT_PROMPTS_PATH)
    .option(
      "--baseline <path>",
      "Path to baseline JSON",
      DEFAULT_BASELINE_PATH,
    )
    .option(
      "--thresholds <path>",
      "Path to thresholds YAML",
      DEFAULT_THRESHOLDS_PATH,
    )
    .option(
      "--reports-dir <path>",
      "Reports output directory",
      DEFAULT_REPORTS_DIR,
    )
    .option("--agent <name>", "Bench agent name", "bench-agent")
    .option("--repeats <n>", "Repeats per prompt", (v) => Number(v), 5)
    .option("--since <duration>", "Latency window for percentiles", "1h")
    .option("--json", "Emit JSON instead of pretty output", false)
    .option(
      "--update-baseline",
      "Prompt to write baseline.json after the run",
      false,
    )
    .option(
      "--check-regression",
      "Compare against baseline + thresholds; exit 1 on regression",
      false,
    )
    .action(
      async (opts: {
        prompts: string;
        baseline: string;
        thresholds: string;
        reportsDir: string;
        agent: string;
        repeats: number;
        since: string;
        json: boolean;
        updateBaseline: boolean;
        checkRegression: boolean;
      }) => {
        try {
          cliLog(
            `Running bench against ${opts.agent} (${opts.repeats}× per prompt)…`,
          );
          const { report, reportPath } = await runBenchFn({
            promptsPath: opts.prompts,
            agent: opts.agent,
            repeats: opts.repeats,
            since: opts.since,
            reportsDir: opts.reportsDir,
          });
          cliLog(`Report written to ${reportPath}`);

          if (opts.json) {
            console.log(JSON.stringify(report, null, 2));
            return;
          }

          // Load baseline for the diff table. Missing file is NOT an error
          // on first-time benches — emit a friendly note and proceed.
          let baselineForDiff: Baseline | null = null;
          try {
            baselineForDiff = readBaselineFn(opts.baseline);
          } catch (err) {
            if (
              err instanceof BenchmarkConfigError &&
              /read failed/.test(err.message)
            ) {
              cliLog(`(no baseline yet at ${opts.baseline})`);
            } else {
              throw err;
            }
          }

          cliLog("");
          cliLog(formatDiffTable(report, baselineForDiff));
          cliLog("");

          if (opts.checkRegression) {
            if (!baselineForDiff) {
              cliError(
                `--check-regression requires a baseline at ${opts.baseline}`,
              );
              exit(1);
              return;
            }
            const thresholds = loadThresholdsFn(opts.thresholds);
            const result = evaluateRegressionFn(
              report,
              baselineForDiff,
              thresholds,
            );
            if (result.status === "regressed") {
              cliError("Regression detected:");
              cliError(formatRegressionTable(result.regressions));
              exit(1);
              return;
            }
            cliLog("No regressions detected (status: clean).");
            return;
          }

          if (opts.updateBaseline) {
            const ok = await confirmFn(
              `Write this report as the new baseline at ${opts.baseline}? [y/N] `,
            );
            if (!ok) {
              cliLog("Baseline NOT updated.");
              return;
            }
            const newBaseline = writeBaselineFn(opts.baseline, report, {
              username: getUsername(),
              gitSha: report.git_sha,
            });
            cliLog(
              `Baseline updated. Provenance: updated_by=${newBaseline.updated_by}, updated_at=${newBaseline.updated_at}.`,
            );
            cliLog("");
            cliLog("Suggested commit:");
            cliLog(
              buildCommitHint(opts.baseline, report.run_id, report.git_sha),
            );
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          cliError(`bench failed: ${msg}`);
          exit(1);
        }
      },
    );
}
