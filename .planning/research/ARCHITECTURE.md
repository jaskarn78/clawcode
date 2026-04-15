# Architecture Research — v1.8 Proactive Agents + Handoffs

**Domain:** Integration of trigger engine + cross-agent RPC into existing ClawCode daemon
**Researched:** 2026-04-13
**Confidence:** HIGH (grounded in existing codebase; not speculative)

---

## Executive Summary

v1.8 adds two fundamentally new capabilities: (1) **non-human turn initiation** (triggers — anything other than "a Discord user typed a message" can start an agent turn) and (2) **typed inter-agent task delegation** (handoffs — durable, schema-validated, observable task objects that survive agent crashes and produce structured returns).

**Core architectural insight:** These are two independent subsystems that share exactly one primitive — **the "turn entry point."** Today, only two things call `SessionManager.sendToAgent / streamFromAgent`: `DiscordBridge.handleMessage` (user messages) and `TaskScheduler.triggerHandler` (scheduled prompts). v1.8 adds a third and fourth: `TriggerEngine.dispatch` and `TaskRouter.deliver`.

**The right abstraction is to introduce a single shared `TurnOrigin` type and a `TurnDispatcher` helper** that both existing and new callers funnel through. This keeps the Phase 50 trace contract (`Turn` is caller-owned, `turnId` has origin prefix, `channelId` is nullable) intact, unifies observability, and gives the policy layer one chokepoint to enforce rules.

**New subsystems:** `src/triggers/` (source registry + dispatch), `src/tasks/` (SQLite task store + state machine + lifecycle). **Heavily-modified subsystems:** `daemon.ts` (wire new subsystems + IPC routes), `session-manager.ts` (expose `dispatchTurn` helper with origin metadata), `mcp/server.ts` (new `delegate_task` + `task_status` tools), `dashboard/` (task graph panel), `scheduler.ts` (refactored to be one trigger *source* rather than a parallel hot path).

---

## System Overview

### Target architecture (v1.8, changes highlighted)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          EXTERNAL EVENT SOURCES                           │
│  Discord    Cron    [NEW] Webhook HTTP    [NEW] File watch               │
│  gateway    tick     endpoint              (chokidar sinks)              │
│  (existing) (exists) (new route in dashboard/http or separate listener)  │
└────┬──────────┬──────────────┬──────────────────┬───────────────────────┘
     │          │              │                  │
     ▼          ▼              ▼                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     INGRESS LAYER (turn producers)                       │
│                                                                           │
│  DiscordBridge    [NEW] TriggerEngine                                    │
│  (existing)          ├── TriggerSourceRegistry                           │
│                      ├── PolicyEvaluator (DSL, reads agent config)       │
│                      ├── DebounceLimiter (per-source + per-agent)         │
│                      └── LoopDetector (turn chain depth, cascade cap)    │
│       │                 │                                                  │
│       └────┬────────────┘                                                 │
│            ▼                                                               │
│     ┌────────────────────────────────────────────────┐                    │
│     │ [NEW] TurnDispatcher                           │  ◄── single choke  │
│     │  - buildTurnOrigin({ source, chain, actor })   │      point for     │
│     │  - enforces loop cap (max chain depth)         │      ALL turns     │
│     │  - emits origin-prefixed turnId                │                    │
│     │  - opens caller-owned Turn + receive span      │                    │
│     └───────────────┬────────────────────────────────┘                    │
└─────────────────────┼───────────────────────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│           SessionManager (existing — minor extension)                    │
│   streamFromAgent(name, message, turn?, origin?)                         │
│   sendToAgent(name, message, turn?, origin?)                             │
└───────────────┬─────────────────────────────────────────────────────────┘
                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│           Claude Agent SDK session loop (existing)                       │
└───────────────┬─────────────────────────────────────────────────────────┘
                │
  (agent calls) │
                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                  MCP tools surface (existing + new)                       │
│                                                                           │
│   existing: memory_lookup, send_message (inbox), send_to_agent           │
│             (webhook+DM), spawn_subagent_thread, ask_advisor             │
│                                                                           │
│   [NEW] delegate_task(agent, input_schema_name, payload, timeout_ms,     │
│                       await_response?)                                   │
│   [NEW] task_status(task_id)                                             │
│   [NEW] cancel_task(task_id)                                             │
└───────────────┬─────────────────────────────────────────────────────────┘
                ▼  (IPC round-trip to daemon)
┌─────────────────────────────────────────────────────────────────────────┐
│                  [NEW] TaskRouter (in daemon)                             │
│   1. Validates input against schema registry                              │
│   2. Writes Task row to global task store (pending)                      │
│   3. Enforces policy: sender allowed to delegate to target?              │
│   4. If target asleep: chooses cold-start vs queue policy                │
│   5. Calls TurnDispatcher.dispatch({ source: "task", task_id, from })    │
│      → which calls SessionManager.streamFromAgent on target              │
│   6. Polls / listens for completion via Turn.onEnd + tool_use of          │
│      `task_complete(task_id, output)` in target's response               │
│   7. Retries on timeout/error per policy; records audit events            │
└───────────────┬─────────────────────────────────────────────────────────┘
                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                  STORAGE LAYER (existing + new)                           │
