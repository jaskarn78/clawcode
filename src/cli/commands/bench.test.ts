import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";

import {
  registerBenchCommand,
  formatRegressionTable,
  buildCommitHint,
  confirmBaselineUpdate,
} from "./bench.js";
import type { Regression } from "../../benchmarks/thresholds.js";
import type { BenchReport, Baseline } from "../../benchmarks/types.js";

function makeReport(
  overrides: Partial<BenchReport> = {},
): BenchReport {
  return {
    run_id: "test-run-123",
    started_at: "2026-04-13T21:00:00.000Z",
    git_sha: "abcdef1234567890abcdef1234567890abcdef12",
    node_version: "v22.11.0",
    prompt_results: [],
    overall_percentiles: [
      { segment: "end_to_end", p50: 1000, p95: 2000, p99: 3000, count: 25 },
      { segment: "first_token", p50: 400, p95: 800, p99: 1200, count: 25 },
      { segment: "context_assemble", p50: 50, p95: 100, p99: 150, count: 25 },
      { segment: "tool_call", p50: 75, p95: 150, p99: 225, count: 40 },
    ],
    ...overrides,
  };
}

function makeBaseline(overrides: Partial<Baseline> = {}): Baseline {
  return {
    ...makeReport(),
    updated_at: "2026-04-10T10:00:00.000Z",
    updated_by: "clawdy",
    ...overrides,
  };
}

describe("formatRegressionTable", () => {
  it("renders one row per regression with all 5 columns", () => {
    const regressions: Regression[] = [
      {
        segment: "end_to_end",
        baselineMs: 2000,
        currentMs: 2600,
        deltaPct: 30,
        thresholdPct: 20,
      },
    ];
    const out = formatRegressionTable(regressions);
    expect(out).toContain("Segment");
    expect(out).toContain("Baseline p95");
    expect(out).toContain("Current p95");
    expect(out).toContain("Delta %");
    expect(out).toContain("Threshold %");
    expect(out).toContain("end_to_end");
    expect(out).toContain("2000 ms");
    expect(out).toContain("2600 ms");
    expect(out).toContain("+30.0%");
    expect(out).toContain("20.0%");
  });

  it('returns "(no regressions)" for an empty array', () => {
    expect(formatRegressionTable([])).toBe("(no regressions)");
  });
});

describe("buildCommitHint", () => {
  it("returns the CONTEXT.md commit hint shape", () => {
    const hint = buildCommitHint(
      ".planning/benchmarks/baseline.json",
      "abc123def456",
      "deadbeefcafe123456789",
    );
    expect(hint).toBe(
      `git add .planning/benchmarks/baseline.json && git commit -m "perf(bench): update baseline (run abc123def456, sha deadbee)"`,
    );
  });

  it("handles short git sha without slicing past end", () => {
    const hint = buildCommitHint("p", "r", "abc");
    expect(hint).toContain("sha abc");
  });
});

