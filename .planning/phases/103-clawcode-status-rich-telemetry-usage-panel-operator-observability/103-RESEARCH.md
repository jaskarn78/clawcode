# Phase 103: /clawcode-status rich telemetry + Usage panel (operator-observability) — Research

**Researched:** 2026-04-29
**Domain:** Discord slash-command observability backed by SDK rate-limit telemetry, operator-facing embeds, per-agent in-memory + persisted snapshot store
**Confidence:** HIGH (all source files read at exact line numbers; SDK type signature is authoritative)

## Summary

Phase 103 has two halves and they are different shapes of work.

**Half A (wiring chore, 11 fields):** The current `/clawcode-status` (Phase 93 Plan 01) renders a 9-line block where 11 values are placeholders. Of those 11, **8 already have live getters** that just need to be threaded into `buildStatusData` / `renderStatus`: `Session ID`, `Last Activity`, `Think (effort)`, `Permissions`, `Queue` (depth-1 from `hasActiveTurn`), `Context %` (heartbeat zone), `Activation` (registry boot timestamp), `Tokens` (UsageTracker session aggregate). **3 are genuinely missing primitives**: `Fallbacks`, `Compactions count`, and `Reasoning` (which is just the effort tier label as a friendlier string — not a separate field).

The 3 OpenClaw-specific fields (`Fast`, `Elevated`, `Harness`) are dropped — they're vestigial from the OpenClaw text/markdown render and have no analog in the SDK-native ClawCode runtime.

**Half B (net-new primitive, the Usage panel):** ClawCode currently does NOT subscribe to SDK `rate_limit_event` messages. The SDK fires them inline on the `query()` async iterator (same channel as `assistant`/`result`/`stream_event`/`user`). The handle's `iterateUntilResult` loop in `persistent-session-handle.ts:401-648` has explicit `if (msg.type === ...)` branches for `assistant`, `stream_event`, `user`, and `result` — and silently ignores everything else (including `rate_limit_event`). **There is exactly one place to wire this:** add a branch in that same loop that pushes the snapshot into a new `RateLimitTracker` per agent. Persist to per-agent SQLite (matches the v2.x pattern); expose via a new `list-rate-limit-snapshots` IPC method (the existing `rate-limit-status` IPC is taken — it serves the **Discord outbound** rate limiter, not OAuth Max usage).

**Primary recommendation:** Two independent waves. Wave A (low-risk, ~1-2 plans): wire the 8 already-available fields into `buildStatusData` + drop the 3 OpenClaw fields + bump compaction count via a tiny counter mirror in `SessionManager`. Wave B (~2 plans): add `RateLimitTracker` + handle subscription hook + IPC method + new `/clawcode-usage` slash command. Wave A and B can ship in either order — they touch different files and have no coupling.

## User Constraints (from CONTEXT.md)

CONTEXT.md does not exist for Phase 103. The phase scope is locked by ROADMAP §"Phase 103" (lines 520-543) and the plan-phase prompt's `<additional_context>` block. Treat the following as the constraint set:

### Locked Decisions (from ROADMAP + prompt)
- **Drop 3 fields:** `Fast`, `Elevated`, `Harness` removed from `/clawcode-status` (no ClawCode analog; OpenClaw-only).
- **Wire 11 fields:** `Fallbacks`, `Compactions`, `Tokens`, `Session ID`, `Last Activity`, `Think effort`, `Reasoning`, `Permissions`, `Activation`, `Queue`, `Context %`.
- **New surface `/clawcode-usage`:** dedicated panel for OAuth Max session/weekly bars, sourced from SDK `rate_limit_event`.
- **Per-rate-limit-type independence:** Track `five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet`, `overage` snapshots independently (they reset on different cadences and never fire in the same event).
- **Persistence:** In-memory + per-agent SQLite for restart resilience.
- **No new npm deps:** v2.x discipline preserved (see Pitfall 1).
- **OAuth Max auth model assumed:** ClawCode does NOT use API keys (see `🔑 sdk` hardcode in `status-render.ts:174`); `SDKRateLimitInfo` only fires for claude.ai-subscription (Max plan) sessions per SDK docstring at `sdk.d.ts:2552`.

### Claude's Discretion
- IPC method naming for the new tracker (suggested: `list-rate-limit-snapshots` to avoid collision with existing `rate-limit-status` Discord-rate-limiter handler at `daemon.ts:4074`).
- Embed colour vocabulary for `/clawcode-usage` (recommend reuse of Phase 91 `sync-status-embed.ts` palette: green/yellow/red).
- Whether `Compactions` count lives on `CompactionManager` (thin counter mirror) or on `SessionHandle` (parallel to fsCapability mirror pattern). Recommend: counter on `SessionManager`, exposed via `getCompactionCountForAgent(name)` — matches getEffort/getModel surface and keeps `CompactionManager` pure.
- Whether to emit a Discord ephemeral warning when `status === 'allowed_warning'` or `surpassedThreshold` fires (recommend: yes, as a heartbeat side-effect, but defer to Wave 0 of planning).

### Deferred Ideas (OUT OF SCOPE)
- Cross-agent fleet-level usage roll-up (per-agent only in v1).
- Historical time-series of utilization (snapshot-only — latest per type, not history).
- Cost projection / budget alarms (separate phase if requested).
- Backfill of rate-limit data prior to RateLimitTracker construction (snapshots start when the handle starts; pre-existing rate state is unobservable).

## Phase Requirements

Per the prompt: **none mapped yet — this is a v2.7 milestone phase scoped post-roadmap-creation, treat as net-new.** Plans should propose new requirement IDs (e.g. `OBS-01..OBS-08`) covering:

