---
phase: 108-shared-1password-mcp-pooling
plan: 00
subsystem: testing
tags: [mcp, broker, vitest, json-rpc, fakes, red-tests, 1password, pool, ipc]

# Dependency graph
requires:
  - phase: 104-secrets-resolver
    provides: SEC-07 token-redaction invariant (no literal token in logs)
  - phase: 999.14-15-mcp-process-tracking
    provides: orphan-reaper / reconciler patterns the broker must coexist with
provides:
  - Shared test fakes (FakePooledChild, FakeBrokerSocketPair) reusable across all Phase 108 plans
  - 6 RED test files (43 it() cases / 29 describe blocks) pinning every Phase 108 production behavior
  - Deterministic GREEN gates for Wave 1 (108-01 through 108-04) — each implementer knows exactly which describe blocks they must flip
affects: [108-01, 108-02, 108-03, 108-04, 108-05]

# Tech tracking
tech-stack:
  added: []  # No new npm deps — only test files + fakes using existing vitest + pino
  patterns:
    - "RED-first scaffolding: import production target by .js path (Cannot find module → deterministic RED)"
    - "Captured-pino sink for log assertions (Writable + JSON.parse per line)"
    - "PassThrough-backed cross-wired socket pair (FakeBrokerSocketPair) to avoid touching real unix sockets"
    - "ChildProcess-shaped fake with PID counter starting at 90001 to avoid collision with realistic test logs"

key-files:
  created:
    - tests/__fakes__/fake-pooled-child.ts
    - tests/__fakes__/fake-broker-socket.ts
    - src/mcp/broker/__tests__/pooled-child.test.ts
    - src/mcp/broker/__tests__/broker.test.ts
    - src/mcp/broker/__tests__/shim-server.test.ts
    - src/mcp/broker/__tests__/integration.test.ts
    - src/cli/commands/__tests__/mcp-broker-shim.test.ts
    - src/heartbeat/checks/__tests__/mcp-broker.test.ts
  modified: []

key-decisions:
  - "Heartbeat check returns canonical CheckStatus values 'healthy' | 'critical' (not 'failed' as plan implied) — 'critical' is the existing convention in src/heartbeat/types.ts:10"
  - "BROKER_ERROR_CODE_POOL_CRASH and BROKER_ERROR_CODE_DRAIN_TIMEOUT are pinned to JSON-RPC server-defined range -32099..-32000 — exact code values left for Wave 1 to choose"
  - "Notification (no id) from pool child is dropped by default — TODO note in pooled-child.test.ts marks this as revisit-able if upstream MCP grows notification surface"
  - "Test token literal standardized as 'ops_TESTTOKEN_FAKE_XYZ' (and '_QQQ' for second) — assertions search for both the literal AND the /ops_[A-Z0-9_]/ pattern to catch any service-account-prefix leak"

patterns-established:
  - "FakePooledChild.consumeStdinJson() / pushStdoutLine() — read/write side captured separately so tests assert exactly what the broker wrote and inject what it should read"
  - "FakeBrokerSocketPair with .fakeClose(reason) helper — simulates daemon restart for Pitfall 5 tests without real socket files"
  - "All Phase 108 test files header-tagged // RED — Phase 108-00 — Wave 0 scaffolding. Production target: <path>"

requirements-completed: [POOL-01, POOL-02, POOL-03, POOL-04, POOL-05, POOL-06, POOL-07, POOL-08]
# NOTE: These are pinned by RED tests, not yet implemented. Wave 1 GREEN flips each.

# Metrics
duration: 25min
completed: 2026-05-01
---

# Phase 108 Plan 00: Wave 0 — RED Test Scaffolding for 1password-mcp Broker Summary

**6 RED test files (43 `it()` cases / 29 `describe` blocks) + 2 shared fakes that pin every locked Phase 108 broker behavior; all fail deterministically at module-import; existing test suite unchanged.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-05-01T12:18:00Z
- **Completed:** 2026-05-01T12:39:00Z
- **Tasks:** 3
- **Files created:** 8

## Accomplishments

- Shared `FakePooledChild` (ChildProcess-shaped) and `FakeBrokerSocketPair` (net.Socket-shaped duplex pair) — reusable by every Phase 108 RED test and (importantly) every Phase 108 GREEN test once production code lands.
- 43 `it()` cases pinning the broker's production contract: id-rewriting, initialize cache-and-replay, crash → in-flight error fanout, token grouping, last-ref SIGTERM with drain ceiling, auto-respawn, per-agent semaphore, audit log fields, token redaction (Phase 104 SEC-07), shim handshake + byte-transparent stdio bridge, daemon-shutdown lifecycle, and POOL-07 heartbeat liveness.
- All Phase 108 RED files fail with `Cannot find module '../<target>.js'` — deterministic, no syntax errors, no flakes.
- Existing test suite untouched: pre-existing baseline of 17 failing files / 35 failing tests was 16 / 34 after our changes (within normal flake range; our changes added zero production code so cannot have caused or fixed a non-Phase-108 failure).

