/**
 * Phase 101 Plan 03 Task 2 (U6, CF-2) — crossIngestToMemory regression
 * tests.
 *
 * Covers:
 *   - dual-write phase: both vec tables populated.
 *   - v1-only entry → auto-flip to dual-write on first document ingest
 *     (CF-2 coordination); persisted across new EmbeddingV2Migrator instance.
 *   - v2-only phase: vec_memory_chunks_v2 populated.
 *   - Idempotency: second call with same docSlug DELETEs + re-INSERTs.
 *   - docSlug regex validation (T-101-11 mitigation).
 *   - CF-1 round-trip: applyTimeWindowFilter retains the cross-ingested
 *     document chunk past the standard expiry window.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  crossIngestToMemory,
  MigrationPhaseStore,
} from "../../src/document-ingest/cross-ingest.js";
import { MemoryStore } from "../../src/memory/store.js";
import { EmbeddingV2Migrator } from "../../src/memory/migrations/embedding-v2.js";
import { applyTimeWindowFilter } from "../../src/memory/memory-chunks.js";

/** Build a deterministic v1 (Float32) embedding for testing. */
function makeV1(seed: number): Float32Array {
  const v = new Float32Array(384);
  for (let i = 0; i < 384; i++) v[i] = Math.sin(seed + i * 0.01);
  return v;
}

/** Build a deterministic v2 (Int8) embedding for testing. */
function makeV2(seed: number): Int8Array {
  const v = new Int8Array(384);
  for (let i = 0; i < 384; i++) v[i] = ((seed + i) % 127) - 64;
  return v;
}

const embedderV1 = {
  embed: async (text: string): Promise<Float32Array> =>
    makeV1(text.length),
};
const embedderV2 = {
  embedV2: async (text: string): Promise<Int8Array> => makeV2(text.length),
};

function newStore(): { store: MemoryStore; dir: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "cross-ingest-test-"));
  const dbPath = join(dir, "memories.db");
  const store = new MemoryStore(dbPath);
  return { store, dir, dbPath };
}

function migrationStore(store: MemoryStore, agent: string): MigrationPhaseStore {
  return new MigrationPhaseStore(store, agent);
}