| Proposed ID | Description | Research Support |
|----|----|----|
| OBS-01 | Wire 8 already-available fields into `buildStatusData` | `status-render.ts` lines 108-156 (existing scaffolding); SessionManager getters at `session-manager.ts:1059..` |
| OBS-02 | Add compaction-count mirror on SessionManager + bump on `CompactionManager.compact` success | `compaction.ts:84-140` (current `compact()` returns void of count); `session-manager.ts:1640` (existing `getCompactionManager`) |
| OBS-03 | Drop `Fast`, `Elevated`, `Harness` lines + repurpose space | `status-render.ts:204-211` (line 7 hardcoded triplet) |
| OBS-04 | Add `RateLimitTracker` per agent, in-memory + SQLite-persisted | No existing primitive; new module |
| OBS-05 | Subscribe to `rate_limit_event` in `iterateUntilResult` | `persistent-session-handle.ts:469` (`const msg = step.value;`) is the hook point |
| OBS-06 | New IPC method `list-rate-limit-snapshots` | `protocol.ts:7-214` (extend IPC_METHODS); `daemon.ts:4074` shows existing handler shape |
| OBS-07 | New `/clawcode-usage` slash command (CONTROL_COMMAND, daemon-routed, EmbedBuilder render) | `slash-types.ts:441-560` for CONTROL_COMMANDS shape; `sync-status-embed.ts` for embed pattern |
| OBS-08 | Append session/weekly bars to `/clawcode-status` embed | `status-render.ts:213-223` (current line array) |

## Project Constraints (from CLAUDE.md)

- **Identity preamble:** every session reads `clawcode.yaml` for `test-agent` identity. Not relevant to research output but must be honored at execution time.
- **Workflow gate:** all file edits go through GSD commands. This research is itself a GSD artifact; planning must continue via `/gsd:plan-phase 103`.
- **Stack lock:** TypeScript 6.0.2, Node 22 LTS, ESM, `@anthropic-ai/claude-agent-sdk` pinned EXACT 0.2.x (currently 0.2.97). better-sqlite3 12.8.0 for any new persistence. discord.js 14.26.2. zod 4.3.6. **Zero new npm deps** — v2.x discipline (proven sustainable across 30+ phases).
- **Testing:** Vitest, ESM-first. SDK mocking pattern is `vi.mock("@anthropic-ai/claude-agent-sdk", ...)` at module top — see `manager/__tests__/persistent-session-cache.test.ts:32-100` for the canonical buildFakeSdk helper.
- **No hardcoded secrets / validate inputs** (security.md): rate-limit snapshots contain no secrets, but the SQLite schema must be parameterized (already standard via better-sqlite3 prepared statements — see `usage/tracker.ts:46-103`).
- **Immutability** (coding-style.md): RateLimitTracker snapshots must be `Object.freeze`'d; SessionHandle's per-handle `RateLimitTracker` reference follows the established post-construction DI mirror pattern (Phase 85 McpState, Phase 96 FsCapability).
- **File size:** keep modules 200-400 lines. The new tracker, the embed renderer, and the slash command + IPC handler should be 4 distinct files.

## Standard Stack

### Core (existing, already in package.json)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @anthropic-ai/claude-agent-sdk | 0.2.97 (EXACT pin) | `SDKRateLimitInfo` source of truth | Phase 103 IS the consumer of this SDK type — no alternative exists for OAuth Max usage data |
| better-sqlite3 | 12.8.0 | Persist rate-limit snapshots per agent | Matches `UsageTracker` (`usage/tracker.ts`), `MemoryStore`, conversation store; restart-resilient via WAL |
| discord.js | 14.26.2 | EmbedBuilder for `/clawcode-status` + `/clawcode-usage` panels | Matches `sync-status-embed.ts` (Phase 91), `slash-commands.ts` UI-01 compliance |
| zod | 4.3.6 | Validate IPC payload shape for `list-rate-limit-snapshots` | All IPC methods schema-validated in `ipc/protocol.ts` |
| date-fns | 4.x | `formatDistanceToNow` for "resets in 2h 13m" countdowns | Already imported by `status-render.ts:30` |

### Supporting (existing)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pino | 9.x | Structured log of incoming `rate_limit_event` snapshots | Mirror existing `log.info({ agent, type, utilization }, "rate-limit snapshot")` discipline |
| nanoid | 5.x | Snapshot row id (if persistence schema uses surrogate pk) | Optional — composite (agent, type) PK is simpler |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Per-agent SQLite for snapshots | In-memory only | LOSES snapshots on daemon restart. SDK only fires `rate_limit_event` when limits change — a quiet agent could go hours without a refresh. SQLite persistence ensures restart shows the last-known state instantly. **Reject in-memory-only.** |
| Per-agent SQLite | Singleton SQLite for fleet | Per-agent matches the v2.x isolation pattern (UsageTracker, MemoryStore, ConversationStore are all per-agent). Singleton would need agent_id columns and a migration. **Reject singleton.** |
| New table in existing UsageTracker DB | Standalone `rate-limits.db` | UsageTracker already opens a per-agent DB at `~/.clawcode/agents/{agent}/usage.db`. Adding a `rate_limit_snapshots` table avoids a second DB handle. **Recommend: add table to UsageTracker DB.** |
| `list-rate-limit-snapshots` IPC | Reuse `rate-limit-status` | COLLISION — `daemon.ts:4074` already serves the Discord outbound rate-limiter (token bucket per channel). Different domain. **Must use new method name.** |
| New `/clawcode-usage` command | Squeeze panel into `/clawcode-status` | The 4 rate-limit types + overage = ~6 fields with progress bars. Embed gets crowded. ROADMAP locks the panel as standalone surface. **Honor: separate command.** |

