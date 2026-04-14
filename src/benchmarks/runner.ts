/**
 * Bench runner — end-to-end orchestrator (Plan 51-02).
 *
 * `runBench(opts)` is the single entry point the CLI calls. It:
 *
 *   1. Loads the prompt set via `loadPrompts(promptsPath)`.
 *   2. Creates a tempdir HOME (unless a factory is injected for tests).
 *   3. Writes a minimal bench-agent config via `writeBenchAgentConfig`.
 *   4. Spawns an isolated daemon via `spawnIsolatedDaemon`.
 *   5. Waits for readiness via `awaitDaemonReady`.
 *   6. Best-effort starts the bench-agent (idempotent).
 *   7. For each prompt × each repeat, calls the `bench-run-prompt` IPC
 *      method (which runs `sendToAgent` inside a Turn — see daemon).
 *   8. For each prompt, snapshots `/latency` to capture percentiles.
 *   9. Snapshots `/latency` once more for `overall_percentiles`, ensuring
 *      all 4 canonical segments are present (count=0 rows included).
 *  10. Writes `${reportsDir}/${run_id}.json` and returns the report.
 *  11. Tears down the daemon in `finally{}` — GUARANTEED even on error.
 *
 * `git rev-parse HEAD` runs via `execSync` — falls back to "unknown" on
 * failure (not-in-a-checkout, no git installed, etc). Bench runs should
 * never fail because of a missing git binary.
 *
 * Fully dependency-injectable for tests: pass `harness`, `ipcClient`, or
 * `tmpHomeFactory` to avoid spawning real daemons or touching `os.tmpdir`.
 */

import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { nanoid } from "nanoid";

import { sendIpcRequest } from "../ipc/client.js";
import {
  spawnIsolatedDaemon,
  awaitDaemonReady,
  writeBenchAgentConfig,
  type DaemonHandle,
} from "./harness.js";
import { loadPrompts } from "./prompts.js";
import {
  type BenchReport,
  type PromptResult,
  type PercentileRowSchema,
} from "./types.js";
import {
  type LatencyReport,
  type PercentileRow,
} from "../performance/types.js";

/**
 * Phase 54 Plan 03 — bench `overall_percentiles` stays on the original 4
 * Phase 51 segment names even though `CANONICAL_SEGMENTS` now lists 6.
 *
 * Rationale: `.planning/benchmarks/baseline.json` was committed against the
 * 4-name `segmentEnum` in `src/benchmarks/types.ts`. Promoting the new 2
 * segments into the baseline report would break Zod parse for every
 * historical baseline. The 2 new segments (first_visible_token,
 * typing_indicator) are still emitted in per-prompt `promptResults.percentiles`
 * (captured verbatim from the latency IPC response) — only the aggregate
 * `overall_percentiles` row is backward-compat filtered.
 */
const BACKWARD_COMPAT_BENCH_SEGMENTS = [
  "end_to_end",
  "first_token",
  "context_assemble",
  "tool_call",
] as const;

/** Dependency-injection bundle for the harness layer. */
export type HarnessDeps = {
  readonly spawn: typeof spawnIsolatedDaemon;
  readonly awaitReady: typeof awaitDaemonReady;
  readonly writeConfig: typeof writeBenchAgentConfig;
};

/** Options for `runBench`. */
export type RunBenchOpts = {
  readonly promptsPath: string;
  readonly agent?: string;
  readonly repeats?: number;
  readonly since?: string;
  readonly reportsDir: string;
  /** DI hook: override the harness layer entirely (tests only). */
  readonly harness?: HarnessDeps;
  /** DI hook: override `sendIpcRequest` (tests only). */
  readonly ipcClient?: typeof sendIpcRequest;
  /** DI hook: override the tempdir creator (tests only). */
  readonly tmpHomeFactory?: () => string;
  /**
   * Phase 53 Plan 03 — when true, collect the `response` text length from
   * each `bench-run-prompt` IPC call and include a `response_lengths`
   * map in the BenchReport (per-prompt average chars). Consumed by
   * `clawcode bench --context-audit` to diff against baseline and enforce
   * the 15% response-length regression gate.
   *
   * Default: false (preserves Phase 51 baseline schema / behavior).
   */
  readonly captureResponses?: boolean;
};

/** Result of a successful `runBench`. */
export type RunBenchResult = {
  readonly report: BenchReport;
  readonly reportPath: string;
};

/**
 * Orchestrate one bench invocation. Always tears down the daemon in
 * `finally{}` — whether the bench succeeded, failed, or errored partway.
 *
 * @throws The underlying error only AFTER the daemon is torn down. The
 *         caller sees a clean tempdir + no orphaned daemon process.
 */
