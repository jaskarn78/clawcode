---
phase: 108-shared-1password-mcp-pooling
plan: 04
subsystem: integration
tags: [mcp, broker, daemon, lifecycle, heartbeat, reconciler, loader, ipc, 1password, pool]

# Dependency graph
requires:
  - plan: 108-01
    provides: PooledChild + types (BROKER_ERROR_CODE_POOL_CRASH)
  - plan: 108-02
    provides: OnePasswordMcpBroker + ShimServer (shipped together with 108-01 in this branch)
  - plan: 108-03
    provides: clawcode mcp-broker-shim CLI subcommand
  - phase: 104-secrets-resolver
    provides: SEC-07 token redaction; SecretsResolver pre-resolves OP_SERVICE_ACCOUNT_TOKEN
  - phase: 999.14-15-mcp-process-tracking
    provides: McpProcessTracker + reconciler that the broker's synthetic owner integrates with
provides:
  - Daemon-managed broker live in production: 1password-mcp child count drops from 1-per-agent → 1-per-token
  - Loader auto-injects 'clawcode mcp-broker-shim --pool 1password' for every agent
  - Reconciler skip-list for '__broker:' synthetic owners (Pitfall 6)
  - Heartbeat 'mcp-broker' check (POOL-07) — pure liveness probe, never consumes 1Password rate-limit budget
  - ConfigReloader hot-reload-token-change warning (Pitfall 2)
affects: [108-05]

# Tech tracking
tech-stack:
  added: []  # No new npm deps
  patterns:
    - "Daemon-built tokenHash → rawToken map injected into ShimServer via deps.resolveRawToken — keeps the literal off the wire"
    - "Adapter shape '{ getPoolStatus: () => broker.getPoolStatus() }' decouples heartbeat from broker module lifecycle"
    - "Synthetic owner '__broker:1password:<tokenHash>' in McpProcessTracker; reconciler skips via name.startsWith('__broker:')"
    - "Shutdown ordering snapshot → preDrainNotify → manager.drain → broker.shutdown(2000) → close netServer + unlink socket — every step wrapped in try/catch"

key-files:
  created:
    - src/heartbeat/checks/mcp-broker.ts
  modified:
    - src/config/loader.ts
    - src/config/__tests__/loader.test.ts
    - src/manager/daemon.ts
    - src/mcp/reconciler.ts
    - src/mcp/__tests__/reconciler.test.ts
    - src/mcp/broker/shim-server.ts
    - src/heartbeat/check-registry.ts
    - src/heartbeat/types.ts
    - src/heartbeat/runner.ts
    - src/heartbeat/__tests__/check-registry.test.ts
    - src/heartbeat/__tests__/discovery.test.ts
    - src/heartbeat/__tests__/runner.test.ts

key-decisions:
  - "Ordering: tracker-before-broker (instead of broker-before-tracker as RESEARCH.md §5 leaned). Rationale: broker's onPoolSpawn callback closes over the already-constructed mcpTracker singleton — no forward-reference / null-check gymnastics. The hard constraint per RESEARCH.md is 'broker is up before agents start'; both orderings satisfy that since manager.startAll runs ~2500 lines later."
  - "ShimServer.deps.resolveRawToken added (production-only injection). Wire format unchanged: shim still sends only {agent, tokenHash}; the literal is resolved daemon-side from a tokenHash → rawToken map built at boot from process.env + every resolvedAgent's mcpServers/mcpEnvOverrides. Tests omit the resolver and continue working with rawToken=''."
  - "Hot-reload of OP_SERVICE_ACCOUNT_TOKEN explicitly NOT supported (Pitfall 2 / CONTEXT.md §Out of scope). ConfigReloader walks newResolvedAgents for per-agent token override changes and emits an operator-visible error log per affected agent. Broker enforces the actual rejection at handshake-time sticky-pin check."
  - "Heartbeat provider surface intentionally narrow: { getPoolStatus(): ... }. Adding any dispatch / callTool / sendRequest method would consume 1Password rate-limit budget — the very budget pooling exists to preserve. The 108-00 RED test asserts Object.keys(provider) === ['getPoolStatus'] to gate this invariant."
  - "Heartbeat tests' check-count assertions updated 11 → 12. Pre-existing test files (check-registry.test.ts, discovery.test.ts, runner.test.ts) had hardcoded counts that now include mcp-broker."