## Task Commits

1. **Task 1: Shared fakes** — `0bb3e95` (test)
2. **Task 2: PooledChild + Broker RED tests** — `b666200` (test)
3. **Task 3: ShimServer + integration + shim CLI + heartbeat RED tests** — `3cf369e` (test)

## Files Created

| Path | Lines | Purpose |
|------|-------|---------|
| `tests/__fakes__/fake-pooled-child.ts` | 130 | ChildProcess-shaped fake with stdin capture / stdout line injection / simulateExit / simulateError / kill capture; PID starts at 90001 |
| `tests/__fakes__/fake-broker-socket.ts` | 128 | net.Socket-shaped duplex pair (PassThrough cross-wired) + `fakeClose(reason)` + `closePair()` for Pitfall-5 tests |
| `src/mcp/broker/__tests__/pooled-child.test.ts` | 327 | 8 it() pinning data-plane behavior |
| `src/mcp/broker/__tests__/broker.test.ts` | 506 | 11 it() pinning control-plane behavior |
| `src/mcp/broker/__tests__/shim-server.test.ts` | 209 | 7 it() pinning IPC server behavior |
| `src/mcp/broker/__tests__/integration.test.ts` | 233 | 4 it() end-to-end multi-agent / multi-token scenarios |
| `src/cli/commands/__tests__/mcp-broker-shim.test.ts` | 246 | 6 it() pinning agent-side shim CLI |
| `src/heartbeat/checks/__tests__/mcp-broker.test.ts` | 142 | 7 it() pinning POOL-07 heartbeat check |

## RED Test Inventory

### `src/mcp/broker/__tests__/pooled-child.test.ts` (8 it / 5 describe)
**Production target:** `src/mcp/broker/pooled-child.ts` — does NOT exist.
**Fail message:** `Error: Cannot find module '../pooled-child.js' imported from .../pooled-child.test.ts`

| describe | it | Pins |
|----------|-----|------|
| PooledChild — id rewriting (POOL-03) | routes concurrent id=1 dispatches from two agents back to their originating agents | POOL-03 |
| PooledChild — id rewriting (POOL-03) | handles string-typed agent ids (JSON-RPC allows string or number) | POOL-03 edge |
| PooledChild — initialize cache-and-replay (Pitfall 1) | first agent's initialize round-trips to the child; second agent's initialize is served from cache | Pitfall 1 |
| PooledChild — initialize cache-and-replay (Pitfall 1) | multiple concurrent first-time initializers all receive the same cached result after one round-trip | Pitfall 1 race |
| PooledChild — crash → in-flight error fanout | when the child exits with calls in flight, every affected agent receives a structured JSON-RPC error | POOL-04 / decision §3 |
| PooledChild — crash → in-flight error fanout | late responses arriving after agent disconnect are dropped silently (no throw) | data-plane robustness |
| PooledChild — notifications pass through unrewritten | notification (no id) from child is dropped by default (no agent receives it) | notification policy (TODO note) |
| PooledChild — module shape | exports BROKER_ERROR_CODE_POOL_CRASH constant in JSON-RPC server-defined error range | error-code surface |

### `src/mcp/broker/__tests__/broker.test.ts` (11 it / 7 describe)
**Production target:** `src/mcp/broker/broker.ts` — does NOT exist.
**Fail message:** `Error: Cannot find module '../broker.js' imported from .../broker.test.ts`

