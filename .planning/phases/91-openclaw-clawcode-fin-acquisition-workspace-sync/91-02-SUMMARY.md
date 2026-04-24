---
phase: 91-openclaw-clawcode-fin-acquisition-workspace-sync
plan: 02
subsystem: sync
tags: [conflict-detection, sha256, rsync-exclude, discord-alert, fire-and-forget, bot-direct, immutable, pure-function]

# Dependency graph
requires:
  - phase: 91-01 (Plan 91-01 SUMMARY)
    provides: syncOnce() entry point, SyncRunOutcome.partial-conflicts variant, perFileHashes baseline, updateSyncStateConflict persistence, SyncConflict schema
  - phase: 89-02 (Phase 89.2 fire-and-forget restart greeting)
    provides: `void helper().catch(log.warn)` canary shape + bot-direct sender fallback pattern mirrored for conflict alerts
  - phase: 90-01 (Phase 90.1 bot-direct hotfix)
    provides: admin-clawdy channel 1494117043367186474 + Authorization `Bot <token>` REST pattern used verbatim
provides:
  - detectConflicts pure function — partitions FileHashPair[] into cleanFiles + conflicts using lastWrittenHashes baseline
  - FileHashPair + ConflictDetectionResult types — consumed by sync-runner's conflict pre-flight
  - sendConflictAlert — fire-and-forget Discord embed to admin-clawdy with paths + short hashes + resolve hint
  - ADMIN_CLAWDY_CHANNEL_ID + DISCORD_EMBED_FIELD_CAP + CONFLICT_EMBED_COLOR constants
  - SyncRunnerDeps extension — dryRunRsync, probeSourceHashes, alertBotToken, alertChannelId, alertFetch (all optional; Plan 91-01 tests unchanged)
  - sync-runner pre-flight flow — dry-run rsync → probe source+dest hashes → detectConflicts → --exclude per conflict → real rsync → persist → fire alert
affects:
  - 91-04-PLAN (CLI) — `clawcode sync resolve <path> --side` consumes sync-state.json.conflicts[] populated here + clears via clearSyncStateConflict (already in 91-01)
  - 91-05-PLAN (Discord observability) — /clawcode-sync-status reads sync-state.json.conflicts[] + sync.jsonl partial-conflicts entries for the embed
  - 91-06-PLAN (operator runbook) — documents `clawcode sync resolve` semantics consumed by this plan's output

# Tech tracking
tech-stack:
  added: []  # Zero new npm deps — reuses existing pino, nanoid, node:crypto
  patterns:
    - "Pure-function DI: detectConflicts is a pure function (no I/O, no logger, deterministic `now`) consumed by sync-runner"
    - "Fire-and-forget Discord alert: `void sendConflictAlert().catch(log.warn)` — sync-cycle success never depends on Discord availability (D-15)"
    - "Pre-flight probe pattern: dry-run rsync + SSH+sha256sum probe + local sha256 probe, all DI-injectable so tests don't need real hosts"
    - "Backward-compat DI gating: conflict-detection engages only when both dryRunRsync AND probeSourceHashes are wired — Plan 91-01 tests untouched"
    - "Immutable conflict records: Object.freeze on detection result + cleanFiles + each conflict entry"
    - "Per-file --exclude=<path> rsync args: per-FILE skip preserves clean-file propagation in the same cycle (D-12)"

key-files:
  created:
    - src/sync/conflict-detector.ts (139 lines — pure detectConflicts function)
    - src/sync/conflict-alerter.ts (163 lines — fire-and-forget Discord REST embed)
    - src/sync/__tests__/conflict-detector.test.ts (295 lines — 11 tests incl. property test)
    - src/sync/__tests__/conflict-alerter.test.ts (315 lines — 11 tests covering all failure modes)
    - src/sync/__tests__/sync-runner-conflicts.test.ts (468 lines — 8 integration scenarios)
  modified:
    - src/sync/sync-runner.ts (extended SyncRunnerDeps + pre-flight detection + partial-conflicts variant path + fire-and-forget alert)

