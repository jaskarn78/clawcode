import { describe, it, expect, vi, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  openclawSourceAgentSchema,
  readOpenclawInventory,
  isFinmentumFamily,
  FINMENTUM_FAMILY_IDS,
  removeBindingsForAgent,
} from "../openclaw-config-reader.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE = join(__dirname, "fixtures", "openclaw.sample.json");

describe("openclawSourceAgentSchema", () => {
  it("parses every one of the 15 real agent entries in the committed fixture", async () => {
    const { readFile } = await import("node:fs/promises");
    const raw = JSON.parse(await readFile(FIXTURE, "utf8")) as {
      agents: { list: unknown[] };
    };
    for (const agent of raw.agents.list) {
      const result = openclawSourceAgentSchema.safeParse(agent);
      if (!result.success) {
        // Surface full issue list so a fixture/schema drift is debuggable in one shot.
        throw new Error(
          `Schema rejected agent: ${JSON.stringify(agent, null, 2)}\n${JSON.stringify(
            result.error.issues,
            null,
            2,
          )}`,
        );
      }
      expect(result.success).toBe(true);
    }
    expect(raw.agents.list).toHaveLength(15);
  });

  it("rejects an agent entry missing required id with a path pointing at id", () => {
    const bad = {
      name: "no id",
      workspace: "/tmp/x",
      agentDir: "/tmp/x/agent",
      model: { primary: "sonnet" },
      identity: {},
    };
    const result = openclawSourceAgentSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const hasIdIssue = result.error.issues.some(
        (i) => i.path.join(".") === "id",
      );
      expect(hasIdIssue).toBe(true);
    }
  });
});

describe("readOpenclawInventory", () => {
  it("returns exactly 15 agents sorted alphabetically by id and 7 bindings", async () => {
    const inv = await readOpenclawInventory(FIXTURE);
    expect(inv.agents).toHaveLength(15);
    expect(inv.bindings).toHaveLength(7);

    const ids = inv.agents.map((a) => a.id);
    const sorted = [...ids].sort((a, b) => a.localeCompare(b));
    expect(ids).toEqual(sorted);
    // sanity: ensure we still have the expected agents after sorting
    expect(ids).toContain("general");
    expect(ids).toContain("fin-acquisition");
    expect(ids).toContain("card-generator");
  });

  it("joins bindings to agents: research has its discord channel, general has none", async () => {
    const inv = await readOpenclawInventory(FIXTURE);
    const byId = new Map(inv.agents.map((a) => [a.id, a]));

    const general = byId.get("general");
    expect(general).toBeDefined();
    expect(general?.discordChannelId).toBeUndefined();

    const research = byId.get("research");
    expect(research).toBeDefined();
    expect(research?.discordChannelId).toBe("1480605887247814656");

    // Also spot-check a finmentum-bound agent
    const finAcq = byId.get("fin-acquisition");
    expect(finAcq?.discordChannelId).toBe("1481670479017414767");
  });

  it("throws an error whose message contains both 'openclaw.json' and the bad path on ENOENT", async () => {
    const badPath = "/nonexistent/path/to/openclaw.json";
    let caught: Error | undefined;
    try {
      await readOpenclawInventory(badPath);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught?.message).toContain("openclaw.json");
    expect(caught?.message).toContain(badPath);
  });

  it("marks isFinmentumFamily=true for all 5 family ids and false for others", async () => {
    const inv = await readOpenclawInventory(FIXTURE);
    const byId = new Map(inv.agents.map((a) => [a.id, a]));
    for (const famId of FINMENTUM_FAMILY_IDS) {
      const entry = byId.get(famId);
      expect(entry, `expected fixture to contain ${famId}`).toBeDefined();
      expect(entry?.isFinmentumFamily).toBe(true);
    }
    for (const outsideId of ["general", "work", "card-planner"]) {
      const entry = byId.get(outsideId);
      expect(entry?.isFinmentumFamily).toBe(false);
    }
  });
});

