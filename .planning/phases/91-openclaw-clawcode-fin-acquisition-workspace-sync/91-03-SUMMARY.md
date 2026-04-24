---
gsd_summary_version: 1.0
phase: 91-openclaw-clawcode-fin-acquisition-workspace-sync
plan: "03"
subsystem: sync/translator
tags: [openclaw-cutover, session-jsonl, idempotent-import, systemd-timer, conversation-store]
requirements: [SYNC-04]
wave: 1
depends_on: []

dependency_graph:
  requires:
    - "Phase 80 memory-translator sha256Hex + origin_id pattern (reused for turn origin IDs)"
    - "Phase 83 effort-state-store atomic temp+rename writer (verbatim pattern for translator-cursor-store)"
    - "Phase 64 ConversationStore + UNIQUE(session_id, turn_index, role) index (idx_turns_session_order)"
    - "Plan 91-01 sync-state-store (parallel Wave 1 sibling — no shared files; co-exists cleanly)"
  provides:
    - "translateAllSessions({sessionsDir, conversationStore, cursorPath, agentName, log}) — pure-function DI translator entrypoint"
    - "computeTurnOriginId(sessionId, turnIndex) → openclaw-session-<sha256-16> (D-09 trace identifier)"
    - "computeClawcodeSessionId(openclawSessionId) → openclaw-<sha256-20> (deterministic target session row id)"
    - "extractTextContent(content) → D-08 text-only filter (drops tool_use/tool_result/thinking/custom blocks)"
    - "TranslatorRunOutcome counts {sessionsScanned, sessionsSkippedMidWrite, sessionsSkippedParseError, turnsInserted, turnsSkippedDuplicate, turnsSkippedNonText, durationMs}"
    - "DEFAULT_TRANSLATOR_CURSOR_PATH = ~/.clawcode/manager/conversation-translator-cursor.json"
    - "Hourly systemd user timer (clawcode-translator.timer) with OnBootSec=10min + OnUnitActiveSec=1h"
    - "ConversationStore.getDatabase() accessor (added; matches MemoryStore.getDatabase())"
  affects:
    - "Plan 91-04 CLI: will register `clawcode sync translate-sessions --agent <name>` subcommand to invoke translateAllSessions; this plan leaves the CLI stub unimplemented intentionally"
    - "Plan 91-05 observability: TranslatorRunOutcome feeds the hourly translator.jsonl observability line"
    - "ClawCode resume-brief (Phase 67 SESS-03): imported session rows status='ended' with real started_at/ended_at from jsonl timestamps → gap-check works normally"

tech_stack:
  added: []
  patterns:
    - "Pure-function DI with Deps struct (Phase 85 TranslatorDeps blueprint)"
    - "Discriminated outcome counter shape (TranslatorRunOutcome) — one line per outcome field"
    - "Atomic temp+rename JSON persistence (effort-state-store parity)"
    - "INSERT OR IGNORE against existing UNIQUE index as the idempotency gate (no schema change required)"
    - "Never-throw run contract — all failure modes land in counters + warn log, not exceptions"

key_files:
  created:
    - "src/sync/translator-cursor-store.ts"
    - "src/sync/__tests__/translator-cursor-store.test.ts"
    - "src/sync/conversation-turn-translator.ts"
    - "src/sync/__tests__/conversation-turn-translator.test.ts"
    - "scripts/sync/clawcode-translator.sh"
    - "scripts/systemd/clawcode-translator.service"
    - "scripts/systemd/clawcode-translator.timer"
  modified:
    - "src/memory/conversation-store.ts"  # added getDatabase() accessor (Rule 3 — unblocking)

