# Phase 108: Shared 1password-mcp via daemon-managed broker — Context

**Gathered:** 2026-05-01
**Status:** Ready for research
**Mode:** Operator-approved decisions on the 5 architectural opens (see <decisions> below). Promoted from backlog 999.9.

<domain>
## Phase Boundary

Today every agent spawns its own `1password-mcp` subprocess. With 11 agents that's 11 instances against the same service-account quota. Combined with daemon crash-loop boot-storm patterns (Phase 104 fixed the secret-cache side, but runtime tool-use still hits the same throttle), our service account hit a long-tail rate-limit window on 2026-04-30 that blocked ALL `op read` operations for ~10 minutes.

**Goal:** Pool one shared `1password-mcp` subprocess per unique `OP_SERVICE_ACCOUNT_TOKEN` across agents instead of one per agent. In current config (default account + finmentum scope), this drops 11 instances → 2.

**Wins:**
- ~9× fewer MCP child processes against same throttle
- Less RAM (each instance ~30–80MB)
- Less fd / process-table pressure (already an issue per Phase 999.14 incident)
- One restart of the pool re-authenticates once, not 11 times
- Pairs with Phase 999.14/15 lifecycle work — fewer children = simpler reaper / tracker

**Architecture (locked decision — see <decisions>):** Daemon hosts a **broker** that owns the single `1password-mcp` child per token. Agents connect to the broker (not directly to the MCP child) via an in-process channel (preferred — no extra IPC layer) or a unix socket (fallback if SDK requires file-based stdio). Broker multiplexes calls, attributes traces, enforces per-agent concurrency.

### Out of scope

- **Generalizing to all MCP types.** This phase is 1password-mcp ONLY. Other MCPs (mysql, brave-search, playwright, fal-ai) stay per-agent. Generalization is a future phase that can lift the broker abstraction once it proves out on 1Password.
- **Stateful MCP pooling.** 1password-mcp tool calls are stateless reads (`op read <uri>`). If a future MCP needs per-agent session state (cursor, auth context), the broker design needs revisit — out of scope here.
- **Cross-host pooling.** Single-daemon, single-host. No multi-daemon pool coordination.
- **Hot-reload of token mappings.** If `OP_SERVICE_ACCOUNT_TOKEN` env mapping changes, daemon restart required. Yagni for now.
</domain>

<decisions>
## Architectural Decisions (operator-approved 2026-05-01)

### 1. Transport — Fan-out proxy (broker)

**Decision:** Daemon hosts a broker process (or in-process module) that owns the single `1password-mcp` child per service-account token. Agents talk to the broker, not the MCP directly.

**Rationale:** MCP servers commonly speak stdio one-client-per-process. We can't assume `1password-mcp` natively supports multi-client; even if it did, a broker gives us audit/trace + concurrency control regardless. Decouples the design from upstream MCP protocol behavior.

**Implementation hint:** broker exposes a stdio-shaped interface to agents (so agent-side MCP client code is unchanged) but internally fans inbound JSON-RPC requests onto the single shared child. Researcher: confirm whether SDK's MCP client construction can accept a custom transport (in-process channel) or needs a file path.

### 2. Pool keep-alive — Drain immediately

**Decision:** When the last agent referencing a pooled instance stops, daemon sends SIGTERM to the MCP child immediately. No keep-warm TTL.

**Rationale:** Cold-start cost is tolerable (1password-mcp boot is ~1s, and pool only spins up when an agent that needs it starts). Keep-warm adds reaper complexity for marginal UX. Add later if cold-starts hurt in production.

### 3. Crash recovery — Both auto-respawn + per-call failure

**Decision:** When pooled MCP crashes:
- Broker detects exit (child SIGCHLD or stdio EOF)
- Broker auto-respawns child with same env + token
- In-flight requests (tool calls already dispatched) **fail with structured error** propagated back to each calling agent's tool handler — they retry per existing agent retry semantics
- New requests after respawn complete normally

**Rationale:** Auto-respawn keeps agents working without operator intervention. Per-call failure is honest — silently retrying could mask data integrity bugs in the pooled MCP. Agents already handle MCP tool failures via existing retry logic.

### 4. Concurrency — Per-agent semaphore (4 concurrent calls)

**Decision:** Broker enforces max 4 concurrent in-flight tool calls per agent. Above the limit, new calls queue. Total pool capacity = sum of agent semaphores (no global cap initially).

**Rationale:** Prevents one chatty agent from starving others. 4 is conservative; can tune up if agents complain about queueing. Simple to reason about: one agent's burst doesn't impact other agents.

### 5. Audit / trace — Tag broker logs with `agent` + `turnId`

**Decision:** Every JSON-RPC request the broker handles gets logged with structured fields:
- `component: "mcp-broker"`
- `pool: "1password-mcp:<scope>"` (scope = service-account name or token-hash short)
- `agent: <name>`
- `turnId: <uuid>` (propagated from the calling agent)
- `tool: <method>` (e.g. `read`)

