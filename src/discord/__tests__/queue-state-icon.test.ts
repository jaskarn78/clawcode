/**
 * Phase 119 A2A-03 / D-04 — queue-state icon state machine.
 *
 * Pins the typed state machine semantics: per-channel mutex serialization,
 * 200ms debounce collapse, ≤3-attempt retry budget on Discord rate-limit
 * errors, sticky terminal states (DELIVERED/FAILED), and idempotent
 * same-state transitions.
 *
 * Discord-side visual verification (no double-emoji moment, transition
 * order on a real channel) is captured post-deploy via operator screenshot
 * — SC-3's operator-visual half (Plan 03 Task 3 checkpoint).
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  QUEUE_STATE_EMOJI,
  type DiscordChannelHandle,
  _resetQueueStateMemory,
  transitionQueueState,
} from "../queue-state-icon.js";

function makeHandle(): {
  handle: DiscordChannelHandle;
  addCalls: Array<[string, string, string]>;
  removeCalls: Array<[string, string, string]>;
  addImpl: { current: (emoji: string) => Promise<void> };
  removeImpl: { current: (emoji: string) => Promise<void> };
} {
  const addCalls: Array<[string, string, string]> = [];
  const removeCalls: Array<[string, string, string]> = [];
  const addImpl = { current: async (_emoji: string) => undefined };
  const removeImpl = { current: async (_emoji: string) => undefined };
  return {
    handle: {
      addReaction: async (c, m, e) => {
        addCalls.push([c, m, e]);
        await addImpl.current(e);
      },
      removeReaction: async (c, m, e) => {
        removeCalls.push([c, m, e]);
        await removeImpl.current(e);
      },
    },
    addCalls,
    removeCalls,
    addImpl,
    removeImpl,
  };
}

describe("transitionQueueState — state machine semantics", () => {
  beforeEach(() => {
    _resetQueueStateMemory();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("(a) QUEUED → IN_FLIGHT → DELIVERED — exact remove+add pairs in order", async () => {
    const { handle, addCalls, removeCalls } = makeHandle();
    const p1 = transitionQueueState("chan-1", "msg-1", "QUEUED", handle);
    await vi.advanceTimersByTimeAsync(250);
    await p1;
    const p2 = transitionQueueState("chan-1", "msg-1", "IN_FLIGHT", handle);
    await vi.advanceTimersByTimeAsync(250);
    await p2;
    const p3 = transitionQueueState("chan-1", "msg-1", "DELIVERED", handle);
    await vi.advanceTimersByTimeAsync(250);
    await p3;

    // QUEUED: no prior → addReaction only.
    // IN_FLIGHT: remove ⏳ then add 👍.
    // DELIVERED: remove 👍 then add ✅.
    expect(removeCalls.map((c) => c[2])).toEqual([
      QUEUE_STATE_EMOJI.QUEUED,
      QUEUE_STATE_EMOJI.IN_FLIGHT,
    ]);
    expect(addCalls.map((c) => c[2])).toEqual([
      QUEUE_STATE_EMOJI.QUEUED,
      QUEUE_STATE_EMOJI.IN_FLIGHT,
      QUEUE_STATE_EMOJI.DELIVERED,
    ]);
  });

  it("(b) concurrent calls on same channel serialize — no interleaving", async () => {
    const { handle, addCalls, removeCalls, addImpl } = makeHandle();
    // Slow down addReaction so we can observe serialization.
    const callOrder: string[] = [];
    addImpl.current = async (emoji) => {
      callOrder.push(`add:${emoji}:start`);
      await new Promise((r) => setTimeout(r, 50));
      callOrder.push(`add:${emoji}:end`);
    };
    // Fire 3 transitions without awaiting between them. With the 200ms
    // debounce, only the LATEST target survives the debounce window.
    const p1 = transitionQueueState("chan-1", "msg-1", "QUEUED", handle);
    const p2 = transitionQueueState("chan-1", "msg-1", "IN_FLIGHT", handle);
    const p3 = transitionQueueState("chan-1", "msg-1", "DELIVERED", handle);

    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all([p1, p2, p3]);

    // Only ONE add survives — the latest target (DELIVERED). The other
    // two should no-op out at the debounce gate. Serialization is also
    // visible: no add:X:start appears before the previous add:Y:end.
    expect(addCalls.length).toBe(1);
    expect(addCalls[0][2]).toBe(QUEUE_STATE_EMOJI.DELIVERED);
    // No prior state recorded → no remove call.
    expect(removeCalls.length).toBe(0);

    // Interleaving check — every start must be followed by its end before
    // the next start.
    for (let i = 0; i < callOrder.length; i += 2) {
      expect(callOrder[i]).toMatch(/:start$/);
      expect(callOrder[i + 1]).toMatch(/:end$/);
    }
  });

  it("(c) debounce — fire QUEUED then IN_FLIGHT within 50ms; IN_FLIGHT wins, one transition executed", async () => {
    const { handle, addCalls } = makeHandle();
    const p1 = transitionQueueState("chan-1", "msg-1", "QUEUED", handle);
    // Advance 50ms then fire IN_FLIGHT — still inside the 200ms window.
    await vi.advanceTimersByTimeAsync(50);
    const p2 = transitionQueueState("chan-1", "msg-1", "IN_FLIGHT", handle);
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all([p1, p2]);

    expect(addCalls.length).toBe(1);
    expect(addCalls[0][2]).toBe(QUEUE_STATE_EMOJI.IN_FLIGHT);
  });

  it("(d) rate-limit retry — addReaction throws 429 twice then succeeds; 3 attempts total", async () => {
    const { handle, addCalls, addImpl } = makeHandle();
    let attempts = 0;
    addImpl.current = async () => {
      attempts += 1;
      if (attempts <= 2) {
        // discord.js v14 rate-limit error shape.
        const err = new Error("Too Many Requests") as Error & {
          httpStatus: number;
          status: number;
        };
        err.httpStatus = 429;
        err.status = 429;
        throw err;
      }
    };
    const p = transitionQueueState("chan-1", "msg-1", "QUEUED", handle);
    // Advance generously to cover debounce + 200ms + 500ms backoff.
    await vi.advanceTimersByTimeAsync(3000);
    await p;

    expect(addCalls.length).toBe(3); // three attempts of the same emoji
    expect(addCalls.every((c) => c[2] === QUEUE_STATE_EMOJI.QUEUED)).toBe(true);
  });

  it("(e) rate-limit budget exceeded — 4 consecutive 429s → 3 attempts, give-up, state NOT updated", async () => {
    const { handle, addCalls, addImpl } = makeHandle();
    addImpl.current = async () => {
      const err = new Error("Too Many Requests") as Error & {
        httpStatus: number;
      };
      err.httpStatus = 429;
      throw err;
    };
    const p = transitionQueueState("chan-1", "msg-1", "QUEUED", handle);
    await vi.advanceTimersByTimeAsync(5000);
    await p;

    expect(addCalls.length).toBe(3);

    // After give-up, the next transition should attempt remove of NOTHING
    // (state never landed on QUEUED) → no remove call, just a new add.
    const { handle: handle2, addCalls: add2, removeCalls: rm2 } = makeHandle();
    // Re-wire the new handle into the second transition. State memory
    // persists across handles (it's per-channel, not per-handle).
    const p2 = transitionQueueState("chan-1", "msg-1", "IN_FLIGHT", handle2);
    await vi.advanceTimersByTimeAsync(1000);
    await p2;

    expect(rm2.length).toBe(0); // no prior emoji to remove
    expect(add2.length).toBe(1);
    expect(add2[0][2]).toBe(QUEUE_STATE_EMOJI.IN_FLIGHT);
  });

  it("(f) terminal sticky — DELIVERED state refuses further transitions", async () => {
    const { handle } = makeHandle();
    const p1 = transitionQueueState("chan-1", "msg-1", "DELIVERED", handle);
    await vi.advanceTimersByTimeAsync(500);
    await p1;

    const { handle: handle2, addCalls: add2, removeCalls: rm2 } = makeHandle();
    const p2 = transitionQueueState("chan-1", "msg-1", "IN_FLIGHT", handle2);
    await vi.advanceTimersByTimeAsync(500);
    await p2;

    expect(add2.length).toBe(0);
    expect(rm2.length).toBe(0);
  });

  it("(g) idempotent — same-state transition is a no-op", async () => {
    const { handle } = makeHandle();
    const p1 = transitionQueueState("chan-1", "msg-1", "QUEUED", handle);
    await vi.advanceTimersByTimeAsync(500);
    await p1;

    const { handle: handle2, addCalls: add2, removeCalls: rm2 } = makeHandle();
    const p2 = transitionQueueState("chan-1", "msg-1", "QUEUED", handle2);
    await vi.advanceTimersByTimeAsync(500);
    await p2;

    expect(add2.length).toBe(0);
    expect(rm2.length).toBe(0);
  });

  it("(h) different channels run in parallel — no cross-channel blocking", async () => {
    const { handle, addCalls, addImpl } = makeHandle();
    const startOrder: string[] = [];
    addImpl.current = async (emoji) => {
      startOrder.push(`${emoji}:start`);
      await new Promise((r) => setTimeout(r, 100));
      startOrder.push(`${emoji}:end`);
    };

    const pA = transitionQueueState("chan-A", "msg-1", "QUEUED", handle);
    const pB = transitionQueueState("chan-B", "msg-2", "IN_FLIGHT", handle);
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all([pA, pB]);

    expect(addCalls.length).toBe(2);
    // Both add calls' :start should appear before either :end —
    // confirming parallel execution across channels.
    const startsBeforeAnyEnd = startOrder.filter((s) =>
      s.endsWith(":start"),
    ).length;
    const firstEndIdx = startOrder.findIndex((s) => s.endsWith(":end"));
    expect(firstEndIdx).toBeGreaterThanOrEqual(2);
    expect(startsBeforeAnyEnd).toBe(2);
  });
});
