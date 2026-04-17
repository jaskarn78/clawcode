# Roadmap: ClawCode

## Milestones

- :white_check_mark: **v1.0 Core Multi-Agent System** - Phases 1-5 (shipped 2026-04-09)
- :white_check_mark: **v1.1 Advanced Intelligence** - Phases 6-20 (shipped 2026-04-09)
- :white_check_mark: **v1.2 Production Hardening & Platform Parity** - Phases 21-30 (shipped 2026-04-09)
- :white_check_mark: **v1.3 Agent Integrations** - Phases 31-32 (shipped 2026-04-09)
- :white_check_mark: **v1.4 Agent Runtime** - Phases 33-35 (shipped 2026-04-10)
- :white_check_mark: **v1.5 Smart Memory & Model Tiering** - Phases 36-41 (shipped 2026-04-10)
- :white_check_mark: **v1.6 Platform Operations & RAG** - Phases 42-49 (shipped 2026-04-12)
- :white_check_mark: **v1.7 Performance & Latency** - Phases 50-56 (shipped 2026-04-14)
- :hammer_and_wrench: **v1.8 Proactive Agents + Handoffs** - Phases 57-63 (active, started 2026-04-15)

## Phases

<details>
<summary>v1.0 Core Multi-Agent System (Phases 1-5) - SHIPPED 2026-04-09</summary>

See `.planning/milestones/v1.0-ROADMAP.md` for full details.

Phases 1-5 delivered: central config, agent lifecycle, Discord routing, per-agent memory, heartbeat framework.

</details>

<details>
<summary>v1.1 Advanced Intelligence (Phases 6-20) - SHIPPED 2026-04-09</summary>

See `.planning/milestones/v1.1-ROADMAP.md` for full details.

Phases 6-20 delivered: memory consolidation, relevance/dedup, tiered storage, task scheduling, skills registry, agent collaboration, Discord slash commands, attachments, thread bindings, webhook identities, session forking, context summaries, MCP bridge, reaction handling, memory search CLI.

</details>

<details>
<summary>v1.2 Production Hardening & Platform Parity (Phases 21-30) - SHIPPED 2026-04-09</summary>

See `.planning/milestones/v1.2-ROADMAP.md` for full details.

Phases 21-30 delivered: tech debt cleanup, config hot-reload, context health zones, episode memory, delivery queue, subagent Discord threads, security & execution approval, agent bootstrap, web dashboard.

</details>

<details>
<summary>v1.3 Agent Integrations (Phases 31-32) - SHIPPED 2026-04-09</summary>

See `.planning/milestones/v1.3-ROADMAP.md` for full details.

Phases 31-32 delivered: subagent thread skill (Discord-visible subagent work via skill interface), MCP client consumption (per-agent external MCP server config with health checks).

</details>

<details>
<summary>v1.4 Agent Runtime (Phases 33-35) - SHIPPED 2026-04-10</summary>

See `.planning/milestones/v1.4-ROADMAP.md` for full details.

Phases 33-35 delivered: global skill install (workspace skills auto-installed to ~/.claude/skills/), standalone agent runner (`clawcode run <agent>` command), OpenClaw coexistence fixes (token hard-fail, slash command namespace, dashboard non-fatal, env var interpolation).

</details>

<details>
<summary>v1.5 Smart Memory & Model Tiering (Phases 36-41) - SHIPPED 2026-04-10</summary>

See `.planning/milestones/v1.5-ROADMAP.md` for full details.

Phases 36-41 delivered: knowledge graph (wikilinks, backlinks, graph traversal), on-demand memory loading (personality fingerprint, memory_lookup MCP tool), graph intelligence (graph-enriched search, auto-linker heartbeat), model tiering (haiku default, fork-based escalation, opus advisor, /model command), cost optimization (per-agent token tracking, importance scoring, escalation budgets), context assembly pipeline (per-source token budgets).

</details>

<details>
<summary>v1.6 Platform Operations & RAG (Phases 42-49) - SHIPPED 2026-04-12</summary>

See `.planning/milestones/v1.6-ROADMAP.md` for full details.

Phases 42-49 delivered: auto-start agents on daemon boot, systemd production integration, agent-to-agent Discord communication (MCP tool + webhook embeds + bridge routing), memory auto-linking on save, scheduled memory consolidation via TaskScheduler, Discord slash commands for fleet control, webhook auto-provisioning per agent, RAG over documents (text/markdown/PDF ingestion, chunking, sqlite-vec KNN search, 4 MCP tools).

</details>

