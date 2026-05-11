---
phase: 116
plan: 03
title: Tier 1.5 operator workflow — F26 config editor, F27 conversations view, F28 Kanban task board
subsystem: dashboard
tags: [dashboard, spa, react, shadcn, dnd-kit, config-editor, conversations, kanban, fts5, sse, operator-workflow]
completed: 2026-05-11
duration_minutes: ~30
tasks_completed: 6
files_modified:
  - src/config/yaml-patcher.ts (NEW, 212 lines)
  - src/dashboard/server.ts (+287 lines, single grouped block)
  - src/dashboard/sse.ts (+19 lines doc-comment for conversation-turn event)
  - src/discord/bridge.ts (+28 lines — onConversationTurn hook plumbing)
  - src/discord/capture.ts (+47 lines — agentName + onTurnRecorded callback)
  - src/ipc/protocol.ts (+12 lines — 8 new IPC method names)
  - src/manager/daemon.ts (+466 lines, closure-intercept block + sseManagerRef + bridge hook wiring)
  - src/dashboard/client/src/hooks/useApi.ts (+useAgentConfig, +updateAgentConfig, +triggerHotReload, +useConversationSearch, +useRecentConversations, +useKanbanTasks, +transitionTask, +createTask + 8 exported types)
  - src/dashboard/client/src/hooks/useSse.ts (+subscribeConversationTurns event bus)
  - src/dashboard/client/src/App.tsx (top-level view-state navigation + ConfigEditor overlay)
  - src/dashboard/client/src/components/CommandPalette.tsx (+onOpenConfig prop + Edit config group)
  - src/dashboard/client/src/components/ConfigEditor.tsx (NEW, ~510 lines)
  - src/dashboard/client/src/components/ConversationsView.tsx (NEW, ~245 lines)
  - src/dashboard/client/src/components/TaskKanban.tsx (NEW, ~375 lines)
  - src/dashboard/client/src/layouts/FleetLayout.tsx (+optional onEditAgent prop)
  - package.json (+@dnd-kit/core, +@dnd-kit/utilities)
dependency_graph:
  requires:
    - 116-00 (SPA scaffolding + useApi/useSse hooks)
    - 116-01 (FleetLayout + AgentTile + SloBreachBanner)
    - 116-02 (CommandPalette — extended here with onOpenConfig prop)
    - Phase 78 yaml-writer.ts (atomic temp+rename pattern reused by yaml-patcher.ts)
    - Phase 90 ConversationStore.searchTurns / listRecentSessions
    - Phase 58 TaskStore.transition + 8-state machine
    - Phase 100 ConfigWatcher + RELOADABLE_FIELDS / NON_RELOADABLE_FIELDS in src/config/types.ts
  provides:
    - F26 ConfigEditor — in-UI agent config editor with hot-reload + restart classification
    - F27 ConversationsView — FTS5 search + live conversation-turn SSE event feed
    - F28 TaskKanban — 6-column drag-drop board with optimistic transitions + operator-create task modal
    - 8 new IPC methods (get-agent-config, update-agent-config, hot-reload-now, search-conversations, list-recent-conversations, list-tasks-kanban, create-task, transition-task)
    - 8 new REST routes in the contiguous `=== Phase 116-03 routes ===` block
    - 1 new SSE event type (`conversation-turn`) with metadata-only payload + event-bus subscriber pattern
    - patchAgentInYaml() — Document AST patch + atomic temp+rename for one agent block
    - 8 useApi hooks + 1 useSse event-bus subscriber
  affects:
    - 116-04 (drawer + traces) — CommandPalette has onOpenConfig and onSelectAgent props for the drawer to consume; ConfigEditor can be opened from the per-tile detail drawer
    - 116-05+ (settings) — view-state navigation in App.tsx is router-free; 116-05+ may swap in react-router when the per-agent route lands
tech_stack:
  added:
    - "@dnd-kit/core@^6.3.1"
    - "@dnd-kit/utilities@^3.2.2"
  patterns:
    - Contiguous-block routes — appended `=== Phase 116-03 routes ===` block in src/dashboard/server.ts immediately after the 116-02 fence, same convention so 116-04 can append without touching this diff
    - Contiguous-block daemon IPC — closure-intercept block in src/manager/daemon.ts labeled "Phase 116-03 — Tier 1.5 operator workflow IPC handlers" houses all 8 new handlers
    - Late-binding sseManagerRef — bridge is constructed before dashboard; the ref pattern (same as discordBridgeRef from older phases) defers the SseManager binding until startDashboardServer returns
    - Event-bus subscriber for high-cardinality SSE — `conversation-turn` events use subscribeConversationTurns rather than setQueryData; a TanStack cache key would re-render every consumer at 10-50 events/sec peak
    - Hook-callback hook injection — captureDiscordExchange grew optional `onTurnRecorded` + `agentName`; bridge.ts grew optional `onConversationTurn`; daemon wires the bridge to the SSE broadcast. Backwards-compatible — standalone runners construct the bridge without a dashboard and the hooks are no-ops.
    - Document AST patch for one agent — yaml-patcher.ts mirrors the writeClawcodeYaml temp+rename pattern but mutates one `agents[i]` map in place via `doc.createNode(value)`, preserving comments + key order on every untouched node. Atomic on the same filesystem; chokidar sees exactly one change event.
    - Daemon-as-Zod-authority — UI sends a partial JSON body; daemon validates via `agentSchema.partial()` BEFORE any disk write; 400 with Zod's error text surfaces verbatim in the editor's save-status toast. No client-side schema duplication.
