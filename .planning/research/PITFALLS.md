# Pitfalls Research

**Domain:** Proactive Agent Triggers + Cross-Agent Task Handoffs layered on an existing reactive multi-agent daemon (ClawCode v1.8)
**Researched:** 2026-04-13
**Confidence:** HIGH (industry post-mortems + v1.0-v1.7 codebase + prior milestone learnings)

## Context

ClawCode v1.0-v1.7 shipped a purely reactive substrate: agents wake on Discord messages, cron-fired memory consolidation, or subagent spawns from a parent session. v1.8 introduces two qualitatively different capabilities:

1. **Trigger engine** — agents wake on events they didn't ask for (DB changes, inbox arrivals, webhooks, scheduled observations)
2. **Typed cross-agent RPC** — agents delegate structured tasks and wait for structured responses (distinct from the fire-and-forget inbox pattern shipped in v1.1/v1.6)

The pitfalls below are specific to the *interaction* of these new capabilities with the existing substrate. Generic agent-building warnings are out of scope; this is the narrow set of failures that will ship if we aren't deliberate.

---

## Critical Pitfalls

### Pitfall 1: Trigger-to-Handoff Cascades (Infinite Multi-Agent Loop)

**What goes wrong:**
Agent A handles trigger → writes to DB → DB-change trigger fires agent B → B delegates to A via RPC → A's response side-effects the DB → trigger fires B → ... Token budgets annihilated in minutes. In the worst documented cases, structured handoff cycles burn $40+ of API credits and saturate context windows before any circuit breaker notices. Industry calls this "delegation ping-pong" and it is the most common multi-agent production failure mode.

**Why it happens:**
Each component is locally sane. The trigger engine fires on a real DB change. The handoff is a legitimate delegation. The DB write is the correct output. The pathology is *global*: no single component sees the cycle because each sees only its one edge of the graph. v1.7 added prompt caching and streaming, which *make the loop cheaper per turn and therefore faster*, not slower.

**How to avoid:**
1. **Causation chain on every turn** — every triggered turn and every handoff carries a `causation_id` (stable across the chain) and `generation` (integer incremented per hop). Store in task/trigger records.
2. **Hard generation ceiling** — any turn with `generation > MAX_GENERATION` (start at 5) is refused by the daemon with a CYCLE_DETECTED error before the agent session is spawned. MAX_GENERATION is per-causation-chain, not per-agent.
3. **Same-agent re-entry ban** — if agent X appears twice in the causation chain within 60 seconds, reject. Semantic loops (A→B→A→B) caught by tracking the multiset of agents in the chain and blocking repeats.
4. **Mechanical (not LLM-based) detection** — the check lives in the daemon, *outside* any agent's context, because an agent in a loop cannot reliably reason about being in a loop.
5. **Per-chain token budget** — sum tokens across the entire causation chain and hard-kill when budget exceeded. Budget is separate from per-agent budgets from v1.5.

**Warning signs:**
- Same `causation_id` appears in >3 turns within 60s
- Cost-tracking CLI shows sudden spike attributed to a single chain
- Discord delivery queue depth rising without corresponding human activity
- Same pair of agents trading tasks back-and-forth in audit log

**Phase to address:** Phase 1 (Trigger engine) must define causation_id; Phase 3 (Cross-agent RPC) must enforce generation ceiling and re-entry ban. Circuit breaker is not a "later milestone" item — ship with the first trigger.

---

### Pitfall 2: Webhook/DB Trigger Fires Hundreds of Times Per Minute (No Debouncing)

**What goes wrong:**
A single upstream event source (GitHub webhook spammer, rapid DB row updates during a migration, a cron that fires every second) produces hundreds of triggers in <1 minute. Each trigger spawns an agent turn. With haiku at ~$0.25/MTok input and typical 3K input per turn, 500 turns in a minute is $0.40/min sustained while the trigger source stays hot — but latency from v1.7 warm paths means turns complete in <30s, so *agents can outrun the trigger source and spiral the cost even with streaming responses closed*. Real post-mortems document network blips silently duplicating traffic and counters drifting by 5-10%.

**Why it happens:**
Naive trigger handlers assume upstream events are roughly human-paced. They aren't. Git push, CI build, schema migration, and bulk imports generate event storms. At-least-once delivery semantics (which every sane queue provides) mean the *same* event can arrive many times even without a storm.

**How to avoid:**
1. **Every trigger definition declares a debounce key** (e.g., `repo:owner/name` for GitHub) and debounce window (default 30s, configurable). Subsequent triggers with the same key within the window *replace* the pending trigger (trailing-edge mode) rather than queuing a new one. Leading-edge mode optional for specific trigger types.
2. **Per-trigger-source rate limit** — hard cap on triggers-per-minute from any single source. Excess dropped with `THROTTLED` reason logged.
3. **Idempotency key on every trigger** — derived from event payload (e.g., webhook `X-Event-Id`, DB row `(table, pk, updated_at)`). Store in a `processed_triggers` table with TTL ≥ upstream retry window (default 48h). Duplicate keys → drop silently.
4. **Three-layer deduplication** (industry standard 2026): idempotency key at ingress, debounce key for burst consolidation, DB unique constraint as final safety net.

**Warning signs:**
- Same trigger source accounts for >50% of turns in any 5-minute window
- `processed_triggers` table growing faster than agent audit log
- Cost spike concentrated on a single agent handling one trigger type

**Phase to address:** Phase 1 (Trigger engine foundations). Debouncer and idempotency store are not optional and not Phase 2. No trigger source ships without both.

---

### Pitfall 3: Synchronous Cross-Agent RPC Deadlocks the Daemon

**What goes wrong:**
Agent A calls `rpc.handoff(agentB, task)` and blocks waiting for the reply. Agent B's handler calls `rpc.handoff(agentA, ...)` (reasonable: maybe it needs clarification). Both agents are now in a blocked `await` state. Neither can progress. If there's a third agent in the chain, a three-cycle deadlock is even harder to detect. PROJECT.md explicitly marks *synchronous* agent-to-agent RPC as Out of Scope, but any implementation of "typed task handoff with structured return" risks becoming synchronous in spirit if callers block.

**Why it happens:**
"Structured return" is easy to implement as `await rpc.call(...)`. That's synchronous RPC with extra steps. The async inbox pattern (already shipped in v1.1/v1.6) is explicitly what Out of Scope flagged; v1.8 must not reintroduce sync RPC through the back door.

