# Phase 87: Native CC Slash Commands - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped for autonomous run)

<domain>
## Phase Boundary

Every SDK-reported slash command (per `system/init.slash_commands`) is registered as a per-agent Discord slash command with `clawcode-` prefix. Dispatched through correct channel: control-plane SDK method (`setModel`/`setPermissionMode`/`setMaxThinkingTokens`) vs prompt-channel (`TurnDispatcher`). Existing duplicate clawcode-* commands unified onto native path.

**Requirements:** CMD-00..07 + UI-01.

**Depends on:** Phase 83 (effort SDK canary ✅), Phase 86 (model unification + namespace ✅), CMD-00 SDK spike ✅ (at `.planning/research/CMD-SDK-SPIKE.md`).

</domain>

<decisions>
## Implementation Decisions

### From CMD-00 spike (key facts to use)
- `Query.initializationResult()` (sdk.d.ts:1748) returns commands + agents + models + skills in one round-trip — preferred discovery primitive
- `Query.supportedCommands()` (sdk.d.ts:1754) returns `SlashCommand[]` with `{name, description, argumentHint}` — use this for Discord descriptions
- `setPermissionMode` safe by identical design to `setModel`/`setMaxThinkingTokens`; add spy test mirroring Phase 86
- `/export` NOT SDK-dispatchable — defer
- `/clear` NOT SDK-dispatchable — defer to MKT-F2 / future (session-restart workaround out of scope v2.2)
- Bundled skills in separate `skills: string[]` field, may not appear in slash_commands — verify empirically

### Constraints
- Zero new npm deps
- Hardcoded native-command allowlists FORBIDDEN — discovery is runtime via SDK
- Unify existing duplicates: `clawcode-compact` → `/compact`, `clawcode-usage` → `/cost`, `clawcode-model` ← already fixed Phase 86, `clawcode-effort` ← already fixed Phase 83
- Register with `clawcode-` prefix (e.g., `/clawcode-context`, `/clawcode-cost`)
- SECURITY.md ACLs gate admin commands (`/init`, `/security-review`, `/batch`)
- Discord 100-command-per-guild cap (existing per-guild name-dedupe)
- Output streams via v1.7 ProgressiveMessageEditor (reuse, no new streaming primitive)

</decisions>

<code_context>
## Existing Code Insights
- `src/discord/slash-commands.ts` — CONTROL_COMMANDS pattern (Phases 85, 86 already added entries)
- `src/manager/persistent-session-handle.ts` — setModel + setMaxThinkingTokens already wired (Phases 83, 86). Add setPermissionMode.
- `src/manager/session-adapter.ts` — SDK query integration
- `src/manager/turn-dispatcher.ts` — prompt-channel dispatch
- `src/security/acl-parser.ts` — SECURITY.md ACL parser

</code_context>

<specifics>
None beyond REQUIREMENTS.md.
</specifics>

<deferred>
- `/clear` via session-restart workaround (CMD-F2)
- `/export` (not SDK-dispatchable)
- `/review` + `/security-review` wired to PR-webhook flows (CMD-F1)
- Native `/insights` weekly embed (CMD-F3)
</deferred>