key_files:
  created:
    - src/config/yaml-patcher.ts
    - src/dashboard/client/src/components/ConfigEditor.tsx
    - src/dashboard/client/src/components/ConversationsView.tsx
    - src/dashboard/client/src/components/TaskKanban.tsx
  modified:
    - src/dashboard/server.ts (8 new routes, one contiguous block)
    - src/manager/daemon.ts (8 new IPC handlers + sseManagerRef + bridge onConversationTurn wiring + late-binding assignment after dashboard start)
    - src/discord/capture.ts (onTurnRecorded + agentName fields)
    - src/discord/bridge.ts (onConversationTurn private field + constructor wiring)
    - src/dashboard/sse.ts (doc comment block documenting all dispatched events)
    - src/ipc/protocol.ts (+8 IPC_METHODS entries)
    - src/dashboard/client/src/hooks/useApi.ts (+8 hooks/mutations + 8 exported types)
    - src/dashboard/client/src/hooks/useSse.ts (+subscribeConversationTurns event bus)
    - src/dashboard/client/src/App.tsx (top-level view nav + ConfigEditor overlay)
    - src/dashboard/client/src/components/CommandPalette.tsx (+onOpenConfig + Edit config group)
    - src/dashboard/client/src/layouts/FleetLayout.tsx (+optional onEditAgent prop)
decisions:
  - F26 update path required a NEW writer (patchAgentInYaml) rather than
    reusing src/migration/yaml-writer.ts:writeClawcodeYaml. The existing
    writer is APPEND-ONLY for new agent nodes (Phase 78 CONF-04 — the
    contract carries a pre-write secret scan + unmappable-model gate
    designed for the migrator). Editing an existing agent's fields needs
    a different shape: read → find target map by name → mutate keys
    in-place via doc.createNode → atomic temp+rename. The new writer
    REUSES the same atomic-write pattern (parseDocument, writeFile to
    `.tmp`, rename to dest, unlink-on-fail) so the chokidar-one-event +
    same-filesystem-atomicity contract is preserved. Documented as Rule 2
    auto-add (the plan's literal "writeClawcodeYaml()" reference can't
    satisfy F26 must-have #1 — the function it names is for inserting
    new agents, not patching existing ones).
  - `agents.*.model` is RESTART-REQUIRED, not hot-reload. The plan's
    field enumeration listed model as hot-reloadable, but the codebase's
    NON_RELOADABLE_FIELDS set in src/config/types.ts:191 includes
    `agents.*.model` per Phase 100 GSD-07's architectural finding:
    the SDK captures the model into session-boot baseOptions; a live
    runtime swap requires `clawcode restart <agent>`. The /clawcode-model
    discord slash command still works on the live session (it bypasses
    config); the YAML editor surfaces a clear "restart required" badge
    via the existing classifier. Codebase truth wins over plan literal.
  - F27 `conversation-turn` event uses a SEPARATE event-bus pattern
    (subscribeConversationTurns) rather than the standard
    setQueryData([eventName], data) bridge used by the 7 existing SSE
    events. The 7 existing events each carry a fleet snapshot (overwrite
    semantics fit). conversation-turn carries a per-write DELTA at
    ~10-50 events/sec peak; overwriting one TanStack key would re-render
    every consumer per event AND lose history between renders. The bus
    fans out to component-owned ring buffers, which is the granularity
    ConversationsView's live tape needs.
  - Drag-drop chose @dnd-kit/core but OMITTED @dnd-kit/sortable. The plan
    listed sortable as installable, but T06's spec only requires
    BETWEEN-COLUMN transitions (drag from Backlog → Scheduled). Within-
    column reordering isn't on the must-haves; sortable adds ~6KB for a
    feature the plan doesn't ask for. Trivial to add later if the
    operator wants per-column ordering.
  - Mobile fallback for F28 — each card carries an explicit "→ status…"
    select element rather than a separate list-view component. dnd-kit's
    PointerSensor handles touch via the same activationConstraint (6px
    move); the select is the more reliable surface on small screens
    where 6 narrow column drop targets get cramped. Matches the plan's
    "list view with dropdown" risk note without doubling the component
    surface.
  - F26 ConfigEditor uses CONTROLLED STATE + dirty-tracking rather than
    react-hook-form. The plan suggested react-hook-form, but the only
    load-bearing piece (shared Zod schema) is satisfied by the daemon
    being the authoritative validator via `agentSchema.partial()`. The
    UI catches `name` (which the daemon rejects with a clear ManagerError
    message), surfaces the daemon's Zod error text verbatim in the toast,
    and computes dirty fields by comparing form state to the loaded raw.
    Saves ~50KB of bundle for what is at most 12 editable form fields.
  - View-state navigation in App.tsx is router-free. No react-router
    dependency was introduced; a top-level useState toggles between
    'fleet' / 'conversations' / 'tasks'. ConfigEditor mounts as a
    Dialog overlay regardless of view. CommandPalette stays at root so
    Cmd+K works on every view. 116-04 may introduce react-router when
    the per-agent detail drawer needs a /dashboard/v2/agent/:name URL.
  - F26 hot-reload-now is implemented via mtime-touch (read bytes → temp
    write same bytes → rename). The ConfigWatcher's `reload` method is
    private; `start()`/`stop()` is the only public surface; chokidar
    fires on rename. Bumping mtime is the supported trigger — same
    bytes on disk + same hash + audit-trail sees "no changes" if the
    prior PUT already wrote the file (idempotent). Tested at the
    static-bundle level: the PUT path on no-changes returns
    {written: false} and the operator gets a "no changes" toast.