<details>
<summary>v1.7 Performance & Latency (Phases 50-56) - SHIPPED 2026-04-14</summary>

See `.planning/milestones/v1.7-ROADMAP.md` for full details.

Phases 50-56 delivered: latency instrumentation (per-turn traces + percentile CLI + dashboard), SLO targets + CI regression gate, Anthropic prompt caching (two-block context assembly + per-turn prefix hash), context/token budget tuning (audit CLI + lazy skills + 1500-token resume cap), streaming + typing indicator (first-token metric + 750ms cadence + ≤500ms typing fire), tool-call overhead (intra-turn cache + per-tool telemetry + concurrency gate foundation), warm-path optimizations (READ-ONLY SQLite warmup + resident embeddings + warm-session reuse + startup ready-gate).

</details>

### v1.8 Proactive Agents + Handoffs (Phases 57-63) - ACTIVE

**Goal:** Agents autonomously initiate actions on external triggers AND delegate structured tasks to other agents — unlocking multi-agent workflows.

- [x] **Phase 57: TurnDispatcher Foundation** - Unify all agent-turn entry points (Discord, scheduler, future triggers, future tasks) behind a single `TurnDispatcher` chokepoint so the v1.8 proactive + handoff subsystems plug into one contract instead of re-inventing trace/lifecycle plumbing (completed 2026-04-15)
- [x] **Phase 58: Task Store + State Machine** - Ship daemon-level `tasks.db`, Zod task schema registry, canonical task state machine (pending | running | awaiting_input | complete | failed | cancelled | timed_out), and chain metadata (causation_id, parent_task_id, depth) for every inter-agent task row (completed 2026-04-15)
- [x] **Phase 59: Cross-Agent RPC (Handoffs)** - Expose `delegate_task` / `task_status` / `cancel_task` / `task_complete` via MCP + IPC with async-ticket semantics, receiver allowlists, cycle detection, self-handoff block, schema-validated payloads, 64 KB cap, deadline propagation, chain-token cost attribution, and manual retry (completed 2026-04-17)
- [x] **Phase 60: Trigger Engine Foundation** - Stand up the TriggerEngine + source registry + policy evaluator + loop detector + causation_id propagation + 3-layer dedup, migrate the v1.6 scheduler into the first registered source, and land task retention config (completed 2026-04-17)
- [ ] **Phase 61: Additional Trigger Sources** - Register four more sources against the Phase 60 engine: webhook HTTP receiver (HMAC-verified), MySQL DB-change poller with `last_seen_id` watermark, inbox-arrival event (upgrade from heartbeat), and Google/ICS calendar poller with configurable offsets
- [ ] **Phase 62: Policy Layer + Dry-Run** - Declarative YAML policy DSL (Zod-validated at daemon start, atomic-reject on error) covering source/agent/template/throttle/priority, hot-reload on file edit, and dry-run replay so operators can test policy changes without firing agents
- [ ] **Phase 63: Observability Surfaces** - Ship the operator surfaces on top of the Phase 57-62 substrate: dashboard in-flight task graph with SSE, `clawcode triggers` + `clawcode tasks` CLIs, trace enrichment with causation_id/trigger_id/task_id on root spans, cross-agent `clawcode trace <causation_id>` walker, and chain-token visibility across list + trace metadata

## Phase Details

### Phase 57: TurnDispatcher Foundation

**Goal**: Every agent turn — Discord message, scheduler tick, future trigger, future handoff — flows through a single `TurnDispatcher` chokepoint that assigns origin-prefixed turnIds, opens caller-owned Turns, and records provenance, without changing any user-visible behavior

**Depends on**: Nothing (first v1.8 phase — foundation the rest of the milestone stacks on)

**Requirements**: (none — net-zero refactor; lays groundwork for HAND-*, TRIG-08, OBS-04)

**Success Criteria** (what must be TRUE):
  1. A user sending a Discord message still receives a reply through the same agent / channel / streaming pipeline, with the identical turn behavior as v1.7 (`DiscordBridge.handleMessage` now dispatches via `TurnDispatcher` instead of calling `SessionManager.streamFromAgent` directly).
  2. A cron-scheduled turn from `TaskScheduler` still fires at its cron expression and produces a persisted trace, but now flows through the same `TurnDispatcher` entry point with a `scheduler:<nanoid>`-prefixed turnId (no second hot path).
  3. Every persisted trace row in `traces.db` carries a `TurnOrigin` metadata blob (`source.kind`, `rootTurnId`, `parentTurnId`, `chain[]`) that downstream phases can pattern-match on.
  4. Developers can introduce a new turn source in a follow-on phase by calling `turnDispatcher.dispatch(...)` — no new duplicated trace-setup, Turn-lifecycle, or session-lookup code per source.

