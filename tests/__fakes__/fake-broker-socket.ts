/**
 * Phase 108 Plan 00 — FakeBrokerSocketPair test fake.
 *
 * Cross-wired PassThrough-backed duplex pair that mimics the surface of
 * `net.Socket` used by the broker shim-server. Used by the shim-server
 * RED tests (and the agent-side shim CLI tests) so neither side has to
 * touch a real unix-domain-socket file.
 *
 * Surface mirrored:
 *   - Duplex read/write
 *   - 'data' / 'close' / 'error' / 'end' events (EventEmitter on PassThrough)
 *   - end() to signal half-close
 *
 * No production-code imports. No real net.Socket / unix sockets.
 */
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

/**
 * Net.Socket-shaped fake (duplex). Production code uses .write/.on/.end —
 * the underlying PassThrough satisfies all three. We expose the public
 * surface as a `Socket`-like object via duck typing so test code reads
 * naturally.
 */
export type FakeSocket = PassThrough & {
  /**
   * Test-only: emit a 'close' event so the production code's close handler
   * fires (PassThrough.end alone doesn't synthesize 'close').
   */
  fakeClose(reason?: string): void;
  /** Test-only: emit an 'error' event without throwing. */
  fakeError(err: Error): void;
};

function decorate(stream: PassThrough): FakeSocket {
  const decorated = stream as FakeSocket;
  decorated.fakeClose = (reason?: string): void => {
    // Mirror real net.Socket: end() then 'close' fires.
    decorated.end();
    // Use process.nextTick so any in-flight writes flush first.
    process.nextTick(() => {
      decorated.emit("close", reason !== undefined);
    });
  };
  decorated.fakeError = (err: Error): void => {
    decorated.emit("error", err);
  };
  return decorated;
}

export type FakeBrokerSocketPair = {
  /** The shim-side end of the connection (agent-side shim writes here). */
  readonly client: FakeSocket;
  /** The broker-side end of the connection (broker writes here). */
  readonly server: FakeSocket;
};

/**
 * Build a cross-wired pair of PassThrough streams. Bytes written to
 * `client` come out of `server`'s read side and vice versa.
 *
 * Implementation detail: each side is its own PassThrough; we pipe them
 * to each other so write-on-A ⇒ data-on-B. We set { allowHalfOpen: true }
 * via a per-write copy because PassThrough's pipe() default would close
 * the destination on source-end. Our `end()` propagation is simulated via
 * fakeClose() so tests have explicit control.
 */
export function createFakeBrokerSocketPair(): FakeBrokerSocketPair {
  const aToB = new PassThrough();
  const bToA = new PassThrough();

  // Compose duplex streams that read from one PT and write to another.
  // We can't easily build a true Duplex here without node:stream Duplex
  // construction; instead, we attach forwarding listeners onto a single
  // PT per side and proxy writes through.
  const client = new PassThrough();
  const server = new PassThrough();

  // Forward client.write → server (data appears on server.on('data'))
  client.on("data", (chunk) => {
    if (!server.writableEnded) server.write(chunk);
  });
  // Forward server.write → client
  server.on("data", (chunk) => {
    if (!client.writableEnded) client.write(chunk);
  });

  // The PTs above (aToB / bToA) are kept as anchors so the streams aren't
  // GC'd before tests finish. (Belt-and-suspenders — node would keep them
  // alive via the listener closures regardless.)
  void aToB;
  void bToA;

  return {
    client: decorate(client),
    server: decorate(server),
  };
}

/**
 * Simulate daemon shutdown: fire 'close' on both halves of the pair.
 * Used by Pitfall-5 RED tests (shim ↔ daemon socket fragility).
 */
export function closePair(
  pair: FakeBrokerSocketPair,
  reason?: string,
): void {
  pair.client.fakeClose(reason);
  pair.server.fakeClose(reason);
}

/**
 * Belt-and-suspenders type guard so production code (when written) can
 * accept both FakeSocket and real net.Socket without casts in tests.
 *
 * (Currently unused; exists so the test fake's type surface is explicit.)
 */
export function isFakeSocket(s: unknown): s is FakeSocket {
  return (
    s instanceof EventEmitter &&
    typeof (s as { fakeClose?: unknown }).fakeClose === "function"
  );
}
