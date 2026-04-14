import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import pino from "pino";
import { AgentMemoryManager } from "../session-memory.js";
import type { ResolvedAgentConfig } from "../../shared/types.js";

/**
 * Phase 56 Plan 01 — READ-ONLY SQLite warmup tests.
 *
 * Coverage:
 *   1. warmSqliteStores throws when agent is not registered.
 *   2. READ-ONLY invariant — grep the source file; zero INSERT/UPDATE/DELETE
 *      inside warmSqliteStores body.
 *   3. Completes under 200ms against in-memory fixture with empty tables.
 *   4. Propagates SQL errors with DB name context.
 */

const silentLog = pino({ level: "silent" });

function makeConfig(workspace: string, name: string): ResolvedAgentConfig {
  return {
    name,
    model: "sonnet",
    effort: "medium",
    workspace,
    systemPrompt: "",
    channels: [],
    memory: {
      compactionThreshold: 0.8,
    },
  } as unknown as ResolvedAgentConfig;
}

describe("AgentMemoryManager.warmSqliteStores", () => {
  let tmp: string;
  let mgr: AgentMemoryManager;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "warm-sqlite-"));
    mgr = new AgentMemoryManager(silentLog);
  });

  afterEach(async () => {
    // Clean up any stores to close file handles before removing the dir
    for (const name of Array.from(mgr.memoryStores.keys())) {
      mgr.cleanupMemory(name);
    }
    await rm(tmp, { recursive: true, force: true });
  });

  it("throws when agent has no MemoryStore registered", async () => {
    await expect(mgr.warmSqliteStores("ghost")).rejects.toThrow(
      /no MemoryStore for agent 'ghost'/,
    );
  });

  it("READ-ONLY invariant — the method body contains no INSERT/UPDATE/DELETE", async () => {
    // Meta-test: prove the source file is free of writes inside warmSqliteStores.
    const src = await readFile(
      new URL("../session-memory.ts", import.meta.url),
      "utf-8",
    );

    // Extract the method slice: from `async warmSqliteStores` to the next
    // closing line that is a method terminator (`^  }`).
    const startIdx = src.indexOf("async warmSqliteStores");
    expect(startIdx).toBeGreaterThan(-1);
    const rest = src.slice(startIdx);
    // Match up to the method's closing brace at 2-space indent depth.
    const endMatch = rest.match(/\n\s\s\}\n/);
    expect(endMatch).toBeTruthy();
    const body = rest.slice(0, endMatch!.index! + endMatch![0].length);

    // No INSERT/UPDATE/DELETE FROM token sequences should appear inside.
    expect(body).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(body).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
    expect(body).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it("completes under 200ms with empty tables", async () => {
    const name = "alice";
    const config = makeConfig(tmp, name);
    mgr.initMemory(name, config);

    const start = performance.now();
    const result = await mgr.warmSqliteStores(name);
    const elapsed = performance.now() - start;

    expect(result.memories_ms).toBeGreaterThanOrEqual(0);
    expect(result.usage_ms).toBeGreaterThanOrEqual(0);
    expect(result.traces_ms).toBeGreaterThanOrEqual(0);
    expect(elapsed).toBeLessThan(200);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("propagates SQL errors with a useful message", async () => {
    const name = "bob";
    const config = makeConfig(tmp, name);
    mgr.initMemory(name, config);

    // Sabotage the memories store by dropping a required table.
    const store = mgr.memoryStores.get(name)!;
    store.getDatabase().exec("DROP TABLE memories");

    await expect(mgr.warmSqliteStores(name)).rejects.toThrow(/memories/);
  });
});

describe("session-memory source read-only invariant (file-level grep)", () => {
  it("the warmSqliteStores method contains no write tokens", () => {
    // Alternative synchronous check usable in CI without test harness overhead.
    const src = readFileSync(
      new URL("../session-memory.ts", import.meta.url),
      "utf-8",
    );
    const methodStart = src.indexOf("async warmSqliteStores");
    expect(methodStart).toBeGreaterThan(-1);
    const slice = src.slice(methodStart, methodStart + 4000);
    const hitInsert = /\bINSERT\s+INTO\b/i.test(slice);
    const hitUpdate = /\bUPDATE\s+\w+\s+SET\b/i.test(slice);
    const hitDelete = /\bDELETE\s+FROM\b/i.test(slice);
    expect({ hitInsert, hitUpdate, hitDelete }).toEqual({
      hitInsert: false,
      hitUpdate: false,
      hitDelete: false,
    });
  });
});