│                                                                           │
│   [NEW] ~/.clawcode/manager/tasks.db                                     │
│         global — single daemon writer                                     │
│         tables: tasks, task_events, task_audit, dead_letter_queue        │
│                                                                           │
│   Per-agent (existing): memory.db, usage.db, traces.db                   │
│   Per-agent inbox dir (existing): used as delivery fallback              │
│   Global registry.json (existing): extended with `lastTaskDeliveredAt`   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Component responsibilities

| Component | NEW or MODIFIED | Location | Responsibility |
|-----------|-----------------|----------|----------------|
| **TriggerEngine** | NEW | `src/triggers/engine.ts` | Owns all non-Discord, non-inbox event sources. Stateless dispatcher + lifecycle owner for source subscribers. |
| **TriggerSourceRegistry** | NEW | `src/triggers/sources/*.ts` | Pluggable source modules (mirrors `src/heartbeat/checks/` discovery pattern): `sources/webhook.ts`, `sources/file-watch.ts`, `sources/db-poll.ts`, `sources/inbox-arrived.ts`. Each exports `{ name, subscribe(emit): Unsubscribe }`. |
| **PolicyEvaluator** | NEW | `src/triggers/policy.ts` | Given `{ sourceEvent, agentConfig }`, returns `{ dispatch: boolean, payload: string, reason: string }`. DSL lives in agent YAML under `triggers:` (see Data Model below). |
| **TurnDispatcher** | NEW | `src/manager/turn-dispatcher.ts` | **The single entry point for ALL turns.** DiscordBridge, TaskScheduler, TriggerEngine, TaskRouter all route through it. Assigns origin-prefixed `turnId`, enforces cascade depth cap, opens caller-owned Turn, invokes SessionManager. |
| **TaskRouter** | NEW | `src/tasks/router.ts` | RPC-style dispatcher for `delegate_task`. Owns task lifecycle state machine. |
| **TaskStore** | NEW | `src/tasks/store.ts` | SQLite schema + CRUD for `~/.clawcode/manager/tasks.db`. Single-writer (daemon), readers can be other tools. |
| **TaskSchemaRegistry** | NEW | `src/tasks/schemas.ts` | Loaded from `clawcode.yaml` — named Zod schemas for task inputs/outputs. Enables typed handoffs. |
| **LoopDetector** | NEW | `src/triggers/loop-detector.ts` | Tracks `turnOrigin.chain[]` depth + per-agent per-source rate. Refuses dispatch when `chain.length >= maxDepth` (default 5). |
| **TaskGraphDashboard** | NEW | `src/dashboard/static/task-graph.js` + `src/dashboard/server.ts` routes | SSE-driven task graph visualization. |
| **SessionManager** | MODIFIED | `src/manager/session-manager.ts` | Accept optional `TurnOrigin` on `sendToAgent`/`streamFromAgent`; pass through to adapter and trace metadata. **No change to the caller-owned Turn contract.** |
| **DiscordBridge** | MODIFIED | `src/discord/bridge.ts` | Replace direct `sessionManager.streamFromAgent` call with `turnDispatcher.dispatch({ source: "discord", ... })`. Behavior identical; gains uniform observability. |
| **TaskScheduler** | MODIFIED | `src/scheduler/scheduler.ts` | Becomes ONE of the TriggerEngine's sources. Cron still owns timing; dispatch still goes through TurnDispatcher. Removes ~30 lines of duplicated trace setup. |
| **MCP Server** | MODIFIED | `src/mcp/server.ts` | Adds `delegate_task`, `task_status`, `cancel_task` tool definitions; each maps to a new IPC method. |
| **IPC Protocol** | MODIFIED | `src/ipc/protocol.ts` | Add methods: `delegate-task`, `task-status`, `cancel-task`, `tasks`, `triggers`, `trigger-fire` (manual). |
| **Daemon** | MODIFIED | `src/manager/daemon.ts` | Wire `TriggerEngine`, `TaskRouter`, `TurnDispatcher`, `TaskStore`. Add new IPC route handlers. |
| **Config Schema** | MODIFIED | `src/config/schema.ts` | Add `triggers` array and `delegation` block to agent schema; add `taskSchemas` top-level block. |
| **Dashboard Server** | MODIFIED | `src/dashboard/server.ts` | Add `/api/tasks`, `/api/tasks/:id`, `/api/triggers`, `/api/task-graph` endpoints. |

---

## Integration Point Table (how NEW talks to EXISTING)

