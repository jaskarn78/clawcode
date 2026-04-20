import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  openclawSourceAgentSchema,
  readOpenclawInventory,
  isFinmentumFamily,
  FINMENTUM_FAMILY_IDS,
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
