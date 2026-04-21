---
phase: 75-shared-workspace-runtime-support
plan: 02
subsystem: runtime
tags: [memoryPath, shared-workspace, finmentum, session-memory, heartbeat, inbox, discord-attachments]

# Dependency graph
requires:
  - phase: 75-01
    provides: "agentSchema.memoryPath field, ResolvedAgentConfig.memoryPath contract, loader.ts TEMP stub"
provides:
  - "loader.ts resolves agent.memoryPath with expandHome + workspace fallback"
  - "session-memory.ts opens all 3 DBs (memories.db via memoryDir, usage.db via memoryDir, traces.db) under config.memoryPath"
  - "AgentMemoryManager.saveContextSummary signature takes memoryPath (was workspace)"
  - "HeartbeatRunner.logResult signature takes memoryPath (was workspace)"
  - "inbox discovery (heartbeat check, InboxSource, send-message IPC, send-to-agent IPC) under memoryPath"
  - "Discord attachment download dir under memoryPath/inbox/attachments"
  - "Consolidation + health-log CLI reader use memoryPath/memory"
affects:
  - 75-03 (integration test validates 5-agent finmentum family boot on shared workspace)
  - Phase 79+ (finmentum workspace migration consumes the isolated-runtime contract)

# Tech tracking
tech-stack:
  added: []  # pure call-site swaps; no new dependencies
  patterns:
    - "Fallback-to-workspace pattern in loader: memoryPath defaults to resolvedWorkspace → zero behavior change for dedicated-workspace agents"
    - "Signature renames (workspace → memoryPath) at public method boundaries with one-hop caller updates"
    - "Per-site inline comment citing Phase 75 SHARED-01 at every swap — ships the rationale inline with the code so later developers don't need to consult this plan"

key-files:
  created: []
  modified:
    - src/config/loader.ts (stub replaced with real expandHome + fallback resolution, line 163)
    - src/manager/session-memory.ts (3 sites: memoryDir line 57, tracesDbPath line 120, saveContextSummary signature line 202)
    - src/manager/session-manager.ts (1 caller: saveContextSummary forwards config.memoryPath, line 849)
    - src/heartbeat/runner.ts (2 sites: logResult signature line 336, caller at line 209)
    - src/heartbeat/checks/inbox.ts (inbox discovery line 57)
    - src/manager/daemon.ts (5 sites: consolidation line 646, InboxSource line 803, send-message 1710, send-to-agent 1758, health-log 2714)
    - src/discord/bridge.ts (2 attachment download dirs: thread route line 405, channel route line 500)
    - src/config/__tests__/loader.test.ts (+5 new Phase 75 tests for memoryPath resolution)
    - src/manager/__tests__/session-memory-warmup.test.ts (fixture updated with memoryPath: workspace)
    - src/discord/__tests__/bridge-attachments.test.ts (fixture mock updated with memoryPath: workspace)

key-decisions:
  - "memoryPath expansion is conditional: only call expandHome(agent.memoryPath) when explicitly set; the resolvedWorkspace fallback path inherits whatever expansion already happened (or didn't) for workspace — preserves pre-existing behavior of agent.workspace NOT being expanded when set via YAML (per loader TEMP comment note from Plan 01)"
  - "Signature renames over threading the resolved config: logResult + saveContextSummary took workspace-typed path strings as params, not full config objects. Renaming the param to memoryPath + updating the one caller in each case is cleaner than passing the whole ResolvedAgentConfig"
  - "Discord bridge local var renamed workspace→memoryPath for parity with the field access — keeps grep-friendliness for future auditors"
  - "Inline Phase 75 SHARED-01 comments at every swap site — future developers see the rationale in the code, not in a plan they might not read"

patterns-established:
  - "Conditional expansion pattern: `agent.foo ? expandHome(agent.foo) : fallback` — only expand when user-set, fallback path is already-expanded"
  - "Public method signature migration: rename param + one-hop caller update in the same task commit"

requirements-completed:
  - SHARED-01
  - SHARED-02

# Metrics
duration: 14min
completed: 2026-04-20
---

# Phase 75 Plan 02: Runtime Consumers Wire-Up Summary

**Replaces the Plan 01 tsc-green stub with real memoryPath resolution, then threads the resolved path through all 13 runtime consumers — session-memory DBs, heartbeat log, inbox discovery, send-message IPC, Discord attachments, consolidation, and health-log CLI — so two agents sharing a basePath with distinct memoryPath overrides get fully isolated runtime state.**

## Performance

