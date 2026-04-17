/**
 * Phase 61 Plan 02 Task 1 -- InboxSource tests.
 *
 * Tests the chokidar-based inbox file watcher and poll(since) replay.
 * Mocks chokidar and collaboration/inbox functions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TriggerEvent } from "../../types.js";
import type { InboxMessage } from "../../../collaboration/types.js";

// ---------------------------------------------------------------------------
// Mock chokidar
// ---------------------------------------------------------------------------

type ChokidarAddCallback = (path: string) => void;

const mockWatcher = {
  on: vi.fn().mockReturnThis(),
  close: vi.fn().mockResolvedValue(undefined),
};

vi.mock("chokidar", () => ({
  watch: vi.fn(() => mockWatcher),
}));

// ---------------------------------------------------------------------------
// Mock collaboration/inbox
// ---------------------------------------------------------------------------

const mockReadMessages = vi.fn<(dir: string) => Promise<readonly InboxMessage[]>>();
const mockMarkProcessed = vi.fn<(dir: string, id: string) => Promise<void>>();

vi.mock("../../../collaboration/inbox.js", () => ({
  readMessages: (...args: unknown[]) => mockReadMessages(args[0] as string),
  markProcessed: (...args: unknown[]) => mockMarkProcessed(args[0] as string, args[1] as string),
}));

// ---------------------------------------------------------------------------
// Mock node:fs/promises (for reading file contents in the 'add' handler)
// ---------------------------------------------------------------------------

const mockReadFile = vi.fn<(path: string, encoding: string) => Promise<string>>();

vi.mock("node:fs/promises", () => ({
  readFile: (...args: unknown[]) => mockReadFile(args[0] as string, args[1] as string),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { watch } from "chokidar";
import { InboxSource, type InboxSourceOptions } from "../inbox-source.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(overrides: Partial<InboxMessage> = {}): InboxMessage {
  return {
    id: "msg-001",
    from: "agent-a",
    to: "agent-b",
    content: "hello there",
    timestamp: 1000,
    priority: "normal",
    ...overrides,
  };
}

function makeOptions(overrides: Partial<InboxSourceOptions> = {}): InboxSourceOptions {
  return {
    agentName: "agent-b",
    inboxDir: "/workspace/agent-b/inbox",
    stabilityThresholdMs: 500,
    targetAgent: "agent-b",
    ingest: vi.fn().mockResolvedValue(undefined),
    log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as unknown as InboxSourceOptions["log"],
    ...overrides,
  };
}

/** Extract the chokidar 'add' callback registered by start(). */
function getAddCallback(): ChokidarAddCallback {
  const addCall = mockWatcher.on.mock.calls.find(
    (call: unknown[]) => call[0] === "add",
  );
  if (!addCall) throw new Error("No 'add' callback registered on watcher");
  return addCall[1] as ChokidarAddCallback;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("InboxSource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadMessages.mockResolvedValue([]);
    mockMarkProcessed.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("sourceId", () => {
    it("uses inbox:{agentName} format", () => {
      const source = new InboxSource(makeOptions({ agentName: "clawdy" }));
      expect(source.sourceId).toBe("inbox:clawdy");
    });
  });

  describe("start()", () => {
    it("creates chokidar watcher with ignoreInitial: true", () => {
      const source = new InboxSource(makeOptions());
      source.start();

      expect(watch).toHaveBeenCalledWith(
        "/workspace/agent-b/inbox",
        expect.objectContaining({ ignoreInitial: true }),
      );
    });

    it("creates chokidar watcher with awaitWriteFinish stabilityThreshold from config", () => {
      const source = new InboxSource(makeOptions({ stabilityThresholdMs: 750 }));
      source.start();

      expect(watch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          awaitWriteFinish: expect.objectContaining({
            stabilityThreshold: 750,
          }),
        }),
      );
    });
  });

  describe("chokidar add event", () => {
    it("Test 1: reads new JSON file, builds TriggerEvent, calls ingestFn", async () => {
      const msg = makeMessage();
      const ingest = vi.fn().mockResolvedValue(undefined);
      const source = new InboxSource(makeOptions({ ingest }));
      source.start();

      mockReadFile.mockResolvedValueOnce(JSON.stringify(msg));

      const addCallback = getAddCallback();
      await addCallback("/workspace/agent-b/inbox/1000-agent-a-abc123.json");

      expect(ingest).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceId: "inbox:agent-b",
          idempotencyKey: "msg-001",
          targetAgent: "agent-b",
          payload: "[Message from agent-a]: hello there",
          timestamp: 1000,
        }),
      );
    });

    it("Test 2: after successful ingest, file is moved to processed/ via markProcessed", async () => {
      const msg = makeMessage();
      const ingest = vi.fn().mockResolvedValue(undefined);
      const source = new InboxSource(makeOptions({ ingest }));
      source.start();

      mockReadFile.mockResolvedValueOnce(JSON.stringify(msg));

      const addCallback = getAddCallback();
      await addCallback("/workspace/agent-b/inbox/1000-agent-a-abc123.json");

      expect(mockMarkProcessed).toHaveBeenCalledWith(
        "/workspace/agent-b/inbox",
        "msg-001",
      );
    });

    it("Test 8: non-JSON files in inbox are ignored (no crash, warn log)", async () => {
      const ingest = vi.fn();
      const log = { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as unknown as InboxSourceOptions["log"];
      const source = new InboxSource(makeOptions({ ingest, log }));
      source.start();

      mockReadFile.mockResolvedValueOnce("this is not JSON");

      const addCallback = getAddCallback();
      await addCallback("/workspace/agent-b/inbox/readme.txt");

      expect(ingest).not.toHaveBeenCalled();
      expect(log.warn).toHaveBeenCalled();
    });

    it("Test 8b: files with missing required fields are skipped with warn log", async () => {
      const ingest = vi.fn();
      const log = { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as unknown as InboxSourceOptions["log"];
      const source = new InboxSource(makeOptions({ ingest, log }));
      source.start();

      // Valid JSON but missing required InboxMessage fields
      mockReadFile.mockResolvedValueOnce(JSON.stringify({ foo: "bar" }));

      const addCallback = getAddCallback();
      await addCallback("/workspace/agent-b/inbox/bad-message.json");

      expect(ingest).not.toHaveBeenCalled();
      expect(log.warn).toHaveBeenCalled();
    });

    it("Test 9: if ingest fails, file is NOT moved to processed (will be retried)", async () => {
      const msg = makeMessage();
      const ingest = vi.fn().mockRejectedValueOnce(new Error("ingest boom"));
      const log = { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as unknown as InboxSourceOptions["log"];
      const source = new InboxSource(makeOptions({ ingest, log }));
      source.start();

      mockReadFile.mockResolvedValueOnce(JSON.stringify(msg));

      const addCallback = getAddCallback();
      await addCallback("/workspace/agent-b/inbox/1000-agent-a-abc123.json");

      expect(ingest).toHaveBeenCalled();
      expect(mockMarkProcessed).not.toHaveBeenCalled();
      expect(log.error).toHaveBeenCalled();
    });
  });

  describe("stop()", () => {
    it("Test 5: closes the chokidar watcher", async () => {
      const source = new InboxSource(makeOptions());
      source.start();
      source.stop();

      expect(mockWatcher.close).toHaveBeenCalled();
    });

    it("is a no-op when called before start", () => {
      const source = new InboxSource(makeOptions());
      // Should not throw
      source.stop();
    });
  });

  describe("poll(since)", () => {
    it("Test 6: returns events for unprocessed messages with timestamp > parseInt(since)", async () => {
      const msg1 = makeMessage({ id: "msg-old", timestamp: 500 });
      const msg2 = makeMessage({ id: "msg-new", timestamp: 1500, from: "agent-c", content: "world" });
      mockReadMessages.mockResolvedValueOnce([msg1, msg2]);

      const source = new InboxSource(makeOptions());
      const events = await source.poll("1000");

      expect(events).toHaveLength(1);
      expect(events[0]!.idempotencyKey).toBe("msg-new");
      expect(events[0]!.payload).toBe("[Message from agent-c]: world");
    });

    it("Test 7: poll(null) returns all unprocessed messages (no watermark filter)", async () => {
      const msg1 = makeMessage({ id: "msg-1", timestamp: 100 });
      const msg2 = makeMessage({ id: "msg-2", timestamp: 200, from: "agent-c", content: "yo" });
      mockReadMessages.mockResolvedValueOnce([msg1, msg2]);

      const source = new InboxSource(makeOptions());
      const events = await source.poll(null);

      expect(events).toHaveLength(2);
      expect(events[0]!.idempotencyKey).toBe("msg-1");
      expect(events[1]!.idempotencyKey).toBe("msg-2");
    });

    it("poll results are sorted by timestamp ascending", async () => {
      const msg1 = makeMessage({ id: "msg-late", timestamp: 9000 });
      const msg2 = makeMessage({ id: "msg-early", timestamp: 2000, from: "agent-c" });
      // readMessages returns sorted already, but verify source preserves order
      mockReadMessages.mockResolvedValueOnce([msg2, msg1]);

      const source = new InboxSource(makeOptions());
      const events = await source.poll(null);

      expect(events[0]!.timestamp).toBeLessThan(events[1]!.timestamp);
    });
  });
});