describe("isFinmentumFamily", () => {
  it("returns true for each of the 5 hardcoded finmentum ids", () => {
    const famIds = [
      "fin-acquisition",
      "fin-research",
      "fin-playground",
      "fin-tax",
      "finmentum-content-creator",
    ];
    for (const id of famIds) {
      expect(isFinmentumFamily(id)).toBe(true);
    }
    expect(FINMENTUM_FAMILY_IDS).toHaveLength(5);
  });

  it("returns false for non-family ids", () => {
    for (const id of ["general", "work", "card-planner", "card-generator", ""]) {
      expect(isFinmentumFamily(id)).toBe(false);
    }
  });
});

describe("removeBindingsForAgent (Phase 82)", () => {
  /**
   * Fixture shape: includes bindings for target agent + 2 other agents, plus
   * non-bindings top-level sections that MUST survive byte-for-byte (env,
   * channels.discord.token, auth).
   */
  function makeFixtureJson(): object {
    return {
      meta: { lastTouchedVersion: "2026.4.15", lastTouchedAt: "2026-04-19T16:06:03.379Z" },
      env: { SOMETHING: "abc", OTHER: "xyz" },
      auth: { kind: "bearer", tokenRef: "op://vault/token" },
      channels: {
        discord: {
          token: "op://Personal/discord-bot/token",
          intents: ["MESSAGE_CONTENT", "GUILDS"],
        },
      },
      agents: {
        list: [
          {
            id: "alpha",
            name: "Alpha",
            workspace: "/home/u/.openclaw/workspace-alpha",
            agentDir: "/home/u/.openclaw/agents/alpha/agent",
            model: { primary: "anthropic-api/claude-sonnet-4-6", fallbacks: [] },
            identity: {},
          },
          {
            id: "beta",
            name: "Beta",
            workspace: "/home/u/.openclaw/workspace-beta",
            agentDir: "/home/u/.openclaw/agents/beta/agent",
            model: { primary: "anthropic-api/claude-sonnet-4-6", fallbacks: [] },
            identity: {},
          },
        ],
      },
      bindings: [
        {
          agentId: "alpha",
          match: { channel: "discord", peer: { kind: "channel", id: "1111" } },
        },
        {
          agentId: "beta",
          match: { channel: "discord", peer: { kind: "channel", id: "2222" } },
        },
        {
          agentId: "alpha",
          match: { channel: "discord", peer: { kind: "channel", id: "3333" } },
        },
      ],
    };
  }

  async function setupFixture(
    agentToRemove: string,
    customJson?: object,
  ): Promise<{ dir: string; path: string; beforeBytes: Buffer }> {
    const dir = await mkdtemp(join(tmpdir(), "cc-remove-bindings-"));
    const path = join(dir, "openclaw.json");
    const body = JSON.stringify(customJson ?? makeFixtureJson(), null, 2) + "\n";
    await writeFile(path, body, "utf8");
    const beforeBytes = await readFile(path);
    // silence TS unused-var on agentToRemove (returned for caller's use)
    void agentToRemove;
    return { dir, path, beforeBytes };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("removes every binding whose agentId matches the target (2 alpha → 0 alpha)", async () => {
    const { path } = await setupFixture("alpha");
    const result = await removeBindingsForAgent(path, "alpha");
    expect(result.removed).toBe(2);
    const reparsed = JSON.parse(await readFile(path, "utf8")) as {
      bindings: Array<{ agentId: string }>;
    };
    expect(reparsed.bindings).toHaveLength(1);
    expect(reparsed.bindings[0]!.agentId).toBe("beta");
  });

  it("preserves every non-bindings top-level field byte-for-byte (deep-equal)", async () => {
    const { path } = await setupFixture("alpha");
    const before = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    await removeBindingsForAgent(path, "alpha");
    const after = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;

    // Every non-bindings key must be identical
    for (const key of Object.keys(before)) {
      if (key === "bindings") continue;
      expect(after[key]).toEqual(before[key]);
    }
    // bindings[] has one surviving entry (beta)
    expect((after.bindings as unknown[]).length).toBe(1);
  });

  it("preserves non-matching bindings in source order", async () => {
    const custom = {
      bindings: [
        { agentId: "x", match: { channel: "d", peer: { kind: "channel", id: "100" } } },
        { agentId: "alpha", match: { channel: "d", peer: { kind: "channel", id: "200" } } },
        { agentId: "y", match: { channel: "d", peer: { kind: "channel", id: "300" } } },
        { agentId: "z", match: { channel: "d", peer: { kind: "channel", id: "400" } } },
      ],
    };
    const { path } = await setupFixture("alpha", custom);
    await removeBindingsForAgent(path, "alpha");
    const after = JSON.parse(await readFile(path, "utf8")) as {
      bindings: Array<{ agentId: string; match: { peer: { id: string } } }>;
    };
    expect(after.bindings.map((b) => b.agentId)).toEqual(["x", "y", "z"]);
    expect(after.bindings.map((b) => b.match.peer.id)).toEqual(["100", "300", "400"]);
  });

  it("removed=0 when agent has no bindings → zero writes occur (idempotent no-op)", async () => {
    const { path, beforeBytes } = await setupFixture("ghost-agent");
    const result = await removeBindingsForAgent(path, "ghost-agent");
    expect(result.removed).toBe(0);
    expect(result.beforeSha256).toBe(result.afterSha256);
    // Bytes unchanged
    const afterBytes = await readFile(path);
    expect(afterBytes.equals(beforeBytes)).toBe(true);
  });

  it("beforeSha256 != afterSha256 when removed > 0", async () => {
    const { path } = await setupFixture("alpha");
    const result = await removeBindingsForAgent(path, "alpha");
    expect(result.removed).toBe(2);
    expect(result.beforeSha256).not.toBe(result.afterSha256);
    // Hashes are hex strings
    expect(result.beforeSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.afterSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("beforeSha256 hashes file BYTES (not parsed object)", async () => {
    const { path } = await setupFixture("alpha");
    const originalBytes = await readFile(path);
    const expected = createHash("sha256").update(originalBytes).digest("hex");
    const result = await removeBindingsForAgent(path, "alpha");
    expect(result.beforeSha256).toBe(expected);
  });

  it("serializes with 2-space indent + trailing newline (operator convention)", async () => {
    const { path } = await setupFixture("alpha");
    await removeBindingsForAgent(path, "alpha");
    const text = await readFile(path, "utf8");
    // Trailing newline preserved
    expect(text.endsWith("\n")).toBe(true);
    // 2-space indent: second line of the top-level object starts with 2 spaces
    const lines = text.split("\n");
    // First line is "{"
    expect(lines[0]).toBe("{");
    // Next non-closing line should start with exactly 2 spaces
    const secondLine = lines[1] ?? "";
    expect(secondLine.startsWith("  ")).toBe(true);
    expect(secondLine.startsWith("   ")).toBe(false); // not 3
  });

  it("throws a clear error when openclaw.json is missing 'bindings' field", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-remove-bindings-err-"));
    const path = join(dir, "openclaw.json");
    await writeFile(path, JSON.stringify({ agents: { list: [] } }, null, 2) + "\n", "utf8");
    let caught: Error | undefined;
    try {
      await removeBindingsForAgent(path, "alpha");
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toMatch(/openclaw\.json/i);
    expect(caught!.message).toMatch(/bindings/i);
  });

  it("throws when openclaw.json root is not an object", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-remove-bindings-root-"));
    const path = join(dir, "openclaw.json");
    await writeFile(path, JSON.stringify([1, 2, 3]), "utf8");
    await expect(removeBindingsForAgent(path, "alpha")).rejects.toThrow(
      /openclaw\.json/i,
    );
  });
});