**How to avoid:**
1. **Handoff is ticket-based, not call-based.** `rpc.handoff(target, task)` returns immediately with a `task_id`. The calling agent's turn *ends*. When the target completes, the daemon enqueues a new trigger for the caller with the result payload. This is mechanically identical to the inbox pattern.
2. **No `await` semantics in the RPC DSL** — there is no API shape that blocks. Callers must explicitly return control and handle the response on the next turn. Document this as a design invariant.
3. **Distributed deadlock detection as defense-in-depth** — maintain a wait-for graph of `task_id → waiting_agent`. Before enqueueing a new handoff, run cycle detection (O(V+E) DFS; 90% of deadlock cycles are length-2 per industry research). Cycle detected → reject with DEADLOCK_RISK error.
4. **Timeout on every task** — no task runs forever. Default 10min, configurable per-task-type. Timeout → deliver TASK_TIMEOUT to caller as normal response.

**Warning signs:**
- Tasks in `pending` state for longer than their timeout
- Wait-for graph contains any cycle
- Same agent appears as both caller and callee in concurrent tasks

**Phase to address:** Phase 3 (Cross-agent RPC). The async-ticket pattern is the architectural hill to die on; a single `await` in the API design cascades into every future integration.

---

### Pitfall 4: Timeout Propagation Is Wrong or Missing

**What goes wrong:**
Agent A has a 30s SLO for responding to a Discord message. A delegates to B with no timeout. B's handler spawns a subagent with 10min timeout. The original Discord user waits 10min for a response because A never set a deadline on the downstream chain. Or conversely: A has a 30s timeout, B completes in 45s, A has already returned a "timed out" message to Discord, but B's result side-effects the DB and now state is inconsistent.

**Why it happens:**
Timeouts are a cross-cutting concern that each layer tends to reinvent. "Caller sets timeout" and "callee sets timeout" are both reasonable, but both → nobody enforces the short timeout the caller needs.

**How to avoid:**
1. **Deadline propagation, not timeout propagation.** Every handoff carries `deadline` (wall-clock), not `timeout_ms` (duration). Downstream tasks compute their own timeout as `min(configured_timeout, deadline - now())`. This composes correctly across chains.
2. **Caller deadline wins** — if A has a 30s deadline and delegates to B, B's own 10min timeout is irrelevant; B has at most 30s. Enforce in the daemon, not in agent code.
3. **Timeout-triggered cleanup is idempotent** — when A times out B's task, A delivers a "B timed out" message to its own audience. If B later completes, the result is *stored in the task record* but no user-facing side effect is triggered (no Discord post, no follow-up turn). Agent can still inspect via CLI / dashboard.
4. **No orphan cleanup that rolls back DB state** — the design should not require distributed transactions across agents. If B partially completes, document in task record; recovery is manual.

**Warning signs:**
- Tasks completing after deadline without being flagged as late
- Discord messages arriving minutes after the user's original message
- Task completion events that don't match any pending caller

**Phase to address:** Phase 3 (Cross-agent RPC). Deadline-as-wall-clock decision must be in the type schema from day one.

---

### Pitfall 5: Policy DSL Accidentally Matches Everything (Or Nothing)

**What goes wrong:**
Operator writes `trigger: db_change, agent: research_agent` intending "the specific table I care about, routed to research_agent." Default policy matcher interprets missing filter as "all DB changes." Every row update in every table now spawns a research_agent turn. Inverse: operator adds overly specific filter, the real event never matches, and they debug for hours before realizing the policy is the issue.

**Why it happens:**
DSLs for rule engines have a steep learning curve and "the interaction of rules can be quite complex — particularly with chaining — and rule systems become very hard to maintain because nobody can understand the implicit program flow" (Fowler). Default-allow vs default-deny is a classic ambiguity that every policy system gets wrong at least once.