| From (new) | To (existing) | Via | Notes |
|------------|---------------|-----|-------|
| TriggerEngine | SessionManager | TurnDispatcher | **Never directly.** All turns go through TurnDispatcher for uniform tracing + loop detection. |
| TriggerEngine | ConfigWatcher | chokidar hot-reload hook | Triggers must hot-reload when YAML changes. Reuse existing `ConfigReloader` diff mechanism. |
| PolicyEvaluator | ResolvedAgentConfig | `sessionManager.getAgentConfig(name)` | Agent config is the source of truth for what triggers apply. |
| TaskRouter | SessionManager | TurnDispatcher | Same rule. Task dispatch is just a turn with `source: "task"`. |
| TaskRouter | MessagesInbox | `src/collaboration/inbox.ts` `writeMessage` | **Fallback path** — when target agent is asleep AND policy says "queue don't wake", task is written as an inbox message with `x-task-id` metadata. Next time target wakes (or on its own schedule), heartbeat's inbox check delivers it. |
| TaskRouter | TraceCollector | `sessionManager.getTraceCollector(target)` | Records `tool_call.delegate_task.<target>` on sender's Turn, AND opens a separate receiver-side Turn on target with `task:<id>` prefix linked via `parent_turn_id` metadata. Enables cross-agent trace stitching. |
| TaskRouter | UsageTracker | existing per-agent tracker | Delegated work bills to the **target** (who executed), not the sender. Optional: add `delegated_from` column for attribution reports. |
| TurnDispatcher | TraceCollector | existing `startTurn(id, agent, channelId)` | Replaces the turn-setup blocks currently duplicated in `bridge.ts:300-376` and `scheduler.ts:86-107`. |
| MCP `delegate_task` | TaskRouter | IPC `delegate-task` | Agent's Claude session calls MCP tool → stdio MCP server → IPC to daemon → TaskRouter. |
| Dashboard task-graph panel | TaskStore | IPC `tasks` with `?graph=true` query | Returns adjacency list of in-flight + recent tasks with parent/child linkage. SSE push on state change. |
| TaskStore | MessagesInbox | filesystem write | When `taskMode: queued`, task is materialized as inbox message; TaskStore keeps the canonical record. |
| LoopDetector | TurnOrigin chain | in-memory Map keyed by root turnId | No persistence — cascades reset at daemon restart (acceptable; runaway cascades shouldn't survive restart anyway). |

---

## Data Model

### `TurnOrigin` (NEW shared type — `src/manager/turn-origin.ts`)

Every turn now carries provenance. This is the single thing that makes uniform observability and loop detection possible.

```typescript
export type TurnSource =
  | { kind: "discord"; channelId: string; messageId: string; userId: string; isThread: boolean }
  | { kind: "scheduler"; scheduleName: string; cronExpr: string }
  | { kind: "trigger"; sourceName: string; eventId: string; payload: Record<string, unknown> }
  | { kind: "task"; taskId: string; fromAgent: string; schemaName: string }
  | { kind: "manual"; actor: string };  // IPC send-to-agent from CLI/admin

export type TurnOrigin = {
  readonly source: TurnSource;
  readonly rootTurnId: string;        // The turnId that started this cascade
  readonly parentTurnId: string | null; // Immediate parent in chain
  readonly chain: readonly string[];  // All ancestor turnIds (for depth detection)
  readonly startedAt: number;          // epoch ms
};
```

`turnId` format per source (preserves Phase 50 convention):

| Source | `turnId` format | Example |
|--------|-----------------|---------|
| Discord | `<discord_message_id>` (numeric, existing) | `1234567890123456789` |
| Scheduler | `scheduler:<nanoid10>` (existing) | `scheduler:aB3dE5fG7h` |
| Trigger | `trigger:<source>:<nanoid10>` (NEW) | `trigger:webhook:xY9zA1bC2d` |
| Task | `task:<nanoid10>` (NEW) | `task:pQ4rS6tU8v` |
| Manual | `manual:<actor>:<nanoid10>` (NEW) | `manual:cli:mN3oP5qR7s` |

This lets CLI `clawcode latency <agent>` and the dashboard filter by origin prefix — a regex on `turnId` already partitions user vs scheduler latency today; we extend that to five origin classes.

### Task state machine

```
         ┌─────────────────────────────────────────────┐
         │                                             │
         ▼                                             │
      pending  ──(target asleep + queued)──► queued    │
         │                                    │        │
         │ (dispatched to target)             │        │
         ▼                                    │        │
      running ◄───(target wakes)──────────────┘        │
         │                                             │
         ├──(target calls task_complete)─► complete    │
         │                                             │
         ├──(timeout)────────────────► timed_out       │
         │                                  │          │
         │                                  │ retry    │
         │                                  └─────►────┘
         ├──(sender calls cancel_task)─► cancelled
         │
         ├──(target errors/crashes)─► failed
         │                              │ retry
         │                              └───►────┐
         │                                       │
         │                                       ▼
         │                              max retries exceeded
         │                                       │
         │                                       ▼
         └───────────────────────────────► dead_letter
```

**Awaiting-handoff-response** is NOT a separate state — it's just `running` from the sender's perspective. The sender's Turn has an open `tool_call.delegate_task.<target>` span that closes when the task reaches a terminal state. This is the simplest correct model and matches how subagent-thread spans already work (parent stays open while child runs; parent ends when child ends).

### TaskStore SQLite schema (sketch)

```sql
-- ~/.clawcode/manager/tasks.db
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,                     -- "task:<nanoid10>"
  from_agent TEXT NOT NULL,
  to_agent TEXT NOT NULL,
  schema_name TEXT NOT NULL,               -- FK-ish to TaskSchemaRegistry
  input_json TEXT NOT NULL,                -- validated by schema at insert time
  output_json TEXT,                        -- populated on complete
  state TEXT NOT NULL,                     -- pending|queued|running|complete|failed|timed_out|cancelled|dead_letter
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  timeout_ms INTEGER NOT NULL,
  parent_task_id TEXT,                     -- for nested delegations
  root_task_id TEXT NOT NULL,              -- top-level originator
  trigger_turn_id TEXT,                    -- links to traces.db on sender side
  execution_turn_id TEXT,                  -- links to traces.db on receiver side
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  error_message TEXT
);

CREATE INDEX idx_tasks_state ON tasks(state);
CREATE INDEX idx_tasks_to_agent_state ON tasks(to_agent, state);
CREATE INDEX idx_tasks_root ON tasks(root_task_id);

CREATE TABLE task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,                -- created|dispatched|progress|retried|completed|failed|cancelled|dead_lettered
  payload_json TEXT,
  ts INTEGER NOT NULL
);
```

**Why global (one db) not per-agent:** a task has TWO agents — sender and receiver. Writing it to both inboxes creates split-brain. One daemon-owned store with indexes on `from_agent`/`to_agent` gives clean queries in both directions. Single-writer (the daemon) matches existing `registry.json` / `delivery-queue.db` / `advisor-budget.db` patterns.

**Reads** can be exposed read-only to other processes (CLI, future admin tools) via IPC, not direct DB access.

### Policy DSL (agent YAML)

Living in each agent's config (not a separate `policies.yaml`) because **triggers are agent-scoped behavior** and should version with the agent config. This matches how `schedules:` and `slashCommands:` already live per-agent.

```yaml
agents:
  - name: ops
    triggers:
      - name: error-log-watcher
        source: file-watch
        config:
          paths: ["/var/log/app/errors.log"]
          pattern: "ERROR"
        throttle:
          minIntervalSeconds: 60
          maxPerHour: 10
        payload: |
          New errors detected in {{file}}:
          {{lastNLines 5}}
      - name: daily-standup-reminder
        source: scheduler
        config:
          cron: "0 9 * * 1-5"
        payload: "Time for the daily standup digest."
    delegation:
      acceptsFrom: ["planner", "researcher"]   # allowlist
      acceptsSchemas: ["research-request", "code-review-request"]
      maxConcurrent: 2
      cooldownMs: 500
```

**Evaluation timing:**
1. **Subscription time** (daemon startup + config reload): TriggerEngine reads `triggers[]` from each agent config, asks source registry to subscribe.
2. **Fire time** (event arrives): source calls `emit(event)`. PolicyEvaluator renders `payload` template + applies `throttle` + asks LoopDetector. If all pass → TurnDispatcher.

---

## Build Order (dependency DAG)

```
Phase A: Foundations                 (no deps)
  ├── TurnOrigin type + TurnDispatcher
  ├── SessionManager accepts origin parameter (pass-through, no behavior change yet)
  ├── Refactor DiscordBridge + TaskScheduler to use TurnDispatcher
  │   (net-zero behavior change, pure refactor — proves the abstraction)
  └── Verification: existing Phase 50 bench still green

Phase B: Task store + state machine   (depends on A)
  ├── TaskStore SQLite schema + CRUD + migrations
  ├── TaskSchemaRegistry (load named Zod schemas from clawcode.yaml)
  ├── TaskRouter state machine (pending → running → terminal)
  │   (no MCP tool yet; unit-testable in isolation)
  └── Verification: unit tests for state transitions, schema validation, retries

Phase C: Cross-agent RPC              (depends on A + B)
  ├── MCP tools: delegate_task, task_status, cancel_task
  ├── IPC methods: delegate-task, task-status, cancel-task, tasks
  ├── TaskRouter wires to TurnDispatcher for dispatch
  ├── task_complete tool (MCP) — target agent reports completion
  │   (this closes the sender's tool_call.delegate_task span)
  └── Verification: agent A delegates → agent B completes → sender gets result

Phase D: Trigger engine foundation   (depends on A)
  ├── TriggerEngine + TriggerSourceRegistry (discovery pattern, like heartbeat checks)
  ├── PolicyEvaluator + DSL Zod schema in agent config
  ├── LoopDetector (chain depth + per-agent-per-source rate)
  ├── One built-in source: `scheduler` (migrate TaskScheduler to be a source)
  │   (this proves the abstraction is correct — behavior still identical)
  └── Verification: scheduler cron still fires, latency traces unchanged

Phase E: Additional trigger sources  (depends on D)
  ├── sources/file-watch.ts (chokidar on arbitrary paths)
  ├── sources/webhook.ts (HTTP POST endpoint on dashboard server; separate mount path)
  ├── sources/db-poll.ts (SQL query on interval against configured DB)
  ├── sources/inbox-arrived.ts (refactor existing inbox heartbeat check into a trigger source)
  └── Verification: each source fires a turn end-to-end with correct TurnOrigin

Phase F: Observability + operator surfaces  (depends on B + C + E)
  ├── Dashboard: task graph panel + trigger activity panel
  ├── CLI: `clawcode tasks`, `clawcode tasks <id>`, `clawcode triggers`
  ├── Task retention heartbeat check (prune terminal tasks older than N days)
  └── Verification: end-to-end operator flow — fire trigger, see task graph, drill to latency

Phase G: Policy + security hardening  (depends on C + E)
  ├── delegation.acceptsFrom allowlist enforcement
  ├── delegation.maxConcurrent + cooldown
  ├── Dead-letter queue surfacing + retry CLI
  ├── LoopDetector cascade-cap alerts → Discord embed
  └── Verification: security-reviewer agent; no cross-agent escape paths
```

**Critical ordering rule:** Phase A (TurnDispatcher refactor) MUST land first and be verified as net-zero before B-F build on top. It's the load-bearing primitive.

---

## Answers to the Specific Questions

### 1. Where does the TRIGGER engine live?

**New top-level subsystem in `src/triggers/`, owned by daemon, NOT an extension of TaskScheduler, NOT a separate process.** Rationale:

- **Not TaskScheduler extension:** TaskScheduler is timing-specific. Triggers include webhook hits (HTTP request), file changes (chokidar), DB state changes (poll), inbox arrivals (filesystem watch). Conflating timing with event sources would force every future source to inherit cron semantics it doesn't need.
- **Not separate process:** Daemon already owns Discord, MCP, heartbeat, scheduler, dashboard. All share the IPC socket and SessionManager. A trigger engine in a separate process would need its own IPC link to dispatch turns — needless complexity for a system where the daemon is the single coordination point.
- **Top-level subsystem:** Mirrors `src/heartbeat/` structure (pluggable module discovery in subdirectory). TaskScheduler **becomes a source** under this engine, shedding its current duplicated turn-setup code.

### 2. How does a trigger fire an agent turn?

**Neither a pseudo-Discord message NOR a bypass path. A third path via `TurnDispatcher.dispatch({ origin, target, payload })` — the same path TaskScheduler uses after the refactor, and the same path DiscordBridge uses after its refactor.**

Specifically: trigger event → PolicyEvaluator renders `payload` template → `TurnDispatcher.dispatch({ source: {kind:"trigger",...}, agent, payload, parentTurnId: null })` → `sessionManager.streamFromAgent(agent, payload, turn, origin)`.

The payload is a plain string (the rendered template). To the agent's session it looks exactly like a user message, but its `TurnOrigin.source.kind` is `"trigger"`, which means:
- It's visible to the agent via a system-generated prefix (see #3 below)
- It's tagged in traces as trigger-originated
- Its latency is excluded from user-facing p50/p95 by default

**No Discord pseudo-message is constructed.** That would be a lie (the channel didn't receive it) and would contaminate Discord message history.

### 3. How does the agent's identity/channel binding work for proactive turns?

**Configurable per trigger, default: silent.**

```yaml
triggers:
  - name: error-log-watcher
    source: file-watch
    announceIn: channel     # "channel" | "thread" | "silent" (default)
    # or: announceIn: thread
    # announceThreadName: "errors-{{date}}"
```

When `announceIn: silent`, the agent processes the trigger and only produces Discord output if it decides to — e.g., by using its existing `reply` tool or webhook post. This is the right default because many triggers ("new row in DB") don't warrant spam.

When `announceIn: channel`, the PolicyEvaluator prefixes the payload with a visible system marker: `[trigger: error-log-watcher] <payload>` AND the `TurnOrigin.source.channelId` is set to the agent's bound channel so existing Discord output paths work unchanged.

When `announceIn: thread`, a Discord thread is auto-created (reusing `SubagentThreadSpawner` infrastructure, which is already battle-tested for ephemeral thread sessions) with the trigger context posted as the opening message.

### 4. Cross-agent RPC — new MCP tool or existing send-to-agent IPC?

**NEW MCP tool: `delegate_task(agent, schema, payload, timeout_ms, await_response?)`.**

The existing `send_to_agent` tool (Phase 41) is fundamentally different:

| | `send_to_agent` (existing) | `delegate_task` (NEW) |
|---|---|---|
| Semantics | Fire-and-forget message | Typed RPC with return value |
| Schema | Free-form string | Named Zod schema (input + output) |
| Tracking | None (fire-forget) | Task row, state machine, audit log |
| Retries | None | Configurable max_attempts |
| Timeout | None | Required |
| Return value | None (sender gets no signal) | Structured output delivered back |
| Dashboard | Not surfaced as first-class concept | Task graph panel |
| Cancellation | Impossible | `cancel_task(id)` |

These are complementary. `send_to_agent` remains the right tool for "hey the build is broken" social messages. `delegate_task` is for "run this code review and return the verdict."

**Under the hood both route through the daemon, but delegate_task goes to TaskRouter (new) while send_to_agent goes to the existing webhook+DM path.**

### 5. Task state machine — who owns the state store?

**TaskStore (`~/.clawcode/manager/tasks.db`), owned by daemon, single-writer.**

Why global, not per-agent: a task has two parties (from/to). If it lived in the sender's DB, the receiver can't query its incoming queue. If it lived in both, every state change requires two writes and split-brain is possible. A single daemon-owned DB with indexes on both sides is the simplest correct model. Matches existing patterns for cross-cutting state: `registry.json`, `delivery-queue.db`, `advisor-budget.db`, `escalation-budget.db` — all global, all daemon-managed.

**Reads** can be exposed read-only to other processes (CLI, future admin tools) via IPC, not direct DB access.

### 6. How to prevent trigger loops / runaway cascades?

**Four overlapping defenses, ranked by cost-to-operator:**

1. **Chain depth cap (free, automatic).** Every turn carries `TurnOrigin.chain[]`. `TurnDispatcher` refuses to dispatch when `chain.length >= perf.maxTurnChainDepth` (default 5). Agent A triggers B (depth 1), B delegates to C (depth 2), C triggers D (depth 3) — chain = [A's turnId, B's turnId, C's turnId]. D→E would be depth 4, E→F depth 5, F→anything = rejected. Logged as `loop_detected` event + Discord alert via existing budget-alert infrastructure.

2. **Per-agent per-source rate limit (policy-configured).** `triggers[].throttle: { minIntervalSeconds, maxPerHour }`. Applied in PolicyEvaluator before dispatch. Reuses the existing `src/discord/rate-limiter.ts` pattern.

3. **Delegation allowlist (policy-configured).** `delegation.acceptsFrom: [agentNames]`. Agent B refuses tasks from agents not in its allowlist. This is the security gate — see #11 below.

4. **Cooldown between deliveries to same target (policy-configured).** `delegation.cooldownMs`. Prevents flood even if allowlisted.

The critical invariant: **LoopDetector runs inside TurnDispatcher, which is the single chokepoint.** Cannot be bypassed without touching the primitive itself.

### 7. How to surface the inter-agent task graph?

**All three: dashboard panel (primary), CLI command (scriptable), Discord embed (alerts only).**

- **Dashboard (primary operator surface):** New panel at `/api/task-graph`, renders in-flight + recent-terminal tasks as a force-directed graph. Nodes = agents, edges = tasks (colored by state: running=blue, complete=green, failed=red, dead_letter=black). Click edge → drill to task detail with linked traces. SSE push on state transitions. Follows the existing dashboard patterns (static/app.js, styles.css, SSE manager).
- **CLI:** `clawcode tasks [--agent X] [--state Y] [--since 24h] [--json]` and `clawcode tasks <id>` for detail. Mirrors `clawcode latency` shape exactly (same `--since`, `--all`, `--json` flags).
- **Discord embed:** ONLY for anomalies — cascade cap hit, task dead-lettered, stuck-running-past-timeout. Reuses `DiscordBridge.sendBudgetAlert` pattern (embed to agent's channel). Not for normal task completion — would be spam.

### 8. Policy layer data flow — where does the DSL live, when evaluated?

**DSL lives per-agent in `clawcode.yaml` under `triggers:` and `delegation:` blocks (NOT in separate `policies.yaml`).**

Rationale: triggers are agent-scoped behavior. They're as much part of what makes an agent "ops" vs "researcher" as `soul` or `skills` are. A separate `policies.yaml` would force operators to mentally join two files whenever they reason about a single agent. It also splits config hot-reload logic across files.

**Evaluation times:**

| When | What | Where |
|------|------|-------|
| Daemon startup | Parse + validate all trigger/delegation blocks | `src/config/schema.ts` Zod |
| Daemon startup | Subscribe to trigger sources | `TriggerEngine.init` |
| Config hot-reload (chokidar) | Diff old vs new, unsubscribe removed, subscribe added | `src/manager/config-reloader.ts` (extended) |
| Trigger fires | Render payload, check throttle, check LoopDetector | `PolicyEvaluator.shouldFire` |
| Task dispatch | Check `delegation.acceptsFrom` on target | `TaskRouter.enforcePolicy` |
| Task dispatch | Check `delegation.maxConcurrent` on target | `TaskStore.countRunning(to_agent)` |

### 9. Session keep-alive implications for delegation

**Three policies, declared per-agent in `delegation.wakeBehavior`:**

- `wake` (default): if target is asleep, start it. Target runs the task. Target stays warm for the usual idle period then shuts down per existing heartbeat rules. No change to session lifecycle.
- `queue`: if target is asleep, write task to target's inbox as an InboxMessage with `x-task-id` metadata. Next time target wakes (scheduled, user message, another trigger), the inbox heartbeat check picks it up and delivers. Lower resource cost, higher latency.
- `reject`: task immediately fails with `target_asleep`. For strict real-time workflows.

**Warm-session reuse from v1.7** is compatible: a task dispatch is just a turn. The existing warm-path check + 10s ready-gate apply verbatim. No new cold-start logic.

### 10. Integration with v1.7 telemetry

**Yes — proactive turns get the exact same trace spans, plus origin-specific metadata.**

| Phase 50 span | Behavior for proactive turn |
|---------------|------------------------------|
| `receive` | Opened by TurnDispatcher with `origin.source` as metadata. For triggers, `channel` metadata is null; for tasks, it's the sender agent name. |
| `first_token` | Unchanged — still opened/closed by session-adapter. |
| `tool_call.<name>` | Unchanged. |
| `end_to_end` | Unchanged. |

**New span:** `tool_call.delegate_task.<target>` on the **sender's** Turn, spanning from tool_use to task terminal state. This reuses the existing `tool_call.<block.name>` pattern — the MCP tool happens to be named `delegate_task`, and we augment the block name with the target agent name to make trace filtering easy.

**Cross-agent trace stitching:** TaskRouter records both `trigger_turn_id` (sender) and `execution_turn_id` (receiver) on the Task row. Dashboard task-graph can render the receiver's full Turn as a child of the sender's delegate_task span.

**Latency filtering:** CLI `clawcode latency <agent> --origin discord` / `--origin trigger` / `--origin task` filters by `turnId` prefix. The dashboard panel gets a matching dropdown. This finally makes the cryptic `context_assemble count=0` split meaningful — user turns vs proactive turns have different SLOs.

### 11. Security — can agent A delegate to any agent B?

**No. Explicit allowlist on the receiver side.** The DSL:

```yaml
delegation:
  acceptsFrom: ["planner", "researcher"]   # explicit, not "*"
  acceptsSchemas: ["research-request"]      # AND schema-level allowlist
  maxConcurrent: 2
```

Default (no `delegation` block) = **rejects all delegations**. Agents must opt-in to being delegated to. This is the secure default.

The reason to enforce on receiver not sender: delegation is an agreement. A sender can't unilaterally impose work on a receiver; the receiver's operator must have declared "I accept this kind of work from these sources." This matches the ACL pattern already established in `src/security/acl-parser.ts` for Discord channels — deny-by-default, explicit allow.

**Schema allowlist provides fine-grained control:** agent B might accept `code-review-request` from planner but not `deploy-request`. Without schema-level gating, a compromised sender could send anything that type-checks as "a task."

---

## Anti-Patterns to Explicitly Avoid

### Anti-pattern 1: Coupling TriggerEngine to Discord

**What people do:** Make triggers construct a fake Discord Message object and hand it to `DiscordBridge.handleMessage`.

**Why it's wrong:** DiscordBridge has Discord-specific logic (ACL checks, attachment download, rate limiter, thread routing, fetchReference). None of that applies to a file-watch trigger. You'd be adding guards like `if (isSyntheticMessage)` throughout, accumulating complexity forever.

**Do this instead:** TurnDispatcher is Discord-agnostic. DiscordBridge becomes one of several turn producers. They all end at the same dispatcher; none of them know about each other.

### Anti-pattern 2: Per-agent task DB

**What people do:** Store tasks in each agent's `memory.db` because "everything agent-scoped lives there."

**Why it's wrong:** A task belongs to two agents. Dual-write creates consistency bugs. Queries like "all pending work for agent X" become join nightmares across N SQLite files. Nested tasks (A → B → C) can't be traced without scanning every agent's DB.

**Do this instead:** Global `~/.clawcode/manager/tasks.db`, daemon-owned, indexed on from/to/state/root. Mirrors the established pattern for cross-cutting state (registry.json, delivery-queue.db, advisor-budget.db).

### Anti-pattern 3: Trigger engine as a subprocess

**What people do:** Spin up a separate Node process for the trigger engine "because it touches HTTP / chokidar and might crash."

**Why it's wrong:** The daemon already runs HTTP (dashboard), chokidar (config watcher + heartbeat), IPC server, Discord client, MCP server host. Adding another subprocess means another IPC link to the main daemon for every trigger fire, plus a separate lifecycle to manage. The "crash isolation" argument is weak — a trigger source crashing should be per-source (wrapped in try/catch + source-level restart), not per-process.

**Do this instead:** In-daemon subsystem with per-source error isolation. Model = heartbeat checks (pluggable modules with per-module try/catch).

### Anti-pattern 4: Synchronous blocking RPC

**What people do:** Make `delegate_task` block the sender's turn until the target returns.

**Why it's wrong:** Claude sessions are streaming query loops. Blocking the sender for minutes while the receiver thinks burns context, burns wall-clock budget, and holds MCP tool call open past reasonable timeouts. If the receiver crashes, the sender hangs.

**Do this instead:** `delegate_task(await_response: false)` returns the task_id immediately. Sender continues its turn. When task completes, TaskRouter writes a delivery notification to the sender's inbox (reusing existing `src/collaboration/inbox.ts`) — next time sender wakes, it sees the result. For synchronous-feeling workflows, sender polls `task_status(id)` in a loop with its own yielding. Keep `await_response: true` as an option but strongly document the caveats.

### Anti-pattern 5: Trigger fires identity-less turn

**What people do:** Trigger dispatches a turn with no origin metadata ("it's just another message").

**Why it's wrong:** Operators can't answer basic questions — "why did ops agent wake up at 3am?" Without `TurnOrigin`, you have to grep logs across subsystems to reconstruct causality. Loop detection is impossible.

**Do this instead:** Every turn carries TurnOrigin. It's the structural change that makes everything else possible.

### Anti-pattern 6: Policies in a separate file

**What people do:** Create `policies.yaml` separate from `clawcode.yaml` because "policies feel like a different concern than agent config."

**Why it's wrong:** An agent's triggers, accepted delegations, soul, and skills are facets of the same identity. Splitting them forces operators to keep two mental models in sync and doubles the hot-reload surface. Also: version control diffs are less meaningful when "what this agent does" is split across two files.

**Do this instead:** Policies live per-agent inside `clawcode.yaml`. The schema grows; the file count stays at one. Reuses existing watcher/differ/reloader.

### Anti-pattern 7: Reinventing the subagent-thread primitive for tasks

**What people do:** Build `delegate_task` as a new process-spawning primitive because "we need a new agent instance per task."

**Why it's wrong:** ClawCode already has **persistent** per-agent sessions. Delegating to agent B means "send B a new turn" — B's session is already alive (or should be started per wake policy). Spawning a new process per task would duplicate the entire Claude Agent SDK lifecycle machinery and destroy the memory/identity continuity that makes persistent agents the project's core value.

**Subagent-thread is for ephemeral child work (existing).** `delegate_task` is for persistent-agent handoffs (new). They coexist and serve different needs. Don't conflate them.

---

## Scaling Considerations

This is a per-operator daemon (not a SaaS). "Scale" means the single daemon handling N agents with M triggers and K in-flight tasks.

| Scale | Concern | Mitigation |
|-------|---------|------------|
| 5-20 agents, 10 triggers/agent | Trivial | Default config works. |
| 50+ agents, 50+ triggers total | Trigger fire storm on config reload | Staggered subscription + per-source backoff. Existing `heartbeat.intervalSeconds` per-agent pattern applies. |
| 100+ concurrent tasks | SQLite contention on task_events writes | Task writes already single-writer (daemon). Events table WAL mode (matches traces.db). If >1000/sec: batch writes. Unlikely for this use case. |
| Deep task graphs (A→B→C→D...) | Chain depth + trace stitching costs | Hard cap at `maxTurnChainDepth` (default 5). At depth=5, chain array is ~5 nanoid(10) strings = ~60 bytes. Negligible. |
| Webhook source receives burst | HTTP thread starvation | Webhook source uses same rate limiter pattern as `src/discord/rate-limiter.ts`. 429 response to overage. |

**First bottleneck to expect:** warm-path cost when multiple triggers fire for an asleep agent simultaneously. Mitigation: TriggerEngine coalesces — if agent X is waking AND another trigger for X fires, the second enqueues rather than starting a second wake.

---

## Sources

- `.planning/codebase/ARCHITECTURE.md` — authoritative daemon/session/IPC/memory/heartbeat structure (2026-04-11)
- `.planning/codebase/STRUCTURE.md` — directory conventions, where-to-add-new-code patterns (2026-04-11)
- `.planning/codebase/INTEGRATIONS.md` — Discord, MCP, IPC, storage integration details (2026-04-11)
- `.planning/milestones/v1.7-phases/50-latency-instrumentation/50-VERIFICATION.md` — canonical TraceCollector/Turn/Span contract and per-agent traces.db pattern (2026-04-13)
- `src/scheduler/scheduler.ts` — existing caller-owned Turn pattern that TurnDispatcher generalizes
- `src/discord/bridge.ts:300-376` — existing Turn+receive-span setup duplicated across channel and thread routes
- `src/collaboration/inbox.ts` + `src/heartbeat/checks/inbox.ts` — existing filesystem inbox pattern that TaskRouter reuses as "queued" fallback
- `src/ipc/protocol.ts` — IPC_METHODS enum, the extension point for new RPC methods
- `src/mcp/server.ts` — TOOL_DEFINITIONS pattern, the extension point for new agent tools
- `src/manager/daemon.ts:1066-1180` — existing send-message / send-to-agent IPC handlers showing the fire-and-forget pattern that delegate_task structurally departs from

---

*Architecture research for: v1.8 Proactive Agents + Handoffs*
*Researched: 2026-04-13*
