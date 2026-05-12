# Phase 116 — Post-Deploy Audit

**Deploy:** 2026-05-11 22:55 UTC (commit `5975a1b` cache hotfix on top of phase close).
**Audit done:** 2026-05-11 23:30 UTC.
**Author:** Clawdy (post-deploy hotfix pass).
**Scope:** Operator-reported surface bugs on `/dashboard/v2/*` after the cutover.

This document captures what was fixed in the hotfix pass, what is still
open, and what was investigated and **deliberately left for a follow-up**
(rather than rushed into the same evening).

---

## Fixed in this pass

### Bug 0 (closed before this audit started) — Cache IPC ISO re-parse

- **Status:** RESOLVED in commit `5975a1b`.
- **Symptom:** `/api/agents/:name/cache?since=24h` returned empty
  `tool_execution_ms_p50` / `tool_roundtrip_ms_p50` / `slos.first_token_p50_ms`,
  collapsing every fleet tile's metric column to "—".
- **Root cause:** the cache IPC handler re-parsed the ISO `since` string as a
  duration unit. Fix passed the ISO through verbatim.
- **Verification:** confirmed live; producer columns from Phase 115-08 are
  populating in production. Concern closed.

### Bug 1 — Costs chart legend overflow (commit `d7ad15a`)

- **Status:** FIXED.
- **Symptom:** Operator screenshot of `/dashboard/v2/costs` showed Recharts
  `<AreaChart>` with hundreds of agent series rendered as text spilling
  across the entire chart canvas. Each subagent thread session was treated
  as its own series (`Admin Clawdy-sub-Wo2nHX`, `fin-acquisition-sub-pRVDAx`,
  `Admin Clawdy-via-research-2K7cf3`, …).
- **Root cause:** `/api/costs/daily` returns one row per
  `(date, agent, model)` keyed by the live session name. The
  `SubagentThreadSpawner` persists every spawned thread as its own "agent"
  in the per-agent `UsageTracker`, so the long-tail session count explodes
  the cardinality of the agent axis. `CostDashboard.tsx`'s `buildChartRows`
  grouped by `r.agent` directly with no bucketing.
- **Fix:**
  1. Added `parentAgentName()` helper in `src/manager/subagent-name.ts`
     (single source of truth for the spawner naming convention) — strips
     both `-via-${delegate}-${nanoid6}` and `-sub-${nanoid6}` suffixes to
     recover the parent root.
  2. Mirrored as a client-side helper at
     `src/dashboard/client/src/lib/agent-name.ts` (the SPA can't reach
     into `src/manager/`). Both files cross-reference each other in
     comments.
  3. Wired into `buildChartRows()` — Pass 1 computes parent-rolled-up
     totals to pick the top-7 spenders; Pass 2 buckets each row's parent
     into either its own series or the muted "other" series.
  4. `pickColor` returns a stable zinc-600 for "other" so the long-tail
     band reads distinctly from the top-7.
- **Untouched:** `ModelDonut` already buckets by `modelBucket(r.model)`,
  not by agent — no change needed.
- **Verification:**
  - 21/21 `subagent-name.test.ts` tests pass (8 existing + 13 new
    `parentAgentName` cases — multi-segment delegates, names with
    spaces, suffix-length edge cases, etc.).
  - SPA build clean: 813KB raw → 815.79KB raw / 243.35KB gzip (Bug 1 +
    Bug 2 added a combined 2.7KB raw / 0.59KB gzip).
  - TS `noEmit` clean across the repo.

### Bug 2 — Conversations transcript pane (commit `6809fbc`)

- **Status:** FIXED.
- **Symptom:** Operator complaint: "I can't see conversations" — clicking
  a session row in the "Recent sessions" pane did nothing. The existing
  `ConversationsView` docstring confirmed the gap was intentional in
  Phase 116-03: *"Click jumps the operator into the Discord
  cross-reference (deep link via `discord_message_id` is NOT carried by
  searchTurns today — left as a forward-pointer for a future cross-link
  plan)."*