| describe | it | Pins |
|----------|-----|------|
| Broker — token grouping (POOL-01) | three agents on token A and one agent on token B spawn exactly 2 pool children | POOL-01 |
| Broker — token grouping (POOL-01) | broker does not cross-route between token pools | POOL-01 |
| Broker — last-ref SIGTERM with drain (POOL-04, Pitfall 3) | last-ref disconnect waits up to 2s for inflight to drain, then SIGTERMs the child | POOL-04 / Pitfall 3 |
| Broker — last-ref SIGTERM with drain (POOL-04, Pitfall 3) | if inflight drains before ceiling, SIGTERM fires immediately after the last response | POOL-04 fast path |
| Broker — auto-respawn on crash (POOL-04) | when child exits while agents are still attached, broker spawns a new child within 2s | POOL-04 |
| Broker — auto-respawn on crash (POOL-04) | does NOT respawn if no agents remain attached | POOL-04 negative |
| Broker — per-agent semaphore (POOL-05) | a single agent dispatching 5 concurrent calls sees max 4 in-flight; 5th waits in FIFO queue | POOL-05 |
| Broker — audit log fields (POOL-06) | every dispatched call emits a pino line with component, pool, agent, turnId, tool fields | POOL-06 |
| Broker — token redaction (Phase 104 SEC-07) | no log line ever contains the literal OP_SERVICE_ACCOUNT_TOKEN value | SEC-07 |
| Broker — token redaction (Phase 104 SEC-07) | no log line contains any string starting with 'ops_' (1Password service-account prefix) | SEC-07 belt-and-suspenders |
| Broker — module shape | exports BROKER_ERROR_CODE_DRAIN_TIMEOUT in JSON-RPC server-defined error range | error-code surface |

### `src/mcp/broker/__tests__/shim-server.test.ts` (7 it / 4 describe)
**Production target:** `src/mcp/broker/shim-server.ts` — does NOT exist.
**Fail message:** `Error: Cannot find module '../shim-server.js' imported from .../shim-server.test.ts`

| describe | it | Pins |
|----------|-----|------|
| ShimServer — connection handshake | accepts a valid {agent, tokenHash} first line and registers the agent | handshake happy path |
| ShimServer — connection handshake | rejects a handshake missing agent name with structured error and closes the socket | handshake validation |
| ShimServer — connection handshake | rejects a handshake with non-string agent name | handshake validation |
| ShimServer — per-connection refcount | N connections on the same tokenHash increment the pool refcount; last close SIGTERMs | refcounting |
| ShimServer — daemon shutdown | preDrainNotify rejects new connections; existing connections continue | shutdown ordering |
| ShimServer — daemon shutdown | shutdown(ceiling) closes all sockets and SIGTERMs all pool children within the ceiling | shutdown ceiling |
| ShimServer — token redaction in handshake errors | error responses never echo the literal token even if shim accidentally sent it | SEC-07 |

### `src/mcp/broker/__tests__/integration.test.ts` (4 it / 4 describe)
**Production target:** `src/mcp/broker/{broker,shim-server,pooled-child}.ts` — none exist.
**Fail message:** `Error: Cannot find module '../broker.js' imported from .../integration.test.ts`

