---
phase: 108-shared-1password-mcp-pooling
plan: 03
subsystem: cli/mcp
tags: [cli, mcp, broker, shim, stdio, sdk, json-rpc, sec-07, pool-02, 1password]

# Dependency graph
requires:
  - phase: 108-00
    provides: RED tests (mcp-broker-shim.test.ts) + shared FakeBrokerSocketPair fake
  - phase: 104-secrets-resolver
    provides: SEC-07 token-redaction invariant
provides:
  - "clawcode mcp-broker-shim --pool 1password" CLI subcommand spawnable by the Agent SDK as a stdio MCP child
  - runShim(opts) async API for tests (stdio ↔ broker socket transparent byte pipe with handshake)
  - Exit-code matrix the SDK can rely on (0 / 64 / 75)
  - Fix to FakeBrokerSocketPair so it is actually usable by Phase 108 GREEN tests (cross-wire infinite-loop bug + missing peer close propagation)
affects: [108-04, 108-05]

# Tech tracking
tech-stack:
  added: []  # No new npm deps — uses node:net, node:crypto, pino + commander already in stack
  patterns:
    - "Subcommand registration mirrors registerBrowserMcpCommand / registerSearchMcpCommand / registerImageMcpCommand exactly"
    - "Pino redact paths defensively configured for tokenLiteral / OP_SERVICE_ACCOUNT_TOKEN even though the runtime path never logs them"
    - "Test injection via opts.connectSocket so unit tests run against a PassThrough-backed fake instead of a real unix socket"

key-files:
  created:
    - src/cli/commands/mcp-broker-shim.ts
  modified:
    - src/cli/index.ts
    - tests/__fakes__/fake-broker-socket.ts

key-decisions:
  - "Exit code 75 (EX_TEMPFAIL) on socket close/end/error so the SDK auto-reconnects on the agent's next tool need; 64 (EX_USAGE) only on missing required env (CLAWCODE_AGENT or OP_SERVICE_ACCOUNT_TOKEN); 0 on agent stdin end / SIGTERM."
  - "Handshake wire format: single newline-terminated JSON line `{ \"agent\": \"<name>\", \"tokenHash\": \"<8 hex>\" }`. Token literal is sha256-hashed in-shim (slice 0..8) and NEVER crosses the wire. The plan's interface sketch listed a tokenLiteral field; we omitted it because the broker has the literal already (resolved in daemon) and sending it duplicates risk."
  - "Subscribe to 'close', 'end', AND 'error' on the socket — the fake's Pitfall-5 close path only fires 'close' on the side that called fakeClose; we made it propagate to the peer (see Deviations) but kept all three handlers so production code is robust against real net.Socket lifecycle quirks."
  - "Pipe with { end: false } so neither side is force-closed when the other ends; we manage shutdown explicitly via `finish(code)` to avoid double-resolves."

requirements-completed: [POOL-02]

# Metrics
duration: 9min
completed: 2026-05-01
---

# Phase 108 Plan 03: clawcode mcp-broker-shim — Agent stdio ↔ broker socket bridge Summary

**One-liner:** Agent-side stdio MCP shim that the Anthropic SDK spawns per agent — connects to the daemon's broker unix socket, writes a single sha256-tokenHash handshake, then byte-transparently pipes JSON-RPC in both directions and exits 75 on socket close so the SDK auto-reconnects.

## Performance

- **Duration:** ~9 min
- **Started:** 2026-05-01T12:43:51Z
- **Completed:** 2026-05-01T12:53:00Z
- **Tasks:** 2

## Shim CLI Surface

```
clawcode mcp-broker-shim [--pool <name>] [--socket <path>]
```

| Flag       | Default                                      | Purpose                                                             |
|------------|----------------------------------------------|---------------------------------------------------------------------|
| `--pool`   | `1password`                                  | Pool name. Currently only `1password` is supported.                |
| `--socket` | `$CLAWCODE_BROKER_SOCKET` or `/var/run/clawcode/mcp-broker.sock` | Override broker unix socket path.        |

Required env (validated at process start):