**How to avoid:**
1. **Default-deny matching.** A policy with no explicit filter matches nothing, not everything. Operators must write `match: all` explicitly to get the broad behavior. This is annoying for demos and correct for production.
2. **Policy dry-run CLI** — `clawcode trigger dry-run <event_fixture.json>` replays a sample event through the policy engine and prints which rules matched, in order, with reasons. Zero-side-effect. Must ship with Phase 2.
3. **Policy test fixtures checked into config** — every policy rule has at least one positive test (fires) and one negative test (doesn't fire). CI runs `clawcode trigger validate` on every config change.
4. **Ambiguity resolution is explicit** — if two rules match one event, the engine raises `AMBIGUOUS_POLICY` instead of silently picking one. Operator must disambiguate with priority field.
5. **Rule count budget** — warn when policy file exceeds 30 rules. Beyond that, rule interactions become unmaintainable.

**Warning signs:**
- Agent wakes for events the operator didn't intend
- First week after a policy change shows cost anomalies on the newly-matched agent
- Operator comments out rules to "test" behavior (policy lacks dry-run)

**Phase to address:** Phase 2 (Policy layer). Dry-run CLI and default-deny must be in the MVP, not a follow-up.

---

### Pitfall 6: Daemon Restart Loses In-Flight Triggers and Tasks

**What goes wrong:**
Daemon SIGTERM during deploy. In-memory trigger queue has 15 pending triggers. 3 agents are mid-turn with 7 pending cross-agent tasks. Daemon comes back up: queues are empty, tasks are marked `running` but no process alive, triggers never fire, callers never get responses. Zombie tasks in Airflow's documented failure mode: "marked UP_FOR_RETRY and immediately after FAILED" without actually retrying.

**Why it happens:**
v1.0-v1.7 treated daemon state as transient — it was a reactive router, not a stateful orchestrator. v1.8 changes this: the trigger engine and task lifecycle *are* durable state. The substrate doesn't yet assume this.

**How to avoid:**
1. **All trigger/task state in SQLite, not memory.** Triggers persisted on ingest before any processing. Tasks persisted on creation, state transitions committed before the side-effect fires.
2. **Daemon boot reconciliation** — on startup, scan tasks in `running` state with no live PID → move to `crashed`, enqueue a synthetic TASK_FAILED callback to the caller. Scan pending triggers → replay through policy engine.
3. **Heartbeat for long-running tasks** — every task writes a heartbeat every 30s while running. Watchdog marks tasks with stale heartbeats (>2x interval) as `zombie` and triggers the same crash-callback. Industry threshold: `scheduler_zombie_task_threshold` at 20-30min for production (Airflow). Start shorter because ClawCode tasks are short.
4. **Crash-callback is idempotent** — if the daemon delivers "B crashed" to A, and then B finishes anyway, A's record shows B crashed once. Don't deliver a second completion event.
5. **Graceful shutdown window** — SIGTERM → stop accepting new triggers, drain in-flight for up to 30s, persist remaining queue depth, then exit. Systemd `TimeoutStopSec=45`.

**Warning signs:**
- Tasks in `running` state older than their max-timeout
- Heartbeat intervals growing (worker overload, not always zombie)
- Same task entering `crashed` state multiple times (detection firing during purge, per Airflow issue #51969)

**Phase to address:** Phase 4 (Task lifecycle + durability). Cannot defer; restarts happen in dev from day one.

---

### Pitfall 7: Observability Gap — Nobody Can Answer "Why Did Agent X Wake Up?"

**What goes wrong:**
Operator sees agent X burned $2 of haiku in the last hour. `clawcode costs` shows the spend. `clawcode memory search` shows the turns. But nothing ties those turns back to the *originating trigger*. Was it a webhook? A DB change? A handoff from agent Y? The trigger fired another trigger? Without the causation chain, operators cannot reason about their agent fleet. Industry consensus 2026: "Agent debugging requires step-level causality, not just final output logging."

**Why it happens:**
v1.7 added phase-level latency traces *within a turn*. v1.8 adds *cross-turn* causality (trigger → turn → handoff → turn → ...). These are different graphs. Reusing the turn-scoped tracer for cross-turn chains produces traces that are internally correct but never stitch together.

**How to avoid:**
1. **Causation chain is a first-class concept.** Every turn records `causation_id` (uuid, stable across the chain) and `parent_turn_id` (nullable, points to triggering turn or None for human-initiated). Every trigger, handoff, and scheduled observation propagates causation_id.
2. **OpenTelemetry GenAI semantic conventions** — 2026 industry standard. Use `span_context` in every inter-agent payload so tracing tools can stitch the DAG automatically. Even if we don't export to an OTel collector in v1.8, use the trace/span ID shape.
3. **`clawcode trace <causation_id>` CLI** — prints the full causal DAG: originating trigger, every turn, every handoff, costs, durations, final state. Equivalent dashboard view with SSE live updates.
4. **Trigger fires include "why": `source`, `source_id`, `rule_matched`** — never just "db_change" without the rule that routed it here.
5. **Cost attribution to the causation chain**, not just the agent. `clawcode costs --by-chain` surfaces expensive chains across agents. Makes Pitfall 1 (cascades) visible before they bankrupt you.

**Warning signs:**
- Operator asking "what triggered this?" and needing to grep logs
- Costs spike but no individual agent is obviously responsible
- `causation_id` cardinality much higher than trigger count (implies broken propagation)

**Phase to address:** Phase 1 (Trigger engine) defines causation_id propagation; Phase 5 (Discord surfaces / CLI) ships `clawcode trace`. Cannot be a "nice to have" — without it, Pitfalls 1 and 2 are invisible.

---

### Pitfall 8: Discord Rate Limit Storm From Trigger Notifications

**What goes wrong:**
Every trigger posts a "waking up on trigger X" Discord notification for operator visibility. A burst of 200 triggers (which Pitfall 2 debouncing should prevent, but belt-and-suspenders) means 200 Discord messages. Discord's 50 req/sec global cap (and lower per-channel caps) means the bot gets 429-rate-limited, and the existing v1.2 delivery queue (already hardened with retry) backs up and delays *user-facing* messages.

**Why it happens:**
Notifications look free — they're "just Discord messages." But 14+ agents * many triggers * webhook posts share a single bot token's rate limit bucket. v1.0 shipped a centralized rate limiter; v1.8 must not circumvent it by posting via a second code path.

**How to avoid:**
1. **All trigger notifications route through the existing v1.2 Discord delivery queue.** No direct `discord.send()` from trigger-engine code. This is enforced by architectural review, not by library.
2. **Trigger notifications are opt-in per trigger rule and throttled per rule** — default "silent execution." Operator sets `notify: summary_per_hour` or `notify: each_fire` explicitly. Default matches the v1.7 perf work (don't speak unless needed).
3. **Summary notifications over per-fire** — if a trigger fires >N times in a window, post one aggregate message ("handled 47 events in last 5min") instead of 47 individual posts.
4. **Trigger-source notifications use a dedicated low-priority lane** in the delivery queue. User-facing replies always preempt.

**Warning signs:**
- Discord delivery queue depth >100 during non-human activity
- 429 responses in daemon logs (should be zero with the centralized limiter working)
- User messages with reply latency >5s when the p95 was <1s pre-trigger

**Phase to address:** Phase 5 (Discord surfaces). Default-silent rule ships with Phase 2 policy defaults.

---

### Pitfall 9: Model Cost Amplification Across Handoff Chains

**What goes wrong:**
Research 2026 documents multi-agent handoffs producing 3.5x token amplification over single-agent baselines, and unstructured networks amplify *errors* up to 17.2x. ClawCode v1.5 shipped per-agent cost tracking and model tiering — but those budgets are per-agent. A chain A→B→C→D might have each agent under its per-agent limit and still spend 4x what any single agent "should." The haiku-default from v1.5 helps, but chains of haiku calls can still be expensive, and a chain that fork-escalates at any hop inflates immediately.

**Why it happens:**
Budget is local; cost is global. Per-agent circuit breakers don't detect chains. Fork-based escalation (v1.5) is correct locally but amplifies when the escalated output feeds another agent's context.

**How to avoid:**
1. **Per-causation-chain budget**, enforced in the daemon, separate from per-agent budgets. Default: 20K tokens input + 5K output across the entire chain. Exceeded → hard-stop the chain with CHAIN_BUDGET_EXCEEDED.
2. **Handoff payload size limits** — delegating agent cannot pass unlimited context to callee. Enforce schema-validated handoff input (Phase 3 typing) with max size (e.g., 4K tokens). Forces structured handoffs, not "context pass-through."
3. **Escalation budget awareness** — v1.5 per-agent escalation budget should also check chain budget before fork-escalating. Escalation in a chain at generation ≥ 3 requires explicit operator config.
4. **Chain-level cost in observability** — `clawcode costs --by-chain` (see Pitfall 7). Without this, chain costs are diffused across per-agent reports and invisible.

**Warning signs:**
- `haiku` costs inexplicably high despite heavy use (chains of 5-6 cheap calls)
- Fork escalations triggered inside handoff chains
- Single-week cost total materially above v1.7 baseline without matching user-visible throughput increase

**Phase to address:** Phase 3 (RPC) implements handoff payload limits; Phase 4 (Task lifecycle) implements chain budget tracking; Phase 5 (observability) surfaces `--by-chain` costs.

---

### Pitfall 10: Clock Skew and Polling-vs-Event-Driven Trigger Blindness

**What goes wrong:**
Trigger relies on `updated_at > last_seen`. Clock on the DB source drifts by 5 seconds vs daemon clock. Events in the skew window are silently missed. Or: daemon polls every 60s with `LIMIT 100`; upstream writes 150 rows between polls, oldest 50 never processed. SQLite `update_hook()` only fires for changes *made on the same connection* — which is a known gotcha: "cannot access changes made outside of that connection, including changes by another process." For cross-process DB triggers, polling is the only option — but naive polling loses events.

**Why it happens:**
"Event-driven" is aspirational; the physics of cross-process SQLite forces polling for most integrations. But polling carries its own hazards: missed events, clock skew, pagination boundaries, re-entrancy during slow polls.

**How to avoid:**
1. **Polling uses `data_version` (SQLite pragma) or a monotonic log-table cursor**, never wall-clock `updated_at`. Monotonic cursor eliminates clock skew entirely; there is no "time" to be wrong about.
2. **Log-table pattern** for DB triggers — writes go through a wrapper that inserts into `event_log(id, table, pk, op, payload)` where id is AUTOINCREMENT. Poller reads `WHERE id > last_seen` with no LIMIT (or pagination with guaranteed cursor advance).
3. **`sqlite3_update_hook()` only used for same-process triggers** (e.g., memory store in the daemon process triggering daemon-side behavior). Cross-process (agent workspaces → daemon) always uses log-table polling.
4. **Webhook triggers use `X-Event-Id` + retry window** — not timestamps. Idempotency key from Pitfall 2 eliminates duplicate-processing from re-delivery.
5. **Poll interval sized to the event rate** — 1s for DB where writes are frequent, 10s for inbox-style arrivals, 60s only for things that rarely change. Don't use a global interval.
6. **"Missed event" alarm** — if poller finds a cursor that jumped by >expected_rate_per_interval * 10, alert. This is usually a bug (poller was stopped) not a legitimate burst.

**Warning signs:**
- `last_seen` cursor matches the most recent event ID but tests still show missed events (bug is in LIMIT pagination)
- Events near wall-clock minute boundaries disproportionately missed (cron-style skew)
- `data_version` unchanged but `event_log` has new rows (WAL not committed yet; poller polled between transaction start and commit)

**Phase to address:** Phase 1 (Trigger engine). Every trigger source's delivery semantics must be documented with worked examples of the skew/missed-event edge cases.

---

## Moderate Pitfalls

### Pitfall 11: Scope Leakage — Agent A's Context Bleeds Into Agent B's Response

**What goes wrong:**
Agent A receives a Discord message in a private channel. A delegates a sub-task to B. B's prompt gets A's full conversation context (easy mistake: "pass context to help B understand"). B, which has no Discord ACL for that channel, now *reasons over* private data and potentially surfaces it in its own public channel response.

**How to avoid:**
1. Handoff payloads are schema-validated (Phase 3). B receives *only* the structured fields declared by the task type, not A's raw context.
2. Channel ACLs from v1.2 (SECURITY.md per-agent channel ACLs) are enforced on handoff: B cannot be delegated to if the task payload references channels B cannot see. Enforce in daemon before task dispatch.
3. Handoff result is scoped too — B's response is routed back to A's causation context but does not land in B's own Discord channels unless explicitly configured.

**Phase to address:** Phase 3 (RPC) with explicit Phase 5 audit.

---

### Pitfall 12: Retry Storms on Transient Failures

**What goes wrong:**
Trigger fires → agent turn fails (rate limit, network, tool timeout). Retry policy: immediate retry 3x. All 3 retries fail for the same reason (upstream still down). Meanwhile 20 more triggers arrived. Now we have 20 × 4 = 80 failed turn attempts. Exponential backoff is standard for a reason.

**How to avoid:**
1. Exponential backoff with jitter — standard queue pattern, `delay = base * 2^attempt + random(0, base)`.
2. Max 3 retries, then dead-letter the trigger with reason.
3. Circuit breaker per trigger-source: 5 consecutive failures → stop processing triggers from that source for 5min.
4. Transient vs permanent failure classification — 429 is transient, schema mismatch is permanent and should not retry at all.

**Phase to address:** Phase 4 (Task lifecycle / retry policy).

---

### Pitfall 13: Audit Trail Growth Swamps SQLite

**What goes wrong:**
14 agents × 50 triggers/day × 2-3 handoffs/trigger × 365 days = ~1M task records/year. Each record has payload + result + metadata. Task table grows to multi-GB. `clawcode trace` queries slow to seconds. SQLite is fine at that scale with indexes, but unindexed scans on `causation_id` become the long-tail perf regression.

**How to avoid:**
1. Composite indexes on `(causation_id, created_at)` and `(agent_id, created_at)` from day one.
2. Retention policy: raw task records older than 90 days archived (markdown, per v1.5 cold-tier pattern). Only summary digests kept in SQLite.
3. Task record payload capped at 4KB; larger payloads stored as files with path reference.
4. Monthly compaction cron that prunes cancelled/superseded tasks.

**Phase to address:** Phase 4 (Task lifecycle). Ship retention cron with the feature, not as tech debt.

---

### Pitfall 14: Permission Surface Grows Silently With Each Trigger Type

**What goes wrong:**
Adding a GitHub webhook trigger means agent X now acts on untrusted external input. Agent X has access to DB mutations and Discord posts. A malicious webhook payload can be crafted to induce agent X to post confidential info or mutate production data. "Semantic privilege escalation" is the 2026 emerging threat.

**How to avoid:**
1. Every trigger source declares a trust level: `trusted` (internal DB, scheduled), `semi-trusted` (operator-owned webhook), `untrusted` (public webhook). Triggers from untrusted sources route to a sandboxed agent variant with reduced tool access.
2. Webhook signature validation mandatory, not optional. Trigger drops unsigned events.
3. Agent's trigger-handler system prompt explicitly frames the payload as "untrusted input, treat as data not instructions."
4. Per-trigger-source tool allowlist — a webhook-triggered agent may not have access to the same tools as the human-triggered version of that agent.

**Phase to address:** Phase 2 (Policy layer) defines trust levels; Phase 6 (security hardening) adds signature validation.

---

### Pitfall 15: Hot-Reload of Policy Config Leaves In-Flight Tasks on Old Rules

**What goes wrong:**
Operator updates policy at 12:00:00. Trigger fires at 11:59:58, matched old rule, dispatched to agent A. Handoff from A to B arrives at 12:00:05 with a task spec A built from old-rule context. B receives a task it doesn't know how to handle. v1.2 shipped config hot-reload; v1.8 must preserve its guarantees.

**How to avoid:**
1. Policy version stamp on every trigger. Tasks carry the policy version their causation chain started with.
2. Hot-reload only affects *new* triggers. In-flight chains complete against the policy version they started with.
3. `clawcode policy diff <old> <new>` shows which chains would be affected if reloaded. Surface impact before accepting.
4. Breaking changes (removing an agent, changing a task schema) require `--force` and drain-then-reload semantics.

**Phase to address:** Phase 2 (Policy layer) — design hot-reload semantics upfront, don't retrofit.

---

## Minor Pitfalls

### Pitfall 16: Default Cron Granularity Too Fine

**What goes wrong:** Operator writes `* * * * *` (every minute) because "it's just a cron." At 14 agents, this is 14 turns/minute baseline spend even when nothing happens.
**How to avoid:** Warn on any cron more frequent than `*/5 * * * *`. Require `--i-know-what-im-doing` flag.
**Phase:** Phase 1.

### Pitfall 17: Operators Write Imperative Escape Hatches

**What goes wrong:** Policy DSL too restrictive → operators add `custom_handler: ./my_script.ts` that bypasses all safety checks.
**How to avoid:** No escape hatch. If DSL can't express a rule, extend the DSL. Log "can't express" requests and iterate.
**Phase:** Phase 2.

### Pitfall 18: No Task Cancellation From Caller

**What goes wrong:** A delegates to B, then human tells A "never mind." A has no way to cancel B's in-flight task.
**How to avoid:** `rpc.cancel(task_id)` — sends cooperative cancel signal, B's agent sees it on next tool-call boundary, can clean up.
**Phase:** Phase 3.

### Pitfall 19: Trigger Source Health Monitoring Missing

**What goes wrong:** Webhook source goes silent. Operator assumes "nothing interesting happened." Source was actually down for a week.
**How to avoid:** Per-source expected-rate config. Alarm if rate drops >80% below baseline. Heartbeat events from sources that support them.
**Phase:** Phase 5.

### Pitfall 20: Self-Handoff

**What goes wrong:** Agent X delegates to agent X. Works! Accidentally. Creates weird semantics.
**How to avoid:** Daemon rejects self-handoff with clear error. If an agent needs "defer this to myself," use scheduled trigger, not RPC.
**Phase:** Phase 3.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip causation_id propagation in Phase 1 ("add it when observability is needed") | 1 fewer field in schemas | Pitfalls 1, 7, 9 all undebuggable. Retrofitting requires touching every trigger/handoff path. | **Never.** causation_id is load-bearing for every other pitfall. |
| Let handoff payloads be typed as `Record<string, unknown>` | Faster Phase 3 | Pitfall 11 (scope leakage) invisible. No schema validation means no size limit, no ACL check. | Only for internal-only task types with explicit Admin agent scope. |
| In-memory trigger queue for Phase 1 | Faster to ship | Pitfall 6 (daemon restart) kicks in day 1. Every dev restart loses state. | **Never.** SQLite persistence is cheap. |
| Synchronous `await` on handoff "just for MVP" | Simpler API | Pitfall 3 (deadlock) ships with feature. Refactor later requires touching every agent. | **Never.** Async-ticket from day one. |
| Wall-clock timeouts instead of deadlines | Familiar API | Pitfall 4 compounds across every chain. Each hop reinvents "but my timeout was…" | **Never.** Deadline is 1 extra field. |
| Single global rate limit for all triggers | Simple config | Pitfall 2 per-source gets complex. One noisy source starves quiet ones. | Acceptable for MVP if per-source added by Phase 2 end. |
| Policy engine that "tries its best" on ambiguity | Feels friendly | Pitfall 5 (silent misrouting) is the #1 debugging nightmare. | **Never.** Fail loud with AMBIGUOUS_POLICY. |

---

## Integration Gotchas

Common mistakes when connecting to external services or internal substrate.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| SQLite DB triggers | Using `sqlite3_update_hook()` from another process | Cross-process change detection requires polling `data_version` or log-table cursor; update_hook fires only within the same connection |
| Webhook sources | Trusting sender IP for auth | HMAC signature verification against a shared secret; reject unsigned events |
| Discord notifications | Direct `discord.send()` bypassing v1.2 delivery queue | All outbound Discord traffic routes through the centralized rate limiter + queue |
| Prompt caching (v1.7) in triggered turns | Inject trigger payload into the stable prefix | Trigger payload goes in the append block; prefix stays stable across triggers for cache hit |
| v1.5 fork-escalation inside handoff chain | Each hop may fork independently | Chain-level escalation budget; gen ≥ 3 requires explicit config |
| v1.6 agent-to-agent Discord messaging | Reuse for RPC | Keep Discord messaging for human-visible coordination; RPC is a separate internal channel (task store + triggers) |
| v1.1 inbox pattern | Deprecate in favor of RPC | **Don't.** Inbox is for fire-and-forget; RPC is for typed-with-response. Coexist. |
| v1.7 warm-session reuse | Trigger-fired turns reuse warm session from prior human turn | Warm session reuse is fine but `causation_id` must be per-chain not per-session |
| Claude Agent SDK `forkSession` | Use for every handoff | Forking creates stateful branches; handoff wants clean context. Use clean child session, not fork, for RPC. |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Full table scan on `causation_id` for trace lookup | `clawcode trace` latency grows linearly with log size | Composite index `(causation_id, created_at)` | ~50K tasks |
| Unbounded task retention | SQLite DB size >5GB, backup times explode | 90-day retention + cold archive | 6-12 months of 14-agent activity |
| Poll-all-sources-in-one-loop | Slow source (webhook check with HTTP timeout) stalls fast source (local DB) | Per-source poller processes with independent cadence | Any source with >5s latency |
| Trigger queue as array with linear scan for dedup | Dedup check grows O(n) per trigger | Set / hashmap keyed on idempotency_key | >1K triggers/minute |
| No bulk handoff schema validation | Zod validation per-task fires per-handoff | Cache compiled zod schemas per task type | >100 tasks/second, unlikely in ClawCode |
| Heartbeat for every task every 5s | 14 agents × 10 tasks × 12/min = 1,680 writes/min | Heartbeat only for tasks expected to exceed 30s | Tasks average >1min duration |
| Dashboard SSE pushes every task state change | Client CPU maxed; SSE drops | Coalesce state changes with 500ms debounce | >5 concurrent tasks |

---

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Untrusted trigger payload treated as agent instruction | Prompt injection via webhook body; attacker makes agent post secrets | System prompt wraps payload as "untrusted data"; per-source trust level enum; webhook signature validation |
| Handoff payload can reference arbitrary file paths | Agent B reads A's workspace files via `payload.file_path` | Schema-validated paths, per-agent workspace jail enforced in daemon |
| Cross-agent RPC bypasses channel ACLs | Agent B reasons over A's private channel data, replies in B's public channel | ACL check at handoff dispatch: B must have same-or-greater clearance on any referenced channel |
| No audit trail for who triggered what | Operator cannot answer "did this LLM really mutate prod?" | Every task record includes `triggered_by` (user ID, trigger source, or parent task) and is append-only |
| Policy file has no access control | Anyone with repo write can reroute all triggers to their agent | Policy file signed (e.g., `clawcode policy sign`) + daemon verifies signature at load |
| Retry on 401/403 | Wastes budget on permanent auth failure + may mask credential rotation | Classify errors as transient/permanent; never retry permanent |
| Semantic privilege escalation | Agent with tool access does something "semantically wrong" (permitted but harmful) | Per-trigger-source tool allowlist: webhook-fired agent has narrower tool access than human-fired |
| Over-permissioned admin agent handling triggers | Admin agent receives external triggers; blast radius = entire fleet | Admin agent disabled from external triggers by default. Triggered admin tasks route through a mediator agent with narrower scope. |

---

## UX Pitfalls

Common operator experience mistakes in this domain.

| Pitfall | Operator Impact | Better Approach |
|---------|-----------------|-----------------|
| Policy errors surface at runtime | Operator edits config, deploys, then at 3am a trigger fires a 500-error chain | `clawcode policy validate` at edit time + dry-run CLI + CI check |
| No "last 10 fires" view per trigger | Operator cannot quickly see what a trigger has been doing | Dashboard panel per-trigger: last 10 fires with causation_ids + outcomes |
| Cost spike has no attribution | Operator sees "$30 today, up from $8" with no further info | `clawcode costs --by-chain --since 24h` shows top 10 chains by spend |
| Handoff failures silently retry | Operator thinks handoff succeeded; it's on retry 3 | Handoff state visible in dashboard with retry count; Discord notification on final failure |
| Trigger definition lives only in TypeScript | Non-dev operator cannot add a cron observation | Declarative YAML policies (Phase 2 DSL); TS escape hatch only for last resort |
| No "pause trigger" operation | Operator has to edit config + reload to silence noisy trigger | `clawcode trigger pause <name>` → one-shot, audit-logged, with auto-unpause timer |
| Dashboard shows agent state but not chain state | Operator sees A "idle" without realizing A is waiting on B's handoff | Dashboard distinguishes "idle" from "awaiting handoff" with chain link |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Trigger engine:** Often ships without dry-run — verify `clawcode trigger dry-run` exists and exits nonzero on unmatched fixtures.
- [ ] **Trigger engine:** Often ships without per-source debounce — verify burst of 100 identical events produces ≤5 turns.
- [ ] **Trigger engine:** Often ships without idempotency store — verify replaying same webhook 10x produces 1 turn.
- [ ] **Trigger engine:** Often ships without causation_id — verify every turn record has populated causation_id and parent_turn_id.
- [ ] **Policy layer:** Often ships with default-allow — verify empty-filter rule does NOT match all events.
- [ ] **Policy layer:** Often ships without ambiguity detection — verify two rules matching same event raises AMBIGUOUS_POLICY.
- [ ] **Cross-agent RPC:** Often ships with `await` semantics — verify handoff API returns task_id synchronously, never blocks.
- [ ] **Cross-agent RPC:** Often ships without deadline propagation — verify child task inherits parent's deadline, not just timeout.
- [ ] **Cross-agent RPC:** Often ships without cycle detection — verify A→B→A is rejected before B is dispatched.
- [ ] **Cross-agent RPC:** Often ships without chain budget — verify 10-hop chain terminates on budget before completing.
- [ ] **Cross-agent RPC:** Often ships without self-handoff block — verify A→A rejected.
- [ ] **Task lifecycle:** Often ships without crash reconciliation — verify SIGKILL mid-task produces TASK_FAILED callback on restart.
- [ ] **Task lifecycle:** Often ships without retention — verify 100K-task DB stays <500MB and `clawcode trace` <500ms p95.
- [ ] **Observability:** Often ships without `clawcode trace` — verify CLI can reconstruct any causation chain end-to-end.
- [ ] **Observability:** Often ships without per-chain cost — verify dashboard surfaces chain-level spend, not just per-agent.
- [ ] **Discord surfaces:** Often ships without throttled notifications — verify 100 trigger fires produce ≤3 Discord messages (aggregated).
- [ ] **Integration with v1.7:** Often ships without cache-aware prefix — verify trigger payload lands in append block so prompt cache still hits.
- [ ] **Integration with v1.5:** Often ships without chain-aware escalation — verify fork-escalation at chain generation ≥ 3 requires explicit config.
- [ ] **Integration with v1.2 ACLs:** Often ships bypassing channel ACLs — verify handoff refuses if callee lacks ACL on referenced channel.

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Cascade / infinite loop in production | HIGH | 1) `clawcode trigger pause --all`  2) Identify causation_id from cost spike  3) Kill all tasks in chain  4) Inspect which rule+handoff combo closed the cycle  5) Add explicit re-entry block for that pair  6) `clawcode trigger resume` |
| Trigger storm flooding Discord | MEDIUM | 1) Pause offending trigger  2) Drain delivery queue  3) Add/tighten debounce key  4) Resume with `notify: summary_per_hour`  5) Post-mortem for why burst exceeded debounce |
| Deadlocked chain | MEDIUM | 1) `clawcode task list --state pending --older-than 10m`  2) Force-cancel the root task (others cascade-cancel)  3) Add cycle to wait-for graph unit test  4) Fix the API that allowed the circular wait (likely a sync-shaped API leaked in) |
| Zombie tasks on daemon restart | LOW | 1) Daemon boot reconciliation should auto-handle  2) If not: `clawcode task reconcile` manual sweep  3) Check heartbeat threshold config  4) Add missing heartbeat write site |
| Policy misroute (wrong agent woke up) | LOW | 1) Dry-run reveals mismatch  2) Add negative test fixture  3) Fix rule  4) Hot-reload safe because in-flight chains carry old policy version |
| Cost blowout from chain amplification | MEDIUM | 1) `clawcode costs --by-chain`  2) Chain-level budget caps future chains  3) Audit which agents participate in >3-hop chains  4) Consider flattening via orchestrator agent |
| Trigger source silently dead | MEDIUM | 1) Per-source health alarm should detect  2) If missed: compare current rate to baseline; investigate source  3) Add heartbeat event type to source if supported |
| Scope leakage (secrets across handoffs) | HIGH | 1) Rotate any leaked secret  2) Audit all handoff schemas for unconstrained string fields  3) Add size + content validators  4) Add ACL cross-check to daemon handoff dispatch |
| Audit trail DB bloat | LOW | 1) Run retention cron manually  2) Verify cold-archive wrote  3) VACUUM the SQLite DB  4) Add retention alarm at 80% threshold |
| Policy DSL too restrictive → imperative escape hatch crept in | MEDIUM | 1) Identify what the DSL couldn't express  2) Extend DSL minimally  3) Remove escape hatch  4) Backfill policy tests |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls. (Phase names are indicative; roadmap agent will finalize.)

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. Trigger-handoff cascade (infinite loop) | Phase 1 (causation_id) + Phase 3 (generation ceiling, re-entry ban) + Phase 4 (chain budget) | E2E test: synthetic A↔B cycle terminates within 5 hops |
| 2. Trigger storm (no debouncing) | Phase 1 (debouncer + idempotency store) | Bench: 1000 duplicate webhooks → ≤1 turn; 200 rapid events with same debounce key → 1 turn |
| 3. Sync RPC deadlock | Phase 3 (async-ticket API, no await) + Phase 4 (cycle detection) | Unit test: API surface has no blocking call shape; integration: A→B→A rejected |
| 4. Timeout propagation | Phase 3 (deadline field, not timeout_ms) | Test: A with 30s deadline, B with 10min config → B enforces 30s |
| 5. Policy DSL ambiguity | Phase 2 (default-deny, dry-run, ambiguity error) | CLI: `clawcode trigger dry-run` + fixtures committed; CI green on validate |
| 6. Daemon restart zombie tasks | Phase 4 (SQLite persistence + boot reconciliation + heartbeats) | Chaos test: SIGKILL mid-task → restart → caller gets TASK_FAILED |
| 7. Observability gap | Phase 1 (causation_id propagation) + Phase 5 (`clawcode trace` CLI + dashboard DAG view) | Demo: pick any turn, reconstruct full chain from trigger to final state |
| 8. Discord rate limit storm | Phase 5 (throttled notifications, default-silent rule) | Bench: 100 trigger fires → ≤3 Discord messages; user replies unaffected |
| 9. Cost amplification | Phase 3 (handoff payload size limit) + Phase 4 (chain budget) + Phase 5 (`--by-chain` costs) | Bench: 5-hop chain stays under budget; cost CLI attributes chain spend correctly |
| 10. Clock skew / polling misses events | Phase 1 (log-table cursor, not wall-clock; per-source poll interval) | Chaos test: clock skew 30s, burst of 150 events → all 150 processed |
| 11. Scope leakage | Phase 3 (schema-validated payloads, ACL cross-check) | Security test: handoff with A-private channel ref to B without ACL → rejected |
| 12. Retry storms | Phase 4 (exponential backoff, circuit breaker per source) | Chaos test: source failing 100% → circuit opens in 5 attempts, backoff scales |
| 13. Audit trail growth | Phase 4 (indexes + retention cron) | Synthetic 1M-task load → `clawcode trace` p95 < 500ms; DB size monitored |
| 14. Permission surface via triggers | Phase 2 (per-source trust level) + Phase 6 (signature verification) | Security test: unsigned webhook rejected; untrusted-trigger agent has narrower tool set |
| 15. Hot-reload mid-chain | Phase 2 (policy version per chain) | Test: policy edit mid-chain → in-flight uses old version, new trigger uses new |
| 16. Cron too fine | Phase 1 (warn on sub-5min cron) | CLI warns, requires flag |
| 17. Imperative escape hatch | Phase 2 (no custom_handler field in DSL) | Schema review: DSL grammar has no free-form code hook |
| 18. No task cancellation | Phase 3 (`rpc.cancel`) | E2E: caller cancels → callee receives signal → task transitions to cancelled |
| 19. Trigger source health | Phase 5 (per-source rate baseline + alarm) | Chaos test: source silent 5min → alarm fires |
| 20. Self-handoff | Phase 3 (daemon rejects A→A) | Unit test |