**Version verification (`npm view` against installed `node_modules` on 2026-04-29):**
- `@anthropic-ai/claude-agent-sdk@0.2.97` — confirmed present at `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (line 2553 carries the locked `SDKRateLimitInfo` shape). No version bump required.
- `better-sqlite3@12.8.0` — confirmed via existing `usage/tracker.ts` import.
- `discord.js@14.26.2` — confirmed via existing slash-commands.ts imports.
- All packages already installed; **zero `npm install` steps in this phase.**

## Architecture Patterns

### Recommended Project Structure (additive, no restructure)
```
src/
├── usage/
│   ├── rate-limit-tracker.ts          # NEW — class RateLimitTracker (DI'd, pure)
│   ├── rate-limit-tracker.test.ts     # NEW — vitest
│   └── tracker.ts                      # EXISTING — extend schema with rate_limit_snapshots table
├── manager/
│   ├── persistent-session-handle.ts   # EXTEND — add rate_limit_event branch in iterateUntilResult
│   ├── session-manager.ts             # EXTEND — getCompactionCountForAgent, getRateLimitTracker, mirror plumbing
│   └── daemon.ts                       # EXTEND — add list-rate-limit-snapshots case
├── discord/
│   ├── status-render.ts               # EXTEND — wire 8 fields, drop 3 OpenClaw fields, optionally append usage bars
│   ├── usage-embed.ts                 # NEW — pure EmbedBuilder for /clawcode-usage (mirror sync-status-embed.ts)
│   ├── usage-embed.test.ts            # NEW
│   ├── slash-commands.ts              # EXTEND — inline handler for /clawcode-usage (mirror /clawcode-tools, /clawcode-sync-status)
│   └── slash-types.ts                 # EXTEND — append CONTROL_COMMAND for clawcode-usage
└── ipc/
    └── protocol.ts                     # EXTEND — append "list-rate-limit-snapshots" to IPC_METHODS
```

### Pattern 1: Hook the SDK message-iteration loop
**What:** The SDK delivers `rate_limit_event` as one of the message types yielded by the `query()` async iterator — same channel as `assistant`, `result`, `user`, `stream_event`. The persistent handle's `iterateUntilResult` already has type-discriminated branches for those four; the new branch is mechanically identical.

**When to use:** ANY new SDK message type ClawCode wants to observe.

**Example (verified call site):**
```typescript
// File: src/manager/persistent-session-handle.ts (around line 469)
// Existing:
const msg = step.value;

if (msg.type === "assistant") { /* ... */ }
if ((msg as { type?: string }).type === "stream_event" && onChunk !== null) { /* ... */ }
if (msg.type === ("user" as SdkStreamMessage["type"])) { /* ... */ }
if (msg.type === "result") { /* ... terminate turn ... */ }

// NEW (insert before the result branch — rate_limit_event is observational, not turn-terminating):
if ((msg as { type?: string }).type === "rate_limit_event") {
  try {
    const event = msg as { rate_limit_info?: SDKRateLimitInfo };
    if (event.rate_limit_info) {
      rateLimitTracker?.record(event.rate_limit_info);
    }
  } catch {
    // observational — never break message flow (matches extractUsage discipline)
  }
}
```

**Source:** `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2540-2548` for the SDKRateLimitEvent shape; `src/manager/persistent-session-handle.ts:401-648` for the existing branch pattern; `extractUsage` at line 290 is the canonical "observational, never throw" template.

### Pattern 2: Per-handle accessor mirror (post-construction DI)
**What:** SessionHandle gets a thin `getRateLimitTracker()` accessor; SessionManager owns the actual tracker map; the handle is a read surface for downstream (TurnDispatcher, slash commands).

**When to use:** Any per-agent runtime state surfaced to multiple consumers.

**Example pattern (mirrors Phase 96 D-CONTEXT exactly):**
```typescript
// File: src/manager/persistent-session-handle.ts (alongside _fsCapabilitySnapshot at line 252)
let _rateLimitTracker: RateLimitTracker | undefined;

