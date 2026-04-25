---
phase: 94-tool-reliability-self-awareness
plan: 07
subsystem: discord
tags: [mcp, capability-probe, slash-command, cli, cross-agent-routing, ui-parity, di-pure]

# Dependency graph
requires:
  - phase: 85-mcp-tool-awareness-reliability
    provides: /clawcode-tools slash command, list-mcp-status IPC, EmbedBuilder rendering pattern, mcp-status CLI scaffold
  - phase: 94-tool-reliability-self-awareness/01-capability-probe-primitive
    provides: capabilityProbe field on McpServerState, 5-value CapabilityProbeStatus enum, list-mcp-status payload extension
  - phase: 94-tool-reliability-self-awareness/02-tool-filter
    provides: filterToolsByCapabilityProbe + the LLM-side counterpart to this operator-side surface
  - phase: 94-tool-reliability-self-awareness/04-tool-call-error
    provides: findAlternativeAgents helper for D-07 cross-agent routing
provides:
  - probe-renderer.ts shared module — pure helpers (buildProbeRow / paginateRows / recoverySuggestionFor / STATUS_EMOJI / EMBED_LINE_CAP) consumed by both /clawcode-tools and `clawcode mcp-status` for content equivalence
  - /clawcode-tools embed extended — capability-probe row (status emoji + last-good ISO + relative + recovery suggestion + Healthy alternatives line)
  - clawcode mcp-status CLI extended — emoji-bearing CAPABILITY column + per-server detail block (parity with Discord embed)
  - daemon list-mcp-status IPC payload extended — per-server `alternatives` array (computed via findAlternativeAgents over all known agents minus the querier)
  - REG-SINGLE-DATA-SOURCE static-grep regression pin — both renderers read list-mcp-status IPC payload only; no second cache or jsonl ledger source
  - CLI-EMBED-PARITY cross-renderer test — content equivalence (server name, status, emoji, ISO timestamp, alternatives) between text-table CLI output and embed buildProbeRow output for the same snapshot
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shared pure renderer between Discord slash + CLI command — 5th application of the idiom (Phase 91 sync-status, Phase 93 status-render, Phase 94 probe-renderer); single source of truth for emoji/recovery/alternatives content lets the cross-renderer parity test pin content equivalence"
    - "Daemon-computed cross-agent alternatives — single execution of findAlternativeAgents (94-04) lives in the IPC handler, not in each renderer; renderers just surface the computed array. Single-source-of-truth invariant pinned by REG-SINGLE-DATA-SOURCE test"
    - "Pure renderer with caller-supplied `now` — buildProbeRow consumes a Date argument and uses date-fns formatDistance(d, now) instead of formatDistanceToNow(d) so the function is deterministic for tests with synthetic timestamps"
    - "Renderer-suppressed alternatives line for ready servers — daemon ships the array unconditionally for symmetry; renderer applies the (status !== 'ready' && alternatives.length > 0) gate so ready servers stay compact (information overload prevention)"
    - "EMBED_LINE_CAP literal pinned in slash-commands.ts — sourced from shared module but re-asserted via `EMBED_LINE_CAP_ASSERTED: 25 = EMBED_LINE_CAP as 25` so the static-grep acceptance pin (`grep -q 'EMBED_LINE_CAP = 25' src/discord/slash-commands.ts`) holds without runtime overhead"

key-files:
  created:
    - src/manager/probe-renderer.ts
  modified:
    - src/discord/slash-commands.ts
    - src/discord/__tests__/slash-commands-tools.test.ts
    - src/cli/commands/mcp-status.ts
    - src/cli/commands/__tests__/mcp-status.test.ts
    - src/manager/daemon.ts

