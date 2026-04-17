# Requirements — v1.8 Proactive Agents + Handoffs

**Status:** Active
**Started:** 2026-04-15
**Phases:** 7 (57-63) — roadmap ready 2026-04-15

## Milestone Goal

Agents stop being purely reactive. They initiate actions on external triggers and delegate structured tasks to other agents — unlocking autonomous multi-agent workflows. The Finmentum 5-agent model (acquisition / research / tax / studio / playground) becomes the first real-world test case.

Build on the v1.0-v1.7 substrate (SessionManager, TaskScheduler, TraceStore, warm-path gate, MCP server, per-agent SQLite, Discord bridge). Add ONE new subsystem for triggers, ONE new subsystem for handoffs, ONE new daemon-level SQLite store for task lifecycle. Minimal new runtime dependencies.

## v1.8 Requirements

### Trigger Engine (TRIG)

- [x] **TRIG-01**: Scheduled triggers fire agent turns on cron expressions with a rich context payload (not just a prompt string) — extends v1.6 TaskScheduler
- [x] **TRIG-02**: DB-change triggers poll a configurable MySQL SELECT with a `last_seen_id` watermark and fire on new rows matching a filter (Finmentum `pipeline_clients` primary target)
- [x] **TRIG-03**: Webhook triggers accept inbound HTTP POST on a dedicated endpoint, verify HMAC signature per source, dispatch to configured agent
- [x] **TRIG-04**: Inbox-arrival triggers fire immediately on write to the existing `collaboration/inbox` filesystem inbox (upgrade from heartbeat polling)
- [x] **TRIG-05**: Calendar triggers poll upcoming events via the existing `google-workspace` MCP and fire at configurable offsets (e.g., 15 min before event start)
- [x] **TRIG-06**: Daemon startup replays missed events since last watermark with a configurable max age (default 24h) so triggers are not lost across restarts
- [x] **TRIG-07**: Three-layer dedup prevents trigger storms: (a) idempotency key per event at ingress rejects duplicates, (b) per-source debouncer collapses bursts, (c) SQLite UNIQUE constraint on `(source, idempotency_key)` as safety net
- [x] **TRIG-08**: Every trigger fire generates a `causation_id` (nanoid) that propagates to the resulting turn's trace metadata and through any downstream handoffs — enables end-to-end tracing from source event → agent turn → delegated task → final result

### Policy Layer (POL)

- [ ] **POL-01**: Trigger-to-agent rules live in a declarative YAML policy file, validated with Zod at daemon start, errors reject the update atomically
- [ ] **POL-02**: Policy DSL supports: source match, agent target, payload template (Handlebars or similar), throttle/debounce config, priority, enabled flag
- [ ] **POL-03**: Policy hot-reload — editing the policy file takes effect on the NEXT trigger evaluation without a daemon restart
- [ ] **POL-04**: Dry-run mode — operator can replay recent trigger events against a pending policy change and see which agents would fire without actually firing them

### Cross-Agent Handoff (HAND)