// File: src/manager/session-adapter.ts (alongside getFsCapabilitySnapshot at line 159)
getRateLimitTracker: () => RateLimitTracker | undefined;
setRateLimitTracker: (tracker: RateLimitTracker) => void;
```

**Source:** `src/manager/persistent-session-handle.ts:244-252,855-884` (FsCapability mirror); `src/manager/session-adapter.ts:148-160` (interface declaration); STATE.md decisions classify this as the **6th application** of the DI mirror pattern (McpState, FlapHistory, RecoveryAttemptHistory, SupportedCommands, ModelMirror, FsCapability) — Phase 103 makes it the **7th**.

### Pattern 3: Inline slash-handler short-circuit BEFORE CONTROL_COMMANDS
**What:** Operator-tier slash commands that render rich embeds bypass the generic CONTROL_COMMANDS dispatcher and use an inline `if (commandName === "clawcode-usage")` short-circuit so the reply is `EmbedBuilder` (UI-01) not the text blob the generic dispatcher emits.

**When to use:** Any new slash command that renders structured Discord components (EmbedBuilder, button, select menu).

**Example (verified pattern):**
```typescript
// File: src/discord/slash-commands.ts (parallel to /clawcode-status at line 1493)
if (commandName === "clawcode-usage") {
  try {
    const result = await sendIpcRequest(SOCKET_PATH, "list-rate-limit-snapshots", { agent: agentName });
    const embed = buildUsageEmbed(result);
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    /* mirror /clawcode-status catch */
  }
  return;
}
```

**Source:** Per STATE.md decisions, this is the **10th** application of inline-handler-short-circuit (Phases 85/86/87/88/90/91/92/95/96/100); Phase 103 makes it the **11th**.

### Pattern 4: Pure embed renderer module (test-isolatable)
**What:** Embed construction lives in its own pure module (`usage-embed.ts`), consumed by the slash handler. Tests construct snapshot literals and assert on EmbedBuilder properties; no Discord client mocking needed.

**Source:** `src/discord/sync-status-embed.ts:42-194` is the canonical template (16 unit tests, zero Discord client). Mirror its structure verbatim — title, color triage (green/yellow/red), addFields with 25-field cap, setFooter with reset-time + utilization line.

### Anti-Patterns to Avoid
- **Hand-rolling rate-limit tracking via parsing API errors:** the SDK exposes `rate_limit_event` as a structured message — never inspect HTTP error bodies or response headers to derive limit state.
- **Subscribing at the SDK module level (singleton listener):** events are per-`query()`, and ClawCode runs one persistent `query()` per agent. The hook MUST be in the per-agent message loop, not a global listener — otherwise per-agent snapshots blur into a fleet-wide bag.
- **Computing utilization from token deltas:** `SDKRateLimitInfo.utilization` is provided directly (0-1 float). Computing locally would diverge from the server-authoritative value the Claude app shows.
- **Reusing `rate-limiter.ts` (Discord outbound):** `src/discord/rate-limiter.ts` is the token-bucket protecting against Discord 429s. Wholly separate domain. **Do not extend it.**
- **Duplicating the renderFilesystemCapabilityBlock split:** Phase 96 ships TWO renderers (LLM-prompt block + operator-status block) sharing one core. Phase 103's panel is operator-only — keep it ONE renderer in `usage-embed.ts`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Track Anthropic API limit state | Parse 429 errors / response headers | `SDKRateLimitEvent` from `query()` async iterator | Server-authoritative shape with `resetsAt`, `utilization`, `surpassedThreshold`, `overageStatus` — all already wired |
| Reset-time countdown rendering | Custom "X hours Y minutes from now" formatter | `date-fns/formatDistanceToNow(resetsAt, { addSuffix: true })` | Already imported in `status-render.ts:30`; battle-tested locale-aware formatter |
| Per-agent SQLite | New DB connection / WAL config | Extend the existing UsageTracker DB schema with a `rate_limit_snapshots` table | Reuses the WAL/busy_timeout/synchronous=NORMAL config from `usage/tracker.ts:50-53` |
| Discord embed colour triage | Custom colour palette | Reuse `sync-status-embed.ts` colors: 3066993 (green), 15844367 (yellow), 15158332 (red) | Visual consistency across operator surfaces — same vocabulary across `/clawcode-sync-status`, `/clawcode-tools`, `/clawcode-usage` |
| Progress bar rendering | Custom Unicode bar generator | Single helper `renderBar(utilization: number, width = 10): string` returning `▓▓▓▓▓░░░░░ 50%` | Trivial pure function; pin width as constant; matches Claude app screenshot vocabulary |
| ProgressIndicator state | Stateful animation | Pure render of latest snapshot | The Discord embed is a snapshot, not a live ticker — refresh on new slash command invocation |
| Status colour from utilization | Magic-number conditionals | Map `SDKRateLimitInfo.status` directly: `allowed → green`, `allowed_warning → yellow`, `rejected → red` | The SDK already classifies; deriving from utilization risks divergence from server truth |
| Compaction count tracking | New CompactionCountTracker class | Tiny counter Map on SessionManager, bumped on `CompactionManager.compact()` success | The CompactionResult shape (`compaction.ts:37-41`) doesn't carry a count field; minimal change is a sibling Map |

**Key insight:** The SDK has done all the hard work. `SDKRateLimitInfo` carries 9 fields (`status`, `resetsAt`, `rateLimitType`, `utilization`, `overageStatus`, `overageResetsAt`, `overageDisabledReason`, `isUsingOverage`, `surpassedThreshold`) covering everything the Claude iOS app shows. The phase is plumbing, not modeling.

## Runtime State Inventory

> Phase 103 is greenfield + light-touch — no rename/refactor. The five-category audit nonetheless:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — verified by grep across `src/` for `rate_limit\|RateLimit`. The only existing hits are: (a) Phase 54 `rate_limit_errors` benchmarks counter (unrelated — counts API failures during `bench` runs); (b) `daemon.ts:4074` `rate-limit-status` IPC handler for **Discord outbound** token bucket. Neither is OAuth Max related. | Greenfield — new `rate_limit_snapshots` table in UsageTracker DB. Migration is additive (CREATE TABLE IF NOT EXISTS). |
| Live service config | None — no n8n / Datadog / Tailscale dependencies for this phase. | None |
| OS-registered state | None — phase does not register cron jobs, systemd units, or pm2 processes. | None |
| Secrets/env vars | None — `SDKRateLimitInfo` carries no auth material. The OAuth Max session token is owned by the Claude Code CLI and never crosses ClawCode boundaries. | None |
| Build artifacts | None — additive code only; no rename of installed packages or binaries. | None |

## Environment Availability

> Phase 103 is purely code/config — the only external dependency is the already-installed Claude Agent SDK.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| @anthropic-ai/claude-agent-sdk (with SDKRateLimitInfo) | OBS-04, OBS-05 | ✓ | 0.2.97 (verified at `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2553`) | — (no fallback; phase is impossible without this SDK) |
| better-sqlite3 native addon | OBS-04 (persistence) | ✓ | 12.8.0 | — |
| discord.js | OBS-07 | ✓ | 14.26.2 | — |
| Node.js 22 LTS | All | ✓ (project pinned) | 22.x | — |
| OAuth Max subscription on host running daemon | Real `rate_limit_event` emission | ✓ (verified — ClawCode auths via SDK; `status-render.ts:174` hardcodes `🔑 sdk`) | — | If daemon ever runs against API key auth, `rate_limit_event` will not fire and the Usage panel will show "no data" gracefully. Document this in panel render. |

**Missing dependencies:** None blocking, none with fallbacks needed.

## Common Pitfalls

### Pitfall 1: Adding a new npm dep
**What goes wrong:** A first instinct might be to add a tiny "progress bar" library or a "rate limit visualizer" component.
**Why it happens:** Both are 5-line pure functions but feel "library-shaped."
**How to avoid:** v2.x discipline is **zero new npm deps** — STATE.md confirms this across 30+ phases. Pure utilities go in the renderer module.
**Warning signs:** Any plan task mentioning `npm install`. Reject and replace with inline pure helper.

### Pitfall 2: Subscribing globally instead of per-handle
**What goes wrong:** SDK message types are tempting to subscribe to via a top-level wrapper around the SDK module. This blurs which agent the event came from.
**Why it happens:** The SDKRateLimitEvent only knows `session_id`, not `agentName`. A global listener would have to reverse-look-up agent from session.
**How to avoid:** Hook in `iterateUntilResult` where the per-agent context is already in scope (via the closure capturing `agentName` indirectly through SessionManager wiring of the tracker).
**Warning signs:** Any plan that imports `@anthropic-ai/claude-agent-sdk` outside `persistent-session-handle.ts` / `session-adapter.ts`.

### Pitfall 3: Treating Compactions as automatic via the SDK
**What goes wrong:** Anthropic's SDK now emits compaction-related messages (`compact_boundary` etc. in some versions), but **ClawCode does NOT use SDK compaction** — it uses the Phase 47 ClawCode-side `CompactionManager` (`memory/compaction.ts`) keyed off the heartbeat zone tracker, not SDK signals.
**Why it happens:** Hopeful pattern-matching: "the SDK has compactions, surely there's an event."
**How to avoid:** The compaction count is whatever ClawCode's `CompactionManager.compact()` has been called successfully. Add a simple counter mirror on SessionManager that bumps on each successful return from `compact()`.
**Warning signs:** Plan tasks mentioning SDK compaction events as the source-of-truth.

### Pitfall 4: Conflating SDK `rate_limit_event` with Phase 54 `rate_limit_errors` benchmark counter
**What goes wrong:** STATE.md decisions for Phase 54 reference `rate_limit_errors` (count of HTTP 429s during bench runs). That is COMPLETELY UNRELATED to OAuth Max usage tracking.
**Why it happens:** Same word, different domain.
**How to avoid:** Phase 54's counter is incremented when an API call fails. Phase 103's snapshot is updated when the SDK voluntarily reports headroom info. Do not unify, do not extend, do not import from `benchmarks/`.

### Pitfall 5: Reusing the `rate-limit-status` IPC method
**What goes wrong:** `protocol.ts:17` already declares `"rate-limit-status"`. `daemon.ts:4074` serves it. It returns `{ globalTokens, channelTokens, queueDepths }` for the Discord outbound rate-limiter — totally different semantics.
**Why it happens:** Name collision; tempting reuse.
**How to avoid:** Use a NEW method name. Recommended: `list-rate-limit-snapshots` (parallels `list-mcp-status`, `list-fs-status`, `list-sync-status`).
**Warning signs:** Plan tasks naming the method `rate-limit-status` or `usage-status`.

### Pitfall 6: The Discord 100-command-per-guild cap
**What goes wrong:** Adding `/clawcode-usage` is the Nth slash command; the cap is 100 per guild.
**Why it happens:** Each phase adds 1-2 commands; cumulative budget is invisible.
**How to avoid:** Per Phase 85 Plan 03 / Pitfall 9 closure, the project pins a static-grep test that asserts `CONTROL_COMMANDS.length + DEFAULT_SLASH_COMMANDS.length <= 90`. Verify post-extension. Current count (per STATE.md @ Phase 96-05): well under 25/100. **Headroom: ample.**
**Warning signs:** N/A — cap is far away, but the test must continue to pass.

### Pitfall 7: Forgetting `rate_limit_event` is OAuth Max only
**What goes wrong:** If a future ClawCode deployment uses an API key (not OAuth Max), `rate_limit_event` never fires; the Usage panel shows nothing.
**Why it happens:** Documented at `sdk.d.ts:2552` ("Rate limit information for claude.ai subscription users") but easy to miss.
**How to avoid:** Render an explicit "no data — OAuth Max subscription not detected" message in the Usage panel when the tracker has zero snapshots after a defined window. Honest reporting beats blank embeds.
**Warning signs:** Tests that assume `rate_limit_event` fires for any session — they'll silently pass against the SDK mock but fail against a real API-key session.

### Pitfall 8: Race between handle creation and tracker injection
**What goes wrong:** SessionManager constructs the handle, then injects the tracker via `setRateLimitTracker`. If a `rate_limit_event` arrives between those two steps, it's dropped (the message-loop branch checks `rateLimitTracker?.record(...)` and silently no-ops).
**Why it happens:** SessionManager's per-agent boot sequence is async.
**How to avoid:** Mirror Phase 96's pattern — construct the tracker BEFORE `setRateLimitTracker` is called, AT handle-construction in `createPersistentSessionHandle` if a factory is passed via baseOptions; OR accept the dropped first-event as best-effort and document. The Claude app has no first-event-criticality, so best-effort is fine. **Recommend: best-effort + comment.**

### Pitfall 9: `surpassedThreshold` semantics
**What goes wrong:** `SDKRateLimitInfo.surpassedThreshold` is an OPTIONAL number, not a boolean. It carries the threshold that was just crossed (e.g. 0.75 for 75%). Treating as bool inverts semantics.
**Why it happens:** Field name reads bool-ish.
**How to avoid:** Render via `if (snapshot.surpassedThreshold !== undefined) embed.addFields({name: '⚠ Threshold crossed', value: \`${pct(snapshot.surpassedThreshold)}\`})`. Never compare to true/false.

### Pitfall 10: SDK pre-1.0 type drift
**What goes wrong:** `SDKRateLimitInfo` is added in 0.2.x; `rateLimitType` enum could grow new values (e.g. a future `seven_day_haiku`).
**Why it happens:** SDK is pre-1.0 — STATE.md explicitly warns "expect breaking changes between minor versions".
**How to avoid:** Use a `Record<string, RateLimitSnapshot>` keyed by the rateLimitType STRING (not a strict 5-value union) so an unrecognized type still gets stored and rendered (with a graceful "unknown type" label). Pin SDK version EXACT (already enforced).
**Warning signs:** Plans that switch-exhaustively on the 5-value union without a default branch.

## Code Examples

Verified patterns from official sources.

### Example 1: Capturing SDKRateLimitInfo in iterateUntilResult
```typescript
// Source: src/manager/persistent-session-handle.ts:469 (msg dispatch site)
//         + node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2540-2563

import type { SDKRateLimitEvent, SDKRateLimitInfo } from "@anthropic-ai/claude-agent-sdk";

// Inside iterateUntilResult, after line 469 (`const msg = step.value;`):
if ((msg as { type?: string }).type === "rate_limit_event") {
  try {
    const event = msg as unknown as SDKRateLimitEvent;
    if (event.rate_limit_info) {
      // Frozen snapshot pushed to per-agent tracker. record() is sync,
      // best-effort persisted via fire-and-forget like extractUsage.
      rateLimitTracker?.record(event.rate_limit_info);
    }
  } catch {
    // Observational — never break message flow (matches extractUsage at line 290).
  }
  // Do NOT continue/break — let the loop progress to the next driverIter.next().
}
```

### Example 2: RateLimitTracker primitive (sketch)
```typescript
// Source: NEW file src/usage/rate-limit-tracker.ts
//         pattern based on src/usage/tracker.ts:46-103

import type { Database as DatabaseType, Statement } from "better-sqlite3";
import type { SDKRateLimitInfo } from "@anthropic-ai/claude-agent-sdk";

export type RateLimitSnapshot = Readonly<{
  rateLimitType: string;          // not narrowed — see Pitfall 10
  status: 'allowed' | 'allowed_warning' | 'rejected';
  utilization: number | undefined;
  resetsAt: number | undefined;
  surpassedThreshold: number | undefined;
  overageStatus: string | undefined;
  overageResetsAt: number | undefined;
  isUsingOverage: boolean | undefined;
  recordedAt: number;             // local clock; for staleness diagnostics
}>;

export class RateLimitTracker {
  private readonly latest = new Map<string, RateLimitSnapshot>();
  private readonly insertStmt: Statement;
  private readonly selectAllStmt: Statement;

  constructor(private readonly db: DatabaseType) {
    db.exec(`CREATE TABLE IF NOT EXISTS rate_limit_snapshots (
      rate_limit_type TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      recorded_at INTEGER NOT NULL
    )`);
    this.insertStmt = db.prepare(
      `INSERT INTO rate_limit_snapshots(rate_limit_type, payload, recorded_at)
       VALUES (?, ?, ?)
       ON CONFLICT(rate_limit_type) DO UPDATE SET
         payload = excluded.payload,
         recorded_at = excluded.recorded_at`,
    );
    this.selectAllStmt = db.prepare(`SELECT rate_limit_type, payload, recorded_at FROM rate_limit_snapshots`);
    // Restore on construction.
    for (const row of this.selectAllStmt.all() as Array<{rate_limit_type: string; payload: string; recorded_at: number}>) {
      try {
        this.latest.set(row.rate_limit_type, JSON.parse(row.payload));
      } catch { /* corrupt row — skip */ }
    }
  }

  record(info: SDKRateLimitInfo): void {
    const type = info.rateLimitType ?? 'unknown';
    const snapshot: RateLimitSnapshot = Object.freeze({
      rateLimitType: type,
      status: info.status,
      utilization: info.utilization,
      resetsAt: info.resetsAt,
      surpassedThreshold: info.surpassedThreshold,
      overageStatus: info.overageStatus,
      overageResetsAt: info.overageResetsAt,
      isUsingOverage: info.isUsingOverage,
      recordedAt: Date.now(),
    });
    this.latest.set(type, snapshot);
    try {
      this.insertStmt.run(type, JSON.stringify(snapshot), snapshot.recordedAt);
    } catch {
      // observational — in-memory state is the source of truth for this turn
    }
  }

  getLatest(type: string): RateLimitSnapshot | undefined { return this.latest.get(type); }
  getAllSnapshots(): readonly RateLimitSnapshot[] { return Object.freeze([...this.latest.values()]); }
}
```

### Example 3: Wiring 8 already-available fields into buildStatusData
```typescript
// Source: src/discord/status-render.ts:74-87 (BuildStatusDataInput)
//         existing SessionManager getters at session-manager.ts:1059, 1640

// Extend BuildStatusDataInput:
export type BuildStatusDataInput = Readonly<{
  sessionManager: Pick<
    SessionManager,
    | "getEffortForAgent"
    | "getModelForAgent"
    | "getPermissionModeForAgent"
    | "getSessionHandle"
    | "getCompactionCountForAgent"     // NEW (OBS-02)
    | "getRateLimitTrackerForAgent"    // NEW (OBS-04)
  >;
  resolvedAgents: readonly ResolvedAgentConfig[];
  agentName: string;
  agentVersion: string;
  commitSha: string | undefined;
  /** Heartbeat zone fillPercentage (0-1) — sourced from heartbeat-status IPC. */
  contextFillPercentage: number | undefined;   // NEW (OBS-01)
  /** Last UsageEvent.timestamp for this agent (ms epoch). */
  lastActivityAt: number | undefined;          // NEW (OBS-01) — wire from UsageTracker
  /** UsageTracker.getSessionUsage(sessionId) result. */
  sessionUsage: UsageAggregate | undefined;    // NEW (OBS-01)
  /** Registry boot timestamp from registry.json. */
  activationAt: number | undefined;            // NEW (OBS-01)
  now: number;
}>;
```

### Example 4: EmbedBuilder for /clawcode-usage (mirrors sync-status-embed.ts)
```typescript
// Source: NEW file src/discord/usage-embed.ts
//         pattern based on src/discord/sync-status-embed.ts:42-194

import { EmbedBuilder } from "discord.js";
import { formatDistanceToNow } from "date-fns";
import type { RateLimitSnapshot } from "../usage/rate-limit-tracker.js";

const COLOR_HAPPY = 3066993;        // green — all snapshots 'allowed'
const COLOR_WARN = 15844367;        // yellow — any 'allowed_warning'
const COLOR_REJECT = 15158332;      // red — any 'rejected'
const BAR_WIDTH = 10;

export function renderBar(utilization: number | undefined): string {
  if (utilization === undefined) return '─'.repeat(BAR_WIDTH) + ' n/a';
  const filled = Math.round(utilization * BAR_WIDTH);
  const pct = Math.round(utilization * 100);
  return '▓'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled) + ` ${pct}%`;
}

export function buildUsageEmbed(input: {
  agent: string;
  snapshots: readonly RateLimitSnapshot[];
  now: number;
}): EmbedBuilder {
  const { agent, snapshots, now } = input;
  const worst = snapshots.reduce<'allowed' | 'allowed_warning' | 'rejected'>(
    (acc, s) => s.status === 'rejected' ? 'rejected' : (s.status === 'allowed_warning' && acc !== 'rejected' ? 'allowed_warning' : acc),
    'allowed',
  );
  const color = worst === 'rejected' ? COLOR_REJECT : worst === 'allowed_warning' ? COLOR_WARN : COLOR_HAPPY;
  const embed = new EmbedBuilder()
    .setTitle(`Usage — ${agent}`)
    .setColor(color);

  if (snapshots.length === 0) {
    embed.setDescription('No usage data yet. Either no turns have run since the daemon started, or this session is not authenticated via OAuth Max.');
    return embed;
  }

  // Order: five_hour, seven_day, seven_day_opus, seven_day_sonnet, overage
  const order = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet', 'overage'];
  for (const t of order) {
    const s = snapshots.find(x => x.rateLimitType === t);
    if (!s) continue;
    const reset = s.resetsAt ? formatDistanceToNow(s.resetsAt, { addSuffix: true }) : 'unknown';
    embed.addFields({
      name: `${labelFor(t)} — ${emojiFor(s.status)}`,
      value: `\`${renderBar(s.utilization)}\` · resets ${reset}`,
      inline: false,
    });
  }
  embed.setFooter({ text: `Snapshot age: ${formatDistanceToNow(snapshots[0].recordedAt, { addSuffix: true })}` });
  return embed;
}
```

### Example 5: Vitest pattern for SDK rate_limit_event mocking
```typescript
// Source: src/manager/__tests__/persistent-session-cache.test.ts:32-100 (canonical buildFakeSdk)