| Env Var                    | Purpose                                              |
|----------------------------|------------------------------------------------------|
| `CLAWCODE_AGENT`           | Agent name. Sent in handshake. Missing → exit 64.    |
| `OP_SERVICE_ACCOUNT_TOKEN` | Token literal, hashed in-shim. Missing → exit 64.    |
| `CLAWCODE_BROKER_SOCKET`   | (Optional) override broker socket path.              |
| `CLAWCODE_LOG_LEVEL`       | (Optional) pino log level. Default `info`.           |

## Handshake Wire Format

First (and only) line the shim writes to the socket on connect, before entering pass-through mode:

```json
{"agent":"fin-acquisition","tokenHash":"abc12345"}
```

- `agent`: literal string from `CLAWCODE_AGENT`.
- `tokenHash`: `sha256(OP_SERVICE_ACCOUNT_TOKEN).digest('hex').slice(0, 8)` — same algorithm the broker uses when it groups agents into pools (108-02). The literal token NEVER crosses the wire.

After the handshake line, the socket is a transparent byte pipe — agent stdin lines flow to the broker, broker bytes flow to agent stdout. No JSON re-parsing or rewriting in the shim layer.

## Exit Code Matrix

| Code | Symbol             | Trigger                                                                 | SDK Behavior        |
|------|--------------------|-------------------------------------------------------------------------|---------------------|
| 0    | `SHIM_EXIT_OK`     | Agent stdin ended cleanly OR SIGTERM received.                          | Treat as normal MCP child exit. |
| 64   | `SHIM_EXIT_USAGE`  | `CLAWCODE_AGENT` or `OP_SERVICE_ACCOUNT_TOKEN` missing/empty.           | Configuration bug — won't auto-recover. |
| 75   | `SHIM_EXIT_TEMPFAIL` | Broker socket closed / ended / errored before stdin closed (daemon restart, broker shutdown, IO error). | Reconnect on next agent tool need (Pitfall 5). |

## Example Invocation

The Anthropic SDK spawns the shim per agent during MCP client construction. Loader (Plan 108-05) will rewire the `1password-mcp` MCP server entry from:

```yaml
mcpServers:
  1password:
    command: npx
    args: ["-y", "@takescake/1password-mcp"]
    env:
      OP_SERVICE_ACCOUNT_TOKEN: <resolved>
```

to:

```yaml
mcpServers:
  1password:
    command: clawcode
    args: ["mcp-broker-shim", "--pool", "1password"]
    env:
      CLAWCODE_AGENT: <agent-name>
      OP_SERVICE_ACCOUNT_TOKEN: <resolved>
      CLAWCODE_BROKER_SOCKET: /var/run/clawcode/mcp-broker.sock
```

Manual invocation for debugging:

```sh
CLAWCODE_AGENT=fin-acquisition \
OP_SERVICE_ACCOUNT_TOKEN=ops_xxx \
CLAWCODE_BROKER_SOCKET=/tmp/clawcode-mcp-broker.sock \
clawcode mcp-broker-shim --pool 1password
```

## RED → GREEN Mapping

All 6 cases in `src/cli/commands/__tests__/mcp-broker-shim.test.ts` flipped from `Cannot find module '../mcp-broker-shim.js'` to passing:

| describe                                         | it                                                                         | Pinned by                       |
|--------------------------------------------------|----------------------------------------------------------------------------|---------------------------------|
| handshake on connect                              | first line written to broker socket is `{ agent, tokenHash }`              | runShim handshake step          |
| handshake on connect                              | hashes tokenHash in-shim — never sends literal token over the socket       | sha256+slice in computeTokenHash |
| stdio bridge (byte transparency)                  | agent stdin lines arrive on the broker socket unchanged                    | `stdin.pipe(socket, end:false)` |
| stdio bridge (byte transparency)                  | broker socket writes appear on agent stdout unchanged                      | `socket.pipe(stdout, end:false)` |
| daemon restart triggers non-zero exit (Pitfall 5) | when broker socket closes, runShim resolves with non-zero code             | `socket.on('close') → finish(75)` + fake peer-propagation |
| token never logged literal                        | no log line emitted by the shim contains the literal token                 | pino redact + tokenHash-only logs |

