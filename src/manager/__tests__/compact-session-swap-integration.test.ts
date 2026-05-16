/**
 * Phase 124 Plan 05 T-04 — end-to-end live hot-swap integration test.
 *
 * Drives the full compact-session flow against a REAL
 * createPersistentSessionHandle (not a fixture) so the production swap
 * path is exercised in-test:
 *
 *   1. Construct a real handle backed by a synthetic SDK harness.
 *   2. Push a "pre-swap" message + result through epoch 0.
 *   3. Invoke handleCompactSession with sdkForkSession stubbed.
 *   4. Assert swapped_live:true on the payload.
 *   5. Assert handle.sessionId == fork id, handle.getEpoch() == 1.
 *   6. Push a "post-swap" message — it lands on the NEW SDK controller's
 *      receivedUserMessages, NOT the old.
 *   7. Probe-recall: after swap, a memory.db chunk created BEFORE the
 *      swap is still retrievable via the store's vec search (Path C
 *      invariant: extracted facts survive the epoch boundary).
 *
 * Plus negative paths:
 *   - Handle WITHOUT swap method (legacy fixture) → swapped_live:false
 *     + swap_reason: "handle_lacks_swap" (backward compat).
 *   - Handle WITH swap that throws on rebuild → swapped_live:false
 *     + swap_reason: "swap_threw:..." + old epoch intact.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";

import { MemoryStore } from "../../memory/store.js";
import type { EmbeddingService } from "../../memory/embedder.js";
import {
  CompactionManager,
  type ConversationTurn,
} from "../../memory/compaction.js";
import { SessionLogger } from "../../memory/session-log.js";
import { handleCompactSession } from "../daemon-compact-session-ipc.js";
import { createPersistentSessionHandle } from "../persistent-session-handle.js";
import type {
  SdkModule,
  SdkQuery,
  SdkStreamMessage,
} from "../sdk-types.js";

const SILENT_LOG = pino({ level: "silent" });

function deterministicEmbedding(text: string): Float32Array {
  const arr = new Float32Array(384);
  let seed = 0;
  for (let i = 0; i < text.length; i++) {
    seed = (seed * 31 + text.charCodeAt(i)) >>> 0;
  }
  for (let i = 0; i < 384; i++) {
    const x = ((seed + i * 2654435761) >>> 0) / 0xffffffff;
    arr[i] = x - 0.5;
  }
  let norm = 0;
  for (let i = 0; i < 384; i++) norm += arr[i] * arr[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < 384; i++) arr[i] /= norm;
  return arr;
}

type FakeQueryController = {
  readonly query: SdkQuery;
  pushMessage: (msg: SdkStreamMessage) => void;
  endStream: () => void;
  receivedUserMessages: string[];
  close: ReturnType<typeof vi.fn>;
};

function createFakeQuery(
  promptIterable: AsyncIterable<unknown>,
): FakeQueryController {
  const pending: SdkStreamMessage[] = [];
  let msgWaiter: ((r: IteratorResult<SdkStreamMessage>) => void) | null = null;
  let streamEnded = false;
  const receivedUserMessages: string[] = [];

  void (async () => {
    try {
      for await (const m of promptIterable) {
        const msg = m as { message?: { content?: unknown } };
        const content = msg?.message?.content;
        if (typeof content === "string") {
          receivedUserMessages.push(content);
        } else {
          receivedUserMessages.push(JSON.stringify(content));
        }
      }
    } catch {
      // ignore
    }
  })();

  const pushMessage = (msg: SdkStreamMessage): void => {
    if (msgWaiter) {
      const w = msgWaiter;
      msgWaiter = null;
      w({ value: msg, done: false });
      return;
    }
    pending.push(msg);
  };

  const endStream = (): void => {
    streamEnded = true;
    if (msgWaiter) {
      const w = msgWaiter;
      msgWaiter = null;
      w({ value: undefined as unknown as SdkStreamMessage, done: true });
    }
  };

  const next = (): Promise<IteratorResult<SdkStreamMessage>> =>
    new Promise<IteratorResult<SdkStreamMessage>>((resolve) => {
      if (pending.length > 0) {
        resolve({ value: pending.shift()!, done: false });
        return;
      }
      if (streamEnded) {
        resolve({
          value: undefined as unknown as SdkStreamMessage,
          done: true,
        });
        return;
      }
      msgWaiter = resolve;
    });

  const close = vi.fn(() => undefined);

  const query = {
    [Symbol.asyncIterator]() {
      return { next };
    },
    next,
    return: async () => ({ value: undefined, done: true as const }),
    throw: async (err: unknown) => {
      throw err;
    },
    interrupt: vi.fn(() => Promise.resolve()),
    close,
    streamInput: vi.fn(() => Promise.resolve()),
    mcpServerStatus: vi.fn(() => Promise.resolve([])),
    setMcpServers: vi.fn(() => Promise.resolve(undefined)),
    setMaxThinkingTokens: vi.fn(() => Promise.resolve(undefined)),
    setModel: vi.fn(() => Promise.resolve(undefined)),
    setPermissionMode: vi.fn(() => Promise.resolve(undefined)),
  } as unknown as SdkQuery;

  return {
    query,
    pushMessage,
    endStream,
    receivedUserMessages,
    close,
  };
}

function emitStockTurn(
  ctrl: FakeQueryController,
  opts: { readonly text: string; readonly sessionId: string },
): void {
  ctrl.pushMessage({
    type: "assistant",
    parent_tool_use_id: null,
    message: { content: [{ type: "text", text: opts.text }] },
  } as unknown as SdkStreamMessage);
  ctrl.pushMessage({
    type: "result",
    subtype: "success",
    result: opts.text,
    session_id: opts.sessionId,
  } as unknown as SdkStreamMessage);
}

describe("handleCompactSession — live hot-swap integration", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it(
    "swaps the live handle to the fork session id; post-swap dispatch lands on new epoch",
    async () => {
      // --- 1. Set up real memory.db + CompactionManager. ---
      const store = new MemoryStore(":memory:", {
        enabled: false,
        similarityThreshold: 0.85,
      });
      const tmp = await mkdtemp(join(tmpdir(), "compact-swap-it-"));
      const sessionLogger = new SessionLogger(tmp);
      const cm = new CompactionManager({
        memoryStore: store,
        embedder: {
          embed: async (t: string) => deterministicEmbedding(t),
        } as unknown as EmbeddingService,
        sessionLogger,
        threshold: 0.7,
        log: SILENT_LOG,
      });

      // --- 2. Construct a REAL persistent handle with a synthetic SDK. ---
      const controllers: FakeQueryController[] = [];
      const sdkMock = {
        query: vi.fn((params: { prompt: unknown }) => {
          const c = createFakeQuery(params.prompt as AsyncIterable<unknown>);
          controllers.push(c);
          return c.query;
        }),
      };

      const ORIGINAL_SID = "orig-aaaa-bbbb-cccc-dddd-eeeeeeee";
      const FORK_SID = "fork-1111-2222-3333-4444-555555555555";

      const handle = createPersistentSessionHandle(
        sdkMock as unknown as SdkModule,
        { model: "sonnet" },
        ORIGINAL_SID,
      );

      // Drive one pre-swap turn so the epoch-0 SDK query has live receive
      // state we can assert against later.
      const preP = handle.sendAndCollect("pre-swap-msg");
      await Promise.resolve();
      await Promise.resolve();
      emitStockTurn(controllers[0], {
        text: "pre-reply",
        sessionId: ORIGINAL_SID,
      });
      await preP;

      // --- 3. Seed memory.db with a chunk created BEFORE the swap, so
      //        the probe-recall step has something to find. ---
      const preSwapMemoryId = store.insert(
        {
          content: "User's favorite color is teal (pre-swap fact).",
          source: "manual",
        },
        deterministicEmbedding("teal-color-fact"),
      ).id;

      const conversation: ConversationTurn[] = [];
      for (let i = 0; i < 52; i++) {
        conversation.push({
          timestamp: "2026-05-14T12:00:00Z",
          role: i % 2 === 0 ? "user" : "assistant",
          content: `turn-${i}: discussion content line ${i} is at least 20 chars long.`,
        });
      }

      const FACTS = [
        "Live hot-swap reuses handle identity across the epoch boundary.",
        "Plan 124-05 closes the operator-manual restart gap.",
      ] as const;
      const extractMemories = async () =>
        Object.freeze(FACTS.slice()) as readonly string[];

      // --- 4. Run handleCompactSession with the REAL handle. ---
      const result = await handleCompactSession(
        { agent: "synthetic-test" },
        {
          manager: {
            getSessionHandle: () => handle,
            getConversationTurns: () => conversation,
            getContextFillProvider: () => undefined,
            compactForAgent: async (_n, conv, ex) => cm.compact(conv, ex),
            hasCompactionManager: () => true,
          },
          sdkForkSession: async () => ({ sessionId: FORK_SID }),
          extractMemories,
          log: SILENT_LOG,
          daemonReady: true,
        },
      );

      // --- 5. Assert swap success on the payload. ---
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.swapped_live).toBe(true);
      expect(result.swap_reason).toBeUndefined();
      expect(result.forked_to).toBe(FORK_SID);
      expect(result.memories_created).toBe(FACTS.length);

      // --- 6. Assert the live handle now reflects the new epoch. ---
      expect(handle.sessionId).toBe(FORK_SID);
      expect(handle.getEpoch?.()).toBe(1);
      // sdkMock.query fired twice: once at construction, once at swap.
      expect(sdkMock.query).toHaveBeenCalledTimes(2);
      // The last sdk.query call carries the fork session id as resume.
      const lastCall = sdkMock.query.mock.calls.at(-1)![0] as unknown as {
        options: { resume: string };
      };
      expect(lastCall.options.resume).toBe(FORK_SID);

      // --- 7. Post-swap dispatch lands on the NEW controller. ---
      expect(controllers).toHaveLength(2);
      const postP = handle.sendAndCollect("post-swap-msg");
      await Promise.resolve();
      await Promise.resolve();
      emitStockTurn(controllers[1], {
        text: "post-reply",
        sessionId: FORK_SID,
      });
      const postR = await postP;
      expect(postR).toBe("post-reply");
      // Confirm: post-swap message did NOT leak to the old controller.
      expect(controllers[0].receivedUserMessages).toEqual(["pre-swap-msg"]);
      expect(controllers[1].receivedUserMessages).toEqual(["post-swap-msg"]);

      // --- 8. Probe-recall: the pre-swap memory.db chunk still exists,
      //        and the extracted facts are queryable via vec search.   ---
      expect(store.getById(preSwapMemoryId)).not.toBeNull();
      const probe = deterministicEmbedding(
        "Live hot-swap reuses handle identity across the epoch boundary.",
      );
      const hits = store.searchMemoriesVec(probe, 1);
      expect(hits.length).toBeGreaterThan(0);
      const hit = store.getById(hits[0].memory_id);
      expect(hit?.content).toBe(
        "Live hot-swap reuses handle identity across the epoch boundary.",
      );

      await handle.close();

      cleanup = async () => {
        store.close();
        await rm(tmp, { recursive: true, force: true });
      };
    },
    30_000,
  );

  it("falls back to swapped_live:false when the handle lacks swap (backward compat)", async () => {
    const store = new MemoryStore(":memory:", {
      enabled: false,
      similarityThreshold: 0.85,
    });
    const tmp = await mkdtemp(join(tmpdir(), "compact-swap-bc-"));
    const sessionLogger = new SessionLogger(tmp);
    const cm = new CompactionManager({
      memoryStore: store,
      embedder: {
        embed: async (t: string) => deterministicEmbedding(t),
      } as unknown as EmbeddingService,
      sessionLogger,
      threshold: 0.7,
      log: SILENT_LOG,
    });

    const conversation: ConversationTurn[] = [];
    for (let i = 0; i < 52; i++) {
      conversation.push({
        timestamp: "2026-05-14T12:00:00Z",
        role: i % 2 === 0 ? "user" : "assistant",
        content: `legacy-${i}: legacy fixture handle has no swap method.`,
      });
    }

    const result = await handleCompactSession(
      { agent: "legacy-fixture" },
      {
        manager: {
          // Hand-rolled fixture handle — no `swap` method (legacy
          // wrapSdkQuery shape).
          getSessionHandle: () => ({
            sessionId: "legacy-sid",
            hasActiveTurn: () => false,
          }),
          getConversationTurns: () => conversation,
          getContextFillProvider: () => undefined,
          compactForAgent: async (_n, conv, ex) => cm.compact(conv, ex),
          hasCompactionManager: () => true,
        },
        sdkForkSession: async () => ({ sessionId: "fork-legacy" }),
        extractMemories: async () => ["legacy fact 1", "legacy fact 2"],
        log: SILENT_LOG,
        daemonReady: true,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Fork artifact + memory growth still delivered — partial success.
    expect(result.forked_to).toBe("fork-legacy");
    expect(result.summary_written).toBe(true);
    // But the live handle was NOT rebound (additive-optional contract).
    expect(result.swapped_live).toBe(false);
    expect(result.swap_reason).toBe("handle_lacks_swap");

    cleanup = async () => {
      store.close();
      await rm(tmp, { recursive: true, force: true });
    };
  });

  it("falls back to swapped_live:false when handle.swap throws; old epoch intact", async () => {
    const store = new MemoryStore(":memory:", {
      enabled: false,
      similarityThreshold: 0.85,
    });
    const tmp = await mkdtemp(join(tmpdir(), "compact-swap-thr-"));
    const sessionLogger = new SessionLogger(tmp);
    const cm = new CompactionManager({
      memoryStore: store,
      embedder: {
        embed: async (t: string) => deterministicEmbedding(t),
      } as unknown as EmbeddingService,
      sessionLogger,
      threshold: 0.7,
      log: SILENT_LOG,
    });

    const conversation: ConversationTurn[] = [];
    for (let i = 0; i < 52; i++) {
      conversation.push({
        timestamp: "2026-05-14T12:00:00Z",
        role: i % 2 === 0 ? "user" : "assistant",
        content: `throw-${i}: swap will reject with rebuild-failed.`,
      });
    }

    // Hand-rolled handle whose swap deliberately throws.
    const throwingHandle = {
      sessionId: "throw-sid",
      hasActiveTurn: () => false,
      swap: async (_next: string) => {
        throw new Error("sdk-rebuild-failed");
      },
    };

    const result = await handleCompactSession(
      { agent: "throwing-handle" },
      {
        manager: {
          getSessionHandle: () => throwingHandle,
          getConversationTurns: () => conversation,
          getContextFillProvider: () => undefined,
          compactForAgent: async (_n, conv, ex) => cm.compact(conv, ex),
          hasCompactionManager: () => true,
        },
        sdkForkSession: async () => ({ sessionId: "fork-throw" }),
        extractMemories: async () => ["a fact that is long enough to pass"],
        log: SILENT_LOG,
        daemonReady: true,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.swapped_live).toBe(false);
    expect(result.swap_reason).toContain("swap_threw:sdk-rebuild-failed");
    // Old epoch intact — sessionId on the fixture handle unchanged.
    expect(throwingHandle.sessionId).toBe("throw-sid");
    // Fork artifact + memory growth still delivered.
    expect(result.forked_to).toBe("fork-throw");
    expect(result.summary_written).toBe(true);

    cleanup = async () => {
      store.close();
      await rm(tmp, { recursive: true, force: true });
    };
  });
});