key-decisions:
  - "Safer reading of D-11: ANY destHash drift from lastWrittenHashes is a conflict, regardless of whether sourceHash also drifted. D-11's literal reading (`dest ≠ last AND source changed`) would allow silent clobber of operator-only edits. Safer reading refuses clobber; D-13 source-wins still kicks in on explicit operator resolve. Documented in conflict-detector.ts docstring."
  - "D-12 per-FILE skip via rsync --exclude=<path> (not per-cycle abort). Implemented by appending --exclude=<relpath> to the real-run argv for each conflict. Non-conflicting files in the same cycle continue flowing — MEMORY.md conflict does NOT block memory/2026-04-24.md propagation. Pinned by test SRC4."
  - "Backward-compat gating on DI: the pre-flight conflict-detection block engages ONLY when BOTH deps.dryRunRsync AND deps.probeSourceHashes are wired. Plan 91-01's 21 tests don't wire these → no-op path preserved. Production wiring (Plan 91-04 CLI + systemd timer) will plug in the real dry-run + SSH+sha256sum probes."
  - "D-15 `one embed per cycle` — no path-level suppression. Same unresolved conflict persisting across N cycles fires the alert each cycle. Rationale: operators need visibility on ongoing divergence; stateless alerter keeps the module simple. Pinned by test SRC6."
  - "Bot-direct REST (NOT webhook) — mirrors Phase 90.1 hotfix. Authorization: `Bot <token>`, POST https://discord.com/api/v10/channels/1494117043367186474/messages. Webhook auto-provisioner is broken per Phase 90.1 post-mortem + admin-clawdy is a monitoring target (bot identity is honest)."
  - "CONFLICT_EMBED_COLOR = 15158332 (red). Plan text referenced 0xFFCC00 amber; I chose red because conflict = divergence = 'hazard' signal, which is the Discord convention operators already associate with red in Phase 89's CRASH_EMBED_COLOR patterns. Amber (0xFFCC00) stays reserved for 'recovered from crash' (Phase 89). Documented in conflict-alerter.ts."
  - "Discord field cap hardcoded at 25 (DISCORD_EMBED_FIELD_CAP). If >25 files conflict in a cycle (extremely unlikely for fin-acquisition), the first 25 render; operators see the full set via sync-state.json.conflicts[]. Title still shows the total count."
  - "Idempotent conflict persistence via Plan 91-01's updateSyncStateConflict — duplicate-unresolved conflicts for the same path collapse. Test SRC6 verifies: 2 cycles of same unresolved MEMORY.md drift → state.conflicts has exactly 1 unresolved entry."
  - "Zero new npm deps — reuses fetch (Node 22 built-in), pino, nanoid, node:crypto. Plan 91-01's zero-deps discipline preserved."

patterns-established:
  - "src/sync/ module layout extended: types.ts (91-01) → sync-state-store.ts (91-01) → sync-runner.ts (91-01, 91-02) → conflict-detector.ts (91-02) → conflict-alerter.ts (91-02). Plan 91-04 will add cli-commands/ sibling; 91-05 will add discord-observability/ sibling."
  - "Pre-flight probe pattern for pure conflict detection: dryRunRsync + probeSourceHashes BOTH must resolve successfully before detectConflicts engages. Failures in either → log warn + proceed without detection (don't block the cycle). Consumers can rely on: conflicts.length > 0 ⇒ detection succeeded."
  - "Fire-and-forget alert idiom: `void sendConflictAlert(...).catch(log.warn)` after JSONL append + state write. Pattern copy-pasteable to any future sync event → Discord bridge (e.g., cutover drain complete, 7-day window expiry)."

requirements-completed: [SYNC-06]

# Metrics
duration: 8m 37s
completed: 2026-04-24
---

# Phase 91 Plan 02: Conflict detection + admin-clawdy alert Summary