- [x] **HAND-01**: Each agent delegates a typed task to another agent via a new `delegate_task` MCP tool (async-ticket semantics — MCP call returns a `task_id` immediately; caller's turn ends; the eventual result arrives as a separate trigger firing the caller with the task result as context). Explicitly NOT sync RPC with `await` — prevents deadlock-from-sync-RPC (PITFALL-03) by design.
- [x] **HAND-02**: Task schemas are declared in a registry (`.planning/task-schemas/` YAML) with Zod validation on input and output; receiver rejects malformed inputs; payload size cap (default 64KB) enforced at validation time
- [x] **HAND-03**: Every handoff has a deadline propagated through the chain (not a per-hop timeout); receiver gets an AbortSignal; daemon kills tasks past the chain deadline
- [x] **HAND-04**: Handoff authorization — each receiver declares which agents are allowed to delegate to it (allowlist, default deny); violations log WARN and return a typed error
- [x] **HAND-05**: Cycle detection — every task carries a chain `depth` counter AND a `causation_id` (root trigger id); reject handoffs where depth exceeds `MAX_HANDOFF_DEPTH` (default 5) OR where the target appears in the causation chain (re-entry ban) to prevent runaway cascades
- [x] **HAND-06**: Explicit payload — only fields listed in the task schema cross the handoff boundary; no ambient context leakage between agents
- [x] **HAND-07**: Self-handoff (agent A delegating to agent A) blocked at the MCP tool level; returns typed error

### Task Lifecycle (LIFE)

- [x] **LIFE-01**: Daemon-level `tasks.db` SQLite store (shared, not per-agent) tracks every inter-agent task and proactive turn with states: pending | running | awaiting_input | complete | failed | cancelled | timed_out
- [x] **LIFE-02**: Task rows include: task_id, task_type, caller_agent, target_agent, causation_id (root trigger id), parent_task_id (nullable), depth, input_digest (hash, not raw), status, started_at, ended_at, heartbeat_at, result_digest, error, chain_token_cost
- [x] **LIFE-03**: Task retention defaults to 7 days matching traces.db convention; configurable via `perf.taskRetentionDays`
- [x] **LIFE-04**: Orphaned task reconciliation — tasks with heartbeat_at older than threshold at daemon start are marked `orphaned` (not left running forever)
- [x] **LIFE-05**: Cost attribution — handoff token usage counts against the calling agent's budget by default; per-task override available
- [x] **LIFE-06**: Retry — failed tasks can be re-run idempotently with the same input against the same receiver via a CLI command and (future) auto-retry policy

### Observability (OBS)

- [ ] **OBS-01**: `clawcode triggers` CLI lists recent trigger fires with source, matched rule, target agent, result, duration
- [ ] **OBS-02**: `clawcode tasks` CLI lists recent inter-agent tasks with caller, target, state, duration, depth — filterable by agent + state
- [ ] **OBS-03**: Dashboard panel shows in-flight inter-agent task graph (nodes = agents, edges = tasks) with real-time updates via SSE
- [ ] **OBS-04**: Proactive turns and delegated task turns appear in the existing v1.7 trace tree with `causation_id`, `trigger_id`, and `task_id` metadata on the root span; `clawcode trace <causation_id>` CLI walks the entire chain (source event → trigger → turn → handoff → turn → ... → final result) across all involved agents
- [ ] **OBS-05**: Handoff chain cumulative token count is visible in the task list output and in the trace metadata

## Future Requirements

- Memory-pattern observation triggers (agent wakes when a subscribed memory pattern fires) — deferred until base trigger engine is solid
- Trace-based SLO-breach triggers (self-healing on-call patterns) — deferred
- Async handoff (fire-and-forget with callback) — deferred
- Batch handoffs to multiple agents with all/any/first-to-succeed strategies — deferred
- Handoff graph export as DOT / mermaid diagram — nice-to-have after OBS-03 ships
- Auto-retry policy for failed tasks — deferred; manual retry (LIFE-06) ships first

## Out of Scope

- **Temporal / Inngest / Trigger.dev / similar workflow engines** — ClawCode is single-process; in-process state machine is adequate at this scale
- **Redis-backed job queues (BullMQ, bee-queue)** — SQLite per the established per-agent pattern is sufficient
- **MySQL binlog / CDC-level change capture** — polling-SELECT with watermark tracking is the right tradeoff for v1.8; binlog is premature optimization
- **Event bus (NATS, Kafka)** — no need; Unix-socket IPC + in-memory dispatch handles expected load
- **Arbitrary file-system watchers** — attack surface for scope creep; only the known inbox path is watched
- **Email / SMS trigger sources** — security risk without explicit per-source allowlist infrastructure that v1.8 doesn't build
- **Sync RPC with no timeout** — every handoff has a hard timeout
- **Caller-supplied execution environment in handoff payload** — payloads are data-only
- **Shared mutable context across agents via handoff** — breaks workspace isolation; handoff payload is explicit fields only
- **Cross-daemon / cross-host handoffs** — v1.8 is single-daemon; multi-node is a separate milestone if ever

## Requirements Traceability

| ID | Description | Phase | Status |
|----|-------------|-------|--------|
| TRIG-01 | Scheduled triggers with rich context payload | Phase 60 | [ ] |
| TRIG-02 | DB-change triggers (MySQL polling + watermark) | Phase 61 | [ ] |
| TRIG-03 | Webhook triggers with HMAC validation | Phase 61 | [ ] |
| TRIG-04 | Inbox-arrival triggers | Phase 61 | [ ] |
| TRIG-05 | Calendar triggers via google-workspace MCP | Phase 61 | [ ] |
| TRIG-06 | Missed event replay on daemon startup | Phase 60 | [ ] |
| TRIG-07 | Three-layer dedup (idempotency + debounce + DB UNIQUE) | Phase 60 | [ ] |
| TRIG-08 | Causation_id propagation from source event to downstream turns | Phase 60 | [ ] |
| POL-01 | Zod-validated policy YAML | Phase 62 | [ ] |
| POL-02 | Policy DSL (source/agent/template/throttle/priority) | Phase 62 | [ ] |
| POL-03 | Policy hot-reload without daemon restart | Phase 62 | [ ] |
| POL-04 | Dry-run replay against pending policy changes | Phase 62 | [ ] |
| HAND-01 | delegate_task MCP tool with typed input/output | Phase 59 | [ ] |
| HAND-02 | Task schema registry + Zod validation | Phase 59 | [ ] |
| HAND-03 | Handoff timeout + cancellation | Phase 59 | [ ] |
| HAND-04 | Receiver-declared allowlist for delegation | Phase 59 | [ ] |
| HAND-05 | Chain depth counter + cycle detection | Phase 59 | [ ] |
| HAND-06 | Explicit payload boundary (no ambient context) | Phase 59 | [ ] |
| HAND-07 | Self-handoff blocked at MCP tool level | Phase 59 | [ ] |
| LIFE-01 | Daemon-level tasks.db + state machine | Phase 58 | [ ] |
| LIFE-02 | Task row schema with trigger_id + chain metadata | Phase 58 | [ ] |
| LIFE-03 | 7-day task retention (configurable) | Phase 60 | [ ] |
| LIFE-04 | Orphaned task reconciliation on startup | Phase 58 | [ ] |
| LIFE-05 | Cost attribution to calling agent | Phase 59 | [ ] |
| LIFE-06 | Manual retry command for failed tasks | Phase 59 | [ ] |
| OBS-01 | `clawcode triggers` CLI | Phase 63 | [ ] |
| OBS-02 | `clawcode tasks` CLI | Phase 63 | [ ] |
| OBS-03 | Dashboard task graph panel with SSE updates | Phase 63 | [ ] |
| OBS-04 | trigger_id / task_id metadata on root trace spans | Phase 63 | [ ] |
| OBS-05 | Handoff chain cumulative token count visibility | Phase 63 | [ ] |

**Total:** 30 requirements — all mapped to phases during roadmap creation (2026-04-15). Zero orphans.

### Coverage by Phase

| Phase | Requirements | Count |
|-------|--------------|-------|
| Phase 57 TurnDispatcher Foundation | (foundation — net-zero refactor) | 0 |
| Phase 58 Task Store + State Machine | LIFE-01, LIFE-02, LIFE-04 | 3 |
| Phase 59 Cross-Agent RPC (Handoffs) | HAND-01, HAND-02, HAND-03, HAND-04, HAND-05, HAND-06, HAND-07, LIFE-05, LIFE-06 | 9 |
| Phase 60 Trigger Engine Foundation | TRIG-01, TRIG-06, TRIG-07, TRIG-08, LIFE-03 | 5 |
| Phase 61 Additional Trigger Sources | TRIG-02, TRIG-03, TRIG-04, TRIG-05 | 4 |
| Phase 62 Policy Layer + Dry-Run | POL-01, POL-02, POL-03, POL-04 | 4 |
| Phase 63 Observability Surfaces | OBS-01, OBS-02, OBS-03, OBS-04, OBS-05 | 5 |
| **Total** | | **30** |
