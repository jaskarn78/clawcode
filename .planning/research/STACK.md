# Technology Stack — v2.9 Reliability & Routing

**Milestone:** v2.9 Reliability & Routing
**Researched:** 2026-05-13
**Verdict:** **No new dependencies.** All six target work-streams (MG-A/B/C/D + 999.46 + 999.19/20) fit inside the existing stack. Optional patch-bump for `discord.js` (14.26.2 → 14.26.4) is **not required** for any v2.9 fix.
**Confidence:** HIGH

---

## Summary

v2.9 is reliability hardening + UX cleanup on already-built subsystems. The hypothesis stated in the research prompt — "ZERO new dependencies needed" — is **validated**. Every v2.9 feature has a clear home in code already shipped:

| Work | Existing module / library it lands in |
|------|---------------------------------------|
| MG-A: A2A no-webhook fallback (999.44), queue-icon coherence (999.45), heartbeat leak (999.48) | `src/discord/webhook-manager.ts`, `src/discord/bridge.ts`, `src/manager/daemon.ts` (ask-agent IPC), `src/discord/delivery-queue.ts` — all on `discord.js@14.26.2` |
| MG-D: Benchmarks empty rows + null-percentile breach-red (999.49), split-latency producer regression + tool-latency-audit CLI (999.7-B/C) | `src/performance/trace-store.ts`, `trace_spans` / `tool_latency` SQLite tables, dashboard React surface (no new deps — recharts + tanstack-query already present) |
| MG-B: Premature-completion gate (999.36-02), chunk-boundary off-by-3 (999.36-03) | Single file: `src/discord/subagent-thread-spawner.ts`. Existing chunking lives there + `src/discord/streaming.ts`. |
| MG-C: MCP lifecycle soak (999.6/.14/.15) | Pure execute of pre-written plans. `@modelcontextprotocol/sdk@1.29.0` (latest, transitive via Claude Agent SDK). No code, no deps. |
| 999.46: Markdown-table auto-wrap | New helper in daemon's Discord output formatter (likely `src/discord/streaming.ts` or a sibling). Pure-string detection — no parser dep needed. |
| 999.19 + 999.20: Subagent delegate-channel routing + `/research` commands | `src/discord/subagent-thread-spawner.ts` + native CC slash registration (already wired in v2.2). `better-sqlite3` for delegate memory consolidation. |

Zero new runtime packages. Zero new dev tools. v2.2 also added zero packages — same precedent (`.planning/PROJECT.md:140`).

---

## Current Stack Validation

All capabilities required by v2.9 are present and current:

| Capability | Library | Pinned | Latest | Action |
|------------|---------|--------|--------|--------|
| Discord client + webhooks + slash | `discord.js` | ^14.26.2 | 14.26.4 | **Hold.** Patches unrelated (TeamMember perms, uncached-DMChannel). See "Version Verification". |
| MCP client/server | `@modelcontextprotocol/sdk` | (transitive) 1.29.0 | 1.29.0 | **Current.** Latest published. |
| Agent lifecycle | `@anthropic-ai/claude-agent-sdk` | ^0.2.140 | (in tree) | **Hold.** Not part of v2.9 fix surface. |
| SQLite + vec | `better-sqlite3` ^12.8.0, `sqlite-vec` ^0.1.9 | pinned | — | **Sufficient.** `trace_spans` + delegate-memory consolidation are pure SQL on existing tables. |
| Direct Haiku 4.5 (vision) | `@anthropic-ai/sdk` ^0.95.1 | pinned | — | Not used in v2.9. |
| Validation | `zod` ^4.3.6 | pinned | — | Sufficient for any new config-knob additions (delegate routing toggle, table-wrap threshold). |
| Logging | `pino` ^9 | pinned | — | Sufficient for new MG-A diagnostic events (webhook miss, queue-state transition). |
| Cron / scheduler | `croner` ^10.0.1 | pinned | — | 999.48 heartbeat-routing fix is a destination-channel correction, not a scheduler change. |
| Dashboard charts | `recharts` ^3.8.1 (dev) | pinned | — | MG-D fixes are data-shape + null-handling, not a chart-lib swap. |

---

## Proposed Additions

**None.** Every candidate considered below was rejected — see "What NOT to Add".

---

## Version Verification

Verified against npm registry on 2026-05-13:

### discord.js (in-tree 14.26.2 — latest 14.26.4)

```
14.26.2  2026-04-03  (currently pinned)
14.26.3  2026-04-14  Bug: "Allow a default permissions in TeamMember"
14.26.4  2026-05-01  Bug: "Receive DMs in uncached DMChannels again"
```