- **Root cause:** F27 shipped without a transcript pane — the operator
  has no way to read a session's actual content from the dashboard.
- **Fix:**
  1. **Backend (`daemon.ts list-recent-turns`):** added optional
     `sessionId` param. When supplied the WHERE clause adds
     `AND session_id = ?` and `ORDER BY` flips from `created_at DESC` to
     `turn_index ASC` so transcripts render top→bottom. Absent →
     original F11 drawer behaviour preserved. Trust-channel filter
     applies in both modes.
  2. **Routing (`server.ts`):** `/api/agents/:name/recent-turns` now
     forwards an optional `sessionId` query param.
  3. **Hook (`useApi.ts`):** added `useSessionTurns(agent, sessionId,
     limit=500)` + exported `SESSION_TURNS_QUERY_KEY` for invalidation.
  4. **UI (`ConversationsView.tsx`):** session rows are now clickable;
     a third-column `TranscriptPane` mounts beside the existing sidebar
     + workspace. Pinned row is highlighted; "✕" closes the pane.
  5. **SSE wiring:** the existing `subscribeConversationTurns` listener
     now also invalidates the session-turns query when the event's
     agent matches the pinned agent. The SSE payload doesn't carry
     `sessionId` today so we refetch on any matching-agent event;
     cheap (LIMIT 500) and rare (only fires when transcript is open).
- **Decision:** extended `list-recent-turns` rather than adding a new
  `get-session-turns` handler (advisor recommendation). One handler with
  optional pin, two modes — avoids duplicate plumbing for the same SQL
  shape.
- **Verification:**
  - SPA build clean (243.35KB gzip — within budget).
  - TS `noEmit` clean.
  - `protocol.test.ts` (IPC method allowlist) passes 34/34.
  - Backward-compatible: absent `sessionId` returns the exact same
    shape + ordering as before (F11 drawer keeps working).

---

## Audited and intentionally not fixed

### Fleet tile grid + Fleet comparison table cardinality

- **Where:** `/dashboard/v2/` (BasicMode tile grid) +
  `/dashboard/v2/fleet` (FleetComparisonTable).
- **Symptom (latent):** both surfaces use `useAgents()` which calls
  `/api/status`, which returns the **full registry** including every
  in-flight subagent thread. With ~100 active subagent threads (per the
  costs screenshot), the tile grid and comparison table will balloon
  similarly to the costs chart legend did.
- **Why not fixed tonight:**
  - Hiding subagents entirely is a UX decision (operator might want to
    see them).
  - Collapsing under parent requires a nested layout, not a one-liner.
  - The daemon's `getRunningAgents()`-using paths already filter
    `-sub-` and `-thread-` (see `daemon.ts:3311, 7048, 9206`) — pattern
    is there to copy, but applying it at the SPA layer is a tier
    decision (do we hide them in the UI, or filter at `/api/status`?
    The latter would break the F23 audit log "view all agents"
    surface).
  - Fix needs a dedicated mini-plan + operator opt-in.
- **Recommended next step:** add a "Show subagents" toggle (default
  OFF) on the fleet tile grid + comparison table, gated on
  `parentAgentName(name) === name`. Use the same client-side helper
  Bug 1 introduced.

### Knowledge graph agent picker

- **Where:** `/dashboard/v2/graph`.
- **Symptom:** the agent dropdown lists every subagent name (same
  `useAgents()` source as the fleet grid).
- **Why not fixed tonight:** the route is a wrapper around the legacy
  `/graph` iframe; the iframe itself reads from
  `/api/memory-graph/:agent` which expects a real agent name. Picking
  a subagent gracefully degrades (the graph just shows no nodes), but
  the dropdown UX is noisy. Same root cause as the fleet cardinality
  issue — should be solved alongside it.

---

## Audited and confirmed working (code review only — no live verification)

The post-deploy day didn't include a fresh dev daemon spin-up; the
following components were reviewed for obvious surface bugs (null
deref, crash on empty data) and look defensively coded. They need
operator-driven smoke verification in production.