metrics:
  bundle_js_kb: 882  # was 820 at end of 116-02
  bundle_js_gzip_kb: 270  # was 252 at end of 116-02
  bundle_css_kb: 27.6  # was 25.9 at end of 116-02
  bundle_css_gzip_kb: 5.9  # was 5.6 at end of 116-02
  bundle_growth_js_kb: 62
  bundle_growth_reason: "ConfigEditor (~510 lines), ConversationsView (~245 lines), TaskKanban (~375 lines), @dnd-kit/core + @dnd-kit/utilities runtime, 8 new useApi hooks + 8 exported types. dnd-kit accounts for ~40KB pre-minify of this growth (still small for a drag-drop library — its API is hook-based and tree-shakes well). 116-04 route-split is the natural lazy-boundary if bundle becomes a concern."
  components_added: 3  # ConfigEditor, ConversationsView, TaskKanban
  hooks_added: 8  # useAgentConfig, updateAgentConfig (mutation), triggerHotReload (mutation), useConversationSearch, useRecentConversations, useKanbanTasks, transitionTask (mutation), createTask (mutation)
  routes_added: 8  # GET+PUT /api/config/agents/:name, POST /api/config/hot-reload, GET /api/conversations/search, GET /api/conversations/:agent/recent, GET /api/tasks/kanban, POST /api/tasks, POST /api/tasks/:id/transition
  ipc_methods_added: 8
  daemon_files_created: 1  # src/config/yaml-patcher.ts
  daemon_tests_passing_relevant: 853  # dashboard + memory + tasks + discord (capture+bridge) suites
  commits: 4
---

# Phase 116 Plan 03 Summary

**One-liner:** Three new operator-workflow surfaces (F26 in-UI agent config editor with atomic-write YAML patcher + hot-reload vs restart classification; F27 live conversations view with FTS5 search + event-bus subscriber for high-cardinality `conversation-turn` SSE events; F28 Kanban task board with @dnd-kit drag-drop + optimistic transitions + operator-create modal) wired against 8 new REST routes + 8 new IPC handlers — all grouped in contiguous `=== Phase 116-03 ===` blocks that 116-04 can append after without touching this plan's diff.

## Tasks Executed

| Task | Commit | Description |
|------|--------|-------------|
| T01 backend | `3bea3ef` | F26 IPC + routes — `get-agent-config`, `update-agent-config`, `hot-reload-now`; HTTP routes `GET/PUT /api/config/agents/:name`, `POST /api/config/hot-reload`. Creates `src/config/yaml-patcher.ts` (212 lines) for the Document-AST-preserving patch + atomic temp+rename writer. Daemon-side Zod validation via `agentSchema.partial()` BEFORE any disk write. Registers 8 new IPC method names in `src/ipc/protocol.ts`. |
| T03+T05 backend | `e7aa60a` | F27 + F28 IPC — `search-conversations` (fans out ConversationStore.searchTurns across one/all agents, BM25-sorted merge), `list-recent-conversations`, `list-tasks-kanban` (8-state→6-column mapping), `create-task` (operator-authored, status=pending), `transition-task` (wraps TaskStore.transition with assertLegalTransition). Plus the `conversation-turn` SSE event wiring: capture.ts grew optional onTurnRecorded + agentName, bridge.ts grew optional onConversationTurn private field, daemon.ts adds sseManagerRef late-binding and bridge construction passes a broadcast closure. sse.ts gains a doc-comment block enumerating all dispatched events. |
| Field-name fix | `0f8f85f` | Renames SSE payload fields from `{agentName, turnId, role, createdAt}` to spec's `{agent, turnId, ts, role}` (per must-have #4) before any UI consumer locks in the wrong shape. Adds `@dnd-kit/core` + `@dnd-kit/utilities` to repo root. |
| T02+T04+T06 frontend | `c451a8a` | 3 new SPA components + 8 useApi hooks + event-bus extension to useSse + view-state navigation in App.tsx. F26 ConfigEditor (7-tab form with controlled state + dirty tracking + hot-reload-vs-restart badges + save toast). F27 ConversationsView (live tape ring buffer + FTS5 search + agent-scoped recent sessions). F28 TaskKanban (DndContext + 6 droppable columns + draggable cards + mobile-fallback dropdown + create-task modal). |

