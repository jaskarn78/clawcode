import { describe, it, expect, vi } from "vitest";

/**
 * Phase 73 Plan 01 Task 2 — RED tests for createPersistentSessionHandle.
 *
 * Verifies the persistent-per-agent SDK session contract:
 *   - ONE sdk.query({ prompt: asyncIterable }) call per handle lifetime
 *   - Depth-1 serial turn queue; 3rd concurrent send rejects QUEUE_FULL
 *   - Message ordering preserved across rapid sendAndStream calls
 *   - SessionHandle surface byte-identical to the v2.0 contract
 *   - Abort mid-turn races interrupt() + 2s deadline
 *   - Generator throw fires onError; in-flight sendAndStream rejects
 */

import { createPersistentSessionHandle } from "../persistent-session-handle.js";
import type { SdkModule, SdkQuery, SdkStreamMessage } from "../sdk-types.js";

// ---------------------------------------------------------------------------
// FakeQuery helper — hand-rolled AsyncGenerator with push-based control.
// ---------------------------------------------------------------------------

type FakeQueryController = {
  readonly query: SdkQuery;
  /** Push one SDK message into the stream the handle consumes. */
  pushMessage: (msg: SdkStreamMessage) => void;
  /** Resolve the generator (no more messages). */
  endStream: () => void;
  /** Throw an error from the generator — simulates subprocess death. */
  throwFromGenerator: (err: Error) => void;
  /** Observe user messages that the SDK "received" (pushed into prompt iterable). */
  receivedUserMessages: string[];
  /** Spies on the Query control methods. */
  interrupt: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

function createFakeQuery(
  promptIterable: AsyncIterable<unknown>,
): FakeQueryController {
  // Message queue the generator yields from.
  const pending: SdkStreamMessage[] = [];
  let msgWaiter: ((r: IteratorResult<SdkStreamMessage>) => void) | null = null;
  let msgError: ((err: Error) => void) | null = null;
  let streamEnded = false;
  const receivedUserMessages: string[] = [];

  // Drain the prompt iterable into receivedUserMessages so tests can observe
  // what the SDK "saw" (i.e., what the handle pushed via AsyncPushQueue).
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
      // ignore — prompt iterable closed abnormally
    }
  })();

  const pushMessage = (msg: SdkStreamMessage): void => {
    if (msgWaiter) {
      const w = msgWaiter;
      msgWaiter = null;
      msgError = null;
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
      msgError = null;
      w({ value: undefined as unknown as SdkStreamMessage, done: true });
    }
  };

  const throwFromGenerator = (err: Error): void => {
    if (msgError) {
      const reject = msgError;
      msgWaiter = null;
      msgError = null;
      reject(err);
      return;
    }
    // If no pending next(), schedule the throw for the next .next() call.
    streamEnded = true;
    pending.push({ __throw: err } as unknown as SdkStreamMessage);
  };

  const next = (): Promise<IteratorResult<SdkStreamMessage>> =>
    new Promise<IteratorResult<SdkStreamMessage>>((resolve, reject) => {
      if (pending.length > 0) {
        const m = pending.shift()!;
        if ((m as unknown as { __throw?: Error }).__throw) {
          reject((m as unknown as { __throw: Error }).__throw);
          return;
        }
        resolve({ value: m, done: false });
        return;
      }
      if (streamEnded) {
        resolve({ value: undefined as unknown as SdkStreamMessage, done: true });
        return;
      }
      msgWaiter = resolve;
      msgError = reject;
    });

  const interrupt = vi.fn(() => Promise.resolve());
  const close = vi.fn(() => undefined);

  // Build a minimal object that satisfies the Query shape used by the handle.
  const query = {
    [Symbol.asyncIterator]() {
      return { next };
    },
    next,
    return: async () => ({ value: undefined, done: true as const }),
    throw: async (err: unknown) => {
      throw err;
    },
    interrupt,
    close,
    streamInput: vi.fn(() => Promise.resolve()),
    mcpServerStatus: vi.fn(() => Promise.resolve([])),
    setMcpServers: vi.fn(() => Promise.resolve(undefined)),
  } as unknown as SdkQuery;

  return {
    query,
    pushMessage,
    endStream,
    throwFromGenerator,
    receivedUserMessages,
    interrupt,
    close,
  };
}