requirements-completed: [POOL-01, POOL-02, POOL-04, POOL-06, POOL-07]

# Metrics
duration: 60min
completed: 2026-05-01
---

# Phase 108 Plan 04: Daemon Boot + Loader + Reconciler + Heartbeat Wiring Summary

**OnePasswordMcpBroker now boots inside the daemon, the loader auto-injects the broker shim per agent, the reconciler skips broker-owned PIDs, and a non-rate-limit-consuming heartbeat check surfaces pool liveness — Phase 108 is feature-complete; deploy gate (108-05) remains.**

## Daemon Boot-Order ASCII Timeline

```
[ src/manager/daemon.ts boot path ]

  4.    loadConfig                                                            (line ~1564)
  4a.   new SecretsResolver + preResolveAll(allOpRefs)                        (line ~1575)
        → all op:// URIs warmed in cache; OP_SERVICE_ACCOUNT_TOKEN literals
          ready for harvesting
  4-bis new McpProcessTracker (when mcp servers configured)                   (line ~1639)
        → registers reconcileAgent closure for TRACK-06 reconcile-before-kill
  4-ter NEW Phase 108 — OnePasswordMcpBroker + ShimServer construction        (line ~1680)
        ├─ build tokenHashToRawToken Map (process.env + per-agent override seed)
        ├─ new OnePasswordMcpBroker({
        │     log, perAgentMaxConcurrent: 4 (default), drainTimeoutMs: 2000 (default),
        │     spawnFn: ({tokenHash, rawToken}) ⇒ {
        │        child = childSpawn('npx', ['-y', '@takescake/1password-mcp@latest'],
        │                            { env: {...process.env, OP_SERVICE_ACCOUNT_TOKEN: rawToken} });
        │        mcpTracker.register('__broker:1password:'+tokenHash, daemonPid, [child.pid]);
        │        child.once('exit', () ⇒ mcpTracker.unregister(syntheticOwner));
        │        return child;
        │     }
        │   })
        ├─ new ShimServer({ broker, socketPath: ~/.clawcode/manager/mcp-broker.sock,
        │                  resolveRawToken: hash ⇒ tokenHashToRawToken.get(hash) })
        ├─ unlink stale socket file (best-effort)
        └─ netServer.listen(MCP_BROKER_SOCKET_PATH)
            ↳ on bind failure: log error, continue (non-fatal — agents'
              SDK MCP resolution will surface degraded state)

  4b.   cachedOpRefResolver (sync wrapper over warmed cache)                  (line ~1830)
  5.    resolveAllAgents(config, cachedOpRefResolver, onMcpResolutionError)   (line ~1850)
  5a.   NEW Phase 108 — harvest per-agent OP_SERVICE_ACCOUNT_TOKEN literals   (line ~1857)
        ├─ for each resolvedAgent: collectTokenLiteral(agent.mcpServers['1password'].env.OP_SERVICE_ACCOUNT_TOKEN)
        ├─ for each agent.mcpEnvOverrides['1password'].OP_SERVICE_ACCOUNT_TOKEN op:// URI:
        │   resolve via secretsResolver.getCached → collectTokenLiteral(literal)
        └─ log uniqueTokens count
  ...
  8.    new HeartbeatRunner; .initialize() (loads CHECK_REGISTRY of 12)        (line ~2495)
  8a.   heartbeatRunner.setSecretsResolver(secretsResolver)                   (line ~2552)
  8a-bis NEW Phase 108 — heartbeatRunner.setBrokerStatusProvider({            (line ~2553)
            getPoolStatus: () ⇒ broker.getPoolStatus()
          })  ← narrow adapter; NEVER expose a dispatch method
  ...
  11d.  ConfigReloader onChange:                                              (line ~4264)
        ├─ applySecretsDiff (Phase 104 SEC-05)                                (line ~4271)
        ├─ NEW Phase 108 — walk newResolvedAgents for OP_SERVICE_ACCOUNT_TOKEN override
        │   diffs vs prior resolvedAgents; per affected agent log:
        │   "mcp-broker: hot-reload of OP_SERVICE_ACCOUNT_TOKEN is NOT supported
        │    — restart daemon to apply (broker token pin is sticky per-agent)"
        └─ configReloader.applyChanges(diff, newResolvedAgents)
  ...
  manager.startAll()  → agents spawn → SDK spawns 'clawcode mcp-broker-shim --pool 1password'
                       per agent → shim connects to mcp-broker.sock
                       → broker spawns pool child if first agent on this token
```

