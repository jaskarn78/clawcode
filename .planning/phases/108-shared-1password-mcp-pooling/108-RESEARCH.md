# Phase 108: Shared 1password-mcp via daemon-managed broker — Research

**Researched:** 2026-05-01
**Domain:** MCP child-process pooling, JSON-RPC fan-out, daemon lifecycle integration
**Confidence:** HIGH (all critical claims verified against installed source / npm / package source)

## Summary

`@takescake/1password-mcp@2.4.2` is a standard MCP stdio server (`McpServer` + `StdioServerTransport` from `@modelcontextprotocol/sdk@^1.26.0`) that runs **one JSON-RPC client per child process** with a **process-singleton 1Password SDK client bound to a single service-account token at lazy init**. There is no native multi-client / pooling / daemon mode (verified by reading `dist/index.js` + `dist/client.js` from the published tarball; README does not document any).

The Claude Agent SDK accepts MCP server configs only as `{ command, args, env }` (stdio), `{ url, headers }` (sse/http), or `{ instance: McpServer }` (in-process SDK server) — there is **no transport-injection escape hatch**, no way to pass a duplex stream or pre-spawned child handle. This locks the architecture to the broker-as-process pattern from CONTEXT.md decision 1.

JSON-RPC framing is **newline-delimited JSON** (`'\n'` terminator, one message per line) — verified in `@modelcontextprotocol/sdk/dist/cjs/shared/stdio.js`. Fan-out is mechanically straightforward.

**Primary recommendation:** Implement the broker as an in-process module inside the daemon that owns one `child_process.spawn('npx', ['-y', '@takescake/1password-mcp@latest'], {env:{OP_SERVICE_ACCOUNT_TOKEN:...}})` per unique resolved token, plus a tiny `clawcode mcp-broker-shim` CLI subcommand that the SDK spawns per-agent (stdio bridge → daemon IPC). The shim is necessary because the SDK only accepts `command + args` for stdio MCPs; the daemon registers `mcpServers["1password"] = { command: "clawcode", args: ["mcp-broker-shim"], env: {CLAWCODE_AGENT, CLAWCODE_BROKER_TOKEN_HASH} }` for every agent, mirroring the existing pattern used by browser/search/image MCPs (`src/config/loader.ts:209-255`).

## User Constraints (from CONTEXT.md)

### Locked Decisions
1. **Transport — Fan-out proxy (broker).** Daemon hosts a broker that owns the single `1password-mcp` child per service-account token. Agents talk to the broker, not the MCP directly. (Confirmed necessary — see §2.)
2. **Pool keep-alive — Drain immediately.** When the last agent referencing a pooled instance stops, daemon SIGTERMs the MCP child immediately. No keep-warm TTL.
3. **Crash recovery — auto-respawn + per-call failure.** Broker auto-respawns on child exit; in-flight calls fail with structured error to each agent's tool handler.
4. **Concurrency — Per-agent semaphore (4 concurrent calls).** Broker enforces max 4 in-flight tool calls per agent; queues above. No initial global cap.
5. **Audit/trace — Tag broker logs with `agent` + `turnId`.** Structured fields: `component:"mcp-broker"`, `pool:"1password-mcp:<scope>"`, `agent:<name>`, `turnId:<uuid>`, `tool:<method>`.

### Claude's Discretion
- Snapshot integration ordering (recommended in §5)
- Heartbeat health-check cadence + tool choice (recommended in §5)
- Plan breakdown structure (recommended in §6)
- Process tracker hand-off shape (recommended in §5)

### Deferred Ideas (OUT OF SCOPE)
- Generalize broker abstraction to other MCP types
- Cross-host pooling
- Per-token rate-limit awareness inside broker
- Pool warm-up on daemon boot
- Hot-reload of token mappings
- Multi-pool per token (sharding)

## Phase Requirements

No formal REQ-IDs were provided in CONTEXT.md. Implicit requirements derived from CONTEXT decisions:

| Implicit ID | Description | Research Support |
|----|-------------|------------------|
| POOL-01 | One MCP child per unique resolved `OP_SERVICE_ACCOUNT_TOKEN` | §1, §4 |
| POOL-02 | Agents see unchanged stdio MCP shape (no SDK changes) | §2 — shim required |
| POOL-03 | Broker fans out JSON-RPC line-delimited messages with id-rewriting | §3 |
| POOL-04 | SIGTERM child when last agent stops; auto-respawn on crash | §5 lifecycle |
| POOL-05 | Per-agent semaphore (4 concurrent) | §6 plan structure |
| POOL-06 | Structured audit logs with agent + turnId | §6 plan structure |
| POOL-07 | Heartbeat-pollable health check | §5 |
| POOL-08 | `pgrep -ac 1password-mcp` == 2 post-deploy (was 11) | §6 smoke commands |

## Standard Stack

