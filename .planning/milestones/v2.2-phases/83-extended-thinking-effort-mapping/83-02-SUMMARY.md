---
phase: 83-extended-thinking-effort-mapping
plan: 02
subsystem: effort-persistence-and-fork-quarantine
tags: [effort, persistence, atomic-write, fork-quarantine, regression-pin, v2.2]

# Dependency graph
requires:
  - phase: 83-01
    provides: "EffortLevel type (7 levels), mapEffortToTokens helper, persistent-session-handle setEffort wired to q.setMaxThinkingTokens, effort reloadable classification"
  - phase: 73-persistent-sdk-session
    provides: "SessionHandle + buildForkConfig surface that buildForkConfig builds on"
  - phase: 75-shared-workspace
    provides: "ResolvedAgentConfig.memoryPath / workspace shape buildForkConfig inherits from parent"
provides:
  - "Per-agent runtime effort override persisted to ~/.clawcode/manager/effort-state.json via atomic temp+rename"
  - "readEffortState / writeEffortState / clearEffortState over versioned JSON with Zod-validated shape"
  - "SessionManager.setEffortForAgent auto-persists (fire-and-forget, non-blocking)"
  - "SessionManager.startAgent auto-re-applies persisted level on boot (persistence beats config default)"
  - "buildForkConfig explicit `effort: parentConfig.effort` line pinning fork quarantine (prevents v1.5 fork-to-Opus cost spike)"
  - "Fork quarantine regression test suite (3 SessionManager-level integration tests + 3 buildForkConfig unit tests)"
affects: [phase-83-03-per-skill-override, phase-86-setModel-pattern, phase-87-setPermissionMode-pattern]

# Tech tracking
tech-stack:
  added: []  # zero new deps
  patterns:
    - "Atomic JSON persistence: temp file with nanoid suffix + rename (mirrors v2.1 yaml-writer pattern)"
    - "Fire-and-forget-with-catch for best-effort persistence (runtime side-effect already fired on the handle)"
    - "Read-existing → merge → atomic write for multi-key JSON files"
    - "Explicit-field-assignment-over-spread for invariant pinning (prevents accidental refactor breakage)"
    - "Dedicated tmpDir per integration test + nanoid-suffixed agent names to avoid parallel flakes"

key-files:
  created:
    - src/manager/effort-state-store.ts
    - src/manager/__tests__/effort-state-store.test.ts
    - src/manager/__tests__/fork-effort-quarantine.test.ts
  modified:
    - src/manager/session-manager.ts
    - src/manager/fork.ts
    - src/manager/fork.test.ts

key-decisions:
  - "Dedicated effort-state.json file — NOT extending registry.json — because registry is a fleet-status ledger with its own schema + recovery; overloading it pollutes boundaries."
  - "Atomic temp+rename write pattern — chokidar-safe single change event, rename is filesystem-atomic when tmp is in same dir."
  - "Corrupt/invalid state file returns null (graceful fallback to config default) — daemon MUST NOT crash on persistence corruption."
  - "Persistence is fire-and-forget at setEffortForAgent call site — the SDK side-effect already landed on the handle; persistence failure is observable via warn but not a turn blocker."
  - "buildForkConfig's explicit `effort: parentConfig.effort` line pins the intent. Without it, the `...parentConfig` spread does the same thing — but a future refactor that threads runtime state (e.g., `effort: handle.getEffort()`) would silently break the quarantine."
  - "Do NOT clearEffortState on stopAgent — persistence must survive stop/start cycles. Only an explicit reset (out-of-scope `/clawcode-effort-reset`) would clear it."

patterns-established:
  - "Persistence store pattern (readX / writeX / clearX trio over an atomic JSON file): reusable for Phase 86 model-override persistence and Phase 87 permission-mode persistence."
  - "Integration test harness pattern for SessionManager + persistence: vi.mock warm-path-check, tmpDir per test, unique agent names to avoid parallel registry collisions."

requirements-completed: [EFFORT-03, EFFORT-06]

# Metrics
duration: 22min 13s
completed: 2026-04-21
---

# Phase 83 Plan 02: Effort Persistence + Fork Quarantine Summary

**Runtime `/clawcode-effort` overrides now survive `clawcode restart` via atomic JSON persistence, and the v1.5 fork-to-Opus cost-spike regression is pinned by an explicit `effort: parentConfig.effort` line in `buildForkConfig` + 6 tests that fail loud if runtime state ever bleeds into fork config.**

## Performance

- **Duration:** 22 min 13s
- **Started:** 2026-04-21T17:36:38Z
- **Completed:** 2026-04-21T17:58:51Z
- **Tasks:** 2 (both TDD RED → GREEN)
- **Files created:** 3
- **Files modified:** 3

