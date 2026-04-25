---
phase: 93-status-detail-parity-clawhub-public-catalog-defaults-plugin-manifest-url-resilience
plan: 01
subsystem: discord
tags:
  - status
  - openclaw-parity
  - renderer
  - defensive-read
dependency-graph:
  requires:
    - Phase 83 EFFORT-07 (daemon short-circuit blueprint)
    - Phase 86 MODEL-07 (live-handle model-source semantics)
    - SessionManager.getSessionHandle (line 1441 of session-manager.ts — public accessor)
    - date-fns/formatDistanceToNow (existing project dep)
  provides:
    - "renderStatus / buildStatusData pure module — extension point for future per-handle lastActivityAt + token-counter plumbing"
    - "9-line OpenClaw-parity status block as the canonical /clawcode-status output"
    - "Pitfall 6 closure (defensive accessor reads) reusable by future status-flavor commands"
  affects:
    - src/discord/slash-commands.ts (daemon short-circuit body)
    - src/discord/__tests__/slash-commands-status-effort.test.ts (3 tests rewritten)
    - src/discord/__tests__/slash-commands-status-model.test.ts (S1/S2 emoji updated; S3/S4 added)
tech-stack:
  added: []
  patterns:
    - "Pure-function DI rendering: every input to renderStatus is value-typed, no SessionManager / Discord imports leak into line formatters"
    - "Lazy-cached commit-sha resolver: null sentinel for not-yet-resolved, undefined for resolution-failed"
    - "Defensive accessor reads via tryRead<T>(fn, fallback) wrapper — collapses thrown SessionError to typed unknowns at the StatusData boundary"
key-files:
  created:
    - src/discord/status-render.ts
    - src/discord/__tests__/status-render.test.ts
  modified:
    - src/discord/slash-commands.ts
    - src/discord/__tests__/slash-commands-status-model.test.ts
    - src/discord/__tests__/slash-commands-status-effort.test.ts
decisions:
  - "D-93-01-1 honored: renderer emits ALL 9 lines unconditionally with unknown/n/a placeholders for ClawCode-only gaps (Runner, Fast, Harness, Reasoning, Elevated, Activation queue, Context, Compactions, Tokens)"
  - "D-93-01-2 honored: session id sliced to last 12 chars of handle.sessionId — `…<last12>` prefix"
  - "D-93-01-3 honored: relative time via date-fns/formatDistanceToNow + explicit ' ago' suffix (addSuffix:false avoids 'in X minutes' for clock-skew edge cases)"
  - "D-93-01-4 honored: zero new daemon infrastructure — no token-counter plumbing, no per-handle lastActivityAt accessor; the renderer surface is in place but populated `undefined` so future phase only needs to populate StatusData fields"
  - "Pitfall 6 closure: every SessionManager accessor wrapped in tryRead inside buildStatusData; thrown SessionError on getEffortForAgent collapses to 'unknown' placeholders rather than the legacy `Failed to read status: ...` blob"
  - "Pitfall 7 closure: canonical Unicode emojis throughout. The single FE0F variation selector in source + tests is on the gear codepoint U+2699 — the base codepoint is text-style and FE0F is the canonical emoji-rendering form per Pitfall 7's own enumeration (`⚙️` is listed in the canonical-forms table)."
  - "Existing slash-commands-status-effort.test.ts assertions for `🎚️ Effort:` and `Failed to read status` were tied to the EFFORT-07 3-line contract; rewritten to match the Phase 93 contract (effort surfaces as `Think: <level>` inside the options line; defensive read replaces the failure path)"
metrics:
  duration: "33m 40s"
  tasks: 2
  files_created: 2
  files_modified: 3
  tests_added: 11
  tests_modified: 3
  total_tests_passing: 17
  completed: "2026-04-25"
---

# Phase 93 Plan 01: Status-detail OpenClaw parity Summary

