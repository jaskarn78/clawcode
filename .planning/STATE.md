---
gsd_state_version: 1.0
milestone: v2.2
milestone_name: OpenClaw Parity & Polish
status: Executing
stopped_at: Completed 85-01-PLAN.md — MCP readiness gate + mcp-reconnect heartbeat landed (TOOL-01/03/04)
last_updated: "2026-04-21T19:59:00.000Z"
last_activity: 2026-04-21
progress:
  total_phases: 12
  completed_phases: 2
  total_plans: 9
  completed_plans: 7
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-21)

**Core value:** Persistent, intelligent AI agents that each maintain their own identity, memory, and workspace -- communicating naturally through Discord channels without manual orchestration overhead.
**Current focus:** Phase 85 — MCP Tool Awareness & Reliability (Plan 01 complete; 02-03 pending)

## Current Position

Phase: 85
Plan: 02 (next)

## Performance Metrics

**Velocity:**

- Total plans completed: 70+ (v1.0-v2.1 across 12 milestones)
- Average duration: ~3.5 min
- Total execution time: ~4+ hours

**Recent Trend:**

- v2.1 plans: stable 5-32min each (40 plans shipped in ~1 day)
- Trend: Stable

*Updated after each plan completion*

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

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260418-sux | Fix schedule display field mismatch and add registry ghost-entry reconciliation | 2026-04-18 | 3d4ff24 | [260418-sux-fix-schedule-display-field-mismatch-and-](./quick/260418-sux-fix-schedule-display-field-mismatch-and-/) |
| 260419-jtk | Harden OpenAI streaming for OpenClaw: usage trailing chunk + tool-call verify + warm-path startup race | 2026-04-19 | 18252fe | [260419-jtk-harden-openai-streaming-for-openclaw-emi](./quick/260419-jtk-harden-openai-streaming-for-openclaw-emi/) |
| 260419-mvh | Fix initMemory→warm-path cascade + add OpenAI request/payload JSONL logging + `openai-log tail` CLI | 2026-04-19 | 34dfb83 | [260419-mvh-fix-initmemory-warm-path-cascade-add-ope](./quick/260419-mvh-fix-initmemory-warm-path-cascade-add-ope/) |
| 260419-nic | Discord `/clawcode-interrupt` + `/clawcode-steer` slash commands — mid-turn abort + steering via Phase 73 interrupt primitive | 2026-04-19 | 8ff6780 | [260419-nic-add-discord-stop-and-steer-slash-command](./quick/260419-nic-add-discord-stop-and-steer-slash-command/) |
| 260419-p51 | Multi-agent bearer keys (scope=all) + composite-PK session index + fork-escalation regression pin + spawn-subagent UX docs | 2026-04-19 | edecd6e | [260419-p51-multi-agent-bearer-keys-fork-escalation-](./quick/260419-p51-multi-agent-bearer-keys-fork-escalation-/) |
| 260419-q2z | Registry atomic write + recovery + `clawcode registry repair` CLI + always-summarize short sessions + graceful shutdown drain (FIX A+B+C) | 2026-04-19 | fa34ef3 | [260419-q2z-registry-atomic-write-graceful-shutdown-](./quick/260419-q2z-registry-atomic-write-graceful-shutdown-/) |
| Phase 83 P01 | 32 | 2 tasks | 13 files |
| Phase 83 P03 | 17min 22s | 2 tasks | 11 files |
| Phase 83 P02 | 22min 13s | 2 tasks | 6 files |
| Phase 84 P01 | ~25min | 2 tasks (TDD) | 8 files |
| Phase 84 P02 | 17min 0s | 2 tasks | 14 files |
| Phase 84 P03 | 6min 23s | 1 tasks | 4 files |
| Phase 85 P01 | 30min 24s | 2 tasks (TDD) | 15 files |

## Session Continuity

Last activity: 2026-04-21
Stopped at: Completed 85-01-PLAN.md — MCP readiness gate + mcp-reconnect heartbeat landed (TOOL-01/03/04)
Resume: Execute 85-02-PLAN.md (two-block prompt-builder MCP tools section — stable prefix tool list + mutable suffix live status table) — Plan 02 can now read `SessionHandle.getMcpState()` directly without reaching into SessionManager internals