### Core (already installed — NO new deps)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@takescake/1password-mcp` | 2.4.2 (latest, published 5 days ago) | The MCP server being pooled | Already pinned via `npx -y @takescake/1password-mcp@latest` in `src/config/loader.ts:195` |
| `@modelcontextprotocol/sdk` | ^1.26.0 | JSON-RPC framing reference | Already a transitive dep of `@takescake/1password-mcp`. Broker uses framing but does NOT import — pure newline split is enough |
| `@anthropic-ai/claude-agent-sdk` | 0.2.x | Agent → MCP transport (locked to stdio command+args) | Already in stack. Type defs at `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` lines 868-873 |
| `node:child_process` | builtin | Spawn pooled child per token | Already used by `src/clawcode/`, etc. No new dep. |
| `node:net` | builtin | Unix socket between shim and daemon | Already used by daemon IPC server (`src/ipc/`). Reuse the existing IPC socket OR create a dedicated `mcp-broker.sock` |
| `pino` | 9.x | Structured logs (audit trail) | Already in stack. Use `log.child({ subsystem: "mcp-broker" })` per existing pattern (`src/manager/daemon.ts:1577`) |

**Verification:** `npm view @takescake/1password-mcp version` → `2.4.2` (published 2026-04-26). Tarball pulled and inspected at `/tmp/1pmcp-inspect/package/`.

### Alternatives Considered (rejected per CONTEXT.md decision 1)

| Instead of broker | Could Use | Why rejected |
|------------|-----------|----------|
| `child_process` broker | `McpSdkServerConfigWithInstance` (in-process MCP server) | The 1password tools must be backed by the upstream `@takescake/1password-mcp` server. We could in theory rewrite the 8 tools as a thin pass-through `McpServer` that calls `@1password/sdk` directly — but that violates "no new npm deps" (would need `@1password/sdk` directly), reimplements the upstream tool surface, and tracks every upstream tool addition. **Rejected.** |
| Broker | Native multi-client mode in 1password-mcp | Verified NOT supported (README + source). |
| Custom transport injection into SDK MCP client | (none — type system forbids) | `McpStdioServerConfig` is `{ type?: 'stdio'; command: string; args?; env? }` — string literal types. No `transport`/`process`/`stream` field. The SDK constructs the child internally. |

### What NOT to use

| Avoid | Why |
|-------|-----|
| `execa` | Adds dep — `child_process.spawn` is fine and already used elsewhere |
| `JSON.parse`-then-stringify-rewrite of every line | Allowed when rewriting `id`. Avoid full re-validation; preserve byte-identical content for non-id fields to limit surface. |
| LSP-style Content-Length framing | Verified NOT used by `@modelcontextprotocol/sdk` stdio transport |

## Architecture Patterns

### Recommended structure

```
src/
├── mcp/
│   ├── broker/
│   │   ├── broker.ts             # OnePasswordMcpBroker class — owns Map<tokenHash, PooledChild>
│   │   ├── pooled-child.ts       # spawn / respawn / line-framed pipe / id rewriter
│   │   ├── shim-server.ts        # daemon-side IPC server (per-agent connection acceptor)
│   │   └── types.ts              # BrokerRequest / BrokerResponse / BrokerEvent
│   └── (existing: process-tracker.ts, orphan-reaper.ts, reconciler.ts, ...)
├── cli/
│   └── commands/
│       └── mcp-broker-shim.ts    # `clawcode mcp-broker-shim` — agent-side stdio↔IPC bridge
└── manager/
    └── daemon.ts                 # add: const broker = new OnePasswordMcpBroker(...) wiring (§5)
```

### Pattern 1: Daemon-singleton broker, agent-side shim (the locked decision)

**What:** Broker is an in-process module inside the daemon. Per agent, the SDK spawns a tiny `clawcode mcp-broker-shim` CLI subcommand whose stdio is connected to the SDK's MCP client. The shim opens a unix-domain-socket connection to the daemon broker and pipes line-delimited JSON-RPC bidirectionally. The broker fans inbound requests onto a single `1password-mcp` child per token, rewriting JSON-RPC `id` fields to disambiguate concurrent in-flight calls from different agents.

**Why this shape:** SDK only accepts `command + args` for stdio MCPs (verified, `sdk.d.ts:868-873`). The shim is the smallest possible "process-shaped wrapper" mentioned in CONTEXT.md decision 1. Mirrors the existing precedent of `clawcode browser-mcp` / `clawcode search-mcp` / `clawcode image-mcp` (`src/config/loader.ts:213, 232, 250`) — daemon owns the singleton, per-agent subprocess is a thin IPC translator. This pattern is already battle-tested in the codebase.

**Example wiring (in `src/config/loader.ts:189-200` — replace existing 1password block):**
```typescript
// Replace the current direct npx command with broker shim. The broker
// itself spawns the real npx 1password-mcp inside the daemon process.
if (!resolvedMcpMap.has("1password") && process.env.OP_SERVICE_ACCOUNT_TOKEN) {
  resolvedMcpMap.set("1password", {
    name: "1password",
    command: "clawcode",
    args: ["mcp-broker-shim", "--pool", "1password"],
    env: {
      OP_SERVICE_ACCOUNT_TOKEN: process.env.OP_SERVICE_ACCOUNT_TOKEN,
      CLAWCODE_AGENT: agent.name, // shim sends this on connect for audit logs
    },
    optional: false,
  });
}
```

The `OP_SERVICE_ACCOUNT_TOKEN` in the shim's env is what the broker uses as the **token-grouping key** (or its hash for log redaction) to find/spawn the right pooled child. The shim itself never reads or transmits the token literal beyond the connect-handshake.

### Pattern 2: JSON-RPC `id` rewriting (the only stateful piece)

**What:** MCP requests have a per-message `id`. Multiple agents will send `{"id":1,"method":"tools/call",...}` simultaneously — the broker MUST rewrite ids on the way down (`agentSeq → poolSeq`) and reverse on the way up so the right response goes to the right agent.

