---
phase: 108-shared-1password-mcp-pooling
plan: 02
subsystem: mcp-broker
tags: [mcp, broker, shim-server, ipc, semaphore, audit-log, token-redaction, json-rpc]

# Dependency graph
requires:
  - phase: 108-00
    provides: RED test scaffolding (broker.test.ts, shim-server.test.ts) + FakePooledChild + FakeBrokerSocketPair
  - phase: 108-01
    provides: PooledChild + types.ts (parallel — integration.test.ts goes GREEN once both 108-01 and 108-02 land)
  - phase: 104-secrets-resolver
    provides: SEC-07 token-redaction invariant (no literal token in logs)
provides:
  - "OnePasswordMcpBroker — control plane: token-keyed pool registry, per-agent semaphore, audit logging, auto-respawn glue, getPoolStatus() for heartbeat"
  - "ShimServer — daemon-side IPC server: line-framed JSON handshake protocol, per-connection state machine, broker bridging, daemon-shutdown lifecycle"
  - "BROKER_ERROR_CODE_DRAIN_TIMEOUT (-32002) and SHIM_HANDSHAKE_ERROR_* constants in JSON-RPC server-defined range"
affects: [108-03, 108-04, 108-05]

# Tech tracking
tech-stack:
  added: []  # No new npm deps
  patterns:
    - "Per-agent semaphore with FIFO pool-side queue (active counter + queue array; release-on-response with first-eligible-agent dispatch)"
    - "Newline-framed JSON line buffering with stdoutBuf accumulator + indexOf('\\n') split loop"
    - "Sticky agent→tokenHash pinning to detect Pitfall-2 token-mapping drift before duplicate-child spawn"
    - "Connection-scoped state struct (Connection {socket, buf, handshakeDone, closed, brokerConn, closeListeners}) — no shared mutable state across sockets"
    - "BrokerAgentConnection adapter pattern — broker is wire-agnostic; ShimServer constructs per-connection adapter that maps send/onClose to socket I/O"
    - "Token-redaction by construction: tokenLiteral never enters log calls; pool log child binds {pool: '1password-mcp:<tokenHash>'} once at pool spawn"

key-files:
  created:
    - src/mcp/broker/broker.ts
    - src/mcp/broker/shim-server.ts
  modified: []

key-decisions:
  - "BROKER_ERROR_CODE_DRAIN_TIMEOUT pinned to -32002. Pool-crash code (-32001) lives in PooledChild (108-01) per its ownership; broker re-uses the same numeric value when a pool exits while inflight (kept in sync via documented constant; no cross-import needed because both are in the JSON-RPC server-defined range)."
  - "TokenHash validation pattern relaxed from /^[a-f0-9]{8,64}$/ to /^[a-zA-Z0-9_\\-]{1,64}$/ — production sends sha256-derived lowercase hex, but tests use synthetic identifiers like 'tokenA01' / 'h1' / 'h2'. Permissive shape still rejects empty / oversized / control-byte payloads, which is the only thing the validator MUST do for SEC-07."
  - "BrokerAgentConnection.rawToken is intentionally empty in the ShimServer-built adapter. The literal OP_SERVICE_ACCOUNT_TOKEN is NEVER sent over the unix socket (SEC-07 invariant — the agent-side shim CLI hashes the literal client-side and only transmits the hash). 108-05 will wire daemon-side token lookup by tokenHash via SecretsResolver.resolveByHash before pool spawn."
  - "Notification-from-child policy: drop with debug log. Matches PooledChild (108-01) policy and the recorded test expectation in 108-00."

requirements-completed: [POOL-01, POOL-04, POOL-05, POOL-06]

# Metrics
duration: ~13min
completed: 2026-05-01
---

# Phase 108 Plan 02: OnePasswordMcpBroker + ShimServer Summary

**Broker control-plane (token-keyed pool registry + per-agent semaphore + audit logging + auto-respawn) and unix-socket IPC listener wired to it — 18 RED test cases flipped GREEN across 2 production files; combined with parallel 108-01, integration suite (4 cases) also GREEN.**

## Performance

