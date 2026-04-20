# Phase 78 — Deferred Items

Tracks non-critical follow-ups discovered during Plan 78-01 execution but kept
out of scope to preserve plan boundaries.

## 78-01 Deferrals

### 1. `storeSoulMemory` still workspace-hardcoded

**File:** `src/manager/session-memory.ts` (lines 217-243)
**Current behavior:** `storeSoulMemory` reads `join(config.workspace, "SOUL.md")`
directly — does NOT honor `config.soulFile`.

**Why deferred:** `storeSoulMemory` inserts SOUL into the per-agent memory
store as a high-importance entry tagged `["soul", "identity"]`. Migrated
agents (Phase 79) will have SOUL.md copied into their workspace, so this path
works for them. The `soulFile` pointer at a hand-edited external path is a
migration edge case, not the common path.

**Mirror change required later:** Apply the same 3-branch precedence
(`soulFile -> workspace/SOUL.md -> inline soul`) to `storeSoulMemory`. This
should happen in Phase 78 Plan 02 or 03 once the writer is in place, or
in a dedicated follow-up plan.

**Impact if skipped:** Agents that use `soulFile:` pointing at an external
path will get their SOUL embedded from `workspace/SOUL.md` (if present) or
not at all. Functional, but asymmetric with the session-config read path.

### 2. Differ classification — hot-reloadability of soulFile/identityFile

**File:** `src/config/types.ts` + `src/config/differ.ts`
**Current behavior:** `agents.*.soulFile` and `agents.*.identityFile` are
NOT in `RELOADABLE_FIELDS` and NOT in `NON_RELOADABLE_FIELDS`. The classifier
defaults to `false` (non-reloadable) for anything not explicitly reloadable,
so a YAML edit to a `soulFile:` value triggers a "requires restart" warning.

**Why deferred:** Plan 01 verification explicitly states "No changes to
differ.ts / NON_RELOADABLE_FIELDS". The CONTEXT.md aspiration ("Mark as
reloadable: true") is meaningful only after the content-reload path is
exercised by the yaml-writer (Plan 03).

**Follow-up:** Add `"agents.*.soulFile"` and `"agents.*.identityFile"` to
`RELOADABLE_FIELDS` in Plan 02 or 03. No new code path needed — content is
re-read lazily at next session boot; no DB connection to reopen.

**Impact if skipped:** Operators editing `clawcode.yaml` to swap soulFile
paths will be told to restart the daemon. Semantically correct but slightly
heavier than strictly required.
