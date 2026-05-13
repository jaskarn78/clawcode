# v2.2 OpenClaw Parity & Polish — Research Synthesis

**Milestone:** v2.2 OpenClaw Parity & Polish
**Date:** 2026-04-21
**Confidence:** HIGH

## Executive Summary

v2.2 is a tightly-scoped milestone with **zero new runtime dependencies**. Every capability needed is already in the on-box stack (Claude Agent SDK 0.2.97, discord.js 14.26.2, better-sqlite3, sqlite-vec). The work is almost entirely **wiring SDK surfaces that were skeletonized but never connected** — the clearest example is `persistent-session-handle.ts:599-602`, which carries a literal `// Future: q.setMaxThinkingTokens()` TODO that v2.2 closes.

Three recurrent risk patterns across all four features:
1. **Silent no-ops that report success** (the effort-mapping P0 bug is the canonical example)
2. **Write-paths that fight existing systems** (YAML hot-reload firing mid-turn when `/clawcode-model` mutates `clawcode.yaml`)
3. **Credential exposure** that must gate any skills migration (`finmentum-crm` SKILL.md contains literal MySQL creds in its description)

## Stack Additions

**Zero new npm `dependencies`.** One optional `devDependency` (`gray-matter`) is explicitly rejected — in-tree scanner regex handles every observed SKILL.md shape.

| Feature | Primary existing surface | Gap |
|---------|--------------------------|-----|
| 1. Skills migration | `src/skills/scanner.ts`, `installer.ts`, `linker.ts` | One-shot CLI migration tool — pure filesystem work |
| 2. Effort mapping | `Query.setMaxThinkingTokens()`, `thinking: ThinkingConfig`, `effort: EffortLevel` | Fill the TODO at `persistent-session-handle.ts:599` |
| 3. Dual model picker | discord.js `StringSelectMenuBuilder` + autocomplete, OpenClaw picker pref JSON | New `agents[*].allowedModels` schema field; materialize an allowlist JSON for OpenClaw picker to read |
| 4. Native CC slash commands | `Query.supportedCommands()` → `SlashCommand[]`; `Query.setModel/setPermissionMode/setMaxThinkingTokens` | Registration loop + dispatch split: prompt-channel vs control-plane |

**Pin:** `@anthropic-ai/claude-agent-sdk` to exact `0.2.97` (not `^0.2.97`) given pre-1.0 churn.

## Feature Table Stakes

**F1 — Skills migration:**
- Idempotent port preserving directory structure (SKILL.md + scripts/ + references/)
- Per-agent linker verification
- Frontmatter normalization for legacy skills (tuya-ac, workspace-janitor lack frontmatter)
- Skip `.retired` / deprecate-list (cognitive-memory, openclaw-config, finmentum-content-creator.retired)
- **Secret scan** of every skill file before copy (finmentum-crm contains literal MySQL creds)

**F2 — Effort mapping:**
- Persist effort on session (long-lived sessions need it across restart)
- Per-agent default in `defaults.effort` + `agents[*].effort`
- `/clawcode-effort` actually wires to SDK (fix the silent no-op)
- Honor `MAX_THINKING_TOKENS=0` for explicit OFF semantics
- Support `auto` to reset to model default (parity with native `/effort auto`)

**F3 — Dual model picker:**
- Add `allowedModels: string[]` to `agents[*]` schema (inherit from `defaults.allowedModels`)
- `/clawcode-model` dispatches directly via IPC to SessionManager (not LLM prompt)
- Model change persists atomically (v2.1 writer pattern)
- OpenClaw picker reads `clawcode/*` entries from a materialized allowlist JSON (not live clawcode.yaml — avoids watcher contention)
- Cache-invalidation confirmation UX when prior conversation exists
- Per-agent recent-models memory

**F4 — Native CC slash commands:**
- Read `system/init.slash_commands` at session start; register only SDK-reported commands (no hardcoded list)
- Dispatch via SDK prompt input per docs
- Unify duplicate clawcode-* commands (`-model`, `-effort`, `-compact`, `-usage`) to native SDK
- Per-agent filtering respects v1.2 SECURITY.md ACLs
- Parse native command output → Discord via v1.7 `ProgressiveMessageEditor` streaming

## Architecture Integration Points

| Feature | Key file:line integration | Risk |
|---------|---------------------------|------|
| F1 | New: `src/cli/commands/migrate-skills.ts` (or reuse `src/migration/` ledger pattern); target: `~/.clawcode/skills/` via v1.4 global-install | LOW |
| F2 | `persistent-session-handle.ts:599` (add `q.setMaxThinkingTokens(mapEffort(level))`) | LOW — one-line wire + test |
| F3 | `daemon.ts:2550` (existing `set-model` IPC), new `SessionHandle.setModel()` + allowlist writer, Zod schema extension in `config/schema.ts` | MEDIUM — hot-reload classification + confirmation UX |
| F4 | Extend `src/discord/slash-commands.ts:110-175` per-agent loop + new dispatch fork (prompt vs control-plane) | **HIGH — requires 30-min SDK spike on mid-session `q.setModel()` concurrency** |

**Contracts that must not change:** `SessionHandle` public surface, `TurnDispatcher.dispatch/dispatchStream`, `SessionManager.setEffortForAgent/getEffortForAgent`, `IPC_METHODS` tuple, `SkillsCatalog` shape, `ResolvedAgentConfig.effort/.model`, `DEFAULT_SLASH_COMMANDS` naming (keep `clawcode-*` prefix).