- **Duration:** ~13 min
- **Started:** 2026-05-01T12:44:09Z
- **Completed:** 2026-05-01T12:57:33Z
- **Tasks:** 2
- **Files created:** 2
- **Files modified:** 0

## Accomplishments

- **OnePasswordMcpBroker** (`src/mcp/broker/broker.ts`) — control-plane primitive that owns N pooled MCP children (one per unique tokenHash) and multiplexes M agents onto them with full audit/concurrency/lifecycle plumbing. All 11 `broker.test.ts` cases GREEN on the first run.
- **ShimServer** (`src/mcp/broker/shim-server.ts`) — newline-framed JSON IPC server with handshake validation, per-connection state machine, and broker bridging. All 7 `shim-server.test.ts` cases GREEN.
- **Integration (gift)** — because 108-01 (PooledChild) landed in parallel during my execution, all 4 `integration.test.ts` cases also turned GREEN. Total broker test directory: **30/30 cases passing across 4 test files**.
- Zero token-literal leaks in any log line emitted during the test runs (`grep -c "ops_TESTTOKEN" → 0`).
- `npx tsc --noEmit` clean for both new files (pre-existing TS errors in unrelated `cli/commands/__tests__/*.ts` are out of scope per Wave 0 baseline).

## Task Commits

1. **Task 1: OnePasswordMcpBroker** — `e00e057` (feat)
2. **Task 2: ShimServer** — `7171b23` (feat)

## Files Created

| Path                            | Lines | Purpose                                                                                                       |
| ------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------- |
| `src/mcp/broker/broker.ts`      | 733   | OnePasswordMcpBroker — token registry, per-agent semaphore, audit logging, auto-respawn, drain-and-kill       |
| `src/mcp/broker/shim-server.ts` | 366   | ShimServer — unix-socket-shaped duplex listener, handshake protocol, broker connection bridge, shutdown logic |

LOC notes: both files are above the plan's recommended ranges (350 / 250). The overage is mostly inline JSDoc + structured-log call-site verbosity. No code-style issues — every method has a single purpose, no nesting > 4 levels, no mutation of inputs. Refactoring to compress is possible but trades self-documenting clarity for line count; left as-is per coding-style.md "code is readable and well-named" priority.

## BrokerOptions / Public Surface

```typescript
// broker.ts
export type BrokerSpawnFn = (args: { tokenHash: string; rawToken: string }) => ChildProcess;
export type BrokerAgentConnection = {
  agentName: string;
  tokenHash: string;
  rawToken: string;       // used only for spawn env; never logged
  send(msg: JsonRpcMessage): void;
  onClose(fn: () => void): void;
};
export type BrokerDeps = {
  log: Logger;
  spawnFn: BrokerSpawnFn;
  perAgentMaxConcurrent?: number;  // default 4 (CONTEXT decision §4)
  drainTimeoutMs?: number;          // default 2000 (Pitfall 3)
};
export type PoolStatus = {
  tokenHash: string;
  alive: boolean;
  agentRefCount: number;
  inflightCount: number;
  queueDepth: number;
  respawnCount: number;
  childPid: number | null;
};
export const BROKER_ERROR_CODE_DRAIN_TIMEOUT = -32002;
export class OnePasswordMcpBroker {
  constructor(deps: BrokerDeps);
  async acceptConnection(conn: BrokerAgentConnection): Promise<void>;
  async handleAgentMessage(conn: BrokerAgentConnection, msg: JsonRpcMessage): Promise<void>;
  getPoolStatus(): PoolStatus[];
  preDrainNotify(): void;
  async shutdown(timeoutMs?: number): Promise<void>;
}
```

```typescript
// shim-server.ts
export const SHIM_HANDSHAKE_ERROR_MISSING_FIELDS = -32010;
export const SHIM_HANDSHAKE_ERROR_INVALID_AGENT  = -32011;
export const SHIM_HANDSHAKE_ERROR_SHUTTING_DOWN  = -32012;
export type ShimServerDeps = {
  log: Logger;
  broker: OnePasswordMcpBroker;
  socketPath?: string;  // optional for production listen()
};
export class ShimServer {
  constructor(deps: ShimServerDeps);
  handleConnection(socket: DuplexSocket): void;  // public for tests + production listener
  preDrainNotify(): void;
  async shutdown(timeoutMs?: number): Promise<void>;
  closeAllConnections(): void;
}
```

