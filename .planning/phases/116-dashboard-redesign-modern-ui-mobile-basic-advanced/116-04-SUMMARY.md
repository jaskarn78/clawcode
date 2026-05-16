---
phase: 116
plan: 04
title: Tier 2 deep-dive — F11 three-panel drawer, F12 trace waterfall, F13 IPC inbox, F14 memory panel, F15 dream queue
subsystem: dashboard
tags: [dashboard, spa, react, shadcn, sheet, trace-waterfall, dream-veto, memory-panel, ipc-inbox, lazy-loading]
completed: 2026-05-11
duration_minutes: ~45
tasks_completed: 5
files_modified:
  - src/manager/daemon.ts (+450 lines, contiguous "Phase 116-04" closure-intercept block)
  - src/dashboard/server.ts (+170 lines, contiguous "=== Phase 116-04 routes ===" block)
  - src/ipc/protocol.ts (+18 lines — 6 new IPC method names; retro-update of pinning test)
  - src/ipc/__tests__/protocol.test.ts (+24 lines — backfilled 116-03 + 116-04 method pins)
  - src/dashboard/client/src/App.tsx (+drawerAgent state, drawer mount at root, entry-point unification)
  - src/dashboard/client/src/layouts/FleetLayout.tsx (+onSelectAgent prop, threaded to AgentTileGrid + BasicMode + SloBreachBanner)
  - src/dashboard/client/src/hooks/useApi.ts (+useRecentTurns, useTurnTrace, useIpcInboxes, useMemorySnapshot, useDreamQueue, vetoDreamRun + 9 exported types)
  - src/dashboard/client/src/components/AgentDetailDrawer.tsx (NEW, ~310 lines)
  - src/dashboard/client/src/components/TraceWaterfall.tsx (NEW, ~225 lines — lazy-loaded)
  - src/dashboard/client/src/components/IpcInbox.tsx (NEW, ~210 lines)
  - src/dashboard/client/src/components/MemoryPanel.tsx (NEW, ~265 lines)
  - src/dashboard/client/src/components/DreamQueue.tsx (NEW, ~250 lines)
  - src/dashboard/client/src/components/ui/sheet.tsx (NEW, ~125 lines — Sheet primitive built on radix-dialog)