## Daemon Shutdown Timeline (RESEARCH.md §5 ordering)

```
[ src/manager/daemon.ts shutdown() — line ~4253 ]

  1.   writePreDeploySnapshot                                                  (line ~4253)
       ↳ INVARIANT: snapshot first; broker state is in-memory and recreated
         lazily on next boot, so nothing to capture about the broker.
  2.   NEW Phase 108 — shimServer.preDrainNotify()                            (line ~4275)
       ↳ broker.draining = true → reject new shim connections.
       ↳ existing connections continue serving in-flight tool calls.
  3.   manager.drain(15_000)                                                   (line ~4290)
       ↳ existing agent turns finish; in-flight tool calls reach the broker
         and either complete or fail per pool refcount/inflight state.
  4.   NEW Phase 108 — shimServer.shutdown(2000)                              (line ~4310)
       ↳ close every active socket → broker sees disconnects.
       ↳ broker.shutdown(2000): force-fail any remaining inflight with
         BROKER_ERROR_CODE_DRAIN_TIMEOUT, SIGTERM every pool child,
         poll exit with 25ms cadence up to 2s ceiling.
  5.   NEW Phase 108 — brokerNetServer.close() + unlink socket                (line ~4322)
       ↳ release MCP_BROKER_SOCKET_PATH so next daemon boot doesn't trip
         on EADDRINUSE; ENOENT during unlink is the happy path.
  6.   openAiEndpoint.close → dashboard.close → ...                           (line ~4338+)
       ↳ rest of shutdown unchanged.

  Every Phase-108 step wrapped in try/catch — a hung broker NEVER blocks
  downstream shutdown work. Errors are logged + continue.
```

## Task Commits

| # | Commit | Title |
|---|--------|-------|
| 1 | `421d8c1` | `feat(108-04-01): rewire 1password auto-inject to broker shim command` |
| 2 | `7d43dab` | `feat(108-04-02): wire OnePasswordMcpBroker + ShimServer into daemon boot/shutdown` |
| 3 | `dea65be` | `feat(108-04-03): reconciler skip-list for broker-owned synthetic owners` |
| 4 | `6458472` | `feat(108-04-04): mcp-broker heartbeat check + registry registration` |

## RED → GREEN

### Phase 108-00 RED suites flipped GREEN by this plan

- **`src/heartbeat/checks/__tests__/mcp-broker.test.ts`** — 7/7 GREEN.
  - module shape (name='mcp-broker', interval=60)
  - healthy when every pool alive
  - healthy when zero pools (idle broker)
  - critical when in-use pool dead (h1 alive ref=2; h2 dead ref=1 → critical, message contains 'h2', metadata.failedPools defined)
  - healthy when alive=false coincides with refCount=0 (drained)
  - healthy on mix of (alive,refs>0) + (dead,refs=0)
  - calls only getPoolStatus on provider; Object.keys(provider) === ['getPoolStatus'] enforced

### Phase 108 loader RED-style tests added by this plan

- **`src/config/__tests__/loader.test.ts > Phase 108 — 1password broker shim auto-inject`** — 4/4 GREEN.
  - 108-LOAD-1: command='clawcode' + args=['mcp-broker-shim','--pool','1password']; npx invocation removed; token literal in env
  - 108-LOAD-2: per-agent CLAWCODE_AGENT env (clawdy / rubi)
  - 108-LOAD-3: omit when OP_SERVICE_ACCOUNT_TOKEN unset
  - 108-LOAD-4: user override preserved (no overwrite)

