import { describe, it, expect } from "vitest";
import { formatStatusTable, formatUptime } from "../status.js";
import type { ZoneInfo } from "../status.js";
import type { RegistryEntry } from "../../../manager/types.js";

function createEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    name: "agent-a",
    status: "running",
    sessionId: "sess-1",
    startedAt: Date.now() - 60_000,
    restartCount: 0,
    consecutiveFailures: 0,
    lastError: null,
    lastStableAt: null,
    ...overrides,
  };
}

describe("formatStatusTable", () => {
  it("formats basic status table without zones", () => {
    const now = 1_700_000_000_000;
    const entries = [
      createEntry({ name: "bot-a", startedAt: now - 3_600_000 }),
      createEntry({ name: "bot-b", status: "stopped", startedAt: null }),
    ];

    const output = formatStatusTable(entries, now);
    expect(output).toContain("NAME");
    expect(output).toContain("STATUS");
    expect(output).toContain("UPTIME");
    expect(output).toContain("RESTARTS");
    expect(output).not.toContain("ZONE");
    expect(output).toContain("bot-a");
    expect(output).toContain("bot-b");
  });

  it("formats status table with ZONE column when zones provided", () => {
    const now = 1_700_000_000_000;
    const entries = [
      createEntry({ name: "bot-a", startedAt: now - 3_600_000 }),
    ];
    const zones: Record<string, ZoneInfo> = {
      "bot-a": { zone: "yellow", fillPercentage: 0.55 },
    };

    const output = formatStatusTable(entries, now, zones);
    expect(output).toContain("ZONE");
    expect(output).toContain("yellow");
    expect(output).toContain("55%");
  });

  it("shows dim dash for agents with no zone data", () => {
    const now = 1_700_000_000_000;
    const entries = [
      createEntry({ name: "bot-a", startedAt: now - 3_600_000 }),
      createEntry({ name: "bot-b", startedAt: now - 1_800_000 }),
    ];
    const zones: Record<string, ZoneInfo> = {
      "bot-a": { zone: "green", fillPercentage: 0.30 },
      // bot-b has no zone data
    };

    const output = formatStatusTable(entries, now, zones);
    expect(output).toContain("ZONE");
    // bot-b should have dim dash
    expect(output).toContain("\x1b[2m-\x1b[0m");
  });

  it("correctly color-codes each zone", () => {
    const now = 1_700_000_000_000;
    const entries = [
      createEntry({ name: "a", startedAt: now - 1000 }),
      createEntry({ name: "b", startedAt: now - 1000 }),
      createEntry({ name: "c", startedAt: now - 1000 }),
      createEntry({ name: "d", startedAt: now - 1000 }),
    ];
    const zones: Record<string, ZoneInfo> = {
      a: { zone: "green", fillPercentage: 0.30 },
      b: { zone: "yellow", fillPercentage: 0.55 },
      c: { zone: "orange", fillPercentage: 0.75 },
      d: { zone: "red", fillPercentage: 0.90 },
    };

    const output = formatStatusTable(entries, now, zones);

    // Check ANSI codes: green=\x1b[32m, yellow=\x1b[33m, orange=\x1b[38;5;208m, red=\x1b[31m
    expect(output).toContain("\x1b[32mgreen 30%\x1b[0m");
    expect(output).toContain("\x1b[33myellow 55%\x1b[0m");
    expect(output).toContain("\x1b[38;5;208morange 75%\x1b[0m");
    expect(output).toContain("\x1b[31mred 90%\x1b[0m");
  });

  it("works without zones parameter (backward compat)", () => {
    const now = 1_700_000_000_000;
    const entries = [
      createEntry({ name: "bot-a", startedAt: now - 3_600_000 }),
    ];

    const output = formatStatusTable(entries, now);
    expect(output).toContain("bot-a");
    expect(output).not.toContain("ZONE");
  });

  it("returns 'No agents configured' for empty entries", () => {
    expect(formatStatusTable([])).toBe("No agents configured");
  });
});

describe("formatUptime", () => {
  it("formats seconds", () => {
    expect(formatUptime(30_000)).toBe("30s");
  });

  it("formats minutes and seconds", () => {
    expect(formatUptime(90_000)).toBe("1m 30s");
  });

  it("formats hours and minutes", () => {
    expect(formatUptime(3_660_000)).toBe("1h 1m");
  });

  it("formats days and hours", () => {
    expect(formatUptime(90_000_000)).toBe("1d 1h");
  });
});