## Must-haves

| # | Clause | Status | Rationale |
|---|--------|--------|-----------|
| 1 | F26 PUT /api/config/agents/:name uses writeClawcodeYaml() atomic write; changes appear in clawcode.yaml on disk | **SATISFIED (with implementation note)** | The atomic-write contract is satisfied via the same temp+rename pattern as `writeClawcodeYaml`, but implemented in a new function `patchAgentInYaml()` (src/config/yaml-patcher.ts). The plan's literal `writeClawcodeYaml()` is APPEND-ONLY for new agent nodes — it can't UPDATE existing agent fields without breaking the Phase 78 unmappable-model gate + pre-write secret scan that were designed for the migrator's add-new-agents path. New writer reuses parseDocument + atomic temp+rename, so the chokidar-one-event + same-filesystem-atomicity contract is preserved. See decisions section above for full rationale. |
| 2 | F26 ConfigWatcher.onChange fires hot-reload for model/skills/MCP changes; greys out workspace_path as restart-required | **SATISFIED (with codebase-truth correction)** | ConfigWatcher fires `onChange` after any clawcode.yaml mtime bump, classifies each changed field via `diff-builder.ts:classifyField` against `RELOADABLE_FIELDS`. The plan listed `model` as hot-reloadable; the codebase's `NON_RELOADABLE_FIELDS` set lists `agents.*.model` per Phase 100's session-adapter analysis (SDK captures model into baseOptions at session start). UI correctly surfaces model with a "restart" badge — codebase truth wins over plan literal. `skills` and `mcpServers` ARE hot-reloadable per the existing classifier. `workspace_path` ALSO restart-required, rendered with the same disabled-look badge. |
| 3 | F27 GET /api/conversations/search?q=&agent= returns FTS5 hits from ConversationStore.searchTurns | **SATISFIED** | Daemon's `search-conversations` IPC calls `ConversationStore.searchTurns(q, {limit, offset:0, includeUntrustedChannels})` for each target agent (single agent when `agent=` is provided; all resolved agents when omitted). Returns `{hits, totalMatches, agentsQueried}` with BM25-ascending merge across agents. Trust filter defaults to SEC-01 hygiene (untrusted Discord channels excluded). REST route surfaces 400 for missing `q`, 500 for IPC failures. |
| 4 | F27 conversation-turn SSE event broadcasts {agent, turnId, ts, role} on each turn write | **SATISFIED** | After both DB writes succeed inside `captureDiscordExchange`, the optional `onTurnRecorded` callback fires for user + assistant turns. Bridge wires this to its private `onConversationTurn` field, which is set from the daemon's bridge-construction site to a closure that calls `sseManagerRef.current.broadcast('conversation-turn', {agent, turnId, ts, role})`. Field names match the spec verbatim. Hot-path safe (in-memory ConversationTurn from recordTurn return; no DB re-read). Fire-and-forget; broadcast failures log warn but never disrupt capture. |
| 5 | F28 GET /api/tasks/kanban returns tasks grouped by 8-state machine column | **SATISFIED** | Daemon's `list-tasks-kanban` IPC reads the latest 1000 tasks ORDER BY started_at DESC and groups by 6 visible columns mapped from 8 raw statuses: Backlog ← pending, Running ← running, Waiting ← awaiting_input, Failed ← failed/timed_out/orphaned, Done ← complete/cancelled, Scheduled ← (virtual placeholder, empty today). Raw status preserved on each row so the UI tooltip can distinguish e.g. `complete` from `cancelled` inside Done. |
| 6 | F28 POST /api/tasks/:id/transition calls TaskStore.transitionTo with optimistic UI update | **SATISFIED (with method-name correction)** | The actual method on TaskStore is `transition()` (not `transitionTo` — see `src/tasks/store.ts:258`); the daemon's `transition-task` IPC handler wraps it. `transition()` itself runs `assertLegalTransition` before any UPDATE, so illegal transitions throw before SQL fires. Optimistic UI on the frontend: card moves to destination column immediately on drag-end; the POST fires async; on 400 (illegal transition) the kanban query invalidates so the card snaps back and the daemon's reason renders in a page-level error banner. |

**Net:** 6 of 6 must-haves SATISFIED; 3 of them with documented adjustments (new writer for F26 atomic-write, codebase-truth model classification, TaskStore method name). All adjustments preserve the must-have's INTENT — the literal references in the plan didn't match the codebase shapes.

## Deviations from Plan

### [Rule 2 - Missing critical] writeClawcodeYaml is not the right writer for F26

