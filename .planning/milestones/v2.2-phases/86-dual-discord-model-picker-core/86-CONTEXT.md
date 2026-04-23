# Phase 86: Dual Discord Model Picker (Core) - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped for autonomous run)

<domain>
## Phase Boundary

Users can change a running agent's model from Discord via direct IPC dispatch (no LLM-prompt round-trip), restricted to per-agent `allowedModels` allowlist, persisted atomically to `clawcode.yaml`, with cache-invalidation UX mirroring native `/model`.

**Requirements:** MODEL-01..07 + UI-01.

**Depends on:** Phase 83 (SDK canary — mid-session `Query.setModel()` concurrency proven by effort-mapping wiring).

**Scope reduction:** "Dual picker" (OpenClaw side reads materialized allowlist JSON) is DEFERRED to MODEL-F1 per user decision. v2.2 ships only the **ClawCode core picker**.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
Per CONTEXT.md conventions. Use REQUIREMENTS.md MODEL-01..07 + UI-01, ARCHITECTURE.md Phase 86 section (SessionHandle.setModel contract).

### Known constraints
- Zero new npm deps
- Fixes PROJECT.md tech debt: `/model slash command uses indirect claudeCommand routing through agent LLM`
- Depends on 83's spy-test pattern — apply same template to `Query.setModel()`
- `agents[*].allowedModels` new schema field — additive, optional, default `["haiku","sonnet","opus"]`
- Atomic YAML write reuses v2.1 writer pattern (preserves comments, passes secret-guard)
- Discord StringSelectMenuBuilder for picker UI (UI-01)
- Reject not-in-allowedModels with ephemeral error listing allowed values
- Cache-invalidation ephemeral confirmation mid-conversation

</decisions>

<code_context>
## Existing Code Insights

From research:
- `src/manager/session-manager.ts` — already has `setEffortForAgent` (Phase 83); add `setModelForAgent`
- `src/manager/persistent-session-handle.ts` — Phase 83 showed SDK mutation contract; add `setModel`
- `src/manager/daemon.ts:2550` — existing `set-model` IPC (may need wiring fix)
- `src/discord/slash-commands.ts`, `src/discord/slash-types.ts` — CONTROL_COMMANDS pattern (Phase 85 added `/clawcode-tools`)
- `src/config/schema.ts` — agentSchema / defaultsSchema extension point (Phase 83 added `effort`)
- `src/config/differ.ts` — RELOADABLE_FIELDS classification (Phase 83 added `effort`)

</code_context>

<specifics>
## Specific Ideas

None beyond REQUIREMENTS.md.

</specifics>

<deferred>
## Deferred Ideas

- Dual picker (OpenClaw side reads materialized allowlist JSON) — MODEL-F1
- Combined model+effort select-menu UI — MODEL-F2
- `fallbackModels` per agent — MODEL-F3

</deferred>