**Why:** Without id rewriting, two agents both sending id=1 will see one response routed to the wrong agent and the other request hung. This is the broker's only stateful invariant.

**Implementation hint:**
```typescript
// pooled-child.ts (sketch)
const inflight = new Map<number, { agentId: string; agentRequestId: string|number }>();
let nextPoolId = 1;

function dispatch(agentId: string, msg: JsonRpcRequest) {
  const poolId = nextPoolId++;
  inflight.set(poolId, { agentId, agentRequestId: msg.id });
  child.stdin.write(JSON.stringify({ ...msg, id: poolId }) + "\n");
}

// on each newline-framed line from child.stdout:
function onChildResponse(msg: JsonRpcResponse) {
  const route = inflight.get(msg.id as number);
  if (!route) return; // late response after agent disconnect — drop
  inflight.delete(msg.id as number);
  routeToAgent(route.agentId, { ...msg, id: route.agentRequestId });
}
```

Notifications (no `id`) and `tools/list` responses (which are stateless catalog reads) flow normally — only requests need rewriting.

### Pattern 3: Initialization replay

**What:** Each agent's MCP client sends `initialize` on connect. The broker MUST respond per-agent (cannot just forward to the shared child, since the child only does `initialize` once per process lifetime).

**Why:** MCP protocol semantics — `initialize` is a handshake, not a regular request. After the broker has connected to the pooled child once and cached the `serverInfo` + `capabilities`, every new agent connection gets the cached response synthesized by the broker, not a real round-trip.

**Source:** `@modelcontextprotocol/sdk/dist/cjs/server/stdio.js` — `StdioServerTransport.start()` reads `initialize` once and rejects further `initialize` calls. The child cannot service N `initialize` calls.

### Anti-Patterns to Avoid

- **Spawning child per agent connection** — defeats the whole point of pooling.
- **Forwarding `initialize` to the pooled child** — child only handles one (see Pattern 3).
- **Pass-through without `id` rewriting** — silent response misrouting (see Pattern 2).
- **Letting the shim hold the literal token in env** — if you DO need it there for the broker handshake, ensure it never lands in pino logs (use `tokenHash = sha256(token).slice(0,8)` in all log fields). Phase 104's SEC-07 invariant applies.
- **Per-tool-call respawn** — child is meant to live for the duration of any agent referencing this token. Phase 104 boot-storm class of bug.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON-RPC line framing | Custom parser | Plain `\n`-split with newline-buffering | Verified framing is just newline-delimited JSON. A `readline.createInterface({ input: child.stdout })` is sufficient. |
| Daemon ↔ shim IPC | Custom protocol | Reuse existing daemon IPC socket or use a dedicated `node:net` unix socket | Daemon already has IPC infrastructure (`src/ipc/`). One more endpoint is cheap. |
| MCP client implementation in shim | Manual JSON-RPC client in shim | The shim is a **dumb byte pipe** — read agent stdin, write to socket; read socket, write to agent stdout | Rebuilding MCP client semantics in the shim is unnecessary and error-prone. The shim should be ~50 LOC. |
| Token grouping logic | New token-collector | Reuse `secretsResolver.getCached(uri)` (`src/manager/secrets-resolver.ts:127`) + iterate resolved agents | Phase 104 already produces resolved literal token values per agent. See §4. |
| Log redaction | Custom redaction layer | Phase 104 invariant: never log resolved values, only URIs / hashes. Extend by adding `tokenHash` field to broker log child | Phase 104 SEC-07 already audited |

**Key insight:** ~60% of the broker code is plumbing the daemon already has (logging child, IPC socket, process tracker, secrets resolver). The genuinely-new code is: (a) `id` rewriting, (b) per-agent semaphore, (c) initialize cache-and-replay, (d) child respawn-with-error-fanout.

## Runtime State Inventory

This is a NEW feature (no rename / migration), so most categories are empty. Documented for completeness because the phase touches process lifecycle.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — broker is in-memory only. No new SQLite tables, no new files. | None |
| Live service config | The daemon has 11 agents currently spawning their own `1password-mcp` child via the SDK. Post-deploy each agent will spawn a `clawcode mcp-broker-shim` instead — visible in `ps` differently. **Existing dashboards / alerts that grep for `1password-mcp` cmdlines will need re-checking.** | Audit `src/cli/commands/__tests__/mcp-tracker.test.ts:84` (`"npm exec @takescake/1password-mcp"` pattern) — confirm tracker pattern still matches the daemon-side pooled child (yes, the broker still spawns it via `npx`, so `pgrep` works); add a separate pattern for shim if needed |
| OS-registered state | None. systemd unit (`/etc/systemd/system/clawcode.service`) already runs the daemon — broker boots inside it. | None |
| Secrets/env vars | `OP_SERVICE_ACCOUNT_TOKEN` env injection is **unchanged in shape** — still flows agent yaml → `mcpEnvOverrides.1password.OP_SERVICE_ACCOUNT_TOKEN` → resolver → loader → SDK env. Only difference: the env now lands in the **shim's** process env (used as the broker token-grouping key) instead of directly in the npx-spawned MCP. The literal token also flows through to the broker for actual child spawn. | None for SOPS/op:// — keys unchanged. Confirm: shim env masking on logs (existing pino redaction config). |
| Build artifacts | None — fully internal change. `clawcode mcp-broker-shim` is a new CLI subcommand registered alongside `browser-mcp` / `search-mcp` / `image-mcp` in `src/cli/`. | Add to `src/cli/index.ts` command registry. |

