# Phase 91: OpenClaw ↔ ClawCode fin-acquisition Workspace Sync - Context

**Gathered:** 2026-04-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Continuous uni-directional file synchronization between the OpenClaw fin-acquisition agent's workspace (host `100.71.14.96`, path `~/.openclaw/workspace-finmentum/`) and its ClawCode mirror (host `100.98.211.108`, path `/home/clawcode/.clawcode/agents/finmentum/`). Covers workspace markdown (MEMORY.md + memory/**/*.md + vault/procedures/archive + skills + SOUL.md + IDENTITY.md + HEARTBEAT.md), the 513MB Discord uploads directory, AND a conversation-turn translator that re-materializes OpenClaw's `sessions/*.jsonl` into ClawCode's ConversationStore. Default direction: OpenClaw → ClawCode (OpenClaw authoritative). After operator-initiated cutover, the `sync.authoritative` flag flips to `clawcode` and reverse sync becomes available as an opt-in.

**In scope:** fin-acquisition only. Fleet-wide sync (fin-playground, fin-research, etc.) is a future phase once the pattern is proven in one agent.

**Explicitly NOT in scope:**
- Bidirectional live sync — one direction authoritative at a time; never both
- SQLite replication at the DB-engine level (use the conversation-turn translator instead)
- OpenClaw infra config sync (auth-state.json, models.json, channels.modelByChannel)
- Sub-10s inotify-triggered propagation (deferred — requires OpenClaw-host-side changes; pull model at 5-min cadence is Phase 91's baseline)

</domain>

<decisions>
## Implementation Decisions

### Sync runner architecture (Area 1)

- **D-01:** Pull model — sync runner lives on ClawCode host (`100.98.211.108`) under the `clawcode` systemd user, pulls via rsync-over-SSH from `jjagpal@100.71.14.96`. Keeps sync logic in the ClawCode repo (deploys via git pull), all state co-located on clawdy, /clawcode-sync-status slash command reads local files without SSH round-trips. Operator explicitly chose pull over push.
- **D-02:** Sync state persists at `/home/clawcode/.clawcode/manager/sync-state.json` — mirrors the Phase 83 effort-state.json pattern (atomic temp+rename, graceful null fallback on corruption). Fields: `{authoritativeSide, lastSyncedAt, perFileHashes: {path: sha256}, conflicts: [...], openClawSessionCursor}`.
- **D-03:** Scheduling: systemd user timer on clawcode account, 5-minute interval (`OnUnitActiveSec=5min`). ActiveSec idempotent; if prior run overruns, next cycle skips.
- **D-04:** SSH auth — key-based from `clawcode@clawdy` → `jjagpal@100.71.14.96` over Tailscale. Key generation + `authorized_keys` provisioning is an operator runbook step (not auto-run). Runner fails gracefully with a log warning if SSH fails — does NOT block daemon startup.
- **D-05:** Sub-10s propagation deferred — OpenClaw-side inotify-triggered push would require server-side code on OpenClaw host, which is outside Phase 91's scope. 5-min rsync cadence is acceptable baseline. Flagged as a Phase 92+ follow-up.

### Conversation-turn translator (Area 2)

- **D-06:** Mid-write protection — skip any `sessions/*.jsonl` file whose `mtime < now - 60s`. OpenClaw is likely still appending; catch it on the next hourly cycle. Zero partial-JSON parse risk, zero coordination with OpenClaw's write lifecycle.
- **D-07:** Translator cadence — hourly cron, distinct from the 5-min workspace-file sync. Cursor at `/home/clawcode/.clawcode/manager/conversation-translator-cursor.json`: `{lastScanAt, perFileCursor: {path: byteOffset|lineCount}}`. Re-running is idempotent via Phase 80 `origin_id UNIQUE` constraint on ConversationStore.
- **D-08:** Content scope — extract only `role: user | assistant` text content from OpenClaw session jsonl. Skip `tool_use`, `tool_result`, `thinking`, `custom`, `model-snapshot` blocks. Rationale: ConversationStore has a `content TEXT` column; tool blocks are noise for recall queries. Fin-acquisition sessions have 500+ tool_call blocks per session — storing them would bloat the DB without aiding semantic retrieval.
- **D-09:** origin_id shape — reuse Phase 80 pattern: `openclaw-session-<sha256(sessionId + turnIndex)-prefix16>`. Guarantees deduplication across re-runs.
- **D-10:** Translator failures are non-blocking — jsonl parse errors log + skip that session, next cycle retries. Translator run produces its own observability line in `sync.jsonl` (distinct from workspace-file sync entry).

### Conflict resolution UX (Area 3)

- **D-11:** Conflict detection — pre-sync, compute sha256 of destination file; compare to `sync-state.json`'s `perFileHashes[path]` (what we last wrote). If destination sha256 ≠ last-written sha256 AND source sha256 has changed since last sync, that's a conflict (operator edited destination).
- **D-12:** On conflict — skip that file only, log entry in `sync.jsonl` with `{path, sourceHash, destHash, destMtime, sourceMtime}`, and accumulate in `sync-state.json.conflicts[]`. Other (non-conflicting) files in the same cycle proceed normally. MEMORY.md conflict does not block a dated session-note propagation.
- **D-13:** Source-wins default — once a conflict is logged, that file stops syncing until operator resolves. The OpenClaw side continues to diverge; syncing catches up only after explicit resolution.
- **D-14:** Resolution CLI — `clawcode sync resolve <path> --side openclaw|clawcode`. Semantics: copy chosen side to the other, update `perFileHashes[path]` to the new sha256, clear the conflict entry in `sync-state.json`, resume automatic syncing for that file. Scriptable; works over SSH for remote ops.
- **D-15:** Alerting — one admin-clawdy embed per sync cycle (not per file). Embed lists all conflicts in that cycle with file paths + short hashes + "run `clawcode sync resolve ...`" hint. Happy-path runs are silent. Alert uses the Phase 90.1 bot-direct sender (webhook optional, since webhook auto-provisioner is broken).
- **D-16:** Deletion policy — rsync with `--delete` on the include list. If Ramy deletes a file on OpenClaw, it deletes on ClawCode too. Operator-created files on ClawCode side that don't exist on OpenClaw are treated as conflicts per D-11 (not auto-deleted).

### Cutover flip mechanics (Area 4)

- **D-17:** `clawcode sync set-authoritative clawcode --confirm-cutover` runs a drain-then-flip sequence: (1) pause the 5-min timer, (2) run one synchronous OpenClaw → ClawCode sync cycle (report N files synced + bytes), (3) prompt operator `Drain complete — confirm flip?` (y/N, required), (4) write `sync.authoritative = clawcode` to sync-state.json, (5) resume timer (runs nothing by default because reverse sync is opt-in per D-18).
- **D-18:** Reverse sync (ClawCode → OpenClaw) does NOT auto-start post-cutover. Operator opt-in via `clawcode sync start --reverse`. Without opt-in, OpenClaw workspace stays frozen at cutover moment — serves as a read-only rollback target for 7 days. Zero dual-writer risk during this window.
- **D-19:** Rollback command — `clawcode sync set-authoritative openclaw --revert-cutover`. If reverse sync was running, stop it. If any ClawCode-side edits happened post-cutover, run a final ClawCode → OpenClaw drain to capture them. Flip flag back to `openclaw`. Resume OpenClaw-authoritative syncing. Available anytime within 7 days; rejected with hint after Day 7 unless `--force-rollback` is passed.
- **D-20:** 7-day window expiry — Day 7, a cleanup task (cron or manual `clawcode sync finalize`) posts to admin-clawdy: "Rollback window expired. OpenClaw workspace is now stale. Run `clawcode sync finalize` to remove the frozen OpenClaw mirror and reclaim the 513MB+." Never auto-deletes.
- **D-21:** Atomic cutover verification — between step 3 (confirm) and step 4 (flag write), the runner MUST re-verify no OpenClaw writes happened mid-drain (checksum check). If any changed, loop back to drain. Prevents data loss on a busy session.

### Claude's Discretion

- Exact JSONL schema for `~/.clawcode/manager/sync.jsonl` entries (minimum fields: timestamp, direction, cycle_id, files_added, files_updated, files_removed, files_skipped_conflict, bytes_transferred, duration_ms, status)
- rsync filter file syntax (include/exclude list compiled from SYNC-02)
- SSH key generation + provisioning runbook steps (operator-facing docs only, not automated)
- CLI subcommand structure for `clawcode sync` — recommended subcommands: `status`, `run-now`, `resolve <path> --side`, `set-authoritative <side> [--confirm-cutover | --revert-cutover]`, `start --reverse`, `stop`, `finalize`. Final shape decided at planning time.
- Log rotation for sync.jsonl (daily rollover → sync-YYYY-MM-DD.jsonl)
- Whether `/clawcode-sync-status` Discord slash shows just last-run or a 24h summary

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase-level artifacts
- `.planning/ROADMAP.md` §"Phase 91: OpenClaw ↔ ClawCode fin-acquisition Workspace Sync" — goal + 10 SYNC-01..10 reqs + 10 success criteria
- `.planning/STATE.md` — recent decisions log (v2.3 shipped, Phase 90 hotfixes applied, fin-test merged into fin-acquisition)

### Prior-phase SUMMARYs / CONTEXTs (direct dependencies)
- `.planning/milestones/v2.2-phases/89-agent-restart-greeting-active-discord-send-of-prior-context-summary-on-restart/89-02-SUMMARY.md` — fire-and-forget canary shape, bot-direct fallback (sync uses same pattern for conflict alerts)
- `.planning/milestones/v2.2-phases/85-mcp-tool-awareness-reliability/85-01-SUMMARY.md` — pure-function DI blueprint + /clawcode-tools EmbedBuilder precedent (use for /clawcode-sync-status)
- `.planning/milestones/v2.2-phases/83-extended-thinking-effort-mapping/83-02-SUMMARY.md` — effort-state.json atomic temp+rename pattern (use for sync-state.json)
- `.planning/milestones/v2.2-phases/86-dual-discord-model-picker-core/86-02-SUMMARY.md` — updateAgentModel atomic YAML writer shape (use for any clawcode.yaml edits from `clawcode sync` CLI)
- `.planning/milestones/v2.3-phases/90-clawhub-marketplace-fin-acquisition-memory-prep/90-02-SUMMARY.md` — memory_chunks scanner, chokidar watching `{workspace}/memory/**/*.md` — sync-written files auto-ingest
- `.planning/milestones/v2.3-phases/90-clawhub-marketplace-fin-acquisition-memory-prep/90-07-SUMMARY.md` — fin-acquisition wiring (workspace, memoryPath, heartbeat, MCPs); 513MB uploads already rsync'd once

### v1.x / v2.0 foundations
- `src/memory/store.ts` — ConversationStore schema (conversation_sessions, conversation_turns, origin_id UNIQUE). Phase 80 memory-translator pattern lives here
- `src/manager/session-manager.ts` — agent lifecycle; conversation-turn translator does NOT interact with live sessions, only historical jsonl
- `src/manager/daemon.ts` — DI wiring location; /clawcode-sync-status needs an IPC handler similar to Phase 85's list-mcp-status

### Codebase integration points (planner to deepen)
- `src/manager/effort-state-store.ts` — atomic temp+rename reference for sync-state.json writer
- `src/migration/memory-translator.ts` (Phase 80) — conversation-turn translator reuses the origin_id derivation + MiniLM embed + ConversationStore insert path, adapted for OpenClaw session jsonl input
- `src/discord/slash-commands.ts` — inline handler short-circuit for `/clawcode-sync-status` (Phase 85 /clawcode-tools precedent)
- `src/cli/commands/` — directory for new `clawcode sync *` subcommands (mirror Phase 90 `memory-backfill.ts` shape)
- `scripts/` — directory for the rsync runner bash script invoked by systemd timer
- `.planning/migrations/fin-acquisition-cutover.md` (Phase 90) — extend with sync set-authoritative command + 7-day rollback window + Day-7 finalize prompt

### External references
- `~/.openclaw/workspace-finmentum/` — source of truth for OpenClaw side (read-only from clawdy's perspective during default direction)
- `~/.openclaw/agents/fin-acquisition/sessions/*.jsonl` — conversation-turn translator input (OpenClaw session format: `{type: "message", message: {role, content}}` + custom events)
- `~/.openclaw/memory/fin-acquisition.sqlite` — OpenClaw's own memory DB (NOT synced at DB level; content arrives via markdown scanner + turn translator)
- `/home/clawcode/.clawcode/agents/finmentum/` — ClawCode destination (write target during default direction)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Phase 80 memory-translator** (`src/migration/memory-translator.ts`) — origin_id derivation + idempotent ConversationStore insert. Adapt for conversation-turn translator by swapping the input format (markdown → OpenClaw jsonl).
- **Phase 83 effort-state-store** — atomic temp+rename JSON file writer pattern. Direct copy for sync-state.json.
- **Phase 85 /clawcode-tools** — EmbedBuilder + CONTROL_COMMANDS inline short-circuit + list-mcp-status IPC. Template for /clawcode-sync-status.
- **Phase 89/90.1 fire-and-forget canary** — sendRestartGreeting pattern with bot-direct fallback. Reuse for conflict alerts to admin-clawdy channel.
- **Phase 90 memory-scanner** (chokidar on `{workspace}/memory/**/*.md`) — automatically picks up newly-synced dated files. Sync runner does NOT need to explicitly trigger the scanner; chokidar fires on `mv` completion.
- **Phase 90 memory-backfill CLI** — mirrors the shape for new `clawcode sync *` subcommands (same DI, same logger, same CLI framework).

### Established Patterns
- **Atomic temp+rename YAML/JSON writers** (Phase 82/86/88/90-07) — every file write by the sync runner uses this discipline to avoid partial writes on crash.
- **Pure-function DI + Deps struct** (Phase 85, 89) — sync runner modules are pure functions with injected rsync/ssh clients, so unit tests don't require real hosts.
- **Discriminated-union outcomes** (Phase 88 SkillInstallOutcome, Phase 89 GreetingOutcome) — SyncRunOutcome: `synced | skipped-no-changes | partial-conflicts | failed-ssh | failed-rsync | paused`.
- **fire-and-forget + `.catch(log.warn)`** — conflict alerts to admin-clawdy use this pattern so sync cycle success doesn't depend on Discord availability.
- **JSONL observability** (Phase 90 memory-flush) — sync.jsonl follows the same shape: one line per event, parseable by standard tools.

### Integration Points
- **daemon.ts DI wiring** — sync runner does NOT live in the daemon. It's a standalone systemd-timer-invoked bash script that calls `node dist/cli/index.js sync run` (or a dedicated JS module). The daemon reads `sync.jsonl` and `sync-state.json` to serve `/clawcode-sync-status` queries.
- **Discord bridge access** — conflict alerts need the bot-direct sender (Phase 90.1). If the daemon is running, it handles alert embeds. If the daemon is down during a sync cycle, conflict alerts are logged only (best-effort).
- **Runtime vs config separation** — `sync.authoritative` lives in sync-state.json (runtime, operator-mutated), NOT in clawcode.yaml (declarative config). Avoids YAML hot-reload complications.

</code_context>

<specifics>
## Specific Ideas

- **Ramy is actively using OpenClaw fin-acquisition** — 4,900 messages Apr 14-23, ongoing daily work with real clients (Sarah, Zaid, Mounir, Derrick, Allan, Eveline, etc.). Sync runner MUST NOT interfere with live sessions. D-06 (60s mid-write skip) and D-04 (graceful SSH failure) exist because of this constraint.
- **513MB uploads already exists on ClawCode side** (rsync'd Apr 24 in Phase 90-07). Sync runner's first cycle will be incremental (rsync -a --partial --inplace); only NEW uploads (PDFs Ramy adds going forward) transfer in future cycles. Full re-sync is a no-op.
- **MEMORY.md is the highest-priority file** — 27KB, hand-curated, changes when operator edits standing rules. Prioritize this in the sync order (rsync it FIRST, not alphabetical).
- **OpenClaw session jsonl format** is documented in `~/.openclaw/agents/fin-acquisition/sessions/*.jsonl` — shape is `{type: "session"|"message"|"custom", ...}`. Translator needs to handle both Session-start lines (ignore), Message lines (translate role=user|assistant text), and Custom lines (ignore — model-snapshot, openclaw.cache-ttl, etc.).
- **admin-clawdy channel** (`1494117043367186474`) is the alert target — already has bot-direct fallback working post-Phase 90.1 hotfix. Conflict alerts land there.
- **Timezone** — all sync.jsonl timestamps in UTC ISO8601. Matches project-wide pino logger convention.

</specifics>

<deferred>
## Deferred Ideas

- **Sub-10s inotify-triggered propagation** — OpenClaw-host-side file watcher + SSH signal to clawdy triggers on-demand sync cycle. Needs OpenClaw-side code change. Flagged as a Phase 92 follow-up once Phase 91's baseline proves stable.
- **Fleet-wide sync rollout** — extend to fin-playground, fin-research, fin-tax, finmentum-content-creator, general, projects, research, personal, admin-clawdy. Pattern is identical (shared-workspace memoryPath); config-driven list. Future phase once fin-acquisition is proven in production for 1+ week.
- **Bidirectional live sync** — never; explicitly rejected per D-18. Dual-writer race conditions are not worth the operational complexity.
- **SQLite replication** — never for Phase 91. ConversationStore content arrives via conversation-turn translator; memories.db content via MemoryStore / scanner markdown path. DB-engine replication (WAL shipping, Litestream) is over-engineering.
- **Live-tail continuous translator** — fs.watch on OpenClaw's sessions/*.jsonl with real-time translation. Lower latency but more state + crash recovery complexity. Hourly batch (D-07) is fine for now.
- **Discord button-based conflict resolution** — ButtonBuilder flow in admin-clawdy for "Keep OpenClaw / Keep ClawCode / Manual". Cleaner UX but state management is complex. CLI path (D-14) is sufficient.
- **Sync of OpenClaw gateway state** — auth-state.json, models.json, channels.modelByChannel. Infra config, not agent content. Out of Phase 91 scope.
- **Cross-host SQLite read access** — sometimes useful for debugging; sshfs mount would work. Not a Phase 91 feature; operator can set up ad-hoc if needed.
- **Compression / encryption of rsync traffic** — already over SSH (encrypted) and Tailscale (VPN). Extra compression saves bandwidth but adds CPU. Skip unless actual bandwidth pressure shows up.

</deferred>

---

*Phase: 91-openclaw-clawcode-fin-acquisition-workspace-sync*
*Context gathered: 2026-04-24*