import type { SdkStreamMessage } from "../sdk-types.js";

// In a new test file: src/manager/__tests__/rate-limit-event-capture.test.ts
const turnOutputs: SdkStreamMessage[][] = [
  [
    {
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'allowed_warning',
        rateLimitType: 'five_hour',
        utilization: 0.87,
        resetsAt: Date.now() + 3600_000,
      },
      uuid: 'evt-1',
      session_id: 'sess-1',
    } as unknown as SdkStreamMessage,
    { type: 'assistant', /* ... */ } as SdkStreamMessage,
    { type: 'result', subtype: 'success', result: 'ok', /* ... */ } as SdkStreamMessage,
  ],
];
const { fakeSdk } = buildFakeSdk(turnOutputs);
// Then assert: tracker.getLatest('five_hour')?.utilization === 0.87
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Phase 93 Plan 01: 9-line block with hardcoded `n/a` placeholders | Phase 103: live values from existing managers + new rate-limit tracker | This phase (proposed v2.7) | Operator-facing surface goes from "scaffolding" to "actually useful" |
| OpenClaw `/status`: text-only render with Fast/Elevated/Harness | ClawCode `/clawcode-status`: EmbedBuilder, drops OpenClaw-only fields, adds OAuth Max usage bars | This phase | Surface aligns with ClawCode runtime semantics, not OpenClaw legacy |
| API-key auth + manual budget tracking | OAuth Max subscription + SDK-emitted rate_limit_event | SDK 0.2.x (already pinned) | Server-authoritative limit data; no manual accounting |

