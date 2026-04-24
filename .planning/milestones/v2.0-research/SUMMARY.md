# Project Research Summary — v1.8 Proactive Agents + Handoffs

**Project:** ClawCode v1.8 (brownfield continuation from v1.7 shipped 2026-04-14)
**Scope:** Proactive triggers + structured cross-agent task delegation
**Generated:** 2026-04-15 (inline synthesis — background researcher agents stalled; authored from v1.0-v1.7 substrate + established ecosystem patterns)

## What v1.8 is solving

ClawCode today is REACTIVE — agents respond to Discord user messages. Cron-scheduled prompts exist but are dumb (just fire a fixed prompt at X time). Subagent-thread lets an agent spawn an ephemeral child session in a thread but there's no persistent cross-agent task delegation.

v1.8 adds two orthogonal capabilities that compound:

1. **Triggers** — agents initiate turns on external signals (DB state changes, inbox arrivals, webhook hits, calendar events, observations) not just user messages.
2. **Handoffs** — an agent can delegate a typed task to another agent and get a structured reply, with lifecycle tracking, retries, timeouts, and audit trail.

Together these unlock autonomous workflows: fin-acquisition notices a new lead in MySQL → delegates research to fin-research → receives structured brief → posts to Discord. Today each of those arrows requires a human.

## Stack additions (minimal set)

| Package | Version | Purpose | Why |
|---|---|---|---|
| **nanoid** | 5.x (already present) | Task correlation IDs | Already used for turnId in v1.7 — reuse for task IDs |
| **@breejs/later** or inline parser | latest | Richer cron than croner for triggers that need "5 min after event" semantics | Optional — croner already handles fixed schedules |

**What NOT to add:**
- **Temporal.io / Inngest / Trigger.dev** — designed for multi-node workflow orchestration. ClawCode is single-process; in-process task state machine is adequate.
- **BullMQ / bee-queue** — Redis-backed job queues. Overkill for the expected load (dozens of inter-agent tasks/day, not millions). Use SQLite per the established pattern.
- **MySQL binlog / CDC tools** — DB-change triggers for Finmentum's MySQL will use polling-SELECT with `last_seen_id` watermarks. Binlog capture is premature optimization.
- **Generic workflow engines (Camunda, Zeebe)** — BPMN-flavored orchestration. Wrong abstraction for LLM-driven agents.
- **Event bus libraries (NATS, Kafka)** — no need; Unix-socket IPC + in-memory dispatch is fine at this scale.

**Stack stays lean:** No new runtime deps required if we reuse croner + sqlite + IPC. One new local module for the trigger watcher + task store + policy engine.

## Feature taxonomy

### A. Trigger sources (TABLE STAKES)

- **T1. Scheduled triggers** — cron expressions, unchanged from v1.6 but extended to pass a richer context payload (not just a prompt string). *Complexity: low.*
- **T2. DB-change triggers** — poll a SELECT with watermark tracking; fire on new rows matching a filter. Finmentum's pipeline_clients table is the primary target. *Complexity: moderate.*
- **T3. Webhook triggers** — inbound HTTP endpoint on the existing dashboard server (or a sibling) that receives POST, signature-validates, dispatches to an agent. *Complexity: moderate.*
- **T4. Inbox-arrival triggers** — already have `collaboration/inbox` filesystem inbox. Elevate it from "agent checks on heartbeat" to "trigger fires on write". *Complexity: low.*
- **T5. Calendar triggers** — via existing `google-workspace` MCP. Poll upcoming events, fire "15 min before meeting" or "at event start". *Complexity: moderate.*

### B. Trigger sources (DIFFERENTIATORS)

- **T6. Memory-pattern observations** — agent wakes up when a memory matches a subscribed pattern (e.g., "a new `INSIGHT` type memory was stored this week"). Leverages v1.5 memory tiering.
- **T7. Trace-based triggers** — fire when a latency SLO breaches or cache hit rate drops (dogfood v1.7 telemetry for self-healing). Use the on-call agent pattern.

### C. Trigger sources (ANTI-FEATURES — don't build)

- Full in-process event bus with any source → any sink. Keep trigger shapes fixed, policy explicit.
- File-system watchers (chokidar) across arbitrary paths. Attack surface for scope creep.
- Email/SMS trigger sources without explicit allowlist. Security risk.

### D. Cross-agent RPC (TABLE STAKES)