### Reconciler regression coverage extended

- **`src/mcp/__tests__/reconciler.test.ts > Test 10 (Phase 108)`** — GREEN.
  - Synthetic `__broker:1password:abc12345` entry alongside a real agent: synthetic owner remains in registered map; updateAgent / replaceMcpPids / unregister NEVER called for it; no log line references it.

### Wave 1 modules unaffected

- `src/mcp/broker/__tests__/{broker,pooled-child,shim-server,integration}.test.ts` + `src/cli/commands/__tests__/mcp-broker-shim.test.ts` — **36/36 GREEN** (unchanged from 108-02/03 SUMMARY).
- ShimServer's new `deps.resolveRawToken` is optional; existing tests omit it and continue working with the prior `rawToken=""` default.

### Heartbeat registry / discovery / runner expectations updated 11 → 12

- `src/heartbeat/__tests__/check-registry.test.ts`: add `mcp-broker` to EXPECTED_FILENAMES; bump `registers all 11 known checks` → 12.
- `src/heartbeat/__tests__/discovery.test.ts`: bump `returns 11 modules` → 12.
- `src/heartbeat/__tests__/runner.test.ts`: bump expected `checkCount: 11` → 12 in HB-04 boot-log assertion; add `'mcp-broker'` to expected checks array.

## Diff Hunks (Key Touchpoints)

### `src/config/loader.ts:189-211` — auto-inject rewrite

```diff
- if (!resolvedMcpMap.has("1password") && process.env.OP_SERVICE_ACCOUNT_TOKEN) {
-   resolvedMcpMap.set("1password", {
-     name: "1password",
-     command: "npx",
-     args: ["-y", "@takescake/1password-mcp@latest"],
-     env: { OP_SERVICE_ACCOUNT_TOKEN: process.env.OP_SERVICE_ACCOUNT_TOKEN },
-     optional: false,
-   });
- }
+ if (!resolvedMcpMap.has("1password") && process.env.OP_SERVICE_ACCOUNT_TOKEN) {
+   resolvedMcpMap.set("1password", {
+     name: "1password",
+     command: "clawcode",
+     args: ["mcp-broker-shim", "--pool", "1password"],
+     env: {
+       OP_SERVICE_ACCOUNT_TOKEN: process.env.OP_SERVICE_ACCOUNT_TOKEN,
+       CLAWCODE_AGENT: agent.name,
+     },
+     optional: false,
+   });
+ }
```

### `src/manager/daemon.ts` — broker construction (after McpProcessTracker)

```typescript
const tokenHashToRawToken = new Map<string, string>();
const collectTokenLiteral = (literal: string): string => {
  const tokenHash = createHash("sha256").update(literal).digest("hex").slice(0, 16);
  if (!tokenHashToRawToken.has(tokenHash)) tokenHashToRawToken.set(tokenHash, literal);
  return tokenHash;
};
if (process.env.OP_SERVICE_ACCOUNT_TOKEN) collectTokenLiteral(process.env.OP_SERVICE_ACCOUNT_TOKEN);

const brokerLog = log.child({ subsystem: "mcp-broker" });
const broker = new OnePasswordMcpBroker({
  log: brokerLog,
  spawnFn: ({ tokenHash, rawToken }) => {
    const child = childSpawn("npx", ["-y", "@takescake/1password-mcp@latest"], {
      env: { ...process.env, OP_SERVICE_ACCOUNT_TOKEN: rawToken },
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (mcpTracker !== null && child.pid !== undefined) {
      const syntheticOwner = `__broker:1password:${tokenHash}`;
      void mcpTracker.register(syntheticOwner, process.pid, [child.pid]);
      child.once("exit", () => { if (mcpTracker !== null) mcpTracker.unregister(syntheticOwner); });
    }
    return child;
  },
});

const shimServer = new ShimServer({
  log: brokerLog.child({ component: "mcp-broker-shim-server" }),
  broker,
  socketPath: MCP_BROKER_SOCKET_PATH,
  resolveRawToken: (tokenHash) => tokenHashToRawToken.get(tokenHash),
});

const brokerNetServer = createNetServer((socket) => shimServer.handleConnection(socket));
try {
  try { await unlink(MCP_BROKER_SOCKET_PATH); } catch {}
  await new Promise<void>((resolveListen, rejectListen) => { /* listen + onError + onListening */ });
  brokerLog.info({ socketPath: MCP_BROKER_SOCKET_PATH }, "mcp-broker listening");
} catch (err) {
  brokerLog.error({ err: String(err) }, "mcp-broker socket bind failed");
}
```