export async function runBench(opts: RunBenchOpts): Promise<RunBenchResult> {
  const repeats = opts.repeats ?? 5;
  const since = opts.since ?? "1h";
  const agentName = opts.agent ?? "bench-agent";
  const prompts = loadPrompts(opts.promptsPath);

  const tmpHome =
    opts.tmpHomeFactory?.() ??
    mkdtempSync(join(tmpdir(), "clawcode-bench-"));
  const harness: HarnessDeps = opts.harness ?? {
    spawn: spawnIsolatedDaemon,
    awaitReady: awaitDaemonReady,
    writeConfig: writeBenchAgentConfig,
  };
  const client = opts.ipcClient ?? sendIpcRequest;

  const configPath = await harness.writeConfig(tmpHome, {
    agentName,
    model: "haiku",
  });
  const handle: DaemonHandle = await harness.spawn({
    tmpHome,
    configPath,
  });

  try {
    const ready = await harness.awaitReady(handle.socketPath);
    if (!ready) {
      throw new Error(
        `bench daemon failed to become ready at ${handle.socketPath}`,
      );
    }

    // Best-effort agent start. The daemon may have already started it on
    // boot (Phase 42 auto-start); `start` is idempotent so either branch
    // converges to "running".
    try {
      await client(handle.socketPath, "start", { name: agentName });
    } catch {
      /* may already be running — not fatal */
    }

    const promptResults: PromptResult[] = [];
    // Phase 53 Plan 03 — per-prompt response-length totals, averaged after
    // the loop and attached to the report when `captureResponses === true`.
    const responseLengthTotals = new Map<string, { sum: number; n: number }>();
    // Phase 54 Plan 03 — accumulated Discord rate-limit error count across
    // every bench-run-prompt response. Reported on BenchReport so
    // `bench --check-regression` can hard-fail on any non-zero total.
    let totalRateLimitErrors = 0;

    for (const prompt of prompts) {
      const turnIds: string[] = [];
      for (let i = 0; i < repeats; i++) {
        const res = (await client(handle.socketPath, "bench-run-prompt", {
          agent: agentName,
          prompt: prompt.prompt,
          turnIdPrefix: `bench:${prompt.id}:`,
        })) as {
          turnId: string;
          response: string;
          rate_limit_errors?: number;
        };
        turnIds.push(res.turnId);
        if (typeof res.rate_limit_errors === "number") {
          totalRateLimitErrors += res.rate_limit_errors;
        }
        if (opts.captureResponses) {
          const len = typeof res.response === "string" ? res.response.length : 0;
          const current = responseLengthTotals.get(prompt.id) ?? {
            sum: 0,
            n: 0,
          };
          current.sum += len;
          current.n += 1;
          responseLengthTotals.set(prompt.id, current);
        }
      }

      // After all repeats for this prompt, snapshot the percentiles for
      // the bench window. Per-prompt percentiles fold into the overall
      // snapshot taken below.
      const latencyForPrompt = (await client(handle.socketPath, "latency", {
        agent: agentName,
        since,
      })) as LatencyReport;
      promptResults.push({
        id: prompt.id,
        turnIds,
        percentiles: [
          ...latencyForPrompt.segments,
        ] as PercentileRowSchema[],
      });
    }

    // Final overall snapshot. Map to the 4 BACKWARD_COMPAT_BENCH_SEGMENTS
    // so even segments with no data emit a {count: 0} placeholder row AND
    // so Phase 54's two new canonical segments (first_visible_token,
    // typing_indicator) are filtered out of the baseline-compatible row set.
    const overallLatency = (await client(handle.socketPath, "latency", {
      agent: agentName,
      since,
    })) as LatencyReport;
    const segMap = new Map<string, PercentileRow>(
      overallLatency.segments.map((s) => [s.segment, s]),
    );
    const overall_percentiles: PercentileRow[] = BACKWARD_COMPAT_BENCH_SEGMENTS.map(
      (seg) =>
        segMap.get(seg) ?? {
          segment: seg,
          p50: null,
          p95: null,
          p99: null,
          count: 0,
        },
    );

    let gitSha = "unknown";
    try {
      gitSha = execSync("git rev-parse HEAD", {
        encoding: "utf-8",
      }).trim();
    } catch {
      /* not in a git checkout or git unavailable — leave "unknown" */
    }

    // Phase 53 Plan 03 — compute per-prompt average response length when
    // captureResponses was enabled. Absent key by default = backward-compat.
    const responseLengths: Record<string, number> | undefined =
      opts.captureResponses
        ? Object.fromEntries(
            [...responseLengthTotals.entries()].map(([id, { sum, n }]) => [
              id,
              n > 0 ? Math.round(sum / n) : 0,
            ]),
          )
        : undefined;

    const report: BenchReport = Object.freeze({
      run_id: nanoid(12),
      started_at: new Date().toISOString(),
      git_sha: gitSha,
      node_version: process.version,
      prompt_results: Object.freeze(
        promptResults,
      ) as unknown as PromptResult[],
      overall_percentiles: Object.freeze(
        overall_percentiles,
      ) as unknown as PercentileRowSchema[],
      ...(responseLengths ? { response_lengths: responseLengths } : {}),
      rate_limit_errors: totalRateLimitErrors,
    });

    mkdirSync(opts.reportsDir, { recursive: true });
    const reportPath = join(opts.reportsDir, `${report.run_id}.json`);
    writeFileSync(
      reportPath,
      JSON.stringify(report, null, 2) + "\n",
      "utf-8",
    );
    return Object.freeze({ report, reportPath });
  } finally {
    await handle.stop();
  }
}