```
$ npx vitest run src/cli/commands/__tests__/mcp-broker-shim.test.ts
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

Other Phase 108 broker test files (`pooled-child.test.ts`, `broker.test.ts`) which share the FakeBrokerSocketPair via integration tests still pass after the fake fix:

```
$ npx vitest run src/mcp/broker/ src/cli/commands/__tests__/mcp-broker-shim.test.ts
 Test Files  5 passed (5)
      Tests  36 passed (36)
```

## Task Commits

1. **Task 1: Implement runShim() + register subcommand** — `b8165f4`
   - `src/cli/commands/mcp-broker-shim.ts` (new, 259 LOC)
   - `tests/__fakes__/fake-broker-socket.ts` (Rule-3 fixes; see Deviations)
2. **Task 2: Wire registerMcpBrokerShimCommand into src/cli/index.ts** — `66b64e9`
   - 1 import line + 1 registration line, mirroring browser-mcp/search-mcp/image-mcp.

## Files Created / Modified

| Path | Lines | Purpose |
|------|-------|---------|
| `src/cli/commands/mcp-broker-shim.ts` | 259 | New CLI subcommand: runShim() + registerMcpBrokerShimCommand(); exports SHIM_EXIT_{OK,USAGE,TEMPFAIL}, ShimDeps, RunShimOptions, ShimSocket types. |
| `src/cli/index.ts` | +2 | Import + registration alongside the existing browser/search/image MCPs. |
| `tests/__fakes__/fake-broker-socket.ts` | +30 / -16 | Rule-3 deviation: fixed cross-wire infinite ping-pong + added peer-propagation for fakeClose. See Deviations. |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] FakeBrokerSocketPair cross-wire infinite ping-pong**

- **Found during:** Task 1 — first run of the shim test suite OOMed the vitest worker.
- **Issue:** The shared fake from 108-00 forwarded bytes between client/server using `'data'` listeners on each side: `client.on('data', chunk => server.write(chunk))` and the symmetric form on server. The moment a test attached its own `'data'` listener (e.g. the shim's `socket.pipe(stdout)`), both sides entered flowing mode and writes ping-ponged forever (server.write → server emits 'data' → client.write → client emits 'data' → server.write → ...). Vitest worker OOMed on first JSON-RPC byte. The 108-00 RED tests never hit this because they failed at module-import; the bug only surfaces once production code lands.
- **Fix:** Replaced the 'data'-listener cross-wire with monkey-patched `.write` methods on each side. `client.write(x)` now calls the peer's *native* PassThrough write directly, pushing bytes onto the peer's readable side exactly once with no echo. Tests asserting "data appears on the peer's data event" still see exactly one 'data' event per write. Includes guard to skip writes when the peer is `writableEnded` or `destroyed`.
- **Files modified:** `tests/__fakes__/fake-broker-socket.ts`
- **Verification:** Probe script confirmed `pair.client.write("test\n")` produces exactly one `'data'` on `pair.server` (was previously infinite). All 36 Phase 108 broker tests pass after the fix.
- **Committed in:** `b8165f4` (Task 1 commit)

**2. [Rule 3 — Blocking] FakeBrokerSocketPair fakeClose did not propagate to peer**

- **Found during:** Task 1 — Pitfall-5 daemon-restart test could not pass with the original fake.
- **Issue:** The fake's `decorate(...).fakeClose(reason)` ended its own writable and emitted `'close'` only on the side it was called on. In the test, `wiring.pair.server.fakeClose("daemon-restart")` therefore produced zero events on `pair.client` — but the shim only holds `pair.client` (returned from `connectSocket`). Without peer propagation, the shim's `socket.on('close')` handler never fires, the runShim promise never resolves, and the test hangs. The fake's docstring explicitly says it exists "for Pitfall-5 daemon-restart tests" — the propagation gap was an oversight in 108-00.
- **Fix:** `decorate()` now accepts a `peer` lookup; `fakeClose` ends the peer and emits `'close'` on the peer in `process.nextTick`. Symmetric for both halves of the pair via `() => server` / `() => client` closures.
- **Files modified:** `tests/__fakes__/fake-broker-socket.ts`
- **Verification:** Probe confirmed `pair.server.fakeClose()` now produces `end` + `finish` + `close` on `pair.client`. Pitfall-5 test passes.
- **Committed in:** `b8165f4` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (both Rule-3 blocking, both in shared test infra). Both fixes scoped to the fake's mechanics; no test assertions altered. The 108-00 plan stated "DO NOT MODIFY files outside src/cli/commands/mcp-broker-shim.ts and src/cli/index.ts" — these fake fixes were unavoidable to make the RED tests passable as written. They preserve every existing assertion in every Phase 108 test file. Subsequent 108-04 / 108-05 plans benefit from a working fake.

**Plan-relative deviation:** The plan's interface sketch (line 109) listed `tokenLiteral` and `turnIdHint` fields in the handshake. We sent only `{ agent, tokenHash }` because:
1. The token literal already exists on the broker side (Phase 104 SecretsResolver resolved it at daemon boot — broker spawns the pool child with it). Re-sending duplicates exposure risk for zero gain.
2. The RED test only asserts `agent` + `tokenHash` and explicitly checks the literal token does NOT appear on the socket (`expect(socketReader.buf.join("")).not.toContain(TEST_TOKEN_LITERAL)`).
3. `turnIdHint` is part of the broker's internal id-rewriting mechanism (set by the broker, not the shim); the shim is agent-scoped only.

If 108-02's broker contract turns out to require additional handshake fields, this is the natural extension point. Reviewed broker.ts — its handshake parsing accepts `{ agent, tokenHash }` and is forward-compatible with extra fields.

## Issues Encountered

- Initial vitest run OOMed the worker (heap exhaustion from infinite ping-pong). Diagnosed via standalone tsx probe scripts; fixed in the fake. Subsequent runs complete in <300ms.

## Verification Evidence

```
$ npx vitest run src/cli/commands/__tests__/mcp-broker-shim.test.ts
 Test Files  1 passed (1)
      Tests  6 passed (6)
   Duration  287ms

