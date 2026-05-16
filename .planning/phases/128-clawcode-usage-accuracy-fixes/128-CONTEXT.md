# Phase 128: clawcode Usage Accuracy Fixes — Context

**Gathered:** 2026-05-15
**Status:** PARKED 2026-05-15 — operator decision after spike confirmed no SDK pull API exists
**Mode:** Operator-reported bug (2026-05-15) — `clawcode usage` shows weekly at 89% when actual Anthropic usage is under 50%.

## PARKED — 2026-05-15

T-01 survey (`128-01-SURVEY.md`) and a follow-up confirmation grep against `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` both establish:

- The Claude Agent SDK exposes rate-limit data via push event (`SDKRateLimitEvent`) only.
- No pull-style query method exists. `getContextUsage()` at `sdk.d.ts:2123` is context-window telemetry, not rate-limit state.
- The plan's "preferred" D-02 path (SDK pull) is therefore impossible. The fallback (synthetic 1-token probe) self-pollutes the rate limit it measures.

The bug is a stale-display annoyance — not a correctness issue. Operators can mentally discount the high-water mark until Anthropic ships a pull API, at which point this phase resumes against a clean source.

**Resume trigger:** Anthropic publishes a pull-style rate-limit endpoint, OR operator decides the display drift is causing measurable harm.

**Artifacts retained:** `128-CONTEXT.md`, `128-01-PLAN.md`, `128-01-SURVEY.md`. Executor worktree pruned 2026-05-15.

<canonical_refs>
## Canonical References