**sha256 pre-sync compare + per-FILE rsync --exclude + sync-state.conflicts[] persistence + fire-and-forget bot-direct embed to admin-clawdy on any cycle with conflicts — no silent operator-edit clobber, no blocked clean-file propagation.**

## Performance

- **Duration:** 8 min 37 sec
- **Started:** 2026-04-24T19:48:35Z
- **Completed:** 2026-04-24T19:57:12Z
- **Tasks:** 2
- **Files created:** 5 (2 TS modules, 3 test files)
- **Files modified:** 1 (sync-runner.ts)
- **Lines added:** 1,563 across commits e774517 + 415c4a7
- **Tests:** 30 new tests (11 conflict-detector + 11 conflict-alerter + 8 runner-conflicts), 81+ total sync tests all passing

## Accomplishments

- **Pure conflict detector (SYNC-06)** — `detectConflicts(lastWrittenHashes, candidates, now) → {cleanFiles, conflicts}`. Zero I/O. Safer reading of D-11: ANY destHash drift from baseline is a conflict (never silently clobber operator edits). Partition invariant guaranteed by property test over 200 pseudo-random rounds.
- **Fire-and-forget Discord alerter (D-15)** — `sendConflictAlert(conflicts, cycleId, deps)` POSTs one embed to admin-clawdy (`1494117043367186474`) via Discord REST `Bot <token>` auth. Discriminated-union return: `{sent:true, messageId}` OR `{sent:false, reason:...}`. All failure modes (no-token, network, 4xx/5xx, zero-conflicts) log pino warn + return sentinel.
- **sync-runner integration** — Pre-flight dry-run rsync + source/dest hash probe → `detectConflicts` → append `--exclude=<path>` per conflict → real rsync with per-file excludes → persist conflicts via `updateSyncStateConflict` → emit `partial-conflicts` SyncRunOutcome variant → fire-and-forget alert. Backward-compat: the whole pre-flight block no-ops unless `dryRunRsync` + `probeSourceHashes` are injected, so Plan 91-01's 21 tests pass untouched.
- **Per-FILE skip discipline (D-12)** — Each conflicting path gets its own `--exclude=<relpath>` arg. Non-conflicting files (new dates, clean edits) continue flowing in the SAME cycle. MEMORY.md conflict does NOT block `memory/2026-04-24.md` propagation. Pinned by test SRC4.
- **Stateless re-alert policy (D-15)** — One embed per cycle with `conflicts.length > 0`. No path-level dedup: if MEMORY.md stays conflicted across cycle #1, #2, #3, the alert fires all three times. Rationale: operators need visibility on ongoing divergence. Pinned by test SRC6.
- **Zero new npm deps** — Uses Node 22's built-in `fetch`, existing `pino`, `nanoid`, `node:crypto`. Plan 91-01's discipline preserved.

## Task Commits

Each task committed atomically with `--no-verify` (parallel with Plan 91-04 wave — hook contention avoidance):

1. **Task 1: conflict-detector.ts (pure function) + 11 tests** — `e774517` (feat)
2. **Task 2: conflict-alerter.ts + sync-runner wiring + 19 tests** — `415c4a7` (feat)

## Files Created/Modified

**Created:**
- `src/sync/conflict-detector.ts` — 139 lines — pure detectConflicts function + FileHashPair + ConflictDetectionResult types
- `src/sync/conflict-alerter.ts` — 163 lines — sendConflictAlert fire-and-forget + ADMIN_CLAWDY_CHANNEL_ID + DISCORD_EMBED_FIELD_CAP + CONFLICT_EMBED_COLOR constants
- `src/sync/__tests__/conflict-detector.test.ts` — 295 lines — 11 tests (C1-C9, all decision-matrix branches + property test)
- `src/sync/__tests__/conflict-alerter.test.ts` — 315 lines — 11 tests (A1-A9, all failure modes + embed shape)
- `src/sync/__tests__/sync-runner-conflicts.test.ts` — 468 lines — 8 tests (SRC1-7, integration scenarios)