---

## Don't-Build Recommendations

Features that sound useful but will cause net-negative outcomes.

| Don't Build | Why | Do This Instead |
|-------------|-----|-----------------|
| Synchronous RPC with `await` | Pitfall 3; Out of Scope in PROJECT.md | Async-ticket pattern (handoff returns task_id, result delivered as next trigger) |
| Shared task queue across all agents | Violates workspace isolation; cross-agent contention | Per-agent inbound queue + daemon-level global task registry for observability only |
| Automatic trigger → tool-call mapping | "If trigger X fires, auto-run tool Y" skips agent reasoning and makes guardrails impossible | Trigger always wakes an agent turn; tool-calls remain agent-initiated |
| LLM-based policy matching | "Ask Claude if this event matches rule" is slow, non-deterministic, expensive | Declarative DSL evaluated by a plain interpreter |
| Distributed transaction across agents | Designed-for-failure 2PC implementations cost more than they're worth at 14-agent scale | Eventual consistency + idempotent operations + compensating actions |
| Trigger-to-trigger chaining in the DSL | Encourages Pitfall 1 by making cascades syntactically easy | Chains happen via agent-initiated handoffs, which go through daemon-level checks |
| Priority queue with starvation | "Urgent" triggers bypass fair scheduling; low-prio triggers starve | Fair-weighted scheduling across trigger sources; "urgency" is operator's responsibility to not misuse |
| Custom retry predicate as code | Operator writes `shouldRetry(err) => ...` in TS | Enum of error classes (TRANSIENT, PERMANENT, BUDGET) with fixed semantics |
| Backpressure via drop-oldest | Silently losing triggers is worse than visibly stalling | Backpressure via reject-new with clear error; operator adjusts rate or capacity |
| Multi-consumer fan-out on single trigger | "Trigger X fires agents A, B, C in parallel" | Single primary target; A can handoff to B, C if needed — keeps causation chain linear |

