# Phase 91: OpenClaw ↔ ClawCode fin-acquisition Workspace Sync - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-24
**Phase:** 91-openclaw-clawcode-fin-acquisition-workspace-sync
**Areas discussed:** Sync runner host + ownership, Conversation-turn translator behavior, Conflict resolution UX, Cutover flip mechanics

---

## Sync runner host + ownership

### Q: Where does the sync runner process live?

| Option | Description | Selected |
|--------|-------------|----------|
| OpenClaw host (push model) | Runner on 100.71.14.96 with inotify next to source of truth. Recommended for sub-second change detection. | |
| ClawCode host (pull model) | Runner on 100.98.211.108 as clawcode user, pulls via rsync from OpenClaw. Sync code in ClawCode repo. | ✓ |
| Both — daemon-to-daemon protocol | Overkill for single-agent sync; deferred. | |

**User's choice:** ClawCode host (pull model)
**Notes:** Deviates from recommended push model. Trade-off: 5-min polling latency on OpenClaw changes (sub-10s inotify deferred to Phase 92). Rationale aligned with operator preference: keep sync logic in ClawCode repo, deploy via git pull, state co-located on clawdy.

### Q: Where does sync STATE live (last-synced hashes, conflict log, authoritative-side flag)?

| Option | Description | Selected |
|--------|-------------|----------|
| Clawdy host: ~/.clawcode/manager/sync-state.json | JSON on clawdy. Mirrors Phase 83 effort-state.json pattern. | ✓ |
| OpenClaw host: ~/.openclaw/sync-state.json | State co-located with runner if runner lived there. | |

**User's choice:** Clawdy host — `/home/clawcode/.clawcode/manager/sync-state.json`
**Notes:** /clawcode-sync-status slash reads this file locally without SSH round-trips.

---

## Conversation-turn translator behavior

### Q: How do we handle OpenClaw sessions/*.jsonl mid-write (OpenClaw actively appending)?

| Option | Description | Selected |
|--------|-------------|----------|
| Skip files touched in last 60s | mtime < 60s → skip this cycle, catch on next pass. Avoids partial-JSON parse. | ✓ |
| Tail with JSON-safe parser | Read complete lines only, stop at first parse error. | |
| Let OpenClaw signal session-close | Wait for .jsonl → .jsonl.closed rename. Requires OpenClaw-side changes. | |

**User's choice:** Skip files touched in last 60s

### Q: Translator cadence + cursor storage

| Option | Description | Selected |
|--------|-------------|----------|
| Hourly cron + cursor file | Every hour scan mtime > last-synced-cursor. Phase 80 origin_id idempotency. Bounded work. | ✓ |
| Continuous tail (fs.watch) | Long-lived tail process. Lower latency, more state + crash recovery. | |
| Piggyback on workspace sync | Every 5-min workspace sync runs translator delta. Couples the two concerns. | |

**User's choice:** Hourly cron + cursor file at `/home/clawcode/.clawcode/manager/conversation-translator-cursor.json`

### Q: What content translates — full turns or summarized?

| Option | Description | Selected |
|--------|-------------|----------|
| User + assistant text only | role=user|assistant text content. Skip tool_calls/tool_results/thinking. Phase 80 pattern. | ✓ |
| Full content incl. tool calls | Preserve complete JSON. Massive storage growth + search noise. | |

**User's choice:** User + assistant text only

---

## Conflict resolution UX

### Q: When checksum mismatch detected, what happens immediately?

| Option | Description | Selected |
|--------|-------------|----------|
| Skip that file only + log + alert | Log in sync.jsonl, post embed to admin-clawdy, other files proceed. | ✓ |
| Pause entire sync until resolved | First conflict halts the whole timer. Safer but disruptive. | |
| Auto-overwrite with authoritative side | Source wins silently. Fast but data-loss risk on destination edits. | |

**User's choice:** Skip that file only + log + alert
**Notes:** MEMORY.md propagation doesn't block on stale `memory/archive/*.md` hash mismatch.

### Q: How does operator resolve a logged conflict?

| Option | Description | Selected |
|--------|-------------|----------|
| CLI: `clawcode sync resolve <path> --side openclaw|clawcode` | Single command, scriptable, works over SSH. | ✓ |
| Discord button flow (Phase 86 pattern) | ButtonBuilder 3-option embed. Complex state mgmt for multi-conflict queues. | |

**User's choice:** CLI

### Q: What triggers the admin-clawdy alert embed?

| Option | Description | Selected |
|--------|-------------|----------|
| On first conflict in a sync cycle | One alert per cycle listing all conflicts. Quiet on happy-path. | ✓ |
| Every conflict, every file | N alerts when N files conflict. Noisy. | |
| Only N+ cumulative unresolved conflicts | Silent until pile-up. Can miss single-file-but-important conflicts. | |

**User's choice:** On first conflict in a sync cycle

---

## Cutover flip mechanics

### Q: Does `clawcode sync set-authoritative clawcode --confirm-cutover` run a final drain first?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, drain-then-flip | Pause timer, final sync, operator confirm, flip flag, resume. Zero dual-writer window. | ✓ |
| Instant flip (no drain) | Immediate flag swap. Pending edits stranded. Fast but lossy. | |
| Ask operator (--drain / --no-drain flag) | Flag-controlled. More flexibility, more foot-guns. | |

**User's choice:** Drain-then-flip

### Q: Post-cutover: does reverse sync (ClawCode→OpenClaw) start automatically?

| Option | Description | Selected |
|--------|-------------|----------|
| No — manual opt-in | Flag flips, OpenClaw frozen read-only. Operator runs `sync start --reverse` if needed. | ✓ |
| Yes — reverse sync starts immediately | Auto-enables ClawCode→OpenClaw. More safety if rollback needed, more dual-writer risk. | |

**User's choice:** No — manual opt-in
**Notes:** OpenClaw workspace stays frozen for 7-day rollback window. After Day 7, admin-clawdy prompts cleanup.

### Q: Rollback during the 7-day window — what does it look like?

| Option | Description | Selected |
|--------|-------------|----------|
| Single command: `clawcode sync set-authoritative openclaw --revert-cutover` | Flag revert + final drain + resume. | ✓ |
| Manual runbook | No dedicated command; operator edits configs + runs rsync. | |

**User's choice:** Single command with final drain

---

## Claude's Discretion

Captured in CONTEXT.md §"Claude's Discretion". Includes:
- sync.jsonl schema
- rsync filter file syntax
- SSH key generation / installation runbook steps
- Final `clawcode sync` subcommand shape
- Log rotation
- /clawcode-sync-status depth (last-run vs 24h summary)

## Deferred Ideas

Captured in CONTEXT.md §"Deferred Ideas". Includes:
- Sub-10s inotify-triggered propagation (Phase 92 follow-up)
- Fleet-wide rollout
- Bidirectional live sync (explicitly rejected)
- SQLite replication at DB level
- Live-tail continuous translator
- Discord button conflict resolution
- OpenClaw gateway state sync
- rsync compression/encryption tuning
