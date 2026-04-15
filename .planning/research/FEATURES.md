# Feature Research — v1.8 Proactive Agents + Handoffs

**Domain:** Multi-agent orchestration — proactive triggers + structured cross-agent task handoffs layered on an existing persistent-agent substrate (ClawCode v1.0-v1.7).
**Researched:** 2026-04-13
**Confidence:** HIGH for patterns widely shared across LangGraph / CrewAI / Autogen / Temporal / n8n / Zapier; MEDIUM for novel-to-ClawCode integration details.
**Scope:** NEW features only — all v1.0-v1.7 substrate (persistent agents, memory, knowledge graph, cron, subagent-thread, cost tracking, Discord integration, latency instrumentation, prompt caching) is assumed present.

## Framing: What v1.8 Actually Is

v1.7 leaves ClawCode as a *reactive* system: agents turn on user Discord messages, fixed-time cron, or `subagent-thread` child sessions. Every other mature agent framework (LangGraph, CrewAI, Autogen, OpenAI Swarm, Temporal) treats **agent-initiated turns from non-human events** and **typed handoffs between peers** as first-class concerns. v1.8 closes that gap.

Two feature axes, researched separately:

1. **Trigger engine** — how non-message events become agent turns.
2. **Cross-agent handoffs** — how one agent hands a structured task to another with lifecycle tracking, distinct from the already-shipped `subagent-thread` (which spawns an ephemeral *child of the same agent* in a Discord thread).

## Feature Landscape

### Table Stakes (Users Expect These)

Features that every mature proactive/multi-agent stack exposes. Shipping v1.8 without them would feel broken to anyone arriving from LangGraph, CrewAI, or n8n.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Scheduled observation trigger** (cron-driven but agent-initiated, not user-initiated) | v1.1 cron already prompts an agent at X time; every scheduler system lets users also check conditions *before* firing (only run if inbox count > 0). This is the MVP trigger type. | LOW | Extend existing croner integration — add a `condition` closure (SQL probe, file existence, counter threshold) that must pass before the prompt is injected. Depends on v1.1 cron + v1.6 TaskScheduler. |
| **Webhook trigger** (HTTP endpoint → agent turn) | n8n and Zapier both treat webhooks as "most powerful and flexible trigger." Real-time, event-driven, zero polling cost. Essential for calendar events, GitHub, inbox arrivals, any SaaS with push. | MEDIUM | Needs small HTTP server in daemon with per-agent URL paths and HMAC verification. Depends on v1.0 Agent Manager process. |
| **File-watcher / inbox trigger** (new file in directory → agent turn) | File-based inbox is already validated by v1.1 cross-agent messaging and v1.3 chokidar watching. Users expect to drop a JSON task file and have an agent pick it up. | LOW | Extend chokidar usage from config hot-reload (v1.2) and cross-agent inbox (v1.1). `awaitWriteFinish` is essential — otherwise you dispatch on half-written files. |
| **DB-state-change polling trigger** (SQLite row appeared / changed → agent turn) | Memory DB, episode store, cost tables already exist. Poll `WHERE processed=0 LIMIT N` is table-stakes for any "react to what happened" use case. | LOW | Polling is cheaper than change-data-capture at this scale. Builds on existing better-sqlite3 per-agent DB. |
| **Typed cross-agent task handoff** with schema + request/response envelope | Every serious framework has this: LangGraph `Command` + handoff tools, CrewAI `delegate_work`, OpenAI Swarm returning an Agent from a function, Autogen `RequestToSpeak`, Microsoft Agent Framework A2A 1.0. ClawCode's v1.6 agent-to-agent Discord messaging is *unstructured chat*; v1.8 must add *structured task envelopes* with typed input/output. | MEDIUM | Persistent task records (SQLite), zod schemas per handoff type, inbox-pattern delivery. Distinct from `subagent-thread` (ephemeral child) — these are peer-to-peer typed RPCs. |
| **Task lifecycle: in-flight tracking** (task ID, status, started/finished) | Listed explicitly in the milestone goal. No multi-agent framework ships without this — Temporal, LangGraph, CrewAI all surface per-task state. Without it, you can't debug anything. | MEDIUM | Task table in a shared system DB (not per-agent). States: queued / running / waiting-on-sub-task / completed / failed / cancelled. |
| **Task retry with exponential backoff** | Baseline for any queue system. Temporal makes it the headline feature. Without it, a flaky downstream agent drops work silently. | LOW | BullMQ-style pattern but in-process. Retry count, next-retry-at, max attempts from zod schema. |
| **Task timeout / deadline** | Temporal's "four types of activity timeouts" article makes the point: every task needs a wall-clock ceiling. Otherwise stuck tasks pile up forever. | LOW | Single `deadline_at` timestamp on the task row, checked by a heartbeat. |
| **Budget cap per task / per trigger / per chain** | The 2026 multi-agent consensus: "Teams implement maximum dollar amounts per session (e.g., $5.00)." Ties into v1.5 cost-tracking substrate. Without this, a trigger loop can bankrupt you overnight. | MEDIUM | Reuse v1.5 per-agent cost table. Add `parent_task_id` chain-tracking to accumulate total spend. Circuit-break on overrun. |
| **Audit trail of triggers + handoffs** (JSONL) | v1.2 already shipped a config audit trail. Every trigger fire, every handoff, every retry must be logged. Required for debugging, required for trust. | LOW | Append-only JSONL per day, pattern matches existing audit implementation. |
| **Dashboard: in-flight task list + task graph** | Explicitly named in milestone goal. LangGraph, CrewAI, Autogen, and Temporal all ship this. v1.2 already has a dashboard with SSE live updates — extend it. | MEDIUM | New dashboard view showing (a) flat list of live tasks with status pills, (b) DAG visualization (Graphviz DOT or similar — project already rejected full graph UI). |
| **CLI parity for task operations** (list, inspect, cancel, retry) | Project convention — every feature gets CLI (`clawcode status`, `clawcode schedules`, etc.). Operators need terminal access to in-flight state. | LOW | Follow existing CLI patterns. `clawcode tasks`, `clawcode tasks cancel <id>`, `clawcode tasks retry <id>`. |