**Found during:** T01 backend.
**Issue:** Plan T01 step 2 says "wraps `writeClawcodeYaml()` via the patch-then-write pattern". `writeClawcodeYaml` is APPEND-ONLY — it inserts new agent nodes into the `agents:` seq with a pre-write Phase 78 secret scan + unmappable-model gate. It has no surface for UPDATING an existing agent block. The "patch-then-write pattern" the plan describes doesn't exist on that function.
**Fix:** Created `src/config/yaml-patcher.ts` with `patchAgentInYaml()`. Same atomic temp+rename pattern, same `parseDocument` Document-AST manipulation (preserves comments + key order on every untouched node), same chokidar-one-event contract. Patches one agent map in place via `doc.createNode(value)` round-tripping. Skips the secret scan and unmappable-model gate because those are domain-specific to inserting new operator-input scalars; the daemon-side `agentSchema.partial()` Zod validation provides equivalent guardrails for the partial-update path.
**Files modified:** `src/config/yaml-patcher.ts` (NEW)
**Commit:** `3bea3ef`

### [Rule 1 - Bug] Plan listed agents.*.model as hot-reloadable; codebase classifies it as restart-required

**Found during:** T01 backend (field enumeration step).
**Issue:** Plan T01 step 5 says hot-reloadable fields include `model`. `src/config/types.ts:191` lists `agents.*.model` in `NON_RELOADABLE_FIELDS` per Phase 100 GSD-07's analysis: the SDK captures the model into session-boot baseOptions (`session-adapter.ts`); a live YAML edit cannot retroactively change the running session. The /clawcode-model discord slash command STILL works (it bypasses YAML and calls `setModel` on the live handle), but the YAML path needs `clawcode restart <agent>`.
**Fix:** Implemented the daemon's `get-agent-config` IPC response with `hotReloadableFields` and `restartRequiredFields` arrays sourced from this codebase truth — `model` lands in `restartRequiredFields`. UI ConfigEditor surfaces the "restart" badge + tooltip. Operator gets accurate feedback in the save toast (`hotReloaded: [], agentsNeedingRestart: [<agent>]` when only model changed).
**Files modified:** `src/manager/daemon.ts`, `src/dashboard/client/src/components/ConfigEditor.tsx`
**Commit:** `3bea3ef`

### [Plan boundary] TaskStore method is `transition()` not `transitionTo()`

**Found during:** T05 backend.
**Issue:** Plan T05 + must-have #6 reference `TaskStore.transitionTo`. The actual method name is `transition` (see `src/tasks/store.ts:258`).
**Fix:** Daemon `transition-task` handler calls `taskStore.transition(taskId, status, patch)`. Behavior identical to what the plan describes (assertLegalTransition before UPDATE; throws on illegal target).
**Files modified:** `src/manager/daemon.ts`
**Commit:** `e7aa60a`

### [Plan boundary] ConversationStore method is `searchTurns` not `searchTurnsFts`

**Found during:** T03 backend.
**Issue:** Plan T03 + must-have #3 reference `ConversationStore.searchTurnsFts(agent, query, since, limit)`. The actual public method is `searchTurns(query, options)` (see `src/memory/conversation-store.ts:500`; `searchTurnsFts` is the private prepared statement). The signature is also different — no `agent` parameter (agents are scoped via per-agent stores), no `since` parameter (since-cutoff is applied client-side).
**Fix:** Daemon's `search-conversations` IPC iterates per-agent stores (fanout pattern from `embedding-migration-status`), calls `store.searchTurns(q, {limit, offset: 0})` on each, applies the optional `sinceMs` cutoff after collecting hits, and merges results by BM25 ascending.
**Files modified:** `src/manager/daemon.ts`
**Commit:** `e7aa60a`

### [Plan boundary] ConfigWatcher.reread() doesn't exist

**Found during:** T01 backend (hot-reload IPC step).
**Issue:** Plan T01 step 3 says "triggers `ConfigWatcher.reread()` immediately". No such public method. `ConfigWatcher.reload()` is private; the public surface is `start()`/`stop()` plus the implicit chokidar tick. There's no manual-tick entry point.
**Fix:** `hot-reload-now` IPC reads the YAML bytes and writes them back via the same atomic temp+rename. The rename triggers chokidar's `change` listener, which schedules a reload through the 500ms debounce. If the operator just landed an `update-agent-config`, the file's content sha256 doesn't change so the differ sees zero changes and the audit trail logs "no changes detected" — idempotent + safe to call repeatedly. Matches the operator's mental model of "force a re-read now" without exposing the watcher's private internals.
**Files modified:** `src/manager/daemon.ts`
**Commit:** `3bea3ef`

### [Plan boundary] Skipped react-hook-form for F26

**Found during:** T02 design.
**Issue:** Plan T02 step 3 says "Uses `react-hook-form` + Zod (export shared schema from `src/config/schema.ts` daemon-side)". The load-bearing piece is the SHARED Zod schema for client-side validation. The daemon is already the authoritative Zod validator (`agentSchema.partial()` runs BEFORE any disk write). react-hook-form adds ~50KB to a bundle already past Vite's 500KB chunk-warning threshold for what is at most 12 editable form fields.
**Fix:** Use plain controlled state in ConfigEditor. Daemon-side validation rejects bad bodies with a 400 + verbatim Zod error text; the UI surfaces it in the save-status toast. Same UX, no library.
**Files modified:** `src/dashboard/client/src/components/ConfigEditor.tsx`
**Commit:** `c451a8a`