/** Emit a stock { assistant → result } sequence for a given turn. */
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

// ---------------------------------------------------------------------------
// Shared harness: build an SdkModule whose query() returns our FakeQuery.
// Expose the controller + the mock function so tests can assert behavior.
// ---------------------------------------------------------------------------

function buildHarness(): {
  sdkMock: { query: ReturnType<typeof vi.fn> };
  getController: () => FakeQueryController;
} {
  let controller: FakeQueryController | null = null;
  const query = vi.fn((params: { prompt: unknown; options?: unknown }) => {
    const iterable = params.prompt as AsyncIterable<unknown>;
    controller = createFakeQuery(iterable);
    return controller.query;
  });
  return {
    sdkMock: { query },
    getController: () => {
      if (!controller) throw new Error("FakeQuery not yet created");
      return controller;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createPersistentSessionHandle", () => {
  it("N sendAndStream calls → exactly one sdk.query invocation", async () => {
    const { sdkMock, getController } = buildHarness();
    const handle = createPersistentSessionHandle(
      sdkMock as unknown as SdkModule,
      { model: "sonnet" },
      "sess-1",
    );

    // Drive 5 turns sequentially; the controller replies to each.
    for (let i = 0; i < 5; i++) {
      const p = handle.sendAndStream(
        `msg-${i}`,
        () => undefined,
      );
      // Give the handle a microtask to push the user message + start awaiting.
      await Promise.resolve();
      await Promise.resolve();
      emitStockTurn(getController(), { text: `reply-${i}`, sessionId: "sess-1" });
      const result = await p;
      expect(result).toBe(`reply-${i}`);
    }

    expect(sdkMock.query).toHaveBeenCalledTimes(1);
    expect(getController().receivedUserMessages.length).toBe(5);

    await handle.close();
  });

  it("SessionHandle surface is byte-identical to the v2.0 contract (+ quick-task 260419-nic extensions)", async () => {
    const { sdkMock } = buildHarness();
    const handle = createPersistentSessionHandle(
      sdkMock as unknown as SdkModule,
      {},
      "sess-surface",
    );
    expect(handle.sessionId).toBe("sess-surface");
    expect(typeof handle.send).toBe("function");
    expect(typeof handle.sendAndCollect).toBe("function");
    expect(typeof handle.sendAndStream).toBe("function");
    expect(typeof handle.close).toBe("function");
    expect(typeof handle.onError).toBe("function");
    expect(typeof handle.onEnd).toBe("function");
    expect(typeof handle.setEffort).toBe("function");
    expect(typeof handle.getEffort).toBe("function");
    // quick-task 260419-nic — mid-turn interrupt primitives.
    expect(typeof handle.interrupt).toBe("function");
    expect(typeof handle.hasActiveTurn).toBe("function");
    // setEffort / getEffort round-trip
    handle.setEffort("high");
    expect(handle.getEffort()).toBe("high");
    await handle.close();
  });

  it("message ordering preserved under rapid sendAndStream calls", async () => {
    const { sdkMock, getController } = buildHarness();
    const handle = createPersistentSessionHandle(
      sdkMock as unknown as SdkModule,
      {},
      "sess-order",
    );

    // Fire 3 turns back-to-back without awaiting. Each turn queues up.
    const p1 = handle.sendAndStream("msg-A", () => undefined);
    const p2 = handle.sendAndStream("msg-B", () => undefined);
    // 3rd concurrent call exceeds depth-1 → QUEUE_FULL
    const p3 = handle.sendAndStream("msg-C", () => undefined);

    await expect(p3).rejects.toThrow("QUEUE_FULL");

    // Let p1's push happen.
    await Promise.resolve();
    await Promise.resolve();
    emitStockTurn(getController(), { text: "reply-A", sessionId: "sess-order" });
    await expect(p1).resolves.toBe("reply-A");

    // Now p2 should push and run.
    await Promise.resolve();
    await Promise.resolve();
    emitStockTurn(getController(), { text: "reply-B", sessionId: "sess-order" });
    await expect(p2).resolves.toBe("reply-B");

    // Observed user-message order on the SDK side matches call order.
    expect(getController().receivedUserMessages).toEqual(["msg-A", "msg-B"]);

    await handle.close();
  });

  it("QUEUE_FULL propagates from SerialTurnQueue when 3 concurrent sends arrive", async () => {
    const { sdkMock, getController } = buildHarness();
    const handle = createPersistentSessionHandle(
      sdkMock as unknown as SdkModule,
      {},
      "sess-full",
    );

    const p1 = handle.sendAndStream("1", () => undefined);
    const p2 = handle.sendAndStream("2", () => undefined);
    const p3 = handle.sendAndStream("3", () => undefined);

    await expect(p3).rejects.toThrow("QUEUE_FULL");

    // Drain p1 + p2 so the test can exit cleanly.
    await Promise.resolve();
    await Promise.resolve();
    emitStockTurn(getController(), { text: "r1", sessionId: "sess-full" });
    await p1;
    await Promise.resolve();
    await Promise.resolve();
    emitStockTurn(getController(), { text: "r2", sessionId: "sess-full" });
    await p2;

    await handle.close();
  });

  it("abort-during-turn calls interrupt() and rejects within the 2s deadline", async () => {
    const { sdkMock, getController } = buildHarness();
    const handle = createPersistentSessionHandle(
      sdkMock as unknown as SdkModule,
      {},
      "sess-abort",
    );

    const controller = new AbortController();
    const p = handle.sendAndStream(
      "slow-msg",
      () => undefined,
      undefined,
      { signal: controller.signal },
    );

    // Let the handle push the user message and start awaiting the stream.
    await Promise.resolve();
    await Promise.resolve();

    // Abort BEFORE any message arrives. The handle should race interrupt()
    // and a 2s deadline; since the stream never produces a result, the
    // deadline path fires and throws an AbortError.
    const t0 = Date.now();
    controller.abort();

    // Expect the send to reject in under 2100ms.
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(2500);

    expect(getController().interrupt).toHaveBeenCalledTimes(1);
    await handle.close();
  });

  it("generator throw → onError fires and in-flight sendAndStream rejects", async () => {
    const { sdkMock, getController } = buildHarness();
    const handle = createPersistentSessionHandle(
      sdkMock as unknown as SdkModule,
      {},
      "sess-crash",
    );

    const errorHandler = vi.fn();
    handle.onError(errorHandler);

    const p = handle.sendAndStream("will-crash", () => undefined);
    await Promise.resolve();
    await Promise.resolve();

    // Simulate generator death.
    const crashErr = new Error("generator-dead");
    getController().throwFromGenerator(crashErr);

    await expect(p).rejects.toThrow(/generator-dead|crash/i);
    expect(errorHandler).toHaveBeenCalledTimes(1);
    expect(errorHandler.mock.calls[0]![0]).toBeInstanceOf(Error);
  });

  it("sdk.query options include resume + includePartialMessages", async () => {
    const { sdkMock } = buildHarness();
    createPersistentSessionHandle(
      sdkMock as unknown as SdkModule,
      { model: "sonnet" },
      "sess-opts",
    );
    const args = sdkMock.query.mock.calls[0]![0];
    expect(args.options.resume).toBe("sess-opts");
    expect(args.options.includePartialMessages).toBe(true);
    expect(args.options.model).toBe("sonnet");
    // prompt is an AsyncIterable (not a string) — streaming input mode.
    expect(typeof args.prompt[Symbol.asyncIterator]).toBe("function");
  });

  it("close() ends the input iterable and is idempotent", async () => {
    const { sdkMock, getController } = buildHarness();
    const handle = createPersistentSessionHandle(
      sdkMock as unknown as SdkModule,
      {},
      "sess-close",
    );
    await handle.close();
    await handle.close(); // idempotent
    expect(getController().close).toHaveBeenCalled();
    // Sends on a closed handle must throw.
    await expect(
      handle.sendAndStream("after-close", () => undefined),
    ).rejects.toThrow(/closed/i);
  });

  // ---------------------------------------------------------------------------
  // Quick task 260419-nic — public interrupt() + hasActiveTurn() primitives.
  // ---------------------------------------------------------------------------

  describe("interrupt() + hasActiveTurn() primitives", () => {
    it("A: handle exposes interrupt() and hasActiveTurn() on public surface", () => {
      const { sdkMock } = buildHarness();
      const handle = createPersistentSessionHandle(
        sdkMock as unknown as SdkModule,
        {},
        "sess-surface-abc",
      );
      expect(typeof handle.interrupt).toBe("function");
      expect(typeof handle.hasActiveTurn).toBe("function");
    });

    it("B: hasActiveTurn() returns false on a fresh handle (no send yet)", () => {
      const { sdkMock } = buildHarness();
      const handle = createPersistentSessionHandle(
        sdkMock as unknown as SdkModule,
        {},
        "sess-fresh",
      );
      expect(handle.hasActiveTurn()).toBe(false);
    });

    it("C: hasActiveTurn() returns true while sendAndStream awaits SDK, false after resolution", async () => {
      const { sdkMock, getController } = buildHarness();
      const handle = createPersistentSessionHandle(
        sdkMock as unknown as SdkModule,
        {},
        "sess-active",
      );

      const p = handle.sendAndStream("msg-C", () => undefined);
      // Two microticks for: (1) turnQueue.run slot install, (2) inputQueue.push +
      // iterateUntilResult entry awaiting driverIter.next().
      await Promise.resolve();
      await Promise.resolve();
      expect(handle.hasActiveTurn()).toBe(true);

      emitStockTurn(getController(), { text: "r-C", sessionId: "sess-active" });
      await p;
      expect(handle.hasActiveTurn()).toBe(false);

      await handle.close();
    });

    it("D: interrupt() with active turn fires q.interrupt() once; in-flight sendAndStream rejects with AbortError within 2500ms", async () => {
      const { sdkMock, getController } = buildHarness();
      const handle = createPersistentSessionHandle(
        sdkMock as unknown as SdkModule,
        {},
        "sess-interrupt-active",
      );

      const p = handle.sendAndStream("slow-msg", () => undefined);
      await Promise.resolve();
      await Promise.resolve();

      const t0 = Date.now();
      handle.interrupt();

      await expect(p).rejects.toMatchObject({ name: "AbortError" });
      const elapsed = Date.now() - t0;
      expect(elapsed).toBeLessThan(2500);

      expect(getController().interrupt).toHaveBeenCalledTimes(1);
      await handle.close();
    });

    it("E: interrupt() with no active turn is a no-op (does not call q.interrupt())", () => {
      const { sdkMock, getController } = buildHarness();
      const handle = createPersistentSessionHandle(
        sdkMock as unknown as SdkModule,
        {},
        "sess-interrupt-idle",
      );
      // No send() issued → no active turn.
      expect(handle.hasActiveTurn()).toBe(false);
      // Must not throw, must not call q.interrupt().
      expect(() => handle.interrupt()).not.toThrow();
      // Controller exists because sdk.query is called inside the handle
      // factory (drives the long-lived generator).
      expect(getController().interrupt).not.toHaveBeenCalled();
    });

    it("F: interrupt() is idempotent — two calls during the same turn fire q.interrupt() only once", async () => {
      const { sdkMock, getController } = buildHarness();
      const handle = createPersistentSessionHandle(
        sdkMock as unknown as SdkModule,
        {},
        "sess-interrupt-idempotent",
      );

      const p = handle.sendAndStream("slow-msg", () => undefined);
      await Promise.resolve();
      await Promise.resolve();

      handle.interrupt();
      handle.interrupt();
      handle.interrupt();

      await expect(p).rejects.toMatchObject({ name: "AbortError" });
      expect(getController().interrupt).toHaveBeenCalledTimes(1);

      await handle.close();
    });

    it("G: close() makes subsequent interrupt() a hard no-op", async () => {
      const { sdkMock, getController } = buildHarness();
      const handle = createPersistentSessionHandle(
        sdkMock as unknown as SdkModule,
        {},
        "sess-interrupt-after-close",
      );
      await handle.close();
      const countBefore = getController().interrupt.mock.calls.length;
      expect(() => handle.interrupt()).not.toThrow();
      expect(handle.hasActiveTurn()).toBe(false);
      expect(getController().interrupt.mock.calls.length).toBe(countBefore);
    });
  });
});
