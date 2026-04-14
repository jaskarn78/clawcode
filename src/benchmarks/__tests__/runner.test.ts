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
