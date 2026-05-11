# Review: v2.6 → v2.7 — speed, reliability, resource utilization

> **This PR is for `/ultrareview` only — not for merging.** It exists solely to surface the v2.6→master diff (Phases 107 + 108 + 999.x backlog ships) for multi-agent cloud review. Diff base is the `baseline-v2.6` branch (frozen at tag `v2.6`).

## What you're reviewing

ClawCode is a multi-agent orchestration system that spawns and supervises 14+ persistent Claude Code subprocesses, each with their own Discord channel, SQLite memory store, and skills. Stack context lives in `CLAUDE.md` at repo root — read it first.

This diff is the v2.7 milestone: ~440 commits, ~535 files, dominated by two production-iterated features and a backlog cleanup wave. The system has been live on a real host (`clawdy`) throughout, so most of this code has run in production — the goal here is to find what *hasn't* surfaced yet.

## Review priorities (highest leverage first)

### 1. Phase 108 — Shared 1password-MCP broker + shim
**This is the highest-risk surface. Spend the most time here.**

Six deploy iterations, five hot-fixes. Replaces per-agent 1password MCP servers with a single pooled broker fronted by a per-agent stdio→unix-socket shim. Touches process management, IPC, secret distribution, and crash fanout — all four of our core concerns.

Key paths:
- `src/mcp/broker/` — `OnePasswordMcpBroker` (token registry + semaphore + audit), `ShimServer` (unix socket listener + handshake), `PooledChild` (id rewriter, initialize cache, crash fanout)
- `src/cli/commands/mcp-broker-shim.ts` — `clawcode mcp-broker-shim` subcommand that agents spawn instead of the real MCP server
- `src/heartbeat/checks/mcp-broker.ts` — broker liveness probe
- `src/manager/secrets-ipc-handler.ts` — daemon-side secret routing

Look for:
- **Process lifecycle:** zombie child procs on crash, orphaned unix sockets on hard restart, FD exhaustion under 14+ concurrent shims, signal-handling gaps (SIGTERM vs SIGKILL ordering)
- **IPC framing:** unix-socket framing edge cases — partial writes, EOF mid-message, slow-consumer backpressure, half-closed sockets
- **Token registry:** TOCTOU windows between registry mutation and child read, drift detection correctness (the `b50a91f` rebind-on-drift fix and `82a23fb` probe-shim filter are recent — are they sufficient?)
- **Semaphore correctness:** can the broker deadlock under request reordering? Fairness under burst load?
- **Crash fanout:** when `PooledChild` dies, do all dependent shims get notified deterministically? Any silent hangs?
- **Initialize cache:** could a stale cached `initialize` response be served to a new client expecting a different protocol version?

Recent hot-fixes to study (signal of where bugs are clustering):
- `82a23fb` broker probe-shim filter + pool drain delay
- `b50a91f` broker rebinds on token drift instead of rejecting
- `9a1f12d` "make broker integration live — 4 hot-fixes from deploy debug"

### 2. Phase 107 — Memory pipeline integrity
**Concentrated correctness risk. SQLite + sqlite-vec + cross-process consistency.**

Two pillars: dream-pass JSON enforcement (LLM output → schema), and `vec_memories` orphan cleanup (keeping the vector store consistent with the relational store on cascading deletes).

Key paths:
- `src/memory/` — `MemoryStore`, `memory-flush`, `memory-retrieval`, `memory-cue`, `memory-chunks`, `memory-scanner`
- `src/manager/memory-lookup-handler.ts`, `src/manager/memory-graph-handler.ts`
- `src/manager/session-memory.ts`

Look for:
- **Cascade correctness:** any path that deletes from `memories` without also cleaning `vec_memories`? Any path that inserts into `vec_memories` without a matching `memories` row? Foreign-key vs. trigger consistency.
- **Concurrent writers:** two flushes racing for the same session — can rows be lost or double-inserted? WAL behavior under crash mid-transaction.
- **Embedding pipeline:** if embedding generation fails, what's the recovery path? Is there a "queued for embedding" tombstone, or do rows silently lack vectors?
- **Schema drift:** if a migration partially applies, do queries against the new schema fail loud or silent?
- **Dream-pass fallback:** when LLM JSON fails to parse, the warn-level recovery path (`7a74ec8`, `aaf844b`) — does the fallback envelope ever produce data that downstream consumers can't distinguish from a real dream?

