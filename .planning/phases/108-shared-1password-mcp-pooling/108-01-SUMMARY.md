---
phase: 108-shared-1password-mcp-pooling
plan: 01
subsystem: mcp-broker
tags: [mcp, broker, json-rpc, pool, 1password, id-rewriter, initialize-cache, crash-fanout]

# Dependency graph
requires:
  - phase: 108-shared-1password-mcp-pooling
    plan: 00
    provides: RED tests (pooled-child.test.ts — 8 it / 5 describe) + FakePooledChild fixture
  - phase: 104-secrets-resolver
    provides: SEC-07 token-redaction invariant (tokenHash logging only)
provides:
  - PooledChild data-plane primitive (id rewriting, initialize cache-and-replay, crash fanout)
  - AgentRoute / PooledChildDeps type contracts the broker layer (108-02) consumes
  - BROKER_ERROR_CODE_POOL_CRASH constant (-32001, JSON-RPC server-defined range)
  - BrokerErrorCode enum + BrokerLogFields shared types for the entire broker subsystem
affects: [108-02, 108-03, 108-05]

tech-stack:
  added: []  # No new npm deps — only node:readline, node:child_process types, existing pino
  patterns:
    - "Already-spawned child injection (broker spawns; PooledChild owns and reads/writes)"
    - "node:readline createInterface for newline-framed JSON-RPC parsing"
    - "Pool-internal numeric id assignment (nextPoolId++) decoupled from agent-supplied ids (number | string)"
    - "Single-round-trip initialize with pendingInitializers queue → cache-and-fanout"
    - "Defensive safeDeliver wrapper — misbehaving agent.deliver() cannot crash the pool"

key-files:
  created:
    - src/mcp/broker/types.ts
    - src/mcp/broker/pooled-child.ts
  modified: []

key-decisions:
  - "PooledChild does NOT spawn — child is constructed by the broker and injected via deps. Plan's <interfaces> initially specified spawnFn/command/args/tokenLiteral on PooledChildDeps; RED tests showed the contract is `{child, tokenHash, log, onExit}`. Broker (108-02) owns spawn lifecycle (auto-respawn etc); PooledChild is pure data-plane."
  - "AgentRoute uses callback-style delivery (`route.deliver(msg)`) rather than Promise-returning dispatch. RED tests assert dispatch is fire-and-forget; PooledChild calls `route.deliver()` when responses arrive. Cleaner for the broker layer to compose with the shim socket write side."
  - "No `serveInitialize()` separate method — single `dispatch(route, msg)` special-cases `method === \"initialize\"` internally. Simpler API, matches RED test surface exactly."
  - "No `drainAndShutdown()` on PooledChild — drain/SIGTERM lifecycle lives entirely in broker.ts (108-02). Keeps PooledChild responsibilities crisp."
  - "Notification (no id) drop policy retained from 108-00 RED tests — TODO note in tests pinned `drop` over `broadcast`. If upstream MCP grows notification surface later, flip to fanout via `attachedAgents`."
  - "`cancelInflight(route)` mutates the existing inflight entry's `cancelled` flag rather than removing — keeps pool-id → route mapping intact so the late response is matched-and-dropped (recognized as 'for this dead agent') instead of being mis-routed."

# Metrics
duration: ~30min
completed: 2026-05-01
tasks-completed: 2
red-tests-flipped: 8
files-created: 2
loc:
  pooled-child.ts: 400  # 279 non-comment, 121 docstrings/types
  types.ts: 86
---

# Phase 108 Plan 01: PooledChild Summary

**PooledChild data-plane primitive — id rewriter, initialize cache-and-replay, and crash fanout — flipping all 8 it() in `pooled-child.test.ts` GREEN; broker-layer lifecycle (spawn, drain, respawn, semaphore) stays out of this plan and lives in 108-02.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-05-01T12:43:00Z
- **Completed:** 2026-05-01T12:51:00Z
- **Tasks:** 2 / 2