key-decisions:
  - "Daemon computes alternatives, not the slash handler — adding a multi-agent McpStateProvider to the slash handler context would have required threading the SessionManager through the inline handler dispatcher. Computing daemon-side keeps the slash handler pure (just renders) and keeps the IPC payload as the single source of truth (REG-SINGLE-DATA-SOURCE invariant)"
  - "Daemon excludes the querying agent from its own alternatives list — operators don't need 'this agent' as a self-reference; alternatives only make sense as cross-agent routing suggestions"
  - "Daemon uses identity toolToServer in the McpStateProvider — we already know the server name (it IS the lookup key), so passing `(s) => s` skips the SDK-prefix heuristic that would mis-tokenize server names containing underscores or hyphens (e.g. 'finmentum-db', 'finmentum_db')"
  - "Recovery-suggestion regex set lives in probe-renderer.ts, not imported from 94-03's recovery-handler — the renderer surfaces what auto-recovery WOULD do (operator visibility); intentional small duplication keeps the slash/CLI module graph decoupled from the recovery-handler subsystem. If patterns drift, both places need updating"
  - "buildProbeRow gates the alternatives array on (status !== 'ready' && length > 0) — daemon ships the alternatives unconditionally; the renderer's job is to suppress the 'Healthy alternatives' line for ready servers (information overload). Pinned by TLS-ALT-NOT-FOR-READY test"
  - "CLI detail block triggers on actionable content (lastSuccessIso || recoverySuggestion || alternatives), not on status alone — bare 'unknown' (probe-not-yet-run) servers stay compact in the table; only servers with concrete probe info get the detail block"
  - "Pure-renderer determinism via formatDistance(d, now) — date-fns formatDistanceToNow reads the system clock; formatDistance takes both dates explicitly so the test can pass synthetic now values and get deterministic relative-string output"

patterns-established:
  - "Single-source-of-truth IPC payload for multi-renderer surfaces — daemon enriches the payload (capabilityProbe + alternatives) once, both renderers consume the enriched payload identically. REG-SINGLE-DATA-SOURCE test pins the invariant. Pattern reusable for future status displays where Discord + CLI need to render the same content"
  - "Cross-renderer parity test idiom — CLI-EMBED-PARITY feeds the same snapshot to both the CLI text-formatter and the Discord buildProbeRow helper; asserts every meaningful row field present in one output appears in the other. Catches drift when one renderer is updated without the other"

requirements-completed: [TOOL-11, TOOL-12]

# Metrics
duration: 10min
completed: 2026-04-25
---

# Phase 94 Plan 07: /clawcode-tools surface upgrade + cross-agent routing suggestions Summary

**Both operator UIs (`/clawcode-tools` Discord slash + `clawcode mcp-status` CLI) now render the new capability-probe column from a shared pure helper. Status emoji (✅🟡⏳🔴⚪), last-good ISO + relative timestamp, recovery suggestion when degraded (e.g., `auto-recovery: npx playwright install chromium`), and a "Healthy alternatives" line listing other agents whose snapshot has the same MCP server in `capabilityProbe.status === "ready"` (D-07 cross-agent routing). Single-source-of-truth: daemon computes alternatives via `findAlternativeAgents` (94-04 helper) and ships them in the `list-mcp-status` IPC payload; both renderers consume the same payload. Cross-renderer content equivalence pinned by a parity test.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-04-25T06:00:49Z
- **Completed:** 2026-04-25T06:10:46Z
- **Tasks:** 2 (auto — UI-shape upgrade extending existing slash-command and CLI handlers + their tests)
- **Files created:** 1
- **Files modified:** 5

## Accomplishments