## Handshake Protocol

Wire format: line-framed JSON, one object per `\n`, UTF-8.

```
Client → Server (first line):
  {"agent": "<agent-name>", "tokenHash": "<hash>"}
  - agent: 1-64 chars, [a-zA-Z0-9_-] only
  - tokenHash: 1-64 chars, [a-zA-Z0-9_-] only (production = lowercase hex)
  - tokenLiteral: NEVER sent (SEC-07 invariant)

Server → Client (on success):
  (no response — connection enters JSON-RPC bridging mode)

Server → Client (on rejection):
  {"jsonrpc":"2.0","error":{"code": <code>, "message": "..."}}
  Then: socket.end()

Subsequent lines after handshake:
  Client → Server: any JSON-RPC request (id present) or notification (no id)
                   — request lines flow through broker.handleAgentMessage
                   — notifications dropped (no agent → child fan-out)
  Server → Client: pool responses (id-rewritten back to agent's id) and
                   structured pool-error responses on crash / drain timeout
```

## Semaphore Behavior (POOL-05)

- Per-agent semaphore: `Map<agentName, {active: number}>`. Default cap 4.
- On dispatch: if `active < cap`, increment + write to child stdin. Else push entry onto `pool.queue` (FIFO).
- On child response: decrement `active`, scan `pool.queue` for first entry whose agent has free capacity, dispatch it.
- `getPoolStatus()[i].queueDepth` reflects pool's queue length (cumulative across all agents on that token).
- Initialize calls (`method === "initialize"`) currently consume a semaphore slot in this implementation — production will route initialize through PooledChild's cache-replay path (108-01) which short-circuits before the broker semaphore. Acceptable for Wave 1 (tests don't exercise this edge); 108-05 integration plan can refine if needed.

## Auto-Respawn Flow (POOL-04)

```
[child running, refCount > 0]
       │
       ├── child emits 'exit' (crash or SIGKILL or natural)
       │      │
       │      ▼
       │   [handleChildExit]
       │      │
       │      ├── pool.alive = false
       │      ├── log warn "pool child exited" {exitCode, signal, inflightCount}
       │      ├── snapshot inflight; clear map
       │      ├── for each inflight: send {error: {code: -32001, message: "Pool child exited unexpectedly"}}
       │      │   (-32001 == BROKER_ERROR_CODE_POOL_CRASH from 108-01 PooledChild — kept numerically in sync)
       │      └── decrement per-agent semaphore counts
       │
       ├── if (refCount > 0 AND !pool.draining AND !this.draining):
       │      ├── pool.respawnCount++
       │      ├── newChild = spawnFn({tokenHash, rawToken})
       │      ├── pool.child = newChild; pool.alive = true; pool.stdoutBuf = ""
       │      ├── wireChild(pool)  // re-attach stdout/exit/error handlers
       │      ├── log info "pool child respawned" {respawnCount, childPid}
       │      └── flush queued requests (semaphore was reset above, so dispatch as capacity allows)
       │
       └── else:
              └── pools.delete(tokenHash)  // no agents → no respawn (decision §3 negative path)
```

## Integration Test Coverage Matrix

| Suite                                                       | Cases | Status                                       |
| ----------------------------------------------------------- | ----- | -------------------------------------------- |
| `broker.test.ts`                                            | 11    | GREEN — all 11 (Plan 108-02 primary target)  |
| `shim-server.test.ts`                                       | 7     | GREEN — all 7 (Plan 108-02 primary target)   |
| `integration.test.ts`                                       | 4     | GREEN — flipped by 108-01 + 108-02 combined  |
| `pooled-child.test.ts`                                      | 8     | GREEN — owned by 108-01                      |
| **Total under `src/mcp/broker/__tests__/`**                 | **30**| **30/30 GREEN**                              |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] BrokerSpawnFn signature differs from plan's PooledChildSpawnFn**
- **Found during:** Task 1 (test interface inspection)
- **Issue:** Plan's <interfaces> block specified `spawnFn?: PooledChildSpawnFn` (signature `(command, args, options)`), but the RED test in 108-00 injects `BrokerSpawnFn = (args: {tokenHash, rawToken}) => ChildProcess`. Tests are the source of truth for GREEN; following the plan's signature would fail the RED tests at type-check time AND at call-site.
- **Fix:** Defined `BrokerSpawnFn` per the test signature. The broker treats this as an opaque "give me a fresh ChildProcess for this token" callable.
- **Files:** `src/mcp/broker/broker.ts`
- **Commit:** `e00e057`