- **Duration:** ~14 minutes
- **Started:** 2026-04-20T13:58:11Z
- **Completed:** 2026-04-20T14:12:32Z
- **Tasks:** 2/2 completed
- **Files modified:** 10 (7 source, 3 test fixture updates)

## Line-by-Line Swap Inventory (13 sites)

| # | File:Line | Before | After |
|---|-----------|--------|-------|
| 1 | src/config/loader.ts:163 | `memoryPath: resolvedWorkspace` (TEMP stub) | `memoryPath: agent.memoryPath ? expandHome(agent.memoryPath) : resolvedWorkspace` |
| 2 | src/manager/session-memory.ts:57 | `join(config.workspace, "memory")` | `join(config.memoryPath, "memory")` |
| 3 | src/manager/session-memory.ts:120 | `join(config.workspace, "traces.db")` | `join(config.memoryPath, "traces.db")` |
| 4 | src/manager/session-memory.ts:195-202 | `saveContextSummary(agentName, workspace, summary)` | `saveContextSummary(agentName, memoryPath, summary)` — signature rename + internal var rename |
| 5 | src/manager/session-manager.ts:849 | `this.memory.saveContextSummary(agentName, config.workspace, summary)` | `this.memory.saveContextSummary(agentName, config.memoryPath, summary)` |
| 6 | src/heartbeat/runner.ts:336 | `private logResult(workspace, ...)` | `private logResult(memoryPath, ...)` — signature rename + internal var rename |
| 7 | src/heartbeat/runner.ts:209 | `this.logResult(agentConfig.workspace, ...)` | `this.logResult(agentConfig.memoryPath, ...)` |
| 8 | src/heartbeat/checks/inbox.ts:57 | `join(agentConfig.workspace, "inbox")` | `join(agentConfig.memoryPath, "inbox")` |
| 9 | src/manager/daemon.ts:646 | `join(agentConfig.workspace, "memory")` (consolidation memoryDir) | `join(agentConfig.memoryPath, "memory")` |
| 10 | src/manager/daemon.ts:803 | `join(agentConfig.workspace, "inbox")` (InboxSource inboxDir) | `join(agentConfig.memoryPath, "inbox")` |
| 11 | src/manager/daemon.ts:1710 | `join(targetConfig.workspace, "inbox")` (send-message IPC) | `join(targetConfig.memoryPath, "inbox")` |
| 12 | src/manager/daemon.ts:1758 | `join(targetConfig.workspace, "inbox")` (send-to-agent IPC) | `join(targetConfig.memoryPath, "inbox")` |
| 13 | src/manager/daemon.ts:2714 | `join(config.workspace, "memory")` (health-log CLI reader) | `join(config.memoryPath, "memory")` |
| 14 | src/discord/bridge.ts:405 | `join(workspace, "inbox", "attachments")` (thread route) — local `workspace` from `agentConfig?.workspace` | `join(memoryPath, "inbox", "attachments")` — local `memoryPath` from `agentConfig?.memoryPath` |
| 15 | src/discord/bridge.ts:500 | Same as 14 but channel route | Same swap |

**Total:** 13 runtime sites + 2 signature changes + 2 caller updates = 17 code changes across 8 files.

## Signature Changes

### AgentMemoryManager.saveContextSummary
```typescript
// Before
async saveContextSummary(agentName: string, workspace: string, summary: string): Promise<void>
// After
async saveContextSummary(agentName: string, memoryPath: string, summary: string): Promise<void>
```
Only caller: `SessionManager.saveContextSummary` (session-manager.ts:849). Updated to pass `config.memoryPath`.

### HeartbeatRunner.logResult (private)
```typescript
// Before
private logResult(workspace: string, agentName, checkName, result, timestamp): void
// After
private logResult(memoryPath: string, agentName, checkName, result, timestamp): void
```
Only caller: the `logResult` call inside `HeartbeatRunner.tick()` (runner.ts:209). Updated to pass `agentConfig.memoryPath`.

## Files That Intentionally Remain on `config.workspace`

Per D-01 (shared workspace files), these stay under `workspace` so all agents on a shared-basePath family see the same identity/security/skills surface:

| File/Path | Location | Rationale |
|-----------|----------|-----------|
| SOUL.md | session-memory.ts:216 (soulPath) | Shared identity document — finmentum family all draw from one project SOUL |
| SOUL.md, IDENTITY.md | src/bootstrap/writer.ts | Bootstrap creates under workspace; shared workspace files per D-01 |
| SECURITY.md | src/manager/daemon.ts (channel ACLs) | Shared per-workspace security policy |
| skills/ | src/manager/daemon.ts:458 | Shared skills directory — per-agent skill assignment via config, not directory |
| memory/ (bootstrap) | src/agent/workspace.ts:48, src/manager/agent-provisioner.ts:148 | One-time `clawcode register` bootstrap creates scaffolding under workspace; NOT the runtime memoryDir |
| Browser state.json | src/browser/manager.ts | Browser session state stays shared across fin-* agents (per CONTEXT Deferred — revisit in future milestone) |
| generated-images/ | src/image/workspaceSubdir | Shared image output for finmentum content-creation team — desired behavior |
| tasks.db | daemon-scoped | Not per-agent; no change |