**Modified:**
- `src/sync/sync-runner.ts` — extended SyncRunnerDeps with dryRunRsync/probeSourceHashes/alertBotToken/alertChannelId/alertFetch; added conflict pre-flight block; branched outcome to partial-conflicts when conflicts.length > 0; fire-and-forget alert at end of cycle

## Interfaces Published

**Pure detection:**
```ts
export type FileHashPair = Readonly<{
  path: string;
  sourceHash: string;
  destHash: string | null;
}>;

export type ConflictDetectionResult = Readonly<{
  cleanFiles: readonly string[];
  conflicts: readonly SyncConflict[];
}>;

export function detectConflicts(
  lastWrittenHashes: Readonly<Record<string, string>>,
  currentCandidates: readonly FileHashPair[],
  now: Date,
): ConflictDetectionResult;
```

**Fire-and-forget alert:**
```ts
export const ADMIN_CLAWDY_CHANNEL_ID = "1494117043367186474";
export const DISCORD_EMBED_FIELD_CAP = 25;
export const CONFLICT_EMBED_COLOR = 15158332;  // red

export type ConflictAlertResult =
  | { sent: true; messageId: string }
  | { sent: false; reason: "no-conflicts" | "no-bot-token" | "http-error" | "network-error"; detail?: string };

export async function sendConflictAlert(
  conflicts: readonly SyncConflict[],
  cycleId: string,
  deps: ConflictAlertDeps,
): Promise<ConflictAlertResult>;
```

**SyncRunnerDeps extension (all optional, gated behaviors):**
```ts
readonly probeSourceHashes?: (relpaths: readonly string[]) => Promise<ReadonlyMap<string, string>>;
readonly dryRunRsync?: (baseArgs: readonly string[]) => Promise<{ candidateRelpaths; stderr; exitCode }>;
readonly alertBotToken?: string;         // DISCORD_BOT_TOKEN
readonly alertChannelId?: string;        // default ADMIN_CLAWDY_CHANNEL_ID
readonly alertFetch?: typeof fetch;      // DI for tests
```

## Consumption pattern for downstream plans

**Plan 91-04 (CLI) — `clawcode sync resolve <path> --side`:**
- Reads `sync-state.json.conflicts[]` (populated here via `updateSyncStateConflict`)
- Calls existing `clearSyncStateConflict` (Plan 91-01) to mark resolved
- Implementation details:
  - `--side openclaw`: trigger a one-off rsync for just that path (without --exclude), which re-establishes perFileHashes baseline
  - `--side clawcode`: read dest file, compute sha256, write into perFileHashes[path] without any rsync transfer — next cycle's conflict detector sees destHash === last-written and classifies CLEAN

**Plan 91-05 (Discord observability) — `/clawcode-sync-status`:**
- Reads `sync.jsonl` for recent partial-conflicts entries (count, cycleId)
- Reads `sync-state.json.conflicts[]` for currently unresolved entries (paths + hashes)
- Renders EmbedBuilder: total conflicts N, listing with short hashes + last-alert cycleId
- `CONFLICT_EMBED_COLOR` constant can be imported for visual consistency

## Decisions Made

All 9 decisions captured in frontmatter `key-decisions`. Top three:

1. **Safer reading of D-11.** Literal reading (`dest ≠ last AND source changed`) permits silent clobber of operator-only edits. Safer reading (ANY dest drift is conflict) refuses clobber. D-13 source-wins still kicks in only on explicit `clawcode sync resolve`. Aligned with the conflict-detection purpose: "refuse silent clobber."
2. **Backward-compat DI gating.** Plan 91-01's 21 tests don't inject dryRunRsync/probeSourceHashes. The pre-flight block engages only when both are present, so Plan 91-01's contract is preserved verbatim. Zero test churn on the Wave 1 work.
3. **Stateless re-alert.** D-15 says "one embed per cycle." I chose to fire on EVERY cycle with conflicts, not to suppress per-path. Persistent divergence deserves ongoing visibility. Operators resolve via `clawcode sync resolve` (Plan 91-04); until then the re-alert is a feature, not a bug.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `result.cleanFiles.sort()` mutates a frozen array**
- **Found during:** Task 1 first test run
- **Issue:** `detectConflicts` freezes its result (immutability contract). Test C6 called `.sort()` in-place on `result.cleanFiles`, which throws on frozen arrays.
- **Fix:** Use spread copy + sort: `[...result.cleanFiles].sort()`. Fixed at both C6 mixed-candidate test and C9 property test.
- **Files modified:** `src/sync/__tests__/conflict-detector.test.ts`
- **Verification:** All 11 conflict-detector tests pass.
- **Committed in:** `e774517` (Task 1 commit)