### Differentiators (Competitive Advantage)

Features that would make v1.8 materially better than the generic "another LangGraph clone." These lean on ClawCode's unique substrate — persistent agent sessions, knowledge-graph memory, workspace isolation, webhook-identity Discord presence.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Declarative trigger→agent policy** (YAML or TOML DSL in clawcode.yaml) | Competitors force imperative Python/TS. ClawCode already has `clawcode.yaml` as the source of truth for agents, channels, skills — extending it to policy rules (trigger source → target agent → context payload template) keeps configuration in one place and enables static validation via zod 4. Recent research (arxiv 2603.27299) validates "declarative policy compilation" for agent orchestration. | MEDIUM | Rule shape: `when <trigger>, match <condition>, dispatch <agent>, with <context_template>, budget <tokens>, timeout <duration>`. Zod validation at daemon start → refuse boot on invalid policy. |
| **Memory-pattern trigger** ("when episode store gets 5 entries tagged `frustration`, fire coach agent") | Unique to ClawCode's episode-based memory (v1.2) + knowledge graph (v1.5). No other framework has semantic long-term memory *inside the agent* — so no other framework can trigger *on* memory patterns. This is a genuine moat. | HIGH | Polling trigger with semantic query: run similarity search against recent memory, fire when threshold met. Needs debouncing so one event doesn't trigger N times as it ages. |
| **Handoff with memory-pin** (when Agent A hands off to Agent B, A can pin specific memory nodes B must load) | Hybrid hot-tier (v1.5) already lets an agent curate which memory items live in prompt. Extend to handoffs: A explicitly provides wikilinks B should pull into its context via `memory_lookup`. Prevents the Swarm-era pain of "every handoff must include all context the next agent needs — no hidden variables." Here, context travels as *memory references*, not raw text → token-efficient + auditable. | MEDIUM | Extend the task envelope with a `memory_pins: ["[[wikilink]]"]` field. Receiving agent pre-fetches via v1.5 `memory_lookup` before the turn runs. |
| **Webhook triggers arrive as Discord messages in audit channel** | Leverages v1.6 agent-to-agent Discord communication + webhook identities. Every trigger fire posts to an operator-visible audit channel with embed showing source, payload preview, dispatched agent. Operators see the system's proactive behavior in Discord itself — no context switch to CLI or dashboard. | LOW | Reuse v1.6 webhook-provisioning + v1.2 dashboard embed formatter. |
| **Fork-based handoff execution** (handoff target runs in a forked session, not the main session) | v1.5's fork-based model escalation already proves this pattern works. A handoff that might take 20 turns or escalate to opus shouldn't pollute the main-session context of the receiving agent. Fork, run the task, return result via inbox, discard the fork. Mirrors the "managed agents" pattern from existing memory. | MEDIUM | Reuse v1.1 session forking + v1.5 escalation monitor. New: a "task fork" variant that returns structured output into the task row, not back into the parent's turn. |
| **Condition DSL that can read agent memory** (`when memory.search("incident") recent 5m > 3`) | None of LangGraph/CrewAI/Autogen/n8n/Zapier have a condition language that natively queries long-term semantic memory, because they don't *have* long-term semantic memory. ClawCode does (v1.1 + v1.5). A trigger condition that reads memory is a category-defining feature. | HIGH | Lives in the policy DSL. Condition operators: `memory.search(q) count`, `memory.recent(tag) count`, `episode.any(tag, window)`. Careful scope — must not turn Turing-complete. |
| **Handoff reply streaming into originator's Discord thread** | When Agent A hands off to Agent B, A's Discord thread shows B's work in real-time via v1.7 streaming + v1.3 subagent-thread skill. Operator sees the collaboration as it happens, not after-the-fact. | MEDIUM | Task envelope includes origination `thread_id`; receiving agent streams progress updates to that thread via v1.6 agent-to-agent messaging. |
| **Dead-letter triage agent** (failed handoffs route to a designated agent for review) | Existing admin agent (v1.1) is perfect for this — the one agent with cross-workspace visibility. Failed tasks after max retries land in admin's inbox with full trace. Feels like the natural extension of admin's existing role. | LOW | Config field `dead_letter_agent: admin` in the policy DSL. Reuse v1.1 cross-agent messaging. |