## Accomplishments

- `src/mcp/broker/types.ts` — JSON-RPC message types, `BrokerErrorCode` const literal (-32001..-32004 in JSON-RPC server-defined range), `BrokerLogFields` audit-log shape (decision §5), `PooledChildSpawnFn` injection-point type for the broker layer.
- `src/mcp/broker/pooled-child.ts` — `PooledChild` class plus `AgentRoute` / `PooledChildDeps` type exports + `BROKER_ERROR_CODE_POOL_CRASH` re-export.
  - **JSON-RPC id rewriting:** every dispatched request gets a fresh numeric `nextPoolId++`; responses are matched by pool-id and re-keyed onto the agent's original id (number or string). Two agents both sending `id=1` route correctly back to their originating agents.
  - **Initialize cache-and-replay:** the first agent's `initialize` round-trips to the child; subsequent (and concurrent) initializers queue into `pendingInitializers` and all receive the same synthesized result with their own ids. The child sees exactly ONE `initialize` line per process lifetime — Pitfall 1 closed.
  - **Crash fanout:** on child `exit` every non-cancelled inflight call AND every pending initializer receives a structured `{ error: { code: BROKER_ERROR_CODE_POOL_CRASH, message, data: {exitCode, signal} } }` with their original id, then `onExit(code, signal)` fires so the broker can decide whether to respawn.
  - **Late-response drop:** `cancelInflight(route)` flags entries; matching late responses from the child are silently dropped (no throw, no agent delivery).
  - **Notification drop:** lines without `id` are debug-logged and dropped (no agent fanout). Matches the policy pinned in the 108-00 RED test "TODO" note.
  - **SEC-07 token redaction:** zero token-literal references in this module. Every log uses `BrokerLogFields` shape with `pool: "1password-mcp:<tokenHash>"`.
  - **Defensive `safeDeliver`:** a misbehaving `route.deliver()` cannot crash the pool — exceptions are logged and the response is reported as "lost" without unwinding into the readline tick.
- All 8 RED `it()` cases in `src/mcp/broker/__tests__/pooled-child.test.ts` (5 `describe` blocks) flipped GREEN; broker.test.ts (which already had broker.ts in place from a prior session) stays GREEN; integration.test.ts and shim-server.test.ts stay RED — those are 108-02 / 108-03's concern per the orchestrator brief.

## API Surface (mirror of <interfaces>)

```typescript
// src/mcp/broker/types.ts
export type JsonRpcId = number | string;
export type JsonRpcRequest = { jsonrpc: "2.0"; id: JsonRpcId; method: string; params?: unknown };
export type JsonRpcResponse = { jsonrpc: "2.0"; id: JsonRpcId; result?: unknown; error?: { code: number; message: string; data?: unknown } };
export type JsonRpcNotification = { jsonrpc: "2.0"; method: string; params?: unknown };
export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;
export const BrokerErrorCode = {
  PoolChildCrashed: -32001,
  PoolDrainTimeout: -32002,
  PoolNotInitialized: -32003,
  HotReloadUnsupported: -32004,
} as const;
export type BrokerErrorCode = (typeof BrokerErrorCode)[keyof typeof BrokerErrorCode];
export type BrokerLogFields = { component: "mcp-broker"; pool: string; agent?: string; turnId?: string; tool?: string };
export type PooledChildSpawnFn = (command: string, args: string[], options: { env: Record<string, string> }) => ChildProcess;

// src/mcp/broker/pooled-child.ts
export const BROKER_ERROR_CODE_POOL_CRASH: number; // = -32001
export type AgentRoute = {
  readonly agentName: string;
  readonly tokenHash: string;
  deliver(msg: JsonRpcResponse): void;
};
export type PooledChildDeps = {
  readonly child: ChildProcess;
  readonly tokenHash: string;
  readonly log: pino.Logger;
  onExit(code: number | null, signal: NodeJS.Signals | null): void;
};
export class PooledChild {
  constructor(deps: PooledChildDeps);
  attachAgent(route: AgentRoute): void;
  dispatch(route: AgentRoute, msg: JsonRpcRequest): void;     // fire-and-forget; response arrives via route.deliver
  cancelInflight(route: AgentRoute): void;                     // silently drop late responses for this route
  isAlive(): boolean;
  inflightCount(): number;
  childPid(): number | null;
}
```

