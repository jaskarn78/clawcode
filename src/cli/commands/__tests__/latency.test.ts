import { describe, it, expect, beforeEach, vi } from "vitest";
import { Command } from "commander";

// Mock the IPC client BEFORE importing the command module so that the
// `sendIpcRequest` reference in latency.ts is the mocked version.
vi.mock("../../../ipc/client.js", () => ({
  sendIpcRequest: vi.fn(),
}));

import { registerLatencyCommand } from "../latency.js";
import { sendIpcRequest } from "../../../ipc/client.js";

const mockedSendIpcRequest = vi.mocked(sendIpcRequest);

function makeReport() {
  return {
    agent: "alpha",
    since: "2026-04-12T00:00:00.000Z",
    segments: [
      { segment: "end_to_end", p50: 1000, p95: 2000, p99: 3000, count: 10 },
      { segment: "first_token", p50: 400, p95: 800, p99: 1200, count: 10 },
      { segment: "context_assemble", p50: 50, p95: 100, p99: 150, count: 10 },
      { segment: "tool_call", p50: 75, p95: 150, p99: 225, count: 20 },
    ],
  };
}

describe("clawcode latency", () => {
  let program: Command;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedSendIpcRequest.mockResolvedValue(makeReport());
    program = new Command();
    program.exitOverride(); // stop commander from process.exit on errors
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    registerLatencyCommand(program);
  });

  it("invokes IPC latency method with agent and since defaulting to 24h", async () => {
    await program.parseAsync(["node", "clawcode", "latency", "alpha"]);
    expect(mockedSendIpcRequest).toHaveBeenCalledWith(
      expect.any(String),
      "latency",
      expect.objectContaining({ agent: "alpha", all: false, since: "24h" }),
    );
  });

  it("passes --since 7d through to IPC", async () => {
    await program.parseAsync(["node", "clawcode", "latency", "alpha", "--since", "7d"]);
    expect(mockedSendIpcRequest).toHaveBeenCalledWith(
      expect.any(String),
      "latency",
      expect.objectContaining({ agent: "alpha", since: "7d" }),
    );
  });

  it("emits json output with --json flag", async () => {
    await program.parseAsync(["node", "clawcode", "latency", "alpha", "--json"]);
    const combined = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    const report = makeReport();
    expect(combined).toContain(JSON.stringify(report, null, 2));
  });

  it("aggregates across all agents with --all flag", async () => {
    await program.parseAsync(["node", "clawcode", "latency", "--all"]);
    expect(mockedSendIpcRequest).toHaveBeenCalledWith(
      expect.any(String),
      "latency",
      expect.objectContaining({ all: true, since: "24h" }),
    );
  });

  it("renders percentile table with four canonical segments", async () => {
    await program.parseAsync(["node", "clawcode", "latency", "alpha"]);
    const combined = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(combined).toContain("end_to_end");
    expect(combined).toContain("first_token");
    expect(combined).toContain("context_assemble");
    expect(combined).toContain("tool_call");
    expect(combined).toMatch(/p50/i);
    expect(combined).toMatch(/p95/i);
    expect(combined).toMatch(/p99/i);
    expect(combined.toLowerCase()).toContain("count");
  });

  it("renders ms unit suffix on numeric cells", async () => {
    await program.parseAsync(["node", "clawcode", "latency", "alpha"]);
    const combined = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(combined).toContain("ms");
  });
});