- **H1. Delegate task** — agent A calls `delegate_task(agent: string, input: T) -> Promise<R>` via MCP tool or IPC method. Structured request/response. *Complexity: moderate.*
- **H2. Task schema validation** — each delegated task has a Zod schema for input + output. Receiver rejects malformed inputs; sender gets typed error. *Complexity: moderate.*
- **H3. Timeout + cancellation** — every handoff has a timeout (default 5min); caller can cancel. Receiver gets a signal. *Complexity: moderate.*
- **H4. Task lifecycle store** — new `tasks.db` per daemon (shared, not per-agent). States: pending | running | awaiting_input | complete | failed | cancelled | timed_out. *Complexity: moderate.*

### E. Cross-agent RPC (DIFFERENTIATORS)

- **H5. Async handoff** — fire-and-forget with callback. Useful when the calling agent doesn't need the result immediately.
- **H6. Batch handoffs** — delegate the same task shape to N agents, gather results with a strategy (all/any/first-to-succeed).
- **H7. Task replay** — re-run a failed task with the same input against the same target agent (idempotent by design).

### F. Cross-agent RPC (ANTI-FEATURES)

- **Sync RPC with no timeout.** Deadlock risk.
- **Caller-supplied execution environment (arbitrary code in handoff payload).** Massive security risk.
- **Cyclic delegation** — A→B→A in the same task chain. Detect + reject.

### G. Policy + observability (TABLE STAKES)

- **P1. Trigger policy DSL** — declarative rules in YAML: `source → agent → payload_template → throttle/debounce`. Validated at daemon start.
- **P2. Task graph visualization** — dashboard panel showing in-flight inter-agent tasks, completion state, duration.
- **P3. Trigger audit log** — every trigger fire records: source, matched rule, target agent, input digest, turn_id in traces.db. Queryable via `clawcode triggers` CLI.
- **P4. Dry-run mode** — operator can test a policy change by replaying recent trigger events without actually firing agents.

### H. Policy + observability (DIFFERENTIATORS)

- **P5. Handoff graph export** — DOT / mermaid diagram of which agents delegate to which, derived from recent tasks.
- **P6. Cost attribution** — inter-agent tasks count against the calling agent's budget by default, with optional per-task override.

## Architecture integration

```
┌─────────────────────────────────────────────────────┐
│  Triggers (NEW subsystem — src/triggers/)          │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐      │
│  │ Scheduled  │ │ DB-change  │ │ Webhook    │ ... │
│  └────────────┘ └────────────┘ └────────────┘      │
│         ↓              ↓              ↓            │
│  ┌─────────────────────────────────────────┐      │
│  │ PolicyEngine (policies.yaml → rules)    │      │
│  └─────────────────────────────────────────┘      │
│         ↓ (proactive-turn dispatch)               │
│  ┌─────────────────────────────────────────┐      │
│  │ SessionManager.streamFromAgent          │ ← REUSE │
│  │ (existing — no change; trigger caller   │      │
│  │  constructs the Turn + passes it in)    │      │
│  └─────────────────────────────────────────┘      │
│         ↓                                         │
│  ┌─────────────────────────────────────────┐      │
│  │ SdkSessionAdapter.sendAndStream         │ ← REUSE │
│  └─────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  Handoffs (NEW subsystem — src/handoffs/)          │
│  ┌─────────────────────────────────────────┐       │
│  │ delegate_task MCP tool (exposed to      │       │
│  │ each agent)                             │       │
│  └─────────────────────────────────────────┘       │
│              ↓ (IPC call)                          │
│  ┌─────────────────────────────────────────┐       │
│  │ TaskManager (new in daemon)             │       │
│  │ - validates schema (from registry)      │       │
│  │ - writes task row to tasks.db           │       │
│  │ - dispatches to target agent            │       │
│  │ - tracks lifecycle                      │       │
│  └─────────────────────────────────────────┘       │
│              ↓ (streamFromAgent with payload)      │
│  ┌─────────────────────────────────────────┐       │
│  │ SessionManager.streamFromAgent          │ ← REUSE │
│  │ target agent sees structured input      │       │
│  │ + special "handoff" system prompt       │       │
│  └─────────────────────────────────────────┘       │
│              ↓                                     │
│  caller resumes with typed result                  │
└─────────────────────────────────────────────────────┘
```

**Key integration points:**
- **Both subsystems funnel into `SessionManager.streamFromAgent`** — that's how a trigger fires a turn or a delegated task reaches the receiver. No new agent-dispatch path; the warm-path ready-gate, trace instrumentation, and caller-owned Turn lifecycle from v1.7 all carry over.
- **Triggers are Discord-agnostic.** A proactive turn may or may not post to Discord. Decision is per-trigger-rule in the policy DSL. Default: post to agent's bound channel (so operators see what happened).
- **Handoff inherits the calling agent's budget + cost attribution** by default. Override via per-task config.
- **`tasks.db` is daemon-level**, not per-agent. One store holds all inter-agent tasks — needed for the graph view + cross-agent queries.
- **New IPC methods:** `delegate-task`, `task-status`, `cancel-task`, `list-tasks`. All registered in protocol.ts + protocol.test.ts per the Phase 50 regression lesson.
- **Policy DSL lives in `.planning/` or a separate `policies.yaml`** at the daemon root (not per-agent) since rules match against triggers, not individual agents.