### `src/manager/daemon.ts` — post-resolveAllAgents token harvest

```typescript
for (const agent of resolvedAgents) {
  const opServer = agent.mcpServers.find((s) => s.name === "1password");
  const opServerToken = opServer?.env?.OP_SERVICE_ACCOUNT_TOKEN;
  if (typeof opServerToken === "string" && opServerToken.length > 0) {
    collectTokenLiteral(opServerToken);
  }
  const overrideUri = agent.mcpEnvOverrides?.["1password"]?.OP_SERVICE_ACCOUNT_TOKEN;
  if (typeof overrideUri === "string" && overrideUri.startsWith("op://")) {
    const resolved = secretsResolver.getCached(overrideUri);
    if (typeof resolved === "string" && resolved.length > 0) collectTokenLiteral(resolved);
  }
}
```

### `src/manager/daemon.ts` — shutdown ordering

```typescript
// Phase 108 — preDrainNotify before manager.drain
try { shimServer.preDrainNotify(); } catch (err) { log.warn({ err: ... }, "..."); }

// existing manager.drain(15_000)

// Phase 108 — drain broker after manager.drain
try { await shimServer.shutdown(2000); } catch (err) { log.warn({ err: ... }, "..."); }
try {
  brokerNetServer.close();
  try { await unlink(MCP_BROKER_SOCKET_PATH); } catch {}
} catch (err) { log.warn({ err: ... }, "..."); }
```

### `src/mcp/reconciler.ts` — skip-list

```typescript
// reconcileAllAgents
for (const name of names) {
  if (name.startsWith("__broker:")) continue;  // Phase 108 (Pitfall 6)
  ...
}

// reconcileAgent (defensive — also wired into killAgentGroup TRACK-06 closure)
if (name.startsWith("__broker:")) return;
```

### `src/manager/daemon.ts` — ConfigReloader hot-reload warning

```typescript
for (const newAgent of newResolvedAgents) {
  const newOverride = newAgent.mcpEnvOverrides?.["1password"]?.OP_SERVICE_ACCOUNT_TOKEN;
  const oldAgent = resolvedAgents.find((a) => a.name === newAgent.name);
  const oldOverride = oldAgent?.mcpEnvOverrides?.["1password"]?.OP_SERVICE_ACCOUNT_TOKEN;
  if (newOverride !== oldOverride) {
    brokerLog.error(
      { agent: newAgent.name, hadOverride: oldOverride !== undefined, hasOverride: newOverride !== undefined },
      "mcp-broker: hot-reload of OP_SERVICE_ACCOUNT_TOKEN is NOT supported — restart daemon to apply (broker token pin is sticky per-agent)",
    );
  }
}
```

## Decisions Made

### Tracker-before-broker construction order (deviation from RESEARCH.md §5)

The plan documented two valid orderings:
- **broker-before-tracker** (RESEARCH.md §5 lean): "Broker is up before agents start. Tracker registration must include broker child PID so orphan-reaper doesn't reap pool children."
- **tracker-before-broker** (planner alternative): "Construct tracker BEFORE broker (swap lines 1639 and broker insertion). Document the swap in the SUMMARY."

**Chose tracker-before-broker.** The broker's `onPoolSpawn` callback closes over the already-constructed `mcpTracker` singleton — no forward-reference / null-checks needed. The hard constraint per RESEARCH.md is "broker is up before agents start", and `manager.startAll` runs ~2500 lines below either insertion point, so both orderings satisfy it. The orphan-reaper concern is moot because the broker's `spawnFn` registers the pool child synchronously under `__broker:1password:<tokenHash>` before returning the ChildProcess to the broker — by the time the next 60s reaper tick fires (which itself runs ~2400 lines below), the entry is already in the tracker.

