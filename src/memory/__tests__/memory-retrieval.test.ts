import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../store.js";
import {
  rrfFuse,
  retrieveMemoryChunks,
} from "../memory-retrieval.js";

function deterministicEmbedding(seed: number): Float32Array {
  const arr = new Float32Array(384);
  for (let i = 0; i < 384; i++) {
    arr[i] = Math.sin(seed * 0.1 + i * 0.01);
  }
  // L2-normalize for cosine stability
  let norm = 0;
  for (let i = 0; i < 384; i++) norm += arr[i] * arr[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < 384; i++) arr[i] = arr[i] / norm;
  return arr;
}

async function testEmbed(text: string): Promise<Float32Array> {
  // Stable per-text embedding: hash string to seed.
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return deterministicEmbedding(Math.abs(h));
}

describe("memory-retrieval RRF (Phase 90 MEM-03)", () => {
  describe("rrfFuse", () => {
    it("MEM-03-R1: sorts fused scores by 1/(k+r1)+1/(k+r2)", () => {
      const fused = rrfFuse(
        [
          { chunk_id: "a", distance: 0.1 },
          { chunk_id: "b", distance: 0.2 },
        ],
        [
          { chunk_id: "b", rank: -1 },
          { chunk_id: "c", rank: -2 },
        ],
        60,
      );
      const ids = fused.map((f) => f.chunk_id);
      expect(ids[0]).toBe("b"); // shared top → best fused
      expect(ids).toContain("a");
      expect(ids).toContain("c");
    });

    it("MEM-03-R1b: empty inputs → empty output", () => {
      expect(rrfFuse([], [], 60)).toEqual([]);
    });
  });

  describe("retrieveMemoryChunks", () => {
    let store: MemoryStore;

    beforeEach(() => {
      store = new MemoryStore(":memory:");
    });

    afterEach(() => {
      store.close();
    });

    it("MEM-03-R2: semantic query surfaces matching chunk (Zaid investment)", async () => {
      // Seed 5 chunks; the target chunk shares its embedding with the query.
      const targetBody = "Zaid wants 40% in SGOV for safety allocation";
      const queryEmbedding = await testEmbed("Zaid investment proportion");
      // Target chunk embedded with same text as query for guaranteed top-1
      store.insertMemoryChunk({
        path: "/ws/memory/2026-04-24-zaid.md",
        chunkIndex: 0,
        heading: "Investment",
        body: targetBody,
        tokenCount: 20,
        scoreWeight: 0,
        fileMtimeMs: Date.now(),
        fileSha256: "zaid",
        embedding: queryEmbedding, // Simulate strong semantic match
      });
      for (let i = 0; i < 4; i++) {
        store.insertMemoryChunk({
          path: `/ws/memory/2026-04-24-other-${i}.md`,
          chunkIndex: 0,
          heading: `Other ${i}`,
          body: `Unrelated content about weather ${i}`,
          tokenCount: 10,
          scoreWeight: 0,
          fileMtimeMs: Date.now(),
          fileSha256: `other-${i}`,
          embedding: deterministicEmbedding(i + 1000),
        });
      }

      const results = await retrieveMemoryChunks({
        query: "Zaid investment proportion",
        store,
        embed: testEmbed,
        topK: 5,
      });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].body).toContain("Zaid");
      expect(results[0].body).toContain("SGOV");
    });

    it("MEM-03-R3: time window excludes old dated files, keeps vault all-time", async () => {
      const now = Date.now();
      const oldMtime = now - 30 * 86_400_000;

      // Old dated file — should be filtered out
      store.insertMemoryChunk({
        path: "/ws/memory/2026-03-01-old.md",
        chunkIndex: 0,
        heading: "Old",
        body: "ancient dated note",
        tokenCount: 10,
        scoreWeight: 0,
        fileMtimeMs: oldMtime,
        fileSha256: "old",
        embedding: deterministicEmbedding(100),
      });
      // Old vault file — should be kept
      store.insertMemoryChunk({
        path: "/ws/memory/vault/rules.md",
        chunkIndex: 0,
        heading: "Rules",
        body: "standing rules",
        tokenCount: 10,
        scoreWeight: 0.2,
        fileMtimeMs: oldMtime,
        fileSha256: "vault",
        embedding: deterministicEmbedding(200),
      });

      const qEmb = await testEmbed("anything");
      const results = await retrieveMemoryChunks({
        query: "anything",
        store,
        embed: async () => qEmb, // same embedding → both semantic-match
        topK: 10,
        timeWindowDays: 14,
      });
      const paths = results.map((r) => r.path);
      expect(paths).toContain("/ws/memory/vault/rules.md");
      expect(paths).not.toContain("/ws/memory/2026-03-01-old.md");
    });

    it("MEM-03-R5: topK truncates results", async () => {
      for (let i = 0; i < 10; i++) {
        store.insertMemoryChunk({
          path: `/ws/memory/2026-04-24-n${i}.md`,
          chunkIndex: 0,
          heading: `N${i}`,
          body: `content ${i}`,
          tokenCount: 5,
          scoreWeight: 0,
          fileMtimeMs: Date.now(),
          fileSha256: `n${i}`,
          embedding: deterministicEmbedding(i),
        });
      }
      const results = await retrieveMemoryChunks({
        query: "content",
        store,
        embed: testEmbed,
        topK: 3,
      });
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it("MEM-03-R6: score_weight nudges vault above archive for equal-distance chunks", async () => {
      const sharedEmb = await testEmbed("shared");
      store.insertMemoryChunk({
        path: "/ws/memory/vault/good.md",
        chunkIndex: 0,
        heading: "Good",
        body: "vault content",
        tokenCount: 5,
        scoreWeight: 0.2,
        fileMtimeMs: Date.now(),
        fileSha256: "g",
        embedding: sharedEmb,
      });
      store.insertMemoryChunk({
        path: "/ws/memory/archive/bad.md",
        chunkIndex: 0,
        heading: "Bad",
        body: "archive content",
        tokenCount: 5,
        scoreWeight: -0.2,
        fileMtimeMs: Date.now(),
        fileSha256: "b",
        embedding: sharedEmb,
      });
      const results = await retrieveMemoryChunks({
        query: "shared",
        store,
        embed: async () => sharedEmb,
        topK: 5,
      });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].path).toBe("/ws/memory/vault/good.md");
    });

    it("MEM-03-R7: empty store returns empty array (no throw)", async () => {
      const results = await retrieveMemoryChunks({
        query: "whatever",
        store,
        embed: testEmbed,
        topK: 5,
      });
      expect(results).toEqual([]);
    });
  });
});