**The canonical question:** *After every file in the repo is updated, what runtime systems still have the old string cached, stored, or registered?* — **Nothing.** This is in-process only. No external service references the per-agent MCP children.

## Common Pitfalls

### Pitfall 1: `initialize` race on broker first-spawn
**What goes wrong:** First agent to connect drives the pool spawn. While that agent's `initialize` is still in flight to the child, a second agent connects and sends its own `initialize`. If the broker forwards both, the child rejects the second.
**Why it happens:** The pool init is async — child fork → process boot → first JSON-RPC `initialize` round-trip. Window is ~500ms-1s.
**How to avoid:** Cache the first child `initialize` result; subsequent agent `initialize` calls are answered from cache without ever hitting the child. Pattern 3 above.
**Warning signs:** Random agent boot failures with `Server initialization rejected` in MCP client logs after deploy.

### Pitfall 2: Token cardinality drift across hot-reload
**What goes wrong:** `clawcode.yaml` reload changes one agent's `OP_SERVICE_ACCOUNT_TOKEN` from token A → token B. Token A pool is still warm with N other agents on it; token B pool may need to spawn fresh.
**Why it happens:** ConfigReloader exists (`src/manager/config-reloader.ts`) and applies live changes including secrets diffs (`daemon.ts:4084`).
**How to avoid:** CONTEXT.md decision punts hot-reload of token mappings to "restart-required" (deferred). For Phase 108: the broker MUST detect the token change at agent re-register and either error loudly OR drop the agent's connection (forces SDK reconnect — broker spawns or re-uses the new pool). Recommend: **error loudly with a clear message + log entry** ("hot-reload of OP_SERVICE_ACCOUNT_TOKEN not supported; restart daemon"). This is the simplest correct behavior consistent with the deferred decision.
**Warning signs:** Agent calls succeed on the wrong token after a yaml edit (silent data leak across vault scopes).

### Pitfall 3: SIGTERM-of-pool while in-flight calls exist
**What goes wrong:** Last agent disconnects → broker SIGTERMs the child immediately (decision 2). But what if the agent's MCP client had a request in flight at disconnect moment?
**Why it happens:** SDK lifecycle: agent stops → SDK closes stdio to shim → shim drops broker socket → broker decrements refcount → if zero, kill child. Race window: if the child has a half-written response on stdout when the kill fires, the response is lost.
**How to avoid:** Drain inflight = 0 wait of ~500ms (with hard ceiling 2s) before SIGTERM. If still inflight, fail those calls with the structured error from decision 3 BEFORE killing.
**Warning signs:** Agent stop logs followed within seconds by `EPIPE` writing to dead child.

### Pitfall 4: pino logging the literal token
**What goes wrong:** Any `log.error({ env: child.env }, ...)` will dump `OP_SERVICE_ACCOUNT_TOKEN`. Phase 104 SEC-07 invariant.
**How to avoid:** All broker logs MUST use `tokenHash = sha256(token).slice(0,8)`. Add a unit test that scans broker pino output and asserts no string matching `^ops_` (1Password service-account token prefix).
**Warning signs:** `journalctl -u clawcode | grep ops_` returns anything.

### Pitfall 5: Shim ↔ daemon socket fragility
**What goes wrong:** Daemon restarts; existing agent shims hold dead socket connections; new agent calls hang.
**How to avoid:** Shim should detect socket close (`net.Socket` `'close'` event) and exit non-zero. SDK detects MCP child exit and reconnects per existing logic. Test: kill daemon, watch agent recover after daemon restart.
**Warning signs:** Agents stuck in `mcp:1password disconnected` after a daemon restart.

### Pitfall 6: Reconciler kills the pooled child
**What goes wrong:** `src/manager/reconciler.ts` (Phase 999.15) reconciles per-tick that each agent's tracker entry MCP PIDs match `/proc`. With pooling, a *single* PID services many agents. Naive reconciler logic could see "agent X registered for PID P; PID P is also serving agent Y; expected only X" and SIGTERM P during cleanup of X's entry.
**How to avoid:** McpProcessTracker integration must register the pooled child PID under a **synthetic owner** (e.g. `agent: "__broker:1password:<tokenHash>"`) and **not** under per-agent entries for the 1password slot. Per-agent entries continue to track the shim PID (which is per-agent and dies with the agent normally). The broker is the only thing allowed to kill pool children. See §5.
**Warning signs:** Pool child SIGTERMd unexpectedly during multi-agent stop sequence.

## Code Examples

Verified patterns (sources cited):

### MCP stdio framing — broker can split on `\n` directly
```typescript
// Source: node_modules/@modelcontextprotocol/sdk/dist/cjs/shared/stdio.js
// (verified — entire file is ~36 lines, framing is naked newline split)
const index = this._buffer.indexOf('\n');
// ... line = this._buffer.slice(0, index);
// deserializeMessage(line) === JSON.parse(line);
```
**Implication for broker:** `readline.createInterface({ input: child.stdout })` per pooled child is sufficient. No header parsing, no length prefix.