**Rationale:** Operators can grep `journalctl -u clawcode | grep "mcp-broker" | grep "agent=fin-acquisition"` to see exactly which 1Password calls a specific agent made and when. Without this, pooling makes debugging worse than per-agent (today's logs are already greppable by PID).

</decisions>

<code_context>
## Existing Code Insights

Detailed exploration deferred to RESEARCH.md. Anchors to verify:

### Today's per-agent MCP spawn path
- `src/manager/session-adapter.ts` — where the SDK is constructed per agent, including MCP server config from `agent.mcpServers + agent.mcpEnvOverrides`. The SDK spawns each MCP child during the agent's claude session boot.
- `src/manager/secrets-resolver.ts` (Phase 104) — already resolves `op://` URIs into literal env values at daemon boot. Per-token grouping data is already implicitly available here.
- `src/mcp/proc-scan.ts` + `process-tracker.ts` (Phase 999.14/15) — orphan reaping and PID tracking. Once we pool, the broker is the only PID daemon needs to track for 1password-mcp.

### MCP client surface
- The Anthropic SDK constructs MCP clients per-agent via the agent's `mcpServers` config (stdio or http). For stdio MCPs, the SDK spawns the child process and pipes JSON-RPC over stdin/stdout.
- Researcher: confirm SDK exposes a way to inject a pre-existing transport (e.g. an in-process duplex stream) instead of spawning a fresh process. If not, we need a process-shaped wrapper that bridges stdio to the broker.

### `1password-mcp` specifics
- Currently launched via `npx -y 1password-mcp` (or similar). Researcher: confirm exact command + check whether the project supports any multi-client mode (env var, flag, config). If yes — much simpler. If no — broker is required.
- Tool surface: primary tool is `read` (`op read op://vault/item/field` style). Stateless. Each call is independent. Pooling is safe.

### Token mapping today
- yaml `agents[].mcpEnvOverrides.OP_SERVICE_ACCOUNT_TOKEN` per-agent
- Two distinct tokens in current fleet: default scope + finmentum scope
- Phase 104's SecretsResolver already groups by op:// URI; per-token grouping is straightforward to derive (group agents by `mcpEnvOverrides.OP_SERVICE_ACCOUNT_TOKEN` value after resolution).

### Lifecycle integration
- `src/manager/daemon.ts` boot wiring — broker initialization sits alongside SecretsResolver + McpProcessTracker setup
- `src/manager/snapshot-manager.ts` (Phase 999.6) — pre-deploy snapshot must capture pool state OR explicitly tear down pool first; researcher to recommend
- Heartbeat checks may need a "pool" target (analog to the per-agent inbox check) — researcher to assess
</code_context>

<specifics>
## Specifics for Researcher

1. **Confirm `1password-mcp` runtime.** Locate the actual command in `clawcode.yaml` on this repo (likely `/etc/clawcode/clawcode.yaml` on clawdy, mirror in repo). Get the exact npm package name, version, and command. Investigate the project's GitHub README / source for any multi-client / pooling support hints.

2. **SDK transport injection capability.** Does `@anthropic-ai/claude-agent-sdk@0.2.x` allow constructing an MCP client with a custom transport (in-process duplex stream, or a unix socket path)? Look at `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` for the MCP server config type. If only stdio command+args is supported, we need a process-shaped wrapper.

3. **JSON-RPC framing.** Confirm `1password-mcp` uses standard MCP JSON-RPC framing (one JSON object per line, or with Content-Length headers). Broker fan-out logic depends on correct framing.

4. **Tool call statelessness.** Audit `1password-mcp`'s tools. If any are stateful (e.g. session-bound auth flow), broker design needs adjustment. Per current evidence (`op read` is stateless), should be safe — but verify.

5. **Snapshot integration.** When daemon shuts down (Phase 999.6 snapshot writer fires first), do we tear down the pool BEFORE snapshot writes (clean shutdown) or AFTER (pool dies with daemon naturally)? Recommend.

6. **Heartbeat / health check.** Should the broker expose a "pool healthy" check that heartbeat can poll? E.g. periodic `read` of a known throwaway secret to validate auth. Recommend frequency + failure semantics.

7. **Plan breakdown estimate.** Researcher recommends N plans for the planner.

## Smoke verification commands (deploy-time, planner-facing)

Researcher: surface what we'd grep / verify post-deploy. Examples:
- `pgrep -ac 1password-mcp` should be 2 (was ~5–11 before; FCC migration showed 3+ at one point)
- `journalctl ... | grep "mcp-broker" | grep "pool=1password-mcp" | grep "spawned"` should show 2 spawns post-restart
- Synthetic burst: trigger `op read` from 5 agents simultaneously; verify all return successfully and broker logs show fanout to single MCP child PID
- Broker crash test: `kill <mcp-child-pid>` directly; verify auto-respawn within ~2s and next request succeeds
</specifics>

<deferred>
## Deferred Ideas

- **Generalize broker abstraction to other MCP types** — once 1Password broker is field-proven, lift it to a `BrokeredMcpPool` abstraction; opt-in via yaml `mcpServers[].pooled: true` field. Future phase.
- **Cross-host pooling** — multi-daemon coordination. YAGNI.
- **Per-token rate-limit awareness inside broker** — broker could track 429 responses and back off automatically. Build only if production shows operators tuning concurrency.
- **Pool warm-up on daemon boot** — currently lazy (spin up on first agent need). If cold-start latency is felt, switch to eager.
- **Hot-reload token mappings** — restart-required for env changes. Tolerable.
- **Multi-pool per token** (sharding) — if a single instance can't handle the load, shard into N children behind same broker. YAGNI until measured.

</deferred>