### 3. IPC delivery + heartbeat (touched by both 107 and 108)
**Cross-agent correctness. Easy to get subtly wrong.**

Key paths:
- `src/ipc/protocol.ts` — wire format
- `src/heartbeat/` — runner, discovery, check-registry, inbox, fs-probe, mcp-broker, mcp-reconnect
- `src/manager/daemon-fs-ipc.ts`, `src/manager/daemon-ask-agent-ipc.ts`, `src/manager/daemon-rate-limit-ipc.ts`

Look for:
- **Message ordering:** does any handler assume FIFO when the transport doesn't guarantee it?
- **Lost messages:** what happens if a child exits between `send` and `recv`? Is there a retry-with-idempotency path or just hope?
- **Heartbeat false-positives:** can `mcp-broker.ts` flag a healthy broker as dead under load, or a dead broker as alive after socket file lingers?
- **Reconnect storms:** `mcp-reconnect.ts` — bounded backoff? Thundering herd if all 14 agents reconnect simultaneously?
- **Inbox semantics:** at-most-once vs at-least-once vs exactly-once — which is implemented vs. which is documented?

### 4. Hot paths & resource use under load
**Not bugs per se — performance footguns.**

Look for:
- O(n²) or N+1 patterns where `n` = agent count or memory-row count
- Synchronous file or DB I/O on the manager event loop
- Unbounded queues, caches, or in-memory maps (especially in `src/manager/`)
- `src/scheduler/scheduler.ts`, `src/scheduler/turn-dispatcher.ts` — turn dispatch fairness
- `src/usage/rate-limit-tracker.ts` — does the tracker itself cost significant CPU when many agents are tracked?
- Any path that does `for (const agent of agents) { await something }` where `Promise.all` would be safe and 14× faster

### 5. Backlog ships (lower priority, smaller surfaces)
- `999.21` — `/get-shit-done` consolidation (slash command rewrite-at-entry pattern)
- `999.22` — soul-guard mutate-verify directive (anti-hallucinated-success)
- `999.25` — agent boot wake-order priority
- Recent fixes: `260501-nfe` (relay dispatchStream), `260501-nxm` (cached-summary fast-path API-error guard)

Quickly sanity-check these but don't dwell.

## Out of scope — please skip

- **`.planning/` directory** — markdown only, planning artifacts; no code value in reviewing
- **`tests/__fakes__/`** — test scaffolding, not production code (but flag if a fake's behavior diverges from what it's modeling)
- **CHANGELOG.md, README.md updates** — docs only
- **Roadmap docs (`docs(roadmap)` commits)** — bookkeeping only
- **Style/naming nits** — focus on logic, race conditions, resource leaks, and systemic risk
- **Test naming or organization preferences** — flag missing coverage on critical paths only

## Known issues you don't need to flag

- Typecheck errors in `src/triggers/__tests__/engine.test.ts` and `src/usage/budget.ts` — already on the fix list
- `fix/memory-persistence` branch (separate, huge cleanup) — not in this diff
- Phase 109 (image ingest) and Phase 110 (renumbering) — backlog only, no code yet

## What "speed, reliability, resource utilization" means here

- **Speed:** agent turn latency, manager event-loop responsiveness under 14+ concurrent agents, broker request throughput
- **Reliability:** survives `clawcode` daemon restart with all running agents recovering, survives 1password broker crash, survives partial network/disk/IPC failures without losing memory or messages
- **Resource utilization:** stable RSS over multi-day runtime, no FD leaks, no zombie procs, no unbounded queue/cache growth, no thundering herds on reconnect

If a finding doesn't map to one of these three, deprioritize it.

---

**Reviewer guidance:** focus depth over breadth. One high-confidence concurrency or resource-leak finding in Phase 108 is worth more than ten style suggestions across the whole diff. The system is already in production — the unknown unknowns are what we need.