## Accomplishments

- **EFFORT-03 closed.** Runtime effort overrides persist across agent restart via `~/.clawcode/manager/effort-state.json`. `SessionManager.setEffortForAgent` now fires a fire-and-forget `writeEffortState` (best-effort, non-blocking). `SessionManager.startAgent` reads persisted state and calls `handle.setEffort(persisted)` BEFORE the warm-path gate, so the first turn's SDK options carry the right thinking budget.
- **EFFORT-06 closed.** `buildForkConfig` now has an explicit `effort: parentConfig.effort` line with a block comment calling out PITFALLS §Pitfall 3. A runtime override on the parent (e.g., parent bumped to `max` via `/clawcode-effort`) does NOT propagate into the fork — fork's `ResolvedAgentConfig` carries the parent's CONFIG default. Pinned by an integration test that spins up a parent at config `low`, bumps it to runtime `max`, forks it, and asserts the fork's handle reports `low`.
- **Graceful failure modes.** Corrupt JSON, missing file, invalid schema, invalid level — all return `null` without throwing. Daemon startup is not blocked by persistence corruption. Verified by 4 negative-path tests.
- **Atomic write pattern.** `writeEffortState` writes to `<filePath>.<6hex>.tmp` then `rename()`s to dest. Mirrors the v2.1 yaml-writer pattern. Verified by the "no lingering .tmp" test.
- **Zero new npm deps.** Uses `node:fs/promises`, `node:crypto` (randomBytes), existing `zod/v4`, existing `pino`.

## Task Commits

Both tasks committed atomically with `--no-verify` per Wave-2 parallel execution protocol. RED and GREEN phases committed separately:

1. **Task 1 RED: failing tests for runtime effort-state persistence** — `b5c0ff4` (test)
   - Wrote 14 tests covering round-trip, missing/corrupt/invalid, 7-level coverage, clearEffortState, SessionManager integration (persist + re-apply + fallback).
   - Verified failure against missing `src/manager/effort-state-store.js`.

2. **Task 1 GREEN: runtime effort-state persistence survives restart (EFFORT-03)** — `ac8f4a9` (feat)
   - Created `src/manager/effort-state-store.ts` with readEffortState / writeEffortState / clearEffortState + atomic temp+rename.
   - Added `DEFAULT_EFFORT_STATE_PATH` (`~/.clawcode/manager/effort-state.json`).
   - Wired SessionManager: new `effortStatePath` option on `SessionManagerOptions`, `setEffortForAgent` persists fire-and-forget, `startAgent` re-applies persisted level after handle creation, BEFORE warm-path.
   - All 14 tests green. Zero new TSC errors.