### 1password-mcp tool surface (8 tools, NOT 1)
```javascript
// Source: /tmp/1pmcp-inspect/package/dist/tools/index.js
registerVaultList(server);              // vault_list — read
registerItemLookup(server);             // item_lookup — read
registerItemDelete(server);             // item_delete — WRITE
registerPasswordCreate(server);         // password_create — WRITE
registerPasswordRead(server);           // password_read — read
registerPasswordUpdate(server);         // password_update — WRITE
registerPasswordGenerate(server);       // password_generate — read (compute)
registerPasswordGenerateMemorable(server); // password_generate_memorable — read (compute)
```
**CONTEXT.md said** "primary tool is `read`. Stateless. Each call is independent." That's **partially incorrect** — the surface includes write tools (`item_delete`, `password_create`, `password_update`). They are nonetheless **stateless across calls** (no cursor, no transaction handle — every call is a fresh request to `@1password/sdk`). Pooling is still safe; the audit log just needs to make tool name visible (which decision 5 already covers via `tool: <method>`).

### SDK MCP server config — locked to command+args+env
```typescript
// Source: node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:868-873
export declare type McpStdioServerConfig = {
    type?: 'stdio';
    command: string;
    args?: string[];
    env?: Record<string, string>;
};
```
**No `transport`, `process`, `stream`, or `socket` field exists.** Verdict: shim is required.

### 1password-mcp's process-singleton client
```javascript
// Source: /tmp/1pmcp-inspect/package/dist/client.js
let clientPromise; // module-level
export async function getClient() {
    if (!clientPromise) {
        const token = requireServiceAccountToken();
        clientPromise = createClient({ auth: token, ... });
    }
    return clientPromise;
}
```
**Implication:** Once a `1password-mcp` child boots, its 1Password SDK client is locked to the env-injected token forever. Confirms one-child-per-token grouping is necessary.

### Existing precedent — daemon-owned MCP, per-agent shim
```typescript
// Source: src/config/loader.ts:209-219
if (browserEnabled && !resolvedMcpMap.has("browser")) {
  resolvedMcpMap.set("browser", {
    name: "browser",
    command: "clawcode",
    args: ["browser-mcp"],
    env: { CLAWCODE_AGENT: agent.name },
    optional: false,
  });
}
```
The exact pattern Phase 108 needs. Browser/Search/Image MCPs are already daemon-owned singletons with per-agent stdio bridges. 1password just becomes the fourth.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-agent `npx -y @takescake/1password-mcp@latest` (11 children for 11 agents) | Pooled child per token (2 children for 11 agents) | This phase | ~9× fewer MCP children. Less RAM, less FD pressure, fewer auth round-trips on restart. |
| `sqlite-vss` (deprecated) | `sqlite-vec` | Already in stack | Unrelated — included only because CLAUDE.md mentions it |

**Deprecated/outdated:**
- The CONTEXT.md statement "primary tool is `read`" understates the surface. **8 tools, including 3 writes.** Plan must account for this in audit logs.

## Open Questions

1. **Should the broker use the existing daemon IPC socket or a dedicated `mcp-broker.sock`?**
   - What we know: daemon already has IPC infra (`src/ipc/`). One more endpoint is trivial.
   - What's unclear: whether the existing socket's auth/permissions model fits per-agent shim connections (the existing IPC is operator-CLI oriented).
   - Recommendation: **dedicated `mcp-broker.sock`** under the daemon's runtime dir. Simpler permission model (owner-only), simpler protocol (binary newline-framed JSON, no method dispatch), zero blast radius if it crashes. Reuse pino + structured-error patterns from existing IPC.

2. **What's the timeout/SLA for a broker call?**
   - What we know: 1Password SDK calls typically resolve in 100-500ms (auth + API). Rate-limit responses can be slow.
   - What's unclear: Whether to add a per-call timeout in the broker (e.g. 30s) on top of the agent-side SDK timeout.
   - Recommendation: **No broker-side timeout** for v1. The agent's SDK already has timeouts; doubling them risks confusing failure modes. If field-observed hangs occur, add later.

3. **How does Wave 0 RED test the fan-out without 1Password?**
   - What we know: Phase 104/106 use injected fakes for `opRead`. Pattern works.
   - Recommendation: Wave 0 builds a `FakePooledChild` that implements the same `child_process.ChildProcess`-shaped surface (stdin write + stdout `'data'` events) and an `id`-rewriting test harness. Real npx 1password-mcp only runs in deploy smoke (Wave 2).

4. **Per-agent semaphore — what does "queue" mean concretely?**
   - What we know: Decision 4 says max 4 concurrent per agent.
   - Unclear: Bounded queue size? FIFO? Drop-oldest? Caller-visible queue depth?
   - Recommendation: Simple FIFO, **no upper bound** initially (queue depth telemetry surfaced via heartbeat — see §5). 4 concurrent is already conservative; agents queueing more than ~12 deep is a signal to retune the semaphore, not a correctness issue.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `npx` | Spawning pooled `@takescake/1password-mcp` child | ✓ | npm 10+ (Node 22 LTS bundled) | — |
| `node:child_process` | Broker spawning | ✓ | builtin | — |
| `node:net` | Unix socket between shim and daemon | ✓ | builtin | — |
| `@takescake/1password-mcp` | The MCP server being pooled | ✓ via npx (no local install) | 2.4.2 latest | Pin in `loader.ts` if needed |
| 1Password service account credentials | Pool spawn auth | ✓ (Phase 104 SecretsResolver pre-resolves at boot) | — | If unavailable, agent's MCP simply degrades to "failed" status per existing `onMcpResolutionError` flow |
| `pgrep` (smoke verification) | Deploy gate | ✓ | procps | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