| Route | Component | Notes |
|---|---|---|
| `/dashboard/v2/fleet` | `FleetComparisonTable.tsx` | Defaults all hooks to `?? []` / `?? null`; status / model / breach filters cleanly handle absent data. Will work BUT cardinality issue above. |
| `/dashboard/v2/tasks` | `TaskKanban.tsx` | Columns default `?? []`; isLoading + error states explicit; drag-drop uses `@dnd-kit/core` PointerSensor with 6px activation distance (good touch behaviour). |
| `/dashboard/v2/audit` | `AuditLogViewer.tsx` | Window selector / action / agent filters all optional; `data.rows ?? []` everywhere. |
| `/dashboard/v2/graph` | `routes/graph.tsx` | Iframe wrapper — passes `?agent=` query param to the legacy `/graph` route. Picker may list subagents (see above). |
| Agent detail drawer (F11) | `AgentDetailDrawer.tsx` | Uses `useRecentTurns(agent)` with no `sessionId` arg → preserves F11 behaviour after Bug 2's backend change. SSE wired via `subscribeConversationTurns`. |

Operator: please poke each route + report anything that doesn't render
when you next have a moment. Bugs above the surface I missed can ship
as a follow-up commit; this audit is intentionally narrow to the
explicitly-reported issues.

---

## Bundle budget tracking

| Build | Main raw | Main gzip | CostDashboard chunk | Delta vs prior |
|---|---|---|---|---|
| Pre-cache-hotfix (commit `15f86d3`) | 813.08 KB | 242.76 KB | 40.78 KB (11.56 KB gz) | baseline |
| Bug 1 (commit `d7ad15a`) | 813.08 KB | 242.76 KB | 40.78 KB (11.57 KB gz) | +0.01 KB gz |
| Bug 2 (commit `6809fbc`) | 815.79 KB | 243.35 KB | 40.78 KB (11.57 KB gz) | +0.59 KB gz |

Comfortably inside the 320KB gzip ceiling. No `React.lazy()` needed for
the transcript pane.

---

## Commits

| Hash | Description |
|---|---|
| `5975a1b` | fix(116): cache IPC re-parsing ISO timestamp (pre-existing, ref only) |
| `d7ad15a` | fix(116-postdeploy): bucket subagent series in costs chart (Bug 1) |
| `6809fbc` | fix(116-postdeploy): session-pin transcript pane in F27 (Bug 2) |
| `e96f4ba` | fix(116-postdeploy): auto-fire orphan cleanup on re-embed-complete transition (Bug 3, Fix 1) |
| `91c01f4` | feat(116-postdeploy): "Clean orphans" buttons on Memory page (per-agent + fleet-wide) (Bug 3, Fix 2) |

---

## Bug 3 — orphan vec_memories drift inflating migration percentage

### Symptom (2026-05-11)

Operator observed "v2: 982 / 1664 (59%)" on what should have been a
fully-migrated agent. Manual cleanup via `clawcode memory cleanup-orphans`
freed **940 orphans fleet-wide, 757 on fin-acquisition alone**, and the
percentages snapped to 100%. The dashboard treats orphan `vec_memories` /
`vec_memories_v2` rows (vec row exists, memory_id no longer in `memories`)
as part of the denominator, so a fully-migrated agent reads "59% migrated"
when the gap is pure orphan residue.

### Fix 1 — auto-fire orphan cleanup on re-embed-complete (e96f4ba)

Cron observer in `src/manager/migration-cron.ts` `runBatchForAgent`: capture
phase before + after `runReEmbedBatch`, call `store.cleanupOrphansSplit()`
when the edge `* → re-embed-complete` is observed. Per-agent regression test
at `src/manager/__tests__/migration-cron-orphan-cleanup.test.ts`.

### Fix 2 — Clean orphans buttons (91c01f4)

