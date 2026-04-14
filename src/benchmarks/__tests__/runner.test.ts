import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runBench } from "../runner.js";
import { benchReportSchema } from "../types.js";
import type { HarnessDeps } from "../runner.js";

function writePromptsYaml(dir: string): string {
  const path = join(dir, "prompts.yaml");
  writeFileSync(
    path,
    `prompts:
  - id: "short-reply"
    prompt: "Say hi."
  - id: "memory-lookup"
    prompt: "Recall favorite color."
`,
    "utf-8",
  );
  return path;
}

function makeLatencyResponse() {
  return {
    agent: "bench-agent",
    since: "2026-04-13T20:00:00.000Z",
    segments: [
      { segment: "end_to_end", p50: 1000, p95: 2000, p99: 3000, count: 10 },
      { segment: "first_token", p50: 400, p95: 800, p99: 1200, count: 10 },
      { segment: "context_assemble", p50: 50, p95: 100, p99: 150, count: 10 },
      { segment: "tool_call", p50: 75, p95: 150, p99: 225, count: 20 },
    ],
  };
}

function makeStubHarness(opts: {
  socketPath: string;
  ready?: boolean;
  writeConfigResult?: string;
  stopSpy?: ReturnType<typeof vi.fn>;
}): HarnessDeps {
  const stopFn = opts.stopSpy ?? vi.fn().mockResolvedValue(undefined);
  return {
    spawn: (async () => ({
      pid: 9999,
      socketPath: opts.socketPath,
      stop: stopFn,
    })) as unknown as HarnessDeps["spawn"],
    awaitReady: (async () =>
      opts.ready ?? true) as unknown as HarnessDeps["awaitReady"],
    writeConfig: (async () =>
      opts.writeConfigResult ??
      "/tmp/clawcode-bench.yaml") as unknown as HarnessDeps["writeConfig"],
  };
}