## Lifecycle Integration Recommendations (CONTEXT.md §5–§6 → operator answers)

### Daemon boot wiring (`src/manager/daemon.ts`)

**Order matters.** Insert after SecretsResolver (which warms tokens) and BEFORE McpProcessTracker (which observes the broker child PID):

```
4.   loadConfig
4a.  new SecretsResolver  (line 1575) ← preResolveAll warms tokens
4a-bis. new OnePasswordMcpBroker  ← NEW INSERTION POINT
       ├── deps: { secretsResolver, log: log.child({subsystem:"mcp-broker"}), spawnFn: child_process.spawn }
       ├── lazy: doesn't spawn pool children until first agent connects
       └── starts unix socket listener (mcp-broker.sock)
4-bis. new McpProcessTracker  (line 1639) ← reaper sees broker child PIDs
       └── broker registers each pool spawn under synthetic agent name
              `__broker:1password:<tokenHash>`
       (this avoids Pitfall 6 — reconciler won't kill pool children during
        per-agent cleanup)
5+.  Manager.startAll  (existing) → agents spawn; SDK spawns shim per agent;
       shim connects to broker socket → broker spawns pool child if needed
```

**Why before McpProcessTracker:** Tracker registration must include the broker child PID so orphan-reaper (Phase 999.14) doesn't reap pool children as orphans during a tick where no agent is in `getRegisteredAgents()`.

### Snapshot integration (`src/manager/snapshot-manager.ts`)

**Recommend:** Pool teardown happens AFTER snapshot write but BEFORE manager.drain. Concretely, in `daemon.ts:4246` shutdown:

```
1. writePreDeploySnapshot  (line 4253)            ← unchanged
2. broker.preDrainNotify()  ← NEW — signal broker that no new agent connects
3. manager.drain(15000)  (line 4274)              ← unchanged; agents finish in-flight turns
4. broker.shutdown(2000)  ← NEW — wait for inflight=0 with 2s ceiling, then SIGTERM all pool children, close socket
5. (rest of shutdown unchanged)
```