**Plans**: 3 plans
- [x] 57-01-PLAN.md — TurnOrigin schema + TurnDispatcher skeleton (Wave 1)
- [x] 57-02-PLAN.md — Trace enrichment with TurnOrigin persistence (Wave 2)
- [x] 57-03-PLAN.md — Migrate DiscordBridge + TaskScheduler call sites + daemon wiring (Wave 3)

### Phase 58: Task Store + State Machine

**Goal**: Every inter-agent task and proactive turn ClawCode will dispatch has a durable row with a state machine and chain metadata, so handoffs and triggers in the next phases have a persistent substrate instead of in-memory ephemera

**Depends on**: Phase 57 (TurnOrigin shape is the source-of-truth that populates task rows' causation_id + parent_task_id + depth)

**Requirements**: LIFE-01, LIFE-02, LIFE-04

**Success Criteria** (what must be TRUE):
  1. Operator can point the daemon at a fresh host and see `~/.clawcode/manager/tasks.db` created with the full schema (tasks + trigger_state indexes) on first boot (LIFE-01).
  2. A test that inserts a task row, transitions it through pending → running → complete, and re-reads it succeeds; illegal transitions (e.g. complete → running) are rejected by the state machine with a typed error (LIFE-01).
  3. Every task row carries task_id, task_type, caller_agent, target_agent, causation_id, parent_task_id (nullable), depth, input_digest, status, started_at, ended_at, heartbeat_at, result_digest, error, and chain_token_cost — inspectable via `sqlite3 tasks.db '.schema tasks'` and round-trippable through the Zod schema (LIFE-02).
  4. If the daemon is killed while a task is in `running`, the next daemon start reconciles tasks with a stale `heartbeat_at` (older than the configured threshold) into a terminal `orphaned` state — never leaves them running forever (LIFE-04).

**Plans**: 3 plans
- [x] 58-01-PLAN.md — TaskStatus + TaskRowSchema + state-machine contracts (Wave 1)
- [x] 58-02-PLAN.md — TaskStore class with SQLite + idempotent migration + transitions (Wave 2)
- [x] 58-03-PLAN.md — Reconciler + daemon wiring + tasks.db creation on boot (Wave 3)

### Phase 59: Cross-Agent RPC (Handoffs)

**Goal**: Agent A can delegate a typed task to agent B via a single MCP tool call, and B's structured result lands back at A as a fresh turn, with schema validation / authorization / cycle detection / deadline propagation / cost attribution / manual retry all enforced by the daemon

**Depends on**: Phase 58 (writes task rows), Phase 57 (delegated turns use TurnOrigin `kind: "task"`)

**Requirements**: HAND-01, HAND-02, HAND-03, HAND-04, HAND-05, HAND-06, HAND-07, LIFE-05, LIFE-06

**Success Criteria** (what must be TRUE):
  1. Agent A calls `delegate_task({ target: "B", schema: "research.brief", payload: {...} })` from its Claude session; the MCP tool returns a `task_id` immediately (A's turn ends), and B's next turn fires with the validated payload as context — deadlock-by-sync-RPC is impossible by construction (HAND-01).
  2. A payload missing a required field, carrying an unknown field, or exceeding 64 KB is rejected by the daemon before B is ever woken — caller sees a typed ValidationError and no row advances past `pending` (HAND-02, HAND-06).
  3. Every handoff carries a chain-wide deadline (wall-clock); if the chain deadline elapses, B's turn is aborted via `AbortSignal` and the task terminates in `timed_out` with no user-visible side effects downstream (HAND-03).
  4. A delegation attempt from an agent not in the receiver's allowlist, OR where target appears already in the causation chain, OR with `depth > MAX_HANDOFF_DEPTH (5)`, OR where target === caller, is refused at the MCP tool layer with a typed error (`UNAUTHORIZED` / `CYCLE_DETECTED` / `DEPTH_EXCEEDED` / `SELF_HANDOFF_BLOCKED`) before any task row reaches `running` (HAND-04, HAND-05, HAND-07).
  5. Tokens consumed by delegated turns count against the calling agent's budget by default with a documented per-task override; a failed task can be re-run idempotently via `clawcode tasks retry <task_id>` and produces the same input_digest against the same receiver (LIFE-05, LIFE-06).

**Plans**: 3 plans
- [x] 59-01-PLAN.md — Task schema registry + JSON-Schema→Zod compiler + typed errors + authorize.ts (Wave 1)
- [x] 59-02-PLAN.md — TaskManager class (delegate/cancel/completeTask/retry + deadline + cost attribution + digest) (Wave 2)
- [x] 59-03-PLAN.md — MCP tools + IPC + CLI tasks retry/status + daemon wiring + acceptsTasks config + AbortSignal threading (Wave 3)

### Phase 60: Trigger Engine Foundation

**Goal**: A single `TriggerEngine` + source registry + policy evaluator owns every non-Discord turn initiation, propagates causation_id end-to-end, defeats trigger storms with 3-layer dedup, and replays missed events on daemon restart — with the v1.6 scheduler migrated to be its first registered source

**Depends on**: Phase 57 (TurnDispatcher is the engine's downstream), Phase 58 (trigger_state persists watermarks / cursors / replay bookmarks in tasks.db)

**Requirements**: TRIG-01, TRIG-06, TRIG-07, TRIG-08, LIFE-03

**Success Criteria** (what must be TRUE):
  1. A scheduled trigger defined in config fires a target agent's turn on its cron expression with a structured context payload (not just a prompt string) — and the v1.6 `TaskScheduler` now routes through the new engine rather than owning a parallel hot path (TRIG-01).
  2. When the daemon restarts after being down for ≤24h (configurable via max-age), it replays scheduled / polled events missed since the last watermark instead of silently dropping them (TRIG-06).
  3. The same upstream event delivered three times — identical idempotency key, or within the debounce window, or with its `(source, idempotency_key)` duplicate hitting the SQLite UNIQUE constraint — fires the target agent exactly once, not three times (TRIG-07).
  4. Every triggered turn's root trace span carries a `causation_id` (nanoid) generated at trigger ingress, and any downstream handoff inherits that same `causation_id` on its root span — `sqlite3 traces.db "select distinct causation_id from spans"` stitches trigger → turn → handoff → turn as one chain (TRIG-08).
  5. Completed / failed / cancelled / timed_out task rows older than the configured `perf.taskRetentionDays` (default 7, matching traces.db convention) are purged on the retention heartbeat; still-running rows are untouched (LIFE-03).

**Plans**: 3 plans
- [x] 60-01-PLAN.md — TriggerSource interface + dedup pipeline + PolicyEvaluator (Wave 1)
- [x] 60-02-PLAN.md — TriggerEngine + SourceRegistry + TurnOrigin causationId + TaskStore DDL (Wave 2)
- [ ] 60-03-PLAN.md — SchedulerSource adapter + task-retention heartbeat + daemon wiring (Wave 3)

### Phase 61: Additional Trigger Sources

**Goal**: Four real-world source types register against the Phase 60 engine — webhooks, MySQL row changes, inbox arrivals, and calendar events — so the Finmentum 5-agent model (acquisition / research / tax / studio / playground) can run end-to-end on external signals

**Depends on**: Phase 60 (all four register via the TriggerSourceRegistry + funnel through TurnDispatcher)

**Requirements**: TRIG-02, TRIG-03, TRIG-04, TRIG-05

**Success Criteria** (what must be TRUE):
  1. A new row inserted into the configured MySQL table (Finmentum `pipeline_clients` the primary target) fires the configured agent within one polling interval, the `last_seen_id` watermark advances atomically in `trigger_state`, and a `ROLLBACK`'d insert does not cause a phantom trigger (TRIG-02).
  2. An external system POSTing to `/webhook/<triggerId>` on the dashboard HTTP server with a valid per-source HMAC-SHA256 signature fires the mapped agent; a missing / invalid signature or oversize body is rejected with the correct HTTP status and zero agent wake (TRIG-03).
  3. A peer-agent or external writer that drops a file into an agent's `collaboration/inbox/` fires that agent's turn immediately (via chokidar + `awaitWriteFinish`), strictly faster than the pre-v1.8 heartbeat-poll path (TRIG-04).
  4. A calendar event 15 minutes from its start time (or at its configured offset) fires the operator-chosen agent once — not every poll cycle — regardless of whether the source is the `google-workspace` MCP push channel, `events.list(syncToken)` incremental sweep, or an ICS URL (TRIG-05).

**Plans**: 3 plans
- [x] 61-01-PLAN.md — Config schemas + MysqlSource + WebhookSource (Wave 1)
- [x] 61-02-PLAN.md — InboxSource + CalendarSource (Wave 2)
- [ ] 61-03-PLAN.md — Daemon wiring + heartbeat inbox reconciler (Wave 3)

### Phase 62: Policy Layer + Dry-Run

**Goal**: Operators edit one declarative YAML file to route triggers → agents with payload templates, throttles, priorities, and enable/disable flags, hot-reload takes effect on the next evaluation, and dry-run proves a policy change does what they think BEFORE any agent is woken

**Depends on**: Phase 60 (the PolicyEvaluator ships there as an internal chokepoint — this phase exposes the external DSL, hot-reload, and dry-run surface)

**Requirements**: POL-01, POL-02, POL-03, POL-04

**Success Criteria** (what must be TRUE):
  1. Editing `policies.yaml` with a syntactically invalid rule or a Zod-invalid field causes the daemon to reject the update atomically (prior policy stays live, error surfaced to operator) — boot never proceeds with a broken policy (POL-01).
  2. A single policy rule can express source-match predicates, target agent, Handlebars-style payload template, per-rule throttle / debounce, explicit priority, and an `enabled: false` kill switch — covered by fixtures proving each field is honored by the PolicyEvaluator (POL-02).
  3. Operator edits `policies.yaml` on a running daemon; the next trigger evaluation picks up the new rule without a daemon restart, and the diff is visible in the audit trail (POL-03).
  4. `clawcode policy dry-run --since <window>` (or equivalent) replays the last N recent trigger events against the current-on-disk policy and prints which rules would match which agents with reasons — zero actual agent turns fire (POL-04).

**Plans**: [To be planned]

### Phase 63: Observability Surfaces

**Goal**: Operators see — via CLI, dashboard, and v1.7 trace tree — why any agent woke up, what it delegated, what it cost, and where a chain is currently stuck, end-to-end across all involved agents

**Depends on**: Phase 57-62 (consumes TurnOrigin, tasks.db, trace metadata, trigger_state, and policy rule matches)

**Requirements**: OBS-01, OBS-02, OBS-03, OBS-04, OBS-05

**Success Criteria** (what must be TRUE):
  1. `clawcode triggers` prints a table of recent trigger fires with source, matched rule, target agent, result, and duration — filterable by source and agent (OBS-01).
  2. `clawcode tasks` prints a table of recent inter-agent tasks with caller, target, state, duration, and depth — filterable by agent + state, with cumulative chain-token cost as a visible column (OBS-02, OBS-05).
  3. The dashboard exposes a real-time panel showing in-flight inter-agent tasks as a graph (nodes = agents, edges = tasks) that updates live over SSE as tasks transition state (OBS-03).
  4. Proactive turns and delegated-task turns appear in the v1.7 trace tree with `causation_id`, `trigger_id`, and `task_id` metadata on their root spans; `clawcode trace <causation_id>` walks the entire chain (source event → trigger → turn → handoff → turn → ... → final result) across every involved agent (OBS-04).
  5. The cumulative token count for a handoff chain is visible both in the `clawcode tasks` output and in the trace metadata — answering "how much did this chain cost end-to-end?" without summing by hand (OBS-05).

**Plans**: [To be planned]
**UI hint**: yes

## Progress

**Status:** v1.7 Performance & Latency shipped 2026-04-14. v1.8 Proactive Agents + Handoffs active (roadmap ready 2026-04-15).

| Milestone | Phases | Status | Completed |
|-----------|--------|--------|-----------|
| v1.0 | 1-5 | Complete | 2026-04-09 |
| v1.1 | 6-20 | Complete | 2026-04-09 |
| v1.2 | 21-30 | Complete | 2026-04-09 |
| v1.3 | 31-32 | Complete | 2026-04-09 |
| v1.4 | 33-35 | Complete | 2026-04-10 |
| v1.5 | 36-41 | Complete | 2026-04-10 |
| v1.6 | 42-49 | Complete | 2026-04-12 |
| v1.7 | 50-56 | Complete | 2026-04-14 |
| v1.8 | 57-63 | Active — roadmap ready | — |

### v1.8 Phase Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 57. TurnDispatcher Foundation | 3/3 | Complete    | 2026-04-15 |
| 58. Task Store + State Machine | 3/3 | Complete    | 2026-04-15 |
| 59. Cross-Agent RPC (Handoffs) | 3/3 | Complete    | 2026-04-17 |
| 60. Trigger Engine Foundation | 2/3 | Complete    | 2026-04-17 |
| 61. Additional Trigger Sources | 2/3 | In Progress|  |
| 62. Policy Layer + Dry-Run | 0/? | Not started | - |
| 63. Observability Surfaces | 0/? | Not started | - |