### Anti-Features (Commonly Requested, Often Problematic)

Patterns other frameworks ship that ClawCode should explicitly refuse or diverge from. Several are listed in the milestone's Out of Scope already — this section expands the rationale with research evidence.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Synchronous agent-to-agent RPC** (A awaits B inline within A's turn) | Looks like a normal function call — "just call the other agent and get a result." CrewAI supports this via `delegate_work`. | CrewAI's documented "Delegation Ping-Pong" — infinite cyclical reassignment loops when A and B both delegate to each other. Also blocks A's turn for unknown duration, destroying latency budgets v1.7 just spent a milestone establishing. Already marked out-of-scope in PROJECT.md — research confirms that's correct. | Async inbox pattern — A fires task to B's inbox and ends its turn; when B completes, its reply lands in A's inbox and triggers A's next turn. |
| **Free-form LLM-routed handoffs** (agent picks next agent via LLM reasoning, no schema) | OpenAI Swarm's core abstraction: "Agents can hand off execution to other Agents by returning them from function calls." Feels agentic, flexible. | "Bag of agents" failure mode, documented as the 17x error trap — unbounded hops, permission leakage (any agent can call any other), no audit of *why* a handoff happened. Violates ClawCode's SECURITY.md per-agent ACLs (v1.2). | Typed handoff schemas (zod) enumerate allowed target/payload pairs. LLM still chooses *which* handoff to invoke, but the set is finite and ACL-gated. |
| **Cycles in the task graph** | Many real workflows are iterative — coach agent asks, reviewer critiques, coach revises, etc. | Unbounded cost, unbounded latency, hard to observe. Autogen's GroupChat has this footgun; LangGraph's newer Command pattern added explicit hop limits because of it. | Task-chain hop counter. Policy DSL declares `max_chain_depth: 5` default. Exceeds → dead-letter + alert. |
| **Permission-inheriting handoffs** (target agent runs with source agent's tool allowlist) | "Simpler" delegation — just pass along the caller's capabilities. Swarm and early CrewAI tended this direction. | Violates v1.2 per-agent SECURITY.md ACLs. A reviewer agent that gets GitHub write because a scheduler agent had it is a security hole. Research flags "permission scope leakage" as a production failure mode. | Target always runs under its own SECURITY.md. Handoff is a message, not a capability transfer. |
| **Automatic / LLM-generated triggers** (agent observes usage and proposes new triggers) | Looks like self-improvement. Autogen and newer "agentic workflow" tooling flirt with this. | Silent trigger proliferation → trigger storms (documented alert-fatigue failure mode). Triggers fire unpredictably. Nobody knows why the system woke up. | Triggers live in `clawcode.yaml`. Config hot-reload (v1.2) already supports editing. Humans approve every trigger. Agents can *suggest* in Discord but not install. |
| **Shared global task queue across agents** | "Just one queue for the whole system" is simpler to reason about. | Breaks workspace isolation. Agents can't have independent SLOs. One misbehaving agent starves others. Noisy neighbors. | Per-agent inbox (file-based, reuses v1.1 cross-agent substrate). System-level task *registry* exists for audit but each agent pulls from its own. |
| **Realtime DB change-data-capture / SQLite triggers** (push on every row insert) | "More efficient than polling." | better-sqlite3 is synchronous — CDC from SQLite would need a separate goroutine/thread, and SQLite trigger callbacks into Node.js aren't well-supported. Polling at 5s / 30s cadence is simpler and fine for this workload. n8n's docs even recommend polling when push isn't cheap to do well. | Poll with a sentinel column (`processed_at IS NULL`) and a WHERE clause. Cheap, simple, idempotent. |
| **Cross-agent memory sharing on handoff** | "Give the target agent full context" — just copy A's relevant memory into B. | Violates workspace isolation (already out-of-scope). Also duplicates data and breaks audit. | Memory pins (differentiator above): A passes *wikilinks*, B retrieves via its own `memory_lookup`. Read-only cross-workspace lookup via admin agent remains the escape hatch. |
| **Trigger DSL with full scripting (JS/Python eval)** | Flexibility — users can express any condition. | Turing-completeness kills static analysis, introduces injection risk (triggers reading network input → RCE), makes auditing impossible. Semantic Router DSL paper explicitly lists "no loops, no recursion, finite typed signal space" as a feature. | Constrained DSL: boolean combinators (`and`/`or`/`not`), comparison operators, named signals/probes. Static-validated at daemon boot. |
| **"Everything is a webhook" universal ingress** | One endpoint, one format, done. | Loses source metadata, encourages poorly-scoped triggers, makes rate limiting impossible per-source. | Named trigger kinds (`cron`, `webhook`, `file`, `db`, `memory`) each with their own config shape. |

## Feature Dependencies

```
[v1.0 Agent Manager]
    └──enables──> [Trigger Engine (daemon-level dispatcher)]
                       └──requires──> [Policy DSL]
                       └──requires──> [Webhook HTTP server]

[v1.1 Cron/TaskScheduler]
    └──enables──> [Scheduled observation trigger (cron + condition)]

[v1.1 Cross-agent file-inbox]
    └──enables──> [Typed handoff envelope delivery]
                       └──requires──> [Task schema registry (zod)]
                       └──requires──> [Task lifecycle table (SQLite)]

[v1.1 Session forking]
    └──enables──> [Fork-based handoff execution]

[v1.2 Config hot-reload + chokidar]
    └──enables──> [File-watcher trigger]
    └──enables──> [Policy DSL hot-reload]

[v1.2 Dashboard SSE]
    └──enables──> [In-flight task dashboard]
    └──enables──> [Trigger audit stream]

[v1.2 SECURITY.md ACLs]
    └──gates──> [Typed handoff (target-agent capability check)]
    └──gates──> [Trigger→agent dispatch (source-permission check)]

[v1.2 Audit trail JSONL]
    └──pattern──> [Trigger/handoff audit log]

[v1.3 subagent-thread skill]
    └──complements──> [Typed handoff — distinct shape, same transport]

[v1.5 Cost tracking + escalation budgets]
    └──enables──> [Budget cap per task/chain]

[v1.5 memory_lookup + knowledge graph]
    └──enables──> [Handoff memory-pin]
    └──enables──> [Memory-pattern trigger]
    └──enables──> [Memory-aware condition DSL]

[v1.6 Agent-to-agent Discord messaging + webhooks]
    └──enables──> [Handoff progress streaming into Discord thread]
    └──enables──> [Trigger fires visible in audit channel]

[v1.6 TaskScheduler handler entries]
    └──extends──> [Scheduled condition-gated triggers]

[v1.7 Streaming + typing indicator]
    └──enables──> [Handoff reply streaming UX]

[v1.7 Prompt caching + per-turn prefix_hash]
    └──complements──> [Trigger-initiated turns reuse cache the same way user-initiated turns do]
```

### Dependency Notes

- **Trigger Engine requires Agent Manager (v1.0):** A trigger must dispatch to a running agent; Agent Manager owns lifecycle, so the trigger engine lives in the daemon and looks up target agent via Manager.
- **Typed handoffs require zod (already in stack) + new task table:** zod is the schema enforcement; the task table is new in v1.8 — it's a system-level SQLite DB (not per-agent) because tasks span agents.
- **Fork-based execution requires v1.1 session forking + v1.5 fork harness:** Both landed. v1.8 needs a new *task-bound fork* variant that writes result back to a task row rather than returning into a parent turn.
- **Memory-pattern trigger + memory-aware condition DSL require v1.5:** These are the differentiators that depend most on ClawCode's unique substrate. Without v1.5's knowledge graph + on-demand loading, these features don't exist in any competitor.
- **Budget caps require v1.5 cost tracking:** Phase 38's per-agent/per-model cost table is the enforcement point. Task-chain budget accumulates across handoffs.
- **Dashboard task views require v1.2 SSE:** The SSE substrate is already live; v1.8 adds new event types.
- **All triggers + handoffs must respect v1.2 SECURITY.md ACLs:** Non-negotiable. ACL check happens at dispatch time, before the target agent turn starts.

## MVP Definition

### Launch With (v1.8.0)

Minimum viable proactive + handoff system.

- [ ] **Scheduled observation trigger with condition** — cron + bool probe. Covers 60% of real use cases (calendar poll, inbox count, error-log scan) without needing new infra.
- [ ] **File-watcher trigger** — drop JSON into `.clawcode/triggers/<agent>/inbox/`, agent picks it up. Reuses v1.1 + v1.2 + v1.3 patterns; lowest-risk trigger type.
- [ ] **Webhook trigger** — daemon HTTP server + HMAC-verified per-agent paths. Core external-integration story; without this, v1.8 feels like an internal-only feature.
- [ ] **Policy DSL in `clawcode.yaml`** with constrained boolean condition language and zod validation at boot.
- [ ] **Typed cross-agent handoff** with zod-validated task envelope, task table, inbox delivery.
- [ ] **Task lifecycle basics** — status, retry (max 3 default), timeout (default 5min), cancel via CLI/dashboard.
- [ ] **Budget caps** — per-task token budget enforced via v1.5 cost substrate; circuit-break on overrun.
- [ ] **Audit trail** — JSONL per day for triggers and handoffs.
- [ ] **Dashboard in-flight task list** — flat list with status pills and cancel button; task graph visualization can wait.
- [ ] **CLI: `clawcode tasks list / inspect / cancel / retry`** — operator parity with dashboard.
- [ ] **Dead-letter routing** — failed-after-max-retries tasks land in admin agent inbox.
- [ ] **SECURITY.md ACL enforcement** — trigger dispatch and handoff both check caller + target permissions.
- [ ] **Handoff fires visible in Discord audit channel** — reuses v1.6 webhook substrate, operator sees proactive actions.

### Add After Validation (v1.8.x)

Features to add once the MVP proves out in real fleet use.

- [ ] **DB-state polling trigger** — add once real use-case appears (operators ask for it). Cheap to add later.
- [ ] **Memory-pattern trigger** — differentiator but needs polling cadence tuning; defer until hot-tier behavior under triggers is understood.
- [ ] **Memory-aware condition DSL** — adds surface area; validate simpler conditions first.
- [ ] **Handoff memory-pin** — requires handoff shape to stabilize first.
- [ ] **Fork-based handoff execution** — add when a real task exhibits context-pollution pain; simple inbox handoffs may be sufficient initially.
- [ ] **Task graph visualization in dashboard** — flat list covers 80% of ops needs; graph is polish.
- [ ] **Handoff reply streaming into originator thread** — depends on stable handoff shape; nice UX but not blocking.
- [ ] **Calendar / email trigger types** — layered over webhook trigger once users want specific integrations; deliver as per-user recipes, not core features.

### Future Consideration (v1.9+)

Defer until proactive-agent product-market fit is validated.

- [ ] **Cross-workspace handoffs** (outside admin-mediated pattern) — currently admin agent bridges; general cross-workspace handoffs need a security model that doesn't exist yet.
- [ ] **Handoff saga / compensation** (Temporal-style rollback on failure) — most ClawCode tasks are idempotent or non-critical; compensation is overkill for v1.
- [ ] **Replay / time-travel debugging of trigger chains** — Temporal nails this; it would be lovely but needs deterministic execution guarantees ClawCode does not offer with LLM calls.
- [ ] **Human-in-the-loop approval gates in the middle of a handoff chain** — possible via v1.2 execution approval system + Discord reactions; defer until demand is real.
- [ ] **Multi-agent group-chat orchestration** (Autogen-style round-robin) — pairs + typed handoffs cover most workflows; group chat adds combinatorial explosion.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Scheduled condition trigger | HIGH | LOW | P1 |
| File-watcher trigger | HIGH | LOW | P1 |
| Webhook trigger | HIGH | MEDIUM | P1 |
| Policy DSL (constrained) | HIGH | MEDIUM | P1 |
| Typed handoff envelope | HIGH | MEDIUM | P1 |
| Task lifecycle table + retry + timeout | HIGH | MEDIUM | P1 |
| Budget cap per task/chain | HIGH | MEDIUM | P1 |
| Audit trail (JSONL) | HIGH | LOW | P1 |
| Dashboard in-flight list | HIGH | MEDIUM | P1 |
| CLI task commands | MEDIUM | LOW | P1 |
| Dead-letter routing | MEDIUM | LOW | P1 |
| ACL enforcement on dispatch/handoff | HIGH | LOW | P1 |
| Discord audit channel visibility | MEDIUM | LOW | P1 |
| DB-state polling trigger | MEDIUM | LOW | P2 |
| Handoff memory-pin | MEDIUM | MEDIUM | P2 |
| Fork-based handoff execution | MEDIUM | MEDIUM | P2 |
| Memory-pattern trigger | MEDIUM | HIGH | P2 |
| Memory-aware condition DSL | MEDIUM | HIGH | P2 |
| Handoff reply streaming to originator thread | MEDIUM | MEDIUM | P2 |
| Task graph visualization | LOW | MEDIUM | P3 |
| Saga / compensation | LOW | HIGH | P3 |
| Time-travel replay | LOW | HIGH | P3 |
| Cross-workspace general handoffs | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for v1.8 launch
- P2: Ship in v1.8.x point releases as demand materializes
- P3: Defer to v1.9 or later

## Competitor Feature Analysis

| Feature | LangGraph | CrewAI | Autogen / MS Agent Framework | OpenAI Swarm / Agents SDK | Temporal | n8n / Zapier | ClawCode v1.8 Approach |
|---------|-----------|--------|-------------------------------|----------------------------|----------|--------------|------------------------|
| Trigger source types | External (graph invoked by user) | External (crew kickoff) | External (user message) | External (run() call) | Scheduled + signal + webhook | Cron, webhook, polling, app-events | Cron+condition, webhook, file, DB-poll (v1.8.x), memory-pattern (v1.8.x) |
| Handoff primitive | `Command(goto=..., update=...)` returned from node | `delegate_work` tool + hierarchical manager | `RequestToSpeak` → GroupChat manager selects; newer MS AF: explicit graph workflows | Return `Agent` from function → lightweight handoff | Child workflow / activity | Workflow node routing | Typed task envelope (zod) via inbox → actor mailbox pattern |
| Handoff context | Full message history passed | Manager-decided context | Shared state in GroupChat | Caller must pack context explicitly ("no hidden variables") | Workflow-scoped state | Data mapped between nodes | Memory-pin (wikilinks) + typed payload; receiver pulls via memory_lookup |
| Synchronous vs async | Either (node blocks until Command returns) | Synchronous (blocks) | Async possible in newer Autogen | Synchronous in run loop | Async workflows + sync queries | Async | Async-only (explicit out-of-scope in PROJECT.md) |
| Cycle prevention | Recursion limit + optional Command hop counter | `max_iter` per task; "delegation ping-pong" acknowledged problem | Turn limits in GroupChat | Caller responsibility | Workflow iteration limit | DAG (no cycles) or sub-workflows | `max_chain_depth` in policy + budget cap |
| Retry / timeout | Node-level via LangGraph checkpoint | Task-level `max_iter` | Limited | Caller builds it | First-class — headline feature | Per-node retry config | Task row: retry, backoff, deadline_at; reuse v1.5 cost substrate |
| Observability | LangSmith traces + graph viz | CrewAI+ dashboards | Autogen Studio | Print-based | Temporal UI (best-in-class) | Execution history UI | v1.2 dashboard extension + v1.7 trace instrumentation + Discord audit channel |
| Budget enforcement | External (LangSmith) | External | External | External | External | External | Native — v1.5 cost substrate enforces per-task/per-chain caps |
| Policy expression | Python code in nodes | Python agent/task config | Python / C# code | Python code | Workflow code | GUI + JSON | Declarative YAML DSL validated by zod at boot |
| Permission model | Graph-level | `allow_delegation` per agent | Agent-level tools | Agent tool allowlist | N/A (code-level) | Credential-scoped per node | v1.2 SECURITY.md ACLs checked on both trigger dispatch and handoff |
| Long-term memory integration | External (Zep, Mem0, etc.) | External | External | External | External | External | Native — v1.5 knowledge graph is substrate; triggers + handoffs consume it |
| Persistent agents across sessions | No (ephemeral graph runs) | No (ephemeral crew) | Partial (newer Autogen) | No | N/A | N/A (stateless workflows) | Yes (v1.0) — this is why ClawCode's proactive story is unique |

## Key Takeaways for Requirements Definition

1. **Two feature axes are genuinely different but share infrastructure.** Triggers produce agent turns from non-messages; handoffs produce agent turns from other agents. Both deliver via the same inbox + dispatcher + task-record substrate. One phase of foundation work covers both.

2. **All P1 features have direct dependencies on shipped substrate.** No P1 item invents new infrastructure categories — they extend v1.0 (manager), v1.1 (cron, inbox, forking), v1.2 (chokidar, audit, ACLs, dashboard), v1.5 (cost, memory), v1.6 (agent-to-agent Discord), v1.7 (streaming). Low-risk delivery path.

3. **The differentiators all come from ClawCode's persistent+memory substrate.** Competitors literally cannot ship memory-pattern triggers or memory-pin handoffs because they don't have the memory. Lean into these, don't water them down to match LangGraph.

4. **The anti-features list maps 1:1 to documented production failures** in CrewAI ("delegation ping-pong"), Autogen ("17x error trap"), and Swarm ("bag of agents"). Say no explicitly in the requirements so they're not accidentally smuggled in.

5. **Observability is table-stakes, not polish.** Every mature framework has learned this. In-flight dashboard + JSONL audit + Discord audit channel must all be P1 — not cut for scope. The 2026 consensus article ("trace-level observability" as a 2026 requirement) is unambiguous.

6. **Constrained declarative policy is the right choice** despite being less flashy than "agents write their own triggers." The Semantic Router DSL research plus the n8n/Zapier model confirm that finite, statically-validated policy is what scales to production without turning into an alert storm.

## Sources

### LangGraph / LangChain
- [LangGraph Multi-Agent Supervisor docs](https://reference.langchain.com/python/langgraph-supervisor) — supervisor pattern, Command object, handoff tools
- [How to implement handoffs between agents (LangGraph how-to)](https://nightcat.cloudns.asia:9981/sitedoc/langgraph/v0.4.3/how-tos/agent-handoffs/)
- [Multi-agent docs (LangChain)](https://docs.langchain.com/oss/python/langchain/multi-agent)
- [Building Event-Driven Multi-Agent Workflows with Triggers in LangGraph](https://medium.com/@_Ankit_Malviya/building-event-driven-multi-agent-workflows-with-triggers-in-langgraph-48386c0aac5d)
- [How Agent Handoffs Work in Multi-Agent Systems (Towards Data Science)](https://towardsdatascience.com/how-agent-handoffs-work-in-multi-agent-systems/)

### CrewAI
- [Agent-to-Agent (A2A) Protocol — CrewAI docs](https://docs.crewai.com/en/learn/a2a-agent-delegation)
- [Underlying mechanism for agent delegation (CrewAI community)](https://community.crewai.com/t/underlying-mechanism-for-agent-delegation/199)
- [The Delegation Ping-Pong: Breaking Infinite Handoff Loops in CrewAI](https://azguards.com/technical/the-delegation-ping-pong-breaking-infinite-handoff-loops-in-crewai-hierarchical-topologies/)
- [CrewAI Multi-Agent Workflow Guide 2026](https://qubittool.com/blog/crewai-multi-agent-workflow-guide)
- [CrewAI hierarchical agent delegation PR #2068](https://github.com/crewAIInc/crewAI/pull/2068)

### Autogen / Microsoft Agent Framework
- [Microsoft Agent Framework 1.0 announcement (April 2026)](https://devblogs.microsoft.com/agent-framework/microsoft-agent-framework-version-1-0/)
- [AutoGen → MS Agent Framework migration guide](https://learn.microsoft.com/en-us/agent-framework/migration-guide/from-autogen/)
- [AutoGen GroupChat design pattern](https://microsoft.github.io/autogen/stable//user-guide/core-user-guide/design-patterns/group-chat.html)
- [AutoGen Explained: Microsoft's Multi-Agent Framework in 2026](https://sanj.dev/post/autogen-microsoft-multi-agent-framework)

### OpenAI Swarm / Agents SDK
- [OpenAI Swarm README](https://github.com/openai/swarm/blob/main/README.md) — agent handoffs as function returns, stateless context transfer
- [OpenAI Agents SDK (Python)](https://openai.github.io/openai-agents-python/)
- [Swarm from OpenAI — Routines, Handoffs, and Agents explained](https://www.ai-bites.net/swarm-from-openai-routines-handoffs-and-agents-explained-with-code/)

### Temporal
- [Durable multi-agentic AI architecture with Temporal](https://temporal.io/blog/using-multi-agent-architectures-with-temporal)
- [Durable Execution meets AI — Temporal blog](https://temporal.io/blog/durable-execution-meets-ai-why-temporal-is-the-perfect-foundation-for-ai)
- [The four types of Activity timeouts](https://temporal.io/blog/activity-timeouts)
- [Temporal + AI Agents: The Missing Piece for Production-Ready Agentic Systems](https://dev.to/akki907/temporal-workflow-orchestration-building-reliable-agentic-ai-systems-3bpm)

### Trigger patterns — n8n / Zapier
- [Types of Triggers in n8n](https://www.c-sharpcorner.com/article/types-of-triggers-in-n8n/)
- [Creating triggers for n8n workflows using polling](https://blog.n8n.io/creating-triggers-for-n8n-workflows-using-polling/)
- [Schedule Trigger node documentation (n8n)](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.scheduletrigger/)
- [N8N + Webhooks event-driven automations](https://blog.elest.io/n8n-webhooks-build-event-driven-automations-that-replace-your-cron-jobs/)
- [Zapier: Trigger Zaps from webhooks](https://help.zapier.com/hc/en-us/articles/8496288690317-Trigger-Zaps-from-webhooks)
- [Zapier: Add a REST Hook trigger](https://docs.zapier.com/platform/build/hook-trigger)
- [Polling vs webhooks for Zapier apps](https://lunchpaillabs.com/blog/zapier-polling-vs-webhooks)
- [The Ultimate Guide to Zapier Trigger Types](https://clickleo.com/zapier-trigger-types/)

### Task queues / idempotency / retry
- [Why your AI agent needs a task queue (LogRocket)](https://blog.logrocket.com/ai-agent-task-queues/)
- [AI Agent Queue Architecture — I Am Stackwell](https://iamstackwell.com/posts/ai-agent-queue-architecture/)
- [BullMQ Deduplication guide](https://docs.bullmq.io/guide/jobs/deduplication)
- [Queue-Based Exponential Backoff retry pattern](https://dev.to/andreparis/queue-based-exponential-backoff-a-resilient-retry-pattern-for-distributed-systems-37f3)
- [Deduplication in Distributed Systems — Architecture Weekly](https://www.architecture-weekly.com/p/deduplication-in-distributed-systems)

### Anti-patterns / observability
- [Why Your Multi-Agent System is Failing: The 17x Error Trap (Towards Data Science)](https://towardsdatascience.com/why-your-multi-agent-system-is-failing-escaping-the-17x-error-trap-of-the-bag-of-agents/)
- [When AI Agents Collide: Multi-Agent Orchestration Failure Playbook for 2026 (Cogent)](https://cogentinfo.com/resources/when-ai-agents-collide-multi-agent-orchestration-failure-playbook-for-2026)
- [AI Agent Anti-Patterns Part 2 — Tooling, Observability, and Scale Traps](https://achan2013.medium.com/ai-agent-anti-patterns-part-2-tooling-observability-and-scale-traps-in-enterprise-agents-42a451ea84ec)
- [Troubleshooting agent loops — patterns, alerts, safe fallbacks (Maxim AI)](https://www.getmaxim.ai/articles/troubleshooting-agent-loops-patterns-alerts-safe-fallbacks-and-tool-governance-using-maxim-ai/)
- [LLM Workflows — Patterns, Tools & Production Architecture 2026 (Morph)](https://www.morphllm.com/llm-workflows)

### Declarative policy DSLs
- [From Inference Routing to Agent Orchestration — Declarative Policy Compilation (arxiv 2603.27299)](https://arxiv.org/abs/2603.27299)
- [Designing a DSL for Agent Access Control — Prefactor](https://prefactor.tech/blog/designing-a-dsl-for-agent-access-control)

### Actor model / mailbox pattern
- [Akka: Introduction to Actors](https://doc.akka.io/libraries/akka-core/current/typed/actors.html)
- [Understanding the Actor Design Pattern with Akka (DEV)](https://dev.to/micromax/understanding-the-actor-design-pattern-a-practical-guide-to-build-actor-systems-with-akka-in-java-p52)
- [Actor-based Concurrency (Berb diploma thesis)](https://berb.github.io/diploma-thesis/original/054_actors.html)

### File-based agent inbox prior art
- [Agent Message Queue (AMQ) — file-based, Maildir-style](https://github.com/avivsinai/agent-message-queue)
- [Codex CLI: Inbox/Watcher Mode discussion](https://github.com/openai/codex/discussions/8070)
- [Chokidar library](https://github.com/paulmillr/chokidar)

### Discord bot proactive messaging
- [Discord Rate Limits — official developer docs](https://docs.discord.com/developers/topics/rate-limits)
- [My Bot is Being Rate Limited (Discord support)](https://support-dev.discord.com/hc/en-us/articles/6223003921559-My-Bot-is-Being-Rate-Limited)
- [Handling Rate Limits at Scale (Xenon Bot blog)](https://blog.xenon.bot/handling-rate-limits-at-scale-fb7b453cb235)

### Alert fatigue / noise suppression (informs anti-feature rationale)
- [Alert Fatigue Reduction with AI Agents — IBM](https://www.ibm.com/think/insights/alert-fatigue-reduction-with-ai-agents)
- [Alert noise reduction strategies — BigPanda](https://www.bigpanda.io/blog/alert-noise-reduction-strategies/)

---
*Feature research for: Multi-agent orchestration — proactive triggers + cross-agent handoffs on ClawCode substrate*
*Researched: 2026-04-13*
