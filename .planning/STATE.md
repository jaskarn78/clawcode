---
gsd_state_version: 1.0
milestone: v2.9
milestone_name: Reliability & Routing
status: phase-119-ready
stopped_at: "Autonomous delegation attempt 2026-05-14 — the background general-purpose subagent did NOT have Task() access (it can't dispatch named gsd-* subagents like gsd-planner / gsd-executor), so it could not run the GSD workflow chain inside its own context. That constraint applies only to delegated subagents, NOT to the main Claude Code session, which DOES have Agent/Task access to gsd-planner, gsd-executor, gsd-code-reviewer, etc. Path forward: drive autonomous from main context (heavier inline burden) OR phase-by-phase via /gsd-plan-phase 119 (lighter, with operator checkpoints between phases). Phase 119 CONTEXT.md (commit a4a71c6) is ready for plan-phase. Pre-existing plans for 121 (999.36-02/03) and 123 (999.6-02, 999.14-02, 999.15-04) remain in original phase dirs awaiting promotion. Full diagnosis + per-phase status + unblock paths in .planning/v2.9-AUTONOMOUS-RUN.md. Ramy-active deploy hold continues."
last_updated: "2026-05-14T00:00:00.000Z"
last_activity: 2026-05-14
progress:
  total_phases: 7
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-13 — v2.9 Reliability & Routing milestone opened)

**Core value:** Persistent, intelligent AI agents that each maintain their own identity, memory, and workspace — communicating naturally through Discord channels without manual orchestration overhead.

**Current focus:** v2.9 Reliability & Routing — close operator-pain gaps in A2A delivery, post-Phase-116 dashboard observability, subagent UX, MCP lifecycle verification, plus session-compaction primitives + algorithm folded in from 999.51/999.52 on 2026-05-13. See `.planning/BACKLOG-CONSOLIDATED.md` for the merge groups + standalone items.

## Current Position

Phase: 119 (A2A Delivery Reliability) — Context gathered
Plan: —
Status: Context captured, ready for planning
Last activity: 2026-05-14 — Phase 119 CONTEXT.md written (auto-discuss mode, 10 decisions D-01..D-10 covering bot-direct fallback port from 999.12 IPC-02, WebhookManager 401/404 invalidation, queue-state icon mutex state machine, `no_webhook_fallbacks_total` counter via Phase 116/109 surface, agent-side HEARTBEAT_OK suppression). Next: `/gsd-plan-phase 119 --auto` (auto-chains to execute).

**v2.9 phase map (build order — Waves 1/3/4/5/6/7):**
- Phase 119: A2A Delivery Reliability (A2A-01..04) — Wave 1
- Phase 120: Dashboard Observability Cleanup (DASH-01..05) — Wave 3, parallel to 119
- Phase 121: Subagent UX Completion + Chunk-Boundary (SUB-01..02) — Wave 4
- Phase 122: Discord Table Auto-Wrap Universalization (DISC-01) — Wave 5, sequenced after 119
- Phase 124: Operator-Triggered Session Compaction (CLI + Discord + policy decoupling) — Wave 5/6, parallel-OK with 122
- Phase 125: Intelligent Auto-Compaction Strategy (tiered retention) — Wave 6/7, depends on 124
- Phase 123: MCP Lifecycle Verification Soak (MCP-01..03) — Wave 7 (last; soak window satisfied 2026-05-13, the wait gate is no longer load-bearing)

## Current Session — Post-v2.7 fix wave (2026-05-02)

Three ultraplan PRs landed back-to-back via the cloud `/ultraplan` workflow:

- **PR #3 (`778c8c7`) — Phase 999.29:** dream-pass adapters wired (`getRecentChunks` → `listRecentMemoryChunks`, `getRecentSummaries` → terminated-session+memory hydration, `applyAutoLinks` → graph-edges.json writer). Closes "Wikilinks 0 applied" pattern across all dream embeds.
- **PR #4 (`d15c8f1`) — Phase 999.28:** MCP probe wrapper group-kill (`detached: true` spawn + `killGroup` cleanup) eliminates `mcp-server-mysql` grandchildren reparenting to PID 1 across 14×60s probe cadence.
- **PR #5 (`3bbde46`) — Phase 99 unified:** sub-scopes A (`getAgentMemoryDbPath` helper + 8 callsites + CI grep regression pin) + C (pending-summary backlog drain via 30-min × 5 sessions/tick heartbeat) + D (restart-greeting lookback 5 → 25 + summaryMemoryId fallback) + J (closes via A's path fix).

Deploy on clawdy: 2 restarts (one per build wave), 6 agents auto-restored from pre-deploy snapshot each time, 13 heartbeat checks now registered (+ summarize-pending), zero rollbacks.

**Note:** Credential rotation (former Phase 99-G scope) handled by operator outside the GSD workflow as of 2026-05-05.

## Post-v2.7 Continued Activity (2026-05-03 → 2026-05-05)

Nine commits landed beyond the 2026-05-02 fix wave, organized into a hardening + ergonomics wave:

**Infrastructure / hardening:**

