---
gsd_state_version: 1.0
milestone: v2.2
milestone_name: OpenClaw Parity & Polish
status: Ready to execute
stopped_at: Completed 83-03-PLAN.md (UI-01 choices + EFFORT-07 status line + EFFORT-05 per-skill frontmatter override)
last_updated: "2026-04-21T17:56:44.266Z"
last_activity: 2026-04-21
progress:
  total_phases: 12
  completed_phases: 0
  total_plans: 3
  completed_plans: 2
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-21)

**Core value:** Persistent, intelligent AI agents that each maintain their own identity, memory, and workspace -- communicating naturally through Discord channels without manual orchestration overhead.
**Current focus:** Phase 83 — Extended-Thinking Effort Mapping

## Current Position

Phase: 83 (Extended-Thinking Effort Mapping) — EXECUTING
Plan: 2 of 3

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

## Session Continuity

Last activity: 2026-04-21
Stopped at: Completed 83-03-PLAN.md (UI-01 choices + EFFORT-07 status line + EFFORT-05 per-skill frontmatter override)
Resume: Run `/gsd:plan-phase 83` to decompose Extended-Thinking Effort Mapping into plans