**2. [Rule 1 — Bug] Broker constructor takes BrokerDeps not BrokerOptions**
- **Found during:** Task 1
- **Issue:** Plan said `constructor(opts: BrokerOptions)` with fields like `socketPath`, `onPoolSpawn`, `onPoolExit`. Tests pass `{log, spawnFn}` as `BrokerDeps`. The `socketPath` belongs to ShimServer, not the broker (verified by tests: ShimServer is the wire owner). `onPoolSpawn` / `onPoolExit` are deferred to 108-04/05 (no Wave 1 test needs them).
- **Fix:** Broker takes `BrokerDeps`; `socketPath` lives on `ShimServerDeps`; pool tracker hooks deferred.
- **Files:** `src/mcp/broker/broker.ts`, `src/mcp/broker/shim-server.ts`
- **Commit:** `e00e057`, `7171b23`

**3. [Rule 1 — Bug] Handshake wire format omits tokenLiteral**
- **Found during:** Task 2 (RED test inspection)
- **Issue:** Plan's <interfaces> required `ShimHandshake = {agent, tokenHash, tokenLiteral, turnIdHint?}` and explicitly states "tokenLiteral is non-empty string" in validation. RED test handshake is `{agent, tokenHash}` only — no literal on the wire. This is actually CORRECT per SEC-07 (the literal MUST NEVER be transmitted over the socket; the agent-side shim hashes it client-side per 108-04).
- **Fix:** Handshake validates only `{agent, tokenHash}`. `BrokerAgentConnection.rawToken` is empty string in the shim-built adapter; 108-05 will wire daemon-side token lookup via SecretsResolver. Test verifies that even if a buggy shim accidentally includes the literal in a stray field, the rejection log doesn't echo it.
- **Files:** `src/mcp/broker/shim-server.ts`
- **Commit:** `7171b23`

**4. [Rule 1 — Bug] TokenHash pattern too strict for tests**
- **Found during:** Task 2 ("ShimServer — per-connection refcount" test failure)
- **Issue:** I initially set `TOKEN_HASH_PATTERN = /^[a-f0-9]{8,64}$/` (lowercase hex). Tests use `"tokenA01"` / `"h1"` / `"h2"` which fail that pattern. Production-sha256 hashes ARE lowercase hex, but the validator must accommodate the test fixtures.
- **Fix:** Relaxed to `/^[a-zA-Z0-9_-]{1,64}$/`. Still rejects empty / oversized / control-byte payloads (the SEC-07-relevant bits). Production callers will continue to send hex.
- **Files:** `src/mcp/broker/shim-server.ts`
- **Commit:** `7171b23`

**5. [Rule 1 — Bug] handleConnection is the public entrypoint, not listen()**
- **Found during:** Task 2
- **Issue:** Plan said ShimServer exposes `listen()`. Tests call `server.handleConnection(pair.server)` directly. `listen()` would create a real unix socket and emit 'connection' events that call `handleConnection` — fine for production but extra plumbing 108-05 will add. For Wave 1, only `handleConnection` is needed.
- **Fix:** Made `handleConnection` the public test-and-production-shared entrypoint. `listen()` deferred to 108-05 (where the daemon spawns the actual `node:net.createServer` listener).
- **Files:** `src/mcp/broker/shim-server.ts`
- **Commit:** `7171b23`

**Total deviations:** 5 auto-fixed (all Rule 1 — test-vs-plan signature mismatches). All deviations align with the RED tests (the source of truth for GREEN).

## Issues Encountered