decisions:
  - "Idempotency via existing UNIQUE(session_id, turn_index, role) — NOT a new origin_id column. conversation_turns lacks the origin_id UNIQUE pattern memories has; a schema migration would be architectural (Rule 4). The existing composite UNIQUE is a natural idempotency gate, so translator uses raw-SQL INSERT OR IGNORE via db.prepare() through a new ConversationStore.getDatabase() accessor."
  - "origin_id shape preserved (computeTurnOriginId returns openclaw-session-<sha256-16>) but STORED in the existing `origin` TEXT column rather than a dedicated origin_id UNIQUE column — keeps human-traceability without a migration."
  - "Session row shape: status='ended' on import (not 'active') since historical OpenClaw sessions are by definition terminated. Avoids polluting Phase 67 SESS-03 gap-check with stray 'active' rows. started_at/ended_at derived from jsonl event timestamps where available, falling back to file mtime."
  - "is_trusted_channel=1 on imported turns — OpenClaw pre-cutover sessions are the authoritative source; post-cutover live turns still flow through SEC-01 untrusted filtering normally."
  - "Remote→local via rsync staging (bash wrapper) rather than SSH-read-per-file. Rationale: keeps translator pure and testable (sessionsDir is a local path DI'd in), reuses 91-01's SSH infra pattern for transport, no translator-side SSH concerns. Staging dir: ~/.clawcode/manager/openclaw-sessions-staging/ — write-once-per-hour, read-only from translator's perspective."
  - "Cursor persisted to a SEPARATE file from sync-state.json (91-01) per D-07 — no timer contention, independent failure scopes. Path: ~/.clawcode/manager/conversation-translator-cursor.json."
  - "Systemd unit is a DEDICATED service (clawcode-translator.service) with its own timer — not piggybacked on clawcode-sync.service from 91-01. Hourly cadence (OnUnitActiveSec=1h) distinct from the 5-min workspace rsync."
  - "Incremental cursor uses (byteOffset, lineCount, fileSize, mtime). Advance path: startLine=cursor.lineCount; pre-cursor message lines fast-forward turnIndex without re-insertion; lines at-or-after cursor are translated and contribute to UNIQUE-gated insert path."
  - "Never-throw contract: missing sessionsDir returns zeroed outcome + warn; individual file read failures counted in sessionsSkippedParseError; cursor write failure logged but doesn't abort run (next cycle re-scans and INSERT OR IGNORE keeps DB in good shape)."

metrics:
  duration_minutes: 18
  tasks_completed: 2
  tests_added: 22
  tests_passing: 22
  files_created: 7
  files_modified: 1
  lines_added: 1446
  completed: 2026-04-24
---

# Phase 91 Plan 03: Conversation-Turn Translator Summary

Hourly systemd-timed translator that ingests OpenClaw `sessions/*.jsonl` into ClawCode's `conversation_sessions` + `conversation_turns` tables with idempotent INSERT OR IGNORE semantics, mid-write protection, and text-only content filtering. Owns SYNC-04.

## What Shipped

### Core translator (`src/sync/conversation-turn-translator.ts`, 559 lines)

| Export | Purpose |
|--------|---------|
| `translateAllSessions(deps)` | Pure-function entrypoint; never throws; returns `TranslatorRunOutcome` counters |
| `computeTurnOriginId(sessionId, turnIndex)` | D-09 `openclaw-session-<sha256(sess:idx)-16>` |
| `computeClawcodeSessionId(openclawSessionId)` | Deterministic `openclaw-<sha256-20>` target session row id |
| `extractTextContent(content)` | D-08 text-only filter — drops `tool_use`, `tool_result`, `thinking`, unknown block types |
| `sha256Hex(s)` | UTF-8 sha256 hex helper (mirrors Phase 80 memory-translator) |
| `MID_WRITE_SKIP_MS = 60_000` | D-06 mid-write skip threshold |

### Cursor store (`src/sync/translator-cursor-store.ts`, 172 lines)

| Export | Purpose |
|--------|---------|
| `readTranslatorCursor(path, log?)` | Returns `DEFAULT_CURSOR` on every failure mode (ENOENT, parse, schema) |
| `writeTranslatorCursor(path, cursor, log?)` | Atomic `<path>.<rand>.tmp` + `rename()` |
| `withPerFileCursor(cursor, path, entry)` | Immutable update — returns new cursor object |
| `DEFAULT_TRANSLATOR_CURSOR_PATH` | `~/.clawcode/manager/conversation-translator-cursor.json` |
| `TranslatorCursorFile` zod-validated schema | `{version: 1, lastScanAt, perFileCursor: {[absPath]: {byteOffset, lineCount, fileSize, mtime}}}` |

### Systemd wrapper + units

- `scripts/sync/clawcode-translator.sh` — two-step flow: (1) rsync staging from OpenClaw host over SSH into `~/.clawcode/manager/openclaw-sessions-staging/`, (2) `node dist/cli/index.js sync translate-sessions --agent fin-acquisition`. flock-guarded against concurrent runs. Rsync failure exits 2 → `SuccessExitStatus=0 2` so it's not a unit-level failure; next hourly cycle retries.
- `scripts/systemd/clawcode-translator.service` — `Type=oneshot`, `TimeoutStartSec=900`.
- `scripts/systemd/clawcode-translator.timer` — `OnBootSec=10min`, `OnUnitActiveSec=1h`, `Persistent=false`.

### ConversationStore API addition

Added `ConversationStore.getDatabase(): DatabaseType` accessor (3 lines + comment block) — parallels the existing `MemoryStore.getDatabase()`. Unlocks the raw `INSERT OR IGNORE` idempotency pattern for historical imports without going through the nanoid-generated recordTurn path. 66 existing conversation-store tests still green.

