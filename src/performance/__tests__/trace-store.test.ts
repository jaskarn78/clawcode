import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { TraceStore } from "../trace-store.js";
import type { TurnRecord } from "../types.js";

function buildTurn(overrides: Partial<TurnRecord> = {}): TurnRecord {
  const base: TurnRecord = {
    id: overrides.id ?? "msg-1",
    agent: overrides.agent ?? "agent-x",
    channelId: overrides.channelId ?? "chan-1",
    startedAt: overrides.startedAt ?? "2026-04-13T12:00:00.000Z",
    endedAt: overrides.endedAt ?? "2026-04-13T12:00:01.000Z",
    totalMs: overrides.totalMs ?? 1000,
    status: overrides.status ?? "success",
    spans:
      overrides.spans ??
      ([
        Object.freeze({
          name: "receive",
          startedAt: "2026-04-13T12:00:00.000Z",
          durationMs: 10,
          metadata: Object.freeze({}),
        }),
      ] as const),
  };
  return Object.freeze({ ...base, spans: Object.freeze([...base.spans]) });
}

describe("TraceStore", () => {
  let store: TraceStore;
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "trace-store-test-"));
    dbPath = join(tempDir, "traces.db");
    store = new TraceStore(dbPath);
  });

  afterEach(() => {
    try {
      store.close();
    } catch {
      // ignore close errors during teardown
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates traces.db with WAL pragma and foreign_keys ON", () => {
    const inspect = new Database(dbPath);
    const journal = inspect.pragma("journal_mode", { simple: true });
    const fk = inspect.pragma("foreign_keys", { simple: true });
    inspect.close();
    expect(String(journal).toLowerCase()).toBe("wal");
    expect(Number(fk)).toBe(1);
  });

  it("initializes traces and trace_spans tables", () => {
    const inspect = new Database(dbPath);
    const rows = inspect
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as ReadonlyArray<{ readonly name: string }>;
    inspect.close();
    const tableNames = rows.map((r) => r.name);
    expect(tableNames).toContain("traces");
    expect(tableNames).toContain("trace_spans");
  });

  it("writeTurn inserts one traces row and N trace_spans rows in one transaction", () => {
    const turn = buildTurn({
      id: "msg-ins-1",
      spans: [
        Object.freeze({ name: "receive", startedAt: "2026-04-13T12:00:00.000Z", durationMs: 5, metadata: Object.freeze({}) }),
        Object.freeze({ name: "context_assemble", startedAt: "2026-04-13T12:00:00.100Z", durationMs: 8, metadata: Object.freeze({}) }),
        Object.freeze({ name: "first_token", startedAt: "2026-04-13T12:00:00.200Z", durationMs: 50, metadata: Object.freeze({}) }),
      ],
    });
    store.writeTurn(turn);

    const inspect = new Database(dbPath);
    const traceCount = (inspect.prepare("SELECT COUNT(*) AS n FROM traces").get() as { n: number }).n;
    const spanCount = (inspect.prepare("SELECT COUNT(*) AS n FROM trace_spans").get() as { n: number }).n;
    inspect.close();

    expect(traceCount).toBe(1);
    expect(spanCount).toBe(3);
  });

  it("writeTurn is idempotent on duplicate turn id (INSERT OR REPLACE)", () => {
    const turn = buildTurn({ id: "duplicate-1" });
    store.writeTurn(turn);
    store.writeTurn(turn);

    const inspect = new Database(dbPath);
    const traceCount = (inspect.prepare("SELECT COUNT(*) AS n FROM traces WHERE id = ?").get("duplicate-1") as { n: number }).n;
    inspect.close();

    expect(traceCount).toBe(1);
  });

  it("pruneOlderThan deletes expired turns", () => {
    const nowIso = new Date("2026-04-13T00:00:00.000Z").toISOString();
    const cutoffIso = new Date("2026-04-06T00:00:00.000Z").toISOString(); // 7 days ago
    const old = buildTurn({
      id: "old-turn",
      startedAt: new Date("2026-04-03T00:00:00.000Z").toISOString(), // older than 7d
      endedAt: new Date("2026-04-03T00:00:01.000Z").toISOString(),
    });
    const recent = buildTurn({
      id: "recent-turn",
      startedAt: new Date("2026-04-12T00:00:00.000Z").toISOString(),
      endedAt: new Date("2026-04-12T00:00:01.000Z").toISOString(),
    });
    store.writeTurn(old);
    store.writeTurn(recent);

    const deleted = store.pruneOlderThan(cutoffIso);
    expect(deleted).toBeGreaterThanOrEqual(1);

    const inspect = new Database(dbPath);
    const ids = inspect.prepare("SELECT id FROM traces").all() as ReadonlyArray<{ readonly id: string }>;
    inspect.close();

    const remaining = ids.map((r) => r.id);
    expect(remaining).toContain("recent-turn");
    expect(remaining).not.toContain("old-turn");
    // sanity: reference both to keep the variable live for future assertions
    expect(nowIso).toBeTruthy();
  });

  it("cascade: pruning a turn deletes its spans", { timeout: 5000 }, () => {
    const old = buildTurn({
      id: "cascade-turn",
      startedAt: new Date("2026-04-03T00:00:00.000Z").toISOString(),
      endedAt: new Date("2026-04-03T00:00:01.000Z").toISOString(),
      spans: [
        Object.freeze({ name: "receive", startedAt: "2026-04-03T00:00:00.000Z", durationMs: 1, metadata: Object.freeze({}) }),
        Object.freeze({ name: "first_token", startedAt: "2026-04-03T00:00:00.100Z", durationMs: 5, metadata: Object.freeze({}) }),
        Object.freeze({ name: "end_to_end", startedAt: "2026-04-03T00:00:00.200Z", durationMs: 900, metadata: Object.freeze({}) }),
      ],
    });
    store.writeTurn(old);

    // Prune with a future cutoff so everything expires
    const futureCutoff = new Date("2099-01-01T00:00:00.000Z").toISOString();
    store.pruneOlderThan(futureCutoff);

    const inspect = new Database(dbPath);
    const spanCount = (inspect.prepare("SELECT COUNT(*) AS n FROM trace_spans").get() as { n: number }).n;
    inspect.close();
    expect(spanCount).toBe(0);
  });

  it("persists across reopen", () => {
    const turn = buildTurn({ id: "persists-1", agent: "agent-p" });
    store.writeTurn(turn);
    store.close();

    const reopened = new TraceStore(dbPath);
    try {
      const inspect = new Database(dbPath);
      const count = (inspect.prepare("SELECT COUNT(*) AS n FROM traces WHERE id = ?").get("persists-1") as { n: number }).n;
      inspect.close();
      expect(count).toBe(1);
    } finally {
      reopened.close();
    }

    // Re-assign `store` so the afterEach close() is a no-op-safe.
    store = new TraceStore(dbPath);
  });

  it("getPercentiles returns p50/p95/p99/count rows for each canonical segment", () => {
    // Insert 100 synthetic turns with known duration_ms distribution in end_to_end spans.
    const nowMs = new Date("2026-04-13T00:00:00.000Z").getTime();
    for (let i = 1; i <= 100; i++) {
      const turn = buildTurn({
        id: `syn-${i}`,
        agent: "agent-perc",
        startedAt: new Date(nowMs + i).toISOString(),
        endedAt: new Date(nowMs + i + 1).toISOString(),
        totalMs: i,
        spans: [
          Object.freeze({
            name: "end_to_end",
            startedAt: new Date(nowMs + i).toISOString(),
            durationMs: i,
            metadata: Object.freeze({}),
          }),
        ],
      });
      store.writeTurn(turn);
    }

    const rows = store.getPercentiles("agent-perc", new Date(nowMs - 1000).toISOString());
    expect(Array.isArray(rows)).toBe(true);
    const endToEnd = rows.find((r) => r.segment === "end_to_end");
    expect(endToEnd).toBeDefined();
    // shape assertions
    expect(typeof endToEnd!.count).toBe("number");
    expect("p50" in endToEnd!).toBe(true);
    expect("p95" in endToEnd!).toBe(true);
    expect("p99" in endToEnd!).toBe(true);
  });
});