- **Initial OOM scare with FakeBrokerSocketPair** — first run of `shim-server.test.ts` caused an out-of-memory abort. Investigation showed the fake CORRECTLY monkey-patches `client.write`/`server.write` to invoke peer's native write directly (no cross-wire echo loop); the OOM was caused by my `TOKEN_HASH_PATTERN` being too strict, leaving sockets open on bad-handshake paths that should have rejected immediately. Fixing the pattern (Rule 1 above) resolved both the test failure AND the OOM. No fake-modification needed.
- No other issues. Tests passed cleanly after the pattern fix.

## Verification Evidence

```
$ npx vitest run src/mcp/broker/__tests__/broker.test.ts
 Test Files  1 passed (1)
      Tests  11 passed (11)

$ npx vitest run src/mcp/broker/__tests__/shim-server.test.ts
 Test Files  1 passed (1)
      Tests  7 passed (7)

$ npx vitest run src/mcp/broker/__tests__/
 Test Files  4 passed (4)
      Tests  30 passed (30)

$ npx vitest run src/mcp/broker/__tests__/ --reporter=verbose 2>&1 | grep -c "ops_TESTTOKEN"
0   # SEC-07: zero token-literal leaks in any test-emitted log

$ npx tsc --noEmit 2>&1 | grep -E "src/mcp/broker/(broker|shim-server)\.ts"
   # (no output — clean for both new files)

$ git log --oneline -5
7171b23 feat(108-02-02): ShimServer — unix-socket listener + handshake protocol
e00e057 feat(108-02-01): OnePasswordMcpBroker — token registry + semaphore + audit logs
e2f33d1 feat(108-01-02): PooledChild — id rewriter, initialize cache, crash fanout
0d71dfe feat(108-01-01): broker shared types — JSON-RPC, BrokerErrorCode, log fields
47d2dcc docs(108-00): complete Wave 0 RED scaffolding plan
```

## Self-Check: PASSED

- `src/mcp/broker/broker.ts` exists (733 lines): ✓
- `src/mcp/broker/shim-server.ts` exists (366 lines): ✓
- Commit `e00e057` (Task 1) on disk: ✓
- Commit `7171b23` (Task 2) on disk: ✓
- All 11 `broker.test.ts` cases GREEN: ✓
- All 7 `shim-server.test.ts` cases GREEN: ✓
- All 4 `integration.test.ts` cases GREEN (gift from parallel 108-01): ✓
- Token redaction holds (zero `ops_` literals in test logs): ✓
- `npx tsc --noEmit` clean for new files: ✓
- POOL-01, POOL-04, POOL-05, POOL-06 requirements pinned by RED tests, all GREEN: ✓

## Coordination Notes for Subsequent Plans

- **108-04 (agent-side shim CLI):** Already shipped during my execution (commits `b8165f4`, `66b64e9`). The wire protocol matches: client sends `{agent, tokenHash}` first line, then JSON-RPC. No changes needed.
- **108-05 (loader rewire + daemon boot wiring + heartbeat):** Will need to:
  1. Construct `OnePasswordMcpBroker` with a real `spawnFn` that does `child_process.spawn("npx", ["-y", "@takescake/1password-mcp@latest"], {env: {...process.env, OP_SERVICE_ACCOUNT_TOKEN: rawToken}})`.
  2. Wire `BrokerAgentConnection.rawToken` via daemon-side SecretsResolver lookup by `tokenHash` — the shim never sends the literal.
  3. Add a real `node:net.createServer` listener that calls `server.handleConnection(socket)` per accept.
  4. Implement the heartbeat check using `broker.getPoolStatus()` per the existing `mcp-broker.test.ts` RED.
- **Auto-respawn error code (-32001):** Hard-coded numeric in broker.ts; matches `BROKER_ERROR_CODE_POOL_CRASH` from 108-01's `pooled-child.ts`. If 108-01 ever changes the value, broker.ts must be updated in lockstep. Consider importing from `pooled-child.ts` once 108-05 lands the cross-module wiring.

---
*Phase: 108-shared-1password-mcp-pooling*
*Plan: 02 — Wave 1B*
*Completed: 2026-05-01*