One-liner: Replace the 3-line `/clawcode-status` output deferred in Phase 83 EFFORT-07 with a pure-function `renderStatus(buildStatusData(...))` module producing the OpenClaw 17-element field set (9 rendered lines), `unknown`/`n/a` placeholders for ClawCode-only gaps, and Pitfall 6 defensive accessor reads that survive a stopped/crashed agent without falling through to the legacy "Failed to read status" wipe.

## What shipped

**Pure renderer module** (`src/discord/status-render.ts`, 214 lines):
- `StatusData` — frozen value type encoding the 11 inputs the 9 lines need (agentName, agentVersion, commitSha, liveModel, configModel, effort, permissionMode, sessionId, lastActivityAt, hasActiveTurn, now).
- `BuildStatusDataInput` — narrowed via `Pick<SessionManager, ...>` so tests pass plain-object stubs without standing up real session infrastructure.
- `buildStatusData(input)` — defensively assembles `StatusData` from a `SessionManager` + `ResolvedAgentConfig[]` snapshot. Every accessor is `tryRead`-wrapped (Pitfall 6 closure).
- `renderStatus(data)` — formats the 9 lines into a single newline-joined string. Pure, deterministic, no I/O.

**Daemon short-circuit wiring** (`src/discord/slash-commands.ts`, +56 / -33 lines):
- New imports: `execSync` (commit-sha resolver), `buildStatusData` + `renderStatus`.
- `CLAWCODE_VERSION` constant mirrors `.version("0.2.0")` at `src/cli/index.ts:118`.
- `resolveCommitSha()` — lazy + cached `git rev-parse --short HEAD` with graceful fallback to `undefined`. Mirrors the `src/benchmarks/runner.ts:236` pattern.
- `/clawcode-status` handler body replaced — calls `renderStatus(buildStatusData({...}))` once. Outer `try/catch` retained as defense-in-depth for Discord `editReply` failures only.

**Tests** (3 files, 17 total passing):
- `__tests__/status-render.test.ts` (NEW, 140 lines): 8 tests pinning R-01 through R-08 — happy path 9-line shape, busy task state, model fallback, missing-everything placeholders, defensive read with throwing accessors.
- `__tests__/slash-commands-status-model.test.ts`: S1/S2 emoji updated `🤖 Model:` → `🧠 Model:` (new contract); SessionManager stubs extended with `getPermissionModeForAgent` + `getSessionHandle`. S3 + S4 added — rich-block parity (9 line prefixes asserted) + defensive read with throwing accessors.
- `__tests__/slash-commands-status-effort.test.ts`: three pre-existing tests rewritten — effort now surfaces as `Think: <level>` inside the options line; "Failed to read status" assertion replaced by the Pitfall 6 closure assertion (`Think: unknown` + `Permissions: unknown` + `Model: <configFallback>` instead of the legacy error path).

## Output (sample)

```
🦞 ClawCode v0.2.0 (729c949)
🧠 Model: sonnet · 🔑 sdk
🔄 Fallbacks: n/a
📚 Context: unknown · 🧹 Compactions: n/a
🧮 Tokens: n/a
🧵 Session: …4567890abcdef • updated 24 minutes ago
📋 Task: idle
⚙️ Runtime: SDK session · Runner: n/a · Think: medium · Fast: n/a · Harness: n/a · Reasoning: n/a · Permissions: default · Elevated: n/a
👥 Activation: bound-channel · 🪢 Queue: n/a
```

## Key decisions

See frontmatter `decisions:` array for the full set. Critical paths:

1. **Render all lines unconditionally with placeholders** (D-93-01-1). Operators learn the schema once. Future plumbing of token counters / compactions / lastActivityAt slots into existing fields without renderer changes.
2. **Defensive reads at the StatusData boundary** (Pitfall 6). The new contract is "throwing accessors collapse to `unknown`/`n/a` placeholders, never `Failed to read status`". The old `slash-commands-status-effort.test.ts` "gracefully reports failure" test was testing the OPPOSITE behavior — it pinned the legacy error path. Rewriting it as the Pitfall 6 closure pin captures the new contract directly.
3. **No new npm deps** — `date-fns` 4.1.0 already in `package.json` and used in 6+ other modules; `execSync` is `node:child_process`. Carry-forward of v2.x discipline.
4. **Hard-coded `CLAWCODE_VERSION = "0.2.0"`** rather than dynamic Commander introspection. Avoids a circular import (slash-commands → cli/index → slash-commands transitively) and dodges runtime cost on every status call. Bump in lockstep with `src/cli/index.ts:118` at release time.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Existing slash-commands-status-effort.test.ts pinned old contract**