- **TOOL-11 (D-11) /clawcode-tools surface upgrade.** Discord embed extended with a per-server "probe:" line showing the capability-probe status emoji + status text + last-good timestamp ("last good: 2026-04-25T05:30:00.000Z (24 minutes ago)" or "last good: never"). Recovery suggestion line appears for non-ready servers when the verbatim error matches a known auto-recovery pattern (Playwright Chromium missing → `auto-recovery: npx playwright install chromium`; op:// reference auth-error → `auto-recovery: refresh op:// references`). 25-server cap honored — embeds with > 25 servers render the first page + a footer ("Showing first 25 of N servers").
- **TOOL-12 (D-07) cross-agent routing.** When a server is non-ready (degraded/failed/reconnecting/unknown), the embed shows a "Healthy alternatives:" line listing other agents whose snapshot has the SAME MCP server in `capabilityProbe.status === "ready"`. Operators (and the LLM via 94-06's prompt directive) get a specific list of channels/agents to ask for the missing tool. Computed daemon-side via 94-04's `findAlternativeAgents` helper.
- **CLI parity.** `clawcode mcp-status` text-table CAPABILITY column now shows emoji + status text (matching the Discord embed). Below the table, a "Capability Probe Details" block surfaces the same recovery suggestions + alternatives lines for actionable servers. Operators using SSH/CLI without Discord access see the same data.
- **Single-source-of-truth invariant.** Daemon's `list-mcp-status` IPC handler enriches the payload once (capabilityProbe field from the in-memory map + alternatives from a one-shot `findAlternativeAgents` call over all known agents). Both renderers consume the same payload. REG-SINGLE-DATA-SOURCE static-grep test pins that neither renderer reads from a second source (no `mcp-probe-state.jsonl` reads in either file).
- **Cross-renderer parity pinned.** CLI-EMBED-PARITY test feeds the same synthetic snapshot to both the CLI text-formatter and the shared `buildProbeRow` helper; asserts every per-server field present in one output (server name, status, status emoji, last-good ISO, alternatives) is also present in the other. Future updates to one renderer without the other will fail the test.
- **Zero new npm dependencies.** Reuses existing date-fns dependency (used elsewhere in the codebase). `git diff package.json` empty.
- **Build clean; 25 tests pass** (10 existing slash-tool tests + 3 new + 7 existing CLI tests + 5 new CLI tests).

## Task Commits

1. **Task 1: extend /clawcode-tools embed renderer + 3 new tests + daemon IPC alternatives** — `1d32ce3` (feat)
2. **Task 2: mcp-status CLI parity + 5 new tests (CLI-CAP-EMOJI, alts, ready-suppresses, REG-SINGLE-DATA-SOURCE, CLI-EMBED-PARITY) + probe-renderer.ts type fixes** — `0870209` (feat)

## Files Created/Modified

### Created

- **`src/manager/probe-renderer.ts`** — Pure shared module. `STATUS_EMOJI` (5-key map for ready/degraded/reconnecting/failed/unknown). `EMBED_LINE_CAP = 25` constant. `recoverySuggestionFor(error)` matches against the auto-recovery patterns owned by Plan 94-03 (Playwright Chromium missing, op:// reference auth-error). `buildProbeRow(serverName, state, alternatives, now)` factory returning a frozen `ProbeRowOutput` (statusEmoji, status, lastSuccessIso, lastSuccessRelative, recoverySuggestion, alternatives — gated on non-ready status). `paginateRows(rows, pageSize)` splits into 25-server pages. Pure-DI: no fs imports, no SDK imports, deterministic relative timestamps via `formatDistance(d, now)`.

### Modified

- **`src/discord/slash-commands.ts`** — Imports shared probe-renderer helpers. /clawcode-tools handler now builds frozen `ProbeRowOutput[]` from the IPC payload and renders a "probe:" line + recovery + Healthy alternatives line per field. EMBED_LINE_CAP literal asserted via `EMBED_LINE_CAP_ASSERTED: 25 = EMBED_LINE_CAP as 25` for the static-grep acceptance pin. Footer added when row count > cap. Backward-compat: existing field-name shape (Phase 85's connect-test emoji + server name + optional suffix) preserved; capability-probe data is appended to the field VALUE, not replacing the existing structure.
- **`src/discord/__tests__/slash-commands-tools.test.ts`** — 3 new tests: TLS-EMOJI-ALL (5 capability-probe emojis), TLS-ALTS-DEGRADED (Healthy alternatives line + recovery suggestion for the Playwright pattern), TLS-ALT-NOT-FOR-READY (renderer suppresses alternatives line for ready servers even when payload carries them).
- **`src/cli/commands/mcp-status.ts`** — Imports shared probe-renderer helpers. CAPABILITY column now shows `${probe.statusEmoji} ${probe.status}` (parity with Discord embed). After the main table, "Capability Probe Details:" block surfaces last-good ISO + recovery suggestion + Healthy alternatives line for actionable servers (gated on lastSuccessIso || recoverySuggestion || alternatives). McpStatusServer type extended with `alternatives?:` field.
- **`src/cli/commands/__tests__/mcp-status.test.ts`** — 5 new tests: CLI-CAP-EMOJI (5 emojis), Healthy-alternatives + Playwright recovery suggestion, ready-server-suppresses-alternatives, REG-SINGLE-DATA-SOURCE static-grep regression (both renderers read list-mcp-status IPC only; no jsonl reads), CLI-EMBED-PARITY cross-renderer content equivalence.
- **`src/manager/daemon.ts`** — `list-mcp-status` IPC handler extended to compute per-server alternatives via `findAlternativeAgents` (94-04 helper) over all known agents minus the querying agent. Identity `toolToServer` override skips the SDK-prefix heuristic (we already know the server name as the lookup key). Alternatives ship in the payload unconditionally (frozen empty array for servers with no alternatives); the renderer is responsible for the ready-server suppression.

## Decisions Made

- **Daemon computes alternatives, not the slash handler.** Adding a multi-agent `McpStateProvider` to the slash handler context would have required threading the `SessionManager` through the inline handler dispatcher — invasive change. Computing daemon-side keeps the slash handler pure (just renders) and keeps the IPC payload as the single source of truth (REG-SINGLE-DATA-SOURCE invariant).
- **Daemon excludes the querying agent from its own alternatives list.** Operators don't need "this agent" as a self-reference; alternatives only make sense as cross-agent routing suggestions.
- **Identity `toolToServer` override in the daemon.** We already know the server name (it IS the lookup key in the snapshot map), so passing `(s) => s` skips the SDK-prefix heuristic that would mis-tokenize server names containing underscores or hyphens (e.g. `finmentum-db`, `finmentum_db`).
- **Recovery-suggestion regex set lives in probe-renderer.ts**, not imported from 94-03's recovery-handler — intentional small duplication keeps the slash/CLI module graph decoupled from the recovery-handler subsystem. If patterns drift, both places need updating.
- **buildProbeRow gates alternatives on `status !== 'ready' && length > 0`.** Daemon ships the alternatives unconditionally for symmetry; the renderer's job is to suppress the "Healthy alternatives" line for ready servers (information overload prevention). Pinned by TLS-ALT-NOT-FOR-READY test.
- **CLI detail block triggers on actionable content.** Bare "unknown" (probe-not-yet-run) servers without lastSuccessIso/recoverySuggestion/alternatives stay compact in the table; only servers with concrete probe info get the detail block. Preserves the existing 5-line-table shape for snapshots without capabilityProbe data.
- **Pure-renderer determinism via `formatDistance(d, now)`.** date-fns `formatDistanceToNow` reads the system clock; `formatDistance` takes both dates explicitly so tests can pass synthetic `now` values and get deterministic relative-string output. Caller-supplied `now: Date` flows through `buildProbeRow`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] paginateRows return-type mismatch**
- **Found during:** Task 2 typecheck
- **Issue:** Initial `paginateRows` implementation used `Object.freeze<ProbeRowOutput>([])` which TypeScript inferred as `Object.freeze<never[]>`, producing the wrong outer type. The function signature said `readonly (readonly ProbeRowOutput[])[]` but the return value type-narrowed wrong.
- **Fix:** Refactored to bind the empty page to a typed local: `const emptyPage: readonly ProbeRowOutput[] = Object.freeze<ProbeRowOutput[]>([])`. Same pattern for the populated-pages path. TypeScript now accepts the return.
- **Files modified:** `src/manager/probe-renderer.ts`
- **Verification:** `npx tsc --noEmit` clean for probe-renderer.ts.
- **Committed in:** `0870209` (Task 2 commit)

**2. [Rule 1 — Bug] formatDistanceToNow does not accept `now` override in date-fns v4**
- **Found during:** Task 2 typecheck
- **Issue:** Initial `buildProbeRow` called `formatDistanceToNow(d, { addSuffix: true, now })`. date-fns v4 typings reject `now` on `FormatDistanceToNowOptions` because `formatDistanceToNow` reads the system clock unconditionally — there's no override hook.
- **Fix:** Switched to `formatDistance(d, now, { addSuffix: true })` — takes both dates explicitly. Renderer becomes deterministic for tests passing synthetic `now` values.
- **Files modified:** `src/manager/probe-renderer.ts`
- **Verification:** `npx tsc --noEmit` clean; CLI-EMBED-PARITY test passes (relative timestamps match between renderers because both use the same `now`).
- **Committed in:** `0870209` (Task 2 commit)

**3. [Rule 1 — Bug] Existing CLI test broke when detail block emitted for bare-unknown servers**
- **Found during:** Task 2 first test run
- **Issue:** Initial detail-block gate was `if (row.status === "ready" && row.alternatives.length === 0) continue;` — this emitted detail blocks for any non-ready server, including "unknown" servers (probe-not-yet-run, no capabilityProbe field). The existing 6-column-table test had 3 servers without capabilityProbe → all rendered as unknown → all got detail blocks → test expected 5 lines, got 12.
- **Fix:** Tightened the gate to `if (!hasContent) continue;` where `hasContent = lastSuccessIso !== null || recoverySuggestion !== null || alternatives.length > 0`. Bare-unknown servers (no last-good, no recovery, no alts) skip the detail block; only servers with actionable probe info get it.
- **Files modified:** `src/cli/commands/mcp-status.ts`
- **Verification:** All 7 existing CLI tests + 5 new tests pass.
- **Committed in:** `0870209` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (Rule 1 — Bugs). Two TypeScript-driven (paginateRows return type, formatDistance API), one test-driven (detail-block gate too loose). All inline fixes; no architectural changes.
**Impact on plan:** Net-zero behavior change vs the spec. The plan called for "5 emojis + ISO + relative + recovery + alternatives + 25-line cap" — all delivered. Type-level cleanups don't affect the user-visible surface.

## Issues Encountered

- The plan suggested `formatDistanceToNow(d, { now })` which date-fns v4 doesn't support; switched to `formatDistance(d, now)` which is the right primitive for pure-renderer determinism. Documented in the Deviations section.
- The plan referenced `mcpStateProvider` directly in the slash handler context, but the slash command's inline handler doesn't have a `SessionManager` reference (it routes through `sendIpcRequest` to the daemon). Resolution: moved alternatives computation to the daemon's `list-mcp-status` IPC handler and shipped `alternatives` per server in the payload. Cleaner: keeps the slash handler pure + preserves single-source-of-truth (the IPC payload is the only data source for the renderer). REG-SINGLE-DATA-SOURCE test pins this.
- The acceptance criteria asked for `EMBED_LINE_CAP = 25` literal in `src/discord/slash-commands.ts`, but the constant lives in the shared `probe-renderer.ts` module. Resolved by re-asserting via `EMBED_LINE_CAP_ASSERTED: 25 = EMBED_LINE_CAP as 25` — keeps the source-of-truth in one place and satisfies the static-grep pin.

## User Setup Required

None — no external service configuration required. The capability-probe column auto-populates from the existing 60s heartbeat probe (Plan 94-01); the cross-agent alternatives line auto-populates when the daemon has multiple agents whose `capabilityProbe.status === "ready"` for the same MCP server.

## Phase 94 Complete

This is the final plan in Phase 94 (tool reliability + self-awareness). The full delivered surface across the 7 plans:

1. **94-01** — capability probe primitive + 13-entry registry + heartbeat tick wiring
2. **94-02** — filterToolsByCapabilityProbe + LLM-side stable-prefix filter
3. **94-03** — auto-recovery handlers (Playwright Chromium, op:// reference) + bounded retry
4. **94-04** — ToolCallError schema + findAlternativeAgents helper + TurnDispatcher wrap
5. **94-05** — auto-injected `clawcode_fetch_discord_messages` + `clawcode_share_file` tools
6. **94-06** — defaults.systemPromptDirectives + per-agent overrides + cross-agent-routing directive
7. **94-07** — /clawcode-tools surface upgrade + cross-agent routing suggestions (this plan)

The original 2026-04-25 fin-acquisition production bug ("Yep, I have a `browser` tool" → "Playwright's Chrome isn't installed") is now structurally impossible: the LLM never sees a tool whose probe.status !== "ready" (94-02 filter); when a tool is broken the operator sees specific channels to ask in (94-07 alternatives line + 94-06 prompt directive); auto-recovery fires for known patterns (94-03); mid-turn failures wrap into structured ToolCallError (94-04); operators have headless visibility via the upgraded CLI (94-07).

**No blockers. Phase 94 complete.**

## Self-Check: PASSED

Verified:
- `src/manager/probe-renderer.ts` exists; contains `STATUS_EMOJI` (5 entries), `EMBED_LINE_CAP = 25`, `recoverySuggestionFor`, `buildProbeRow`, `paginateRows`, all marked `Object.freeze`'d output.
- `src/discord/slash-commands.ts` modified; contains `STATUS_EMOJI`, `EMBED_LINE_CAP = 25` (asserted), `buildProbeRow`, `recoverySuggestionFor` import, `findAlternativeAgents` reference, `Healthy alternatives`, `Object.freeze` (rows array).
- `src/cli/commands/mcp-status.ts` modified; contains `STATUS_EMOJI`/`statusEmoji`/`capabilityProbe`, `Healthy alternatives`, `list-mcp-status`.
- `src/manager/daemon.ts` modified; `list-mcp-status` handler now imports + invokes `findAlternativeAgents`.
- `npx vitest run src/discord/__tests__/slash-commands-tools.test.ts src/cli/commands/__tests__/mcp-status.test.ts --reporter=dot` — 25 tests pass (10 existing slash + 3 new + 7 existing CLI + 5 new CLI).
- `npm run build` exits 0; `dist/cli/index.js` 1.68 MB.
- `node dist/cli/index.js mcp-status --help` outputs the registered subcommand description.
- `git diff package.json` empty (zero new npm deps).
- Static-grep regression pins all PASS:
  - `grep -q "EMBED_LINE_CAP = 25" src/discord/slash-commands.ts` OK
  - `grep -E "ready:|degraded:|reconnecting:|failed:|unknown:" src/manager/probe-renderer.ts | wc -l` = 6 (≥5)
  - `grep -q "Healthy alternatives"` in both renderer files OK
  - `grep -q "findAlternativeAgents"` in slash-commands.ts + daemon.ts OK
  - `grep -q "list-mcp-status"` in both renderer files OK
  - NO `mcp-probe-state.jsonl` reads in either renderer OK
  - `grep -q "Object\.freeze" src/discord/slash-commands.ts` OK
- Commits `1d32ce3` (Task 1) + `0870209` (Task 2) exist on `master`.

---
*Phase: 94-tool-reliability-self-awareness*
*Plan: 07 (final plan in phase)*
*Completed: 2026-04-25*