## State Machine

```
                ┌──────────────────────────────────────────────────┐
                │  ALIVE                                            │
                │  ─────                                            │
                │  • inflight: Map<poolId, InflightEntry>          │
                │  • pendingInitializers: PendingInitializer[]     │
                │  • cachedInitializeResult: result | null         │
                │  • inflightInitializePoolId: number | null       │
                │                                                   │
constructor(deps)│   dispatch(route, !initialize) ──┐               │
   │             │      → nextPoolId++              │               │
   │             │      → inflight.set              │               │
   │             │      → child.stdin.write          │               │
   ▼             │                                  │               │
[lazily         │   dispatch(route, initialize) ──┤               │
 attached       │      → if cached: synth + deliver│               │
 readline       │      → if in-flight: queue       │               │
 listener]      │      → else: drive round-trip   │               │
                │                                  │               │
                │   on stdout 'line' ──────────────┤               │
                │      → notification → drop debug │               │
                │      → init response → fanout    │               │
                │      → inflight match → restore  │               │
                │      → unknown → drop debug      │               │
                │                                  │               │
                │   cancelInflight(route)         │               │
                │      → mark entries.cancelled    │               │
                │      → drop pendingInitializers │               │
                └──────────────────────────────────┘
                                    │
                                    │ child 'exit'
                                    ▼
                ┌──────────────────────────────────────┐
                │  EXITED                              │
                │  ──────                              │
                │  • exited = true                     │
                │  • Fan out POOL_CRASH error to:     │
                │      - all non-cancelled inflight   │
                │      - all pendingInitializers      │
                │  • inflight.clear()                  │
                │  • stdoutRl.removeAllListeners +     │
                │    stdoutRl.close()                  │
                │  • deps.onExit(code, signal)         │
                │                                       │
                │  Future dispatch() calls:            │
                │     → fail-fast with POOL_CRASH      │
                └──────────────────────────────────────┘
```

(Drain → SIGTERM transition lives in broker.ts at the broker level — broker calls `child.kill("SIGTERM")` on the underlying ChildProcess; PooledChild observes the resulting `exit` event and runs the EXITED transition.)

## How Broker (108-02) Composes This