**Deprecated/outdated:**
- Phase 93's `n/a` placeholders for the 11 fields — this phase replaces them.
- Three OpenClaw-only fields (`Fast`, `Elevated`, `Harness`) in `status-render.ts:204-211`.

## Open Questions

1. **Should `surpassedThreshold` trigger a Discord ephemeral notification proactively, or only show in /clawcode-usage on demand?**
   - What we know: SDK sets `surpassedThreshold` when a configured threshold (e.g. 75%) is just crossed. ROADMAP doesn't specify proactive notification.
   - What's unclear: Whether operators want a passive panel or active warnings.
   - Recommendation: ship passive in v1; revisit after operator UAT.

2. **Where should the per-agent SQLite path for rate-limit snapshots live?**
   - What we know: UsageTracker uses `~/.clawcode/agents/{agent}/usage.db`. Adding a `rate_limit_snapshots` table to that DB shares the WAL config.
   - What's unclear: Whether splitting into a separate `~/.clawcode/agents/{agent}/observability.db` future-proofs other observability tables. v2.x precedent is "one DB per concern" (memory.db, usage.db).
   - Recommendation: extend `usage.db` for now (single concern: usage observability). Defer split to a future phase if observability grows beyond rate-limits + usage events.

3. **How do we treat `rateLimitType: 'overage'` in the panel?**
   - What we know: `overage` is logically a SEPARATE bucket, not a percentage. `overageStatus`, `overageResetsAt`, `overageDisabledReason`, `isUsingOverage` are its fields — `utilization` may not be meaningful.
   - What's unclear: Render as a fifth bar, or as a status-line?
   - Recommendation: render as status-line ("Overage: enabled · resets Mon · using credits since 2pm") — bar metaphor doesn't fit a credit-pool model.