| Ref | Why | Path |
|-----|-----|------|
| Operator bug report | "Weekly shows 89% when actually <50%" | This session, 2026-05-15 |
| RateLimitSnapshot type + tracker | Source of the stale-snapshot bug | `src/usage/rate-limit-tracker.ts` (lines 25-40 schema, lines 64-87 deriveUtilization) |
| Phase 999.4 normalizeEpochToMs | Prior fix for `resetsAt` seconds-vs-ms — proves Phase 999.4 partially shipped | `src/usage/rate-limit-tracker.ts:44-58` |
| Phase 999.4 deriveUtilization | The function with the stuck-at-threshold bug | `src/usage/rate-limit-tracker.ts:64-87` |
| daemon list-rate-limit-snapshots IPC | Reads snapshots from in-memory + SQLite cache | `src/manager/daemon-rate-limit-ipc.ts` |
| Dashboard CostDashboard primary bars | Where the 89%-stale value renders | `src/dashboard/client/src/components/CostDashboard.tsx:399-400, 550` |
| Discord usage embed | Other render surface | `src/discord/usage-embed.ts` |
| /api/usage endpoint | HTTP wrapper backing dashboard | `src/dashboard/server.ts:1505-1530` |
| Anthropic SDK rate_limit_event | The push event that drives current behavior | `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (search `SDKRateLimitInfo`) |
| Phase 116-postdeploy usage redesign | The current `/dashboard/v2/usage` surface that needs accurate data | `.planning/phases/116-dashboard-redesign-modern-ui-mobile-basic-advanced/116-USAGE-REDESIGN.md` |
| feedback_silent_path_bifurcation.md | Anti-pattern — single source-of-truth for utilization values | memory |
</canonical_refs>

<domain>
## Phase Boundary

`clawcode usage` CLI + dashboard `/dashboard/v2/usage` + Discord `/clawcode-usage` slash command + `/clawcode-status` embed bar suffix all share ONE source: `RateLimitSnapshot` rows from `rate-limit-tracker.ts`. The snapshot is push-driven by Anthropic SDK `rate_limit_event`, which fires ONLY on threshold crossings (0.5, 0.8, 0.9 thresholds) — NOT on every API request.

**The bug:** when usage crosses a threshold (e.g., 0.9), the tracker stores `utilization: 0.89` (from `deriveUtilization` falling back to `surpassedThreshold`). When actual usage subsequently drops (e.g., back to 40%), NO event fires because no threshold is crossed in the downward direction. The 89% value sits in the snapshot until:
- The reset timer fires (`resetsAt`)
- A higher threshold is crossed (unlikely if usage stays flat or drops)
- The daemon restarts

Operator sees "weekly 89%" hours after actual usage has dropped — a high-water mark, not current state.

**In scope:**
- Replace the high-water-mark snapshot with a current-state utilization reading.
- Per-rate-limit-type: 5h, 7d, 7d-opus, 7d-sonnet.
- Single source-of-truth for the value — fix at the tracker layer; all render surfaces (CLI, dashboard, Discord embed, slash) inherit.
- Telemetry log so operator can grep `phase128-usage-refresh` to see refresh cadence.
- Backward-compatible snapshot schema — render surfaces must not break on a refreshed snapshot vs an event-driven one.

**Out of scope:**
- Per-model breakdowns beyond what the SDK provides (opus/sonnet carve-outs are already in scope per existing `rateLimitType` enum).
- Cost / USD telemetry — that's the "theoretical API-equivalent USD" surface demoted in Phase 116. Untouched here.
- Anthropic billing API integration if it requires new auth — only scope if existing SDK auth (`OAuthMaxSession` per CLAUDE.md) can hit the necessary endpoint.
- Token-by-token accounting — out of scope unless required to compute utilization (it isn't — see D-02).

</domain>

<decisions>
## Implementation Decisions

### Root cause confirmed

- **D-01:** **The stale-snapshot bug** is in `rate-limit-tracker.ts:77-87 deriveUtilization`:
  - `status === "allowed_warning" && surpassedThreshold !== undefined` → returns `surpassedThreshold` (e.g., 0.9). This is documented as a "conservative lower bound."
  - Once stored, the snapshot never refreshes downward — only the next threshold crossing OR reset can update it.
  - Operator-visible result: stale high-water mark displayed indefinitely.

### Refresh mechanism (the fix)

- **D-02:** **Periodic poll of current usage** — daemon runs a cron-driven refresh every N minutes that queries actual current usage and overwrites the snapshot.

  **Source of truth for the polled value:**
  - **Preferred:** Anthropic SDK exposes `rate_limit_event` push only — no pull. Investigate if the SDK has a `getRateLimitStatus()` or similar query method (`Query.getRateLimitInfo()` or `SDKMessage` types). If the SDK exposes a pull, use it.
  - **Fallback:** issue a minimal "count tokens" or HEAD request against `messages.create` with a 1-token prompt to trigger a fresh `rate_limit_event`. This is hacky but works on existing auth. Cost: ~1 input token per agent per poll cycle.
  - **Decision deferred to plan-research:** plan-phase research reads `sdk.d.ts` for a pull-style API. If absent, the fallback ships with a structured-log warning and a follow-up to lobby Anthropic for a pull endpoint.

- **D-02a:** **Poll cadence: 5 minutes default**, per-agent override via `defaults.usageRefreshIntervalMs` in `clawcode.yaml`. Range 60000ms..3600000ms. Reloadable (cron handler re-reads on each tick).

### Single chokepoint

- **D-03:** **Single source-of-truth at `rate-limit-tracker.ts`** per `feedback_silent_path_bifurcation.md`. The refresh writes through the SAME `recordSnapshot()` path the rate-limit-event handler uses today. All render surfaces (CLI, dashboard, Discord embed, slash) read from the same tracker — no per-surface staleness.

### Staleness telemetry

- **D-04:** **Add `recordedAt` field display** — `RateLimitSnapshot` already has `recordedAt` (line 39: "Local Date.now() at record time"). Render surfaces should show the age (e.g., "weekly 47% · refreshed 2 min ago"). When `Date.now() - recordedAt > 2× pollIntervalMs`, mark as stale (yellow / "⚠️ stale") so operator knows the refresh path is broken.

### deriveUtilization fix

- **D-05:** **Tighten `deriveUtilization`** — when SDK omits `utilization` AND status is `allowed_warning`, do NOT fall back to `surpassedThreshold` if the refresh poll is providing a fresher value. The threshold-bound is only a fallback when the SDK provides NEITHER `utilization` nor a more authoritative source.

  Current order:
  - `info.utilization` (SDK direct)
  - `deriveUtilization(undefined, "allowed_warning", 0.9)` → returns 0.9 (lower bound)

  New order:
  - `info.utilization` (SDK direct)
  - Poll-fetched current utilization (D-02)
  - `deriveUtilization(undefined, "allowed_warning", 0.9)` → returns 0.9 (lower bound ONLY when poll is unavailable)

### Structured logging

- **D-06:** **`phase128-usage-refresh` log key** per Phase 999.54 / Phase 127 precedent. Payload: `{agentName, rateLimitType, oldUtilization, newUtilization, source: "poll" | "event" | "derived", recordedAt}`. Operator greps `journalctl -u clawcode -g phase128-usage-refresh` to confirm refresh cadence.

### Tests

- **D-07:** **Synthetic refresh test** — inject mock poll source returning controlled values; assert the snapshot updates on every poll cycle; assert the stale-detection logic flags snapshots older than 2× pollIntervalMs; assert deriveUtilization fallback ONLY fires when poll source is unavailable.

### Reloadable

- **D-08:** **`usageRefreshIntervalMs` is RELOADABLE.** Cron handler reads the interval on each tick; ConfigWatcher hot-reload picks up changes without daemon restart.

### Claude's Discretion

- Cron registration site: existing scheduler in `src/manager/` (search `croner` imports — there's a per-agent task scheduler from v1.1 Phase 7).
- Poll implementation: if SDK exposes pull, prefer that; if not, fall back to the synthetic-token-probe pattern.
- Dashboard staleness UI: yellow border + "⚠️ stale" label when recordedAt > 2× interval. Mirror the existing tier-2 indicator pattern in `CostDashboard.tsx`.

</decisions>

<code_context>
## Existing Code Insights

- **Phase 999.4 partially shipped** — `normalizeEpochToMs` (resetsAt seconds→ms) + `deriveUtilization` (the buggy lower-bound fallback) are already in master. Phase 128 BUILDS on them — doesn't replace.
- **`RateLimitSnapshot` is Object.freeze'd** (line 14 jsdoc) per immutability rule. The refresh writes a NEW snapshot replacing the old, not mutating.
- **SQLite cache** survives daemon restart. The bug is independent of restart — even after restart, the tracker reads the last-stored 89% from SQLite.
- **Render surfaces converge on the tracker** — `daemon-rate-limit-ipc.ts` IPC handler returns `tracker.getAllSnapshots()`. CLI, dashboard, Discord all hit this single IPC. Per-surface drift is impossible by design (Phase 103 OBS-06 architecture).
- **Phase 116-postdeploy usage redesign** is the operator-facing surface. Fixing the data layer here transparently fixes that page.
- **No existing poll-based usage code** — current implementation is purely push-driven via SDK rate-limit events. This phase introduces the FIRST poll source.

</code_context>

<specifics>
## Specific Ideas

- **Default poll interval:** 5 minutes (300_000ms). Acceptable cost (~1 input token / agent / 5min = ~2K tokens/day across 7 agents — negligible).
- **Stale threshold:** 2× pollIntervalMs (10 min at default). Beyond that, render shows "⚠️ stale (refreshed N min ago)".
- **Log key:** `phase128-usage-refresh` matching Phase 999.54 / Phase 127 grep precedent.
- **Migration:** existing snapshots in SQLite stay; the poll cycle naturally overwrites them on first tick post-deploy.

</specifics>

<deferred>
## Deferred Ideas

- **Local token-accounting** (compute utilization from accumulated request tokens vs window cap) — fallback if poll path doesn't work; not pursued in v1 because the SDK push-event already gives accurate values when it fires.
- **Per-model token-class telemetry** beyond `seven_day_opus` / `seven_day_sonnet` — out of scope; the SDK's existing carve-out types cover what operators need.
- **USD cost re-attribution** — Phase 116 demoted that surface; not part of accuracy fixes.
- **Auto-tuning poll cadence** based on rate-limit event frequency — over-engineering for v1.

</deferred>

<scope_creep_guardrail>
## Scope Guardrail

Phase 128 scope:
- **YES:** Fresh utilization values from a poll source (or equivalent); staleness UI; structured refresh log.
- **NO:** New auth flows (use existing SDK auth); per-model breakdowns beyond existing types; cost dashboards; token-by-token accounting.

Reject "while we're at it, also rebuild the cost dashboard" — Phase 116 owns that surface.

</scope_creep_guardrail>
