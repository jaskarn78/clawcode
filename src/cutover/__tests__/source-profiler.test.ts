/**
 * Phase 92 Plan 01 Task 1 (RED) — source-profiler tests.
 *
 * Pins the contract for `profileAgentFromDiscordHistory(deps)` defined in
 * the plan's <interfaces> block. All 6 tests fail at this stage because
 * src/cutover/source-profiler.ts does not yet exist (RED gate).
 *
 * Behavioral pins:
 *   P1: empty staging JSONL → {kind:'no-history'}, zero dispatcher calls
 *   P2: 100 msgs (under chunk threshold) → ONE dispatch call → 7-key output
 *   P3: 50001 msgs → CHUNKED into ≥2 dispatcher calls; merged output
 *   P4: output has SORTED keys + SORTED arrays (canonical order)
 *   P5: deterministic — two runs over identical JSONL produce byte-identical files
 *   P6: dispatcher returning bad shape → {kind:'schema-validation-failed'} + no file written
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  profileAgentFromDiscordHistory,
  type ProfileDeps,
} from "../source-profiler.js";
import {
  PROFILER_CHUNK_THRESHOLD_MSGS,
  type DiscordHistoryEntry,
} from "../types.js";

function makeLog() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(),
  } as unknown as import("pino").Logger;
}

function makeMessages(n: number): DiscordHistoryEntry[] {
  // Spread timestamps over ~120 days so chunkBy30DayWindows can split them.
  const out: DiscordHistoryEntry[] = [];
  for (let i = 0; i < n; i++) {
    const ts = new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + i * 1000).toISOString();
    out.push({
      message_id: `m-${i}`,
      channel_id: "c1",
      author_id: "u-1",
      author_name: "alice",
      ts,
      content: `msg ${i}`,
      attachments: [],
      is_bot: false,
    });
  }
  return out;
}

async function seedJsonl(stagingDir: string, msgs: readonly DiscordHistoryEntry[]): Promise<string> {
  await mkdir(stagingDir, { recursive: true });
  const path = join(stagingDir, "discord-history.jsonl");
  const lines = msgs.map((m) => JSON.stringify(m)).join("\n") + (msgs.length > 0 ? "\n" : "");
  await writeFile(path, lines, "utf8");
  return path;
}

const CANONICAL_PROFILE_TEXT = JSON.stringify({
  tools: ["Bash", "Read"],
  skills: ["content-engine"],
  mcpServers: ["browser"],
  memoryRefs: [],
  models: ["anthropic-api/claude-sonnet-4-6"],
  uploads: [],
  topIntents: [{ intent: "portfolio-analysis", count: 47 }],
});

let stagingDir: string;
let outputDir: string;

beforeEach(async () => {
  stagingDir = await mkdtemp(join(tmpdir(), "cutover-profile-stg-"));
  outputDir = await mkdtemp(join(tmpdir(), "cutover-profile-out-"));
});

afterEach(async () => {
  await rm(stagingDir, { recursive: true, force: true });
  await rm(outputDir, { recursive: true, force: true });
});

function baseDeps(overrides: Partial<ProfileDeps> = {}): ProfileDeps {
  const dispatch = vi.fn(async () => CANONICAL_PROFILE_TEXT);
  return {
    agent: "fin-acquisition",
    stagingDir,
    outputDir,
    dispatcher: { dispatch: dispatch as unknown as ProfileDeps["dispatcher"]["dispatch"] },
    log: makeLog(),
    ...overrides,
  };
}

describe("profileAgentFromDiscordHistory — P1 no history", () => {
  it("returns {kind:'no-history'} when JSONL absent and never calls dispatcher", async () => {
    const dispatch = vi.fn();
    const outcome = await profileAgentFromDiscordHistory(
      baseDeps({
        dispatcher: { dispatch: dispatch as unknown as ProfileDeps["dispatcher"]["dispatch"] },
      }),
    );
    expect(outcome.kind).toBe("no-history");
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe("profileAgentFromDiscordHistory — P2 single chunk", () => {
  it("100 msgs runs ONE dispatch call and writes valid 7-key AGENT-PROFILE.json", async () => {
    await seedJsonl(stagingDir, makeMessages(100));
    const dispatch = vi.fn(async () => CANONICAL_PROFILE_TEXT);
    const outcome = await profileAgentFromDiscordHistory(
      baseDeps({
        dispatcher: { dispatch: dispatch as unknown as ProfileDeps["dispatcher"]["dispatch"] },
      }),
    );

    expect(outcome.kind).toBe("profiled");
    expect(dispatch).toHaveBeenCalledTimes(1);
    if (outcome.kind === "profiled") {
      expect(outcome.chunksProcessed).toBe(1);
      expect(outcome.messagesProcessed).toBe(100);
      const raw = await readFile(outcome.profilePath, "utf8");
      const parsed = JSON.parse(raw);
      const keys = Object.keys(parsed).sort();
      expect(keys).toEqual([
        "memoryRefs",
        "mcpServers",
        "models",
        "skills",
        "tools",
        "topIntents",
        "uploads",
      ].sort());
    }
  });
});

describe("profileAgentFromDiscordHistory — P3 chunked at 50001 msgs", () => {
  it("splits into ≥2 chunks and merges outputs (union+dedup)", async () => {
    // Manually configure a small threshold to exercise chunking without
    // creating 50K real messages — the SOURCE invariant is the threshold
    // CONSTANT (PROFILER_CHUNK_THRESHOLD_MSGS=50000); the chunkThresholdMsgs
    // override is the DI'd test hook from <interfaces>.
    const total = 8;
    const msgs = makeMessages(total);
    // Spread across 60 days so the 30-day-window split actually triggers.
    const span = 60 * 86400 * 1000;
    msgs.forEach((m, i) => {
      m.ts = new Date(Date.UTC(2026, 0, 1) + Math.floor((i * span) / total)).toISOString();
    });
    await seedJsonl(stagingDir, msgs);

    let callIdx = 0;
    const dispatch = vi.fn(async () => {
      // Different output per chunk to verify merge: chunk 0 → tools=[Bash];
      // chunk 1 → tools=[Read]; merged should yield [Bash, Read].
      const tools = callIdx === 0 ? ["Bash"] : ["Read"];
      const intents = callIdx === 0
        ? [{ intent: "portfolio-analysis", count: 30 }]
        : [{ intent: "portfolio-analysis", count: 17 }, { intent: "writing", count: 5 }];
      callIdx += 1;
      return JSON.stringify({
        tools,
        skills: [],
        mcpServers: [],
        memoryRefs: [],
        models: [],
        uploads: [],
        topIntents: intents,
      });
    });

    const outcome = await profileAgentFromDiscordHistory(
      baseDeps({
        chunkThresholdMsgs: 4, // force chunking for 8 msgs
        dispatcher: { dispatch: dispatch as unknown as ProfileDeps["dispatcher"]["dispatch"] },
      }),
    );

    expect(outcome.kind).toBe("profiled");
    expect(dispatch).toHaveBeenCalledTimes(2);
    if (outcome.kind === "profiled") {
      expect(outcome.chunksProcessed).toBeGreaterThanOrEqual(2);
      const merged = JSON.parse(await readFile(outcome.profilePath, "utf8")) as {
        tools: string[];
        topIntents: Array<{ intent: string; count: number }>;
      };
      expect(merged.tools).toEqual(["Bash", "Read"]); // sorted union
      // count-summed merge: portfolio-analysis 30+17=47 sorted DESC by count
      expect(merged.topIntents[0]).toEqual({ intent: "portfolio-analysis", count: 47 });
    }
  });

  it("PROFILER_CHUNK_THRESHOLD_MSGS constant equals 50000", () => {
    expect(PROFILER_CHUNK_THRESHOLD_MSGS).toBe(50000);
  });
});

describe("profileAgentFromDiscordHistory — P4 sorted keys + sorted arrays", () => {
  it("output has lexicographic key order and alphabetically sorted arrays", async () => {
    await seedJsonl(stagingDir, makeMessages(10));
    const dispatch = vi.fn(async () =>
      JSON.stringify({
        tools: ["Read", "Bash"], // intentionally unsorted on input
        skills: ["market-research", "content-engine"],
        mcpServers: ["search", "browser"],
        memoryRefs: [],
        models: ["m2", "m1"],
        uploads: [],
        topIntents: [
          { intent: "writing", count: 5 },
          { intent: "portfolio-analysis", count: 47 },
          { intent: "research", count: 47 },
        ],
      }),
    );
    const outcome = await profileAgentFromDiscordHistory(
      baseDeps({
        dispatcher: { dispatch: dispatch as unknown as ProfileDeps["dispatcher"]["dispatch"] },
      }),
    );
    expect(outcome.kind).toBe("profiled");
    if (outcome.kind === "profiled") {
      const raw = await readFile(outcome.profilePath, "utf8");
      const parsed = JSON.parse(raw) as {
        tools: string[];
        skills: string[];
        mcpServers: string[];
        models: string[];
        topIntents: Array<{ intent: string; count: number }>;
      };
      // Canonical lexicographic key order
      expect(Object.keys(parsed)).toEqual(
        ["memoryRefs", "mcpServers", "models", "skills", "tools", "topIntents", "uploads"].sort(),
      );
      expect(parsed.tools).toEqual(["Bash", "Read"]);
      expect(parsed.skills).toEqual(["content-engine", "market-research"]);
      expect(parsed.mcpServers).toEqual(["browser", "search"]);
      expect(parsed.models).toEqual(["m1", "m2"]);
      // topIntents sorted by count DESC, ties broken by intent alphabetical
      expect(parsed.topIntents).toEqual([
        { intent: "portfolio-analysis", count: 47 },
        { intent: "research", count: 47 },
        { intent: "writing", count: 5 },
      ]);
    }
  });
});

describe("profileAgentFromDiscordHistory — P5 byte-identical determinism", () => {
  it("two runs over identical JSONL produce byte-identical AGENT-PROFILE.json", async () => {
    await seedJsonl(stagingDir, makeMessages(50));
    const dispatch1 = vi.fn(async () => CANONICAL_PROFILE_TEXT);
    const out1Dir = await mkdtemp(join(tmpdir(), "cutover-det-1-"));
    const out2Dir = await mkdtemp(join(tmpdir(), "cutover-det-2-"));
    try {
      const o1 = await profileAgentFromDiscordHistory(
        baseDeps({
          outputDir: out1Dir,
          dispatcher: { dispatch: dispatch1 as unknown as ProfileDeps["dispatcher"]["dispatch"] },
        }),
      );
      const dispatch2 = vi.fn(async () => CANONICAL_PROFILE_TEXT);
      const o2 = await profileAgentFromDiscordHistory(
        baseDeps({
          outputDir: out2Dir,
          dispatcher: { dispatch: dispatch2 as unknown as ProfileDeps["dispatcher"]["dispatch"] },
        }),
      );
      expect(o1.kind).toBe("profiled");
      expect(o2.kind).toBe("profiled");
      if (o1.kind === "profiled" && o2.kind === "profiled") {
        const outputBytes1 = await readFile(o1.profilePath);
        const outputBytes2 = await readFile(o2.profilePath);
        expect(outputBytes1).toEqual(outputBytes2);
      }
    } finally {
      await rm(out1Dir, { recursive: true, force: true });
      await rm(out2Dir, { recursive: true, force: true });
    }
  });
});

describe("profileAgentFromDiscordHistory — P6 schema validation failure", () => {
  it("dispatcher returning malformed JSON surfaces schema-validation-failed and writes no file", async () => {
    await seedJsonl(stagingDir, makeMessages(10));
    const dispatch = vi.fn(async () => JSON.stringify({ NOT_VALID: [] }));
    const outcome = await profileAgentFromDiscordHistory(
      baseDeps({
        dispatcher: { dispatch: dispatch as unknown as ProfileDeps["dispatcher"]["dispatch"] },
      }),
    );
    expect(outcome.kind).toBe("schema-validation-failed");
    if (outcome.kind === "schema-validation-failed") {
      expect(outcome.error.length).toBeGreaterThan(0);
      expect(outcome.rawResponse.length).toBeGreaterThan(0);
    }
    // No AGENT-PROFILE.json written
    let exists = true;
    try {
      await access(join(outputDir, "AGENT-PROFILE.json"));
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });
});