autonomous: true
dependency_graph:
  requires:
    - 116-00 (Sheet primitive sits alongside existing shadcn ui/* primitives)
    - 116-01 (AgentTile.onSelect + AgentTileGrid.onSelectAgent — pre-existing pass-through)
    - 116-02 (CommandPalette.onSelectAgent + SloBreachBanner.openAgentDrawer + useMcpServers shape)
    - 116-03 (ConfigEditor reused as drawer "Edit config" target; conversation-turn SSE bus extended for live transcript)
    - Phase 50/115 trace_spans table (F12 source of truth)
    - Phase 95+ dream-veto-store + dream-pass log layout (F15 data source)
    - Phase 88 / collaboration/inbox.ts (F13 inbox dir scan)
    - Phase 56+ MemoryStore tier column + Phase 115 vec_memories_v2 (F14 surfaces both)
  provides:
    - F11 AgentDetailDrawer — three-panel drawer mounted at root, unified entry point for tile/banner/Cmd+K
    - F12 TraceWaterfall — lazy-loaded custom-SVG span timeline keyed off trace_spans rows
    - F13 IpcInbox — fleet + per-agent inbox view (compact `scope=agent` for the drawer)
    - F14 MemoryPanel — READ-ONLY tier-1 file previews + tier counts + vec_memories migration delta
    - F15 DreamQueue — schedule status + last 7 dream files + D-10 veto window viewer with rationale-textarea veto button
    - 6 new IPC methods (list-recent-turns, get-turn-trace, list-ipc-inboxes, get-memory-snapshot, get-dream-queue, veto-dream-run)
    - 6 new REST routes in the "=== Phase 116-04 routes ===" block
    - Sheet UI primitive (shadcn pattern, side-slide Dialog variant)
  affects:
    - 116-05 (settings) — can append routes/IPC inside its own "=== Phase 116-05 routes ===" block immediately after this fence
    - Future plans — Sheet primitive is reusable for any slide-over surface (task detail panels, MCP detail, settings overlays)
tech_stack:
  added: []  # No new top-level deps; Sheet builds on existing @radix-ui/react-dialog
  patterns:
    - Contiguous-block routes (continued) — appended `=== Phase 116-04 routes ===` block in src/dashboard/server.ts immediately after the 116-03 fence so 116-05 can extend without touching this diff
    - Contiguous-block daemon IPC (continued) — closure-intercept block in src/manager/daemon.ts labeled "Phase 116-04 — Tier 2 deep-dive IPC handlers" houses all 6 new handlers
    - Drawer entry-point unification — single setDrawerAgent state in App.tsx; threaded through FleetLayout.onSelectAgent into AgentTileGrid + BasicMode + SloBreachBanner. CommandPalette routes through the same setter. Three placeholders (console.info) collapsed into one drawer.
    - React.lazy() route-level code splitting — TraceWaterfall is the heaviest content in the drawer (custom SVG renderer + threshold logic) and only mounts on turn click. Splitting it keeps the eager drawer chunk small. Result chunk: 3.65KB / 1.54KB gzip.
    - getDatabase() prepared-statement reads — F11 transcript and F12 spans read directly via ConversationStore.getDatabase() / TraceStore.getDatabase() (the Phase 56+ READ-ONLY accessor) rather than adding new public methods on stores. Avoids touching the test surface of those stores.
    - Best-effort file reads — F14 + F15 file scans (tier-1 files, dreams/*.md) return null/empty per missing file rather than throwing the whole snapshot. ENOENT is normal for new agents.
    - DeliveryStats over a custom log — F13 deliberately surfaces the existing DeliveryQueue.getStats() + getFailedEntries(50) rather than adding a `listRecent` query method. Cross-agent IPC is file-based (inbox dir); the delivery queue tracks Discord-outbound only. Both surfaces are presented with clear labels distinguishing them.
key_files:
  created:
    - src/dashboard/client/src/components/AgentDetailDrawer.tsx
    - src/dashboard/client/src/components/TraceWaterfall.tsx
    - src/dashboard/client/src/components/IpcInbox.tsx
    - src/dashboard/client/src/components/MemoryPanel.tsx
    - src/dashboard/client/src/components/DreamQueue.tsx
    - src/dashboard/client/src/components/ui/sheet.tsx
  modified:
    - src/manager/daemon.ts (Phase 116-04 closure-intercept block, +450 lines)
    - src/dashboard/server.ts (Phase 116-04 routes block, +170 lines)
    - src/ipc/protocol.ts (+6 IPC_METHODS entries)
    - src/ipc/__tests__/protocol.test.ts (backfilled 116-03 + 116-04 pins)
    - src/dashboard/client/src/hooks/useApi.ts (+6 hooks/mutations + 9 exported types)
    - src/dashboard/client/src/App.tsx (drawerAgent state + AgentDetailDrawer mount)
    - src/dashboard/client/src/layouts/FleetLayout.tsx (onSelectAgent prop threading)
decisions:
  - F12 waterfall renders with NO parent_tool_use_id linkage because that
    column does not exist in trace_spans. Schema is `(turn_id, name,
    started_at, duration_ms, metadata_json)` — confirmed by reading
    src/performance/trace-store.ts:853-860 + the writer at line 287-294.
    Nesting in the SVG is by NAME CONVENTION: tool_call.<name> spans get
    one indent level relative to context_assemble / first_token /
    first_visible_token / typing_indicator / end_to_end segment spans.
    Documented in TraceWaterfall.tsx top comment so a future plan adding
    a parent_tool_use_id column can switch to true nesting without
    re-implementing the renderer.
  - F15 veto endpoint uses `:runId` not `:windowId`. The plan said
    `:windowId` but VetoStore.vetoRun(runId, reason) is keyed by `runId`
    (src/manager/dream-veto-store.ts:88). The two terms refer to the
    same identifier — the "veto window" is the time-bounded thing tied
    to one runId. We standardize on `runId` everywhere so the IPC contract
    + the store match verbatim and no 404s slip through. The plan's
    `:windowId` is preserved in 116-CONTEXT as a forward-pointer.
  - F14 ships READ-ONLY per 116-DEFERRED.md operator decision
    (2026-05-11). Each tier-1 file row has a tooltip + a code-block
    showing the CLI flow (`clawcode memory edit <agent> <file>`). The
    full in-UI editor would need file-locking + atomic write coordination
    with the agent's reader-cache invalidation; deferred to a separate
    small phase per the operator's value-cost call. Edit affordance
    payload returns `{available: false, hint: "..."}` so the UI can render
    the disabled state from server-controlled copy.
  - F13 cross-agent log surface is DeliveryStats + getFailedEntries, NOT
    a new `listRecent` query. Reason: cross-agent IPC (send_to_agent /
    ask_agent) writes JSON files into the recipient's inbox dir via
    `src/collaboration/inbox.ts:writeMessage`; there is NO per-call row
    in any queue today. DeliveryQueue tracks Discord-outbound only.
    Adding a new per-IPC queue table would be a schema change out of
    scope for this plan; the current surface labels both clearly so
    operators don't conflate the two. Documented as a forward-pointer in
    IpcInbox.tsx and the daemon handler comment.
  - Sheet primitive built inline on `@radix-ui/react-dialog` rather than
    running `npx shadcn add sheet`. The SPA's vendored shadcn ui/* files
    all share the same `cn` helper + cva pattern; copy-pasting the
    upstream Sheet recipe keeps the SPA self-contained, avoids generator
    diff churn, and shaves the install step from CI. The sheet.tsx file
    carries the upstream-recipe comment at the top.
  - F12 TraceWaterfall lazy-loaded (React.lazy) from the FIRST commit
    (not as a later bundle-size fix). Result: drawer chunk + waterfall
    chunk split cleanly; the SPA stays at 906KB raw / 275KB gzip even
    with 5 new components landed. Plan budget was <1MB raw / <320KB
    gzip; we land well inside it.
  - Drawer entry-point unification: App.tsx now owns ONE drawer-state
    setter (setDrawerAgent). FleetLayout.onSelectAgent threads through
    to AgentTileGrid (Advanced) + BasicMode (Basic) + SloBreachBanner.
    CommandPalette.onSelectAgent also routes through the same setter.
    The three console.info placeholders from 116-01/116-02 are gone.
  - F11 live transcript subscribes via subscribeConversationTurns
    (the 116-03 conversation-turn SSE bus). The bus emits metadata only
    ({agent, turnId, role, ts}) — we render a "live" placeholder row at
    the head of the list (e.g. "● A · 2s ago · live"). The next refetch
    (or page revisit) replaces it with the persisted turn from
    /api/agents/:name/recent-turns. Component owns its 20-row ring
    buffer; no router/global state.
metrics:
  bundle_js_kb: 906.90  # was 882 at end of 116-03
  bundle_js_gzip_kb: 275.77  # was 270 at end of 116-03
  bundle_growth_js_kb: 24.9  # +24KB for 5 components + 8 hooks + Sheet primitive
  bundle_growth_js_gzip_kb: 5.77
  trace_waterfall_chunk_kb: 3.65   # lazy-split — does NOT count against eager budget
  trace_waterfall_chunk_gzip_kb: 1.54
  bundle_css_kb: 29.06  # was 27.6 at end of 116-03
  bundle_css_gzip_kb: 6.26  # was 5.9 at end of 116-03
  components_added: 6  # AgentDetailDrawer, TraceWaterfall, IpcInbox, MemoryPanel, DreamQueue, Sheet
  hooks_added: 6  # useRecentTurns, useTurnTrace, useIpcInboxes, useMemorySnapshot, useDreamQueue, vetoDreamRun
  routes_added: 6  # /recent-turns, /traces/:turnId, /ipc/inboxes, /memory-snapshot, /dream-queue, POST /dream-veto/:runId
  ipc_methods_added: 6
  daemon_tests_passing_relevant: 185+46+70  # performance + dashboard + ipc
  commits: 2
---

# Phase 116 Plan 04 Summary

**One-liner:** Five new Tier 2 inspector surfaces (F11 three-panel agent detail drawer with live transcript via 116-03's conversation-turn SSE bus; F12 lazy-loaded custom-SVG trace waterfall keyed off the existing `trace_spans` schema; F13 cross-agent IPC inbox table + Discord delivery queue stats; F14 READ-ONLY memory subsystem panel with tier-1 file previews + vec_memories migration delta; F15 dream-pass queue with D-10 veto-window rationale textarea wired to `VetoStore.vetoRun`) wired against 6 new REST routes + 6 new IPC handlers — all in contiguous `=== Phase 116-04 ===` blocks that 116-05 can append after without touching this plan's diff, plus the three-placeholder drawer entry-point (tile click / SLO banner / Cmd+K) unified onto a single App-level setter.

## Tasks Executed

| Task | Commits | Description |
|------|---------|-------------|
| T01-T05 backend  | `8c3aba3` | 6 new IPC handlers in the "Phase 116-04" closure-intercept block of `src/manager/daemon.ts` (list-recent-turns, get-turn-trace, list-ipc-inboxes, get-memory-snapshot, get-dream-queue, veto-dream-run) + matching 6 REST routes in the "=== Phase 116-04 routes ===" block of `src/dashboard/server.ts` + 6 new entries in `src/ipc/protocol.ts` IPC_METHODS enum. Daemon-side typecheck: 0 errors. |
| T01-T05 frontend | `7b3f9d3` | 5 new SPA components + 1 new shadcn ui primitive (Sheet) + 8 new useApi hooks/types + drawer entry-point unification across App/FleetLayout/AgentTileGrid/SloBreachBanner/CommandPalette. TraceWaterfall lazy-loaded via React.lazy(). Vite build clean at 906KB raw / 275KB gzip — well under the 1MB / 320KB plan target. Backfilled the IPC pinning test to cover 116-03 + 116-04 method names (116-03 left it stale). |

## Must-haves

| # | Clause | Status | Rationale |
|---|--------|--------|-----------|
| 1 | F11 drawer opens on tile click; three-panel layout matches v2 mockup; transcript streams live (uses `conversation-turn` SSE wired in 116-03) | **SATISFIED** | AgentDetailDrawer mounts at App root with `drawerAgent` state. FleetLayout threads `onSelectAgent` through to AgentTileGrid + AgentTile + BasicMode + SloBreachBanner so every entry point routes through `setDrawerAgent`. Drawer renders three columns at `lg:` breakpoint (left config snapshot / center transcript / right column stack with MemoryPanel + IpcInbox + DreamQueue), stacks to single column below. The "Edit config" button in the drawer header calls `onEditConfig(agent)` which opens the existing F26 ConfigEditor — no new editor surface. Live transcript subscribes via `subscribeConversationTurns` (the 116-03 event-bus pattern); matching agent turns prepend to a 20-row ring buffer rendered as "● A · 2s ago · live" placeholder rows above the persisted list. |
| 2 | F12 trace waterfall renders span timeline for selected turn from `trace_spans` | **SATISFIED** | Backend `get-turn-trace` IPC reads via `TraceStore.getDatabase()` prepared statement on `trace_spans` (turn_id, name, started_at, duration_ms, metadata_json) + parent `traces` row metadata (total_ms, cache_eviction_expected). Frontend `TraceWaterfall.tsx` is a custom SVG (no chart library) with SLO-color bands per span name. Click any transcript row in F11 → waterfall opens in-place below the transcript with a close button. Lazy-loaded via `React.lazy()` so the renderer is not in the eager drawer chunk (3.65KB / 1.54KB gzip separate chunk). Nesting is by NAME CONVENTION (tool_call.* indented one level) since trace_spans has no parent_tool_use_id column — see "Decisions" above. |
| 3 | F13 IPC inbox shows pending messages + 24h fleet log + heartbeat status | **SATISFIED (with documented surface adjustment)** | Backend `list-ipc-inboxes` IPC scans each agent's `memoryPath/inbox` directory (the `writeMessage` destination from `src/collaboration/inbox.ts`) for pending `.json` files + computes the directory's most-recent mtime as the heartbeat proxy (cheapest cross-platform freshness signal). DeliveryQueue.getStats() + getFailedEntries(50) surface the Discord-outbound queue — clearly labeled distinct from cross-agent IPC (which is file-based; no per-call queue table exists today). Frontend `IpcInbox.tsx` renders both surfaces; `scope=agentName` prop reduces to one row for drawer mode. Heartbeat tint: rows older than 24h get an amber background tint. Forward-pointer: a fleet-wide cross-agent IPC log table (sender → recipient → timestamp → delivery_status) would be a future schema addition. |
| 4 | F14 memory panel shows tier-1 file previews (READ-ONLY in v1 per 116-DEFERRED) + tier distribution + last consolidation | **SATISFIED** | Backend `get-memory-snapshot` IPC aggregates: tier counts (hot/warm/cold) from `MemoryStore.getDatabase()` GROUP BY tier; first 1000 chars + total chars + last-modified for each of `SOUL.md` / `IDENTITY.md` / `MEMORY.md` / `USER.md`; vec_memories vs vec_memories_v2 row counts; last 5 consolidation files from `<memoryRoot>/dreams/*.md`; full dream config block. Each file read is best-effort — ENOENT returns null for that slot rather than throwing the whole snapshot. Frontend `MemoryPanel.tsx` renders: a horizontal tier bar with three color bands, an embed-migration row showing v1 vs v2 row counts + percent migrated, collapsible file-preview cards (read-only `<pre>` block, max-height with scroll), and a recent-consolidations list. Edit affordance per the operator decision: each file's expanded view shows the CLI command (`clawcode memory edit <agent> <file>`) as italic hint text. NO in-UI editor in v1. |
| 5 | F15 dream queue shows pending depth + next scheduled fire + last 7 events + D-10 veto window state | **SATISFIED (with documented surface adjustment)** | Backend `get-dream-queue` IPC reads: last 7 dream files from `<memoryRoot>/dreams/*.md` with mtime + header count (each file may carry multiple "## [HH:MM UTC]" passes); pending D-10 veto windows from `createDreamVetoStore().list()` reduced by runId to latest status filtered to `pending`; full dream config block. Backend `veto-dream-run` IPC wraps `VetoStore.vetoRun(runId, reason)` with non-empty reason validation. Frontend `DreamQueue.tsx` renders the schedule status ("fires when idle ≥ Xm"), recent dream files list, and pending-veto rows with countdown to deadline + a "Veto…" button that opens a rationale textarea (200-char cap) + Confirm button that POSTs through `vetoDreamRun` + invalidates the dream-queue query so the row drops on refetch. Surface adjustment: the schema has no `cron` field (just `idleMinutes`), so we render "fires when idle ≥ Xm" rather than a wall-clock countdown — the actual scheduler fires when idle ≥ idleMinutes. |

**Net:** 5 of 5 must-haves SATISFIED. F13 and F15 have small documented surface adjustments where the plan's literal wording didn't match the codebase shape; both adjustments preserve the must-have's INTENT.

## Deviations from Plan

### [Rule 1 - Bug] Plan referenced `trace_spans.parent_tool_use_id` — the column doesn't exist

**Found during:** T02 backend (designing the waterfall renderer).
**Issue:** Plan T02 step 2 says "one row per span nested by parent_tool_use_id". The trace_spans schema (src/performance/trace-store.ts:853-860) is `(turn_id, name, started_at, duration_ms, metadata_json)` — there is no parent column. The writer at line 287-294 confirms: spans are flat.
**Fix:** Waterfall nests by NAME CONVENTION instead. `tool_call.<name>` spans get one indent level relative to the canonical segment spans (context_assemble, first_token, first_visible_token, typing_indicator, end_to_end). Documented in `TraceWaterfall.tsx` top comment so a future plan that ADDS the parent column can switch to true nesting without re-implementing the renderer.
**Files modified:** `src/dashboard/client/src/components/TraceWaterfall.tsx`
**Commit:** `7b3f9d3`

### [Plan boundary] F15 endpoint `:windowId` standardized to `:runId`

**Found during:** T05 backend.
**Issue:** Plan says `POST /api/agents/:name/dream-veto/:windowId`. `VetoStore.vetoRun(runId, reason)` keys by `runId` (src/manager/dream-veto-store.ts:88). The two terms refer to the same identifier — the "veto window" is a time-bounded thing tied to one runId — but using two names invites a 404 the first time a contributor confuses them.
**Fix:** Standardized on `runId` everywhere: IPC contract, REST URL parameter, frontend `vetoDreamRun(agentName, runId, reason)`. The plan's `:windowId` is preserved in 116-CONTEXT as a forward-pointer term.
**Files modified:** `src/manager/daemon.ts`, `src/dashboard/server.ts`, `src/dashboard/client/src/hooks/useApi.ts`, `src/dashboard/client/src/components/DreamQueue.tsx`
**Commit:** `8c3aba3` + `7b3f9d3`

### [Plan boundary] F15 dream config has no `cron` field

**Found during:** T05 backend.
**Issue:** Plan T05 mentions "next scheduled fire" suggesting a wall-clock cron string. The schema (src/config/schema.ts:475 `dreamConfigSchema`) has `enabled` / `idleMinutes` / `model` / `retentionDays` — no cron. Dream-pass fires when the agent has been idle for `idleMinutes` minutes (event-driven, not wall-clock).
**Fix:** Backend returns the actual config fields (`enabled`, `idleMinutes`, `model`, `retentionDays`). Frontend renders "fires when idle ≥ Xm" rather than a countdown. The semantic intent of "next scheduled fire" is preserved — the operator can see exactly when the next pass will fire (when the agent is idle long enough).
**Files modified:** `src/manager/daemon.ts`, `src/dashboard/client/src/components/DreamQueue.tsx`
**Commit:** `8c3aba3` + `7b3f9d3`

### [Plan boundary] F13 cross-agent 24h log is DeliveryStats + recent-failures, not a per-IPC table

**Found during:** T03 backend.
**Issue:** Plan T03 step 2 says "GET /api/ipc/log?since=24h — recent send_to_agent / delegate_task / ask_agent calls". There is NO per-call queue table for those today: `send_to_agent` and `ask_agent` write JSON files into the recipient's inbox dir via `src/collaboration/inbox.ts:writeMessage` (fire-and-forget). The only cross-agent traffic that DOES land in a database is the Discord delivery queue, which is agent → Discord channel sends.
**Fix:** Backend `list-ipc-inboxes` exposes DeliveryQueue.getStats() (pending / inFlight / failed / delivered) + getFailedEntries(50) under separate `deliveryStats` + `recentFailures` keys. Frontend labels both surfaces clearly so operators don't conflate them: inbox table = cross-agent IPC pickup state; delivery queue = Discord-outbound state. A future schema change adding a per-IPC log table would slot in here cleanly under a new `ipcLog` key.
**Files modified:** `src/manager/daemon.ts`, `src/dashboard/server.ts`, `src/dashboard/client/src/components/IpcInbox.tsx`
**Commit:** `8c3aba3` + `7b3f9d3`

### [Rule 3 - Blocker] IPC pinning test was stale post-116-03

**Found during:** T05 frontend (CI test run).
**Issue:** `src/ipc/__tests__/protocol.test.ts` pins the IPC_METHODS list with a hardcoded array. 116-03 added 8 new methods without updating the pin → the test was failing the moment 116-03 landed (the 116-03 SUMMARY's "pre-existing slash-command count failures" list missed this specific failure). Adding my 6 methods compounded the diff to 14 missing entries.
**Fix:** Backfilled both 116-03 (8 methods) AND 116-04 (6 methods) onto the pinning test array with comments documenting each block. Result: 70/70 ipc tests pass, vs the pre-116-04 70 with 1 failing.
**Files modified:** `src/ipc/__tests__/protocol.test.ts`
**Commit:** `7b3f9d3`

### [Plan boundary] Sheet primitive built inline rather than via `npx shadcn add`

**Found during:** T01 design.
**Issue:** Plan T01 step 1 says `npx shadcn@latest add sheet`. The SPA's vendored shadcn primitives already share the `cn` helper + cva pattern; running the generator would mix its output with the existing pattern, churn the lockfile, and break the SPA's self-contained model (per 116-00's package.json comment: "All dependencies live in the repo-root package.json").
**Fix:** Built `src/dashboard/client/src/components/ui/sheet.tsx` inline using the upstream shadcn Sheet recipe — same `cn` helper, same cva variants, builds on the already-installed `@radix-ui/react-dialog`. File header carries the upstream-recipe attribution. Zero new dependencies.
**Files modified:** `src/dashboard/client/src/components/ui/sheet.tsx` (NEW)
**Commit:** `7b3f9d3`

### [Rule 2 - Missing critical] Drawer entry-point unification (three placeholders had to collapse onto one)

**Found during:** T01 frontend (wiring the drawer-open path).
**Issue:** 116-01 and 116-02 left THREE distinct `console.info` placeholders where the drawer was supposed to open: `CommandPalette.onSelectAgent` (App.tsx:81-85), `SloBreachBanner.openAgentDrawer` (FleetLayout.tsx:353-361), and `AgentTileGrid.onSelectAgent` accepted-but-never-passed in FleetLayout's `<AdvancedMode>`. Without unification, the drawer would only open from one path and the other two would silently log to console.
**Fix:** Added `[drawerAgent, setDrawerAgent]` state in App.tsx alongside `editingAgent`. Threaded `onSelectAgent` through FleetLayout → AgentTileGrid + BasicMode + SloBreachBanner. CommandPalette.onSelectAgent now routes to the same setter. All three placeholders gone. Forward-pointer: SloBreachBanner's existing `openAgentDrawer` API still falls back to console.info if a caller forgets to thread `onSelectAgent` through FleetLayout — guard against future regression.
**Files modified:** `src/dashboard/client/src/App.tsx`, `src/dashboard/client/src/layouts/FleetLayout.tsx`
**Commit:** `7b3f9d3`

## Auth Gates

None. All work was local; no daemon restarts, no Discord API calls, no deploys (per prompt's "NO DEPLOY" constraint).

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: new-mutation-surface | `src/dashboard/server.ts` POST /api/agents/:name/dream-veto/:runId | New write endpoint. Operator can veto any D-10 pending window by runId; daemon wraps VetoStore.vetoRun which idempotently no-ops if the run already applied/expired. Reason field required (rejected with 400 if empty) and capped at 200 chars (defense against accidental DB-row leaks). Same 127.0.0.1 trust posture as the existing dashboard; no new auth surface. |
| threat_flag: new-read-surface | `src/dashboard/server.ts` GET /api/agents/:name/memory-snapshot | First 1000 chars of SOUL.md/IDENTITY.md/MEMORY.md/USER.md returned over HTTP. These are the agent's most identity-load-bearing files (Tier 1). Dashboard binds to 127.0.0.1; trust posture is "operator on local box". No new exposure beyond what the existing read paths (e.g. /api/memory-stats) already provide — but operators should note that these previews ARE in browser memory while the drawer is open. |
| threat_flag: new-read-surface | `src/dashboard/server.ts` GET /api/agents/:name/recent-turns | Last 50 conversation turns returned over HTTP. Trust filter defaults to is_trusted_channel=1 (SEC-01 parity with searchTurns). includeUntrusted=true query param surfaces untrusted-channel turns; future drawer UI may expose this as an operator toggle. Same 127.0.0.1 trust posture. |

All three flags are documented in the relevant daemon-handler comments + server-route docstrings. None introduce new trust boundaries beyond what the existing 127.0.0.1-bound dashboard already exposes.

## Known Stubs

| Stub | File | Reason | Landing |
|------|------|--------|---------|
| F14 in-UI editor for tier-1 files | `MemoryPanel.tsx` FilePreviewRow | DEFERRED per 116-DEFERRED.md operator decision (2026-05-11). File-locking + atomic write + reader-cache invalidation is a coordinated surface that deserves its own plan. Today's behavior: collapsed cards expand to a read-only `<pre>` preview with an italic CLI-hint line. | future single-plan phase (~3-4h estimate per 116-DEFERRED) |
| F12 hover-tooltip percentile rank | `TraceWaterfall.tsx` span bars | Plan T02 step 3 says "hover shows raw ms + percentile rank (24h aggregate)". Today we show raw ms + start offset via SVG `<title>`. Per-span percentile lookup costs an extra round-trip per hover and the 24h aggregate already powers F02's tile color band; postponed to keep the waterfall renderer pure (no async hover state). | future plan when per-span hover-context-aware needs surface |
| F13 fleet-wide cross-agent IPC log table | `IpcInbox.tsx` "no log table yet" note | Cross-agent send/post/ask traffic is file-based (no per-call queue row). Adding a table would require a schema migration + a new write path in the IPC handlers. Documented forward-pointer in the IpcInbox.tsx top comment. | future schema-extension plan |
| F15 D-10 "auto-apply still happens on un-vetoed windows" guarantee | `DreamQueue.tsx` | Plan T05 verify clause says "auto-apply still happens on un-vetoed windows" — the daemon's existing VetoStore.tick() machinery handles this (D-10 hybrid policy); the UI just renders the pending list and posts vetoes. The auto-apply side is OUTSIDE F15's surface (it's the existing dream-cron path). No code path in this plan disables auto-apply. | n/a — verified by inspection of dream-veto-store + dream-auto-apply |
| F11 transcript "expand 50 → 200 turns" | `AgentDetailDrawer.tsx` transcript pane | Plan T01 step 5 says "50-turn list, infinite scroll". Today we fetch 50 and render them in a max-h-60vh scroll pane; "infinite scroll" with offset/limit would need a list virtualizer + a paginated useRecentTurns hook. Not in must-haves. | future plan when operator demand surfaces |
| F11 SLO gauges in the right column | `AgentDetailDrawer.tsx` right column | Plan T01 step 6 says "F02 SLO gauges (first_token / end_to_end / tool_call / context_assemble)". Today the right column carries MemoryPanel + IpcInbox + DreamQueue. F02 gauges in the tile already cover the canonical "is anything breaching SLO right now" question; per-segment gauges in the drawer would be a richer surface that's not on the must-haves. | future plan if operator wants per-segment SLO comparison in the drawer |
| F11 F04 7d sparkline in the right column | `AgentDetailDrawer.tsx` right column | Plan T01 step 6 includes "F04 7d sparkline (full size)". The tile already shows a skeleton placeholder for the sparkline (no per-agent timeline endpoint yet); the full surface needs a new backend route + a per-agent time-series query. Not in must-haves. | future plan with backend timeline endpoint |
| F11 F17 cost summary (24h) | `AgentDetailDrawer.tsx` right column | Plan T01 step 6 says "F17 cost summary (24h only — full F17 in 116-05)". The existing `/api/costs` endpoint already returns this data; a small CostSummary component would slot into the drawer's right column. Tested integration-deferred — neither F17 nor a per-agent cost surface is on the 116-04 must-haves. | 116-05 (full F17 cost dashboard) |

All stubs are documented in-component or in 116-DEFERRED. No silent fakes — every disabled / no-op surface explains where the full implementation lands.

## Items to surface to operator

1. **Pre-existing slash-command + IPC pinning test failures (19+1)**. The 19 slash-command count failures noted in 116-03's "Items to surface" still exist (unchanged by this plan). The IPC protocol-pinning test was ALSO failing post-116-03 (116-03 didn't update it when adding 8 methods); this plan backfilled both 116-03's and 116-04's pins on the same array so the test now passes again. Recommend a separate quick task to dedupe the slash-command test fixtures.

2. **Bundle size 906KB raw / 275KB gzip**. Up from 882 / 270 at end of 116-03 (+24KB raw / +5KB gzip for 5 new components + 8 hooks + Sheet primitive). TraceWaterfall lazy-split into its own 3.65KB / 1.54KB gzip chunk. Well within plan target (1MB raw / 320KB gzip). 116-05 will likely add ~30KB for the cost dashboard + settings panel; still room before further code-splitting becomes necessary.

3. **F11 drawer entry-point is now the canonical "show me details about this agent" UX**. Three previously-broken paths (tile click, SLO banner link, Cmd+K palette select) all open the same drawer now. Operators clicking around in the SPA should never see a console.info-only placeholder.

4. **F14 in-UI editor is INTENTIONALLY deferred (not forgotten)**. Per 116-DEFERRED.md operator decision: the CLI flow (`clawcode memory edit <agent> <file>`) already provides file-locking + atomic write + reader-cache invalidation. The in-UI editor needs all three coordinated; a separate small phase (estimated 3-4h) handles it when operator demand surfaces. Each tier-1 file preview row in the UI shows the CLI command as italic hint text.

5. **F15 veto button is operational TODAY against the live VetoStore**. The IPC handler wraps the same `VetoStore.vetoRun(runId, reason)` that the `/clawcode-memory-veto` Discord slash command + the ❌ react path use. The dashboard veto is fully equivalent to those paths; reason rationale is required (rejected with 400 if empty) and capped at 200 chars defensively.

6. **F12 trace_spans has no parent_tool_use_id today**. Plan said "nested by parent_tool_use_id"; that column doesn't exist (and would be a schema change). Waterfall renderer nests by NAME CONVENTION (tool_call.* indented one level). A future plan adding the column can switch to true nesting without re-implementing the renderer; the indent logic lives in `indentFor(name)` which is the only line to change.

7. **F11 "live" transcript shows turn-COMPLETED events, not per-token streaming**. This is a forward of 116-03's documented stub: `conversation-turn` SSE events fire AFTER `recordTurn` writes (which only happens after the assistant turn completes). The drawer's "live" placeholder lines surface within ~200ms of a turn completing — they are NOT a per-token stream like the Discord client renders. Operators clicking on a freshly-active agent will see a brief gap between message render and the live indicator appearing in the drawer. Carrying-forward note from 116-03; per-token streaming would need a separate event upstream of `recordTurn` (out of scope for Phase 116).

## Self-Check

Created files exist:
- `src/dashboard/client/src/components/AgentDetailDrawer.tsx` — FOUND
- `src/dashboard/client/src/components/TraceWaterfall.tsx` — FOUND
- `src/dashboard/client/src/components/IpcInbox.tsx` — FOUND
- `src/dashboard/client/src/components/MemoryPanel.tsx` — FOUND
- `src/dashboard/client/src/components/DreamQueue.tsx` — FOUND
- `src/dashboard/client/src/components/ui/sheet.tsx` — FOUND

Modified files (diffs preserved):
- `src/manager/daemon.ts` — "Phase 116-04 — Tier 2 deep-dive IPC handlers" closure-intercept block (+450 lines)
- `src/dashboard/server.ts` — "=== Phase 116-04 routes ===" block (+170 lines, single contiguous fence)
- `src/ipc/protocol.ts` — +6 IPC_METHODS entries (Phase 116-04 group)
- `src/ipc/__tests__/protocol.test.ts` — backfilled 116-03 (8) + 116-04 (6) pins
- `src/dashboard/client/src/App.tsx` — drawerAgent state + AgentDetailDrawer at root + entry-point unification
- `src/dashboard/client/src/layouts/FleetLayout.tsx` — onSelectAgent prop threading
- `src/dashboard/client/src/hooks/useApi.ts` — +6 hooks/mutations + 9 exported types

Commits exist in git log (verified via `git log --oneline -3`):
- `8c3aba3` feat(116-04): T01-T05 backend — F11/F12/F13/F14/F15 IPC + REST routes
- `7b3f9d3` feat(116-04): T01-T05 frontend — F11 drawer + F12/F13/F14/F15 panels

Verification:
- `npx tsc --noEmit` (daemon-side) → 0 errors
- `cd src/dashboard/client && npx vite build` → 906.90KB JS / 275.77KB gzip + 3.65KB TraceWaterfall lazy chunk; 2515 modules transformed; 1.11s build time
- `npx vitest run src/dashboard/` → 46/46 pass
- `npx vitest run src/performance/__tests__/` → 185/185 pass
- `npx vitest run src/ipc/` → 70/70 pass (pinning test fixed)
- Bundle string search: `recent-turns`, `get-turn-trace`, `memory-snapshot`, `dream-queue`, `dream-veto`, `IPC inbox`, `Tier-1 files`, `Pending D-10 veto windows`, `Trace waterfall` all present in `dist/dashboard/spa/assets/index-*.js`

## Self-Check: PASSED

## Notes for downstream plans

- **116-05 (cost dashboard + settings):**
  - Append the cost-dashboard routes inside a new `=== Phase 116-05 routes ===` block immediately after the 116-04 fence — same convention 116-04 inherited. The IPC closure-intercept block in daemon.ts has the same "Phase 116-05" header pattern available.
  - F17 cost summary (24h) is a natural slot in the AgentDetailDrawer's right column — drop it in next to MemoryPanel/IpcInbox/DreamQueue.
  - F11 forward stubs (F04 7d sparkline, F02 per-segment SLO gauges) can land in 116-05's drawer-enrichment task.
  - The Sheet primitive in `ui/sheet.tsx` is the natural surface for a task-detail panel (F28 cards) or a per-MCP-server detail slide-over. Reuse rather than copying.
- **116-04 contiguous-routes-block convention** is preserved:
  - Daemon IPC: closure-intercept block in `src/manager/daemon.ts` opens with `// =====================================================================\n// Phase 116-04 — Tier 2 deep-dive IPC handlers (F11-F15).` at line ~5675 and closes just before the `routeMethod` fallback.
  - REST routes: `// === Phase 116-04 routes ===` ... `// === end Phase 116-04 routes ===` in `src/dashboard/server.ts`, immediately after the 116-03 fence and before the Phase 61 webhook route.
- **Future trace_spans `parent_tool_use_id` migration:**
  - Add the column via a Phase 115-08-style additive ALTER in `src/performance/trace-store.ts`. Writers in `session-adapter.ts` + `persistent-session-handle.ts` populate it.
  - F12 waterfall's `indentFor(name)` becomes `indentFor(span)` reading the new parent linkage. Single function to update; the rest of the renderer is unaffected.
- **Future in-UI memory editor (F14 full surface):**
  - File-locking primitive needed (probably a `~/.clawcode/manager/memory-edit-locks/` advisory-lock pattern).
  - Atomic temp+rename via existing `patchAgentInYaml` pattern in `src/config/yaml-patcher.ts`.
  - Post-save SSE event to invalidate the agent's reader cache + operator-confirm modal before save.
  - Estimated 3-4h per 116-DEFERRED.md.
- **Future cross-agent IPC log table (F13 full surface):**
  - Add a `cross_agent_ipc_log` table tracking (caller_agent, target_agent, method, sent_at, status). Write rows in the existing `send_to_agent` / `ask_agent` IPC handlers in daemon.ts.
  - Add `list-ipc-log?since=24h` IPC + REST + a fleet-wide log table in IpcInbox.tsx.
  - Estimated ~4h.