Per-agent button in `MigrationTracker`, fleet-wide button in `MemoryView`
header. New REST routes `POST /api/agents/:name/memory/cleanup-orphans` +
`POST /api/memory/cleanup-orphans`, backed by the Phase 107
`memory-cleanup-orphans` IPC (no new IPC allowlist entries).

### Fix 3 — root-cause investigation (deferred with findings)

**Goal:** find the active leak path that creates new orphans, then either
add a SQL FOREIGN KEY ... ON DELETE CASCADE, or wrap the offending deletion
in a transaction touching both tables.

**Investigation results — NO ACTIVE LEAK FOUND:**

| Callsite | Verdict |
|---|---|
| `src/memory/store.ts:391` (`store.delete()`) | **Cascades v1 + v2** via `deleteVec` + `deleteVecV2` inside the same `db.transaction()`. Verified by Phase 107 + Phase 115 atomicity tests at `src/memory/__tests__/embedding-v2-cascade-delete.test.ts`. |
| `src/memory/episode-archival.ts:56` | **Not an orphan source.** Deletes from `vec_memories` only and intentionally leaves the `memories` row present (cold-archive shape — opposite shape from orphan, where the vec row survives a missing memory row). |
| `src/memory/dedup.ts:117` | **Not an orphan source.** UPDATE-then-replace vec on the same `existingId` inside one transaction. `memories` row is updated, not deleted. |
| `src/memory/tier-manager.ts:128` | Goes through `store.delete()` → cascades. |
| `src/manager/cross-agent-coordinator.ts:310` | Goes through `store.delete()` → cascades. |
| `src/memory/memory-scanner.ts:117,204` | Uses `deleteMemoryChunksByPath()` which operates on `memory_chunks` + `vec_memory_chunks{,_v2}`, NOT `memories` + `vec_memories`. Cascades v1+v2 chunks inside one transaction. Cannot produce vec_memories orphans. |
| Schema-rebuild migrations at `src/memory/store.ts:1043, 1105` | `INSERT memories_new SELECT * FROM memories` preserves IDs. The `vec_memories` virtual table is untouched by these migrations — IDs match across the rename. Not an orphan source. |

The single non-test `DELETE FROM memories` prepared statement is
`store.ts:1838` (`stmts.deleteMemory`), used exclusively inside
`store.delete()` which cascades. There is no live code path that deletes
from `memories` without cascading.

**Conclusion:** the 940 orphans are pre-cascade residue from the window
BEFORE Phase 107 added the v1 cascade and Phase 115 D-08 added the v2
cascade. The cascade fix has already been in production for those phases;
new orphans should not be accumulating from any of the deletion sites
audited above.

**Schema-level CASCADE on `vec_memories` is NOT applicable** — `vec_memories`
is a sqlite-vec `vec0` virtual table, which does not support SQLite FOREIGN
KEY constraints (per sqlite-vec docs). Application-level cascade in
`store.delete()` is the correct (and current) enforcement layer.

**Fix 3 outcome:** deferred — no commit needed. Fixes 1 + 2 plus the
existing application-level cascade prevent NEW orphans + give operators
ergonomic clearing for legacy residue.

### Sentinel for future drift

If a future regression introduces a new `DELETE FROM memories` site that
bypasses `store.delete()`, the existing cascade test at
`src/memory/__tests__/embedding-v2-cascade-delete.test.ts` is the safety
net — but only for that one shape. Consider adding a static-grep sentinel
(same shape as `migration-cron-wiring.test.ts`) that asserts the only
non-test occurrence of `DELETE FROM memories` is inside `store.ts`'s
`deleteMemory` prepared statement. This would catch future drift at PR
time. Not blocking; recommend filing as a follow-up if a third orphan
incident appears.

---

## Not deployed yet

Per the operator's instruction: code-only commits in this pass.
**Operator will deploy after reviewing the diffs.** When ready,
`scripts/deploy-clawdy.sh` will build SPA + restart the daemon in one
shot (per its README and `~/.clawcode-deploy-pw` setup).