## How Isolation Now Works

### Before Plan 02
Two agents with `workspace: ~/shared/finmentum` would both open `~/shared/finmentum/memory/memories.db` → single SQLite handle, per-agent writes clobber each other, inbox messages visible to all 5 agents, shared heartbeat.log.

### After Plan 02
With `workspace: ~/shared/finmentum` + per-agent `memoryPath: ~/shared/finmentum/fin-{role}`:

| Agent | workspace (shared) | memoryPath (distinct) | memories.db | inbox/ | heartbeat.log | traces.db |
|-------|--------------------|-----------------------|-------------|--------|---------------|-----------|
| fin-acquisition | ~/shared/finmentum | ~/shared/finmentum/fin-acquisition | …/fin-acquisition/memory/memories.db | …/fin-acquisition/inbox/ | …/fin-acquisition/memory/heartbeat.log | …/fin-acquisition/traces.db |
| fin-research | ~/shared/finmentum | ~/shared/finmentum/fin-research | …/fin-research/memory/memories.db | …/fin-research/inbox/ | …/fin-research/memory/heartbeat.log | …/fin-research/traces.db |
| fin-playground | ~/shared/finmentum | ~/shared/finmentum/fin-playground | …/fin-playground/memory/memories.db | …/fin-playground/inbox/ | …/fin-playground/memory/heartbeat.log | …/fin-playground/traces.db |
| fin-tax | ~/shared/finmentum | ~/shared/finmentum/fin-tax | …/fin-tax/memory/memories.db | …/fin-tax/inbox/ | …/fin-tax/memory/heartbeat.log | …/fin-tax/traces.db |
| finmentum-content-creator | ~/shared/finmentum | ~/shared/finmentum/finmentum-content-creator | …/finmentum-content-creator/memory/memories.db | …/finmentum-content-creator/inbox/ | …/finmentum-content-creator/memory/heartbeat.log | …/finmentum-content-creator/traces.db |

All 5 agents share `SOUL.md`, `IDENTITY.md`, `SECURITY.md`, `skills/`, `generated-images/`, browser state — the D-01 shared workspace files.

Meanwhile, the 10 dedicated-workspace agents never declare `memoryPath`, so loader falls back to `memoryPath = resolvedWorkspace`, and everything behaves exactly as before Plan 02. Zero regression path.

## Task Commits

1. **Task 1 RED: failing tests for memoryPath resolution in loader** — `4c07072` (test, 145 lines added)
2. **Task 1 GREEN: loader + session-memory + heartbeat + caller updates** — `f77a18f` (feat, 5 files, 35/14)
3. **Task 2: inbox + attachment + consolidation + health-log swaps** — `2a57a51` (feat, 4 files, 32/13)

_Task 2 committed directly (no separate RED) — the plan's `<behavior>` block specified grep/static assertions as the unit test (covered by acceptance criteria greps) with integration tests deferred to Plan 03. The grep greens at commit time plus the existing test suite (which covers all consumer code paths) serve as verification._

## Decisions Made

