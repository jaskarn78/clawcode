# Changelog

All notable changes to ClawCode are documented here. This project follows the
[Keep a Changelog](https://keepachangelog.com/) convention and uses
milestone-style versioning (v1.0 → v2.6 → ...).

Each milestone bundles a set of numbered phases. Full per-phase plans,
requirements, verification reports, and audits live under
[`.planning/milestones/`](./.planning/milestones/) and
[`.planning/phases/`](./.planning/phases/) — this file is the navigable
summary. Newest first.

---

## [Unreleased]

### v2.8 Performance + Reliability — In Progress

- **Phase 115 — Memory + context + prompt-cache redesign** (2026-05-08, deployed). Eliminates the agent-going-dark failure class triggered by unbounded system-prompt growth. **Trigger:** 2026-05-07 fin-acquisition incident (`systemPrompt.append` bloated to 32,989 chars → Anthropic 400 `invalid_request_error` masquerading as billing-cap text; Ramy mid-thread blocked ~3 hours; 50+ failed-turn retries on prod). Root cause: `enforceWarnAndKeep` was a documented no-op (`context-assembler.ts:494-513`) that emitted a warn and returned input unchanged. **Shipped (10 plans, 37 tasks across 5 waves, 58 commits):** (1) `INJECTED_MEMORY_MAX_CHARS = 16000` hard cap on bounded tier + `STABLE_PREFIX_MAX_TOKENS = 8000` outer cap with `enforceDropLowestImportance` real enforcement; head-tail 70/20 truncation fallback + daemon-side warn; priority dream-pass on tier-1 overflow (twice-in-24h trigger). (2) `excludeDynamicSections: true` on SDK options + `memoryRetrievalTokenBudget` wired through to `retrieveMemoryChunks` (default 1800 tokens) + tag-filter at hybrid-RRF excludes `session-summary`/`mid-session`/`raw-fallback` by default. (3) Tier 1 / Tier 2 formal split via `MemoryTier1Source` / `MemoryTier2Source` discriminated-union types. (4) Cache-breakpoint placement: static identity (SOUL fingerprint, IDENTITY, capability manifest, skills, tool defs) lands BEFORE the breakpoint; dynamic memory + recent reflections AFTER. Operator-controlled revert via `cacheBreakpointPlacement: "legacy"`. (5) Four lazy-load memory tools: `clawcode_memory_search` (FTS5 + sqlite-vec hybrid), `_recall`, `_edit` (path-locked to SOUL/IDENTITY/MEMORY/USER.md via Zod enum, lstat symlink-block, agent_name from session not message payload), `_archive` (Tier 2 → Tier 1 promotion). (6) Phase 95 dream-pass extended via D-10 hybrid 5-row policy: `newWikilinks` auto, `promotionCandidates` ADDITIVE+score≥80 auto with 30-min Discord veto, MUTATING + consolidations operator-required, forced-priority pass overrides. (7) bge-small-en-v1.5 ONNX embedder + int8 quantization in sqlite-vec via `vec_memories_v2` virtual table; dual-write transition (T+0 → T+7d) + background batch re-embed at 5% CPU (T+7d → T+14d) + cutover (T+14d); `clawcode memory migrate-embeddings` CLI with 8 subcommands; reversible until cutover; Phase 107 cascade-delete invariant preserved across both tables atomically. (8) Daemon-side MCP tool-response cache (folds Phase 999.40 entirely): `~/.clawcode/manager/tool-cache.db` with LRU + 100MB cap; per-tool TTL (`web_search`/`brave_search`/`exa_search` 5min cross-agent, `search_documents` 30min per-agent, `mysql_query` 60s for explicit-read queries, never caches writes); `bypass_cache: true` opt-out; `clawcode tool-cache` CLI. (9) Cross-agent consolidation transactionality: `CrossAgentCoordinator.runBatch` + `rollback(runId, agents)` with `consolidation_run_id` audit trail. (10) Operator observability: `prompt-bloat-suspected` classifier logs `[diag] likely-prompt-bloat` when SDK returns 400 + stable-prefix > threshold; `agents[*].debug.dumpBaseOptionsOnSpawn` config flag (replaces hardcoded fin-acquisition + Admin Clawdy allowlist) writes per-agent dumps to `~/.clawcode/agents/<agent>/diagnostics/baseopts-<flow>-<ts>.json` with `redactSecrets`; consolidation run-log audit trail. (11) Tool-latency methodology audit: split `tool_execution_ms` (pure dispatch→result) vs `tool_roundtrip_ms` (full LLM-resume duration) — pinpoints "tool itself slow" vs "prompt-bloat-tax slow" for the 60-700s p95 latencies on built-in Claude Code tools. (12) `parallel_tool_call_rate` + `tool_use_rate_per_turn` per-agent metrics + PARALLEL-TOOL-01 fleet-wide directive (additive, operator-override wins). (13) Sub-scope 6-B (1h-TTL direct-SDK fast-path) measurement-gated via `wave-2-checkpoint.md` — gate fires on fleet non-fin-acq `tool_use_rate_per_turn < 30%`; PENDING-OPERATOR initially, defers to follow-on phase if measurement supports. (14) Benchmark harness `scripts/bench/115-perf.ts` with 5 canonical scenarios (cold-start, Discord ack, tool-heavy, memory-recall, extended-thinking) + `clawcode perf-comparison` CLI. **Folds:** Phase 999.40 absorbed entirely (SUPERSEDED-BY-115 in roadmap). Phase 999.41 (rolling-summary fail-loud guard) carved into 13(a). Phase 999.42 FTS5 + tier model parts absorbed; auto-skill creation stays in 999.42. **Acceptance:** 7/7 verified; all 15 D-NN locked decisions implemented. **Post-deploy patch:** 3 dashboard metric producers (`tier1_inject_chars`, `tier1_budget_pct`, `prompt_bloat_warnings_24h`) had schema+type+reader but no writer; caught during post-deploy spot-check, fixed in 3 follow-up commits with 20 contract tests. Functional bounded-tier enforcement was unaffected. **Lesson:** schema-without-writer pattern slipped through plan-checker; future quality gates should grep for write-side coverage on every new column.

### Pre-v2.8 unreleased fixes

Three small bundled fixes (local repo only, deploy held):

- **Phase 999.4 — `/clawcode-usage` accuracy fixes** (2026-05-01). RateLimitTracker now normalizes `resetsAt` + `overageResetsAt` from seconds-epoch (~1.78e9) to ms-epoch (~1.78e12) at the boundary, and derives `utilization` from `status` (`rejected` → 1.0) + `surpassedThreshold` (`allowed_warning` → threshold) when SDK omits it. Heuristic: `value < 1e12 ? value*1000 : value` — safe both ways since ms-epoch values from 2001+ are >= 1e12. 8 new tests, 19/19 pass total.
- **Phase 999.7 — context-audit telemetry restored** (2026-05-01, partial). Root cause: `session-config.ts` called the untraced `assembleContext` instead of `assembleContextTraced`. Fix: thread `traceCollector` through `SessionConfigDeps`, open a synthetic `bootstrap:<agent>:<ts>` Turn around `assembleContextTraced`, end with status `success`/`error`. One trace row per session start with full `section_tokens` populated, unblocking `clawcode context-audit`. Tool-call p95 profiling (item 2) still open.
- **Phase 999.23 — daemon SIGHUP handler + systemd hardening** (2026-05-01). Added `process.on("SIGHUP", ...)` in daemon (graceful shutdown then exit 129) + `RestartForceExitStatus=129` in systemd unit template. Pairs with shipped Phase 999.24 (sudoers expansion) to close the 2026-05-01 outage loop: `kill -HUP` now triggers graceful drain + auto-restart instead of silent death.
- **Phase 999.25 — agent boot wake-order priority** (2026-05-01). New optional `wakeOrder?: number` per-agent field. Daemon sorts the auto-start array by `(wakeOrder ?? Infinity)` before passing to `manager.startAll` (stable sort — ties + undefined keep YAML order). Boot remains sequential, so this changes the order, not the total time. Operator can now ensure Admin Clawdy boots first, then fin-acquisition, then research agents, then everyone else. 9 sort-behavior tests + static-grep pin against the daemon source. Tiered parallel boot deferred (would re-create Phase 104/108 boot-storm risk).
- **Phase 999.26 — broker token-sticky-drift loop fix** (2026-05-01). Production bug observed at ~15:00 PDT: 79 sticky-drift rejections in 20 min for finmentum-scope agents (55 fin-acquisition / 13 content-creator / 11 fin-research) caused by the broker rejecting any agent reconnect that presented a different `OP_SERVICE_ACCOUNT_TOKEN` hash than the original. Each rejection triggered the SDK shim respawn loop, which re-read the same env and reconnected with the same new hash, looping every ~3s and saturating MCP capacity. Two real Ramy messages hit `QUEUE_FULL` as a result. Fix: rebind on drift instead of reject — log warn with `oldHash`/`newHash` for audit, detach agent from old pool (refCount decrement, drop queued entries, trigger drain when refCount→0), update sticky map, accept on new pool. Inflight on old pool completes naturally. 5 new regression tests; 35/35 broker tests pass.
- **Phase 999.27 — env-resolver oscillation root cause** (2026-05-01). Per-agent heartbeat / warm-path / on-demand capability probes were spawning the 1password broker shim with `ResolvedAgentConfig.mcpServers[].env` (the BASE shared env with the daemon's clawdbot-fleet token) instead of the per-agent overridden env. For finmentum-scope agents, the live shim has `aa18cf6f` (Finmentum) but probe shims connect with `dcfc03f8` (clawdbot) every 60s heartbeat tick, causing broker rebind cycles + pool churn that timed out fin-acquisition's warm-path probe. Fix: new `src/mcp/broker-shim-detect.ts` helper detects broker-shim signature (`command=clawcode` + `args includes mcp-broker-shim`) and skips it from per-agent probes. Applied at 4 sites: warm-path mcpProbe, capability probe at startAgent, on-demand mcp-status IPC, heartbeat reconnect. Broker has dedicated heartbeat (`mcp-broker.ts`) so no coverage loss. 9 detection tests + 42/42 broker tests pass. Production verified: zero rebinds since deploy + all priority agents warm-path on first try.
- **Phase 999.26.1 — broker pool drain delay** (2026-05-01). `beginDrain` fast-path SIGTERMed the pool child immediately when `inflight === 0`, causing pool churn from rapid probe-shim connect/disconnect cycles. Added 1s delay before fast-path kill via `DEFAULT_DRAIN_FAST_PATH_DELAY_MS`. If a fresh connection rescues the pool before delay elapses, existing drain-cancel logic clears the timer and pool stays alive (zero respawn cost). Mitigates any future transient-disconnect scenarios; pairs with the 999.27 root-cause fix. Existing broker tests pass (no test changes needed — the 1-inflight test path is unaffected by the fast-path delay).

---

## [v2.7] — Operator Self-Serve + Production Hardening (2026-04-26 → 2026-05-01)

Two-pillar milestone: **Pillar A — Operator Self-Serve** (Phases 100-103)
delivered GSD-via-Discord on Admin Clawdy, the document-ingestion pipeline,
meeting copilot deploy + ClawCode integration, and `/clawcode-status` rich
telemetry + `/clawcode-usage` panel — operator gains daily-driver Discord-
side ergonomics with no more shell-only workflows for routine actions.
**Pillar B — Production Hardening** (Phases 104-108 + bundled `999.x`
ships) closed multiple infrastructure incidents with structural fixes:
daemon-side `op://` secret cache + retry/backoff, trigger-policy
default-allow + QUEUE_FULL coalescer storm fix, MCP lifecycle/PID tracking,
agent-context hygiene, memory pipeline integrity (dream JSON +
`vec_memories`), and shared 1password-mcp via daemon-managed broker pooling
(~60% reduction in MCP child count).

### Phase 108 — Shared 1password-mcp via daemon-managed broker (LIVE 2026-05-01)

Pool one shared `1password-mcp` subprocess per unique `OP_SERVICE_ACCOUNT_TOKEN`
across agents — drops 11 instances → 2 in current config (default scope +
finmentum scope), a ~60% reduction in MCP child count. Daemon-managed broker
(fan-out proxy) owns the single MCP child per token; agents talk to broker
over a Unix socket via a thin `clawcode mcp-broker-shim` CLI. Per-agent
semaphore (4 concurrent calls), audit logs with `agent`/`turnId`/`tool` fields,
drain on last referencing agent stop, auto-respawn on crash.

- Wave 0 RED scaffolding shipped (FakePooledChild + FakeBrokerSocketPair fakes,
  6 RED test files).
- Wave 1 GREEN code shipped: `PooledChild` (id rewriter + initialize
  cache/replay + drain-then-SIGTERM), `OnePasswordMcpBroker` (token-keyed pool
  + semaphore + audit), `ShimServer` (Unix-socket listener + handshake),
  `clawcode mcp-broker-shim` CLI subcommand, daemon boot integration
  (loader rewire, broker after `SecretsResolver`, reconciler skip-list,
  heartbeat check, shutdown ordering).
- **Deploy journey:** initial 2026-05-01 deploy partial-rolled-back (commit
  `c581ba9`) due to integration issues. Five hot-fixes shipped during deploy
  debug (commit `145600b`) before broker confirmed working end-to-end with
  `agentRefCount=3` fan-out proof; final status update in `07847c0`.
- Pairs with Phase 104 (boot cache, shipped) and Phases 999.14/999.15
  (MCP lifecycle, shipped) — cache fixes boot, pool fixes runtime.
- Promoted from backlog phase 999.9.

### Phase 107 — Memory pipeline integrity (2026-05-01)

Two daemon-side memory-pipeline integrity bugs bundled into one ship.

- **Pillar A — Dream pass JSON output enforcement** (DREAM-OUT-01..04). Haiku
  (the dream model) was returning prose instead of structured JSON, breaking
  schema validation. Tightened the prompt with a schema-correct fallback
  envelope and added warn-level structured parse-failure recovery so the
  pipeline no-ops instead of crashing. Vitest tests pin the prose-input
  recovery path. (DREAM-OUT-02 SDK structured-output mode deferred.)
- **Pillar B — vec_memories orphan cleanup** (VEC-CLEAN-01..04). `memories`
  deletes weren't cascading to the `vec_memories` sqlite-vec virtual table
  (vtab interface doesn't support FK constraints). Audited every delete path,
  wrapped paired deletes in a single transaction, added a
  `MemoryStore.cleanupOrphans()` method exposed via IPC + a new
  `clawcode memory cleanup-orphans` CLI subcommand. Idempotent, operator-
  runnable.
- **Deploy:** 2026-05-01 04:33 PDT via rsync + `systemctl restart`. Smoke
  passed (dream warn clean, cleanupOrphans CLI green + idempotent, 0
  historical orphans found in production).
- Replaces backlog phases 999.16 (dream JSON) and 999.17 (vec orphans).

### Phase 106 — Agent context hygiene bundle (2026-05-01)

Three loose ends from the 2026-04-30 session, bundled into one overnight ship
via `/gsd:autonomous`.

- **Pillar A — Delegate scoping** (DSCOPE-01..04). When `fin-acquisition`
  spawned `fin-research` as a subagent, the subagent inherited the parent's
  full system prompt including the `delegates: { research: fin-research }`
  directive — and tried to recursively call itself. The 999.13 yaml fan-out
  was rolled back. Phase 106 strips `delegates` from the spread in
  `subagent-thread-spawner.ts` (~3 LOC) so subagents never see the delegate
  map. Yaml fan-out restored across 8 channel-bound agents.
- **Pillar B — Research agent boot stall** (STALL-02). Two agents
  (`research`, `fin-research`) silently failed to reach `warm-path ready`
  after the 999.12 deploy with no error logged. Added a 60s warmup-timeout
  sentinel + `lastStep` tracker inside `startAgent` so future stalls
  self-report with full context (pending MCP loads, last SDK step).
  STALL-01 root-cause investigation deferred.
- **Pillar C — `clawcode mcp-tracker` CLI hot-fix** (TRACK-CLI-01). The CLI
  shipped in 999.15 returned "Invalid Request" because the IPC method
  `mcp-tracker-snapshot` was registered on the daemon but missing from the
  CLI's `IPC_METHODS` enum. One-line fix.
- **Deploy:** Overnight 2026-05-01 via `/gsd:autonomous`. Channel-silence
  gate (≥30 min) satisfied at 23:20 PT.

### Phase 105 — Trigger-policy default-allow + QUEUE_FULL coalescer storm fix (2026-04-30 → 2026-05-01)

Two production-impact bugs in the core dispatch hot path, shipped as a
coherent perf + functionality unblock.

- **POLICY-01..03 — Default-allow when `policies.yaml` is missing.** Trigger
  policy was fail-closing when the file was absent: every scheduler/reminder/
  calendar/inbox event silently dropped fleet-wide. The 09:00 fin-acquisition
  standup cron and the 08:26 finmentum-content-creator one-shot reminder
  both rejected this way. Switched the missing-file fallback to default-allow
  semantics (allow if `targetAgent` is in `configuredAgents`). Replaced
  misleading `"using default policy"` log line.
- **COAL-01..04 — Coalescer runaway recursive retry storm.** During a slow
  fin-acquisition turn ~10 burst messages arrived; the Discord-bridge drain
  block retried every ~150ms, hit `QUEUE_FULL` on the depth-2
  `SerialTurnQueue`, threw payload back into `messageCoalescer`, and re-
  entered — each iteration wrapping the prior failed payload in another
  `[Combined: ...]` header (verified +54 chars/iteration). Daemon CPU
  spiked. Fix: idempotent coalesce wrapper (skip wrap if already
  `[Combined:` prefixed), drain gate via `SerialTurnQueue.hasInFlight()`,
  drain depth cap. Legitimate combine-into-one-payload feature preserved.
- Cross-agent IPC channel delivery + heartbeat inbox timeout deferred to
  Phase 999.12 (also shipped 2026-05-01).

### Phase 104 — Daemon-side op:// secret cache + retry/backoff (2026-04-30 → 2026-05-01)

Resolve all `op://` references in `clawcode.yaml` once at daemon boot into an
in-memory map; inject literal values into agent envs at spawn so restarts
re-use the cache without re-hitting the 1Password API. Adds exponential
backoff (3 attempts × 1s/2s/4s + jitter) on `op read` failures. Root cause
of the 2026-04-30 incident — systemd crash-loop × N agents × ~5 secrets each
saturated the service-account quota into a ~10 minute long-tail throttle.

- SEC-01..07 all complete. New `SecretsResolver` singleton (`src/manager/
  secrets-resolver.ts`) routes all three op:// resolution sites through one
  cache. Boot pre-resolution runs in parallel via `Promise.allSettled`;
  partial failures fail-open with structured pino logs.
- Cache invalidation wired via `ConfigWatcher` diff (yaml edit) +
  `recovery/op-refresh` (auth-error) + new `secrets-invalidate` IPC
  (manual rotation).
- New `secrets-status` IPC returns counter snapshot (cacheSize, hits,
  misses, retries, rateLimitHits, lastFailureAt, etc.) for
  `/clawcode-status` consumption.
- Added `p-retry@^8.0.0` runtime dependency.
- Sequenced before Phase 108 (shared 1password-mcp pooling).

### Phase 103 — /clawcode-status rich telemetry + Usage panel (2026-04-29)

Replaced 11 hardcoded `n/a` fields in `/clawcode-status` with live telemetry
from existing managers, and added a Claude-app-style session/weekly usage
panel (`/clawcode-usage`) backed by the SDK's native `rate_limit_event`
stream.

- Wired 8 live fields into `/clawcode-status` (Session ID, Last Activity,
  Tokens, Permissions, Effort, Reasoning label, Activation, Queue,
  Context %, Compactions count); dropped 3 OpenClaw-specific fields
  (Fast/Elevated/Harness).
- New `RateLimitTracker` per agent (in-memory + per-agent SQLite via
  `UsageTracker` DB); SDK `rate_limit_event` branch in
  `iterateUntilResult`; 7th DI-mirror application on `SessionHandle`.
- New `list-rate-limit-snapshots` IPC + `/clawcode-usage`
  `CONTROL_COMMAND` with `EmbedBuilder` inline-handler short-circuit
  (11th application). Optional 5h+7d bars suffix on `/clawcode-status`.
- Status: shipped, with two follow-up bugs captured in backlog 999.4
  (`resetsAt` unit mismatch, `utilization` derive when undefined).

### Phase 102 — Meeting copilot deploy + ClawCode integration (planning, deferred)

Pending — opened 2026-04-28. Take the existing
[finance-clawdy-coach](https://github.com/jaskarn78/finance-clawdy-coach)
project from on-disk to production-running, validate via one real client
meeting, then evaluate Path A (bare deploy) vs Path B (webhook → ClawCode
thread) vs Path C (deep `send_to_agent` IPC integration). Plans TBD.

### Phase 101 — Robust document-ingestion pipeline (planning, deferred)

Pending — opened 2026-04-28 after the Pon tax return debug session. Build a
proper document-ingestion pipeline: type detection (text-PDF / scanned-PDF /
xlsx / docx / image), OCR fallback for scanned PDFs (Tesseract vs Claude
vision), page-batching strategy, structured extraction with zod-typed
outputs, new `ingest_document` MCP tool, memory-pipeline integration via
Phase 49 RAG infrastructure, fail-mode taxonomy with operator alerts. Plans
TBD.

### Phase 100 — GSD-via-Discord on Admin Clawdy (2026-04-26)

Operator can drive a full GSD workflow (`/gsd:plan-phase`,
`/gsd:execute-phase`, `/gsd:autonomous`, `/gsd:debug`, etc.) from
`#admin-clawdy`, with long-running phases auto-routed into a subagent thread
so the main channel stays free. Plans 100-01..100-08 complete.

- Schema extensions: `agent.settingSources` + `agent.gsd.projectDir` +
  `ResolvedAgentConfig` propagation + loader resolver.
- Session-adapter wiring: replaced hardcoded `cwd` + `settingSources` with
  config-driven values (createSession + resumeSession).
- Differ classification: `settingSources` + `gsd.projectDir` as agent-restart
  (NON_RELOADABLE) fields.
- Slash dispatcher: `/gsd-*` inline handler with auto-thread pre-spawn for
  long-runners (12th inline-handler short-circuit application).
- Phase 99-M relay extension: append artifact paths to parent's main-channel
  summary prompt.
- Install helper: `clawcode gsd install` CLI subcommand (symlinks +
  sandbox `git init`, local-only).
- `clawcode.yaml` fixture: admin-clawdy agent block with 5 GSD
  `slashCommands` + `settingSources` + `gsd.projectDir`.
- Smoke-test runbook: operator-runnable deploy procedure + post-deploy UAT.
- Zero new npm deps.

### Backlog phases shipped post-v2.6

These were promoted from the `999.x` parking lot during the v2.6→v2.7
window. They are listed in numerical (not chronological) order; ship dates
shown.

#### Phase 999.15 — MCP child PID tracking, full reconciliation (2026-04-30)

Fix daemon-side PID staleness exposed by the 999.14 deploy: SDK respawned
claude during warmup, the 1s settle window captured the dying first PID
instead of the surviving second one, leaving 3/5 agents with stale tracker
state. While the orphan reaper was self-healing via cmdline match, the
tracker is also used by graceful-shutdown and per-agent-restart paths where
staleness silently leaked live MCP children.

- TRACK-01..08 complete: per-tick reconciliation (extending the 60s orphan-
  reaper interval), polled discovery at `agent.start` (6 × 5s, age ≥ 5s
  filter), tracker API additions (`updateAgent`, `replaceMcpPids`,
  `getRegisteredAgents`, `pruneDeadPids`, `isPidAlive`), state-change-only
  reconciliation logging, new `clawcode mcp-tracker` CLI + `mcp-tracker-
  snapshot` IPC, `tracker.killAgentGroup` reconciles before kill.
- Long-soak verified on clawdy: cold restart, per-agent restart, forced
  respawn (`kill -9` live claude PID).
- Pairs tightly with 999.14 — 999.14 stops the leak, 999.15 makes the
  tracker authoritative.
- CLI hot-fix follow-up shipped in Phase 106 (TRACK-CLI-01).

#### Phase 999.14 — MCP server child process lifecycle hardening (2026-04-30)

Stop MCP server processes from leaking on agent restart. MariaDB hit 152/151
connections — root cause was 15 orphan `mcp-server-mysql` processes
accumulating across two clawcode restarts. Each agent restart spawns a fresh
`npm exec mcp-server-mysql`; the npm wrapper exits cleanly but its `sh -c
mcp-server-mysql` and `node` children get reparented to PID 1 and keep their
DB connections alive forever.

- MCP-01..07: spawn-side process-group wiring, SIGTERM-on-disconnect, periodic
  60s orphan reaper sweep, graceful daemon-shutdown MCP cleanup, boot-time
  orphan scan.
- MCP-08..10 (added mid-phase after a same-day `Max thread sessions (3)`
  cap pin on fin-acquisition with 3 stale Discord-thread bindings ~22h
  old): prune registry on failed Discord-archive cleanup (50001/10003),
  periodic stale-binding sweep (`defaults.threadIdleArchiveAfter`, default
  `"24h"`), operator CLI for thread inspection + manual archive
  (`clawcode threads archive`, `prune --stale-after`,
  `prune --agent`).
- Post-deploy hot-fix: bare-name fallback in `buildMcpCommandRegexes` so
  the orphan reaper matches `sh -c <name>` + `node /.../bin/<name>`
  grandchild forms (commit `bcc70a8`).
- Pairs with 999.15 (which makes the tracker authoritative).

#### Phase 999.13 — Specialist delegate map + agent-context TZ rendering (2026-04-30, partial)

Two "agent context hygiene" pillars in one phase.

- **Pillar A — Specialist delegate map** (DELEG-01..04). Per-agent typed map
  of `{ specialty: targetAgentName }` (free-form keys) injected as a
  delegation directive at session boot via `renderDelegatesBlock`. Schema:
  `delegates: z.record(z.string().min(1), z.string().min(1)).optional()`,
  `superRefine`-validated against configured agent names.
- **Pillar B — Agent-visible TZ rendering** (TZ-01..05). New
  `renderAgentVisibleTimestamp` helper + `defaults.timezone` config knob
  (IANA TZ name, falls back to host). Converts ISO UTC to operator-local TZ
  at the serialization boundary across 5 agent-visible timestamp sites
  (restart-greeting, heartbeat builder, scheduler, conversation history
  compactor, memory snapshot writer). Format: `"2026-04-30 11:32:51 PDT"`.
  Internal storage stays UTC.
- **Status:** Both pillars shipped, but the yaml fan-out to 8 channel-bound
  agents was **rolled back** at deploy due to the DSCOPE recursive-
  delegation bug (subagents inheriting the delegate map). Properly fixed
  in Phase 106 (DSCOPE-02); fan-out restored in 106-04.

#### Phase 999.12 — Cross-agent IPC channel delivery + heartbeat inbox timeout (2026-05-01)

Two operator-visible orchestration / observability fixes split out of the
original Phase 105 scope.

- **IPC-01..03 — Bot-direct fallback for `dispatchTurn` reply mirror.**
  Cross-agent `dispatchTurn` was returning the response to caller's tool
  result but never posting in the target agent's bound Discord channel.
  Mirrors the Phase 100 follow-up `triggerDeliveryFn` pattern: opt-in
  `mirror_to_target_channel: true` flag routes the response via webhook →
  bot-direct fallback.
- **HB-01/02 — Inbox timeout + active-turn skip.** Heartbeat inbox check's
  10s timeout was too tight for cross-agent turns (one logged `"heartbeat
  check critical"` while the target was mid-turn). Added
  `HeartbeatConfig.inboxTimeoutMs` override + active-turn skip via
  `SerialTurnQueue.hasInFlight()`.
- Validated end-to-end in production alongside 999.6 snapshot (commit
  `831e48a`).

#### Phase 999.11 / 105 — see Phase 105 above

The original 999.11 was re-scoped on 2026-04-30 into the active Phase 105
(POLICY default-allow + COAL coalescer storm) and the deferred Phase
999.12 (IPC channel delivery + heartbeat inbox timeout). Shipped under
the 105/999.12 entries above.

#### Phase 999.10 / 104 — see Phase 104 above

The original 999.10 was promoted to the active Phase 104 (daemon-side
op:// secret cache + retry/backoff). Shipped under the 104 entry above.

#### Phase 999.8 — Dashboard knowledge-graph fixes (2026-04-30)

Three bugs/gaps surfaced when operator opened the knowledge-graph dashboard.

- **CAP-01..04 — Lift hardcoded 500-node cap.** `memory-graph` IPC handler
  capped at `LIMIT 500`; fin-acquisition has 1,434 memories. Lifted to
  configurable default 5000, optional `limit` clamped to `[1, 50000]`.
- **COLOR-01/02 — 4-color tier palette + live legend.** Dashboard previously
  emitted only 3 colors (grey orphan, red hot, purple "everything else"
  lumping warm AND cold together). Now hot/warm/cold/orphan each get a
  distinct color with a top-right legend showing live counts.
- **HB-01..06 — Static heartbeat-check registry.** Production showed silent
  `checkCount:0` because dynamic discovery silently failed. Replaced with
  static `CHECK_REGISTRY` (11 modules) — heartbeat checks now boot
  deterministically.

#### Phase 999.6 — Auto pre-deploy snapshot + post-deploy restore (2026-05-01)

Make every production deploy preserve the runtime list of running agents and
restore them on daemon boot, independent of static `autoStart` config.
Operator pain: `autoStart=false` agents that an operator manually started
for the day were lost across a `clawcode update --restart`.

- SNAP-01..05: new `src/manager/snapshot-manager.ts` writes
  `~clawcode/.clawcode/manager/pre-deploy-snapshot.json` on shutdown.
  Daemon boot reads it, overrides static `autoStart`, then deletes it.
  New `defaults.preDeploySnapshotMaxAgeHours` schema knob.
- Validated end-to-end in production alongside 999.12 (commit `831e48a`).

#### Phase 999.3 — Specialist subagent routing via `delegateTo` (2026-04-29)

New `delegateTo: <agent_name>` parameter on the `spawn_subagent_thread` MCP
tool. When set, the spawned subagent inherits the target agent's config
(model, soul, identity, skills, mcpServers) instead of the caller's. Thread
created in caller's channel; existing autoRelay (Phase 99-M) handles the
summary back to caller's main channel.

- DEL-01..DEL-10 across 4 surfaces (types → spawner → daemon IPC →
  MCP tool). Recursion-guard invariant preserved.
- Follow-up gaps captured in 999.18 (relay reliability), 999.19 (cleanup +
  consolidation + delegate-channel routing), 999.22 (soul guard).

#### Phase 999.2 — a2a refactor (rename + sync-reply, 2026-04-29, partial)

Fix the agent-to-agent comms architectural debt: admin-clawdy →
fin-acquisition produced no reply back.

- **Rename (Option C — full):** `SessionManager.sendToAgent` →
  `dispatchTurn` (7 internal call sites). MCP tool `send_message` →
  `ask_agent`. MCP tool `send_to_agent` → `post_to_agent`. IPC methods
  aligned. Backwards-compat aliases shipped for transition safety.
- **v2 sync-reply on `ask_agent`:** target's response surfaced in the tool
  result (fixes the 2026-04-29 smoking-gun bug).
  `mirror_to_target_channel` flag posts Q+A as webhook embeds in target's
  channel. Stop swallowing `sendToAgent` errors.
- **Async correlation IDs** — bigger redesign deferred to a future phase.

#### Phase 999.1 — Agent output directives (2026-04-29)

Counter-instruct Claude Code's default behaviors that misfire in this
trusted-operator workspace. Four directives shipped together as locked-
additive entries in `DEFAULT_SYSTEM_PROMPT_DIRECTIVES` (Phase 94 D-10 rail).

- **FRESH-*** — Time-aware live websearch: inject today's date + rule that
  anything dated within ~6 months OR matching time-sensitive categories
  (prices, laws, financials, regulations, current events) must be checked
  via `web_search`.
- **DERIV-*** — Subagent derivative-work mandate: subagents inherit a
  permission clause clarifying that creating new files, deriving
  parameterized templates from examples, generating code, and producing
  artifacts are all in-scope when delegated.
- **TRUST-*** — Trusted-operator disclaimer suppression: skip CYA language
  ("this is not malware", "this is for legitimate purposes", etc.). The
  workspace is owned by a single trusted operator.
- **TABLE-*** — Markdown tables → bullets in Discord (companion to the
  webhook-wrap quick task `260429-ouw`): prefer bullets / definition lists
  / inline prose over markdown tables when content fits.

---

## [v2.6] — Tool Reliability & Memory Dreaming (2026-04-25)

Two phases (94, 95) addressing two architectural concerns: agents
confidently advertising tools that fail at execution time, and memory
systems that stagnate without periodic reflection.

- **Phase 94 — Tool Reliability & Self-Awareness.** Capability probe
  primitive + per-server registry; dynamic tool advertising
  (system-prompt filter); auto-recovery primitives (Playwright install,
  op:// refresh, subprocess restart); honest `ToolCallError` schema +
  executor wrap; `clawcode_fetch_discord_messages` +
  `clawcode_share_file` auto-injected tools; `defaults.systemPromptDirectives`
  rail + file-sharing default directive; `/clawcode-tools` upgrade with
  cross-agent routing suggestions. (TOOL-01..TOOL-12)
- **Phase 95 — Memory Dreaming.** Idle-window detector + dream prompt
  builder + LLM dream pass primitive; auto-apply additive results +
  dream-log writer (`memory/dreams/YYYY-MM-DD.md`) + per-agent cron timer;
  `clawcode dream <agent>` CLI + `/clawcode-dream` Discord slash +
  `run-dream-pass` IPC. (DREAM-01..DREAM-07)

Audit (`v2.6-MILESTONE-AUDIT.md`): tech_debt status — 19/19 requirements
satisfied, 2/2 phases shipped, integration + flows passed. Two known
follow-ups: `applyAutoLinks` production wiring uses a stub (LLM suggested
`{from,to}` shape mismatches existing `discoverAutoLinks` signature),
and `SessionManager.getLastTurnAt()` accessor not wired (dream cron
uses `--idle-bypass` workaround).

---

## [v2.5] — Cutover Parity Verification (2026-04-25)

Two phases (92, 93) building cutover-parity verifier infrastructure ahead
of fin-acquisition cutover, plus three operator-reported UX fixes from
the 2026-04-24 fin-acquisition Discord session.

- **Phase 92 — Cutover-parity verifier infrastructure.** 6 plans, 134
  tests, zero new npm deps. Discord history ingestor + Mission Control API
  ingestor + LLM source profiler emitting `AGENT-PROFILE.json` with
  `topIntents[]`; target-capability probe (clawcode.yaml + workspace
  inventory + Phase 85 `list-mcp-status` IPC); pure diff engine with
  9-kind typed `CutoverGap` discriminated union; additive auto-applier
  (4 kinds) reusing Phase 86 atomic YAML writers + Phase 91 rsync
  primitives + append-only ledger; destructive embed flow (5 kinds) via
  admin-clawdy `ButtonBuilder` with Accept/Reject/Defer; dual-entry
  canary runner (Discord bot + `/v1/chat/completions` API) with 30s
  timeout; cutover-ready report aggregator + Phase 91
  `set-authoritative` precondition (24h freshness gate +
  `--skip-verify` audit row); ledger-rewind rollback CLI.
  - **D-12 finding:** fin-acquisition is a model-binding alias not a
    discrete OpenClaw agent — verifier infrastructure is reusable for
    future per-agent migrations but moot for fin-acquisition itself
    (operator cutover reduces to a single `modelByChannel` swap).
- **Phase 93 — Status / marketplace / manifest UX.** Rich
  `/clawcode-status` parity with OpenClaw's 17-field block via pure
  status-render module + daemon short-circuit;
  `defaults.clawhubBaseUrl` auto-injection so `/clawcode-skills-browse`
  surfaces public skills out-of-the-box; HTTP 404 vs malformed-body
  distinction in plugin install pipeline emitting `manifest-unavailable`
  outcome with actionable Discord copy. Zero new npm deps.

---

## [v2.4] — OpenClaw ↔ ClawCode Continuous Sync (2026-04-24)

One phase (91): continuous uni-directional sync from OpenClaw
fin-acquisition workspace to ClawCode mirror.

- Pull model, 5-min systemd timer + hourly conversation-turn translator via
  rsync over SSH.
- `sync-state.json` with direction-aware `authoritative` flag (never
  bidirectional).
- sha256 conflict detection with source-wins + skip-file semantics +
  bot-direct admin-clawdy alerts.
- `/clawcode-sync-status` Discord slash with `EmbedBuilder` (8th inline-
  short-circuit application).
- `clawcode sync *` CLI (`status` / `run-once` / `resolve` /
  `set-authoritative` / `start-reverse` / `stop` / `finalize` /
  `translate-sessions`) with drain-then-flip cutover semantics + 7-day
  rollback window.
- Exclude-filter regression test pinning `*.sqlite` /
  `sessions/*.jsonl` / `.git` / editor-snapshots never land on
  destination.
- Cutover runbook extended with 5 sync-specific sections.
- Zero new npm deps.

---

## [v2.3] — Marketplace & Memory Activation (2026-04-24)

One phase (90) bundling ClawHub Marketplace extension + workspace-memory
activation + fin-acquisition pre-cutover wiring.

- **ClawHub Marketplace.** `/clawcode-skills-browse` unions clawhub.ai
  skills + `/clawcode-plugins-browse` for plugins → mcpServers +
  install-time `ModalBuilder` config + 1Password `op://` fuzzy rewrite +
  GitHub device-code OAuth.
- **Workspace-memory activation.** `MEMORY.md` auto-inject at
  session-start + chokidar file-scanner with hybrid RRF retrieval +
  periodic mid-session flush + "remember this" cue detection +
  subagent-output capture.
- **fin-acquisition ClawCode agent pre-cutover wiring.** 6 MCPs +
  verbatim-OpenClaw heartbeat + effort/allowedModels/greet + memory
  backfill CLI + daemon webhook identity probe + 9-section operator
  runbook. Channel `1481670479017414767` intentionally unchanged —
  cutover deferred to operator.

---

## [v2.2] — OpenClaw Parity & Polish (2026-04-23)

Phases 83-89, 55+ requirements across UI/SKILL/EFFORT/MODEL/CMD/TOOL/MKT
categories, plus Phase 89 GREET-01..10. Zero new npm deps.

- **Phase 83 — Extended-thinking effort mapping** (P0 silent no-op fix +
  SDK canary).
- **Phase 84 — Skills library migration CLI** (secret-scan gated).
- **Phase 85 — MCP tool awareness & reliability** (phantom-error class
  eliminated; foundation for Phase 94's capability probe).
- **Phase 86 — Dual Discord model picker** (direct IPC dispatch +
  `allowedModels` allowlist).
- **Phase 87 — Native CC slash commands** (SDK-reported commands as
  `clawcode-*` Discord slashes).
- **Phase 88 — Skills marketplace** (`/clawcode-skills-browse` install
  pipeline).
- **Phase 89 — Agent restart greeting** (`restartAgent`-only Discord
  greeting with Haiku summarization + webhook identity + cool-down).

---

## [v2.1] — OpenClaw Agent Migration (2026-04-21)

Phases 75-82 + 82.1 — one-shot migration CLI for porting 15-agent
fleets from OpenClaw to ClawCode. 31 requirements across SHARED / MIGR /
CONF / WORK / MEM / FORK / OPS satisfied. Zero new npm deps.

- Shared-workspace runtime support (`memoryPath` field).
- Migration CLI with `plan` / `apply` / `verify` / `rollback` /
  `cutover` / `complete` subcommands.
- Pre-flight guards (daemon running + secret scanner + channel collision
  + read-only source).
- Config mapping + atomic YAML writer (`soulFile` / `identityFile`
  pointers).
- Workspace migration with hash-witness.
- Memory translation with `origin_id` idempotency + MiniLM
  re-embedding.
- Fork-to-Opus regression across 4 primary models.
- Pilot selection + dual-bot cutover + migration report.
- Phase 82.1 closed the finmentum `soulFile` path-routing gap.

---

## [v2.0] — Open Endpoint + Eyes & Hands (2026-04-20)

Phases 69-74. Made every ClawCode agent reachable from any OpenAI-
compatible client and gave every agent a real browser, web search, and
image generation.

- **Phase 69 — OpenAI-Compatible Endpoint.** First-class streaming +
  tool-use + per-key session continuity on `/v1/chat/completions` +
  `/v1/models` (port 3101).
- **Phase 70 — Browser Automation MCP.** Headless Chromium with a
  persistent per-agent profile.
- **Phase 71 — Web Search MCP.** Live web search + clean article fetch
  with intra-turn deduplication.
- **Phase 72 — Image Generation MCP.** MiniMax / OpenAI / fal.ai
  generation + edit with workspace persistence and cost tracking.
- **Phase 73 — OpenClaw Endpoint Latency.** Sub-2s TTFB on warm agents
  via persistent `streamInput()` subprocess + brief cache.
- **Phase 74 — Seamless OpenClaw Backend.** Caller-provided agent config
  on `/v1/chat/completions` — OpenClaw agents use ClawCode as a
  rendering backend without pre-registration.

---

## [v1.9] — Persistent Conversation Memory (2026-04-18)

Phases 64-68 + 68.1.

- ConversationStore schema + lifecycle.
- Capture integration (fire-and-forget + SEC-02).
- Session-boundary summarization.
- Resume auto-injection.
- Conversation search + deep retrieval.
- Phase 68.1 closed the `isTrustedChannel` cross-phase wiring gap.

---

## [v1.8] — Proactive Agents + Handoffs (2026-04-17)

Phases 57-63.

- TurnDispatcher foundation.
- Task store + state machine (durable tasks).
- Cross-agent RPC handoffs.
- Trigger engine.
- Additional trigger sources.
- Policy layer + dry-run.
- Observability surfaces (cross-agent trace).

---

## [v1.7] — Performance & Latency (2026-04-14)

Phases 50-56.

- Phase-level latency instrumentation.
- SLO targets + CI regression gate.
- Prompt caching (Anthropic preset+append).
- Context audit + token budget tuning.
- Streaming + typing indicator.
- Tool-call overhead reduction.
- Warm-path optimizations.

---

## [v1.6] — Platform Operations & RAG (2026-04-12)

Phases 42-49.

- Auto-start agents on daemon boot.
- systemd production integration.
- Agent-to-agent Discord communication.
- Memory auto-linking on save.
- Scheduled consolidation.
- Discord slash commands for control.
- Webhook auto-provisioning.
- RAG over documents.

---

## [v1.5] — Smart Memory & Model Tiering (2026-04-10)

Phases 36-41.

- Knowledge graph (wikilinks + backlinks).
- On-demand memory loading (`memory_lookup` MCP + personality
  fingerprint).
- Graph intelligence (graph-enriched search + auto-linker).
- Model tiering (haiku default + fork-based escalation + opus advisor).
- Cost optimization (per-agent tracking + importance scoring +
  escalation budgets).
- Context assembly pipeline (per-source token budgets).

---

## [v1.4] — Agent Runtime (2026-04-10)

Phases 33-35.

- Global skill install.
- Standalone agent runner.
- OpenClaw coexistence (token hard-fail, slash command namespace,
  dashboard non-fatal).

---

## [v1.3] — Agent Integrations (2026-04-09)

Phases 31-32.

- Subagent thread skill (Discord-visible subagent work via skill
  interface).
- MCP client consumption (per-agent external MCP server config with
  health checks).

---

## [v1.2] — Production Hardening & Platform Parity (2026-04-09)

Phases 21-30.

- Tech debt cleanup.
- Config hot-reload.
- Context health zones.
- Episode memory.
- Delivery queue.
- Subagent Discord threads.
- Security & execution approval.
- Agent bootstrap.
- Web dashboard.

---

## [v1.1] — Advanced Intelligence (2026-04-09)

Phases 6-20.

- Memory consolidation.
- Relevance / dedup.
- Tiered storage.
- Task scheduling.
- Skills registry.
- Agent collaboration.
- Discord slash commands.
- Attachments.
- Thread bindings.
- Webhook identities.
- Session forking.
- Context summaries.
- MCP bridge.
- Reaction handling.
- Memory search CLI.

---

## [v1.0] — Core Multi-Agent System (2026-04-09)

Phases 1-5. The foundation.

- Central config (`clawcode.yaml`).
- Agent lifecycle (spawn, stop, restart, status).
- Discord routing (per-agent channel binding).
- Per-agent memory (SQLite + sqlite-vec + local 384-dim embeddings).
- Heartbeat framework.