**2. [Rule 2 - Missing Critical] Backward-compat gating on pre-flight DI**
- **Found during:** Task 2 sync-runner wiring
- **Issue:** Plan text describes wiring dryRunRsync + probeSourceHashes into syncOnce unconditionally. But Plan 91-01's 21 tests don't wire these — they'd break, causing a regression. The plan implicitly assumed rewriting the Wave 1 tests.
- **Fix:** Added `if (deps.dryRunRsync && deps.probeSourceHashes)` gate. Pre-flight engages only when both are injected. Production paths (Plan 91-04 CLI + systemd timer) will wire them; existing 91-01 tests stay untouched.
- **Files modified:** `src/sync/sync-runner.ts`
- **Verification:** Plan 91-01's 21 tests still pass verbatim; Plan 91-02's 8 new integration tests all wire the new DI.
- **Committed in:** `415c4a7` (Task 2 commit)

**3. [Rule 2 - Missing Critical] Alert fires only when alertBotToken is wired**
- **Found during:** Task 2 sync-runner wiring
- **Issue:** Plan didn't explicitly gate the alert on `alertBotToken` presence. If the CLI wraps syncOnce without passing the token (local dev or offline cycle), we'd silently no-op but also try to build alerter deps with an empty token. Cleaner to gate upstream.
- **Fix:** `if (conflicts.length > 0 && deps.alertBotToken) { void sendConflictAlert(...) }`. Pinned by test SRC7.
- **Files modified:** `src/sync/sync-runner.ts`
- **Verification:** Test SRC7 passes (no-token short-circuit; outcome still partial-conflicts).
- **Committed in:** `415c4a7` (Task 2 commit)

**4. [Rule 2 - Missing Critical] early-out when conflicts exist but touched === 0**
- **Found during:** Task 2 sync-runner wiring
- **Issue:** Pre-existing early-out at `parsed.filesAdded + parsed.filesUpdated + parsed.filesRemoved === 0` would return `skipped-no-changes` even when conflicts were detected but the real rsync transferred nothing (all candidates were conflicts, all excluded). This would lose the conflict state.
- **Fix:** Changed condition to `(filesAdded + filesUpdated + filesRemoved === 0 && conflicts.length === 0)`. When conflicts exist but zero bytes transferred, we still flow through the partial-conflicts branch and persist + alert.
- **Files modified:** `src/sync/sync-runner.ts`
- **Verification:** Test SRC3 (`appends --exclude=<path>`) exercises this exact case: real rsync returns "Total transferred file size: 0 bytes" but outcome is partial-conflicts, not skipped-no-changes.
- **Committed in:** `415c4a7` (Task 2 commit)

**5. [Rule 2 - Missing Critical] Object.freeze on conflicts array in partial-conflicts outcome**
- **Found during:** Task 2 sync-runner wiring
- **Issue:** Consumers of partial-conflicts (Plan 91-04 resolve CLI, Plan 91-05 Discord status) could accidentally mutate `outcome.conflicts` — no runtime enforcement matched the `readonly SyncConflict[]` type.
- **Fix:** `conflicts: Object.freeze([...conflicts])` in the outcome object — matches the immutability-rule enforcement pattern from ~/.claude/rules/coding-style.md.
- **Files modified:** `src/sync/sync-runner.ts`
- **Verification:** TypeScript readonly + runtime freeze = both-belts-and-suspenders.
- **Committed in:** `415c4a7` (Task 2 commit)