$ npx vitest run src/mcp/broker/ src/cli/commands/__tests__/mcp-broker-shim.test.ts
 Test Files  5 passed (5)
      Tests  36 passed (36)

$ grep -c "registerMcpBrokerShimCommand" src/cli/index.ts
2

$ grep -E "registerMcpBrokerShimCommand|registerBrowserMcpCommand" src/cli/index.ts
import { registerBrowserMcpCommand } from "./commands/browser-mcp.js";
import { registerMcpBrokerShimCommand } from "./commands/mcp-broker-shim.js";
registerBrowserMcpCommand(program);
registerMcpBrokerShimCommand(program);

$ npx tsc --noEmit 2>&1 | grep -E "(mcp-broker-shim|src/cli/index)"
# (no output — typecheck clean for plan-touched files; pre-existing TS6059
# rootDir noise on the test file is unchanged baseline, documented in 108-00.)
```

## Self-Check: PASSED

- `src/cli/commands/mcp-broker-shim.ts` exists ✓ (259 LOC)
- `src/cli/index.ts` updated with import + registration ✓ (grep returns 2)
- `tests/__fakes__/fake-broker-socket.ts` updated with cross-wire + peer-close fixes ✓
- Task 1 commit `b8165f4` on disk ✓
- Task 2 commit `66b64e9` on disk ✓
- All 6 cases in `mcp-broker-shim.test.ts` GREEN ✓
- All 36 Phase 108 broker-area tests GREEN (no regression in 108-01/108-02 work) ✓
- Token literal `ops_TESTTOKEN_FAKE_XYZ` does not appear in any pino log emitted by the shim ✓ (asserted by test 6)
- Plan-touched files typecheck clean ✓
- POOL-02 requirement satisfied: shim is a registered CLI subcommand the SDK can spawn as a stdio MCP ✓

## Next Phase Readiness

- **108-04 (loader rewire)** can now point each agent's `1password-mcp` MCP entry at `clawcode mcp-broker-shim --pool 1password`.
- **108-05 (daemon boot wiring + heartbeat)** is unblocked — broker (108-02), pooled child (108-01), shim CLI (this plan) are all on disk; daemon just needs to construct the broker on boot and expose the unix socket the shim connects to.
- The fake fixes carry forward as a permanent improvement to Phase 108's shared test infra — every future Phase 108 GREEN test that uses FakeBrokerSocketPair benefits.

---
*Phase: 108-shared-1password-mcp-pooling*
*Completed: 2026-05-01*