**Why this and not an `origin_id` column migration?** Matches the plan's `<action>` guidance: "DO NOT modify ConversationStore schema (if origin_id UNIQUE not present, open a deferred-item note — but Phase 80 establishes this pattern is already in place for memory_store and conversation_turns; verify during implementation)". Verified: origin_id is only on `memories`, not `conversation_turns`. The existing `idx_turns_session_order UNIQUE(session_id, turn_index, role)` index provides identical idempotency semantics, so the translator leverages that and stores the openclaw-session-<hash> identifier in the existing `origin` TEXT column for human traceability.

## Consumption Pattern (Plan 91-04 CLI contract)

```ts
import { MemoryStore } from "../memory/store.js";
import { ConversationStore } from "../memory/conversation-store.js";
import {
  translateAllSessions,
  type TranslatorDeps,
} from "../sync/conversation-turn-translator.js";
import { DEFAULT_TRANSLATOR_CURSOR_PATH } from "../sync/translator-cursor-store.js";

const memStore = new MemoryStore(agentMemoryPath);
const convStore = new ConversationStore(memStore.getDatabase());

const deps: TranslatorDeps = {
  sessionsDir: `${process.env.HOME}/.clawcode/manager/openclaw-sessions-staging/`,
  conversationStore: convStore,
  cursorPath: DEFAULT_TRANSLATOR_CURSOR_PATH,
  agentName: "fin-acquisition",
  log,
};
const outcome = await translateAllSessions(deps);
log.info(outcome, "translator run complete");
memStore.close();
```

The CLI (Plan 91-04) is expected to register `clawcode sync translate-sessions --agent <name>` and emit the outcome to both stdout and `~/.clawcode/manager/translator.jsonl` (Plan 91-05 observability).

## Tests (22 total, all green)

### translator-cursor-store.test.ts (7 tests)

| # | Pins |
|---|------|
| CU1 | Missing file → `DEFAULT_CURSOR` silently (no warn on ENOENT) |
| CU2 | Write→read round-trip preserves cursor shape |
| CU3 | No lingering `.tmp` files after successful write |
| CU4 | Corrupt JSON → `DEFAULT_CURSOR` + warn |
| CU5 | Invalid schema (negative byteOffset) → `DEFAULT_CURSOR` + warn |
| CU6 | Concurrent writes → one winner lands intact (no partial corruption) |
| CU7 | `withPerFileCursor` is immutable (input unchanged) |

### conversation-turn-translator.test.ts (15 tests)

| # | Pins |
|---|------|
| CT1 | `computeTurnOriginId` deterministic + shaped `openclaw-session-[0-9a-f]{16}` |
| CT2 | `extractTextContent` string verbatim passthrough |
| CT3 | `extractTextContent` drops `tool_use`, keeps only text blocks (D-08) |
| CT4 | `extractTextContent` drops `thinking` + `tool_result` (D-08) |
| CT5 | File mtime within 60s → `sessionsSkippedMidWrite=1`, zero inserts (D-06) |
| CT6 | 3 user+assistant messages → `turnsInserted=3`, rows verified in DB via `getTurnsForSession` |
| CT7 | Full re-scan without cursor → UNIQUE gate → `turnsInserted=0`, `turnsSkippedDuplicate=2`, still 2 rows in DB |
| CT8 | Mixed event types (`model_change`, `thinking_level_change`, `custom`, system-role, tool_use-only) → 1 insert + 5 non-text counted |
| CT9 | Malformed JSONL mid-file → parse error counted, subsequent good lines still processed (D-10) |
| CT10 | Cursor persists `byteOffset`/`lineCount`/`fileSize`/`mtime` + `lastScanAt` |
| CT11 | Unchanged file on re-run → `sessionsScanned=0`, zero inserts, zero duplicates |
| CT12 | Incremental append (2 more lines) → translator processes only new lines, DB ends with 4 rows in order |
| CT13 | `origin` column stores `computeTurnOriginId(sessionId, turnIndex)` exactly |
| CT14 | Missing `sessionsDir` → zeroed outcome + warn logged, no throw |
| CT15 | `sha256Hex` 64-char hex stability |

## Deviations from Plan

### Rule 3 (auto-fix blocking issue)

**1. [Rule 3 — Blocking] Added `ConversationStore.getDatabase()` accessor**

- **Found during:** Task 2 initial run — tests failed with `TypeError: deps.conversationStore.getDatabase is not a function`.
- **Issue:** Plan's `tryInsertTurn` pseudocode assumed a `insertTurn(...)` method or raw db access on `ConversationStore`; neither existed. `recordTurn()` uses `nanoid()` id + non-idempotent `INSERT`, so it can't serve the translator's `INSERT OR IGNORE` need.
- **Fix:** Added a 6-line `getDatabase(): DatabaseType` accessor to `ConversationStore`, mirroring the existing `MemoryStore.getDatabase()` pattern. Translator uses it for raw `db.prepare("INSERT OR IGNORE INTO conversation_turns ...")` against the existing UNIQUE index. Non-invasive — other call sites unaffected.
- **Files modified:** `src/memory/conversation-store.ts`
- **Commit:** a0c3ef4
- **Verification:** 66 existing ConversationStore tests still green.