4. **Should `Compactions` count be reset on agent restart?**
   - What we know: A SessionManager-owned counter is in-memory only.
   - What's unclear: Operator expectation. OpenClaw resets on restart; that's the parity baseline.
   - Recommendation: in-memory only, resets on restart. Persistence is over-engineering for a counter that's purely informational.

5. **Does the `Activation` field show daemon-boot or agent-restart?**
   - What we know: `~/.clawcode/manager/registry.json` carries per-agent registration timestamp (from Phase 89/90). Agent restart updates that.
   - Recommendation: agent-restart timestamp (matches operator mental model — "when did this agent last start?").

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.x (project-pinned, ESM-first) |
| Config file | (none in repo root — vitest auto-discovers `*.test.ts`) |
| Quick run command | `npx vitest run path/to/file.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OBS-01 | `buildStatusData` returns live values for the 8 already-available fields | unit | `npx vitest run src/discord/__tests__/status-render.test.ts` | ✅ extend |
| OBS-02 | `SessionManager.getCompactionCountForAgent` increments on `CompactionManager.compact()` resolve | unit | `npx vitest run src/manager/__tests__/compaction-counter.test.ts` | ❌ Wave 0 |
| OBS-03 | `renderStatus` does NOT include `Fast`, `Elevated`, `Harness` substrings | unit | `npx vitest run src/discord/__tests__/status-render.test.ts` | ✅ extend |
| OBS-04 | `RateLimitTracker.record(info)` updates in-memory + SQLite; `getLatest(type)` returns frozen snapshot; round-trip via constructor restore | unit | `npx vitest run src/usage/__tests__/rate-limit-tracker.test.ts` | ❌ Wave 0 |
| OBS-05 | A `rate_limit_event` SDK message in turn output causes the per-agent tracker to record the snapshot (canonical buildFakeSdk pattern) | unit (SDK-mock) | `npx vitest run src/manager/__tests__/rate-limit-event-capture.test.ts` | ❌ Wave 0 |
| OBS-06 | IPC `list-rate-limit-snapshots` returns `{agent, snapshots[]}` with shape pinned by zod | unit | `npx vitest run src/ipc/__tests__/protocol.test.ts` | ✅ extend |
| OBS-07 | `buildUsageEmbed` produces correct color per worst-status, correct field count, sentinel "no data" path | unit | `npx vitest run src/discord/__tests__/usage-embed.test.ts` | ❌ Wave 0 |
| OBS-08 | (If chosen) `renderStatus` appends 2 progress bars when snapshots present; emits nothing when absent | unit | `npx vitest run src/discord/__tests__/status-render.test.ts` | ✅ extend |
| OBS-meta | Slash-command registry size remains under 90 (Pitfall 6 closure) | static-grep / structural | `npx vitest run src/discord/__tests__/slash-types-cap.test.ts` | ✅ extend (per STATE.md `PFS-CAP-BUDGET` precedent) |

### Sampling Rate
- **Per task commit:** `npx vitest run <touched test file>` (typically <10s).
- **Per wave merge:** `npx vitest run src/usage src/discord src/manager` (~30s).
- **Phase gate:** `npx vitest run` (full suite green) before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `src/usage/__tests__/rate-limit-tracker.test.ts` — covers OBS-04 (in-memory record, persistence round-trip, frozen snapshot invariant)
- [ ] `src/manager/__tests__/rate-limit-event-capture.test.ts` — covers OBS-05 (SDK mock + iterateUntilResult capture)
- [ ] `src/manager/__tests__/compaction-counter.test.ts` — covers OBS-02 (counter mirror increment on compact() success)
- [ ] `src/discord/__tests__/usage-embed.test.ts` — covers OBS-07 (color triage, field rendering, no-data path)
- [ ] `src/discord/__tests__/slash-commands-usage.test.ts` — covers /clawcode-usage inline-handler dispatch + admin gate (if any)
- [ ] No framework install required — vitest is project-pinned and shared fixtures live in existing test files.

## Sources

### Primary (HIGH confidence)
- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2540-2563` — SDKRateLimitEvent + SDKRateLimitInfo authoritative type signatures.
- `src/manager/persistent-session-handle.ts:401-674` — iterateUntilResult message-dispatch loop; the integration point for the `rate_limit_event` branch.
- `src/manager/session-adapter.ts:81-191` — SessionHandle interface, the contract surface for all per-handle accessors.
- `src/discord/status-render.ts:1-305` — current `/clawcode-status` renderer, every line of every field documented inline.
- `src/discord/slash-commands.ts:1-1518` — slash command dispatch including the `/clawcode-status` inline handler at 1493-1518.
- `src/discord/slash-types.ts:441-554` — CONTROL_COMMANDS registration shape.
- `src/discord/sync-status-embed.ts:1-194` — canonical EmbedBuilder template for operator-facing panels.
- `src/ipc/protocol.ts:1-258` — IPC method registry; identifies the `rate-limit-status` collision.
- `src/manager/daemon.ts:4074-4081` — existing `rate-limit-status` handler (Discord outbound, NOT OAuth Max).
- `src/usage/tracker.ts:1-200` — UsageTracker patterns for SQLite + prepared statements + per-agent isolation.
- `src/memory/compaction.ts:1-170` — CompactionManager surface; CompactionResult shape (no count field today).
- `src/heartbeat/context-zones.ts` + `src/manager/daemon.ts:4111-4118` — context-zone-status IPC; the source of `Context %` field.
- `src/manager/persistent-session-queue.ts:78-128` — SerialTurnQueue; depth-1 inFlight slot exposed via `hasActiveTurn()`.
- `src/manager/__tests__/persistent-session-cache.test.ts:32-100` — canonical `buildFakeSdk` test helper (verbatim reuse for OBS-05).
- `.planning/STATE.md:99..295` — Phase 85/86/89/90/91/92/95/96/100 patterns: inline-handler-short-circuit (10 applications), DI-mirror (6 applications), additive-optional schema blueprint (10 applications).
- `.planning/ROADMAP.md:520-543` — Phase 103 scope, sub-scope candidates, and explicit field list.