- **Phase 109 (commit `8880fe8`, 2026-05-03)** — MCP/Secret Resilience bundle. Four sub-scopes: 109-A broker observability (`rpsLastMin`/`throttleEvents24h`/`lastRetryAfterSec` + `clawcode broker-status` CLI), 109-B orphan-claude reaper (alert mode default; reap-mode behind flag), 109-C `clawcode preflight` (blocks restart if cgroup mem >80% or broker calls inflight), 109-D fleet-stats IPC + `/api/fleet-stats` dashboard endpoint. Driven by 2026-05-03 fleet incident (cgroup at 97.8% MemoryMax, 4 invisible orphan claudes, swap exhausted).
- **Phase 110 Stage 0a (commit `5aa5ab6`, PR #6, 2026-05-03)** — MCP memory reduction foundational scaffolding. Schema + observability + CLI surface for upcoming shim-runtime swap (Stage 0b) and broker generalization (Stage 1). NO behavior change. Adds `defaults.shimRuntime` per-shim runtime selector, `defaults.brokers` dispatch table, `mcp-broker-shim --type` CLI alias, `McpRuntime` classification in fleet-stats.
- **Phase 999.33 (commit `eee88c2`, 2026-05-04)** — Bound `preResolveAll` concurrency to 4 in-flight. Boot-storm partial fix layered with Phase 109 mitigations.

**Subagent / relay:**

- **Phase 999.30 (commits `81975aa`, `12f4ac1`, PR #9, 2026-05-04)** — Subagent relay on work-completion, not session-end. Three triggers (explicit `subagent_complete` tool, 5-min quiescence sweep, session-end callback) deduped via `binding.completedAt`. **Note: tagged as `999.25` in commits but renumbered to 999.30 in ROADMAP 2026-05-05** (number collision with shipped boot wake-order priority).
- **(untagged, commit `716fb46`, PR #7, 2026-05-04)** — Auto-prune spawned subagent threads after inactivity. Companion cleanup to 999.30.

**Ergonomics:**

- **Phase 999.31 (commits `b46acd9`, `709e5ce`, `848a443`, 2026-05-04)** — `/ultra-plan` + `/ultra-review` slash commands at top level (initially under `/get-shit-done`, then routed to native `/ultraplan`, then promoted to top-level).
- **Phase 999.32 (commit `584a20a`, 2026-05-04)** — Consolidated GSD into single `/gsd-do` entry; removed `/clawcode-probe-fs`.

**Stability fixes:**

- **(untagged, commit `98ff1bc`, PR #8, 2026-05-04)** — Hot-reload reaper dial fix: pass `newConfig` through `ConfigWatcher` so orphan-claude reaper picks up live config changes without daemon restart.
- **(untagged, commit `bca9400`, PR #10, 2026-05-05)** — Marketplace skip-empty-name: clawhub items with missing/empty `name` no longer crash marketplace UI.

**Phase number collisions resolved 2026-05-05:**

- Phase 109 commit-tag bound to MCP/Secret Resilience bundle (shipped). Original "Image ingest pipeline" scope renumbered to **Phase 113**.
- Phase 110 commit-tag bound to MCP memory-reduction work (Stage 0a shipped, later stages active). Original "Retroactive 999.x renumbering" scope renumbered to **Phase 114**.
- Phase 999.25 commit-tag bound to "Agent boot wake-order priority" (shipped 2026-05-01). The 2026-05-04 PR #9 was tagged `feat(999.25)` for "subagent relay on work-completion" but renumbered to **Phase 999.30** in ROADMAP.

## Phase 113 — Image ingest pipeline (SHIPPED 2026-05-07)

**Commits:** `40deda6` (core), `115fdc7` (apiKey:null auth fix), `5dfac40` (PNG media type fix)

**What shipped:**

- `haiku-direct.ts` — `callHaikuDirect` + `callHaikuVision` via `@anthropic-ai/sdk` directly with OAuth Bearer token (`claudeAiOauth.accessToken` from `~/.claude/.credentials.json`). Bypasses `sdk.query()` subprocess entirely — no `ANTHROPIC_API_KEY` inheritance, bills OAuth subscription.
- `image-resizer.ts` — sharp resize to ≤1568px before vision API call.
- `vision-pre-pass.ts` — parallel Haiku 4.5 vision calls for all image attachments; injects `<screenshot-analysis>` blocks; empty/failed analyses fall back to existing file-path hint.
- `summarize-with-haiku.ts` — rewritten to delegate to `callHaikuDirect` (same auth fix).
- `bridge.ts` — vision pre-pass wired in both thread + channel handlers; `formatDiscordMessage` updated to accept `visionAnalyses` map.
- `schema.ts` / `types.ts` / `loader.ts` — `vision: { enabled, preserveImage }` per-agent config.

**Prod fixes found during smoke test:**

1. `apiKey: null` required — SDK prioritizes `ANTHROPIC_API_KEY` env over `authToken` when both present.
2. Always pass `"image/png"` to API — `resizeImageForVision` always outputs PNG regardless of Discord attachment content-type.

**Vision enabled agents:** Admin Clawdy, fin-acquisition, general, projects, research.

## Performance Metrics

**v2.7 milestone (2026-04-26 → 2026-05-01, 5 days):**

- 7 phases shipped (100, 103-108) + 1 deferred (101) + 1 dropped (102, 2026-05-05)
- 5 bundled backlog ships (999.6, 999.12, 999.13, 999.14, 999.15)
- Phase 108 deploy: 6 iterations, 5 hot-fixes, all caught + fixed live without rollback
- Final outcome: ~60% MCP child reduction in production via broker pooling

**Post-v2.7 fix wave (2026-05-02, single session):**

- 3 PRs merged via cloud `/ultraplan` (PR #3, #4, #5)
- 7 sub-scopes/items closed in one wave (Phase 99: A, C, D, J + new 999.28, 999.29)
- 21 source files touched, 1646+ insertions, 63 deletions
- 265 new tests added (71 + 9 + 185), 100% pass post-deploy
- 2 production deploys to clawdy with snapshot/restore preserving 6 running agents both times

**Recent Trend:**

- Mid-milestone (Phases 104-105): infrastructure incident response — secrets cache + dispatch fixes shipped within 24h of operator-reported symptoms
- End-milestone (Phase 108): structural change with 5 hot-fixes during deploy — fail-loud guard pattern (added in first hot-fix) cracked open all downstream bugs
- Post-v2.7 (2026-05-02): cloud `/ultraplan` workflow proven — 3 PRs in single session via remote agent + local `git am` apply pattern (artifact: `<X.Y>` chat-rendering noise needs pre-clean before patch apply)

*Updated after each milestone close*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [v2.2 Roadmap]: Zero new npm deps — entire milestone runs on existing stack (Claude Agent SDK 0.2.97, discord.js 14.26.2, better-sqlite3, yaml 2.8.3, zod 4.3.6). Verified by .planning/research/STACK.md against installed node_modules/sdk.d.ts.
- [v2.2 Roadmap]: SDK pin to EXACT 0.2.97 (not ^0.2.97) — pre-1.0 churn risk; minor versions may break setModel/setPermissionMode/setMaxThinkingTokens/supportedCommands surface.
- [v2.2 Roadmap]: Phase 83 (Effort) FIRST as SDK canary — fixes P0 silent no-op at persistent-session-handle.ts:599 AND validates SDK mid-session mutation strategy for 86 (setModel) and 87 (setPermissionMode). Cannot ship 86/87 confidently without 83's spy-test proof of q.setMaxThinkingTokens live concurrency.
- [v2.2 Roadmap]: Namespace locked BEFORE Phase 87 — all ClawCode Discord commands MUST be `clawcode-*` prefixed. Bare /model, /clear, /memory rejected (OpenClaw + community-bot collision risk). Phase 86 establishes the unified /clawcode-model as the convention Phase 87 follows for every SDK-reported slash command.
- [v2.2 Roadmap]: Phase 86 depends on Phase 83, not the other way around — effort wiring is smaller surface (one SDK call) and its spy-test pattern is the template for the model-setter wiring in Phase 86. If q.setMaxThinkingTokens races the driver iterator, Phase 86 is in trouble too.
- [v2.2 Roadmap]: Phase 88 (Marketplace) reuses Phase 84 migration pipeline — one skill at a time, same secret-scan + frontmatter normalization + idempotency gates. No parallel skill-install pipeline built; marketplace is a Discord wrapper around the Phase 84 CLI.
- [v2.2 Roadmap]: UI-01 cross-cutting, validated per-phase — single requirement spans 4 UI-bearing phases (83 effort picker, 86 model picker, 87 autocomplete + control-plane commands, 88 skills browser). Each phase's acceptance includes UI-01 compliance; no single phase "owns" UI-01.
- [v2.2 Roadmap]: Dual Discord picker deferred to future milestone (MODEL-F1) — v2.2 ships the core picker with IPC dispatch + allowedModels schema foundation; OpenClaw-side read of materialized allowlist JSON is a follow-up once the ClawCode core is proven.
- [v2.2 Roadmap]: CMD-00 SDK spike is a gate, not a task — 30-minute throwaway script against `sdk.query({prompt, options})` confirming mid-session q.setModel/q.setPermissionMode/q.setMaxThinkingTokens concurrency safety against the single captured driverIter handle, committed to `.planning/research/CMD-SDK-SPIKE.md` BEFORE any Phase 87 implementation code lands.
- [v2.2 Roadmap]: Phase 85 (MCP Tool Awareness) is fully independent — no dependency on 83/86/87. Uses v1.3 MCP health-check infrastructure + v1.7 two-block prompt assembly; can ship in parallel with 83/84 for quickest delivery of the phantom-error fix.
- [Phase 83]: Plan 83-01 — Extended effortSchema to 7 levels (additive — v2.1 migrated configs parse unchanged via regression test); off=0 (number) and auto=null (model default) semantically distinct for Plan 02 persistence.
- [Phase 83]: Plan 83-01 — Closed P0 silent no-op at persistent-session-handle.ts:599 by wiring q.setMaxThinkingTokens. Pinned by spy test (8 tests); setEffort stays synchronous via fire-and-forget + .catch log-and-swallow pattern.
- [Phase 83]: Plan 83-01 — SDK session-start 'effort' option stays narrow (low|medium|high|max); extended levels (xhigh|auto|off) route exclusively through runtime q.setMaxThinkingTokens. Legacy wrapSdkQuery gets narrowEffortForSdkOption helper for type compliance.
- [Phase 83]: Plan 83-01 — Effort classified reloadable (agents.*.effort, defaults.effort) because live handle.setEffort takes effect next turn — no socket/db/workspace restart.
- [Phase 83]: Plan 83-01 SDK canary result — q.setMaxThinkingTokens concurrency SAFE against single captured driverIter handle. Spy-test shape unblocks Phase 86 (setModel) and Phase 87 (setPermissionMode) to follow the same regression-pin blueprint.
- [Phase 83]: Plan 83-03 — UI-01 StringChoices 7-entry dropdown for /clawcode-effort replaces free-text (schema extended with optional choices capped at 25 per Discord).
- [Phase 83]: Plan 83-03 — /clawcode-status is a daemon-side short-circuit returning authoritative 🎚️ Effort line from sessionManager.getEffortForAgent (no LLM turn consumed, trades rich self-report for reliability).
- [Phase 83]: Plan 83-03 — SKILL.md effort: frontmatter → SkillEntry.effort → TurnDispatcher.dispatch skillEffort option with try/finally revert at turn boundary; slash-command path wraps streamFromAgent with same apply+revert contract.
- [Phase 83]: Plan 83-02 — Runtime effort persistence via dedicated ~/.clawcode/manager/effort-state.json (NOT registry.json extension); atomic temp+rename write; graceful null fallback on corruption/missing/invalid; fire-and-forget persist at setEffortForAgent, re-apply in startAgent BEFORE warm-path gate.
- [Phase 83]: Plan 83-02 — Fork effort quarantine (EFFORT-06) pinned by explicit 'effort: parentConfig.effort' line in buildForkConfig + 6 tests (3 unit + 3 SessionManager integration). Prevents v1.5 fork-to-Opus cost spike: runtime override on parent does NOT propagate into fork; fork launches at parent CONFIG default.
- [Phase 84]: Plan 84-01 — Skills ledger is SEPARATE file (v2.2-skills-ledger.jsonl) from v2.1 agent ledger; keeps v2.1 byte-stable as regression pin. Mirrors v2.1 ledger.ts shape with trimmed action enum (plan/apply/verify) and extended status enum (adds skipped/refused).
- [Phase 84]: Plan 84-01 — Credential-context gate: high-entropy alone does NOT refuse. Line must ALSO contain a credential-shaped label (password/secret/token/api_key/...). Solves false-positive problem for avatar/webhook/git-SHA IDs in skill documentation. 3-phase classifier otherwise mirrors Phase 77 guards.ts (sk-prefix → whitelist → high-entropy).
- [Phase 84]: Plan 84-01 — Tighter thresholds than v2.1 PlanReport guard (len>=12 + bits>=3.8 for skills vs len>=30 + bits>=4.0 for PlanReport). Required to catch short hand-typed passwords like finmentum-crm's 19-char MySQL credential (entropy 3.93).
- [Phase 84]: Plan 84-01 — Word-boundary exemption: sub-30-char tokens containing `-`/`_`/space are NOT secrets (compound identifiers). Real credentials at that length are opaque runs with no word boundaries.
- [Phase 84]: Plan 84-01 — finmentum-crm secret-scan HARD GATE working: refused at SKILL.md:20 with reason=high-entropy. MySQL credentials must move to MCP env / op:// refs before plan 02 can migrate this skill.
- [Phase 84]: Plan 84-02 — Transformer adds frontmatter to tuya-ac ONLY; other P1 skills (frontend-design, new-reel, self-improving-agent) preserved byte-for-byte. hasFrontmatter regex permits empty-body frontmatter (---\n---\n) via optional middle group.
- [Phase 84]: Plan 84-02 — Copier filter drops .git/ + SKILL.md.{backup,pre,pre-fix,pre-restore}-* editor snapshots. Hash witness SELECTIVELY skips SKILL.md when transformSkillMd actually changed the content (expected rewrite).
- [Phase 84]: Plan 84-02 — Linker verifier is READ-ONLY (does not call linkAgentSkills). Replicates catalog.has(name) resolution check so dry-run validation cannot poison real symlinks on failure. Emits per-(agent,skill) status: linked / missing-from-catalog / scope-refused / not-assigned.
- [Phase 84]: Plan 84-02 — SCOPE_TAGS map v2.2-LOCKED with 5 P1 entries; unknown skills default to fleet (max-permissive). Agent families: fin- prefix → finmentum; clawdy/jas → personal; everything else → fleet. --force-scope bypasses gates.
- [Phase 84]: Plan 84-02 — Learnings import source=manual (MemoryStore CHECK constraint); tags=[learning,migrated-from-openclaw]; origin_id=openclaw-learning-<sha256-of-trimmed-content-prefix-16>. Two-layer idempotency: tag+content dedup + MemoryStore UNIQUE(origin_id) partial index (Phase 80 MEM-02).
- [Phase 84]: Plan 84-02 — CLI exit 1 on ANY of: secret-scan refusal, copy-failed bucket, missing-from-catalog verification. Scope-refused alone does NOT flip exit 1 — operator decision via --force-scope.
- [Phase 84]: Plan 84-03 — Report writer source_integrity_sha = sha256(sorted unique ledger source_hash values joined by \n); excludes 'verify-only' synthetic hashes from Plan 02 verify rows.
- [Phase 84]: Plan 84-03 — Source-tree-readonly invariant sampled BEFORE discovery (not just before copy) so external-actor drift is caught alongside fs-guard's own-write protection. Three-state: verified/mtime-changed/unchecked with explicit unchecked fallback on lstat failure.
- [Phase 84]: Plan 84-03 — Verify-action rows excluded from per-skill verdict derivation in deriveLatestStatus; their status field encodes linker outcome not migration outcome. Prevents finmentum-crm appearing as 'migrated' when a verify row would override its refused apply row.
- [Phase 84]: Plan 84-03 — Report overwritten on EVERY apply (not just first apply). Atomic temp+rename (mkdir recursive + writeFile .tmp + rename + best-effort tmp cleanup on failure) matches Phase 82 report-writer.ts discipline.
- [Phase 85]: Plan 85-01 — `mcpServerSchema.optional` is additive with default `false` (mandatory). v2.1 migrated configs parse unchanged; all 5 auto-injected servers (clawcode/1password/browser/search/image) explicitly declared `optional:false` in loader.ts so the infra stack stays mandatory by construction.
- [Phase 85]: Plan 85-01 — `performMcpReadinessHandshake` is a PURE module (no logger, no state) so warm-path gate + mcp-reconnect heartbeat share one regression lane. TOOL-04 verbatim-pass-through of JSON-RPC error messages pinned by `mcp: <name>: <raw transport error>` character-for-character assertion in readiness.test.ts.
- [Phase 85]: Plan 85-01 — CheckStatus uses project-standard `healthy|warning|critical` vocabulary (NOT plan's draft `ok|warn|critical`) — integrates with existing context-fill/auto-linker/thread-idle checks without a schema fork.
- [Phase 85]: Plan 85-01 — Heartbeat `mcp-reconnect` is NOT a reconnect driver. SDK owns MCP subprocess lifecycle and transparently reconnects; this check classifies + persists state (ready→degraded→failed→reconnecting→ready) and fuels /clawcode-tools + prompt-builder consumers.
- [Phase 85]: Plan 85-01 — `failureCount` bounded with 5-min backoff-reset window (grows monotonically within window, recycles to 1 after). Gives operators a "recently-flapping" signal via /clawcode-tools without an unbounded counter.
- [Phase 85]: Plan 85-01 — SessionHandle gets getMcpState/setMcpState mirror (sync'd at warm-path + every heartbeat tick) so TurnDispatcher-scope consumers (Plan 02 prompt-builder, Plan 03 slash commands) avoid reaching into SessionManager's private maps.
- [Phase 85]: Plan 85-01 — New IPC `list-mcp-status` returns shape `{agent, servers: [{name, status, lastSuccessAt, lastFailureAt, failureCount, optional, lastError:string}]}` — canonical feed for Plan 03's /clawcode-tools slash command.
- [Phase 85]: Plan 85-02 — Preauth statement + verbatim-error rule land in STABLE PREFIX via sources.toolDefinitions (v1.7 two-block assembler). Eviction-proof through compaction per TOOL-07.
- [Phase 85]: Plan 85-02 — MCP_VERBATIM_ERROR_RULE stored as SINGLE-LINE string literal so the plan's static-grep pin finds one hit (multi-line concat would pass runtime tests but fail the source-grep verification).
- [Phase 85]: Plan 85-02 — Pitfall 12 (MCP config leak) closed by narrowing renderer's accepted shape to Pick<McpServerSchemaConfig, name> & optional?. Eight regression pins prevent command/args/env from re-entering the prompt surface.
- [Phase 85]: Plan 85-02 — Tools column hard-coded to U+2014 em dash in v2.2 (not tool names). Future q.mcpServerStatus() wire-up can populate without changing table shape — prompt-hash compatible migration.
- [Phase 85]: Plan 85-02 — mcpStateProvider is OPTIONAL on SessionConfigDeps; absent → empty Map → status 'unknown'. Preauth framing still lands and closes phantom-error class even before first heartbeat tick.
- [Phase 85]: Plan 85-03 — /clawcode-tools is CONTROL_COMMANDS (daemon-routed, zero LLM cost) with inline dispatch branch BEFORE generic handleControlCommand so the reply renders as EmbedBuilder (UI-01) instead of the text blob the generic dispatcher emits.
- [Phase 85]: Plan 85-03 — CLI command name collision: plan called for 'clawcode tools' but src/cli/commands/tools.ts is already Phase 55's tool-call latency command. Shipped as 'clawcode mcp-status' instead (parallels existing mcp-servers); Discord slash stays /clawcode-tools as planned (independent name space).
- [Phase 85]: Plan 85-03 — Pitfall 9 closure: pre-flight count assertion CONTROL_COMMANDS.length + DEFAULT_SLASH_COMMANDS.length <= 90 pins the Discord 100-per-guild cap. Current count post-Plan-03: 16/100. Pitfall 12 closure: neither UI surface exposes command/args/env — MCP env secrets can't leak through observability.
- [Phase 86]: Plan 86-01 — allowedModels additive schema (optional per-agent + default-bearing defaults). v2.1 migrated fleet parses unchanged; downstream always sees a concrete array via loader.ts resolution.
- [Phase 86]: Plan 86-01 — allowedModels classified RELOADABLE (Discord picker re-reads on invocation) but agents.*.model stays NON-reloadable. Runtime model swaps go through SessionHandle.setModel, not through a YAML hot-reload event.
- [Phase 86]: Plan 86-01 — SDK canary blueprint (Phase 83) applied verbatim to setModel: synchronous caller + fire-and-forget + .catch log-and-swallow. Pinned by 5 spy tests asserting toHaveBeenCalledWith(exact model id).
- [Phase 86]: Plan 86-01 — ModelNotAllowedError (typed) raised at SessionManager BEFORE SDK call; carries agent+attempted+allowed list so Discord slash / IPC error rendering needs no second round-trip.
- [Phase 86-dual-discord-model-picker-core]: Plan 86-02 — Retired 'Takes effect on next session' lie; IPC set-model now routes live SDK swap FIRST then atomic YAML persist; non-rollback on persistence failure (surface persisted:false + persist_error)
- [Phase 86-dual-discord-model-picker-core]: Plan 86-02 — Extracted handleSetModelIpc as pure exported helper from daemon.ts (DI'd). First application of pure-IPC-handler blueprint; Phase 87 setPermissionMode follows the same shape
- [Phase 86-dual-discord-model-picker-core]: Plan 86-02 — Extended ManagerError with optional {code, data}; IPC server.ts propagates. Typed ModelNotAllowedError surfaces as ManagerError w/ code=-32602 + data.allowed for Plan 03 ephemeral Discord error render (no second round-trip)
- [Phase 86-dual-discord-model-picker-core]: Plan 86-02 — updateAgentModel uses parseDocument AST + atomic temp+rename (Phase 78/81 reuse). 5 typed outcomes (updated/no-op/not-found/file-not-found/refused). Comment preservation + round-trip re-parse pinned
- [Phase 86-dual-discord-model-picker-core]: Plan 86-03 — /clawcode-model converted from LLM-prompt routing to native StringSelectMenuBuilder picker + direct IPC dispatch. PROJECT.md tech debt line 150 closed (zero 'Set my model to' live routings in src/).
- [Phase 86-dual-discord-model-picker-core]: Plan 86-03 — Extended IpcError with optional data field + ipc/client.ts propagation. Plan 02 wired the server side (ManagerError.data + ipc/server.ts forwarding) but IpcError constructor dropped .data at the client boundary. Without this Rule 3 blocking fix the 'model-not-allowed' typed-error branch never fires in production.
- [Phase 86-dual-discord-model-picker-core]: Plan 86-03 — MODEL-05 cache-invalidation confirmation uses native ButtonBuilder (Danger + Secondary) with agent+nonce namespaced customIds. Prefix-based filter (model-confirm:{agent}:) for collision safety across parallel picker invocations. 'Active conversation' signal via sessionManager.getModelForAgent !== undefined — zero-cost, biased toward showing confirmation.
- [Phase 86-dual-discord-model-picker-core]: Plan 86-03 — Inline handler short-circuit pattern + shared dispatch helper (dispatchModelChange with editMode flag). Arg-path and select-menu path funnel through the same IPC call + ModelNotAllowedError rendering. Blueprint for Phase 87 setPermissionMode + Phase 88 skills browser.
- [Phase 87-native-cc-slash-commands]: Plan 01 — Query.initializationResult chosen over supportedCommands: one round-trip covers Plan 02/03 needs (agents+models+commands); narrower supportedCommands kept available on the SdkQuery type for callers that only want the command list post-init.
- [Phase 87-native-cc-slash-commands]: Plan 01 — Classifier safe-default is prompt-channel for unknown SDK commands (CMD-00 spike basis); clear/export/mcp hard-coded to skip-set (mcp covered by Phase 85 /clawcode-tools, Pitfall 12).
- [Phase 87-native-cc-slash-commands]: Plan 01 — clawcode- namespace enforced by construction in buildNativeCommandDefs (Pitfall 10). Static-grep regression pin (readdirSync walk of src/) rejects any hardcoded native-command array literal in CI.
- [Phase 87-native-cc-slash-commands]: Plan 01 — SlashCommandDef.nativeBehavior discriminator (optional field) is the single routing signal for Plans 02/03 — no name-matching or secondary lookup table required. Also added aclDeniedByAgent DI hook for hermetic unit tests; production derives from <memoryPath>/SECURITY.md.
- [Phase 87-native-cc-slash-commands]: Plan 03 — buildNativePromptString strips clawcode- prefix idempotently (both 'clawcode-compact' and 'compact' yield '/compact'); args pass VERBATIM (no escape/quote — over-escaping breaks SDK arg passthrough); empty/whitespace args → no trailing space
- [Phase 87-native-cc-slash-commands]: Plan 03 — Dispatch-fork carve-out ordering in handleInteraction: clawcode-tools → clawcode-model → CONTROL_COMMANDS → prompt-channel → legacy agent-routed. Dedicated inline handlers always win over stray colliding prompt-channel entries (pinned by P4 test).
- [Phase 87-native-cc-slash-commands]: Plan 03 — Phase 85 TOOL-04 verbatim-error pattern applied at slash-command layer: editReply surfaces the ACTUAL SDK error text (err.message), not a generic blob. Solves phantom-error UX class for native-CC commands (pinned by P5 test).
- [Phase 87-native-cc-slash-commands]: Plan 03 — Zero new streaming primitive. ProgressiveMessageEditor reused verbatim from v1.7; dispatchNativePromptCommand substitutes TurnDispatcher.dispatchStream + buildNativePromptString for sessionManager.streamFromAgent + formatCommandMessage in the agent-routed flow. Origin = makeRootOrigin('discord', channelId) for trace stitching.
- [Phase 87]: Canary blueprint trio locked: Phase 83 + 86 + 87-02 share byte-identical synchronous setter + fire-and-forget + .catch wire shape with 5-test spy harness
- [Phase 87]: Permission mode is ephemeral/runtime-only (no YAML persistence) — matches /clawcode-effort precedent, diverges from /clawcode-model's atomic YAML write
- [Phase 87]: No per-agent permission allowlist; PermissionMode validation is the static 6-value union only (unlike setModel's per-agent allowedModels)
- [Phase 88-skills-marketplace]: Plan 88-01 — Three pure-function handoff contracts for Plan 02: loadMarketplaceCatalog (read-only unioned catalog), installSingleSkill (8-outcome discriminated-union installer), updateAgentSkills (atomic YAML writer mirroring Phase 86 MODEL-04). No daemon coupling required.
- [Phase 88-skills-marketplace]: Plan 88-01 — loadMarketplaceCatalog is HASH-FREE (no source hash computed at browse time); hash derivation deferred to installSingleSkill step 4 for idempotency gate. Keeps /clawcode-skills-browse responsive; one hash per install, not N hashes per browse.
- [Phase 88-skills-marketplace]: Plan 88-01 — fs-guard deliberately NOT installed in installSingleSkill (daemon-context writes only to skillsTargetDir + clawcodeYamlPath, neither under ~/.openclaw/). CLI-scoped guard would cascade into unrelated in-flight daemon tasks.
- [Phase 88-skills-marketplace]: Plan 88-01 — SkillInstallOutcome discriminated union with 8 distinct kinds (installed/installed-persist-failed/already-installed/blocked-secret-scan/rejected-scope/rejected-deprecated/not-in-catalog/copy-failed) enforces zero-silent-skip invariant (MKT-05) at the type system level. Plan 02's Discord renderer is an exhaustive switch.
- [Phase 88-skills-marketplace]: Plan 88-01 — computeSkillHash promoted to exported computeSkillContentHash (non-breaking rename+export); ledger writes on scope/secret-scan/copy-fail refusals (not on not-in-catalog or rejected-deprecated pre-gate refusals); non-rollback on YAML persist failure (mirrors Phase 86 Plan 02 MODEL-04).
- [Phase 88-skills-marketplace]: Plan 88-02 — Inline slash-handler short-circuit BEFORE CONTROL_COMMANDS now has 5 canonical applications across 4 phases (85/86/87/88). /clawcode-skills-browse + /clawcode-skills round out the pattern.
- [Phase 88-skills-marketplace]: Plan 88-02 — Exhaustive-switch outcome rendering (renderInstallOutcome) is a new canonical pattern for IPC handlers returning discriminated unions; TypeScript enforces MKT-05 zero-silent-skip at compile time for all 8 SkillInstallOutcome kinds.
- [Phase 88-skills-marketplace]: Plan 88-02 — Post-install hot-relink runs on {installed, installed-persist-failed, already-installed} only; remove does NOT rewire (stale symlink harmless, scanner re-reads at next boot).
- [Phase 88-skills-marketplace]: Plan 88-02 — Closure-based IPC intercept BEFORE routeMethod (same pattern as browser/search/image-tool-call). Keeps the 24-arg routeMethod signature stable; marketplace handlers close over daemon-local resolvedMarketplaceSources + skillsPath + ledgerPath + log.
- [Phase 89-agent-restart-greeting]: Plan 89-01 — Schema additions mirror Phase 86 MODEL-01 precedent: additive-optional agentSchema + default-bearing defaultsSchema + loader resolver + RELOADABLE_FIELDS. v2.1 fleet (15 agents) parses unchanged (regression pin).
- [Phase 89-agent-restart-greeting]: Plan 89-01 — restart-greeting.ts is 100% pure module: zero SessionManager import, zero webhook-manager.ts concrete-class import. All I/O (webhook sender, conversation store, summarizer, clock, logger, cool-down Map) DI'd via structural types so tests use plain-object stubs — no vi.mock of session internals.
- [Phase 89-agent-restart-greeting]: Plan 89-01 — Truncation uses U+2026 (single char) with slice(MAX_CHARS - 1) — produces exactly 500-char embed description. Plan's draft assumed '...' (3 chars) would overshoot; pinned by test P15 asserting toHaveLength(500).
- [Phase 89-agent-restart-greeting]: Plan 89-01 — ConversationReader surface uses real public API 'getTurnsForSession(sessionId, limit?)' — plan's draft 'getTurnsForSessionLimited' refers to private prepared statement. Source-of-truth correction.
- [Phase 89-agent-restart-greeting]: Plan 89-01 — 22 test fixtures across agent/bootstrap/config/discord/heartbeat/manager updated with greetOnRestart: true, greetCoolDownMs: 300_000 (Rule 3 blocking cascade — same pattern as Phase 86 allowedModels additive-required-field rollout).
- [Phase 90]: Plan 90-01 — Sixth application of Phase 83/86/89 additive-optional schema blueprint for memoryAutoLoad (agentSchema optional + defaultsSchema default true + RELOADABLE_FIELDS + loader resolver + configSchema literal). Zero behavior change for v2.1 migrated fleet.
- [Phase 90]: Plan 90-01 — MEMORY.md injected into identityStr (sources.identity) so the assembler places it in the stable prefix; order SOUL → IDENTITY → MEMORY → MCP pinned by MEM-01-C1 four-monotonic-indexOf test. 50KB cap enforced via Buffer.byteLength + Buffer.slice(50*1024).toString('utf8') + literal marker '…(truncated at 50KB cap)'.
- [Phase 90]: Plan 90-01 — Opt-out readFile-zero-call invariant (MEM-01-C3): when memoryAutoLoad=false, readFile is NEVER invoked against MEMORY.md path. Override path (MEM-01-C4): when memoryAutoLoadPath is set, workspace/MEMORY.md is NEVER read, even if override fails. Silent fall-through on missing file mirrors Phase 78 soulFile/identityFile.
- [Phase 90]: Plan 90-01 — Rule 3 blocking cascade: 22 test fixtures updated to populate memoryAutoLoad: true. Matches Phase 89 GREET-10 cascade (22 fixtures then, 22 fixtures now). Pattern now routine for each additive-required field rollout in v2.x.
- [Phase 90-04-clawhub-http-and-install-pipeline]: Plan 90-04 — ClawHub API shape confirmed via live probe (GET /api/v1/skills returns {items, nextCursor}); zero new npm deps (Node 22 fetch + execFile for tar instead of execa)
- [Phase 90-04-clawhub-http-and-install-pipeline]: Plan 90-04 — SkillInstallOutcome extended 8→11 variants (auth-required, rate-limited, manifest-invalid); exhaustive-switch enforcement preserved via compile-time never-check. Each variant carries the exact payload Discord renderer needs — no second IPC round-trip
- [Phase 90-04-clawhub-http-and-install-pipeline]: Plan 90-04 — ClawHub install pipeline reuses Phase 84 verbatim (secret-scan → normalize → scope → copy+hash → YAML persist → ledger) AFTER a download+extract staging step; staging dir ~/.clawcode/manager/clawhub-staging/<nanoid>/ cleaned in try/finally regardless of outcome (D-07)
- [Phase 90-04-clawhub-http-and-install-pipeline]: Plan 90-04 — marketplaceSources zod union: legacy variant OMITS kind (v2.2 back-compat preserved — regression pin HUB-SCH-2a); ClawHub variant REQUIRES kind: 'clawhub'. Loader narrows via presence of kind with a cast fallback for legacy (TS narrowing on absent keys is weaker than on present)
- [Phase 90]: Third atomic YAML writer (updateAgentMcpServers) mirrors updateAgentModel + updateAgentSkills with literal secret-scan guard on env values
- [Phase 90]: Sixth application of inline-handler-short-circuit pattern (/clawcode-plugins-browse AFTER /clawcode-skills BEFORE CONTROL_COMMANDS)
- [Phase 90]: Two-stage Modal flow for plugin install: picker→empty-configInputs install→Modal on config-missing→retry. Single-field case is 95% of plugins (API key / password)
- [Phase 90]: RRF k=60 + cosine top-20 + FTS top-20 as the hybrid retrieval shape (Cormack/Clarke canonical); path-weight ±0.2 applied post-fusion as additive tiebreaker
- [Phase 90]: Mutable-suffix injection via TurnDispatcher.augmentWithMemoryContext — <memory-context source=hybrid-rrf chunks=N> wrapper prefixed to user message; stable prefix (Plan 90-01 MEMORY.md auto-load) NEVER touched so v1.7 cache stability preserved
- [Phase 90]: Lazy-MemoryStore Proxy in daemon.ts — scanner constructed at boot but MemoryStore reference resolves on each chokidar event (after SessionManager.startAgent initMemory). Pattern now available for future daemon-boot-time-but-per-agent-resource constructors
- [Phase 90]: chokidar 5.x glob patterns silently no-op — watch memory/ directory recursively + filter via shouldIndexMemoryPath in handlers. ready-event await in scanner.start() pins the post-init race window closed
- [Phase 90]: Seventh application of the Phase 83/86/89 additive-optional blueprint (memoryRetrievalTopK/TokenBudget/ScannerEnabled). Pattern is now routine; each rollout strengthens the v2.x convention for extending agent config
- [Phase 90]: Per-agent scanner (Map<string, MemoryScanner>) mirrors SessionManager per-agent resource pattern; setMemoryScanner DI shape mirrors Phase 89 setWebhookManager exactly — 5th application of post-construction DI mirror pattern
- [Phase 90]: Device-code OAuth over web-redirect (D-02 Claude's Discretion): ClawCode daemon is headless, no HTTPS callback surface
- [Phase 90]: Two-pass fuzzy matcher (substring containment first, Levenshtein ≤ 3 second) + first-word tokenization on both label and field-name sides for op:// rewrite
- [Phase 90]: Module-namespace imports (import * as mod) in install-plugin.ts + daemon.ts to enable vi.spyOn without breaking ESM live bindings
- [Phase 90]: Long-lived IPC (clawhub-oauth-poll, up to 15min) without client-side timeoutMs — daemon handler self-terminates at expires_at
- [Phase 90]: [Phase 90 Plan 03]: MemoryFlushTimer per-agent timer separate from existing Gap 3 flushTimers map (distinct concerns: markdown disk vs SQLite memories); memoryFileFlushTimers naming prevents name clash
- [Phase 90]: [Phase 90 Plan 03]: flushNow() declared NON-async so concurrent callers receive the EXACT same inFlight Promise instance (toBe-referential equality); async wrapper would mint fresh Promise on every call, breaking dedup
- [Phase 90]: [Phase 90 Plan 03]: discordReact signature is ({channelId, messageId}, emoji) not (messageId, emoji) — discord.js requires channel.messages.fetch first; channelId threaded through DispatchOptions
- [Phase 90]: [Phase 90 Plan 03]: Fourth fire-and-forget canary application (after 83/86/87/89); cue write + Discord reaction + subagent capture ALL use void fn().catch(log.warn)
- [Phase 90]: [Phase 90 Plan 03]: atomicWriteFile exported from memory-flush.ts and reused by memory-cue.ts + subagent-capture.ts — one implementation, one unlink-on-rename-fail discipline, one nanoid-suffixed tmp path
- [Phase 90-clawhub-marketplace-fin-acquisition-memory-prep]: Plan 90-07 — fourth atomic YAML writer (updateAgentConfig) generalizes updateAgentModel+Skills+McpServers to a Partial<AgentConfig> patcher with schema-validated merge + recursive literal secret scan + JSON-stable idempotency
- [Phase 90-clawhub-marketplace-fin-acquisition-memory-prep]: Plan 90-07 — agentSchema.heartbeat extended z.boolean() → z.union([z.boolean(), {enabled?, every?, model?, prompt?}]) to support OpenClaw-style 50m heartbeat shape for fin-acquisition; v2.1 migrated fleet parses unchanged
- [Phase 90-clawhub-marketplace-fin-acquisition-memory-prep]: Plan 90-07 — fin-acquisition channel binding INTENTIONALLY unchanged; operator-initiated OpenClaw→ClawCode cutover documented in .planning/migrations/fin-acquisition-cutover.md (9 sections, operator-executable)
- [Phase 90-clawhub-marketplace-fin-acquisition-memory-prep]: Plan 90-07 — HEARTBEAT.md content (1622 bytes) read verbatim from ~/.openclaw/workspace-finmentum/HEARTBEAT.md at apply time; AUTO-RESET: DISABLED directive + zone thresholds + snapshot template preserved byte-for-byte
- [Phase 90-clawhub-marketplace-fin-acquisition-memory-prep]: Plan 90-07 — verifyAgentWebhookIdentity uses pre-check-then-delegate pattern (peek fetchWebhooks before provisionWebhooks delegate) so return shape distinguishes verified vs provisioned; daemon-boot probe fire-and-forget
- [Phase 91]: Plan 91-01 — sync-runner uses node:child_process.execFile (not execa — not in package.json); matches marketplace/clawhub-client.ts pattern. Zero new npm deps preserved (v2.2 discipline extended to v2.4).
- [Phase 91]: Plan 91-01 — SuccessExitStatus=1 in systemd service so graceful-SSH-fail + flock-skip exits don't pollute journalctl; real bugs (exit 2+) still surface.
- [Phase 91]: Plan 91-01 — Regression guard in syncOnce throws if .sqlite/sessions/ paths leak into rsync touchedPaths; fail loud, not silent data leak. Filter file pins 13 exclude patterns as first defense.
- [Phase 91]: Plan 91-01 — DEFAULT_SYNC_JSONL_PATH exported alongside DEFAULT_SYNC_STATE_PATH so Plan 91-05 imports canonical path instead of re-deriving homedir join.
- [Phase 91]: Plan 91-03 — Idempotency via existing UNIQUE(session_id, turn_index, role) on conversation_turns (idx_turns_session_order), NOT a new origin_id UNIQUE column. Translator uses INSERT OR IGNORE via new ConversationStore.getDatabase() accessor; origin-id string stored in existing 'origin' TEXT column for human traceability.
- [Phase 91]: Plan 91-03 — Deterministic computeClawcodeSessionId(openclawSessionId)=openclaw-<sha256-20> as conversation_sessions PK so re-runs converge on one row per OpenClaw session uuid; session rows imported with status='ended' so Phase 67 SESS-03 gap-check sees them as terminated.
- [Phase 91]: Plan 91-03 — Remote→local via rsync staging (bash wrapper step 1) rather than SSH-per-file in translator. Keeps translator pure-function + testable without SSH; staging dir ~/.clawcode/manager/openclaw-sessions-staging/ is read-only from translator's perspective. Hourly timer distinct from 91-01's 5-min workspace sync per D-07.
- [Phase 91]: 91-02: Safer reading of D-11 — ANY destHash drift is a conflict (never silently clobber operator edits)
- [Phase 91]: 91-02: Per-FILE --exclude rsync args preserve non-conflicting propagation in same cycle (D-12)
- [Phase 91]: 91-02: Stateless re-alert (D-15) — fire embed every cycle with conflicts, no path-level suppression
- [Phase 91]: Plan 91-04 complete: clawcode sync CLI group with 8 subcommands, drain-then-flip cutover, 7-day rollback window. SYNC-09 and SYNC-10 done.
- [Phase 91]: Plan 91-06 — Runbook appended with 5 Phase 91 sections (SSH provisioning, systemd install, cutover flip, 7-day rollback, operator-observable logs) under  heading; Phase 90-07 content preserved verbatim (RUN-SYNC-08 regression pin).
- [Phase 91]: Plan 91-06 — Rule 1 fix: filter file memory/ rules amended with `+ /memory/*.md` (direct children) and `+ /memory/**/` (intermediate-dir descent). Original `+ /memory/**/*.md` alone missed both in rsync 3.2 (zero-path-component `**` semantic), which would have silently dropped OpenClaw's dated memory flushes (memory/YYYY-MM-DD-slug.md). All 37 existing 91-01 tests still pass after the fix.
- [Phase 91]: Plan 91-06 — Zero new npm deps discipline preserved. Plan's test-file draft referenced execa; substituted node:child_process.execFile via promisify with non-zero-exit-tolerant wrapper (matches src/sync/sync-runner.ts:540 defaultRsyncRunner + src/marketplace/clawhub-client.ts patterns).
- [Phase 91]: Plan 91-06 — Exclude-filter test uses both static assertions (REG-EXCL-01/02 read filter file directly) AND behavioral assertions (REG-EXCL-03..08 run real rsync against synthetic workspace with dry-run itemize parsing + real-sync destination filesystem access checks). REG-EXCL-09 control probe prevents vacuous-pass scenarios. 9 tests total (plan wanted ≥6).
- [Phase 91]: 91-05: Colour vocabulary reuses Phase 91-02 CONFLICT_EMBED_COLOR=15158332 for red — conflict-alert embed + status embed speak the same visual language
- [Phase 91]: 91-05: /clawcode-sync-status is fleet-level (no agent option) — reads singleton sync-state.json; per-agent arg deferred to Phase 92+ fleet-wide sync
- [Phase 91]: 91-05: Conflict field cap at 25 with explicit '… N more conflicts' terminal marker — honest cap indicator, not silent ceiling (diverges from 91-02 alerter's silent slice)
- [Phase 92]: Plan 92-01: Mission Control REST API as PRIMARY corpus (D-11 amendment); bearer-token sourced from env MC_API_TOKEN ONLY at CLI surface, NEVER logged or in error strings (sanitizeError + status/statusText-only error classification)
- [Phase 92]: Plan 92-01: 503 'Failed to connect to OpenClaw Gateway' graceful in --source both (skip+continue), fatal in --source mc; cursor-driven incremental rerun via mc-cursor.json with monotonic lastUpdatedAt advance even on no-changes
- [Phase 92]: Plan 92-01: Source profiler reads N JSONL paths (mc + discord union) with origin-discriminated dedup; cron-prefixed intents preserved through merge — Phase 47 cron parity surfaces in canary battery distinct from user-initiated intents
- [Phase 92]: Plan 92-01: SQLite direct-read fallback (mission-control.db via SSH) DEFERRED to Phase 93+; pure REST API only this plan (regression-pinned by ! grep -rE 'mission-control.db' src/cutover/)
- [Phase 92]: Plan 92-02: CutoverGap typed discriminated union with EXACTLY 9 kinds (5 additive + 4 destructive); D-11 adds cron-session-not-mirrored. Pinned by D-EXHAUSTIVE compile-time switch + assertNever witness — adding a 10th kind fails the TypeScript build until 92-03/04/06 consumers update.
- [Phase 92]: Plan 92-02: diff-engine.ts is PURE (no fs, no clock, no env, no Math.random); target-probe.ts is DI-pure (loadConfig + listMcpStatus + readWorkspaceInventory all injected). Static-grep pins enforce both.
- [Phase 92]: Plan 92-02: NO-LEAK invariant — probe extracts MCP env KEY NAMES via Object.keys(entry.env). Values never read or serialized. PR5 test pins via sk_live_secret_42 sentinel. Field-by-field YAML extraction (no spread on env objects).
- [Phase 92]: Plan 92-02: TargetCapability.yaml.sessionKinds[] derived from agent.schedules presence (empty → [direct]; non-empty → [direct, scheduled]). Cron-entry detection lives in target.sessionKinds.includes('cron') — v1 emits without 'cron' so D-11 cron gaps surface end-to-end against any MC profile carrying cron-prefixed intents.
- [Phase 92-openclaw-clawcode-fin-acquisition-cutover-parity-verifier]: Plan 92-03: append-only cutover-ledger.jsonl mirrors Phase 82 invariants verbatim — validate-on-write (zod safeParse before mkdir+appendFile), no truncate/clear/rewrite helpers, appendFile-only (no read-modify-write race)
- [Phase 92-openclaw-clawcode-fin-acquisition-cutover-parity-verifier]: Plan 92-03: AdditiveApplierDeps DI-pure shape mirrors Plan 92-04 destructive applier blueprint; Phase 84/86/91 primitives all injected; CLI wrapper iterates Phase 86 updateAgentSkills(op:add) per skill (writer takes one at a time) — idempotency-safe via no-op return
- [Phase 92-openclaw-clawcode-fin-acquisition-cutover-parity-verifier]: Plan 92-03: missing-mcp 5th additive kind routed to deferred-with-reason ledger entry (operator must add op:// refs via /clawcode-plugins-browse) — applier never auto-mutates MCP credential surface
- [Phase 92-openclaw-clawcode-fin-acquisition-cutover-parity-verifier]: Plan 92-03: secret-scan ordering pin (A2 test) — scanSkillForSecrets called BEFORE runRsync for missing-skill; refusal terminal-short-circuits the entire applier (operator must move secrets before re-running)
- [Phase 92-openclaw-clawcode-fin-acquisition-cutover-parity-verifier]: Plan 92-03: dry-run is the DEFAULT at the wrapper layer (apply: false → no writes, no ledger). --apply opt-in per D-07 three-tier safety; preChangeSnapshot field reserved for D-10 destructive reversibility (Plan 92-04 populates)
- [Phase 92]: Plan 92-04: customId namespace 'cutover-' reserved (D2 collision regression pins 9 existing prefixes); preChangeSnapshot capture order fixed (read→gz+b64→rsync→ledger); 64KB threshold; non-file destructive kinds emit audit-only ledger rows per D-06 propose-and-confirm
- [Phase 93]: Plan 93-01 — pure renderStatus(buildStatusData) module shipped: 9-line OpenClaw-parity output with unknown/n/a placeholders for ClawCode-only gaps; Pitfall 6 closure via tryRead-wrapped accessors at the StatusData boundary; date-fns/formatDistanceToNow reused (zero new deps).
- [Phase 93]: Plan 93-01 — Existing slash-commands-status-effort.test.ts 'Failed to read status' assertion was rewritten as the Pitfall 6 closure pin; the new contract is defensive-read collapses to 'Think: unknown' / 'Permissions: unknown' placeholders, never the legacy error path.
- [Phase 92]: Plan 92-05: CANARY_TIMEOUT_MS=30_000 + CANARY_CHANNEL_ID=1492939095696216307 (recently-freed fin-test channel) + CANARY_API_ENDPOINT=http://localhost:3101/v1/chat/completions; 20 prompts × 2 paths = 40 invocations per run; passRate >= 100 hard precondition for Plan 92-06 set-authoritative gate
- [Phase 92]: Plan 92-05: dispatchStream + fetchApi DI'd via CanaryRunnerDeps; Promise.race + setTimeout sentinel for 30s per-path timeout; sentinel string '__canary_timeout__' for collision-resistant discrimination; clearTimeout in finally for clean event-loop drain
- [Phase 92]: Plan 92-05: Synthesizer + runner determinism via spread-then-sort; results sorted by (intent ASC, path ASC); CANARY-REPORT.md frontmatter pinned: agent + generated_at + total_prompts + total_paths + total_invocations + passed + failed + canary_pass_rate (rounded to 1dp); Plan 92-06's set-authoritative reads canary_pass_rate
- [Phase 92]: Plan 92-05: Default fetchApi (Node 22 native fetch + OpenAI choices[0].message.content extraction with raw-body fallback) lives in src/cli/commands/cutover-canary.ts so canary-runner.ts stays purely DI'd. Loopback-only API; only http://localhost:3101 references are JSDoc comments. Zero new npm deps preserved
- [Phase 92]: Plan 92-06: Capstone wire-up — runVerifyPipeline 7-phase sequential orchestrator (DI'd) + writeCutoverReport atomic temp+rename with literal end-of-doc 'Cutover ready: true|false' line + Phase 91 sync-set-authoritative precondition gate (REPORT_FRESHNESS_MS=24h) + --skip-verify --reason emergency bypass appending action='skip-verify' audit row to cutover-ledger.jsonl
- [Phase 92]: Plan 92-06: cutover_ready: true REQUIRES (gaps.length === 0 AND canaryResults !== null AND totalInvocations > 0 AND passRate === 100) — clean diff alone NOT cutover-ready (CUT-09 contract); literal end-of-doc line derived from same boolean as frontmatter so they always agree
- [Phase 92]: Plan 92-06: rollback idempotency via append-only NEW row with reason='rollback-of:<origTimestamp>' marker (ROLLBACK_OF_REASON_PREFIX exported); ledger never mutated/deleted; CLI scaffolds for cutover verify + rollback emit clear daemon-required error today (precedent from cutover-canary), full daemon-IPC wiring deferred to follow-up plan
- [Phase 93]: Plan 93-02 — eighth additive-optional opt-in field application (defaultClawhubBaseUrl on LoadMarketplaceCatalogOpts + MarketplaceIpcDeps); Pitfall 4 closure preserved zero test fixture cascade.
- [Phase 93]: Plan 93-02 — auto-inject branch never mutates opts.sources; new sourcesArr clone with frozen synthetic clawhub source pushed when defaultClawhubBaseUrl set AND no explicit kind:'clawhub' present (back-compat byte-identical to today).
- [Phase 93]: Plan 93-02 — sentinel-value pattern for non-installable Discord StringSelectMenu options (CLAWHUB_DIVIDER_VALUE filter at chosen-equality before marketplace-install IPC). discord.js 14.x has no setDisabled on options; sentinel + filter is the canonical workaround.
- [Phase 93]: Plan 93-02 — divider gating: clawhubSide.length > 0 AND remainingSlots >= 2 (Pitfall 2/3 closure — divider never renders alone; never the terminal option after 25-cap).
- [Phase 93]: Plan 93-03 — ClawhubManifestNotFoundError is a sibling (not subclass) of ClawhubManifestInvalidError. Subclassing would defeat the differentiation purpose; instanceof checks must distinguish 404 from malformed-body errors.
- [Phase 93]: Plan 93-03 — daemon.ts:1116-1118 fallback URL construction deliberately UNCHANGED per RESEARCH §Pitfall 5 (13-URL probe table confirmed every shape returns 404 for unpublished plugins like hivemind; the registry is the source of truth, not the URL shape). Pinned by DPM-93-1 regression test.
- [Phase 93]: Plan 93-03 — PluginInstallOutcome union grows 10 → 11 variants (manifest-unavailable). Eleventh exhaustive-switch application of the Phase 88 MKT-05 / Phase 90 Plan 05 pattern; TypeScript never branch enforces completeness across PluginInstallOutcome + PluginInstallOutcomeWire + renderPluginInstallOutcome at compile time.
- [Phase 94]: 5-value CapabilityProbeStatus enum (ready|degraded|reconnecting|failed|unknown) locked at the contract layer (D-02); adding a 6th value cascades through Plans 94-02/03/04/07
- [Phase 94]: Capability probe is DI-pure: no SDK imports, no fs imports, no bare new Date() — primitive funnels Date construction through currentTime(deps) helper using integer-arg signature so static-grep regression pin holds
- [Phase 94]: Heartbeat layer runs probe with stub callTool (throws) + getProbeFor override forcing default-fallback; connect-ok → ready, connect-fail → failed mirror. Plan 94-03 lifts override and wires real callTool through SDK surface
- [Phase 94-tool-reliability-self-awareness]: Plan 94-04 — D-06 ToolCallError discriminated-shape contract landed: 5-value ErrorClass enum (transient|auth|quota|permission|unknown) locked at the contract layer with 12 literal occurrences pinned by static-grep; verbatim-message pass-through (Phase 85 TOOL-04 inheritance) preserved exact substring including Playwright sentinel error
- [Phase 94-tool-reliability-self-awareness]: Plan 94-04 — Classification regex priority order auth → quota → permission → transient → unknown: when 'HTTP 401 timeout' matches both auth and transient, auth wins because more specific class better signals what LLM should do; pinned by TCE-CLASS priority test
- [Phase 94-tool-reliability-self-awareness]: Plan 94-04 — TurnDispatcher integration via new public method executeMcpTool (single-source-of-truth wrap site) rather than refactoring iterateUntilResult: production MCP tool calls flow through SDK driverIter inside persistent session handle, not through any direct dispatcher method; new method gives Plan 94-05 (auto-injected tools) a wrap-route they can hit directly + provides seam for future direct-MCP-call sites
- [Phase 94-tool-reliability-self-awareness]: Plan 94-04 — Single-attempt-then-wrap (NO silent retry) inside dispatcher: recovery (Plan 94-03) is heartbeat-driven at the connection layer, NOT at the tool-execution layer; LLM sees structured failure and adapts naturally (asks user, switches to alternative agent) instead of silently retrying same bad call
- [Phase 94-tool-reliability-self-awareness]: Plan 94-04 — mcpStateProvider DI is additive-optional on TurnDispatcherOptions (Phase 86/89 schema-extension blueprint reused): when absent, ToolCallError.alternatives is undefined; existing tests without the field continue to pass; daemon edge wires the provider once SessionManager construction is touched in a follow-up plan
- [Phase 94]: Plan 94-02: 5min flap window + 3-transition threshold LOCKED at contract layer (FLAP_WINDOW_MS, FLAP_TRANSITION_THRESHOLD); pinned by static-grep. Lower threshold would block all recovery cycles.
- [Phase 94]: Plan 94-02: Conservative default for unknown / missing capabilityProbe — filter OUT, NOT pass-through. First-boot agents see zero MCP servers in their LLM tool table for the first 60s window until the heartbeat populates probe state. Don't advertise unproven tools.
- [Phase 94]: Plan 94-02: Single-source-of-truth filter call site at session-config.ts (NOT mcp-prompt-block.ts). Renderer stays pure; filter logic stays in one place. 4 inline static-grep regression tests pin the invariant.
- [Phase 94]: Plan 94-02: Failed/degraded servers FILTERED OUT entirely from LLM table — no row, no verbatim error in the prompt. Replaces pre-94 contract that surfaced lastError.message into the prompt (was a phantom-error vector). Operator-truth flows through /clawcode-tools + clawcode mcp-status (Phase 85 Plan 03).
- [Phase 94]: DI-purity over convenience: handlers + registry have ZERO node:child_process imports. Production wires real execFile/killSubprocess/adminAlert/opRead at heartbeat-tick edge in buildRecoveryDepsForHeartbeat (Phase 91 sync-runner pattern). Static-grep pin verifies on every commit.
- [Phase 94]: Bounded budget at the registry, not the handler. Per-server budget is global across all 3 handlers — Playwright fails 2x + op:// fails 1x means total budget exhausted. Operational intent: 'this server has been hammering recovery; back off'.
- [Phase 94]: 3rd-failure admin-clawdy alert counts give-up + retry-later as failures; not-applicable + recovered are not failures (no budget burn for not-applicable; recovered means system healed itself).
- [Phase 94-tool-reliability-self-awareness]: Plan 94-06 — TOOL-10 8th application of additive-optional schema blueprint: defaults.systemPromptDirectives default-bearing record (DEFAULT_SYSTEM_PROMPT_DIRECTIVES with verbatim D-09 file-sharing + D-07 cross-agent-routing) + agents.*.systemPromptDirectives optional partial override; v2.5 migrated configs parse unchanged (REG-V25-BACKCOMPAT).
- [Phase 94-tool-reliability-self-awareness]: Plan 94-06 — resolveSystemPromptDirectives: pure per-key merge (override?.field ?? defaults?.field), filter enabled && text !== ''; alphabetical sort + Object.freeze on output for prompt-cache hash stability + CLAUDE.md immutability invariant.
- [Phase 94-tool-reliability-self-awareness]: Plan 94-06 — Pre-rendered block in ContextSources (caller computes via resolver+renderer pair); assembler stays config-type-agnostic (no schema imports). Empty string short-circuits — stable prefix byte-identical to no-directives baseline (REG-ASSEMBLER-EMPTY-WHEN-DISABLED).
- [Phase 94-tool-reliability-self-awareness]: Plan 94-06 — RELOADABLE classification: agents.*.systemPromptDirectives + defaults.systemPromptDirectives both reloadable at next-turn boundary (assembler reads via resolver each turn). No daemon restart for directive edits.
- [Phase 94-tool-reliability-self-awareness]: Plan 94-05 — clawcode_fetch_discord_messages + clawcode_share_file built-in tools auto-injected for every agent in session-config.ts toolDefinitionsStr; NO mcpServer attribution (Plan 94-02 capability filter sees them as built-in, never removes); 100-msg fetch clamp + 25MB share cap + allowedRoots security boundary + webhook→bot-direct fallback (Phase 90.1); failures wrap via 94-04 ToolCallError; DI-pure (no fs/discord.js imports in tool modules)
- [Phase 94]: Daemon-side computation of cross-agent alternatives — IPC payload is single source of truth, both renderers consume the same enriched payload
- [Phase 94]: Shared probe-renderer.ts module pattern — pure helpers (buildProbeRow / paginateRows / recoverySuggestionFor / STATUS_EMOJI) consumed by /clawcode-tools (Discord) AND clawcode mcp-status (CLI); cross-renderer parity test pins content equivalence
- [Phase 95]: [Phase 95]: Plan 95-01 — DreamPassOutcome 3-variant union (completed | skipped | failed) LOCKED — pinned by kind: z.literal count regression test
- [Phase 95]: [Phase 95]: Plan 95-01 — Token estimation via chars/4 heuristic; oldest-first chunk truncation drops tail after DESC sort until estimate ≤ 32K
- [Phase 95]: [Phase 95]: Plan 95-01 — Dream-pass primitive does NOT consult lastTurnAt — idle gating belongs to cron timer (Plan 95-02); manual triggers (CLI/Discord 95-03) bypass idle gating intentionally
- [Phase 95]: [Phase 95]: Plan 95-01 — Idle-detector hard floor 5min + hard ceiling 6h LOCKED at module-constant level (IDLE_HARD_FLOOR_MS/IDLE_HARD_CEILING_MS); per-agent dream.idleMinutes cannot override floor
- [Phase 95]: [Phase 95]: Plan 95-01 — MemoryChunk + ConversationSummary shapes decoupled from canonical SQLite-row types — narrow DI getter contracts kept independent so dream-pass schema evolves freely
- [Phase 95]: [Phase 95]: Plan 95-01 — 9th application of additive-optional schema blueprint: agents.*.dream + defaults.dream — v2.5/v2.6 migrated configs parse unchanged; both registered in RELOADABLE_FIELDS
- [Phase 95]: Plan 95-02: same-day dream-log files APPEND new ## sections (not overwrite); preserves prior passes byte-for-byte
- [Phase 95]: Plan 95-02: writeDreamLog failure does NOT roll back applyAutoLinks; wikilinks persisted on best-effort, structured error surfaces missing log to operator
- [Phase 95]: Plan 95-02: created src/manager/dream-cron.ts (mirroring daily-summary-cron.ts) instead of modifying non-existent src/manager/agent-bootstrap.ts; daemon-edge wiring deferred to Plan 95-03
- [Phase 95]: Plan 95-03 — Admin-gate-FIRST ordering: isAdminClawdyInteraction fires BEFORE deferReply so non-admins receive instant ephemeral 'Admin-only command' (zero IPC + zero LLM + zero log noise). Fail-closed default (empty adminUserIds → no admins recognized).
- [Phase 95]: Plan 95-03 — CLI exit-code 0/1/2 contract: 0=completed, 1=failed/IPC-error, 2=skipped. Operator scripts can branch on exit code without parsing JSON. Mirrors Phase 91/92 sync/cutover CLI patterns; extends with 2-for-skipped semantic.
- [Phase 95]: Plan 95-03 — Discord slash defaults idleBypass:true; CLI defaults idleBypass:false. Operator-driven Discord trigger semantically wants to fire; CLI requires explicit opt-in. Both share the daemon's run-dream-pass IPC handler — only the call-site contract differs.
- [Phase 95]: Plan 95-03 — 10th application of inline-handler-short-circuit-before-CONTROL_COMMANDS pattern (Phases 85/86/87/88/90/91/92/95) and 5th application of pure-IPC-handler blueprint (handleSetModelIpc / handleSetPermissionModeIpc / mcp-probe / handleCutoverButtonActionIpc / handleRunDreamPassIpc). Pattern is now canonical for operator-tier slash commands.
- [Phase 96]: [Phase 96 Plan 06] 3-value Zod enum extension for authoritativeSide (openclaw|clawcode|deprecated) — additive non-breaking schema migration; v2.4 fixtures parse unchanged.
- [Phase 96]: [Phase 96 Plan 06] DEPRECATION_ROLLBACK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000 ms locked at types.ts level; pinned by grep -F (W-2 convention robust to regex meta-chars in arithmetic literals).
- [Phase 96]: [Phase 96 Plan 06] Asymmetric systemctl-vs-state-update ordering — disable-timer: state-first (graceful systemctl); re-enable-timer: systemctl-first (fatal — rollback semantics demand timer running before claiming state restored).
- [Phase 96]: [Phase 96 Plan 06] sync run-once exit code 2 (NOT 1) when deprecated — bypasses systemd SuccessExitStatus=1, forces journalctl to surface deprecation as failed unit (operator attention).
- [Phase 96]: [Phase 96 Plan 06] State-machine guard at CLI layer (not runtime gate): deprecated → clawcode forward-cutover refused with operator-actionable error; operator must re-enable-timer or fresh setup before forward-cutover.
- [Phase 96]: Plan 96-01: 3-value FsCapabilityStatus enum (ready|degraded|unknown) intentionally diverges from Phase 94's 5-value MCP enum because filesystem capability has no reconnect/failed analog — operator-driven ACL changes don't transition through transient connect states
- [Phase 96]: Plan 96-01: D-06 boundary check (checkFsCapability) uses exact-match canonical-absPath Map lookup with NO startsWith — ACLs grant per-subtree access so a parent ready snapshot does NOT imply subtree readability; Phase 94 isPathInsideRoots startsWith pattern intentionally avoided
- [Phase 96]: Plan 96-01: fileAccess Zod schema is 10th additive-optional application (Phase 83/86/89/90/94 blueprint). Schema preserves literal {agent} token; loader resolveFileAccess(agentName, ...) substitutes at call time. v2.5 fixtures parse unchanged (5 fixtures regression-pinned)
- [Phase 96]: Plan 96-01: SessionHandle gains FsCapabilitySnapshot lazy-init mirror (getFsCapabilitySnapshot/setFsCapabilitySnapshot) — 6th application of post-construction DI mirror pattern (after McpState/FlapHistory/RecoveryAttemptHistory/SupportedCommands/ModelMirror). Stable Map identity contract matches Phase 85 exactly
- [Phase 96]: Plan 96-01: TS error count REDUCED net 13 (101 → 88) by sweeping up Phase 95's missing dream field while adding fileAccess to test fixtures (Rule 3 cascade pattern matches Phase 89 GREET-10 + Phase 90 MEM-01 precedent)
- [Phase 96]: Plan 96-02: Renderer at the daemon edge, NOT inside the assembler. Pre-rendered string threaded through ContextSources.filesystemCapabilityBlock additive optional field — preserves assembler purity (Phase 94 D-10 systemPromptDirectives idiom).
- [Phase 96]: Plan 96-02: <tool_status></tool_status> and <dream_log_recent></dream_log_recent> are positioning sentinels with EMPTY bodies — they wrap NO content today; render ONLY when fs block renders, preserving v2.5 cache-stability invariant.
- [Phase 96]: Plan 96-02: STRICT empty string on empty snapshot (W-4 ambiguity removed). v2.5 fixtures without fileAccess produce byte-identical stable prefix on Phase 96 deploy.
- [Phase 96]: Plan 96-02: Flap-stability constants reused by NAME from Phase 94 plan 02 (FS_FLAP_WINDOW_MS = 5*60*1000, FS_FLAP_TRANSITION_THRESHOLD = 3) — cross-domain consistency between tools and filesystem capabilities.
- [Phase 96-discord-routing-and-file-sharing-hygiene]: Phase 94 5-value ErrorClass enum NOT extended in 96-03. clawcode_list_files maps boundary refusal → 'permission'; depth/entries/size/missing → 'unknown' with rich suggestion. Pin established for 96-04 (share-file) which will face the same choice.
- [Phase 96-discord-routing-and-file-sharing-hygiene]: Auto-injection site verified at src/manager/session-config.ts:421-440 (NOT non-existent agent-bootstrap.ts per RESEARCH.md Pitfall 1). 96-03 wires clawcode_list_files as the third built-in tool alongside Phase 94 plan 05's two.
- [Phase 96]: [96-04] Phase 94 5-value ErrorClass enum LOCKED — D-12 4-class taxonomy (size/missing/permission/transient) maps onto existing 5 values via classifyShareFileError; size/missing → unknown with rich suggestion; permission/transient verbatim. NO enum extension.
- [Phase 96]: [96-04] outputDir runtime expansion (NOT loader) — loader returns literal template; runtime resolveOutputDir expands per-call with fresh ctx. Loader-time expansion would freeze {date} at config-load time.
- [Phase 96]: [96-04] D-10 directive text BOTH blocks — file-sharing directive contains auto-upload heuristic AND OpenClaw-fallback prohibition (added 2026-04-25 after operator surfaced anti-pattern in #finmentum-client-acquisition).
- [Phase 96]: [96-04] Sibling pure detectors with DISTINCT dedup keys — detectMissedUpload + detectOpenClawFallback throttle independently via 'missed-upload' vs 'openclaw-fallback' keys; sibling try/catch isolation in firePostTurnDetectors so one detector failure cannot prevent the other.
- [Phase 96]: Plan 96-05: Status emoji palette LOCKED ✓/⚠/? (NOT ✅/❌ from Phase 85) — filesystem has no failed/reconnecting analog so simpler 3-symbol palette suffices and reads cleaner in monospace CLI; pinned across Discord slash, status-render, probe-fs CLI, fs-status CLI
- [Phase 96]: Plan 96-05: Cap-budget invariant (Phase 85 Pitfall 9 — Discord 100/guild cap) pinned via vitest PFS-CAP-BUDGET assertion replacing fragile runtime grep on compiled JS — TDD-friendly, runs every test pass even when no compiled JS exists
- [Phase 96]: Plan 96-05: Daemon IPC handlers extracted as pure-DI module (src/manager/daemon-fs-ipc.ts) — handleProbeFsIpc + handleListFsStatusIpc tested in isolation without spawning the full daemon; mirrors Phase 92 daemon-cutover-button-action discipline; closure-based intercept BEFORE routeMethod preserves stable routeMethod signature
- [Phase 96-discord-routing-and-file-sharing-hygiene]: fs-probe heartbeat check shape = per-agent execute(ctx) (Phase 85 mcp-reconnect mirror, NOT plan example tick(deps))
- [Phase 96-discord-routing-and-file-sharing-hygiene]: Reload dispatch = simpler heartbeat-tick fallback (RELOADABLE_FIELDS classification + 60s tick); watcher.ts NOT extended for v1
- [Phase 96-discord-routing-and-file-sharing-hygiene]: D-01 boot probe APPROXIMATED via TWO-STEP coverage (deploy-runbook Section 4 mandatory fleet probe + first 60s heartbeat tick); no separate session-start probe code path
- [Phase 100-01]: Apply .min(1) on settingSources array (RESEARCH.md Pitfall 3 — empty array silently disables ALL filesystem settings)
- [Phase 100-01]: settingSources at ResolvedAgentConfig is ALWAYS populated (defaults to ['project']); gsd is conditional (undefined-when-unset)
- [Phase 100-01]: Cascade fix: 22 test fixtures got settingSources line after memoryCueEmoji (matches Phase 89/90/96 22-fixture pattern)
- [Phase 100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow]: Plan 100-03 — settingSources + gsd.projectDir classified NON_RELOADABLE (agent-restart-required). 1st application of agent-restart classification in Phase 100; mirrors v2.5 SHARED-01 memoryPath documentation-of-intent pattern. Watcher untouched (Phase 22 reloadable=false contract already correct). DI8 regression pin defends against accidental future promotion to RELOADABLE_FIELDS.
- [Phase 100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow]: Plan 100-03 — Plan 08 SMOKE-TEST runbook hand-off: operator MUST run 'clawcode restart admin-clawdy' after editing settingSources or gsd.projectDir in clawcode.yaml; the watcher emits agent-restart-needed signal but does NOT auto-restart. NOT a daemon restart (would unnecessarily bounce the entire fleet).
- [Phase 100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow]: Plan 02 — symmetric-edits Rule 3 enforced for createSession + resumeSession baseOptions; SA5..SA8 parity tests catch any future drift
- [Phase 100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow]: Plan 02 — vi.mock @anthropic-ai/claude-agent-sdk at session-adapter test file top establishes the SDK adapter end-to-end test pattern; existing tests unaffected (they don't await import the SDK module)
- [Phase 100]: Plan 100-05 — Phase 99-M relay extended with optional 'Artifacts written:' line. DI-pure helpers (resolveArtifactRoot + discoverArtifactPaths) preserve failures-swallow contract. Zero behavior change for non-GSD subthreads (parentConfig.gsd === undefined). Relative paths only per RESEARCH Pitfall 8.
- [Phase 100]: Optional-DI for subagentThreadSpawner (mirrors Phase 87 aclDeniedByAgent + Phase 83 skillsCatalog) — missing spawner emits 'unavailable' reply rather than throwing
- [Phase 100]: deferReply is FIRST async call in handleGsdLongRunner (RESEARCH.md Pitfall 4) — pinned by GSD-6 invocationCallOrder assertion
- [Phase 100]: Set-based long-runner detection (GSD_LONG_RUNNERS.has) instead of if-ladder string compares — scales when more long-runners join
- [Phase 100]: Plan 100-06 — clawcode gsd install CLI subcommand: DI-pure runGsdInstallAction + ensureSymlink + ensureSandbox helpers; idempotent (readlink + stat detection of already-present state); source-paths-immutable invariant pinned by INST14 spy assertion; zero new npm deps (node:fs/promises + node:child_process built-ins). Symlinks PARENT directories to sidestep Issue #14836; targets ~/.claude/commands/gsd as SDK-discoverable surface.
- [Phase 100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow]: Plan 100-07: admin-clawdy block placed at END of agents list (after research) — coherent grouping; channels: [] in dev fixture (production yaml carries real ID per Plan 08 runbook); workspace: /tmp/admin-clawdy placeholder; gsd.projectDir byte-matches Plan 06 DEFAULTS.sandboxDir.
- [Phase 100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow]: Plan 100-07 [Rule 3 - Blocking deviation]: PR11 (schema.test.ts) updated to encode Plan 07 cascade — admin-clawdy is sole settingSources/gsd carrier; production agents stay implicit-default. Preserves additive-optional schema invariant + CONTEXT.md lock-in. Strictly better coverage than pre-Plan-07 PR11 (catches both directions of drift).
- [Phase 100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow]: Plan 100-07: 8 YML parse-regression tests cover SHAPE, not BEHAVIOR. Plan 04 dispatcher tests handle dispatch-time behavior; Plan 02 session-adapter tests handle SDK-passthrough behavior. YML1..YML8 are the structural pin between the two consumer-side tests.
- [Phase 100]: [Phase 100]: Plan 100-08 — SMOKE-TEST.md (562 lines, 9 sections, 10 structural tests) is the canonical Phase 100 deploy + UAT runbook for transitioning to clawdy production. autonomous=false because Sections 6-8 require operator interaction in #admin-clawdy on production Discord.
- [Phase 100]: [Phase 100]: Plan 100-08 — Established structural runbook test pattern at .planning/phases/<N>-*/_tests__/<doc>-doc.test.ts pinning markdown invariants. Repeatable for any future operator-runnable artifact (deploy/migration/smoke runbook). Vitest discovers .planning/__tests__/ via default include pattern (no config edit needed).
- [Phase 103]: Plan 103-01 — /clawcode-status: 8 hardcoded `n/a` placeholders wired to live telemetry (Compactions, Context %, Tokens, Activation, Queue, Reasoning label, Permissions, lastActivityAt). 3 OpenClaw-only fields dropped (Fast/Elevated/Harness). Substring grep gates pin the absence at file level.
- [Phase 103]: Plan 103-01 — Compaction counter is in-memory only (Open Q4): resets on daemon restart, informational not persistence-worthy. Bumps ONLY on CompactionManager.compact() resolve via canonical compactForAgent wrapper (Pitfall 3 — rejection cannot inflate count). Closure check pins zero direct .compact() callers in production code.
- [Phase 103]: Plan 103-01 — HeartbeatRunner injected into SessionManager via setHeartbeatRunner DI setter (mirrors setWebhookManager / setMemoryScanner pattern); not a constructor argument. Daemon wires post-runner-start.
- [Phase 103]: Plan 103-01 — Activation timestamp mirrored in-memory via activationAtByAgent Map at startAgent — registry remains source of truth for restart recovery, but synchronous status renders don't await readRegistry per request. Cleared on stopAgent alongside compactionCounts (matches in-memory-only semantics).
- [Phase 103]: rate_limit_snapshots table lives in the per-agent UsageTracker DB rather than a separate SQLite file (one DB handle per agent stays clean)
- [Phase 103]: rateLimitType stored as TEXT (not SDK 5-value union) so a future SDK union expansion does not drop snapshots (Pitfall 10)
- [Phase 103]: surpassedThreshold typed as number|undefined per SDK shape (Pitfall 9 — NOT a boolean)
- [Phase 103]: Persistence is best-effort — SQLite write failures inside record() are logged + swallowed; in-memory state remains source of truth
- [Phase 103]: Hook positioned BEFORE the result branch in iterateUntilResult — ordering documents intent, result-terminator path is preserved
- [Phase 103]: 12th application of inline-handler-short-circuit-before-CONTROL_COMMANDS pattern (Phases 85/86/87/88/90/91/92/95/96/100/103-03) — pattern is canonical at 12 applications
- [Phase 103]: IPC method named list-rate-limit-snapshots (NOT colliding with existing rate-limit-status for Discord outbound rate-limiter — Pitfall 5 closure)
- [Phase 103]: Pure-DI handler module pattern — daemon-rate-limit-ipc.ts mirrors Phase 96 daemon-fs-ipc / Phase 92 cutover-ipc-handlers blueprint (3rd application of dedicated-IPC-module pattern)
- [Phase 103]: Overage rendered as status-line not progress bar (Open Q3) — credit-pool model doesn't translate to a percentage bar
- [Phase 999.1]: Used D-PLN-01 strict TDD pattern (RED → GREEN as 2 atomic commits) for 4 new agent-output directives
- [Phase 999.3]: Plan 01: delegateTo composition contract — sourceConfig (delegate ?? caller) provides inherited fields via spread; parentConfig overrides channels/threads/webhook AFTER spread; disallowedTools recursion guard UNCONDITIONAL outside both branches per D-TCX-03
- [Phase 999.3]: Plan 01: delegate validation at IPC boundary (manager.getAgentConfig) so verbatim ManagerError surfaces to MCP caller per Phase 85 TOOL-04 pattern; spawner-level re-check is defense-in-depth (DEL-10)
- [Phase 999.3]: Plan 01: webhook composition splits identity — caller's webhookUrl (channel-bound) + delegate's displayName/avatar (per-message overrides via discord.js client.send), verified at webhook-manager.ts:71-75
- [Phase 999.2]: Plan 01: Pure rename of SessionManager.sendToAgent → dispatchTurn (D-RNI-01). 7 production call sites + 16 test files + 4 doc-comment files. Static-grep TDD pin via fs.readdirSync walker (no glob dep). DEPRECATED_NAME constructed via array.join() so test file does not self-trigger its own assertion. Zero new typecheck errors (108 baseline preserved).
- [Phase 999.2]: Plan 02: MCP tool dual-registration via shared-closure pattern (canonical-first registration controls tools/list ordering for LLM picking). IPC stacked-case sharing one body. Deprecated-alias metric via console.info for D-RNX-03 30-day removal trigger.
- [Phase 999.2]: Plan 03: Pure-DI module daemon-ask-agent-ipc.ts (Phase 103 blueprint) — handleAskAgentIpc owns inbox+dispatch+mirror; escalation kept at daemon edge for SessionManager access (D-SYN-06 unchanged)
- [Phase 999.2]: Plan 03: Static-grep tests for MCP wrapper text templates instead of McpServer build-and-extract (matches Plan 02 precedent; pure-DI tests pin IPC contract behavior)
- [Phase 999.2]: Plan 03: post-to-agent per-webhook log+swallow LEFT untouched per Plan Step 3 + Pitfall 7 — broadcast tool, delivered:false IS the structured signal; D-PST-03 satisfied via return shape, not by removing local catch
- [Phase 999.8]: Plan 01: extracted memory-graph IPC body into pure handler at src/manager/memory-graph-handler.ts (mirrors handleSetModelIpc); LIMIT 500 → configurable LIMIT ? with default 5000 and inclusive [1, 50000] validation
- [Phase 999.8]: Plan 02: chose Route A (script→module + ESM import) over Route B (globalThis shim) — no external nodeClr consumers, cleaner dependency graph
- [Phase 999.8]: Plan 03 — Static heartbeat-check registry replaces dynamic readdir+import scan; bundle now contains all 11 checks (was 0 due to tsup splitting:false). Boot log emits checkCount:11 + checks:[...] + 'heartbeat checks registered'.
- [Phase 999.8]: Plan 03 — NO try/catch around static imports (Pitfall 7); fail-fast at boot is the contract. The prior silent-skip enabled the bug to live in prod for ~10 weeks.
- [Phase 999.8]: Plan 03 — Lockstep regression test with hand-maintained EXPECTED_FILENAMES forces 3-place updates (import, array entry, test map) when adding a check; future drift becomes a CI failure.
- [Phase 104-daemon-op-secret-cache-and-retry-backoff]: Wave 0 plants spec-ID-named it.todo scaffolds (vs it.skip or stub it) so vitest reports them as todos rather than failures or false-greens — Wave 1+ replaces each with a real it block
- [Phase 104-daemon-op-secret-cache-and-retry-backoff]: p-retry@8.0.0 chosen over hand-rolled retry loop — jitter, AbortError contract, and onFailedAttempt hook are exactly what is hardest to get right under boot-storm conditions
- [Phase 104]: Plan 01 — p-retry v8 RetryContext shape (ctx.error.message + ctx.attemptNumber, NOT err.message); plan's older p-retry signature drift fixed during impl.
- [Phase 104]: Plan 01 — Rate-limit early bail at attemptNumber>=2 (first retry fires; subsequent rate-limit hits abort via AbortError); trades retry budget against compounding throttle window.
- [Phase 104]: Plan 01 — Default randomize:true (jitter on by default per Pitfall 1); tests pass randomize:false explicitly for deterministic wall-clock.
- [Phase 104]: Plan 01 — No fake timers in tests; minTimeout:1/maxTimeout:1 keeps wall-clock <500ms without fighting p-retry's setTimeout-based backoff.
- [Phase 104]: Plan 02: One SecretsResolver instance threads through 3 callsites + boot pre-resolve via Promise.allSettled; sync wrapper around warmed cache keeps loader sync-by-design
- [Phase 104]: Plan 04 IPC handler factored into pure module (secrets-ipc-handler.ts) for unit-testability without booting IPC server; closure-intercept-before-routeMethod pattern preserves the 24-arg routeMethod signature
- [Phase 104]: Plan 03: applySecretsDiff bridge factored into secrets-watcher-bridge.ts (RECOMMENDED) — daemon.ts onChange delegates a single line; tests import production code directly (no shape-drift risk).
- [Phase 104]: Plan 03: Recovery deps invalidate wired at mcp-reconnect.ts construction site (not daemon.ts) — daemon only calls heartbeatRunner.setSecretsResolver. Threading via CheckContext mirrors setThreadManager / setTaskStore pattern; minimal cross-cutting change.
- [Phase 105]: Renamed plan's MC-6 to MC-7 due to existing label clash in message-coalescer.test.ts
- [Phase 105]: POLICY tests are regression locks (pass on main); driver-RED for POLICY lives at daemon boot site verified by build smoke
- [Phase 105]: Added HARD_CEILING to mocked unbounded recursion in CO-10/CO-11 to prevent vitest worker OOM on current main
- [Phase 105]: Bridge-side idempotent guard placement (formatCoalescedPayload, not coalescer.addMessage) — Keeps MessageCoalescer content-agnostic per RESEARCH.md Pattern 2; wrapper-detection paired with wrapper-emission
- [Phase 105]: Layered defense order: depth cap → hasActiveTurn gate → idempotent format — Cap is cheapest (single integer comparison) and runs first; gate is method call so second; format only on actual drain. If both cap and gate would fire, cap wins
- [Phase 105]: MessageCoalescer.requeue bypasses perAgentCap entirely — Messages were already accepted on initial addMessage; re-checking would silently drop them. Per RESEARCH.md Pitfall 3
- [Phase 999.13]: Q1 LOCKED YES: conversation-brief date slice → TZ-aware (operator-perceived date)
- [Phase 999.13]: Q2 LOCKED YES: dream-prompt-builder timestamps → TZ-aware (dream-pass agent reads as agent-visible context)
- [Phase 999.13]: Q3 LOCKED YES: defaults.timezone gets schema-time IANA TZ pre-validation (5-line zod refinement)
- [Phase 999.13]: Q4 DEFER: Discord embed timestamps stay UTC — operator-facing tooling, out of scope
- [Phase 999.13]: DST fixture corrected per RESEARCH.md Pitfall 1: 2026 US fall-back = Nov 1, not Nov 2
- [Phase 999.13]: delegates field uses z.record(string,string).optional() with superRefine validation against known agent names
- [Phase 999.13]: delegatesBlock appended to END of stable prefix (after fs capability), empty/undefined short-circuits to '' for prompt-cache hash stability
- [Phase 999.13]: Optional agentTz?: string parameter (not required) — production callers stay unchanged with host-TZ fallback (correct on single-host clawdy per RESEARCH.md Pitfall 3); tests pass agentTz explicitly
- [Phase 999.13]: Two-layer bad-IANA defense — schema-time refinement on defaults.timezone (Q3=YES, fail-fast) + runtime try/catch fallback in renderAgentVisibleTimestamp (silent UTC degrade)
- [Phase 999.14]: [Phase 999.14]: Plan 00 Wave 0 — thrower stubs (real .ts files that throw 'not implemented in Wave 0') chosen over inline declare-module shims for MCP-08/09/10 RED tests. Keeps tsc clean AND tests RED at runtime. Wave 1 replaces stub bodies; types stay byte-stable.
- [Phase 999.14]: [Phase 999.14]: Plan 00 Wave 0 — startOrphanReaper exposes onTickAfter callback as the seam for MCP-09 sweep wiring; sequence pinned by Test 8 (reap completes BEFORE callback runs). Wave 1 plugs sweepStaleBindings into the seam without re-touching orphan-reaper.
- [Phase 999.14]: Daemon-wide McpProcessTracker singleton (mirrors SecretsResolver DI) handles per-agent PID register/unregister + boot scan + 60s reaper + shutdown killAll. onTickAfter callback runs MCP-09 sweep AFTER orphan reap (locked sequence).
- [Phase 999.15]: Wave 0 RED tests pin all TRACK-01..06+08 behaviors via 6 test files (3 new, 3 extended); zero 999.14 GREEN regressions
- [Phase 999.15]: [Phase 999.15 Plan 01]: Tracker reshape uses immutable-mutation pattern — every updateAgent/replaceMcpPids constructs a new RegisteredAgent reference; callers holding prior entries observe pre-mutation state. SYNC entry write before async cmdline cache enrichment so subsequent sync code sees the new state immediately. isPidAlive treats EPERM as alive (live proc owned by another user is still 'running').
- [Phase 999.15]: Plan 02 reconciler module + polled discovery + reconcile-before-kill GREEN — 15 RED cases flipped; TRACK-01/02/04/06/08 complete; only Plan 03 IPC+CLI scope remains RED
- [Phase 106]: Plan 106-03: Append mcp-tracker-snapshot to IPC_METHODS enum (9 lines, mirrors commit a9c39c7); restores clawcode mcp-tracker CLI path (no more -32600 Invalid Request)
- [Phase 106]: Strip delegates at caller (subagent-thread-spawner) — keeps renderDelegatesBlock pure and primary-agent code path byte-identical
- [Phase 106]: Destructure-only (no in-place delete) preserves sourceConfig purity for any other consumer holding a reference
- [Phase 106]: Recursion guard (disallowedTools: spawn_subagent_thread) retained — defense-in-depth alongside DSCOPE invisibility per RESEARCH Pitfall 4
- [Phase 107]: MemoryStore.cleanupOrphans uses directional SQL (DELETE FROM vec_memories WHERE memory_id NOT IN (SELECT id FROM memories)) — never touches memories. Reversing direction would erase cold-archived memories.
- [Phase 107]: cleanupOrphans lives on MemoryStore class (not separate utility) — single owner of the SQLite handle, mirrors bumpAccess + getMemoryFileSha256.
- [Phase 107]: Daemon per-agent failure pushes sentinel { totalAfter: -1 } into results instead of aborting — operator sees both successes and failures in one CLI invocation.
- [Phase 108]: Shim handshake wire format: { agent, tokenHash } only — token literal hashed in-shim and never sent on socket (SEC-07)
- [Phase 108]: Shim exit codes: 0 (clean stdin end / SIGTERM), 64 (missing CLAWCODE_AGENT or OP_SERVICE_ACCOUNT_TOKEN), 75 (broker socket close → SDK reconnect)
- [Phase 108]: BROKER_ERROR_CODE_DRAIN_TIMEOUT pinned to -32002; pool-crash code -32001 reused via documented constant (no cross-import) — both in JSON-RPC server-defined range
- [Phase 108]: TokenHash validation pattern is /^[a-zA-Z0-9_-]{1,64}$/ (not strict hex) so test fixtures + production hashes both pass; SEC-07 invariants preserved (rejects empty / oversize / control bytes)
- [Phase 108]: BrokerAgentConnection.rawToken empty in shim path — literal token NEVER traverses unix socket; 108-05 wires daemon-side lookup by hash
- [Phase 108]: Tracker-before-broker construction order — broker's onPoolSpawn closes over the constructed mcpTracker singleton (no forward-reference gymnastics). Both orderings satisfy 'broker up before agents start' since manager.startAll runs ~2500 lines after either insertion point.
- [Phase 108]: ShimServer.deps.resolveRawToken added — daemon-side tokenHash → rawToken Map injected at handshake; literal never crosses the socket (Phase 104 SEC-07).
- [Phase 108]: Heartbeat provider surface intentionally narrow ({getPoolStatus} only) — RED test asserts Object.keys === ['getPoolStatus'] to gate against synthetic password_read consuming 1Password rate-limit budget.
- [Phase 110]: Postinstall dev-skip when prebuilds/ absent — preserves npm ci on source-checkout while keeping fail-loud on corrupt tarballs (110-03)
- [Phase 110]: Artifact-name contract clawcode-mcp-shim-linux-<arch> binds go-build.yml uploads to npm-publish.yml downloads (110-03)
- [Phase 110]: Plan 110-00 Wave 0 build artifacts shipped: 5.7 MB Go MCP spike binary, 4/4 regression tests pass, operator runbook + RSS measurement helper authored. Operator kill-switch gate (admin-clawdy live VmRSS ≤ 15 MB + exit-75 respawn) PENDING — Wave 1 (Plan 110-01) blocked until operator approves.
- [Phase 110]: Use native zod/v4 z.toJSONSchema() for list-mcp-tools handler instead of zod-to-json-schema npm package — zero new deps, satisfies CLAUDE.md no-new-deps rule, native converter produces correct required[] output
- [Phase 110]: Inlined STATIC_SHIM_PATH/PYTHON_SHIM_PATH/resolveShimCommand in src/config/loader.ts (single source of truth) so daemon.ts fleet-stats handler imports the same helper that the loader uses — keeps spawn shape and proc-scan regex shape in lockstep when an operator flips defaults.shimRuntime.<type>
- [Phase 115]: Plan 115-01 quick wins: excludeDynamicSections=true (default-on), memoryRetrievalTokenBudget wired through (default 1500 down from 2000), tag-filter at hybrid-RRF drops session-summary/mid-session/raw-fallback memories (locked default per CONTEXT sub-scope 4)
- [Phase 115]: Plan 115-03: replaced enforceWarnAndKeep no-op with real drop-lowest-importance enforcement; INJECTED_MEMORY_MAX_CHARS=16K (D-01) + STABLE_PREFIX_MAX_TOKENS=8K (D-02 outer cap with emergency head-tail-truncate fallback); SOUL fingerprint verbatim-protected (never drops); MEMORY.md drops first when over budget
- [Phase 115]: Plan 115-03 T03: MemoryTier1Source / MemoryTier2Source TypeScript discriminated-union types in src/memory/types.ts use string-literal 'tier' discriminators (avoids colliding with pre-existing MemoryTier hot/warm/cold storage tier and MemorySource string union); union alias exported as TypedMemorySource (NOT MemorySource) to preserve back-compat; ContextSources.identityMemoryAutoloadSource is the field name 115-04 will consume
- [Phase 115]: Plan 115-03 T04: shipped no-LLM Hermes Phase 1 tool-output prune (src/memory/tool-output-prune.ts pruneToolOutputs replaces old tool outputs with [tool output pruned: <tool> @ <ts>] markers; pure synchronous, <50ms regression-pinned; default keepRecentN=3); CompactionManager.compactToolOutputs() pre-compaction hook; Phases 2 + 3 (LLM mid-summarization + drop oldest) explicitly DEFERRED per CONTEXT.md out-of-scope line 32
- [Phase 115]: 115-04: cacheBreakpointPlacement enum (static-first | legacy) with default static-first; SDK shape locked; identityMemoryAutoload classified static at outer placement (per advisor + 115-03 design); SECTION_PLACEMENT exhaustive over keyof ContextSources
- [Phase 115]: Fixed-range int8 quantization at [-1, +1] (NOT per-vector min/max) — sqlite-vec native distance metric requires shared range across all vectors
- [Phase 115]: EmbeddingService dispatcher: legacy embed(text) preserved; embedV1 / embedV2Float32 / embedV2 added for migration-aware callers — 7 existing callers stay bit-identical
- [Phase 115]: Per-agent migrations table in per-agent DB (key=embeddingV2); pause/status/rollback all per-agent — Phase 90 isolation lock preserved
- [Phase 115]: Plan 115-05: extended Phase 95 D-04 with sister applyDreamResultD10 entry point (5-row D-10 hybrid policy) instead of replacing applyDreamResult — preserves D-04 surfacing-only invariant and pinned regression tests
- [Phase 115]: Plan 115-05: dream-veto-pending JSONL persistence at ~/.clawcode/manager/dream-veto-pending.jsonl (mirrors consolidation-run-log.ts) instead of per-agent SQLite — fleet-wide cron sweep simpler to operate
- [Phase 115]: Plan 115-05: dreamResultSchema gained optional action + targetMode (additive-optional pattern) for Row-3 mutating-detection — legacy LLM responses without these fields treated as additive (Row 2 default)
- [Phase 115]: Plan 115-05: D-05 priority pass shortens isAgentIdle threshold from configured idleMinutes to PRIORITY_IDLE_MINUTES (5) at tick time — does NOT change cron firing cadence (kept change surface narrow)
- [Phase 115]: Plan 115-07: per-agent isolation locked at policy layer + verified at runtime via SQL assertions over agent_or_null column (search_documents per-agent, web_search/brave_search/exa_search cross-agent)
- [Phase 115]: Plan 115-07: live coverage scope is narrower than policy table — search_documents + web_search/_fetch_url + image_generate wired today; mysql_query / brave_search / exa_search / google_workspace_* are policy-only pending broker integration
- [Phase 115]: Plan 115-07: tool_cache_size_mb deviation — fleet-wide signal goes through closure intercept of case cache IPC, not per-Turn rollups (would have misled per-agent percentile reads)
- [Phase 115]: Plan 115-08: Premise-inversion in T01 — existing tool_call.<name> span IS execution-side; added tool_roundtrip_ms as separate per-batch wall-clock measurement (LLM emit-tool_use → next parent assistant).
- [Phase 115]: Plan 115-08: parallel_tool_call_count uses MAX semantics (not SUM) across the turn — sequential turns land 1, parallel batches land N. Subsumes the > 0 'had any tool' check used by tool_use_rate computation while preserving the parallel-vs-serial signal.
- [Phase 115]: Plan 115-08: tool_use_rate persisted in separate tool_use_rate_snapshots table (not back-written to turn rows) so the metric is independent of turn cadence. PRIMARY KEY (agent, computed_at) makes same-millisecond writes idempotent. Plan 115-09 reads via getLatestToolUseRateSnapshot OR via on-the-fly compute.
- [Phase 115]: Plan 115-08: PARALLEL-TOOL-01 directive landed in DEFAULT_SYSTEM_PROMPT_DIRECTIVES (parallel-tool-calls key, default-enabled fleet-wide). Text scoped to mutually-orthogonal lookups so dependent calls cannot regress (THREAT-3 mitigation). Operator override wins per Phase 94 D-09/D-10 pattern.
- [Phase 115]: Plan 115-08: 30% threshold + fin-acq exclusion locked in three sites (CLI literal 0.3, IPC handler 0.30, wave-2-checkpoint.md). Each has a CONTEXT D-12 provenance comment. Future operator changing the threshold MUST touch all three.
- [Phase 115]: Sub-scope 6-B: PENDING-OPERATOR → de-facto DEFER. Routes to Phase 116 once operator runs audit CLI post-deploy.
- [Phase 115]: Cross-agent coordinator built as new abstraction (not retrofit). Per-agent runConsolidation preserved verbatim; coordinator wraps fleet-level orchestration.
- [Phase 115]: Manual rollback semantics — partial-failed batches require explicit operator rollback(runId) call (CONTEXT D-10 three-tier policy).
- [Phase 999.36]: Sub-bug A typing indicator fix shipped (TYPING_REFRESH_MS=8000, D-05 cadence pin); sub-bugs B+D fixes deferred to Plans 03+02 until 24h+ prod observation confirms D-06 (chunk-boundary seam) and D-12 (premature-fire source)
- [Phase 999.36]: D-09/D-10: share-file routing rebound to agent identity (sessionName) -> thread binding, NOT workspace
- [Phase 999.36]: D-11: shared-workspace regression test pins Schwab AIP failure class with actual incident channel IDs
- [Phase 999.36]: D-02: 4 OTHER workspace-keyed lookups CATALOGUED in DEFERRED-WORKSPACE-LOOKUPS.md, NOT FIXED — operator promotes follow-up if reproduces
- [Phase ?]: Phase 116 Plan 00: F02 backend uses sibling DEFAULT_MODEL_SLOS + resolveSloFor; existing segment-based sloOverrideSchema preserved, no schema migration
- [Phase ?]: Phase 116 Plan 00: shadcn/ui scaffolded via manual components.json — shadcn CLI rejects Tailwind 3.4 + parent-directory node_modules; locked New York / neutral / CSS-vars config written by hand
- [Phase ?]: Plan 116-01: useAgentLatency hook added (30s polling) — observed first_token p50 lives on /api/agents/:name/latency, not /cache (which carries only the SLO threshold)
- [Phase ?]: Plan 116-01: F05 per-tool cache breakdown deferred to 116-02 — /api/agents/:name/cache returns fleet-wide tool_cache_hit_rate only
- [Phase ?]: Plan 116-01: SLO breach dismissal bucketed by observed p50 rounded to 500ms (jitter ignored; genuine new spike re-shows)
- [Phase 117]: Plan 117-11: separate manager/verbose-state.db SQLite file for per-channel verbose toggle (RESEARCH §4.1 + §6 Pitfall 4) — Matches AdvisorBudget own-file precedent; keeps backup/restore semantics independent across stores.
- [Phase 117]: Plan 117-11: BridgeConfig.verboseState is OPTIONAL (back-compat); pure exported handleVerboseSlash mirrors handleInterruptSlash/handleSteerSlash pattern — Keeps existing structural-stub injection in bridge-advisor-footer.test.ts Case F/F' working via 'as any', avoiding a 4-file test rewrite. handleVerboseSlash extraction allows T07 to test the dispatch logic without instantiating SlashCommandHandler.

### v2.1 closing decisions (for reference)

- [v2.1 Roadmap]: Zero new npm deps — entire milestone ran on existing stack.
- [v2.1 Roadmap]: Source of truth for memory translation is WORKSPACE MARKDOWN (MEMORY.md + memory/*.md + .learnings/*.md), not the OpenClaw sqlite chunks table.
- [v2.1 Roadmap]: SOUL/IDENTITY stored as workspace files with `soulFile:` + `identityFile:` YAML pointers — never inlined into clawcode.yaml.
- [v2.1 Roadmap]: Secret guard is a HARD REFUSAL not a warning — migrator rejects any raw secret-shaped value in clawcode.yaml.
- [v2.1 Roadmap]: Non-destructive to source — migrator NEVER modifies, deletes, or renames any file under `~/.openclaw/`.
- [v2.1 Roadmap]: Per-agent atomic cutover — memory → workspace → config (YAML append is the commit point). Agents in sequence, not parallel.

### Phase 82/82.1 v2.1 close-out decisions (for reference)

- [Phase 82-pilot-cutover-completion]: removeBindingsForAgent bypasses zod schema to preserve operator-curated passthrough fields (env, auth, channels.discord.token)
- [Phase 82-pilot-cutover-completion]: fs-guard allowlist uses exact-equality on resolve()'d paths — sibling .bak files still refuse
- [Phase 82-pilot-cutover-completion]: source_integrity_sha hashes sorted ledger witness rows (not a live tree walk) — the ledger IS the audit trail
- [Phase 82]: Pilot-highlight line suppressed on plan --agent <name> (single-agent filter has no signal value)
- [Phase 82]: Dispatch-holder default-with-fallback pattern: impl = holder.x ?? moduleRef for test-safety
- [Phase 82]: runCompleteAction bundled into Task 1 GREEN commit for dispatch-holder coherence (Phase 80/81 all-fields-init pattern)
- [Phase 82.1]: Fixed finmentum soulFile/identityFile YAML pointer via isFinmentum branch in config-mapper — closes v2.1 audit gap for CONF-01/WORK-02/MIGR-04; dedicated-agent behavior unchanged (regression-pinned)

### Roadmap Evolution

- 2026-04-18: Milestone v1.9 Persistent Conversation Memory shipped (Phases 64-68 + 68.1)
- 2026-04-18: Milestone v2.0 Open Endpoint + Eyes & Hands started — 20 requirements defined across 4 categories
- 2026-04-18: v2.0 roadmap created — 4 phases (69-72), 20/20 requirements mapped 1:1, zero orphans
- 2026-04-19: Phase 73 added — OpenClaw endpoint latency
- 2026-04-19: Phase 74 added — Seamless OpenClaw backend (caller-provided agent config)
- 2026-04-20: v2.0 complete (Phases 69-74 shipped); v2.1 OpenClaw Agent Migration milestone opened
- 2026-04-20: v2.1 research complete — STACK/FEATURES/ARCHITECTURE/PITFALLS/SUMMARY across `.planning/research/`
- 2026-04-20: v2.1 roadmap created — 8 phases (75-82), 31 requirements mapped 1:1 across SHARED/MIGR/CONF/WORK/MEM/FORK/OPS
- 2026-04-21: v2.1 shipped (phases 75-82.1, 40 plans) — OpenClaw Agent Migration complete
- 2026-04-21: v2.2 milestone opened — OpenClaw Parity & Polish (skills migration, effort mapping, model picker core, native CC slash commands, MCP tool awareness, skills marketplace)
- 2026-04-21: v2.2 research complete — STACK/FEATURES/ARCHITECTURE/PITFALLS/SUMMARY across `.planning/research/`
- 2026-04-21: v2.2 roadmap created — 6 phases (83-88), 45 requirements mapped across UI/SKILL/EFFORT/MODEL/CMD/TOOL/MKT; UI-01 cross-cutting across 4 UI phases; zero orphans
- 2026-04-22: Phase 89 added — Agent restart greeting (active Discord send of prior-context summary on restart)
- 2026-04-23: v2.2 shipped (phases 83-89, 19 plans, 32 tasks) — OpenClaw Parity & Polish complete; tech_debt audit status (2 Phase 89 UAT items deferred)
- 2026-04-24: v2.3 Marketplace & Memory Activation opened — Phase 90 added: ClawHub Marketplace + fin-acquisition Memory Prep. Scope synthesized from Apr 23-24 fin-acquisition Discord conversation-history analysis (4900 msgs) + v2.2 gap analysis of OpenClaw → ClawCode fin-acquisition migration readiness. 21 requirements (HUB-01..08 + MEM-01..06 + WIRE-01..07) across 7 suggested plans.
- 2026-04-24: v2.3 shipped — Phase 90 autonomously executed (7 plans, 4 waves, 21 reqs, 1454/1462 tests). Milestone archived. Phase 90.1 hotfixes applied live: bot-direct greeting fallback + iterate-back empty-session + minimal greeting always-fires + restartAgent tolerates 'not running'. fin-acquisition channel binding mingled into test channel (1492939095696216307) per operator directive. fin-test agent removed from config.
- 2026-04-24: v2.4 OpenClaw ↔ ClawCode Continuous Sync opened — Phase 91 added: fin-acquisition workspace sync (markdown + uploads + skills + conversation-turn translator, uni-directional OpenClaw→ClawCode until operator flips `sync.authoritative`). 10 SYNC-01..10 requirements, 6-plan decomposition hint. Built on Phase 80 memory-translator + rsync + chokidar/inotify.
- 2026-04-24: v2.4 shipped — Phase 91 autonomously executed (6 plans, 6 waves, 10 SYNC reqs, 166/166 sync tests green). Milestone archived to `.planning/milestones/v2.4-ROADMAP.md`. Zero new npm deps preserved via node:child_process.execFile + existing chokidar/yaml/better-sqlite3. Cutover command + 7-day rollback window implemented; `clawcode sync` CLI group with 8 subcommands + /clawcode-sync-status Discord slash. Sync runner + translator ship as systemd user timers with graceful-SSH-fail tolerance.
- 2026-04-24: v2.5 Cutover Parity Verification opened — Phase 92 added: OpenClaw → ClawCode fin-acquisition cutover parity verifier. Uses Discord message store (not OpenClaw internal sessions, which are absent) as behavior corpus. Emits gap report, auto-applies additive-reversible fixes, gates destructive mutations behind admin-clawdy ephemeral confirmation. `cutover-ready: true` report becomes hard precondition for Phase 91 `sync set-authoritative clawcode --confirm-cutover`. 10 CUT-01..CUT-10 requirements across 6 suggested plans (92-01..92-06). Reuses Phase 85 list-mcp-status IPC, Phase 86 atomic YAML writers, Phase 80 origin_id idempotency. Zero new npm deps expected.
- 2026-04-24: Phase 93 added — Status-detail parity + ClawHub public-catalog defaults + plugin manifest-URL resilience. Bundles three user-reported fixes from fin-acquisition Discord (2026-04-24): (93-01) restore rich `/clawcode-status` output deferred in Phase 83 EFFORT-07 to match OpenClaw /status (version+commit, model+key-source, fallbacks, context/compactions, session/updated, runtime/runner/think/elevated, activation/queue); (93-02) auto-inject `defaults.clawhubBaseUrl` as synthetic ClawHub source in `loadMarketplaceCatalog` when no explicit marketplaceSources[kind:"clawhub"] present so `/clawcode-skills-browse` surfaces public skills (today: local-only); (93-03) distinguish manifest-404 from manifest-invalid in `downloadClawhubPluginManifest` + `mapFetchErrorToOutcome` so hivemind-style "listed without manifest" emits `manifest-unavailable` outcome with actionable UI copy instead of misleading "manifest is invalid". IN: all three + tests + Discord UI strings. OUT: skill-side OAuth (Phase 90-06), publishing hivemind manifest (registry-side).
- 2026-04-25: Phase 96 added — Discord routing and file-sharing hygiene. Bundles user-reported issues from #research and #finmentum-client-acquisition (2026-04-25): dual-bot pattern (Clawdy red + Clawdy Code green both responding), agent confabulation about "OpenClaw vs ClawCode contexts", file attachment delivery via webhook with single visual identity (must post as "Clawdy" not "OpenClaw Agents"), agent auto-routing through OpenClaw without explicit user instruction every time, and stale "no workspace access from this side" excuses across multiple agents. Inline pre-phase work this session: (a) clawcode.yaml channel bindings stripped for OpenClaw-routed agents (test-agent + Admin Clawdy retain bindings); (b) `/home/clawcode/.claude/settings.json` disabled `discord@claude-plugins-official` plugin; (c) Discord channel ACLs reverted on 8 OpenClaw channels (Clawdy Code role removed); (d) `/etc/clawcode/openclaw-webhooks.json` populated with webhook id+token for 8 channels (3 newly created via legacy bot); (e) `clawcode_share_file` IPC handler in `daemon.ts` modified to use OpenClaw webhook execute when channel not in agent bindings — WIP edits stashed at `git stash@{0}` for fold-in. Open: webhook display name override (post as Clawdy + correct avatar) + agent prompt/memory updates so agents auto-attempt attach without user instruction + workspace access narrative (clawcode user IS in jjagpal group + has ACLs on .openclaw, but agents recite stale "no access" claim).
- 2026-05-13: Phase 117 added — Claude Code advisor pattern (multi-backend scaffold, Anthropic complete). Replaces fork-based `ask_advisor` (`daemon.ts:9805`) with `AdvisorService` interface + three backend slots: `AnthropicSdkAdvisor` (native, via SDK `advisorModel` option — in-request server sub-inference, advisor-side prompt caching, executor timing prompt — COMPLETE), `LegacyForkAdvisor` (today's fork code, preserved as `advisor.backend: fork` rollback lever per Phase 110 `defaults.shimRuntime` pattern), `PortableForkAdvisor` (interface-conformant stub, Phase 118 fills in). Seeds `src/llm/CompletionProvider` interface (no impls yet — first lands with 118 consumer). Agent awareness via system-prompt block + capability manifest entry; Discord visibility via 💭 reaction on triggering message + `— consulted advisor (Opus)` footer — in-band only, NO new threads, `subagent-thread` skill untouched. Preserves all operator contracts: `ask_advisor` MCP schema, `AdvisorBudget` 10/day cap, 2000-char truncation, non-idempotent caching flag. 10 plans (117-01..117-10). Reference plan: `/home/jjagpal/.claude/plans/eventual-questing-tiger.md`. Trigger: Anthropic API beta `advisor_20260301` + SDK 0.2.132 `advisorModel` option (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:4930`) + operator-flagged multi-provider readiness concern.

### Pending Todos

- `/gsd:plan-phase 83` — decompose Extended-Thinking Effort Mapping into plans (SDK canary, P0 bug fix, fork quarantine, persistence, per-skill override)
- CMD-00 SDK spike (~30min throwaway script) MUST land before Phase 87 planning — output to `.planning/research/CMD-SDK-SPIKE.md`
- Consider parallel `/gsd:plan-phase 84` (Skills Library Migration) and `/gsd:plan-phase 85` (MCP Tool Awareness) — both independent of 83/86/87 and each other

### Blockers/Concerns

- **CMD-00 spike gates Phase 87** — cannot start Phase 87 implementation without the SDK mid-session-mutation concurrency spike committed to research/. Spike is fast (~30min) but strictly blocking.
- **`finmentum-crm` SKILL.md contains literal MySQL credentials** — Phase 84 secret-scan MUST refuse the copy; creds need to be moved to MCP env/op:// refs before the skill can migrate. Hard gate, not advisory.
- **SDK pre-1.0 churn risk** — pinning to exact 0.2.97 (not ^0.2.97). If the SDK ships a breaking minor (0.3.x) during v2.2 execution, hold at 0.2.97 and defer bump to a separate milestone.
- **12 of 15 v1.1 phases missing formal VERIFICATION.md artifacts (docs only)** — legacy carry-over, not blocking v2.2.
- **Discord 100-command-per-guild cap** — v2.2 adds to the existing ~13 clawcode-* commands + ~20-25 native CC commands = worst case ~40/guild; safe but Phase 87 must keep per-guild dedupe (not per-agent registration).
- Phase 115-08 producer call sites need porting from session-adapter.ts:iterateWithTracing (test-only path) into persistent-session-handle.ts:iterateUntilResult (production path) — tracked in 116-DEFERRED.md

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260418-sux | Fix schedule display field mismatch and add registry ghost-entry reconciliation | 2026-04-18 | 3d4ff24 | [260418-sux-fix-schedule-display-field-mismatch-and-](./quick/260418-sux-fix-schedule-display-field-mismatch-and-/) |
| 260419-jtk | Harden OpenAI streaming for OpenClaw: usage trailing chunk + tool-call verify + warm-path startup race | 2026-04-19 | 18252fe | [260419-jtk-harden-openai-streaming-for-openclaw-emi](./quick/260419-jtk-harden-openai-streaming-for-openclaw-emi/) |
| 260419-mvh | Fix initMemory→warm-path cascade + add OpenAI request/payload JSONL logging + `openai-log tail` CLI | 2026-04-19 | 34dfb83 | [260419-mvh-fix-initmemory-warm-path-cascade-add-ope](./quick/260419-mvh-fix-initmemory-warm-path-cascade-add-ope/) |
| 260419-nic | Discord `/clawcode-interrupt` + `/clawcode-steer` slash commands — mid-turn abort + steering via Phase 73 interrupt primitive | 2026-04-19 | 8ff6780 | [260419-nic-add-discord-stop-and-steer-slash-command](./quick/260419-nic-add-discord-stop-and-steer-slash-command/) |
| 260419-p51 | Multi-agent bearer keys (scope=all) + composite-PK session index + fork-escalation regression pin + spawn-subagent UX docs | 2026-04-19 | edecd6e | [260419-p51-multi-agent-bearer-keys-fork-escalation-](./quick/260419-p51-multi-agent-bearer-keys-fork-escalation-/) |
| 260419-q2z | Registry atomic write + recovery + `clawcode registry repair` CLI + always-summarize short sessions + graceful shutdown drain (FIX A+B+C) | 2026-04-19 | fa34ef3 | [260419-q2z-registry-atomic-write-graceful-shutdown-](./quick/260419-q2z-registry-atomic-write-graceful-shutdown-/) |
| 260429-ouw | Webhook table-wrap regression — wrap markdown tables inside webhookManager.send (covers 3 missed Phase 100-fu call sites) | 2026-04-29 | 696bc39 | [260429-ouw-webhook-path-table-wrap-regression-add-w](./quick/260429-ouw-webhook-path-table-wrap-regression-add-w/) |
| 260501-i3r | Add structured relay-skipped diagnostic logs to relayCompletionToParent silent-return points | 2026-05-01 | 61292ed | [260501-i3r-add-structured-relay-skipped-diagnostic-](./quick/260501-i3r-add-structured-relay-skipped-diagnostic-/) |
| 260501-j7x | Phase 999.24 — expand /etc/sudoers.d/clawcode on clawdy with CLAWCODE_SERVICE alias (systemctl reload/restart NOPASSWD for clawcode user) | 2026-05-01 | c3dc129 | [260501-j7x-phase-999-24-sudoers-expansion-for-clawc](./quick/260501-j7x-phase-999-24-sudoers-expansion-for-clawc/) |
| 260501-jld | Phase 999.21 — consolidate 19 `gsd-*` Discord slash commands under `/get-shit-done` (nested subcommands, claudeCommand byte-identical, 594/594 tests pass) | 2026-05-01 | e422045 | [260501-jld-phase-999-21-consolidate-20-gsd-discord-](./quick/260501-jld-phase-999-21-consolidate-20-gsd-discord-/) |
| 260501-k5s | Phase 999.22 — add fleet-wide `mutate-verify` directive to DEFAULT_SYSTEM_PROMPT_DIRECTIVES (soul guard against hallucinated tool-use claims; 11 → 12 keys, locked-additive verified, 38/38 tests pass) | 2026-05-01 | 67a1f03 | [260501-k5s-phase-999-22-soul-guard-mutate-verify-di](./quick/260501-k5s-phase-999-22-soul-guard-mutate-verify-di/) |
| 260501-nfe | Phase 999.18 partial fix — switch `relayCompletionToParent` from `dispatch()` (response discarded) to `dispatchStream()` + ProgressiveMessageEditor posting to parent's main channel; addresses the dominant relay-summary-not-posted failure mode discovered during code-trace this session (39/39 spawner tests pass, +2 new relay-skipped reason tags, all 5 quick-task-260501-i3r diagnostic logs preserved byte-identical) | 2026-05-01 | 6ddde6b | [260501-nfe-fix-relay-summary-not-posted-bug-switch-](./quick/260501-nfe-fix-relay-summary-not-posted-bug-switch-/) |
| 260501-nxm | Fix cached-summary fast-path in restart-greeting — apply API_ERROR_FINGERPRINTS check on stored summary string so legacy "Credit balance is too low" (and other platform-error-shaped) cached summaries get filtered to PLATFORM_ERROR_RECOVERY_MESSAGE. Triggered by 10:03 AM today bug where a /clawcode-restart of Admin Clawdy resurfaced a stale platform-error summary. +17/-1 LOC in restart-greeting.ts, 3 new tests, fingerprint array now consulted at TWO sites (write-time + read-time). | 2026-05-01 | cb82824 | [260501-nxm-fix-cached-summary-fast-path-in-restart-](./quick/260501-nxm-fix-cached-summary-fast-path-in-restart-/) |
| 260501-x44 | Fix all 121 typecheck errors from TS6/vitest4 upgrade fallout — broaden tsconfig include to legitimize tests/__fakes__, repair schema-vs-resolved type drift on `effort` (4→7 union) and `tiers.centralityPromoteThreshold`, pin vitest 4 mock generics with `vi.fn<Sig>()` for tuple narrowing, fix `outputDir` missing from 7 config fixtures, fix Object.freeze generic + ImageProvider re-export + dead code in usage-embed.ts. 121→1 errors (the 1 = flagged budget.ts:138 TS2367 quarantined for /ultrareview). 4 flagged concerns documented in SUMMARY (budget.ts logic bug, missing clawcode.yaml in tests, 32 pre-existing test failures unrelated to PR, TurnOrigin readonly cast pattern). 50/50 tests in touched files PASS, npm build PASS. | 2026-05-01 | f9ac72f | [260501-x44-fix-all-121-typecheck-errors-so-npm-run-](./quick/260501-x44-fix-all-121-typecheck-errors-so-npm-run-/) |
| 260511-mfn | Phase 999.7 Item 2 closeout — read-only tool-call latency audit against clawdy production traces.db (168h window), per-tool p50/p95/p99 captured for Admin Clawdy + fin-acquisition. Headline: local file tools (Read/Edit/Grep/Glob/Bash) are tail-dominators at p95 200-700s on both agents, NOT in original 999.7 scope. fin-acq browser_navigate p95 718s, Bash 646s, spawn_subagent_thread 515s, mysql_query 307s (306 calls). Phase 999.7 → SHIPPED. Two non-blocking follow-ups captured: (B) Phase 115-08 producer regression — split-latency columns NULL for 0/63 turns post-deploy because bundle missing session-adapter.ts producer call sites (`trace-collector.ts` defs ARE present); likely stale tsup cache. (C) `clawcode tool-latency-audit` CLI returns `Invalid Request` — probably same root cause as B. No deploy. | 2026-05-11 | dc0e1ad | [260511-mfn-close-out-phase-999-7-item-2-run-tool-la](./quick/260511-mfn-close-out-phase-999-7-item-2-run-tool-la/) |
| 260511-pw2 | post_to_agent silent-drop diagnostics — extract daemon IPC body to pure-DI handler emitting 6 reason-tagged `post-to-agent skipped` logs (`target-not-found`, `inbox-write-failed`, `no-target-channels`, `no-webhook`, `webhook-send-failed`, `target-not-running`). Response shape gains `ok` + `reason?`; MCP wrapper renders explicit "written to inbox" text so sender's LLM can NEVER mistake the nanoid for a queryable task id (the post-id-looks-task-shaped confusion Admin Clawdy hit). 8 functional + 2 grep sentinels (anti-pattern guard for silent path bifurcation). All 64 tests in touched-surface area pass. No deploy. | 2026-05-11 | 43e2c79 | [260511-pw2-investigate-post-to-agent-silent-drops-b](./quick/260511-pw2-investigate-post-to-agent-silent-drops-b/) |
| 260511-pw3 | Schema-registry introspection — new `list_agent_schemas(caller, target)` MCP tool returning `[{name, callerAllowed, registered}]` (auto-injected for every agent). `delegate_task` unknown_schema errors now carry `data.acceptedSchemas` and the MCP wrapper renders the accepted list inline so senders can retry without out-of-band schema coordination. New TaskManager methods `listSchemasForAgent` + `acceptedSchemasForTarget`, new IPC method `list-agent-schemas`, ValidationError catch + ManagerError(code=-32602, data=...) translation in `case "delegate-task"`. New `docs/cross-agent-schemas.md` documents the two-layer (fleet registry + per-agent acceptsTasks) model. 5 unit + 5 grep sentinels. Resolves Admin Clawdy's `bug.report` rejection on 2026-05-11. No deploy. | 2026-05-11 | 0fe7fb5 | [260511-pw3-schema-registry-auto-discovery-cross-age](./quick/260511-pw3-schema-registry-auto-discovery-cross-age/) |
| Phase 83 P01 | 32 | 2 tasks | 13 files |
| Phase 83 P03 | 17min 22s | 2 tasks | 11 files |
| Phase 83 P02 | 22min 13s | 2 tasks | 6 files |
| Phase 84 P01 | ~25min | 2 tasks (TDD) | 8 files |
| Phase 84 P02 | 17min 0s | 2 tasks | 14 files |
| Phase 84 P03 | 6min 23s | 1 tasks | 4 files |
| Phase 85 P01 | 30min 24s | 2 tasks (TDD) | 15 files |
| Phase 85 P02 | 13min 24s | 2 tasks | 6 files |
| Phase 85 P03 | 20min 0s | 2 tasks | 5 files |
| Phase 86 P01 | 31min | 2 tasks | 14 files |
| Phase 86-dual-discord-model-picker-core P02 | 12min 6s | 2 tasks | 9 files |
| Phase 86-dual-discord-model-picker-core P03 | 9 min 39 s | 2 tasks | 7 files |
| Phase 87-native-cc-slash-commands P01 | 19min 24s | 2 tasks | 18 files |
| Phase 87 P03 | 6min 12s | 1 tasks | 4 files |
| Phase 87 P02 | 11min | 2 tasks | 12 files |
| Phase 88-skills-marketplace P01 | 11min 27s | 2 tasks | 10 files |
| Phase 88-skills-marketplace P02 | 26min 47s | 2 tasks | 10 files |
| Phase 89 P01 | 20m 10s | 2 tasks | 30 files |
| Phase 90 P01 | 12min | 2 tasks | 28 files |
| Phase 90-clawhub-marketplace-fin-acquisition-memory-prep P04 | 33min 1s | 2 tasks (TDD) tasks | 10 files files |
| Phase 90 P05 | 20min 32s | 2 tasks | 14 files |
| Phase 90 P02 | 25min | 2 (TDD) tasks | 34 files |
| Phase 90 P06 | 12m 23s | 2 tasks | 13 files |
| Phase 90 P03 | 20min | 2 tasks | 36 files |
| Phase 90 P07 | 17min 55s | 2 (TDD) tasks | 13 files files |
| Phase 91 P01 | 7min 25s | 2 tasks | 10 files |
| Phase 91 P03 | 18 | 2 tasks | 8 files |
| Phase 91 P02 | 8m 37s | 2 tasks | 6 files |
| Phase 91 P04 | 11m | 2 tasks | 13 files |
| Phase 91 P06 | 9 min | 2 tasks | 4 files |
| Phase 91 P05 | 10m 33s | 2 tasks | 9 files |
| Phase 92 P01 | 29min | 2 tasks | 11 files |
| Phase 92-openclaw-clawcode-fin-acquisition-cutover-parity-verifier P02 | 6m | 2 (TDD) tasks | 8 files files |
| Phase 92-openclaw-clawcode-fin-acquisition-cutover-parity-verifier P03 | 9m | 2 tasks | 5 files |
| Phase 92 P04 | 12 | 2 tasks | 11 files |
| Phase 93-status-detail-parity-clawhub-public-catalog-defaults-plugin-manifest-url-resilience P01 | 33m 40s | 2 tasks tasks | 5 files files |
| Phase 92 P05 | 6m 34s | 2 (TDD) tasks | 9 files |
| Phase 92 P06 | 7m | 2 tasks | 11 files |
| Phase 93 P02 | 21min | 2 tasks | 6 files |
| Phase 93 P03 | 25min | 2 tasks | 5 files |
| Phase 94 P01 | 13min | 2 tasks | 15 files |
| Phase 94-tool-reliability-self-awareness P04 | 17min | 2 tasks | 5 files |
| Phase 94 P02 | 34min | 2 tasks | 13 files |
| Phase 94 P03 | 23min | 2 tasks | 14 files |
| Phase 94-tool-reliability-self-awareness P06 | 7min | 2 tasks | 8 files |
| Phase 94-tool-reliability-self-awareness P05 | 6min | 2 tasks | 5 files |
| Phase 94 P07 | 10min | 2 tasks | 6 files |
| Phase 95 P01 | 30min | 2 tasks | 9 files |
| Phase 95 P02 | 24min | 2 tasks | 6 files |
| Phase 95 P03 | 25min | 2 tasks | 12 files |
| Phase 96 P06 | 28min | 2 tasks | 13 files |
| Phase 96 P01 | 25min | 3 tasks | 17 files |
| Phase 96 P02 | 12min | 3 tasks | 3 files |
| Phase 96-discord-routing-and-file-sharing-hygiene P03 | 18min | 2 tasks | 5 files |
| Phase 96 P04 | 23min | 3 tasks | 9 files |
| Phase 96 P05 | 14min | 3 tasks | 12 files |
| Phase 96-discord-routing-and-file-sharing-hygiene P07 | 9 min | 3 tasks | 6 files |
| Phase 100-01 P01 | 14min | 2 tasks | 27 files |
| Phase 100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow P03 | 5min | 1 tasks | 2 files |
| Phase 100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow P02 | 16min | 2 tasks | 4 files |
| Phase 100 P05 | 7min | 1 tasks | 2 files |
| Phase 100 P04 | 9min | 2 tasks | 2 files |
| Phase 100 P06 | 5min | 2 tasks | 3 files |
| Phase 100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow P07 | 6min | 2 tasks | 3 files |
| Phase 100 P08 | 5min | 1 tasks | 2 files |
| Phase 103 P02 | ~22min | 2 tasks | 10 files |
| Phase 103 P03 | 30min | 2 tasks | 14 files |
| Phase 999.1 P01 | 4m | 2 tasks | 2 files |
| Phase 999.3 P01 | 10 | 4 tasks | 5 files |
| Phase 999.2 P01 | 35min | 2 tasks | 24 files |
| Phase 999.2 P02 | 11min | 2 tasks | 5 files |
| Phase 999.2 P03 | 15min | 2 tasks | 6 files |
| Phase 999.8 P01 | 14min | 2 tasks | 3 files |
| Phase 999.8 P02 | 20min | 2 tasks | 4 files |
| Phase 999.8 P03 | 10min | 2 tasks | 7 files |
| Phase 104-daemon-op-secret-cache-and-retry-backoff P00 | 2min | 3 tasks | 7 files |
| Phase 104 P01 | 211s | 2 tasks | 2 files |
| Phase 104 P02 | 6.5min | 3 tasks | 5 files |
| Phase 104 P04 | 5min | 3 tasks | 4 files |
| Phase 104 P03 | 6min | 2 tasks | 8 files |
| Phase 105 P00 | 18 min | 3 tasks | 3 files |
| Phase 105 P01 | 5 min | 2 tasks | 1 files |
| Phase 105 P02 | 6 min | 3 tasks | 2 files |
| Phase 999.13 P00 | 16 min | 3 tasks | 12 files |
| Phase 999.13 P01 | 22 min | 3 tasks | 6 files |
| Phase 999.13 P02 | 33 min | 3 tasks | 12 files |
| Phase 999.14 P00 | 13 min | 6 tasks | 8 files |
| Phase 999.14 P01 | 35 min | 6 tasks | 10 files |
| Phase 999.15 P00 | 30 min | 4 tasks | 6 files |
| Phase 999.15 P01 | 25 min | 3 tasks | 5 files |
| Phase 999.15 P02 | 33 min | 5 tasks | 5 files |
| Phase 999.15 P03 | 15 min | 3 tasks | 6 files |
| Phase 999.6 P01 | 12 min | 3 tasks | 3 files |
| Phase 999.12 P00 | 18 min | 2 tasks | 4 files |
| Phase 999.12 P01 | 12 min | 3 tasks | 6 files |
| Phase 106 P00 | 8 min | 3 tasks | 3 files |
| Phase 106 P03 | 3 min | 1 tasks | 1 files |
| Phase 106 P01 | 3 min | 1 tasks | 1 files |
| Phase 106 P02 | 18 min | 1 tasks | 1 files |
| Phase 107 P02 | 45m | 3 tasks | 7 files |
| Phase 108 P00 | 25min | 3 tasks | 8 files |
| Phase 108 P03 | 9min | 2 tasks | 3 files |
| Phase 108 P02 | 13m | 2 tasks | 2 files |
| Phase 108 P04 | 60min | 4 tasks | 12 files |
| Phase 110 P03 | 7 | 3 tasks | 5 files |
| Phase 110 P00 | 25min | 2 tasks | 7 files |
| Phase 110 P01 | 7m | 2 tasks | 4 files |
| Phase 110 P02 | 20min | 3 tasks | 6 files |
| Phase 110 P04 | 30 minutes | 3 tasks | 7 files |
| Phase 115 P01 | 50min | 3 tasks | 12 files |
| Phase 115 P03 | 95min | 4 tasks | 11 files |
| Phase 115 P04 | 70min | 3 tasks | 11 files |
| Phase 115 P06 | 18min | 5 tasks | 15 files |
| Phase 115 P05 | 40min | 4 tasks | 16 files |
| Phase 115 P07 | 28 | 4 tasks | 15 files |
| Phase 115 P08 | 41min | 3 tasks | 17 files |
| Phase 115 P09 | 28min | 5 tasks | 12 files |
| Phase 999.36 P00 | 22min | 5 tasks | 5 files |
| Phase 999.36 P01 | 11 | 5 tasks | 7 files |
| Phase 116 P01 | 65min | 6 tasks | 11 files |
| Phase 116 P06 | 85min | 7 tasks | 22 files |
| Phase 117 P11 | 28min | 7 tasks | 10 files |

## Session Continuity

Last activity: 2026-05-13
Stopped at: Phase 116 SHIPPED + Usage-page reframe (116-postdeploy). Operator complaint resolved: dashboard `/dashboard/v2/costs` → `/dashboard/v2/usage` with subscription utilisation (5h + 7d + Opus/Sonnet carve-outs) as the primary surface and theoretical API-equivalent USD demoted to a collapsible section. 4 commits: `01d633f` (backend `/api/usage` + `list-rate-limit-snapshots-fleet` IPC + hooks), `c7786b5` (Usage page redesign in-place), `ed729b0` (nav rename + `/costs` SPA alias), plus this docs commit. See `.planning/phases/116-dashboard-redesign-modern-ui-mobile-basic-advanced/116-USAGE-REDESIGN.md`. Code-only — Ramy-active deploy hold continues. Predecessor stop point: Plan 116-06 closes the phase. 3 commits: `f863757` (T08 cutover flag), `d6510ff` (T01+T04+T07 backend), `7e6b531` (T01-T05+T07 frontend). F19 swim-lane DEFERRED out of phase per 116-DEFERRED.md.
Resume: Phase 116 is code-complete at the source level. Awaiting operator decisions: (1) deploy clearance — Ramy-active deploy hold continues until operator explicit clearance; (2) cutover flag flip — `clawcode config set defaults.dashboardCutoverRedirect true` once operator has soaked /dashboard/v2/ for one or more sessions and reviewed `/dashboard/v2/audit` to confirm dashboard mutations are captured; (3) decommission follow-up — separate commit removing legacy `src/dashboard/static/*` files + the cutover-flag plumbing once the operator is confident the cutover is durable. See `116-VERIFICATION.md` for the operator handoff checklist + telemetry signals to watch + rollback procedure.

**Open follow-ups (deferred from Phase 116):**

- ~~Phase 115-08 producer port~~ — code DONE 2026-05-11 (commit `a0f30a6`); deployed 2026-05-11 22:55 UTC. **Post-deploy verification surfaced a NEW sub-bug:** producer call sites present in bundle (grep returns 5 vs 0 pre-port) but split-latency columns STILL NULL across 84 tool-use turns in 3-min post-restart window. Port landed in `iterateUntilResult` but producer calls aren't firing on real traffic. Three hypotheses to investigate as follow-up quick task: (1) call sites positioned at wrong message-type branch; (2) `turn` parameter from production callers lacks producer methods — `?.()` silently no-ops (silent-path-bifurcation AGAIN); (3) conditional spread gate `parallelToolCallCount > 0` gating writes. Integration test (`persistent-session-handle-producer-port.test.ts`) passed with non-zero values — production state differs from test state. **NOT a Phase 116 blocker** — F07 has graceful fallback for null columns per plan's deviation handling.
- F19 swim-lane timeline → 116-DEFERRED.md (promotion criteria: 2× operator demand reports OR F12 reveals multi-agent timing gap).
- F14 in-UI memory editor → 116-DEFERRED.md (promotion criteria: operator workflow friction OR `clawcode memory edit` invocations exceed 10/day).
- Pre-existing slash-command test failures (~17-19) carried forward across the entire Phase 116 chain. Awaiting the dedupe task 116-04 surfaced.

**Operator note:** Plan 116-06 introduced no new top-level dependencies (bare SVG for the heatmap, existing shadcn Sheet/Popover/Table primitives reused). All new components are client-side. No deploy performed; commits are code-only. Ramy-active deploy hold continues.

## Open Bugs (post-999.15 deploy)

- **mcp-tracker CLI: "Invalid Request"** — `clawcode mcp-tracker` IPC call returns Invalid Request from daemon. Likely IPC schema mismatch between client request shape and `daemon.ts:5285+` handler registration. Plan 03 tests passed (mocked IPC), but real production wiring has a gap. Hot-fix: small (probably 1-2 lines schema or method-name correction). Track as 999.15 post-deploy follow-up.

## Open Bugs (post-115-08 deploy, surfaced by quick task 260511-mfn)

- **Phase 115-08 split-latency producers SILENT in production — FIXED 2026-05-11 (commit `a0f30a6` — port shipped, awaiting deploy clearance).** Two parallel session-handle implementations existed in source: `src/manager/session-adapter.ts:1336:iterateWithTracing` (test-only, invoked via `wrapSdkQuery` / `createTracedSessionHandle`) had the 4 producer call sites, but production runs `src/manager/persistent-session-handle.ts:333:iterateUntilResult` (via `daemon.ts:18,2287` → `SdkSessionAdapter` → `template-driver.ts:55,121` → `createPersistentSessionHandle`), which had NO producer calls. So `tool_execution_ms` / `tool_roundtrip_ms` / `parallel_tool_call_count` were silently NULL fleet-wide. **Fix:** quick task 260512 ported the 4 producer call sites verbatim into `iterateUntilResult` (per-tool `addToolExecutionMs` on tool_result, per-batch `addToolRoundtripMs` open/close on parent assistant transitions, `recordParallelToolCallCount` per parent assistant, and final-batch fallbacks inside `closeAllSpans`). Surgical port — no refactor. Added two regression guards: `src/manager/__tests__/producer-call-sites-sentinel.test.ts` (static-grep sentinel pinning the call sites in BOTH files — silent-path-bifurcation anti-pattern guard) and `src/manager/__tests__/persistent-session-handle-producer-port.test.ts` (end-to-end integration test driving the real `iterateUntilResult` through `createPersistentSessionHandle` with a synthetic tool_use→tool_result→result sequence, asserting the persisted TurnRecord carries non-zero values on all three split-latency fields). All 11 new tests pass; 222 tests across `src/manager/__tests__/persistent-session-handle*.test.ts` + `src/performance/__tests__/` pass with zero regressions. The 17 manager-tests failures observed on master are pre-existing (verified by stash) and unrelated. **Deploy:** awaiting operator clearance (Ramy-active hold still in effect). Once deployed, fleet `traces.db` will populate the three columns; F07 in Plan 116-02 can switch from `trace_spans` fallback to direct column reads.
- **`clawcode tool-latency-audit` CLI: "Invalid Request"** — same flavor as the mcp-tracker bug. May share root cause with the producer regression above OR may be a separate IPC-handler bug; investigation deferred until the producer port lands. Direct SQLite read against agent `traces.db` files is the working fallback. See `.planning/quick/260511-mfn-*/260511-mfn-AUDIT-FINDINGS.md` "Finding C".

## Open Bugs (post-116 deploy, 2026-05-11 22:55 UTC + cache hotfix `5975a1b`)

Audit summary doc: `.planning/phases/116-dashboard-redesign-modern-ui-mobile-basic-advanced/116-POSTDEPLOY-AUDIT.md`.

- **FIXED 2026-05-11 (commits `d7ad15a`, `6809fbc` — awaiting deploy clearance)**:
  - Bug 1: costs chart legend overflow (subagent series spam). `parentAgentName()` helper added; top-7 + "other" bucketing in `CostDashboard.tsx`.
  - Bug 2: conversations transcript pane missing. `list-recent-turns` IPC handler extended with optional `sessionId`; `useSessionTurns` hook + `TranscriptPane` added to `ConversationsView`.
- **STILL OPEN: fleet tile grid + comparison table subagent cardinality.** `/dashboard/v2/` BasicMode and `/dashboard/v2/fleet` use `useAgents()` → `/api/status` which returns the full registry including every subagent thread. With ~100 active threads, both surfaces will balloon similarly to the costs chart did. Knowledge graph agent picker has the same noise. Fix needs a "Show subagents" toggle (default OFF) gated on `parentAgentName(name) === name`. Mini-plan candidate — not rushed into the post-deploy pass. The Bug 1 client helper at `src/dashboard/client/src/lib/agent-name.ts` is the ready-made primitive to use.