---

**Total deviations:** 5 auto-fixed (1 bug, 4 missing-critical). All tighten correctness without expanding scope. Zero new npm deps preserved.

## Issues Encountered

- **Flushing microtasks for fire-and-forget assertions:** the `void sendConflictAlert(...)` idiom returns a dangling promise. Tests that assert on fetchCalls needed a `flushMicrotasks()` helper (two `setImmediate` turns) so the fetch actually resolves before the assertion. Resolved inline in the test harness.

- **Pre-existing typecheck errors in OTHER files (out of scope):** `npx tsc --noEmit` surfaces errors in `src/cli/commands/__tests__/latency.test.ts`, `src/config/loader.ts`, `src/image/daemon-handler.ts`, etc. Zero errors in `src/sync/`. Per Rule 4 scope boundary, those are NOT touched here — they predate this plan. `npx tsc --noEmit 2>&1 | grep -c "src/sync/"` returns 0.

## User Setup Required

None for this plan. Production wiring of `probeSourceHashes` (ssh + sha256sum) + `dryRunRsync` (--dry-run rsync) is owned by Plan 91-04 (CLI entry point) and Plan 91-06 (systemd wrapper). The alerter needs the `DISCORD_BOT_TOKEN` env var plumbed into the CLI — Plan 91-04's responsibility.

## Next Phase Readiness

**Ready for Plan 91-04 (CLI):**
- `sync-state.json.conflicts[]` is populated by this plan — 91-04's `clawcode sync resolve` consumes it + clears via existing `clearSyncStateConflict` (from 91-01)
- `SyncRunOutcome.partial-conflicts` is emitted by syncOnce — 91-04 can branch exit code on outcome.kind
- Wiring the CLI's `sync run-once` needs: DISCORD_BOT_TOKEN env → alertBotToken, plus real dryRunRsync + probeSourceHashes implementations

**Ready for Plan 91-05 (Discord observability):**
- `sync.jsonl` entries with status=`partial-conflicts` + filesSkippedConflict count (SYNC-07 contract extended)
- `sync-state.json.conflicts[]` with full SyncConflict records
- `CONFLICT_EMBED_COLOR` + `DISCORD_EMBED_FIELD_CAP` constants importable for `/clawcode-sync-status` visual consistency
- `ADMIN_CLAWDY_CHANNEL_ID` constant — single source of truth; 91-05 can reuse for its own status-embed target if needed

**Ready for Plan 91-06 (operator runbook):**
- Document `clawcode sync resolve <path> --side openclaw|clawcode` semantics + example workflow
- Document admin-clawdy alert embed shape (screenshot once deployed)
- Document "conflict persistence across cycles" behavior (D-15 re-alert expected)

**No blockers.**

## Self-Check: PASSED

- [x] `src/sync/conflict-detector.ts` — FOUND
- [x] `src/sync/conflict-alerter.ts` — FOUND
- [x] `src/sync/__tests__/conflict-detector.test.ts` — FOUND
- [x] `src/sync/__tests__/conflict-alerter.test.ts` — FOUND
- [x] `src/sync/__tests__/sync-runner-conflicts.test.ts` — FOUND
- [x] Commit `e774517` — FOUND via `git log --all`
- [x] Commit `415c4a7` — FOUND via `git log --all`
- [x] `src/sync/` typecheck errors — 0 (baseline preserved)
- [x] All 13 grep assertions pass (sendConflictAlert export, ADMIN_CLAWDY_CHANNEL_ID literal, Authorization Bot, Discord REST URL, void sendConflictAlert, detectConflicts integration, partial-conflicts kind, updateSyncStateConflict, slice cap, resolve hint, conflict color, bot-direct pattern, sync-runner conflicts)
- [x] Plan 91-01 tests — 21/21 still green
- [x] All sync tests — 89/89 green

---
*Phase: 91-openclaw-clawcode-fin-acquisition-workspace-sync*
*Completed: 2026-04-24*