- **memoryPath expansion is conditional** — `agent.memoryPath ? expandHome(...) : resolvedWorkspace`. Only expand when the user explicitly sets memoryPath; the fallback inherits resolvedWorkspace as-is. This preserves pre-existing behavior where `agent.workspace` set in YAML isn't expanded (a pre-existing quirk noted in the TEMP stub from Plan 01 — explicitly NOT fixed in this plan per plan scope).
- **Signature renames over config-object threading** — `logResult` and `saveContextSummary` took a path string, not a full `ResolvedAgentConfig`. Renaming the param to `memoryPath` + updating the single caller in each case is the minimum-diff change.
- **Inline Phase 75 SHARED-01 comments at every swap site** — future developers auditing the code see the rationale next to the code change, not buried in a plan doc.
- **Discord bridge local var renamed** — `const workspace = agentConfig?.workspace ?? "/tmp"` became `const memoryPath = agentConfig?.memoryPath ?? "/tmp"`. The rename is semantically important: grep-visible and aligned with the new field.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking test fixture] Updated `session-memory-warmup.test.ts` fixture with memoryPath**
- **Found during:** Task 1 GREEN verification (`npx vitest run src/manager/__tests__/`)
- **Issue:** `makeConfig()` helper built ResolvedAgentConfig without `memoryPath` field; after swap `initMemory` dereferences `config.memoryPath` → undefined → `join(undefined, "memory")` throws → tests "completes under 200ms" and "propagates SQL errors" fail.
- **Fix:** Added `memoryPath: workspace` to the fixture (mirrors Plan 01's fixture-update pattern: dedicated-workspace agents never set memoryPath, fixtures emulate the loader fallback by mirroring workspace).
- **Verification:** `npx vitest run src/manager/__tests__/session-memory-warmup.test.ts` — 5 tests pass.
- **Committed in:** `f77a18f` (Task 1 GREEN commit — inline with the signature change that introduced the requirement).

**2. [Rule 3 - Blocking test fixture] Updated `bridge-attachments.test.ts` mock with memoryPath**
- **Found during:** Task 2 verification (`npx vitest run src/discord/__tests__/`)
- **Issue:** `mockGetAgentConfig.mockReturnValue({ workspace: "/workspace/test-agent" })` — missing memoryPath. After swap, bridge's attachment logic reads `agentConfig?.memoryPath` → undefined → falls back to `/tmp`. Test asserted expected path `/workspace/test-agent/inbox/attachments` but got `/tmp/inbox/attachments` → 1 test failure.
- **Fix:** Mock now returns `{ workspace: "/workspace/test-agent", memoryPath: "/workspace/test-agent" }`, mirroring the dedicated-workspace fallback.
- **Verification:** `npx vitest run src/discord/__tests__/bridge-attachments.test.ts` — 7 tests pass.
- **Committed in:** `2a57a51` (Task 2 commit).

## Deferred Issues (pre-existing, not caused by this plan)

These failures existed on master BEFORE this plan started. Confirmed via `git stash && vitest run` on pristine master:

1. **`src/manager/__tests__/daemon-openai.test.ts` — 7 failing tests** (pre-existing, unrelated to memoryPath)
2. **`src/manager/__tests__/session-manager.test.ts > configDeps wiring > configDeps passes conversationStores and memoryStores` — 1 failing test** (pre-existing test-isolation issue: `buildSessionConfig` mock call count pollutes across suites when the full file runs; test PASSES when run in isolation with `-t` selector)
3. **29 pre-existing tsc errors** — all in files unrelated to Phase 75 (task-manager.ts, daemon.ts unrelated lines, daily-summary.test.ts, cli test files, etc.). Logged to `deferred-items.md` by Plan 01. Baseline count unchanged: 29 → 29 after this plan.

Per scope boundary rule: "only auto-fix issues DIRECTLY caused by the current task" — these are all left alone.

## Test Counts Added

- **loader.test.ts:** +5 new tests in `resolveAgentConfig` block (expands ~ when set, falls back to workspace, passes ./relative through, passes absolute through, resolveAllAgents distinct memoryPaths with shared workspace)
- **Total:** 5 new tests, 100% passing. 49 loader tests total now (was 44).
- **All other suites:** unchanged test counts; 722 heartbeat+manager+discord+config tests pass (same +7 pre-existing failures, no new breakage).

## Plan 03 Handoff Notes

Plan 02 landed the `memoryPath` runtime contract end-to-end. Plan 03's integration test can now exercise:

1. Boot the 5-agent finmentum family with shared `workspace: ~/shared/finmentum` + distinct `memoryPath:` per agent
2. Write to agent A's memory, assert zero rows in agent B's memories.db
3. `clawcode send fin-research "hello" --from fin-acquisition` — verify message lands in `~/shared/finmentum/fin-research/inbox/`, NOT `~/shared/finmentum/fin-acquisition/inbox/`
4. Heartbeat fires — verify each agent gets its own `heartbeat.log` under its memoryPath
5. Discord attachment delivered to fin-research — verify it lands under `~/shared/finmentum/fin-research/inbox/attachments/`

## Self-Check: PASSED

- All 10 claimed modified files exist at claimed paths
- All 3 task commit hashes (`4c07072`, `f77a18f`, `2a57a51`) present in `git log`
- Phase-level grep verification: 0 runtime `workspace.*"inbox"`/`workspace.*"memory"`/`workspace.*"traces"` matches in config/manager/heartbeat/discord/collaboration (excluding one-time bootstrap in agent-provisioner.ts:148 which is correctly out-of-scope per CONTEXT)
- All 17 acceptance criteria grep counts match plan expectations exactly
- 29 tsc errors pre-plan, 29 tsc errors post-plan → zero new errors introduced
- No missing items