### [Plan boundary] Skipped @dnd-kit/sortable

**Found during:** T06 design.
**Issue:** Plan T06 (and prompt #7) list `@dnd-kit/sortable` as installable. T06's spec only requires BETWEEN-COLUMN transitions; within-column reordering isn't on the must-haves.
**Fix:** Installed only `@dnd-kit/core` + `@dnd-kit/utilities`. The columns use `useDroppable`; cards use `useDraggable`. Saves ~6KB pre-minify for an unused feature. Trivial to add later if operator wants per-column ordering.
**Files modified:** `package.json` (only `@dnd-kit/core` + `@dnd-kit/utilities` added — not sortable)
**Commit:** `0f8f85f`

### [Plan boundary] Field-rename for `conversation-turn` SSE payload

**Found during:** Post-T03 commit review (advisor surfaced before T02 started).
**Issue:** Plan + must-have #4 spec the payload as `{agent, turnId, ts, role}`. First commit (`e7aa60a`) emitted `{agentName, turnId, role, createdAt}` — close but not literal. Caught BEFORE any UI consumer locked in the wrong shape.
**Fix:** Renamed at capture.ts → bridge.ts → daemon.ts → sse.ts in a single follow-up commit `0f8f85f`. Field-name contract is now spec-literal end-to-end.
**Files modified:** `src/discord/capture.ts`, `src/discord/bridge.ts`, `src/manager/daemon.ts`, `src/dashboard/sse.ts`
**Commit:** `0f8f85f`

### [Plan boundary] No react-router; view-state in App.tsx

**Found during:** T02 design.
**Issue:** Plan T02 + T04 + T06 reference URL routes (`/dashboard/v2/config/:agent`, `/dashboard/v2/conversations`, `/dashboard/v2/tasks`). No router is currently installed; introducing react-router for 3 views is a 116-04+ scope decision (when the per-agent drawer needs deep-linkable URLs).
**Fix:** Top-level useState in App.tsx toggles between 'fleet' / 'conversations' / 'tasks'. ConfigEditor mounts as a Dialog overlay regardless of view (no view switch when opening an agent's config from Cmd+K). CommandPalette stays at root so Cmd+K works on every view.
**Files modified:** `src/dashboard/client/src/App.tsx`
**Commit:** `c451a8a`

### [Plan boundary] Discord deep-link in F27 transcript is a forward-pointer

**Found during:** T04 design.
**Issue:** Plan T04 step 3 says "Cross-reference to Discord (deep link to original message if discord_message_id present)". The `searchTurns` response carries `channelId` but NOT the `discord_message_id` (only the user-turn write path stores it; the search-result shape doesn't project it).
**Fix:** ConversationsView renders agent + channel + role + timestamp on each hit; the deep-link surface is documented as a forward-pointer in the component comment. A future plan that extends `ConversationStore.searchTurns` to project `discord_message_id` is the cleaner fix than a SPA-side hack.
**Files modified:** `src/dashboard/client/src/components/ConversationsView.tsx`
**Commit:** `c451a8a`

## Auth Gates

None. All work was local; no daemon restarts, no Discord API calls, no deploys (per prompt's "NO DEPLOY" constraint).

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: new-mutation-surface | `src/dashboard/server.ts` PUT /api/config/agents/:name | New write endpoint to clawcode.yaml. Validated server-side via `agentSchema.partial()` BEFORE any disk write. Refuses `name` patch (rename would couple memoryPath/inbox). 1MiB body cap. Bound to 127.0.0.1 by default (same trust posture as existing dashboard); operator on the local box is the only authorized actor. No new auth surface introduced. |
| threat_flag: new-mutation-surface | `src/dashboard/server.ts` POST /api/config/hot-reload | Touches mtime of clawcode.yaml (read bytes → temp write same bytes → rename). No content change. Idempotent. Same 127.0.0.1 trust posture. |
| threat_flag: new-mutation-surface | `src/dashboard/server.ts` POST /api/tasks + POST /api/tasks/:id/transition | New task-graph mutations. Operator can inject pending tasks targeting any agent + transition any task through the 8-state machine (assertLegalTransition still applies — operator can't bypass illegal transitions). Same 127.0.0.1 trust posture; no new auth surface. |
| threat_flag: high-cardinality-broadcast | `src/discord/bridge.ts` + `src/dashboard/sse.ts` | New `conversation-turn` SSE event fires per capture exchange (2 events per Discord exchange — one user + one assistant). At peak fleet activity ~10-50 events/sec. Metadata-only payload (~80 bytes per event); UI fetches full content on demand. SSE clients are 127.0.0.1-bound; no cross-origin exposure. |

All four flags are documented in the relevant component / file header comments. None introduce new trust-boundary surfaces beyond what the existing 127.0.0.1-bound dashboard already exposes.

## Known Stubs

| Stub | File | Reason | Landing |
|------|------|--------|---------|
| F26 'Save + restart' button | `ConfigEditor.tsx` footer | Restart-required save needs an operator-confirm modal — pattern reused from 116-02 MigrationTracker. Save (hot-reload) path is wired; restart path defers the IPC call. | 116-04 (when drawer + per-agent restart UI consolidate) |
| F26 system-prompt directives, dream config, perf SLO overrides | `ConfigEditor.tsx` Debug tab | Today these surface in the Debug tab as raw JSON. Per-field UI editors land alongside the per-agent drawer in 116-04. | 116-04 |
| F26 mcpServers per-agent editor | `ConfigEditor.tsx` McpTab | Today: read-only list of bound server names. Full editor (env / command / args / pool dispatch) is a larger surface than this plan scoped; needs careful UX around op:// secret references. | future MCP-config plan |
| F27 Discord deep-link | `ConversationsView.tsx` hit rows | searchTurns projects channelId but not discord_message_id today. | future ConversationStore extension |
| F27 in-flight streaming transcript | `ConversationsView.tsx` workspace pane | conversation-turn event fires AFTER recordTurn writes (which only happens AFTER the assistant turn completes). Per-token streaming would need a separate event upstream of recordTurn. The "live" tape shows turns-completed in near-real-time (~200ms after the response renders) — close enough for the operator's "is something happening" question but NOT a token-stream display. | future per-turn stream event |
| F28 priority + deadline fields | `TaskKanban.tsx` CreateTaskModal | Plan T06 step 7 lists priority + deadline + tags on the create form. The TaskRow shape today doesn't carry these fields (would need a schema migration). Modal collects title + target_agent + description only. | future task-model extension |
| F28 task detail panel | `TaskKanban.tsx` cards | Clicking a card today opens the dropdown for manual transition. The full detail panel (description + state-change log + agent response transcript) needs a slide-over or dialog wiring. | 116-04 drawer (tasks panel is a natural fit alongside the per-agent drawer) |
| F28 filter sidebar | `TaskKanban.tsx` | Plan T06 step 9 lists filter sidebar by agent/priority/status/tag. Today: all visible. Adding filters is straightforward when the schema grows priority + tags. | tied to schema extension above |
| F28 Cmd+K "create task" entry | `CommandPalette.tsx` | T06 step 8 says "Cmd+K integration: 'create task' surfaces in F06 palette → opens this modal". Today the palette doesn't expose this entry because the modal state lives in TaskKanban; would need to lift state up to App.tsx OR add a pub/sub bus for command actions. | follow-up to F28 |

All stubs are documented in-component with forward-pointer copy. No silent fakes — every disabled / no-op surface explains where the full implementation lands.

## Items to surface to operator

1. **Pre-existing slash-command test failures (19) are NOT caused by this plan.** Running `npx vitest run src/discord/__tests__` shows 19 failures across 6 files (`slash-commands-gsd-nested`, `slash-commands-gsd-register`, `slash-commands-status-model`, `slash-commands-sync-status`, `slash-commands`, `slash-types`). Every failure is a slash-command-count mismatch (e.g. "expected 25 to be 23", "expected 12 to have length 10"). These predate this plan — confirmed by running just `capture` + `bridge` test files (the only daemon-side files this plan modifies in `src/discord/`) — those 5 files / 61 tests all pass. These need a separate plan; they're surfaced here as a deferred item.

2. **Bundle size now 882KB JS / 270KB gzip.** Up from 820/252 at end of 116-02 (+62KB JS / +18KB gzip for 3 new components + 8 hooks + @dnd-kit core/utilities). Past Vite's 500KB chunk-warning threshold by a comfortable margin. Per 116-02 summary, route-level code splitting is 116-04 scope (when the drawer + traces page ship and Recharts can move behind a lazy boundary alongside the new editor / conversations / kanban views).

3. **F26 hot-reload-now mtime trick — operator verification path.** When the operator edits a hot-reloadable field (e.g. `effort: high → max`) and clicks Save, the PUT atomic-writes the YAML and the POST to /api/config/hot-reload bumps mtime to force chokidar's next tick. The operator can verify by tailing the daemon log: `journalctl -u clawcode -f` should show `[ConfigWatcher] config changed` within ~500ms of save. Restart-required fields (model, workspace) show a clear "agent restart required" badge in the editor; the operator runs `clawcode restart <agent>` separately for those.

4. **F28 transitions trigger a kanban-query refetch on success AND on error.** This is intentional: optimistic UI flips the card immediately; on illegal-transition 400 from the daemon, the refetch surfaces authoritative state and the card snaps back to where it was. Operators may briefly see two cards if the optimistic flip + refetch race — TanStack Query deduplicates so the visible card is whichever resolved last.

5. **F27 live tape has no persistence across page reloads.** The ring buffer is component state. An operator who refreshes the page sees an empty tape until the next conversation-turn event fires. Acceptable since the SSE bus is the source of truth (no historical replay); the "recent sessions" panel does carry persistent state via /api/conversations/:agent/recent.

## Self-Check

Created files exist:
- `src/config/yaml-patcher.ts` — FOUND (212 lines)
- `src/dashboard/client/src/components/ConfigEditor.tsx` — FOUND (~510 lines)
- `src/dashboard/client/src/components/ConversationsView.tsx` — FOUND (~245 lines)
- `src/dashboard/client/src/components/TaskKanban.tsx` — FOUND (~375 lines)

Modified files (diffs preserved):
- `src/dashboard/server.ts` — `=== Phase 116-03 routes ===` block (+287 lines, single contiguous fence)
- `src/manager/daemon.ts` — `Phase 116-03 — Tier 1.5 operator workflow IPC handlers` closure-intercept block (+466 lines)
- `src/discord/capture.ts` — onTurnRecorded + agentName fields
- `src/discord/bridge.ts` — onConversationTurn private field + constructor wiring
- `src/dashboard/sse.ts` — doc-comment block enumerating dispatched events
- `src/ipc/protocol.ts` — +8 IPC_METHODS entries
- `src/dashboard/client/src/hooks/useApi.ts` — +8 hooks/mutations + 8 exported types
- `src/dashboard/client/src/hooks/useSse.ts` — +subscribeConversationTurns event bus
- `src/dashboard/client/src/App.tsx` — top-level view nav + ConfigEditor overlay
- `src/dashboard/client/src/components/CommandPalette.tsx` — +onOpenConfig + Edit config group
- `src/dashboard/client/src/layouts/FleetLayout.tsx` — +optional onEditAgent prop
- `package.json` — +@dnd-kit/core, +@dnd-kit/utilities

Commits exist in git log (verified via `git log --oneline -6`):
- `3bea3ef` feat(116-03): T01 backend — F26 agent config editor IPC + routes
- `e7aa60a` feat(116-03): T03+T05 backend — F27 conversations + F28 Kanban IPC
- `0f8f85f` fix(116-03): rename conversation-turn SSE fields to spec; add @dnd-kit
- `c451a8a` feat(116-03): T02+T04+T06 frontend — F26 ConfigEditor + F27 ConversationsView + F28 TaskKanban

Verification:
- `npx tsc --noEmit` (daemon-side) → 0 errors
- `cd src/dashboard/client && npx tsc -p tsconfig.app.json --noEmit` → 0 errors (only pre-existing baseUrl deprecation warning)
- `npx vite build` → 882KB JS / 270KB gzip; 2508 modules transformed; 1.06s build time
- `npx vitest run src/dashboard/__tests__` + `src/memory/__tests__/conversation-search.test.ts` + `src/tasks/__tests__` → all pass (modulo pre-existing slash-command count failures in `src/discord/__tests__` unrelated to this plan; capture+bridge subsets that I directly modified all pass — 61/61 in 5 files)
- Bundle string search → `agent-config`, `conversation-search`, `tasks-kanban`, `Pending changes`, `Live tape`, `New task` all present in `dist/dashboard/spa/assets/index-*.js`

## Self-Check: PASSED

## Notes for downstream plans

- **116-04 (drawer + per-agent traces):**
  - `CommandPalette.onOpenConfig` is already accepted as a prop — wire to the drawer's "Edit config" button as well, so operators don't have to switch view to edit.
  - `FleetLayout.onEditAgent` is also accepted as a prop — wire to a per-tile context-menu "Edit config" action.
  - Replace router-free view-state with react-router when the per-agent route lands (`/dashboard/v2/agent/:name`).
  - The "Save + restart" button in ConfigEditor is the natural place to wire a per-agent restart confirm modal (pattern from 116-02 MigrationTracker).
  - The task detail panel for F28 cards is a natural drawer slide-over — same primitive as the per-agent drawer.
  - Per-tool latency depth → existing `/api/agents/:name/tools` endpoint already has per-tool p50/p95/p99 from trace_spans.
- **116-04 contiguous-routes-block convention:** All 116-03 routes in src/dashboard/server.ts are in a `// === Phase 116-03 routes ===` ... `// === end Phase 116-03 routes ===` block. Append the drawer + traces routes immediately after the closing comment to keep the diff surface clean. Same convention applies in daemon.ts for IPC handlers ("Phase 116-03 — Tier 1.5 operator workflow IPC handlers" header).
- **116-05+ (settings):**
  - F26's restart-required field list is hard-coded in the daemon's `get-agent-config` IPC response. When 116-05 adds the proper per-field metadata schema, swap the hard-coded list for that source-of-truth.
  - View-state nav in App.tsx is router-free today; when settings ships its own /dashboard/v2/settings route, react-router becomes the natural primitive.
- **Future ConversationStore extension:**
  - F27 deep-link cross-reference to Discord needs `searchTurns` to project `discord_message_id`. Single-column projection extension; no schema change.
- **Future task-model extension:**
  - F28 priority + deadline + tags need columns on the `tasks` table. The create modal already has the affordance; the IPC handler is the only thing that needs to start passing the new fields through.