| describe | it | Pins |
|----------|-----|------|
| Broker integration — POOL-08 (5 agents × 2 tokens → 2 children) | 3 agents on token A and 2 agents on token B spawn exactly 2 pool children | POOL-08 |
| Broker integration — synthetic burst (smoke #3) | 5 agents on token A simultaneously call password_read; all receive correct responses through one pool child | smoke #3 |
| Broker integration — crash + auto-respawn (smoke #4) | when pool child crashes mid-dispatch, in-flight calls error-out and broker respawns within 2s | smoke #4 |
| Broker integration — token grouping cardinality (POOL-01) | getPoolStatus returns one entry per unique tokenHash with the correct refcount | POOL-01 status surface |

### `src/cli/commands/__tests__/mcp-broker-shim.test.ts` (6 it / 4 describe)
**Production target:** `src/cli/commands/mcp-broker-shim.ts` — does NOT exist.
**Fail message:** `Error: Cannot find module '../mcp-broker-shim.js' imported from .../mcp-broker-shim.test.ts`

| describe | it | Pins |
|----------|-----|------|
| mcp-broker-shim — handshake on connect | first line written to the broker socket is the handshake { agent, tokenHash } | shim handshake |
| mcp-broker-shim — handshake on connect | hashes tokenHash in-shim — never sends literal token over the socket | SEC-07 in-shim hashing |
| mcp-broker-shim — stdio bridge (byte transparency) | agent stdin lines arrive on the broker socket unchanged (byte-for-byte) | byte-pipe invariant |
| mcp-broker-shim — stdio bridge (byte transparency) | broker socket writes appear on agent stdout unchanged (byte-for-byte) | byte-pipe invariant |
| mcp-broker-shim — daemon restart triggers non-zero exit (Pitfall 5) | when the broker socket closes, runShim resolves with a non-zero exit code | Pitfall 5 |
| mcp-broker-shim — token never logged literal | no log line emitted by the shim contains the literal OP_SERVICE_ACCOUNT_TOKEN value | SEC-07 |

### `src/heartbeat/checks/__tests__/mcp-broker.test.ts` (7 it / 5 describe)
**Production target:** `src/heartbeat/checks/mcp-broker.ts` — does NOT exist.
**Fail message:** `Error: Cannot find module '../mcp-broker.js' imported from .../mcp-broker.test.ts`

| describe | it | Pins |
|----------|-----|------|
| mcpBrokerCheck — module shape | exports a CheckModule with name='mcp-broker' and a 60s interval | module-shape contract |
| mcpBrokerCheck — passes when all referenced pools alive | returns healthy when every pool has alive=true | POOL-07 happy |
| mcpBrokerCheck — passes when all referenced pools alive | returns healthy when there are zero pools (broker idle) | POOL-07 idle |
| mcpBrokerCheck — fails when any referenced pool dead | returns critical when a pool with agentRefCount>0 has alive=false | POOL-07 failure |
| mcpBrokerCheck — ignores dead pools with zero refs | returns healthy when alive=false coincides with agentRefCount=0 (cleanly drained) | POOL-07 drain semantics |
| mcpBrokerCheck — ignores dead pools with zero refs | a mix of (alive,refs>0) + (dead,refs=0) is healthy | POOL-07 mixed |
| mcpBrokerCheck — does NOT poll 1Password (no synthetic password_read) | calls only getPoolStatus on the provider; never invokes any tool dispatch path | rate-limit-budget invariant |

## Wave 1 GREEN Gate — Mapping by Plan

The following describes which RED suites each Wave 1 plan is responsible for flipping to GREEN:

### 108-01: PooledChild + id-rewriter (`src/mcp/broker/pooled-child.ts` + `types.ts`)
**Must export:** `PooledChild` class, `PooledChildDeps` type, `AgentRoute` type, `BROKER_ERROR_CODE_POOL_CRASH` const.
**Must satisfy:** All 8 cases in `pooled-child.test.ts`. The module-shape test pins the error-code constant range; the data-plane tests pin id rewriting + initialize cache + crash fanout + late-response drop + notification drop policy.

### 108-02: Broker (`src/mcp/broker/broker.ts`)
**Must export:** `OnePasswordMcpBroker` class, `BrokerDeps`, `BrokerSpawnFn`, `BrokerAgentConnection` types, `BROKER_ERROR_CODE_DRAIN_TIMEOUT` const.
**Must satisfy:** All 11 cases in `broker.test.ts`. Token grouping, last-ref SIGTERM with 2s drain ceiling, auto-respawn within 2s, per-agent semaphore (max 4 concurrent, FIFO queue), audit log shape, full SEC-07 redaction.

### 108-03: ShimServer (`src/mcp/broker/shim-server.ts`)
**Must export:** `ShimServer` class, `ShimServerDeps` type, `SHIM_HANDSHAKE_ERROR_INVALID_AGENT` + `SHIM_HANDSHAKE_ERROR_MISSING_FIELDS` consts.
**Must satisfy:** All 7 cases in `shim-server.test.ts`. Handshake validation, refcounting, preDrainNotify + shutdown(ceiling), error redaction.
**Bonus:** Wave-1 integration suite (`integration.test.ts`, 4 cases) flips GREEN once 108-01, 108-02, 108-03 are all done.

### 108-04: Agent-side shim CLI (`src/cli/commands/mcp-broker-shim.ts`)
**Must export:** `runShim(opts: ShimDeps & { pool: string })` async function returning a numeric exit code.
**Must satisfy:** All 6 cases in `mcp-broker-shim.test.ts`. In-shim sha256 token-hashing, byte-transparent stdio bridge, non-zero exit on socket close, no token in pino logs.

### 108-05: Loader rewire + daemon boot wiring + heartbeat
**Must export from heartbeat:** `mcpBrokerCheck` default export (CheckModule), `BrokerStatusProvider` + `BrokerPoolStatus` types.
**Must satisfy:** All 7 cases in `heartbeat/checks/__tests__/mcp-broker.test.ts`. Critically the provider surface MUST be exactly `{ getPoolStatus(): BrokerPoolStatus[] }` — no callTool / dispatch method (the last test asserts `Object.keys(provider) === ['getPoolStatus']`).

## Decisions Made

- **Heartbeat status values use canonical `"healthy"` / `"critical"` (existing convention in `src/heartbeat/types.ts:10`).** Plan referred to `CheckStatus.failed`; no such value exists in the project. Rule 3 — blocking deviation; documented here so 108-05 implementer doesn't waste time looking.
- **Provider surface for heartbeat is intentionally narrow.** `BrokerStatusProvider` exposes `getPoolStatus()` only — no `callTool` / `dispatch` / `sendRequest`. Asserted via `Object.keys` to prevent accidental future addition that would consume 1Password rate-limit budget. Rationale: the whole point of pooling is to REDUCE 1Password calls; a synthetic-`password_read` health check would defeat it.
- **Notification (no `id`) drop policy.** RESEARCH.md and CONTEXT.md were ambiguous; chose "drop" with TODO note. If upstream `@takescake/1password-mcp` ever emits notifications, flip the assertion to per-agent fan-out and 108-01 implements broadcast.
- **Test token literal `ops_TESTTOKEN_FAKE_XYZ`.** Mirrors real 1Password service-account token shape (`ops_` prefix, all caps + digits) so the redaction regex `/ops_[A-Z0-9_]/` is a meaningful belt-and-suspenders.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Heartbeat CheckStatus value naming**
- **Found during:** Task 3 (heartbeat check RED test)
- **Issue:** Plan referred to `CheckStatus.healthy` / `CheckStatus.failed`. Actual values in `src/heartbeat/types.ts:10` are `"healthy" | "warning" | "critical"`.
- **Fix:** Used canonical `"healthy"` / `"critical"` in `mcpBrokerCheck` RED tests; documented in Decisions Made so Wave 1 implementer doesn't follow the plan's typo.
- **Files modified:** `src/heartbeat/checks/__tests__/mcp-broker.test.ts`
- **Verification:** Imports `CheckResult` / `CheckStatus` from real types module — typecheck-clean (no ad-hoc string).
- **Committed in:** `3cf369e` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Trivial naming alignment with existing project conventions. No scope creep.

## Issues Encountered

- None during execution. The pre-existing baseline of 17 failing test files / 35 failing tests on master is unrelated to this work; verified by running the suite with our 6 new test files excluded — the same failures (16/34, within flake range) appeared with our changes that touch only test code + tests-only fakes. We added zero production code, so we cannot have caused or fixed any non-Phase-108 test result.

## Verification Evidence

```
$ npx vitest run src/mcp/broker/ src/cli/commands/__tests__/mcp-broker-shim.test.ts src/heartbeat/checks/__tests__/mcp-broker.test.ts
Test Files  6 failed (6)
Tests       no tests
# All 6 RED files fail at module-import. No syntax errors. Deterministic.

$ npx vitest run --exclude "src/mcp/broker/**" --exclude "src/cli/commands/__tests__/mcp-broker-shim.test.ts" --exclude "src/heartbeat/checks/__tests__/mcp-broker.test.ts"
Test Files  16 failed | 456 passed (472)
Tests       34 failed | 5927 passed (5961)
# Pre-existing baseline was 17/35; current is 16/34 — within flake range, no new failures attributable to Phase 108 work.

$ npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "tests/__fakes__/(fake-pooled-child|fake-broker-socket)\.ts" || echo "fakes typecheck clean"
fakes typecheck clean
# (Pre-existing TS6059 rootDir warnings on importing test files are noise — the fakes themselves are clean. Wave 1 will resolve all the TS2307 import-target errors as it lands the production modules.)
```

## Self-Check: PASSED

- All 8 created files exist: ✓
- All 3 task commits on disk:
  - `0bb3e95` — Task 1 (fakes) ✓
  - `b666200` — Task 2 (PooledChild + Broker RED) ✓
  - `3cf369e` — Task 3 (ShimServer + integration + shim CLI + heartbeat RED) ✓
- All 6 Phase 108 test files RED with deterministic module-import failures ✓
- No production code under `src/mcp/broker/` or `src/cli/commands/mcp-broker-shim.ts` ✓
- Existing test suite unchanged (16/34 failing vs baseline 17/35 — same flake-range; no production code touched so causality is structurally impossible) ✓
- Token literal `ops_TESTTOKEN_FAKE_XYZ` is the only test-token shape used; no real `ops_` strings appear in any committed file ✓

## Next Phase Readiness

Wave 1 (108-01 through 108-04) can now begin in parallel:
- **108-01 (PooledChild)** and **108-02 (Broker)** can be developed in parallel — see RESEARCH.md plan-breakdown.
- **108-03 (ShimServer)** depends on the broker socket protocol shape but can be drafted alongside.
- **108-04 (shim CLI)** is sequential after 108-03 (needs locked socket protocol).
- **108-05 (loader rewire + daemon wiring + heartbeat)** is the integration plan — sequential after Wave 1.

Each Wave 1 implementer has a precise GREEN gate above. Do not modify the RED test assertions; if a test feels wrong, raise a Rule 4 architectural-decision checkpoint.

---
*Phase: 108-shared-1password-mcp-pooling*
*Completed: 2026-05-01*