### Secondary (MEDIUM confidence)
- Claude iOS app screenshot (referenced in ROADMAP) — visual reference for "5h session" + "7-day weekly" panel layout. Not in repo; design intent only.

### Tertiary (LOW confidence)
- None. All claims in this document are backed by direct file reads at exact line numbers or SDK type signatures.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every package version verified against installed `node_modules`; `npm view` not required because the repo lockfile + sdk.d.ts are authoritative.
- Architecture (hook points + DI mirror): HIGH — every pattern lifted verbatim from existing in-repo phases (85/96 for DI mirror, 91 for embed, 95 for inline short-circuit). Line numbers cited.
- Pitfalls: HIGH for Pitfalls 1-8 (all sourced from STATE.md decisions or direct file reads). MEDIUM for Pitfall 9-10 (forward-looking SDK guesses; documented as "expect" not "will").
- Test architecture: HIGH — vitest framework + buildFakeSdk pattern are both already in use in the repo.
- The 3 missing primitives (`Fallbacks`, `Compactions count`, `Reasoning label`): HIGH — confirmed via grep that no current source carries them.

**Research date:** 2026-04-29
**Valid until:** ~2026-05-29 (30 days for stable areas; SDK could ship a 0.3.x with breaking type changes inside that window — re-verify `SDKRateLimitInfo` shape if that happens).