## Pitfalls — MUST mitigate

| # | Pitfall | Mitigation |
|---|---------|-----------|
| 1 | **Runaway trigger cascades** (A triggers B triggers A...) | Every task carries a `depth` counter; reject handoffs where `depth > MAX_DEPTH` (default 5). Every trigger fire checks a per-agent-per-source rate limit. |
| 2 | **Deadlock** from sync handoffs | Hard timeout on every handoff; no unbounded await. Caller can always cancel. |
| 3 | **Silent task failures** | Task state machine never goes to "complete" without an explicit result; timeouts surface as "failed with reason". |
| 4 | **Missed events** (polling interval too long, trigger fires while daemon was down) | Watermark-based polling with last-seen cursor persisted in `tasks.db`. Daemon startup replays missed events since last watermark (with configurable max age). |
| 5 | **Cost amplification** from handoff chains | Every task increments the chain's cumulative token count; chain exceeding budget rejects the next handoff with a clear error. |
| 6 | **Orphaned tasks** (daemon crash mid-task) | Task rows have a `heartbeat_at` updated by the executing agent; reconciler at daemon start marks stale tasks as `orphaned`. |
| 7 | **Trigger storms** (one source spams N events in 1s) | Per-source debouncer + per-agent rate limiter. Tunable via policy DSL. |
| 8 | **Scope leakage** (agent A's private context bleeding to agent B) | Handoff payload is EXPLICIT — only fields listed in the task schema pass through. No ambient context transfer. |
| 9 | **Policy DSL ambiguity** (same trigger matches multiple agents) | Rules have explicit priority; ambiguous matches log WARN and pick by priority. Dry-run mode prints all matches. |
| 10 | **Observability blind spots** — operators can't trace "why did agent X wake up" | Every proactive turn stores `trigger_id` in trace metadata; CLI + dashboard can trace from turn → trigger → policy rule → source event. |

## Suggested build order

**Phase A (foundations):** tasks.db schema + TaskManager + task schema registry + new IPC methods. No triggers yet, but handoff infrastructure is testable end-to-end by manually invoking delegate-task from CLI.

**Phase B (triggers):** trigger engine (scheduled + webhook) + policy DSL + dispatch-to-streamFromAgent. Still no handoffs firing; triggers just wake agents with a context payload.

**Phase C (DB + inbox + calendar triggers):** extend trigger engine with the three source types. Finmentum-specific DB change triggers gate on `pipeline_clients` updates.

**Phase D (delegate_task MCP tool):** expose handoff to agents via a new MCP tool. Validate schemas. Wire caller-in-flight state so the calling agent's session stays warm until response arrives.

**Phase E (observability):** `clawcode triggers list` + `clawcode tasks list` CLI + dashboard task graph + trace enrichment.

**Phase F (hardening):** rate limiting + debouncing + cycle detection + cost attribution + dry-run + policy-change hot reload.

This order lets each phase deliver a demo-able slice: Phase A = "manually delegate between agents via CLI"; Phase B = "agents wake up on schedule with rich context"; Phase C = "Discord turn when new Finmentum lead lands"; Phase D = "agent A autonomously delegates to agent B"; Phase E = "operator sees the graph"; Phase F = "production-ready."

## Open questions for requirements

1. **Handoff auth model.** Can any agent delegate to any other? Or require explicit "B accepts from A" in config? *Recommendation: allowlist per receiver; default deny.*
2. **Task result persistence.** Should task results be queryable after completion (for audit) or purge after handoff completes? *Recommendation: persist with retention like traces (7 days default, configurable).*
3. **Policy DSL format.** YAML with declarative fields, or embedded JS/TS code? *Recommendation: YAML. Imperative escape hatch via optional `handler: <script-path>` only if we see YAML insufficient.*
4. **Webhook endpoint security.** HMAC signature verification per source, IP allowlist, both? *Recommendation: HMAC signatures required, IP allowlist optional.*
5. **Cost budget surface.** Reuse Phase 40 `EscalationBudget` or new budget scope for inter-agent tasks? *Recommendation: extend `EscalationBudget` with `handoffDailyTokens`; same pattern.*