**Rationale:**
- Snapshot first (line 4248 invariant: "write FIRST so a hang anywhere downstream still leaves boot with a valid restore record"). Broker state is NOT in the snapshot — it's recreated lazily on next boot when agents reconnect via shim. Nothing to capture.
- `preDrainNotify` lets the broker reject new connections, draining naturally as agents exit.
- `broker.shutdown` runs AFTER manager.drain so any in-flight tool calls finish first (decision 3's "fail with structured error" only applies to crashes, not graceful shutdown).
- The 2s ceiling matches Pitfall 3.

### Heartbeat health check

**Recommend:** Add a `mcp-broker` check in `src/heartbeat/checks/`. Cadence: every 60s (matches existing heartbeat tick).

**What it polls:**
- Per pool: `broker.getPoolStatus(tokenHash)` → `{ alive: bool, agentRefCount: number, inflightCount: number, queueDepth: number, respawnCount24h: number }`
- Failure semantics: if `alive === false` for any pool currently referenced by an agent, emit `CheckStatus.failed` and let the existing heartbeat → recovery flow handle it (recovery may invalidate secrets via `secretsResolver.invalidate(...)` which Phase 999.10 already wires).

**Do NOT poll by sending a synthetic `password_read`** — that hits 1Password rate limits, which is exactly what we're trying to reduce. Internal liveness check (child.exitCode === null + last-stdout-byte-time within 60s) is sufficient.

### Process tracker integration (`src/mcp/process-tracker.ts`)

**Recommend:** broker registers each pooled child PID via a new `tracker.registerSystem(syntheticOwner, [pid])` method (or reuse `register(name, claudePid, mcpPids)` with `syntheticOwner` as `name` and `daemonPid` as `claudePid`).

The broker is the only entity allowed to SIGTERM pool children. Existing per-agent reconciler logic must skip entries with names matching `^__broker:` (one-line filter in `src/manager/reconciler.ts`).

Per-agent SDK shim children continue to register under the agent's normal name (the shim is just another MCP child for tracker purposes — short-lived, dies when agent stops, exactly like browser-mcp / search-mcp).

## Recommended Plan Breakdown

**6 plans, 3 waves.** Standard Phase 106/107 idiom.

### Wave 0 — RED (test scaffolding, no behavior)
- **Plan 108-01: Wave 0 — broker test harness**
  - `tests/__fakes__/fake-pooled-child.ts` — child_process-shaped mock (stdin write capture, stdout `'data'` event triggers, controlled exit)
  - `tests/__fakes__/fake-broker-socket.ts` — net.Socket-shaped pair for shim ↔ broker tests
  - Test files: `broker.test.ts`, `pooled-child.test.ts`, `shim-server.test.ts`, `mcp-broker-shim.test.ts` — all RED initially
  - Tests cover: id-rewriting, initialize cache-and-replay, semaphore queueing, child crash → in-flight error fanout, last-ref SIGTERM, token-grouping correctness
  - **Acceptance:** `vitest run` shows N failing tests in broker namespace; existing tests stay green

### Wave 1 — GREEN (parallelizable)
- **Plan 108-02: PooledChild + id-rewriter** (single token, single agent — minimal viable broker)
  - `src/mcp/broker/pooled-child.ts`
  - `src/mcp/broker/types.ts`
  - Tests pass: id-rewriting, initialize cache-and-replay, child crash → structured error
  - **Parallel with:** 108-03

- **Plan 108-03: Broker daemon-side IPC server**
  - `src/mcp/broker/shim-server.ts` (unix socket listener, per-connection handshake, agent registration)
  - `src/mcp/broker/broker.ts` (Map<tokenHash, PooledChild>, lazy spawn, refcount, last-ref SIGTERM with drain)
  - Per-agent semaphore (4 concurrent) wired here
  - **Parallel with:** 108-02

- **Plan 108-04: Agent-side shim CLI subcommand**
  - `src/cli/commands/mcp-broker-shim.ts` (`clawcode mcp-broker-shim --pool 1password`)
  - Stdio bridge: agent stdin → broker socket → broker; broker → socket → agent stdout
  - Reconnect-on-daemon-restart (process exits non-zero, SDK reconnects)
  - Register CLI subcommand in `src/cli/index.ts`
  - **Sequential after:** 108-03 (needs broker socket protocol locked)

- **Plan 108-05: Loader rewire + daemon boot wiring**
  - `src/config/loader.ts:189-200` — replace direct npx with `clawcode mcp-broker-shim`
  - `src/manager/daemon.ts` — instantiate broker after SecretsResolver, before McpProcessTracker; wire shutdown ordering per §5
  - `src/manager/reconciler.ts` — skip `^__broker:` entries
  - Heartbeat check: `src/heartbeat/checks/mcp-broker.ts`
  - Audit log fields per decision 5
  - **Sequential after:** 108-02, 108-03, 108-04 (all components must exist)

### Wave 2 — Deploy gate
- **Plan 108-06: Smoke + deploy gate**
  - Integration test: spin up daemon with 5 fake agents on 2 tokens; assert `pgrep -ac 1password-mcp` == 2
  - Crash test: kill pool child PID; verify auto-respawn within 2s; verify in-flight calls receive structured error; verify next call succeeds
  - Burst test: 5 agents call `password_read` simultaneously; verify all succeed and broker logs show fan-out to single child PID
  - Token grouping test: 2 agents on token A + 1 agent on token B → 2 children
  - Smoke verification commands (decision §smoke-verification):
    - `pgrep -ac 1password-mcp` should return 2
    - `journalctl -u clawcode | grep "mcp-broker" | grep "spawned" | wc -l` should be 2 within 60s of restart
    - `journalctl -u clawcode | grep ops_` should return 0 (token leak audit)
  - **Sequential after:** all of Wave 1

### Why this breakdown
- **108-02 and 108-03 are parallelizable** because PooledChild is pure data-plane (in-process, no socket) and ShimServer is pure control-plane (socket plumbing). They glue together at 108-05.
- **108-04 follows 108-03** because the shim's wire protocol depends on the broker socket protocol shape.
- **108-05 is the integration plan** — wires loader + daemon + tracker + reconciler + heartbeat all at once. This is one coherent atomic change to the daemon boot path; splitting it leads to broken boot states between commits.
- **108-06 is the deploy gate** — runs the full smoke against a real daemon (vitest "integration" suite). Without this, Wave 1 is unverified at the integration level.

## Project Constraints (from CLAUDE.md)

| Constraint | Source | How Phase 108 honors it |
|----|----|----|
| TypeScript 6.0.2 | Stack | All new code in `.ts` |
| Node 22 LTS | Stack | `child_process.spawn` + `node:net` are stable |
| **No new npm deps** | CLAUDE.md "What NOT to Use" | Verified — broker uses only builtins + already-installed `pino`. No `execa`, no `eventemitter3`, no JSON-RPC library. |
| `@anthropic-ai/claude-agent-sdk@0.2.x` is the orchestration layer | Stack | Broker integrates BELOW the SDK (SDK still spawns the shim normally) — no SDK-internal modifications |
| File size 200-400 typical, 800 max | coding-style.md | Broker split into 4 files (broker.ts, pooled-child.ts, shim-server.ts, types.ts) — each ≤ 300 LOC realistic |
| Many small files > few large files | coding-style.md | Plan structure honors this (4 broker files + 1 shim file + 1 heartbeat check) |
| Immutability | coding-style.md | Tracker entries already immutable (Phase 999.15 invariant); broker should construct new state objects on every change |
| No hardcoded secrets / parameterized queries / input validation | security.md | Token never logged literally; all log fields use `tokenHash`. Broker socket: agent name validated against resolved-config map (no path-traversal etc) |
| GSD workflow enforcement | CLAUDE.md | This RESEARCH.md is part of `/gsd:research-phase` |

## Validation Architecture

> Note: `.planning/config.json` not inspected for `nyquist_validation` flag. Section included by default. Planner: skip if explicitly disabled.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.x (project standard, see `vitest.config.ts`) |
| Config file | `/home/jjagpal/.openclaw/workspace-coding/vitest.config.ts` |
| Quick run command | `npx vitest run src/mcp/broker/` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| POOL-01 | One MCP child per unique resolved token | unit | `npx vitest run src/mcp/broker/__tests__/broker.test.ts -t "token-grouping"` | ❌ Wave 0 |
| POOL-02 | Loader rewires 1password to shim command | unit | `npx vitest run src/config/__tests__/loader.test.ts -t "108"` | ❌ Wave 0 |
| POOL-03 | id-rewriter routes responses correctly under concurrent dispatch | unit | `npx vitest run src/mcp/broker/__tests__/pooled-child.test.ts -t "id-rewrite"` | ❌ Wave 0 |
| POOL-04 | SIGTERM on last ref; auto-respawn on crash | unit | `npx vitest run src/mcp/broker/__tests__/broker.test.ts -t "lifecycle"` | ❌ Wave 0 |
| POOL-05 | Per-agent semaphore queues at 5th concurrent call | unit | `npx vitest run src/mcp/broker/__tests__/broker.test.ts -t "semaphore"` | ❌ Wave 0 |
| POOL-06 | Audit log fields present on every dispatched call | unit | `npx vitest run src/mcp/broker/__tests__/broker.test.ts -t "audit"` | ❌ Wave 0 |
| POOL-07 | Heartbeat check returns failed when pool dead | unit | `npx vitest run src/heartbeat/checks/__tests__/mcp-broker.test.ts` | ❌ Wave 0 |
| POOL-08 | pgrep -ac 1password-mcp == 2 with 5 agents on 2 tokens | integration | `npx vitest run src/mcp/broker/__tests__/integration.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run <changed_files>`
- **Per wave merge:** `npx vitest run src/mcp/broker/ src/cli/commands/ src/manager/ src/config/ src/heartbeat/`
- **Phase gate:** `npx vitest run` (full suite green before `/gsd:verify-work`)

### Wave 0 Gaps
- [ ] `src/mcp/broker/__tests__/broker.test.ts` — covers POOL-01, POOL-04, POOL-05, POOL-06
- [ ] `src/mcp/broker/__tests__/pooled-child.test.ts` — covers POOL-03 + initialize cache-and-replay (Pitfall 1)
- [ ] `src/mcp/broker/__tests__/shim-server.test.ts` — covers connection handshake + token routing
- [ ] `src/mcp/broker/__tests__/integration.test.ts` — covers POOL-08 (multi-token multi-agent)
- [ ] `src/cli/commands/__tests__/mcp-broker-shim.test.ts` — shim stdio bridge correctness
- [ ] `src/heartbeat/checks/__tests__/mcp-broker.test.ts` — covers POOL-07
- [ ] `tests/__fakes__/fake-pooled-child.ts` — shared fixture (child_process.ChildProcess shape)
- [ ] `tests/__fakes__/fake-broker-socket.ts` — shared fixture (net.Socket pair)

## Sources

### Primary (HIGH confidence)
- `/home/jjagpal/.openclaw/workspace-coding/node_modules/@takescake/1password-mcp` — verified at runtime via `npm pack` of v2.4.2 (`/tmp/1pmcp-inspect/package/`)
- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:776-873` — McpServerConfig type definitions (verified MCP transport options are a closed set)
- `node_modules/@modelcontextprotocol/sdk/dist/cjs/shared/stdio.js` — newline-framing implementation (~36 LOC, verified)
- `src/manager/secrets-resolver.ts` — Phase 104 SecretsResolver API (read at lines 1-127)
- `src/manager/daemon.ts:1575-1675, 4246-4330` — boot order + shutdown ordering
- `src/mcp/process-tracker.ts:120-240` — McpProcessTracker register/replaceMcpPids/getRegisteredAgents API
- `src/manager/snapshot-manager.ts:62-240` — snapshot write/read lifecycle
- `src/config/loader.ts:189-255` — existing precedent (clawcode/1password/browser/search/image auto-injection pattern)
- `src/manager/session-adapter.ts:730-744` — SDK MCP transform (no transport injection escape hatch in current usage)
- `npm view @takescake/1password-mcp version` → `2.4.2` (verified 2026-05-01, published 5 days prior)

### Secondary (MEDIUM confidence)
- https://github.com/CakeRepository/1Password-MCP — README via WebFetch, confirms no documented multi-client mode

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard Stack: **HIGH** — every package version verified locally, no new deps proposed
- Architecture: **HIGH** — pattern mirrors existing battle-tested precedent (browser/search/image MCPs); SDK constraints verified in type definitions
- JSON-RPC framing: **HIGH** — verified by reading installed @modelcontextprotocol/sdk source
- Tool surface: **HIGH** — verified by reading @takescake/1password-mcp installed source (8 tools, 3 writes, all stateless)
- Token grouping: **HIGH** — Phase 104 SecretsResolver already produces resolved literals; grouping derivation is straightforward
- Lifecycle integration: **MEDIUM** — recommendations rely on operator confirmation of snapshot/heartbeat ordering preferences. Pattern-matched against Phase 999.6/999.14/999.15 idioms. Planner should validate at plan-write time.
- Pitfalls: **HIGH** — derived from concrete reads of Phase 104 (SEC-07), 999.14 (orphan reaper), 999.15 (reconciler) source code
- Plan breakdown: **MEDIUM** — 6/3 split is the standard idiom; planner may merge 108-02 + 108-03 if scope feels small at plan-write

**Research date:** 2026-05-01
**Valid until:** 2026-05-31 (30 days — stack is stable; only `@takescake/1password-mcp` minor versions might drift but tarball check is cheap to repeat)