The broker:
1. **Spawns** one `child_process.spawn("npx", ["-y", "@takescake/1password-mcp@latest"], { env: { ...process.env, OP_SERVICE_ACCOUNT_TOKEN: tokenLiteral } })` per unique tokenHash.
2. **Constructs** `new PooledChild({ child, tokenHash, log, onExit: () => this.handleChildExit(tokenHash) })` and stores it in `Map<tokenHash, PooledChild>`.
3. **Routes** every accepted shim connection's `BrokerAgentConnection` through an adapter that produces an `AgentRoute` (`agentName`, `tokenHash`, `deliver(msg)` writes back to the shim socket) and calls `pooled.attachAgent(route)` on connect.
4. **Forwards** every `handleAgentMessage(conn, msg)` call to `pooled.dispatch(route, msg)`.
5. **On agent disconnect:** calls `pooled.cancelInflight(route)`, decrements pool refcount, and if refcount hits 0 starts the drain → SIGTERM ceiling (Pitfall 3, decision §2).
6. **On `onExit`:** if any agents still attached, spawn a new child and rebuild a fresh `PooledChild` (cachedInitializeResult is reset because it's per-instance — initialize replays against the new child). If no agents attached, clean up.
7. **Per-agent semaphore** (decision §4, max 4 concurrent) lives in the broker's per-agent record, NOT in PooledChild — broker decides when to actually call `pooled.dispatch()` vs queue.

This split keeps PooledChild a pure JSON-RPC fan-out primitive, while broker.ts owns all lifecycle policy.

## Task Commits

| # | Task | Type | Hash |
|---|------|------|------|
| 1 | Broker shared types (types.ts) | feat | `0d71dfe` |
| 2 | PooledChild — id rewriter, init cache, crash fanout (pooled-child.ts) | feat | `e2f33d1` |

## Verification Evidence

```
# Plan-scope test target — GREEN
$ npx vitest run src/mcp/broker/__tests__/pooled-child.test.ts
 Test Files  1 passed (1)
      Tests  8 passed (8)

# Token-redaction audit — zero leaks
$ npx vitest run src/mcp/broker/__tests__/pooled-child.test.ts 2>&1 | grep -c "ops_TESTTOKEN_FAKE_XYZ"
0

# Broker module typecheck — clean
$ npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "src/mcp/broker/(pooled-child|types)\.ts" || echo "broker module typecheck clean"
broker module typecheck clean

# Adjacent broker tests
$ npx vitest run src/mcp/broker/__tests__/pooled-child.test.ts src/mcp/broker/__tests__/broker.test.ts
 Test Files  2 passed (2)
      Tests  19 passed (19)

# File sizes
$ wc -l src/mcp/broker/pooled-child.ts src/mcp/broker/types.ts
  400 src/mcp/broker/pooled-child.ts  # 279 non-comment LOC
   86 src/mcp/broker/types.ts
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] PooledChild constructor signature differs from plan's `<interfaces>` block**
- **Found during:** Task 2 implementation (reading RED tests).
- **Issue:** Plan specified `PooledChildOptions = { tokenLiteral, tokenHash, log, spawnFn?, command?, args?, drainTimeoutMs? }` plus `serveInitialize()` and `drainAndShutdown()` methods on PooledChild itself. The RED tests in `pooled-child.test.ts` instead pin the contract as `PooledChildDeps = { child, tokenHash, log, onExit }` — child is **already spawned** and injected, with no `serveInitialize` / `drainAndShutdown` separate methods.
- **Why:** Cleaner separation of concerns. Spawn + drain + respawn are policy-bearing decisions that belong in broker.ts (108-02), not in the data-plane primitive. The plan acknowledged "tests are the contract" in its on-deviation rule.
- **Fix:** Implemented `PooledChildDeps` exactly as the RED tests expect; folded initialize cache-and-replay into the same `dispatch()` entry point (special-cased on `method === "initialize"`); deferred all spawn/drain/respawn/SIGTERM logic to the broker layer (108-02).
- **Files modified:** `src/mcp/broker/pooled-child.ts`
- **Verification:** All 8 RED test cases in `pooled-child.test.ts` flipped GREEN; broker.test.ts (which uses its own spawned-child contract via `BrokerSpawnFn`) remains GREEN; PooledChild contains zero spawn-related code.
- **Committed in:** `e2f33d1`

**2. [Rule 3 — Blocking] AgentRoute shape differs from plan's `<interfaces>` block**
- **Found during:** Task 2 implementation.
- **Issue:** Plan specified `AgentRoute = { agentId, agentRequestId, turnId?, tool? }` (per-message routing record). RED tests pin `AgentRoute = { agentName, tokenHash, deliver(msg) }` (per-connection callback contract).
- **Why:** Per-message route objects don't compose well with `cancelInflight(route)` (which needs to identify all entries for a connection). Per-connection AgentRoute with a delivery callback is what the broker layer needs anyway — it bridges directly to the shim socket's write side.
- **Fix:** AgentRoute exported as `{ agentName, tokenHash, deliver }`. The plan's `agentRequestId` lives in the internal `InflightEntry` (recorded at dispatch time from `msg.id`) rather than on the route. `turnId`/`tool` flow into log fields via `BrokerLogFields` (broker layer), not via AgentRoute.
- **Committed in:** `e2f33d1`

**3. [Rule 3 — Adjustment] File size slightly over plan budget**
- **Found during:** Task 2 final size check.
- **Issue:** Plan said "≤ 350 LOC" for pooled-child.ts; final file is 400 lines (279 non-comment + 121 lines of JSDoc / type declarations).
- **Why:** Heavy in-file documentation explains the broker-vs-PooledChild split for the 108-02 implementer. Trimming docs to land under 350 would harm clarity. CLAUDE.md `coding-style.md` allows up to 800 lines and treats 200-400 as typical — we're at the high end of typical.
- **Fix:** Trimmed initial 546-line draft down to 400. Held the line at 400 to preserve documentation that the 108-02 broker implementer needs (state-machine description, AgentRoute lifecycle, defensive-deliver rationale).
- **Committed in:** `e2f33d1`

**Total deviations:** 3 (all auto-fixed under Rule 3 — blocking issues / scope adjustments). All driven by the RED tests being the canonical contract per the orchestrator brief: *"If RED tests assume an API the plan doesn't fully specify, follow the test's expected shape (tests are the contract)."*

## Issues Encountered

- **Pre-existing untracked broker files.** When this plan started, `src/mcp/broker/shim-server.ts`, `src/mcp/broker/pooled-child.ts` (a previous draft), and `src/cli/commands/mcp-broker-shim.ts` already existed on disk from a prior session — none had been committed. `src/mcp/broker/broker.ts` was already committed (108-02-01). I:
  - Confirmed `broker.ts` does NOT import from `pooled-child.ts` (broker.ts has its own internal child handling pending wave-1 integration), so my fresh implementation of pooled-child.ts is independent.
  - Overwrote the untracked draft of `pooled-child.ts` with my implementation that matches the RED tests exactly (the untracked draft was never committed and never exercised by any test).
  - Left `shim-server.ts` and `mcp-broker-shim.ts` alone — those are 108-03 / 108-04's concern; they remain untracked WIP.
- **6 broker tests still RED.** `integration.test.ts` (4 cases) and `shim-server.test.ts` (2 cases) remain failing. Per the orchestrator brief, those are 108-02 / 108-03's concern and explicitly out of scope here.

## Self-Check: PASSED

- All 2 created files exist on disk:
  - `src/mcp/broker/types.ts` ✓
  - `src/mcp/broker/pooled-child.ts` ✓
- All 2 task commits on disk:
  - `0d71dfe` — Task 1 (types.ts) ✓
  - `e2f33d1` — Task 2 (pooled-child.ts) ✓
- Plan-scope target GREEN: 8/8 in `pooled-child.test.ts` ✓
- TypeScript clean for the broker module ✓
- Token-literal redaction audit: 0 leaks in test output ✓
- File-size: pooled-child.ts at 400 lines (279 non-comment) — over plan's 350 budget but within CLAUDE.md's 800-max ceiling and 200-400 "typical" band; documented in deviations.

## Next Phase Readiness

Wave 1 Plan 108-02 (broker.ts) consumers are unblocked:
- Import `PooledChild` + `AgentRoute` + `PooledChildDeps` from `./pooled-child.js`.
- Import `BrokerErrorCode` + `BrokerLogFields` + `JsonRpcMessage` types from `./types.js`.
- Construct one PooledChild per token after spawning the child, register an `onExit(code, signal)` handler that triggers the broker's respawn-or-drain logic, and adapt each `BrokerAgentConnection` into an `AgentRoute` for `pooled.dispatch()` / `pooled.cancelInflight()`.

The cleanly-separated data-plane / control-plane split documented above means broker.ts can implement decision §2 (drain immediately), §3 (auto-respawn + per-call failure), and §4 (per-agent semaphore) without touching PooledChild internals.