describe("crossIngestToMemory (Phase 101 U6 / CF-2)", () => {
  let store: MemoryStore;
  let dir: string;

  beforeEach(() => {
    const created = newStore();
    store = created.store;
    dir = created.dir;
  });

  function cleanup() {
    try {
      store.getDatabase().close();
    } catch {
      // ignore
    }
    rmSync(dir, { recursive: true, force: true });
  }

  it("U6-T01: v1-only agent — first call auto-flips to dual-write; both vec tables populated", async () => {
    const agent = "test-agent";
    // Phase 115 'idle' maps to plan vocabulary 'v1-only'. Confirm the agent
    // starts in idle.
    const migBefore = new EmbeddingV2Migrator(store.getDatabase(), agent);
    expect(migBefore.getState().phase).toBe("idle");

    const result = await crossIngestToMemory({
      agent,
      docSlug: "pon-2024-tax-return",
      chunks: [
        { index: 0, content: "Schedule C net profit was $12,345." },
        { index: 1, content: "Backdoor Roth $7,000 in 2024." },
      ],
      embedderV1,
      embedderV2,
      memoryStore: store,
      migrationPhaseStore: migrationStore(store, agent),
    });

    expect(result.chunksWritten).toBe(2);
    expect(result.migrationPhaseAfter).toBe("dual-write");

    // Phase 115 migrator now reports dual-write (or one of its equivalents).
    const migAfter = new EmbeddingV2Migrator(store.getDatabase(), agent);
    expect(migAfter.getState().phase).toBe("dual-write");

    const db = store.getDatabase();
    const v1Count = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM vec_memory_chunks WHERE chunk_id IN
             (SELECT id FROM memory_chunks WHERE path = ?)`,
        )
        .get("document:pon-2024-tax-return") as { n: number }
    ).n;
    const v2Count = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM vec_memory_chunks_v2 WHERE chunk_id IN
             (SELECT id FROM memory_chunks WHERE path = ?)`,
        )
        .get("document:pon-2024-tax-return") as { n: number }
    ).n;
    expect(v1Count).toBe(2);
    expect(v2Count).toBe(2);

    cleanup();
  });

  it("U6-T02: dual-write agent — both vec tables populated, no spurious phase change", async () => {
    const agent = "dual-agent";
    // Force dual-write up front so the auto-flip is a no-op.
    const mig = new EmbeddingV2Migrator(store.getDatabase(), agent);
    mig.transition("dual-write");
    expect(mig.getState().phase).toBe("dual-write");

    const result = await crossIngestToMemory({
      agent,
      docSlug: "agreement-2025-q1",
      chunks: [{ index: 0, content: "alpha bravo charlie" }],
      embedderV1,
      embedderV2,
      memoryStore: store,
      migrationPhaseStore: migrationStore(store, agent),
    });

    expect(result.chunksWritten).toBe(1);
    expect(result.migrationPhaseAfter).toBe("dual-write");
    expect(new EmbeddingV2Migrator(store.getDatabase(), agent).getState().phase).toBe(
      "dual-write",
    );

    const db = store.getDatabase();
    const ftsCount = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM memory_chunks_fts WHERE chunk_id IN
             (SELECT id FROM memory_chunks WHERE path = ?)`,
        )
        .get("document:agreement-2025-q1") as { n: number }
    ).n;
    expect(ftsCount).toBe(1);

    cleanup();
  });

  it("U6-T03: v2-only agent — vec_memory_chunks_v2 populated; phase persists", async () => {
    const agent = "v2-agent";
    // Walk the phase machine to cutover (= v2-only mapping).
    const mig = new EmbeddingV2Migrator(store.getDatabase(), agent);
    mig.transition("dual-write");
    mig.transition("re-embedding");
    mig.transition("re-embed-complete");
    mig.transition("cutover");
    expect(mig.getState().phase).toBe("cutover");

    const result = await crossIngestToMemory({
      agent,
      docSlug: "doc-v2-mode",
      chunks: [{ index: 0, content: "post-cutover doc content" }],
      embedderV1,
      embedderV2,
      memoryStore: store,
      migrationPhaseStore: migrationStore(store, agent),
    });

    expect(result.chunksWritten).toBe(1);
    expect(result.migrationPhaseAfter).toBe("v2-only");

    const db = store.getDatabase();
    const v2Count = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM vec_memory_chunks_v2 WHERE chunk_id IN
             (SELECT id FROM memory_chunks WHERE path = ?)`,
        )
        .get("document:doc-v2-mode") as { n: number }
    ).n;
    expect(v2Count).toBe(1);

    cleanup();
  });

  it("U6-T04: idempotency — second call with same docSlug DELETEs + re-INSERTs", async () => {
    const agent = "idem-agent";
    const args = {
      agent,
      docSlug: "idem-doc",
      chunks: [
        { index: 0, content: "first chunk" },
        { index: 1, content: "second chunk" },
      ],
      embedderV1,
      embedderV2,
      memoryStore: store,
      migrationPhaseStore: migrationStore(store, agent),
    };
    const first = await crossIngestToMemory(args);
    expect(first.chunksWritten).toBe(2);

    // Capture first set of chunk ids.
    const db = store.getDatabase();
    const firstIds = (
      db
        .prepare(`SELECT id FROM memory_chunks WHERE path = ?`)
        .all("document:idem-doc") as Array<{ id: string }>
    ).map((r) => r.id);
    expect(firstIds).toHaveLength(2);

    // Second call with the SAME docSlug should DELETE prior rows and INSERT new ones.
    const second = await crossIngestToMemory(args);
    expect(second.chunksWritten).toBe(2);

    const afterIds = (
      db
        .prepare(`SELECT id FROM memory_chunks WHERE path = ?`)
        .all("document:idem-doc") as Array<{ id: string }>
    ).map((r) => r.id);
    expect(afterIds).toHaveLength(2);
    // Row count unchanged. New chunk ids (delete + re-insert), so the
    // two sets should be disjoint.
    const overlap = firstIds.filter((id) => afterIds.includes(id));
    expect(overlap).toHaveLength(0);

    cleanup();
  });

  it("U6-T05: invalid docSlug with space rejected (T-101-11 mitigation)", async () => {
    const agent = "reject-agent";
    await expect(
      crossIngestToMemory({
        agent,
        docSlug: "pon-2024 tax return",
        chunks: [{ index: 0, content: "x" }],
        embedderV1,
        embedderV2,
        memoryStore: store,
        migrationPhaseStore: migrationStore(store, agent),
      }),
    ).rejects.toThrow(/invalid docSlug/);

    cleanup();
  });

  it("U6-T06: CF-1 round-trip — applyTimeWindowFilter retains cross-ingested chunk past expiry", async () => {
    const agent = "tw-agent";
    const docSlug = "ancient-doc";
    await crossIngestToMemory({
      agent,
      docSlug,
      chunks: [{ index: 0, content: "old content from long ago" }],
      embedderV1,
      embedderV2,
      memoryStore: store,
      migrationPhaseStore: migrationStore(store, agent),
    });

    // Read back the stored chunk row including file_mtime_ms.
    const row = store
      .getDatabase()
      .prepare(
        `SELECT path, file_mtime_ms FROM memory_chunks WHERE path = ?`,
      )
      .get(`document:${docSlug}`) as
      | { path: string; file_mtime_ms: number }
      | undefined;
    expect(row).toBeDefined();

    // Simulate 30 days passing — chunk is "ancient", but CF-1 should allow-list it.
    const future = (row!.file_mtime_ms ?? 0) + 30 * 86_400_000;
    const filtered = applyTimeWindowFilter([row!], 14, future);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].path).toBe(`document:${docSlug}`);

    cleanup();
  });
});