---

## Sources

**Infinite loops and multi-agent cascades:**
- [The Multi-Agent Trap (Towards Data Science)](https://towardsdatascience.com/the-multi-agent-trap/) — 17.2x error amplification in unstructured networks
- [When AI Agents Collide: Multi-Agent Orchestration Failure Playbook 2026 (Cogent)](https://cogentinfo.com/resources/when-ai-agents-collide-multi-agent-orchestration-failure-playbook-for-2026)
- [Delegation Ping-Pong: Breaking Infinite Handoff Loops in CrewAI (azguards)](https://azguards.com/technical/the-delegation-ping-pong-breaking-infinite-handoff-loops-in-crewai-hierarchical-topologies/) — mathematical detection, semantic hashing
- [Fix Infinite Loops in Multi-Agent Chat Frameworks (Markaicode)](https://markaicode.com/fix-infinite-loops-multi-agent-chat/) — missing max_turns, termination function, "done" signal
- [Multi-Agent System Reliability: Failure Patterns 2026 (Maxim)](https://www.getmaxim.ai/articles/multi-agent-system-reliability-failure-patterns-root-causes-and-production-validation-strategies/)

**Idempotency, debouncing, deduplication:**
- [Idempotency and Reliability in Event-Driven Systems (DZone)](https://dzone.com/articles/idempotency-and-reliability-in-event-driven-systems)
- [Handling idempotency (Inngest)](https://www.inngest.com/docs/guides/handling-idempotency) — debounce key with leading/trailing mode
- [Idempotency and ordering in event-driven systems (CockroachDB)](https://www.cockroachlabs.com/blog/idempotency-and-ordering-in-event-driven-systems/)
- [Deduplication Strategies in Microservices 2026 (OneUptime)](https://oneuptime.com/blog/post/2026-01-30-microservices-deduplication-strategies/view) — three-layer pattern
- [Implement Webhook Idempotency (Hookdeck)](https://hookdeck.com/webhooks/guides/implement-webhook-idempotency)
- [Idempotency and Deduplication (Svix)](https://www.svix.com/resources/webhook-university/reliability/idempotency-and-deduplication/)

**Distributed deadlock detection:**
- [Correct Black-Box Monitors for Distributed Deadlock Detection (arXiv 2508.14851)](https://arxiv.org/abs/2508.14851) — 2025 formal model for RPC cycle detection
- [Improved Deadlock Detection Algorithm for Distributed Computing Systems](https://www.preprints.org/manuscript/202403.1310) — 90% of cycles are length-2

**Cost amplification:**
- [Token Cost Trap: Why Your AI Agent's ROI Breaks at Scale](https://medium.com/@klaushofenbitzer/token-cost-trap-why-your-ai-agents-roi-breaks-at-scale-and-how-to-fix-it-4e4a9f6f5b9a) — 3.5x amplification, $40/min retry loops
- [Beyond Max Tokens: Stealthy Resource Amplification via Tool Calling Chains](https://arxiv.org/html/2601.10955v2) — 658x cost inflation via tool chains
- [AI Agent Token Budget Management (MindStudio)](https://www.mindstudio.ai/blog/ai-agent-token-budget-management-claude-code)

**Task queue zombies / reliability:**
- [Zombie Tasks Get Killed After Retry (Airflow #27071)](https://github.com/apache/airflow/discussions/27071)
- [Zombie and Undead tasks in Airflow (Medium)](https://medium.com/@brihati1373/zombie-and-undead-tasks-in-airflow-e09ddbe6b22f)
- [Same TI without heartbeat found multiple times (Airflow #51969)](https://github.com/apache/airflow/issues/51969) — purge race condition
- [Queue-Based Exponential Backoff (DEV)](https://dev.to/andreparis/queue-based-exponential-backoff-a-resilient-retry-pattern-for-distributed-systems-37f3)

**Policy DSL / rules engines:**
- [Rules Engine (Martin Fowler)](https://martinfowler.com/bliki/RulesEngine.html) — rule interaction complexity warning
- [What is Policy as Code 2026 (DevSecOpsSchool)](https://devsecopsschool.com/blog/policy-as-code/) — default-permissive baseline as pitfall
- [Some Thoughts on Rules Engines (Jonathan Maltz)](http://maltzj.com/posts/rules-engines)

**SQLite change detection:**
- [SQLite User Forum: Cross process change notification](https://sqlite.org/forum/info/d2586c18e7197c39c9a9ce7c6c411507c3d1e786a2c4889f996605b236fec1b7) — update_hook only intra-connection
- [SQLite: Data Change Notification Callbacks (docs)](https://sqlite.org/c3ref/update_hook.html)
- [Write-Ahead Logging (SQLite)](https://sqlite.org/wal.html)

**Observability:**
- [Distributed tracing for agentic workflows with OpenTelemetry (Red Hat)](https://developers.redhat.com/articles/2026/04/06/distributed-tracing-agentic-workflows-opentelemetry)
- [AI Agent Observability in 2026: OpenAI Agents SDK, LangSmith, OpenTelemetry](https://dev.to/chunxiaoxx/ai-agent-observability-in-2026-openai-agents-sdk-langsmith-and-opentelemetry-3ale)
- [OpenTelemetry for AI Systems (Uptrace 2026)](https://uptrace.dev/blog/opentelemetry-ai-systems) — span_context in inter-agent payloads
- [AI Agent Observability - Evolving Standards (OpenTelemetry Blog 2025)](https://opentelemetry.io/blog/2025/ai-agent-observability/)

**Discord rate limits:**
- [Rate Limits (Discord Developer Docs)](https://docs.discord.com/developers/topics/rate-limits) — 50 req/sec global cap
- [Handling Rate Limits at Scale (Xenon)](https://blog.xenon.bot/handling-rate-limits-at-scale-fb7b453cb235)

**Agent permissions / security:**
- [Setting Permissions for AI Agents (Oso)](https://www.osohq.com/learn/ai-agent-permissions-delegated-access)
- [Semantic Privilege Escalation (Acuvity)](https://acuvity.ai/semantic-privilege-escalation-the-agent-security-threat-hiding-in-plain-sight/)
- [Multi-Agent Systems Need a Product Control Plane (Adaline)](https://labs.adaline.ai/p/multi-agent-systems-product-control-plane) — delegation handoff key specs
- [How to Prevent Over-Permissioned Agents (Oso)](https://www.osohq.com/learn/how-to-prevent-over-permissioned-agents)

**Polling vs event-driven:**
- [Cron Jobs vs Event-Driven Architecture (Schematical)](https://schematical.com/posts/cron-v-eda_20240328)
- [Why We Replaced 80% of Our Cron Jobs (Medium)](https://medium.com/@TheOutageSpecialist/why-we-replaced-80-of-our-cron-jobs-with-event-driven-systems-d05e20317f0c)

**Internal references:**
- `.planning/PROJECT.md` — v1.8 scope, Out of Scope decisions (sync RPC excluded, file-inbox pattern established)
- v1.1/v1.6 existing inbox pattern — coexists with new RPC, does not replace
- v1.2 SECURITY.md channel ACLs — must be enforced on handoffs
- v1.5 per-agent cost tracking + escalation budgets — chain-level budget is additive, not replacing
- v1.7 prompt caching, warm-session, streaming — trigger integration must preserve cache hits

---
*Pitfalls research for: ClawCode v1.8 Proactive Agents + Handoffs*
*Researched: 2026-04-13*