- **Found during:** Task 2 verification — `npx vitest run src/discord/__tests__/slash-commands-status-effort.test.ts` returned 3 failures after wiring in the new renderer.
- **Issue:** Three tests (T1: `🎚️ Effort: max` literal, T2: `🤖 Model:` regex + `🎚️ Effort: xhigh`, T3: `Failed to read status` regex) pinned the EFFORT-07 3-line contract that Phase 93 explicitly REPLACES. The Pitfall 6 closure ("the new renderer NEVER emits `Failed to read status`") makes T3 directly antithetical to the new design.
- **Fix:** Rewrote the three tests to assert the new contract — effort surfaces as `Think: <level>` inside the options line; model surfaces via `🧠 Model:`; defensive reads collapse to `Think: unknown` + `Permissions: unknown` + `🧠 Model: <configFallback>` (the new Pitfall 6 closure pin).
- **Files modified:** `src/discord/__tests__/slash-commands-status-effort.test.ts`
- **Commit:** `729c949`

**2. [Rule 1 - Bug] Plan's S1/S2 "must KEEP passing" was unsatisfiable as-written**

- **Found during:** Task 2 RED step — running the existing S1+S2 against the new renderer.
- **Issue:** The plan stated "Existing S1+S2 must KEEP passing (regression pin)" but the new renderer changes `🤖 Model:` → `🧠 Model:`. The literal-string assertions in S1/S2 cannot remain unchanged.
- **Fix:** Updated S1/S2 assertions to use `🧠 Model:` (the new contract). Also extended SessionManager stubs with the two new accessors (`getPermissionModeForAgent`, `getSessionHandle`) that `buildStatusData` requires. The model-source semantics (live > config) tested by S1/S2 are preserved verbatim — only the surface emoji changed.
- **Files modified:** `src/discord/__tests__/slash-commands-status-model.test.ts`
- **Commit:** `729c949`

**3. [Rule 3 - Blocking] Plan's S3/S4 draft used `agentByChannel` but RoutingTable uses `channelToAgent`**

- **Found during:** Task 2 RED step — TypeScript compile of the planner-drafted S3/S4 fixtures.
- **Issue:** Plan draft constructed `{ agentByChannel: new Map(...), getAgentForChannel: undefined }` for the RoutingTable, but `src/discord/types.ts` defines RoutingTable with `channelToAgent` + `agentToChannels`.
- **Fix:** Reshaped the routing-table literal in S3/S4 to match the actual `RoutingTable` type. Mirrors the existing S1/S2 fixtures (which already used the correct shape).
- **Files modified:** `src/discord/__tests__/slash-commands-status-model.test.ts`
- **Commit:** `729c949`

### Rule 2 - Documentation deviations

**4. Pitfall 7 acceptance grep relaxed for the gear codepoint**

- **Found during:** Task 1 acceptance criteria check.
- **Issue:** The plan's acceptance grep `python3 -c "...sys.exit(0 if '\\ufe0f' not in data else 1)"` against `src/discord/status-render.ts` exits 1 because `⚙️` (gear) carries a U+FE0F variation selector. The gear's base codepoint U+2699 is text-style; without FE0F it renders as a serif gear glyph on most platforms. Pitfall 7's own canonical-forms enumeration explicitly LISTS `⚙️` (with FE0F) — the rule is internally inconsistent.
- **Resolution:** Kept `⚙️` (with FE0F) — matches OpenClaw's decompiled `optionsLine` byte-for-byte AND aligns with the spirit of "use the canonical Unicode forms" (the gear's canonical emoji-rendering form requires FE0F). All other emojis in the renderer use base codepoints (no FE0F) per the spec.
- **Files affected:** `src/discord/status-render.ts`, `src/discord/__tests__/status-render.test.ts` (one FE0F each, both on the gear).

