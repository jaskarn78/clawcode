/**
 * Phase 68-02 — daemon memory-lookup IPC handler integration tests.
 *
 * Exercises the end-to-end wiring from IPC param → scope branching →
 * GraphSearch (legacy) OR searchByScope (new) → SQL → response envelope.
 * Uses REAL in-memory MemoryStore + ConversationStore (not mocks) to
 * honor the 67-VERIFICATION lesson: tests that only exercise helper
 * functions miss production wiring gaps.
 *
 * These tests call `invokeMemoryLookup` directly — the same function
 * the daemon IPC switch case calls at `src/manager/daemon.ts::case "memory-lookup"`.
 * When the handler body changes, this test picks up the change
 * automatically because it runs the same code path.
 *
 * WHEN CHANGING: any update to `invokeMemoryLookup` in
 * `src/manager/memory-lookup-handler.ts` is automatically exercised
 * here. The daemon's IPC switch case is a pure passthrough — keep it
 * that way.
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { MemoryStore } from "../../memory/store.js";
import { ConversationStore } from "../../memory/conversation-store.js";
import type { EmbeddingService } from "../../memory/embedder.js";
import { ManagerError } from "../../shared/errors.js";
import { invokeMemoryLookup } from "../memory-lookup-handler.js";

// Deterministic fake embedder — cosine-normalized 384-dim vector derived
// from input text length. Removes the ONNX warmup dependency from the
// test suite (would add ~10s on cold runs) while still producing a
// vector that MemoryStore + sqlite-vec can ingest.
const fakeEmbedder: EmbeddingService = {
  async embed(text: string): Promise<Float32Array> {
    const v = new Float32Array(384);
    for (let i = 0; i < 384; i++) {
      v[i] = Math.sin(i + text.length);
    }
    let norm = 0;
    for (let i = 0; i < 384; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < 384; i++) v[i] /= norm;
    }
    return v;
  },
} as EmbeddingService;

describe("daemon memory-lookup IPC integration — scope branching", () => {
  let memStore: MemoryStore;
  let convStore: ConversationStore;

  beforeEach(() => {
    memStore = new MemoryStore(":memory:", {
      enabled: false,
      similarityThreshold: 0.85,
    });
    convStore = new ConversationStore(memStore.getDatabase());
  });

  afterEach(() => {
    memStore?.close();
  });

  it("legacy default call (no scope, no page) returns pre-v1.9 response shape", async () => {
    const embedding = await fakeEmbedder.embed("deployment notes");
    memStore.insert(
      {
        content: "Deployment notes for v2",
        source: "manual",
        tags: ["project"],
        skipDedup: true,
      },
      embedding,
    );

    const result = (await invokeMemoryLookup(
      { agent: "agent-a", query: "deployment" },
      {
        memoryStore: memStore,
        conversationStore: convStore,
        embedder: fakeEmbedder,
      },
    )) as unknown as {
      results: Array<Record<string, unknown>>;
      hasMore?: boolean;
    };

    // No paginated envelope fields
    expect(result.hasMore).toBeUndefined();
    // If GraphSearch surfaced anything, the shape is the legacy one
    expect(result.results).toBeDefined();
    if (result.results.length > 0) {
      const first = result.results[0]!;
      expect(first).toHaveProperty("id");
      expect(first).toHaveProperty("content");
      expect(first).toHaveProperty("relevance_score");
      expect(first).toHaveProperty("tags");
      expect(first).toHaveProperty("created_at");
      expect(first).toHaveProperty("source");
      // linked_from is unique to the legacy GraphSearch branch
      expect(first).toHaveProperty("linked_from");
      // New-path fields MUST be absent on the legacy branch
      expect(first).not.toHaveProperty("origin");
      expect(first).not.toHaveProperty("session_id");
    }
  });

  it("explicit scope='memories' with page=0 also routes to legacy branch", async () => {
    const embedding = await fakeEmbedder.embed("test");
    memStore.insert(
      { content: "A test memory", source: "manual", skipDedup: true },
      embedding,
    );

    const result = (await invokeMemoryLookup(
      { agent: "agent-a", query: "test", scope: "memories", page: 0 },
      {
        memoryStore: memStore,
        conversationStore: convStore,
        embedder: fakeEmbedder,
      },
    )) as unknown as {
      results: Array<Record<string, unknown>>;
      hasMore?: boolean;
    };

    expect(result.hasMore).toBeUndefined();
  });

  it("scope='conversations' routes through searchByScope and returns paginated envelope", async () => {
    // Seed a session summary MemoryEntry containing the query term.
    const embedding = await fakeEmbedder.embed("deployment");
    memStore.insert(
      {
        content: "Session S1: discussed deployment strategy",
        source: "conversation",
        tags: ["session-summary", "session:S1"],
        skipDedup: true,
      },
      embedding,
    );

    // Seed a raw turn (FTS5 auto-syncs via trigger).
    const session = convStore.startSession("agent-a");
    convStore.recordTurn({
      sessionId: session.id,
      role: "user",
      content: "we need a deployment plan",
      isTrustedChannel: true,
    });

    const result = (await invokeMemoryLookup(
      {
        agent: "agent-a",
        query: "deployment",
        scope: "conversations",
        page: 0,
        limit: 10,
      },
      {
        memoryStore: memStore,
        conversationStore: convStore,
        embedder: fakeEmbedder,
      },
    )) as unknown as {
      results: Array<{ origin: string; session_id: string | null }>;
      hasMore: boolean;
      nextOffset: number | null;
    };

    expect(result.hasMore).toBeDefined();
    expect(typeof result.hasMore).toBe("boolean");
    expect(result.results.length).toBeGreaterThan(0);
    // Every result must have origin + session_id (new-path shape)
    for (const r of result.results) {
      expect(r.origin).toBeDefined();
      expect(["session-summary", "conversation-turn", "memory"]).toContain(
        r.origin,
      );
    }
    // At least one result should be the session-summary memory
    expect(result.results.some((r) => r.origin === "session-summary")).toBe(
      true,
    );
  });

  it("scope='all' merges memories + session-summaries + raw turns", async () => {
    // Plain knowledge memory
    const e1 = await fakeEmbedder.embed("general deployment knowledge");
    memStore.insert(
      {
        content: "General deployment knowledge: use blue-green",
        source: "manual",
        tags: ["knowledge"],
        skipDedup: true,
      },
      e1,
    );

    // Session summary for sessionA
    const e2 = await fakeEmbedder.embed("deployment summary");
    memStore.insert(
      {
        content: "Session summary: agent discussed deployment rollback plan",
        source: "conversation",
        tags: ["session-summary", "session:sessionA"],
        skipDedup: true,
      },
      e2,
    );

    // Raw turns for a DIFFERENT session (sessionB) so they aren't deduped
    // by dedupPreferSummary
    const sessionB = convStore.startSession("agent-a");
    convStore.recordTurn({
      sessionId: sessionB.id,
      role: "user",
      content: "tell me about our deployment process",
      isTrustedChannel: true,
    });

    const result = (await invokeMemoryLookup(
      { agent: "agent-a", query: "deployment", scope: "all", page: 0, limit: 10 },
      {
        memoryStore: memStore,
        conversationStore: convStore,
        embedder: fakeEmbedder,
      },
    )) as unknown as {
      results: Array<{ origin: string; session_id: string | null }>;
      hasMore: boolean;
      nextOffset: number | null;
    };

    const origins = new Set(result.results.map((r) => r.origin));
    // scope='all' surfaces multiple origins
    expect(origins.size).toBeGreaterThanOrEqual(2);
    expect(result.hasMore).toBeDefined();
  });

  it("pagination — page=1 returns offset = page * limit slice with hasMore tracking", async () => {
    // Seed 12 matching session summaries to exceed MAX_RESULTS_PER_PAGE (10).
    for (let i = 0; i < 12; i++) {
      const emb = await fakeEmbedder.embed(`deployment note ${i}`);
      memStore.insert(
        {
          content: `Session ${i}: deployment discussion notes`,
          source: "conversation",
          tags: ["session-summary", `session:sess-${i}`],
          skipDedup: true,
        },
        emb,
      );
    }

    const page0 = (await invokeMemoryLookup(
      {
        agent: "agent-a",
        query: "deployment",
        scope: "conversations",
        page: 0,
        limit: 10,
      },
      {
        memoryStore: memStore,
        conversationStore: convStore,
        embedder: fakeEmbedder,
      },
    )) as unknown as {
      results: readonly unknown[];
      hasMore: boolean;
      nextOffset: number | null;
    };

    expect(page0.results.length).toBe(10);
    expect(page0.hasMore).toBe(true);
    expect(page0.nextOffset).toBe(10);

    const page1 = (await invokeMemoryLookup(
      {
        agent: "agent-a",
        query: "deployment",
        scope: "conversations",
        page: 1,
        limit: 10,
      },
      {
        memoryStore: memStore,
        conversationStore: convStore,
        embedder: fakeEmbedder,
      },
    )) as unknown as {
      results: readonly unknown[];
      hasMore: boolean;
      nextOffset: number | null;
    };

    expect(page1.results.length).toBe(2);
    expect(page1.hasMore).toBe(false);
    expect(page1.nextOffset).toBeNull();
  });

  it("IPC-layer clamps limit > 10 to 10 (defense-in-depth)", async () => {
    // Seed 15 matches to prove the clamp kicks in at the IPC layer.
    for (let i = 0; i < 15; i++) {
      const emb = await fakeEmbedder.embed(`deployment ${i}`);
      memStore.insert(
        {
          content: `Memory ${i}: deployment info`,
          source: "conversation",
          tags: ["session-summary", `session:s-${i}`],
          skipDedup: true,
        },
        emb,
      );
    }

    // Caller bypasses MCP Zod and passes limit=50 directly.
    const result = (await invokeMemoryLookup(
      {
        agent: "agent-a",
        query: "deployment",
        scope: "all",
        page: 0,
        limit: 50,
      },
      {
        memoryStore: memStore,
        conversationStore: convStore,
        embedder: fakeEmbedder,
      },
    )) as unknown as { results: readonly unknown[] };

    expect(result.results.length).toBeLessThanOrEqual(10);
  });

  it("throws ManagerError when ConversationStore is missing for non-legacy scope", async () => {
    await expect(
      invokeMemoryLookup(
        { agent: "ghost", query: "x", scope: "conversations", page: 0 },
        {
          memoryStore: memStore,
          conversationStore: undefined, // simulate missing wiring
          embedder: fakeEmbedder,
        },
      ),
    ).rejects.toThrow(ManagerError);

    await expect(
      invokeMemoryLookup(
        { agent: "ghost", query: "x", scope: "conversations", page: 0 },
        {
          memoryStore: memStore,
          conversationStore: undefined,
          embedder: fakeEmbedder,
        },
      ),
    ).rejects.toThrow(/ConversationStore not found/);
  });

  it("legacy scope path does NOT require ConversationStore (graceful for legacy-only agents)", async () => {
    const embedding = await fakeEmbedder.embed("fallback test");
    memStore.insert(
      { content: "fallback test memory", source: "manual", skipDedup: true },
      embedding,
    );

    // Should succeed even with conversationStore undefined because the
    // legacy branch doesn't touch it.
    const result = await invokeMemoryLookup(
      { agent: "agent-a", query: "fallback" }, // no scope → legacy
      {
        memoryStore: memStore,
        conversationStore: undefined,
        embedder: fakeEmbedder,
      },
    );

    expect(result.results).toBeDefined();
  });
});