### ShimServer.deps.resolveRawToken (production-only injection)

The shim hashes the literal client-side and sends only `{agent, tokenHash}` over the socket (Phase 104 SEC-07). Production daemon needs the literal to spawn the pool child with the env var. Two options:

1. Send rawToken on the wire (rejected — violates SEC-07).
2. Daemon-side resolver (chosen — adds `deps.resolveRawToken: (tokenHash) => string | undefined`; daemon builds a tokenHash → rawToken Map at boot from process.env + every resolvedAgent's mcpServers/mcpEnvOverrides).

Tests omit the resolver and continue working with the prior `rawToken=""` default — the test spawnFn doesn't read the token.

### Heartbeat provider surface narrow

The 108-00 RED test asserts `Object.keys(provider) === ['getPoolStatus']` to gate the "no synthetic password_read" invariant. Production adapter is a single closure: `{ getPoolStatus: () => broker.getPoolStatus() }`. Future work that needs broker dispatch from the heartbeat (tracing, metrics) should use a separate provider type — not extend `BrokerStatusProvider`.

### Hot-reload-token rejection: log-only, no auto-restart

Pitfall 2: yaml edit changes one agent's OP_SERVICE_ACCOUNT_TOKEN mid-flight. CONTEXT.md §"Out of scope" says "restart-required". This plan emits an operator-visible error log per affected agent at hot-reload time. The broker's existing handshake-time sticky-pin check is the actual gate — a reconnecting agent with a different tokenHash on the same agentName gets rejected with `BROKER_ERROR_CODE_DRAIN_TIMEOUT` and the message "Agent token mapping changed; daemon restart required". Daemon never auto-restarts (out of scope).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Heartbeat registry / discovery / runner expected counts**
- **Found during:** Task 4 (regression sweep after registering mcp-broker)
- **Issue:** Three pre-existing test files hardcoded "11 checks" (`check-registry.test.ts`, `discovery.test.ts`, `runner.test.ts`). Adding the 12th would have left them in a known-bad state.
- **Fix:** Bumped each to 12 with a Phase 108 inline comment; added 'mcp-broker' to EXPECTED_FILENAMES + the runner.test.ts arrayContaining list.
- **Files modified:** `src/heartbeat/__tests__/check-registry.test.ts`, `src/heartbeat/__tests__/discovery.test.ts`, `src/heartbeat/__tests__/runner.test.ts`
- **Verification:** All 14 heartbeat test files / 122 tests GREEN.
- **Committed in:** `6458472` (Task 4)

**2. [Rule 3 — Blocking] ShimServer rawToken plumbing**
- **Found during:** Task 2
- **Issue:** Shim-server.ts (shipped in 108-02/03) hardcoded `rawToken: ""` with a TODO comment "108-05 wires that up". Plan 108-04 is that wiring. Without resolving rawToken to the literal, the broker's spawnFn would receive `OP_SERVICE_ACCOUNT_TOKEN=""` and the pool child would crash at first 1Password call.
- **Fix:** Added optional `deps.resolveRawToken: (tokenHash) => string | undefined` to ShimServer. Daemon injects a real resolver backed by a tokenHashToRawToken Map. Tests omit the resolver and continue working unchanged.
- **Files modified:** `src/mcp/broker/shim-server.ts`
- **Verification:** All 5 broker test files / 36 tests stay GREEN; daemon now plumbs the literal correctly.
- **Committed in:** `7d43dab` (Task 2)

---

**Total deviations:** 2 auto-fixed (both blocking — required to ship a working integration).
**Impact on plan:** Both deviations are bug-class fixes inside the integration scope. No scope creep.

## Verification Evidence

```
$ npx vitest run src/heartbeat/checks/__tests__/mcp-broker.test.ts
 Test Files  1 passed (1)
      Tests  7 passed (7)

$ npx vitest run src/mcp/broker src/cli/commands/__tests__/mcp-broker-shim.test.ts
 Test Files  5 passed (5)
      Tests  36 passed (36)

$ npx vitest run src/mcp/__tests__/reconciler.test.ts
 Test Files  1 passed (1)
      Tests  10 passed (10)

$ npx vitest run src/heartbeat
 Test Files  14 passed (14)
      Tests  122 passed (122)

$ npx vitest run src/config/__tests__/loader.test.ts -t "108-LOAD"
 Test Files  1 passed (1)
      Tests  4 passed | 96 skipped (100)

$ npx vitest run src/config/__tests__/loader.test.ts \
                 src/manager/__tests__/reconciler.test.ts \
                 src/mcp/__tests__/reconciler.test.ts \
                 src/heartbeat/checks/__tests__/mcp-broker.test.ts \
                 src/mcp/broker \
                 src/cli/commands/__tests__/mcp-broker-shim.test.ts
 Test Files  1 failed | 7 passed (8)
      Tests  1 failed | 152 passed (153)
# The 1 failure is the pre-existing DELEG canonical-text test in
# loader.test.ts (resolveSystemPromptDirectives), unchanged from the
# pre-Phase-108 baseline. Verified via `git stash` + re-run.
```

## Issues Encountered

- None during execution beyond the deviations documented above.
- Pre-existing TS errors at `src/manager/daemon.ts:231` (ImageProvider), `:2294` (schedule.handler), `:6536` (CostByAgentModel) and `src/config/loader.ts:301,345` are pre-existing and confirmed via `git stash` baseline diff. None caused by Phase 108 work.
- Pre-existing test failures in `clawcode-yaml-phase100.test.ts` (ENOENT — host-dependent), `daemon-openai.test.ts`, `bootstrap-integration.test.ts`, `restart-greeting.test.ts`, `session-config.test.ts`, `dream-prompt-builder.test.ts`, `daemon-warmup-probe.test.ts` are unrelated to Phase 108. Confirmed by stashing changes and re-running — same 17 pre-existing failures appear without my changes.

## Self-Check: PASSED

- All 4 task commits on disk:
  - `421d8c1` — Task 1 (loader rewire) ✓
  - `7d43dab` — Task 2 (daemon boot/shutdown wiring) ✓
  - `dea65be` — Task 3 (reconciler skip) ✓
  - `6458472` — Task 4 (heartbeat check) ✓
- All Phase 108 RED tests GREEN: 7/7 in `mcp-broker.test.ts` ✓
- Wave 1 broker tests stay GREEN: 30/30 in `src/mcp/broker/` + 6/6 in `mcp-broker-shim.test.ts` = 36/36 ✓
- Heartbeat suite full GREEN: 14/14 files / 122/122 tests ✓
- New file exists: `src/heartbeat/checks/mcp-broker.ts` ✓
- All modified files staged + committed (no orphan changes in git status) ✓

## Next Phase Readiness

**Plan 108-05 (Smoke + deploy gate) is now unblocked.** Wave 1 (108-01 through 108-04) is feature-complete:

- Loader rewires per-agent 1password to broker shim ✓
- Daemon boots broker AFTER SecretsResolver + AFTER McpProcessTracker (decision: tracker-first); ShimServer listens on `~/.clawcode/manager/mcp-broker.sock` ✓
- onPoolSpawn registers pool child PID under `__broker:1password:<tokenHash>` ✓
- Reconciler skips `__broker:` prefixed entries ✓
- Daemon shutdown order: snapshot → preDrainNotify → manager.drain → broker.shutdown(2000) → close socket ✓
- ConfigReloader hot-reload-unsupported warning on token change ✓
- Heartbeat `mcp-broker` check passes when pools alive, fails when in-use pool dead, never calls tool dispatch ✓

108-05 should:
- Spin up daemon with N fake agents on 2 tokens; assert `pgrep -ac 1password-mcp` == 2
- Crash test: `kill <pool-pid>` → verify auto-respawn within 2s + structured error to in-flight calls
- Burst test: 5 agents on token A simultaneously call `password_read`; assert all succeed via single pool child
- Token grouping cardinality test: 2 agents on token A + 1 agent on token B → 2 children
- Smoke verification commands documented in CONTEXT.md and RESEARCH.md §6

---
*Phase: 108-shared-1password-mcp-pooling*
*Completed: 2026-05-01*