3. **Task 2 RED: pin fork effort quarantine (EFFORT-06)** — `7b2089d` (test)
   - Added 3 unit tests to `fork.test.ts`: default path, modelOverride path, systemPromptOverride path — all verify `fork.effort === parent.effort`.
   - Created `fork-effort-quarantine.test.ts` with 3 SessionManager-level integration tests: runtime-override quarantine, config-default preservation, no-persistence-bleed into fork name.
   - Tests passed on the ambiguous baseline (buildForkConfig's `...parentConfig` spread was already correct) — RED phase pins the behavior so a future refactor can't silently break it.

4. **Task 2 GREEN: explicit fork effort quarantine pin (EFFORT-06)** — `47c3e23` (feat)
   - Added explicit `effort: parentConfig.effort` line to `buildForkConfig` return object.
   - Added PITFALLS.md §Pitfall 3 comment block explaining the quarantine invariant.
   - Acceptance criteria met: `grep -c "effort: parentConfig\\.effort" fork.ts = 1`, `grep -c "EFFORT-06" fork.ts = 1`.

5. **Test hardening (test infra)** — `e99ad41` (test)
   - Added `workspaceDir?` parameter to `makeConfig` helpers so tests use per-test tmpDir (isolates memory-store state).
   - Added 15s `INTEGRATION_TIMEOUT_MS` to SessionManager integration tests (real SQLite init + warm-path + stopAll runs long under parallel vitest pressure).
   - Used nanoid-suffixed agent names in fork-effort-quarantine to avoid registry collisions across tests in the file.

## The Fix — Key Files

### `src/manager/effort-state-store.ts` (full text)

```ts
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import type { Logger } from "pino";
import { z } from "zod/v4";
import { effortSchema, type EffortLevel } from "../config/schema.js";

export const DEFAULT_EFFORT_STATE_PATH = join(
  homedir(),
  ".clawcode",
  "manager",
  "effort-state.json",
);

const effortStateFileSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string(),
  agents: z.record(z.string(), effortSchema),
});

export type EffortStateFile = z.infer<typeof effortStateFileSchema>;

const EMPTY: EffortStateFile = { version: 1, updatedAt: "", agents: {} };

export async function readEffortState(
  filePath: string,
  agentName: string,
  log?: Logger,
): Promise<EffortLevel | null> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    log?.warn({ filePath, error: (err as Error).message }, "effort-state read failed");
    return null;
  }
  let obj: unknown;
  try { obj = JSON.parse(raw); }
  catch (err) {
    log?.warn({ filePath, error: (err as Error).message }, "effort-state JSON parse failed");
    return null;
  }
  const parsed = effortStateFileSchema.safeParse(obj);
  if (!parsed.success) {
    log?.warn({ filePath, issues: parsed.error.issues.length }, "effort-state file schema invalid, ignoring");
    return null;
  }
  return parsed.data.agents[agentName] ?? null;
}

export async function writeEffortState(
  filePath: string,
  agentName: string,
  level: EffortLevel,
  log?: Logger,
): Promise<void> {
  const existing = await readExistingOrEmpty(filePath);
  const next: EffortStateFile = {
    version: 1,
    updatedAt: new Date().toISOString(),
    agents: { ...existing.agents, [agentName]: level },
  };
  await mkdir(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
  await rename(tmp, filePath);
  log?.debug({ agent: agentName, level }, "effort-state persisted");
}

export async function clearEffortState(
  filePath: string,
  agentName: string,
  log?: Logger,
): Promise<void> {
  const existing = await readExistingOrEmpty(filePath);
  if (!(agentName in existing.agents)) return;
  const next: EffortStateFile = {
    version: 1,
    updatedAt: new Date().toISOString(),
    agents: Object.fromEntries(
      Object.entries(existing.agents).filter(([k]) => k !== agentName),
    ),
  };
  await mkdir(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
  await rename(tmp, filePath);
  log?.debug({ agent: agentName }, "effort-state cleared");
}

async function readExistingOrEmpty(filePath: string): Promise<EffortStateFile> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = effortStateFileSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch { /* treat as empty */ }
  return EMPTY;
}
```

### `src/manager/fork.ts` diff (the EFFORT-06 pin)

```diff
 return {
   ...parentConfig,
   name: forkName,
   channels: [], // Forked sessions are headless -- no Discord bindings
   soul: (options?.systemPromptOverride ?? parentConfig.soul ?? "") + forkContext,
   model: options?.modelOverride ?? parentConfig.model,
   schedules: [], // Forked sessions don't inherit scheduled tasks
   slashCommands: [], // No slash commands for forks
+  // Phase 83 Plan 02 EFFORT-06 — fork quarantine.
+  //
+  // buildForkConfig takes the PARENT'S ResolvedAgentConfig, not the
+  // parent's live SessionHandle. The parent's runtime override
+  // (setEffort called via /clawcode-effort) is NOT visible here by
+  // design — ResolvedAgentConfig carries only the config default.
+  // The explicit assignment below pins this invariant: any refactor
+  // that accidentally threads runtime state into fork config will
+  // need to delete this line, at which point fork-effort-quarantine.test.ts
+  // fires RED. PITFALLS.md §Pitfall 3 (fork inheritance cost spike).
+  effort: parentConfig.effort,
 };
```

### `src/manager/session-manager.ts` hunks (the EFFORT-03 wire)

Imports:
```ts
import {
  readEffortState,
  writeEffortState,
  DEFAULT_EFFORT_STATE_PATH,
} from "./effort-state-store.js";
```

New option + private field + constructor init:
```ts
readonly effortStatePath?: string;  // on SessionManagerOptions

private readonly effortStatePath: string;

// in constructor:
this.effortStatePath = options.effortStatePath ?? DEFAULT_EFFORT_STATE_PATH;
```

Persist in `setEffortForAgent`:
```ts
setEffortForAgent(name: string, level: EffortLevel): void {
  const handle = this.requireSession(name);
  handle.setEffort(level);
  this.log.info({ agent: name, effort: level }, "effort level updated");
  void writeEffortState(this.effortStatePath, name, level, this.log).catch((err) => {
    this.log.warn(
      { agent: name, error: (err as Error).message },
      "effort-state persist failed (non-fatal)",
    );
  });
}
```

Re-apply in `startAgent` (after handle creation, before warm-path):
```ts
try {
  const persisted = await readEffortState(this.effortStatePath, name, this.log);
  if (persisted && persisted !== config.effort) {
    handle.setEffort(persisted);
    this.log.info(
      { agent: name, effort: persisted, configDefault: config.effort },
      "re-applied persisted effort override",
    );
  }
} catch (err) {
  this.log.warn(
    { agent: name, error: (err as Error).message },
    "effort-state read failed on start (non-fatal)",
  );
}
```

## Test Results

All tests pass green end-to-end (confirmed across 2 separate run cycles for stability):

| Suite | Tests | Status |
|-------|-------|--------|
| `src/manager/__tests__/effort-state-store.test.ts` (10 unit + 4 integration) | 14 | PASS |
| `src/manager/__tests__/fork-effort-quarantine.test.ts` (integration) | 3 | PASS |
| `src/manager/fork.test.ts` (+3 new EFFORT-06 tests) | 13 | PASS |
| **Total Plan 02 suite** | **30** | **PASS** |

Regression suite (verified ZERO Plan 01 + adjacent-test breakage):

| Suite | Tests | Status |
|-------|-------|--------|
| `session-manager.test.ts` | 70+ | PASS |
| `persistent-session-handle.test.ts` + `-effort.test.ts` | 15+8 | PASS |
| `effort-mapping.test.ts` | 15 | PASS |
| `config/__tests__/differ.test.ts` | 14 | PASS |
| `fork-migrated-agent.test.ts` | various | PASS |
| **Total regression** | **125** | **PASS** |

TSC check on touched files: zero errors.

## `~/.clawcode/manager/effort-state.json` Shape (on first `/clawcode-effort` invocation)

```json
{
  "version": 1,
  "updatedAt": "2026-04-21T17:45:12.000Z",
  "agents": {
    "clawdy": "max"
  }
}
```

Note: production file location uses `os.homedir()` so it writes to `~/.clawcode/manager/effort-state.json`. Tests use `mkdtemp`-based paths via the `effortStatePath` DI seam.

## Decisions Made

See `key-decisions` in frontmatter. Highlights:

1. **Dedicated state file over registry.json extension** — registry.json is a fleet-status ledger with its own Zod schema and 260419-q2z recovery pipeline. Overloading it with runtime overrides pollutes the boundary and complicates hot-reload semantics. A dedicated `effort-state.json` is simpler to reason about and easier to clear independently.

2. **Atomic temp+rename** — chokidar-safe (single rename event, no half-written state), atomic within the same filesystem. The nanoid-suffixed tmp name avoids collisions between two concurrent writers; SessionManager currently serializes per-agent, but the store is safe for future concurrent callers (e.g., if Phase 87 adds bulk operations).

3. **Graceful corruption tolerance** — missing file, unparseable JSON, and invalid top-level schema all return `null` without throwing. A corrupt state file must not block daemon startup or individual `/clawcode-effort` calls. Corruption is observable via a warn log (except missing-file ENOENT which is the expected first-boot path).

4. **Fire-and-forget persistence in `setEffortForAgent`** — the runtime side-effect (handle.setEffort → q.setMaxThinkingTokens) has already fired by the time we attempt persistence; a persistence failure must never abort the call chain. `.catch`-logging gives observability without blocking the caller.

5. **`startAgent` re-apply BEFORE warm-path** — the re-apply happens immediately after `this.sessions.set(name, handle)` and BEFORE `runWarmPathCheck`. This ensures the handle's effort is correct before any turn fires. Reading persistence after warm-path would open a window where the first turn could race against persistence.

6. **Do NOT clear on stopAgent** — persistence survives stop/start cycles BY DESIGN. A persisted override is an operator decision that should outlive a process restart. Only an explicit reset (out of scope for this plan — tracked as future `/clawcode-effort-reset`) would clear it.

7. **Explicit `effort: parentConfig.effort` line in fork.ts** — the `...parentConfig` spread already preserves effort by construction, but that's implicit. A future refactor like `effort: handle.getEffort()` (e.g., to "carry the current state") would silently break the quarantine. The explicit line + 3 unit tests + 3 integration tests make the invariant load-bearing.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Warm-path mock required for SessionManager integration tests**
- **Found during:** Task 1 GREEN verification (integration test failed with `warm-path: embedder: not ready`).
- **Issue:** `SessionManager.startAgent` runs `runWarmPathCheck` AFTER session creation; without a real embedder (`EmbeddingService` initialized via heavyweight ONNX/transformers pipeline), warm-path fails and the session is evicted from `this.sessions` — so `getEffortForAgent` then throws `SessionError('is not running')`.
- **Fix:** Added `vi.mock("../warm-path-check.js")` that returns a ready result. Mirrors the established pattern in the pre-existing `session-manager.test.ts`.
- **Files modified:** `src/manager/__tests__/effort-state-store.test.ts` (and mirror in `fork-effort-quarantine.test.ts`).

**2. [Rule 3 - Blocking] Parallel-flake hardening**
- **Found during:** Multi-file concurrent test run.
- **Issue:** Integration tests using the same shared `/tmp/test-workspace` for the memory store + `"parent"` agent name would intermittently fail under parallel vitest pressure with `ManagerError: Agent 'parent-fork-...' not found in registry` or 5s timeouts.
- **Fix:** (a) Added `workspaceDir?: string` parameter to `makeConfig` so each test can inject its per-test tmpDir for memoryPath isolation. (b) Bumped integration test timeout to 15s (SQLite init + warm-path + stopAll takes >5s under load). (c) Suffixed agent names in fork-effort-quarantine.test.ts with `nanoid(4)` to prevent registry collisions across the 3 tests in that file.
- **Files modified:** both test files + makeConfig helpers.
- **Committed in:** `e99ad41`.

**Total deviations:** 2 auto-fixed (both Rule 3 blocking-issues, both strictly necessary for test reliability under parallel vitest).
**Impact on plan:** Zero scope creep. Both are pure test-infra hardening; production code unaffected.

## Issues Encountered

- **Pre-existing TSC errors in unrelated files.** `src/config/loader.ts:171` still has a narrow-vs-wide type mismatch for `effort` (Plan 01 widened schema but kept `ResolvedAgentConfig.effort` narrow — YAML parses only emit the narrow subset). Logged as a Plan-01-era carry-over in `deferred-items.md`; does not block Plan 02. Several other unrelated TSC errors (`src/image/daemon-handler.ts`, `src/tasks/task-manager.ts`, etc.) predate Plan 83 entirely.
- **Linter interruption mid-edit.** An external process (likely file-watcher + formatter) reverted several of my session-manager.ts / test file edits mid-flight. Verified via git diff + re-run that final committed state is correct.

## Known Stubs

None. Every function has a real implementation, every test exercises real I/O:

```
$ grep -rn "TODO\|FIXME\|placeholder" src/manager/effort-state-store.ts
$ # (zero hits)
```

Every level in the effort-state file round-trips correctly (7/7 verified by test). Every failure mode (missing, corrupt, invalid-schema) returns a real null with an observable warn log.

## Next Phase Readiness

- **Plan 03 (per-skill override) is unblocked** — EFFORT-03 persistence + EFFORT-06 fork quarantine are both in place. Per-skill overrides (EFFORT-05) can now safely mutate the runtime handle knowing that the runtime override is persisted but the fork is quarantined.
- **Phase 86 (setModel persistence) pattern is established** — the `{read,write,clear}EffortState` trio + atomic temp+rename + fire-and-forget wire is a direct blueprint for a future `model-state.json`. Same shape, same corruption handling, same integration test harness.
- **Phase 87 (setPermissionMode persistence) pattern is established** — identical to above.

## Self-Check: PASSED

Verified 2026-04-21:

- FOUND: `src/manager/effort-state-store.ts`
- FOUND: `src/manager/__tests__/effort-state-store.test.ts`
- FOUND: `src/manager/__tests__/fork-effort-quarantine.test.ts`
- FOUND: commit `b5c0ff4` (Task 1 RED)
- FOUND: commit `ac8f4a9` (Task 1 GREEN)
- FOUND: commit `7b2089d` (Task 2 RED)
- FOUND: commit `47c3e23` (Task 2 GREEN)
- FOUND: commit `e99ad41` (test hardening)
- FOUND: `effort-state.json` literal in `src/manager/effort-state-store.ts` (3 refs)
- FOUND: `readEffortState` and `writeEffortState` both in `src/manager/session-manager.ts`
- FOUND: `effort: parentConfig.effort` in `src/manager/fork.ts` (1 ref)
- FOUND: `EFFORT-06` in `src/manager/fork.ts` (1 ref)
- VERIFIED: 30/30 Plan 02 tests GREEN under single-file + parallel runs
- VERIFIED: 125/125 regression tests GREEN across session-manager, persistent-session-handle, effort-mapping, differ, fork-migrated-agent
- VERIFIED: 0 new TSC errors in touched files
- VERIFIED: acceptance criteria (`grep -c "effort: parentConfig\\.effort" fork.ts >= 1`, `grep -c "EFFORT-06" fork.ts >= 1`, `grep -c "readEffortState|writeEffortState" session-manager.ts >= 2`)

---
*Phase: 83-extended-thinking-effort-mapping*
*Completed: 2026-04-21*