describe("runBench", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "runner-test-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns a BenchReport with prompt_results per prompt × repeats", async () => {
    const promptsPath = writePromptsYaml(tmp);
    const reportsDir = join(tmp, "reports");
    const socketPath = join(tmp, ".clawcode", "manager", "clawcode.sock");

    const ipcClient = vi.fn(async (_sock, method) => {
      if (method === "bench-run-prompt") {
        return { turnId: `bench:t:${Math.random().toString(36).slice(2, 8)}`, response: "ok" };
      }
      if (method === "latency") return makeLatencyResponse();
      if (method === "start") return { ok: true };
      throw new Error(`unexpected method ${method}`);
    });

    const { report } = await runBench({
      promptsPath,
      agent: "bench-agent",
      repeats: 2,
      since: "1h",
      reportsDir,
      harness: makeStubHarness({ socketPath }),
      ipcClient,
      tmpHomeFactory: () => tmp,
    });

    expect(report.prompt_results).toHaveLength(2);
    expect(report.prompt_results[0]!.turnIds).toHaveLength(2);
    expect(report.prompt_results[1]!.turnIds).toHaveLength(2);
    expect(report.run_id).toMatch(/.+/);
    expect(report.node_version).toBe(process.version);
  });

  it("writes a report JSON file that round-trips through benchReportSchema", async () => {
    const promptsPath = writePromptsYaml(tmp);
    const reportsDir = join(tmp, "reports");
    const socketPath = join(tmp, ".clawcode", "manager", "clawcode.sock");

    const ipcClient = vi.fn(async (_s, method) => {
      if (method === "bench-run-prompt")
        return { turnId: "bench:t:abcdef", response: "ok" };
      if (method === "latency") return makeLatencyResponse();
      if (method === "start") return { ok: true };
      throw new Error(`unexpected method ${method}`);
    });

    const { report, reportPath } = await runBench({
      promptsPath,
      agent: "bench-agent",
      repeats: 1,
      reportsDir,
      harness: makeStubHarness({ socketPath }),
      ipcClient,
      tmpHomeFactory: () => tmp,
    });

    expect(reportPath).toBe(join(reportsDir, `${report.run_id}.json`));
    const onDisk = JSON.parse(readFileSync(reportPath, "utf-8"));
    const parsed = benchReportSchema.safeParse(onDisk);
    expect(parsed.success).toBe(true);
  });

  it("tears down the daemon in finally{} even when an IPC call throws", async () => {
    const promptsPath = writePromptsYaml(tmp);
    const reportsDir = join(tmp, "reports");
    const socketPath = join(tmp, ".clawcode", "manager", "clawcode.sock");
    const stopSpy = vi.fn().mockResolvedValue(undefined);

    // IPC fails partway — the runner must still call handle.stop().
    const ipcClient = vi.fn(async (_s, method) => {
      if (method === "start") return { ok: true };
      if (method === "bench-run-prompt") throw new Error("simulated IPC failure");
      if (method === "latency") return makeLatencyResponse();
      throw new Error(`unexpected method ${method}`);
    });

    await expect(
      runBench({
        promptsPath,
        agent: "bench-agent",
        repeats: 1,
        reportsDir,
        harness: makeStubHarness({ socketPath, stopSpy }),
        ipcClient,
        tmpHomeFactory: () => tmp,
      }),
    ).rejects.toThrow(/simulated IPC failure/);

    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  it("produces overall_percentiles with exactly 4 canonical segments (even count=0 rows)", async () => {
    const promptsPath = writePromptsYaml(tmp);
    const reportsDir = join(tmp, "reports");
    const socketPath = join(tmp, ".clawcode", "manager", "clawcode.sock");

    // Return only 2 segments — runner must backfill the missing 2 with count=0.
    const ipcClient = vi.fn(async (_s, method) => {
      if (method === "bench-run-prompt")
        return { turnId: "bench:t:partial", response: "ok" };
      if (method === "start") return { ok: true };
      if (method === "latency")
        return {
          agent: "bench-agent",
          since: "2026-04-13T20:00:00.000Z",
          segments: [
            { segment: "end_to_end", p50: 1000, p95: 2000, p99: 3000, count: 10 },
            { segment: "first_token", p50: 400, p95: 800, p99: 1200, count: 10 },
          ],
        };
      throw new Error(`unexpected method ${method}`);
    });

    const { report } = await runBench({
      promptsPath,
      agent: "bench-agent",
      repeats: 1,
      reportsDir,
      harness: makeStubHarness({ socketPath }),
      ipcClient,
      tmpHomeFactory: () => tmp,
    });

    expect(report.overall_percentiles).toHaveLength(4);
    const segs = report.overall_percentiles.map((r) => r.segment);
    expect(segs).toEqual([
      "end_to_end",
      "first_token",
      "context_assemble",
      "tool_call",
    ]);
    const contextRow = report.overall_percentiles.find(
      (r) => r.segment === "context_assemble",
    );
    expect(contextRow?.count).toBe(0);
    expect(contextRow?.p50).toBeNull();
  });

  it("captures git_sha from git rev-parse HEAD when git is available", async () => {
    const promptsPath = writePromptsYaml(tmp);
    const reportsDir = join(tmp, "reports");
    const socketPath = join(tmp, ".clawcode", "manager", "clawcode.sock");

    const ipcClient = vi.fn(async (_s, method) => {
      if (method === "bench-run-prompt")
        return { turnId: "bench:t:xyz", response: "ok" };
      if (method === "start") return { ok: true };
      if (method === "latency") return makeLatencyResponse();
      throw new Error(`unexpected method ${method}`);
    });

    const { report } = await runBench({
      promptsPath,
      agent: "bench-agent",
      repeats: 1,
      reportsDir,
      harness: makeStubHarness({ socketPath }),
      ipcClient,
      tmpHomeFactory: () => tmp,
    });

    // We're inside a git checkout — sha should be a 40-char hex or "unknown"
    // (the latter is a valid fallback when git is unavailable).
    expect(report.git_sha).toMatch(/^(?:[a-f0-9]{40}|unknown)$/);
  });

  it("Test 18 (Phase 53): captureResponses=true includes response_lengths in BenchReport", async () => {
    const promptsPath = writePromptsYaml(tmp);
    const reportsDir = join(tmp, "reports");
    const socketPath = join(tmp, ".clawcode", "manager", "clawcode.sock");

    const responses: Record<string, string[]> = {
      "short-reply": ["hi there", "hello again friendly"],
      "memory-lookup": ["blue is the favored color"],
    };

    const ipcClient = vi.fn(async (_s, method, params) => {
      if (method === "bench-run-prompt") {
        const turnIdPrefix = (params as { turnIdPrefix?: string })
          ?.turnIdPrefix ?? "bench:t:";
        // Extract prompt id from turnIdPrefix (format: `bench:<id>:`)
        const match = turnIdPrefix.match(/^bench:([^:]+):/);
        const id = match?.[1] ?? "unknown";
        const pool = responses[id] ?? ["generic reply"];
        const idx = Math.floor(Math.random() * pool.length);
        const response = pool[idx]!;
        return { turnId: `bench:t:${Math.random()}`, response };
      }
      if (method === "latency") return makeLatencyResponse();
      if (method === "start") return { ok: true };
      throw new Error(`unexpected method ${method}`);
    });

    const { report } = await runBench({
      promptsPath,
      agent: "bench-agent",
      repeats: 2,
      since: "1h",
      reportsDir,
      harness: makeStubHarness({ socketPath }),
      ipcClient,
      tmpHomeFactory: () => tmp,
      captureResponses: true,
    });

    const lengths = (report as unknown as {
      response_lengths?: Record<string, number>;
    }).response_lengths;
    expect(lengths).toBeDefined();
    expect(typeof lengths!["short-reply"]).toBe("number");
    expect(typeof lengths!["memory-lookup"]).toBe("number");
    expect(lengths!["memory-lookup"]).toBeGreaterThan(0);
  });

  // ── Phase 54 Plan 03 — rate_limit_errors counter + 4-segment backward-compat filter ──

  it("Test 20 (Phase 54): runBench output includes rate_limit_errors: 0 when no rate-limit events occur", async () => {
    const promptsPath = writePromptsYaml(tmp);
    const reportsDir = join(tmp, "reports");
    const socketPath = join(tmp, ".clawcode", "manager", "clawcode.sock");

    const ipcClient = vi.fn(async (_s, method) => {
      if (method === "bench-run-prompt") {
        return { turnId: "bench:t:abc", response: "ok", rate_limit_errors: 0 };
      }
      if (method === "latency") return makeLatencyResponse();
      if (method === "start") return { ok: true };
      throw new Error(`unexpected method ${method}`);
    });

    const { report } = await runBench({
      promptsPath,
      agent: "bench-agent",
      repeats: 1,
      reportsDir,
      harness: makeStubHarness({ socketPath }),
      ipcClient,
      tmpHomeFactory: () => tmp,
    });

    expect(report.rate_limit_errors).toBe(0);
  });

  it("Test 21 (Phase 54): runBench sums rate-limit counts across prompt responses (2 prompts × 1 = 2 total)", async () => {
    const promptsPath = writePromptsYaml(tmp);
    const reportsDir = join(tmp, "reports");
    const socketPath = join(tmp, ".clawcode", "manager", "clawcode.sock");

    // Each bench-run-prompt call returns rate_limit_errors: 1
    const ipcClient = vi.fn(async (_s, method) => {
      if (method === "bench-run-prompt") {
        return { turnId: "bench:t:rl", response: "ok", rate_limit_errors: 1 };
      }
      if (method === "latency") return makeLatencyResponse();
      if (method === "start") return { ok: true };
      throw new Error(`unexpected method ${method}`);
    });

    const { report } = await runBench({
      promptsPath,
      agent: "bench-agent",
      repeats: 1, // 2 prompts x 1 repeat = 2 calls => rate_limit_errors = 2
      reportsDir,
      harness: makeStubHarness({ socketPath }),
      ipcClient,
      tmpHomeFactory: () => tmp,
    });

    expect(report.rate_limit_errors).toBe(2);
  });

  it("Test 22 (Phase 54): runner's overall_percentiles contains EXACTLY the 4 Phase 51 canonical segments (filters out first_visible_token + typing_indicator)", async () => {
    const promptsPath = writePromptsYaml(tmp);
    const reportsDir = join(tmp, "reports");
    const socketPath = join(tmp, ".clawcode", "manager", "clawcode.sock");

    // The daemon's latency response includes the 2 NEW Phase 54 segments
    // (first_visible_token, typing_indicator) — runner must filter them out
    // of overall_percentiles so baseline.json Zod parse still succeeds.
    const ipcClient = vi.fn(async (_s, method) => {
      if (method === "bench-run-prompt") {
        return { turnId: "bench:t:x", response: "ok", rate_limit_errors: 0 };
      }
      if (method === "latency") {
        return {
          agent: "bench-agent",
          since: "2026-04-13T20:00:00.000Z",
          segments: [
            { segment: "end_to_end", p50: 1000, p95: 2000, p99: 3000, count: 10 },
            { segment: "first_token", p50: 400, p95: 800, p99: 1200, count: 10 },
            { segment: "first_visible_token", p50: 420, p95: 820, p99: 1220, count: 10 }, // new Phase 54
            { segment: "context_assemble", p50: 50, p95: 100, p99: 150, count: 10 },
            { segment: "tool_call", p50: 75, p95: 150, p99: 225, count: 20 },
            { segment: "typing_indicator", p50: 50, p95: 100, p99: 150, count: 10 }, // new Phase 54
          ],
        };
      }
      if (method === "start") return { ok: true };
      throw new Error(`unexpected method ${method}`);
    });

    const { report } = await runBench({
      promptsPath,
      agent: "bench-agent",
      repeats: 1,
      reportsDir,
      harness: makeStubHarness({ socketPath }),
      ipcClient,
      tmpHomeFactory: () => tmp,
    });

    expect(report.overall_percentiles).toHaveLength(4);
    const segs = report.overall_percentiles.map((r) => r.segment);
    expect(segs).toEqual([
      "end_to_end",
      "first_token",
      "context_assemble",
      "tool_call",
    ]);
    // Explicit absence checks
    expect(segs).not.toContain("first_visible_token");
    expect(segs).not.toContain("typing_indicator");
  });

  it("Test 23 (Phase 54): runner's per-prompt promptResults.percentiles MAY contain the 2 new segments (only overall is backward-compat filtered)", async () => {
    const promptsPath = writePromptsYaml(tmp);
    const reportsDir = join(tmp, "reports");
    const socketPath = join(tmp, ".clawcode", "manager", "clawcode.sock");

    // Per-prompt percentiles are captured verbatim from the latency IPC
    // response — they preserve the full 6-segment shape for debugging.
    const extendedLatency = {
      agent: "bench-agent",
      since: "2026-04-13T20:00:00.000Z",
      segments: [
        { segment: "end_to_end", p50: 1000, p95: 2000, p99: 3000, count: 10 },
        { segment: "first_token", p50: 400, p95: 800, p99: 1200, count: 10 },
        { segment: "first_visible_token", p50: 420, p95: 820, p99: 1220, count: 10 },
        { segment: "context_assemble", p50: 50, p95: 100, p99: 150, count: 10 },
        { segment: "tool_call", p50: 75, p95: 150, p99: 225, count: 20 },
        { segment: "typing_indicator", p50: 50, p95: 100, p99: 150, count: 10 },
      ],
    };
    const ipcClient = vi.fn(async (_s, method) => {
      if (method === "bench-run-prompt") {
        return { turnId: "bench:t:x", response: "ok", rate_limit_errors: 0 };
      }
      if (method === "latency") return extendedLatency;
      if (method === "start") return { ok: true };
      throw new Error(`unexpected method ${method}`);
    });

    const { report } = await runBench({
      promptsPath,
      agent: "bench-agent",
      repeats: 1,
      reportsDir,
      harness: makeStubHarness({ socketPath }),
      ipcClient,
      tmpHomeFactory: () => tmp,
    });

    // Per-prompt percentiles are verbatim — 6 segments preserved
    expect(report.prompt_results[0]!.percentiles).toHaveLength(6);
    const perPromptSegs = report.prompt_results[0]!.percentiles.map(
      (r) => r.segment,
    );
    expect(perPromptSegs).toContain("first_visible_token");
    expect(perPromptSegs).toContain("typing_indicator");
  });

  it("Test 19 (Phase 53): captureResponses=false (default) omits response_lengths", async () => {
    const promptsPath = writePromptsYaml(tmp);
    const reportsDir = join(tmp, "reports");
    const socketPath = join(tmp, ".clawcode", "manager", "clawcode.sock");

    const ipcClient = vi.fn(async (_s, method) => {
      if (method === "bench-run-prompt") {
        return { turnId: "bench:t:abc", response: "ok" };
      }
      if (method === "latency") return makeLatencyResponse();
      if (method === "start") return { ok: true };
      throw new Error(`unexpected method ${method}`);
    });

    const { report } = await runBench({
      promptsPath,
      agent: "bench-agent",
      repeats: 1,
      reportsDir,
      harness: makeStubHarness({ socketPath }),
      ipcClient,
      tmpHomeFactory: () => tmp,
      // captureResponses omitted → default false
    });

    expect(
      (report as unknown as { response_lengths?: Record<string, number> })
        .response_lengths,
    ).toBeUndefined();
  });
});