## Critical Pitfalls

1. **P0 latent bug:** `persistent-session-handle.ts:599-602` — `setEffort()` stores level locally but never calls `q.setMaxThinkingTokens()`. `/clawcode-effort` has been reporting success while doing nothing. **Fix first, with query-options spy test.**

2. **Secret leak blocker:** `finmentum-crm` SKILL.md embeds `mysql_host/port/user/password` values. If copied into `defaults.skills`, those appear in every agent's system prompt. Phase 1 must gate on secret scan before any copy.

3. **SDK dispatch gap:** `/clear`, `/mcp`, some `/config` variants are **not SDK-dispatchable** per official docs. Sending them as text prompts produces silent correctness failures (LLM acknowledges "I've cleared" while context is untouched). Phase 4 must start with a per-command SDK-reachability audit, not code.

4. **Hot-reload collision:** `agents.*.model` is classified non-reloadable in `types.ts:58`. If `/clawcode-model` writes clawcode.yaml, chokidar fires a session restart mid-turn. **Dual-picker must use IPC-only writes**, not YAML mutation (or defer YAML write until turn boundary).

5. **Fork inheritance:** `buildForkConfig` doesn't reset `currentEffort`. Advisor-escalation at effort=max → 5-10× cost spike per call.

6. **Discord 100-command cap:** Existing code dedupes by name correctly. Naive per-agent native-CC registration would hit the cap at 15 agents × 7 commands. Must keep per-guild (not per-channel) dedup.

7. **Cross-feature:** Schema extension for `reasoning_effort` / `allowedModels` must remain additive (optional fields) — breaking v2.1 migrated configs is unacceptable.

## Recommended Phase Structure (4 phases)

1. **Phase 83 — Effort Mapping Fix** (Feature 2, SDK canary)
   - Closes the P0 silent no-op
   - Proves mid-session SDK mutation strategy for Feature 4
   - Smallest surface: one SDK wire + fork reset + spy test
   - Unblocks Features 3/4

2. **Phase 84 — Skills Library Migration** (Feature 1, parallel-safe)
   - Fully independent CLI-only phase
   - Hard gate: secret-scan pass before any copy
   - Reuses v2.1 atomic writer + ledger pattern for migration report
   - Per-skill verdict: migrate / skip / deprecate
   - Scope tags to avoid linking Finmentum skills on non-Finmentum agents

3. **Phase 85 — Dual Discord Model Picker** (Feature 3)
   - Adds `allowedModels` schema field (additive, optional)
   - `SessionHandle.setModel()` addition
   - Fixes documented `/model` LLM-prompt tech debt
   - Materializes picker allowlist JSON for OpenClaw side
   - Locks unified `clawcode-*` namespace convention before Feature 4

4. **Phase 86 — Native CC Slash Commands** (Feature 4, highest risk)
   - **Prereq:** 30-min SDK spike confirming `q.setModel()` / `q.setPermissionMode()` mid-session behavior
   - Per-command SDK-reachability audit (map each native to: prompt-channel / control-plane / not-available)
   - Registration: extend `slash-commands.ts` per-agent loop, dedupe against existing clawcode-*
   - Dispatch split: prompt-input for `/compact`/`/context`/`/cost` etc.; `Query.setX()` for `/model`/`/permissions`; session-restart for `/clear`
   - Output parse → Discord streaming via v1.7 `ProgressiveMessageEditor`

## Research Flags

**Needs spike before implementation (Phase 86 only):**
- SDK mid-session mutation concurrency against single `driverIter` handle
- `system/init.slash_commands` manifest completeness (docs only show 3 examples)
- `/export` non-interactive behavior with filename arg

**Standard patterns (Phases 83/84/85):** All integration points directly inspected in source. No unknowns. Proceed to phase-level discuss/plan.

## Open Questions

- Does `fallbackModels` enter clawcode.yaml schema in Phase 85, or is `model` + `allowedModels` sufficient?
- `/clear` semantics — restart session with suppressed resume-summary, or defer as out-of-scope? Recommendation: defer.
- Should runtime model overrides persist across daemon restart (new `.runtime-state.json`)? Recommendation: no (match existing `setEffort` non-persistence).
- `/todos` worth exposing? Agent SDK doesn't persist `TodoWrite` state across `query()` iterations.
- Destructive command ACLs — lean on Discord `default_member_permissions` or new Discord-role table?

## Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| Stack additions | HIGH | Every version checked against installed `sdk.d.ts` and `npm view` |
| Feature 1 landscape | HIGH | Direct filesystem scan + 11 SKILL.md files read |
| Feature 2 landscape | HIGH | Source read (`claude.js`, `sdk.d.ts`); P0 bug verified in codebase |
| Feature 3 landscape | HIGH | Pref file inspected; discord.js primitives confirmed |
| Feature 4 landscape | HIGH | Docs fetched verbatim; SDK dispatch constraint quoted |
| Architecture integration | HIGH for F1-3, MEDIUM for F4 | F4 mid-session mutation is type-safe but runtime-unproven |
| Pitfalls | HIGH | Every claim traced to file:line; credential leak verified by direct read |

## Ready for Requirements

All four research artifacts complete. Roadmap planner can proceed with phase mapping. Starting phase number continues from v2.1 → Phase 83.