Source: `npm view discord.js time --json`, GitHub releases. **Neither patch touches webhooks, message routing, rate limiting, or interaction handling.** Confidence: HIGH. There is no upstream-fix shortcut for the MG-A no-webhook fallback bug — it has to be fixed in our `webhook-manager.ts` / `bridge.ts`.

Recommendation: **do not bump** during MG-A's investigation window — keeps the change-surface minimal so any reproduced webhook miss is unambiguously attributable to our code. A patch-bump to 14.26.4 can ride a separate maintenance commit after MG-A ships.

### @modelcontextprotocol/sdk (in-tree 1.29.0 — latest 1.29.0)

```
1.29.0  current via @anthropic-ai/claude-agent-sdk@0.2.140
```

Source: `npm view @modelcontextprotocol/sdk dist-tags`, `npm ls`. Latest. No action.

### discord.js 15.x (pre-release)

```
15.0.0-dev.1777075897   (dev-tag pre-release)
```

**Do not upgrade.** v15 is still on dev tags; breaking changes are likely. v14.26 is the production line.

---

## What NOT to Add

Each of these was considered for a specific v2.9 work-stream and **rejected** for the reason listed.

| Candidate | Considered for | Why NOT |
|-----------|---------------|---------|
| `marked` / `markdown-it` / `remark` | 999.46 Discord table auto-wrap | A regex pass detecting lines matching `^\s*\|.*\|\s*$` plus a separator row `^\s*\|[\s:|-]+\|\s*$` is ≤30 LOC and zero-dependency. Pulling a full Markdown AST into the Discord hot path for this single transform is overkill and adds bundle weight to the daemon. |
| `gfm-table-detector` / similar micro-libs | 999.46 | Maintenance risk (single-maintainer micro-deps) for a problem solved by a 10-line scanner. No. |
| A Discord webhook health-checker library | MG-A 999.44 | None exist as a library — webhook validation is `client.fetchWebhook(id, token)` returning 404 on expiry, which discord.js already exposes. The fix is a registry-state audit + re-create on miss, not a new dep. |
| `node-cron` / `bullmq` | 999.48 heartbeat routing | Heartbeat scheduling is already `croner`. The bug is a destination-channel routing leak (wrong sink), not a scheduling issue. |
| A chunk-boundary streamer (`split2`, `byline`) | MG-B 999.36-03 (off-by-3 chunk boundary) | This is a 3-byte indexing bug in `src/discord/subagent-thread-spawner.ts` at the 2000-char Discord message limit minus marker tokens. It is an integer arithmetic fix — adding a streaming library would obscure the bug, not fix it. |
| `p-queue` / `p-limit` | MG-A 999.45 queue-state icon coherence | We already have `DeliveryQueue` (v1.2) + `WebhookManager`. The bug is state-machine observability, not concurrency control. |
| Bumping `@anthropic-ai/claude-agent-sdk` | MG-C MCP soak | The SDK isn't the surface here — `McpProcessTracker` + `/proc-walk` + reaper are first-party code in `src/mcp/*`. |
| `@modelcontextprotocol/inspector` | MG-C verify wave | CLI inspector for MCP development; we already have `clawcode mcp-tracker` CLI from Phase 999.15. Adding inspector ≠ closing the soak. |
| New tracing library (otel-style) | MG-D dashboard observability | `trace_spans` + `tool_latency` SQLite tables already provide the data layer. The bugs are SQL/null-handling regressions, not a missing telemetry framework. |
| Recharts replacement / new chart lib | MG-D 999.49 (null-percentile breach-red) | Already on `recharts@3.8.1` (devDep). Bug is in how the dashboard maps `null` → `slo_status: breach`; styling/data-transform fix, not a chart-lib swap. |
| Bumping `discord.js` 14.26.2 → 14.26.4 | MG-A 999.44 | Changelogs verified above. Neither patch touches the webhook surface. Bumping during a live investigation would muddy the attribution of any reproduced webhook miss. Defer to a maintenance commit. |

---

## Integration Notes

For the planners on MG-A and MG-D specifically:

### MG-A integration points