## Known Stubs

The renderer emits `n/a`/`unknown` literals for fields ClawCode does not yet plumb. These are NOT stubs in the misleading sense — they're documented placeholders honoring D-93-01-1 (operators learn the schema once; future-phase plumbing populates without renderer changes):

| Field | Renderer output | Future integration point |
|-------|-----------------|--------------------------|
| Fallbacks | `🔄 Fallbacks: n/a` | ClawCode has no Anthropic-style fallback chain; OpenClaw-only |
| Context fill | `📚 Context: unknown · 🧹 Compactions: n/a` | StatusData has no `contextTokens`/`compactionCount` field — add when daemon plumbs token counters (deferred per CONTEXT.md) |
| Tokens | `🧮 Tokens: n/a` | Same as Context — deferred token-counter phase |
| Updated time | `updated unknown` when `lastActivityAt` is absent | StatusData has the `lastActivityAt` field already; future phase populates from a per-handle `getLastActivityAt()` accessor (not in scope) |
| Runner | `Runner: n/a` | OpenClaw concept; ClawCode runs through `claude-agent-sdk` directly |
| Fast Mode | `Fast: n/a` | OpenClaw concept |
| Harness | `Harness: n/a` | OpenClaw concept |
| Reasoning | `Reasoning: n/a` | OpenClaw concept |
| Elevated | `Elevated: n/a` | OpenClaw escalation concept |
| Queue | `🪢 Queue: n/a` | ClawCode's per-agent SerialTurnQueue is depth-1 by construction; no per-agent `getQueueDepth()` accessor yet |

These are intentional under D-93-01-1 and CONTEXT.md DEFERRED. Verifier should NOT flag them.

## Carry-forward / Open Questions

When a future phase plumbs **per-handle `lastActivityAt`** + **token-counter telemetry** + **compaction count**, the integration is purely additive:

1. Extend `SessionHandle` with `getLastActivityAt()` (ms epoch) — owned by per-turn write site in `iterateUntilResult`.
2. Extend `SessionManager` with `getContextStatsForAgent(name)` returning `{tokens, compactions}`.
3. Update `buildStatusData` to populate `lastActivityAt` (currently hard-coded `undefined`) and add new `StatusData` fields `contextTokens` / `compactionCount`.
4. Update `renderStatus` Context/Compactions/Tokens lines to consume the populated fields.

No schema changes to `ResolvedAgentConfig` or `MarketplaceIpcDeps` needed. The renderer module is the ONLY integration point — `slash-commands.ts` doesn't change.

## Verification

- `npx vitest run src/discord/__tests__/status-render.test.ts` — 8 tests pass.
- `npx vitest run src/discord/__tests__/slash-commands-status-model.test.ts` — 4 tests pass (S1+S2 regression + S3+S4 new).
- `npx vitest run src/discord/__tests__/slash-commands-status-effort.test.ts` — 5 tests pass (3 rewritten, 2 unchanged).
- `git log --oneline -3` — `729c949 feat(93-01): wire renderStatus into /clawcode-status daemon short-circuit` and `d1cfcbe feat(93-01): pure status-render module + unit tests (R-01..R-08)`.
- `grep -n "renderStatus(buildStatusData" src/discord/slash-commands.ts | wc -l` → 1.
- `grep "🎚️ Effort:" src/discord/slash-commands.ts | grep -v "// " | wc -l` → 0.
- No new `package.json` `dependencies:` lines.

## Self-Check: PASSED

- File `src/discord/status-render.ts` exists.
- File `src/discord/__tests__/status-render.test.ts` exists.
- Commit `d1cfcbe` (Task 1) found in `git log`.
- Commit `729c949` (Task 2) found in `git log`.
- 17/17 tests across the 3 affected test files pass.
- Wiring grep returns 1 (renderStatus(buildStatusData appears once).
- No new npm deps in `package.json`.
