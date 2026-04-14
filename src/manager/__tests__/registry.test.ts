import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  readRegistry,
  writeRegistry,
  updateEntry,
  createEntry,
  EMPTY_REGISTRY,
} from "../registry.js";
import type { Registry, RegistryEntry } from "../types.js";

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "registry-test-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("EMPTY_REGISTRY", () => {
  it("has empty entries and 0 updatedAt", () => {
    expect(EMPTY_REGISTRY.entries).toEqual([]);
    expect(EMPTY_REGISTRY.updatedAt).toBe(0);
  });
});

describe("createEntry", () => {
  it("creates an entry with default values", () => {
    const entry = createEntry("researcher");
    expect(entry.name).toBe("researcher");
    expect(entry.status).toBe("stopped");
    expect(entry.sessionId).toBeNull();
    expect(entry.startedAt).toBeNull();
    expect(entry.restartCount).toBe(0);
    expect(entry.consecutiveFailures).toBe(0);
    expect(entry.lastError).toBeNull();
    expect(entry.lastStableAt).toBeNull();
  });

  it("Phase 56 — defaults warm_path_ready=false and warm_path_readiness_ms=null", () => {
    const entry = createEntry("warm-defaults");
    expect(entry.warm_path_ready).toBe(false);
    expect(entry.warm_path_readiness_ms).toBeNull();
  });
});

describe("readRegistry", () => {
  it("returns EMPTY_REGISTRY when file does not exist", async () => {
    const path = join(testDir, "nonexistent.json");
    const registry = await readRegistry(path);
    expect(registry).toEqual(EMPTY_REGISTRY);
  });

  it("returns parsed Registry when file exists with valid JSON", async () => {
    const path = join(testDir, "registry.json");
    const data: Registry = {
      entries: [createEntry("agent-1")],
      updatedAt: 12345,
    };
    await writeRegistry(path, data);
    const registry = await readRegistry(path);
    expect(registry.entries).toHaveLength(1);
    expect(registry.entries[0].name).toBe("agent-1");
    expect(registry.updatedAt).toBe(12345);
  });

  it("throws ManagerError on corrupt JSON", async () => {
    const path = join(testDir, "registry.json");
    const { writeFile: wf } = await import("node:fs/promises");
    await wf(path, "not valid json{{{", "utf-8");
    await expect(readRegistry(path)).rejects.toThrow("Corrupt registry file");
  });
});

describe("writeRegistry", () => {
  it("writes valid JSON to the specified path", async () => {
    const path = join(testDir, "registry.json");
    const data: Registry = {
      entries: [createEntry("writer")],
      updatedAt: 99999,
    };
    await writeRegistry(path, data);
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.entries[0].name).toBe("writer");
  });

  it("uses atomic write (tmp file should not remain)", async () => {
    const path = join(testDir, "registry.json");
    await writeRegistry(path, EMPTY_REGISTRY);
    // tmp file should be renamed away
    const tmpPath = `${path}.tmp`;
    await expect(stat(tmpPath)).rejects.toThrow();
  });

  it("creates parent directories if they do not exist", async () => {
    const path = join(testDir, "nested", "deep", "registry.json");
    await writeRegistry(path, EMPTY_REGISTRY);
    const raw = await readFile(path, "utf-8");
    expect(JSON.parse(raw)).toEqual(EMPTY_REGISTRY);
  });

  it("roundtrips with readRegistry", async () => {
    const path = join(testDir, "registry.json");
    const entry = createEntry("roundtrip-agent");
    const original: Registry = { entries: [entry], updatedAt: 42 };
    await writeRegistry(path, original);
    const read = await readRegistry(path);
    expect(read).toEqual(original);
  });
});

describe("updateEntry", () => {
  it("returns a new Registry with the updated entry", () => {
    const entry = createEntry("agent-1");
    const registry: Registry = { entries: [entry], updatedAt: 100 };
    const updated = updateEntry(registry, "agent-1", { status: "running", sessionId: "sess-123" });
    expect(updated.entries[0].status).toBe("running");
    expect(updated.entries[0].sessionId).toBe("sess-123");
    expect(updated.entries[0].name).toBe("agent-1");
  });

  it("does not mutate the original registry", () => {
    const entry = createEntry("agent-1");
    const registry: Registry = { entries: [entry], updatedAt: 100 };
    const updated = updateEntry(registry, "agent-1", { status: "running" });
    // Original unchanged
    expect(registry.entries[0].status).toBe("stopped");
    // Updated is new object
    expect(updated).not.toBe(registry);
    expect(updated.entries).not.toBe(registry.entries);
    expect(updated.entries[0]).not.toBe(registry.entries[0]);
  });

  it("updates updatedAt timestamp", () => {
    const registry: Registry = { entries: [createEntry("a")], updatedAt: 100 };
    const updated = updateEntry(registry, "a", { status: "starting" });
    expect(updated.updatedAt).toBeGreaterThan(100);
  });

  it("throws for non-existing agent", () => {
    const registry: Registry = { entries: [createEntry("a")], updatedAt: 100 };
    expect(() => updateEntry(registry, "nonexistent", { status: "running" })).toThrow();
  });

  it("preserves other entries unchanged", () => {
    const registry: Registry = {
      entries: [createEntry("a"), createEntry("b")],
      updatedAt: 100,
    };
    const updated = updateEntry(registry, "a", { status: "running" });
    expect(updated.entries[1]).toEqual(createEntry("b"));
  });

  it("Phase 56 — accepts warm_path_ready + warm_path_readiness_ms updates", () => {
    const registry: Registry = {
      entries: [createEntry("warm-target")],
      updatedAt: 100,
    };
    const updated = updateEntry(registry, "warm-target", {
      warm_path_ready: true,
      warm_path_readiness_ms: 127,
    });
    expect(updated.entries[0].warm_path_ready).toBe(true);
    expect(updated.entries[0].warm_path_readiness_ms).toBe(127);
  });
});

describe("Phase 56 — backward compatibility for pre-warm-path registries", () => {
  it("readRegistry parses an entry missing warm_path_* fields (undefined === not-ready)", async () => {
    const path = join(testDir, "legacy.json");
    // Simulate a pre-Phase-56 registry: no warm_path_ready / warm_path_readiness_ms keys.
    const legacyJson = JSON.stringify({
      entries: [
        {
          name: "legacy-agent",
          status: "running",
          sessionId: "sess-legacy",
          startedAt: 1_700_000_000_000,
          restartCount: 0,
          consecutiveFailures: 0,
          lastError: null,
          lastStableAt: 1_700_000_000_000,
        },
      ],
      updatedAt: 1_700_000_000_000,
    });
    const { writeFile: wf } = await import("node:fs/promises");
    await wf(path, legacyJson, "utf-8");

    const registry = await readRegistry(path);
    expect(registry.entries).toHaveLength(1);
    const entry = registry.entries[0];
    expect(entry.name).toBe("legacy-agent");
    // Optional fields absent → undefined, which consumers treat as not-ready.
    expect(entry.warm_path_ready).toBeUndefined();
    expect(entry.warm_path_readiness_ms).toBeUndefined();
    // The Partial<RegistryEntry> contract: the type must permit absence.
    const treatedAsReady = entry.warm_path_ready ?? false;
    expect(treatedAsReady).toBe(false);
  });
});