### Rule 2 (auto-add missing critical functionality)

**2. [Rule 2 — Correctness] Derived deterministic `conversation_sessions.id` (`computeClawcodeSessionId`)**

- **Found during:** Task 2 design. Plan didn't specify how to map an OpenClaw `sessionId` to a ClawCode `conversation_sessions.id`. Using `nanoid()` would mean every re-run creates a fresh session row (breaking idempotency at the session level — not just the turn level).
- **Fix:** Added `computeClawcodeSessionId(openclawSessionId) → "openclaw-" + sha256(sessionId).slice(0, 20)`. Used as the PK for `INSERT OR IGNORE INTO conversation_sessions`. Re-runs land in the same row.
- **Files modified:** `src/sync/conversation-turn-translator.ts` (new export + tests CT6/CT7/CT12/CT13 verify via the derived id)
- **Commit:** a0c3ef4

**3. [Rule 2 — Correctness] Status=`ended` + started_at/ended_at populated on import**

- **Found during:** Task 2 design. Plan didn't specify the session row shape; the naïve path would be status=`active`.
- **Issue:** Phase 67 SESS-03's `listRecentTerminatedSessions` gap-check excludes `status='active'` rows. If historical OpenClaw imports landed as `active`, they wouldn't contribute to the resume-brief gap timing. Worse, they'd look like dangling live sessions to operators.
- **Fix:** Translator inserts rows as `status='ended'` with `started_at` and `ended_at` both populated from jsonl event timestamps (or file mtime as fallback). Historical imports are by definition terminated conversations.
- **Files modified:** `src/sync/conversation-turn-translator.ts` (ensureSessionRow)

### Rule 2 — is_trusted_channel=1 on imports

- **Rationale documented in code:** OpenClaw pre-cutover is the authoritative agent memory; historical imports should be retrievable via `searchTurns()` without the SEC-01 untrusted-channel filter dropping them. Live post-cutover turns continue to flow through SEC-01 normally.

## Known Stubs

None — Plan 91-04 will register the CLI `clawcode sync translate-sessions --agent <name>` subcommand, and the wrapper script (`scripts/sync/clawcode-translator.sh`) is pre-wired to invoke it. The wrapper will emit "command not found" until Plan 91-04 lands, but this is explicitly the handoff point: the plan scope closes at "translator module + cursor + systemd timer + tests", NOT at "CLI command registered".

## Canonical Paths

- **Cursor file:** `~/.clawcode/manager/conversation-translator-cursor.json`
- **Staging dir:** `~/.clawcode/manager/openclaw-sessions-staging/` (written by wrapper script's rsync step)
- **Lock file:** `~/.clawcode/manager/translator.lock` (flock single-writer guard)
- **Systemd units:** `scripts/systemd/clawcode-translator.{service,timer}` — symlink into `/etc/systemd/user/` or `~/.config/systemd/user/` during deployment

## Commits

- 47c4442 — `feat(91-03): add translator-cursor-store for session-jsonl translator` (Task 1)
- a0c3ef4 — `feat(91-03): add conversation-turn translator + hourly systemd timer` (Task 2)

## Self-Check: PASSED

Verified post-write:

- [x] `src/sync/translator-cursor-store.ts` exists (172 lines)
- [x] `src/sync/conversation-turn-translator.ts` exists (559 lines)
- [x] `src/sync/__tests__/translator-cursor-store.test.ts` exists, 7 tests green
- [x] `src/sync/__tests__/conversation-turn-translator.test.ts` exists, 15 tests green
- [x] `scripts/sync/clawcode-translator.sh` exists, executable, invokes `sync translate-sessions`
- [x] `scripts/systemd/clawcode-translator.service` exists
- [x] `scripts/systemd/clawcode-translator.timer` exists with `OnUnitActiveSec=1h`
- [x] `src/memory/conversation-store.ts` modified with `getDatabase()` accessor
- [x] All acceptance-criteria greps pass (translateAllSessions, computeTurnOriginId, openclaw-session-, MID_WRITE_SKIP_MS=60_000, extractTextContent, role filter, timer cadence, CLI invocation)
- [x] Combined test run: 22/22 green (`npx vitest run src/sync/__tests__/conversation-turn-translator.test.ts src/sync/__tests__/translator-cursor-store.test.ts --reporter=dot`)
- [x] ConversationStore regression: 66/66 existing tests still green
- [x] `npx tsc --noEmit` — no new errors from Plan 91-03 files (pre-existing errors in task-manager.ts, triggers/engine.test.ts, etc. unchanged)
- [x] Commits 47c4442 + a0c3ef4 present in `git log --oneline --all`