- **Webhook registry truth source:** `src/discord/webhook-manager.ts` — owns the `webhookRegistry` map keyed by `agent+channel`. Phase 96 auto-provisions on startup. Any "no-webhook fallback" decision should be made **after** an explicit `webhookManager.getOrCreate(agent, channel)` call that re-creates on 404, not before.
- **A2A entry point:** `src/manager/daemon.ts` `handleAskAgent` / `handlePostToAgent` IPC handlers. Currently can fall through to the inbox-heartbeat path when webhook resolution fails. The fix landing point.
- **Queue-state surface:** `src/discord/delivery-queue.ts` + the dashboard's queue panel. Icon coherence (999.45) is a UI mapping — `queued` vs `sending` vs `failed` need distinct icons, and the dashboard map needs to read the actual `DeliveryQueue` state, not a derived "model is thinking" guess.
- **Heartbeat routing (999.48):** the `projects` agent's cron handler currently logs `HEARTBEAT_OK` to the operator channel. Fix is a destination-channel selector — likely a small helper that maps `(agent, eventType) → channelId` with sensible defaults (heartbeat → log-only, not user-facing).
- **No new package surface for any of the above.**

### MG-D integration points

- **`trace_spans` schema:** `src/performance/trace-store.ts`. Phase 116 redesigned this. The 999.7-B regression suggests the split-latency producer (whatever populates `prep_latency_ms` / `tool_latency_ms` / `model_latency_ms`) is no longer writing those columns. SQL audit first — likely a missing `INSERT` column in a Phase 116 commit.
- **`clawcode tool-latency-audit` CLI Invalid Request (999.7-C):** same root area. Phase 106's `mcp-tracker` CLI hotfix (`fa72303`) is the template — a CLI argument-validation fix, not a library upgrade.
- **Dashboard breach-red on null (999.49):** frontend logic in the Benchmarks tab maps `null` percentile → `slo_status: 'breach'`. Fix is `null → 'no-data'` (distinct neutral style). Pure React/CSS change. `recharts` already present. No new deps.

### MG-B integration points

- **Single file: `src/discord/subagent-thread-spawner.ts`.** Plan 02 (premature-completion gate) and Plan 03 (chunk-boundary off-by-3) both edit it. Sequencing per `999.36-03-PLAN.md depends_on: 999.36-02`.
- Plan 02 needs an "all chunks drained AND final-delivery ACK received" gate before emitting the completion event.
- Plan 03 is a 3-byte arithmetic correction on the chunk boundary at the 2000-char Discord message limit.

### MG-C integration points

- Pure execution. `999.6-02-PLAN.md`, `999.14-02-PLAN.md`, `999.15-04-PLAN.md` are pre-written. `clawdy` cold-restart soak script is in `999.15-04` already. No code, no deps.

### 999.46 (Discord markdown table auto-wrap)

- Single hook in the daemon's output formatter. Likely lands in `src/discord/streaming.ts` or a sibling `src/discord/table-wrap.ts`. Per-agent `feedback_no_wide_tables_discord.md` workarounds retire after this lands.
- Implementation note: detect contiguous lines matching `^\s*\|.*\|\s*$` with a separator row, wrap the block in triple-backticks. ~30 LOC. Add unit tests in `src/discord/__tests__/`.

### 999.19 + 999.20 (delegate routing + /research)

- 999.19 first: route delegated subagent threads to the **delegate's** Discord channel (not the parent's), default `autoArchive: true` on delegate path, and consolidate the delegate's session memory into the delegate's own `memories.db`. Plus a 5+-site cleanup of the `-via-` naming-pattern filter leak.
- 999.20 builds `/research` + `/research-search` slash commands on top — uses the v2.2 native CC slash registration pipeline (`SDK Query.initializationResult` → per-agent `clawcode-*` prefix). No new SDK calls needed.

---

## Sources

- `npm view discord.js time --json` (registry, 2026-05-13) — 14.26.2 (2026-04-03), 14.26.3 (2026-04-14), 14.26.4 (2026-05-01)
- `npm view discord.js dist-tags` — `latest: 14.26.4`, `dev: 15.0.0-dev.1777075897-40ce0791a`
- `npm view @modelcontextprotocol/sdk dist-tags` — `latest: 1.29.0`
- `npm ls discord.js` → `discord.js@14.26.2`
- `npm ls @modelcontextprotocol/sdk` → `@modelcontextprotocol/sdk@1.29.0` (transitive via `@anthropic-ai/claude-agent-sdk@0.2.140`)
- GitHub: `discordjs/discord.js` releases page — 14.26.3 (TeamMember permissions default), 14.26.4 (uncached DMChannel DMs). Neither touches the webhook delivery / message routing surface.
- `.planning/PROJECT.md:140` — "Zero new npm dependencies added in v2.2 — entire milestone built on the existing stack." Same precedent applies for v2.9.
- `.planning/BACKLOG-CONSOLIDATED.md` — v2.9 scope synthesis (MG-A through MG-D + standalone 999.46/999.19/999.20).
- `package.json` (in-tree, 2026-05-13) — current pinned versions.
