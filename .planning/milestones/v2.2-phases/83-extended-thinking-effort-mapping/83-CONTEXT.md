# Phase 83: Extended-Thinking Effort Mapping - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss for autonomous run)

<domain>
## Phase Boundary

Users can change a running agent's reasoning effort from Discord and have it actually take effect on the next SDK turn — including the "off" disable, the `auto` reset, per-skill overrides, and fork quarantine.

**Requirements in scope:** EFFORT-01 through EFFORT-07 (wire `/clawcode-effort` to `Query.setMaxThinkingTokens()`, add `defaults.effort` + `agents[*].effort` schema, persist across restart, support `low/medium/high/max/auto/off`, per-skill `effort:` frontmatter override, fork resets to baseline, `/clawcode-status` reports current effort). UI-01 cross-cutting (native Discord UI for any picker element).

**P0 bug:** `persistent-session-handle.ts:599-602` — `setEffort()` stores level locally but never calls `q.setMaxThinkingTokens()`. This is the root silent-no-op to fix.

**SDK canary role:** This phase validates mid-session `Query.setMaxThinkingTokens()` concurrency safety for the `driverIter` handle — blueprint for Phase 86's `setModel()` and Phase 87's `setPermissionMode()`.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — discuss phase was skipped per workflow.skip_discuss. Use ROADMAP phase goal, success criteria, REQUIREMENTS.md (EFFORT-01..07 + UI-01), and research artifacts (`.planning/research/STACK.md`, `.planning/research/FEATURES.md`, `.planning/research/ARCHITECTURE.md`, `.planning/research/PITFALLS.md`, `.planning/research/SUMMARY.md`) to guide decisions.

### Known constraints from research
- Zero new npm deps; SDK 0.2.97 exposes `Query.setMaxThinkingTokens(n | null)`, `thinking: ThinkingConfig`, `effort: EffortLevel`
- OpenClaw mapping (from `openclaw-claude-bridge/src/claude.js:48-58, 107-118`): `minimal→low, low→medium, medium→high, high→max, xhigh→max, unset→MAX_THINKING_TOKENS=0`
- v2.2 uses native Claude CLI level names directly: `low | medium | high | xhigh | max | auto | off`
- Effort must be in v1.7 stable prefix (cached) OR mutable suffix — resolve per prompt-caching interaction research (PITFALLS.md)
- Fork reset enforced at `buildForkConfig` — no effort inheritance into Opus advisor
- Per-skill `effort:` frontmatter is native Claude Code format — reverts at turn boundary

</decisions>

<code_context>
## Existing Code Insights

Codebase context will be gathered during plan-phase research. Known integration points from research:
- `src/manager/persistent-session-handle.ts:599-602` — TODO comment + store level (fix site)
- `src/manager/session-adapter.ts:411,618` — effort flows to SDK
- `src/manager/session-manager.ts:527` — `setEffortForAgent` (exists)
- `src/config/schema.ts:13` — `effortSchema` (exists)
- `src/discord/slash-commands.ts:264-284` — `/clawcode-effort` validation
- `src/manager/daemon.ts:1800` — `set-effort`/`get-effort` IPC (exists)

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond REQUIREMENTS.md — discuss phase skipped. Plan-phase should treat the research artifacts as the spec.

</specifics>

<deferred>
## Deferred Ideas

- Auto-escalate effort to max on fork-to-Opus (EFFORT-F1) — deferred to future milestone
- Exposing raw `MAX_THINKING_TOKENS=<N>` values to users — explicitly out of scope

</deferred>