describe("registerBenchCommand", () => {
  let program: Command;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();
    // Silence CLI output (process.stdout/stderr + console.log for --json).
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    consoleLogSpy = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  it("exposes all required flags", () => {
    registerBenchCommand(program);
    const bench = program.commands.find((c) => c.name() === "bench");
    expect(bench).toBeDefined();
    const longNames = bench!.options.map((o) => o.long);
    expect(longNames).toContain("--since");
    expect(longNames).toContain("--repeats");
    expect(longNames).toContain("--json");
    expect(longNames).toContain("--update-baseline");
    expect(longNames).toContain("--check-regression");
    expect(longNames).toContain("--agent");
    expect(longNames).toContain("--prompts");
    expect(longNames).toContain("--baseline");
    expect(longNames).toContain("--thresholds");
    expect(longNames).toContain("--reports-dir");
  });

  it("calls exit(1) when --check-regression detects a regression", async () => {
    const exitSpy = vi.fn();
    const runBenchStub = vi.fn(async () => ({
      report: makeReport(),
      reportPath: "/tmp/r.json",
    }));
    const readBaselineStub = vi.fn(() => makeBaseline());
    const loadThresholdsStub = vi.fn(() => ({
      defaultP95MaxDeltaPct: 20,
      segments: [],
    }));
    const evaluateRegressionStub = vi.fn(() => ({
      regressions: [
        {
          segment: "end_to_end" as const,
          baselineMs: 2000,
          currentMs: 2600,
          deltaPct: 30,
          thresholdPct: 20,
        },
      ],
      status: "regressed" as const,
    }));

    registerBenchCommand(program, {
      runBench: runBenchStub,
      readBaseline: readBaselineStub,
      loadThresholds: loadThresholdsStub,
      evaluateRegression: evaluateRegressionStub,
      exit: exitSpy,
    });

    await program.parseAsync([
      "node",
      "clawcode",
      "bench",
      "--check-regression",
    ]);

    expect(runBenchStub).toHaveBeenCalledOnce();
    expect(evaluateRegressionStub).toHaveBeenCalledOnce();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("does not call exit when --check-regression returns clean", async () => {
    const exitSpy = vi.fn();
    const runBenchStub = vi.fn(async () => ({
      report: makeReport(),
      reportPath: "/tmp/r.json",
    }));
    const readBaselineStub = vi.fn(() => makeBaseline());
    const loadThresholdsStub = vi.fn(() => ({
      defaultP95MaxDeltaPct: 20,
      segments: [],
    }));
    const evaluateRegressionStub = vi.fn(() => ({
      regressions: [] as Regression[],
      status: "clean" as const,
    }));

    registerBenchCommand(program, {
      runBench: runBenchStub,
      readBaseline: readBaselineStub,
      loadThresholds: loadThresholdsStub,
      evaluateRegression: evaluateRegressionStub,
      exit: exitSpy,
    });

    await program.parseAsync([
      "node",
      "clawcode",
      "bench",
      "--check-regression",
    ]);

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("writes baseline on --update-baseline when user confirms with 'y'", async () => {
    const exitSpy = vi.fn();
    const runBenchStub = vi.fn(async () => ({
      report: makeReport(),
      reportPath: "/tmp/r.json",
    }));
    const readBaselineStub = vi.fn(() => makeBaseline());
    const writeBaselineStub = vi.fn((_path, _rep, prov) =>
      makeBaseline({
        updated_by: prov.username,
        updated_at: "2026-04-13T21:30:00.000Z",
      }),
    );
    const confirmStub = vi.fn(async () => true);
    const getUsernameStub = vi.fn(() => "operator");
    // Capture stdout via the describe-level stdoutSpy.
    const stdoutChunks: string[] = [];
    stdoutSpy.mockImplementation((chunk: string | Uint8Array) => {
      stdoutChunks.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    });

    registerBenchCommand(program, {
      runBench: runBenchStub,
      readBaseline: readBaselineStub,
      writeBaseline: writeBaselineStub,
      confirmBaselineUpdate: confirmStub,
      getUsername: getUsernameStub,
      exit: exitSpy,
    });

    await program.parseAsync([
      "node",
      "clawcode",
      "bench",
      "--update-baseline",
    ]);

    expect(confirmStub).toHaveBeenCalledOnce();
    expect(writeBaselineStub).toHaveBeenCalledOnce();
    expect(writeBaselineStub.mock.calls[0]![2].username).toBe("operator");
    const combined = stdoutChunks.join("");
    expect(combined).toContain("git add");
    expect(combined).toContain("perf(bench): update baseline");
  });

  it("does NOT write baseline when user declines confirmation", async () => {
    const exitSpy = vi.fn();
    const runBenchStub = vi.fn(async () => ({
      report: makeReport(),
      reportPath: "/tmp/r.json",
    }));
    const readBaselineStub = vi.fn(() => makeBaseline());
    const writeBaselineStub = vi.fn();
    const confirmStub = vi.fn(async () => false);

    registerBenchCommand(program, {
      runBench: runBenchStub,
      readBaseline: readBaselineStub,
      writeBaseline: writeBaselineStub,
      confirmBaselineUpdate: confirmStub,
      exit: exitSpy,
    });

    await program.parseAsync([
      "node",
      "clawcode",
      "bench",
      "--update-baseline",
    ]);

    expect(confirmStub).toHaveBeenCalledOnce();
    expect(writeBaselineStub).not.toHaveBeenCalled();
  });
});

describe("confirmBaselineUpdate (stdinReader path)", () => {
  it("returns true on 'y'", async () => {
    const reader = async () => "y\n";
    expect(await confirmBaselineUpdate("prompt", reader)).toBe(true);
  });

  it("returns true on 'YES' (case-insensitive)", async () => {
    const reader = async () => "YES";
    expect(await confirmBaselineUpdate("prompt", reader)).toBe(true);
  });

  it("returns false on anything else", async () => {
    expect(await confirmBaselineUpdate("p", async () => "n")).toBe(false);
    expect(await confirmBaselineUpdate("p", async () => "")).toBe(false);
    expect(await confirmBaselineUpdate("p", async () => "nope")).toBe(false);
  });
});
