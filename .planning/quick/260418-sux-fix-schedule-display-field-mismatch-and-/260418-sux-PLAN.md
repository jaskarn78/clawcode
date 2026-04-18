---
phase: 260418-sux
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/mcp/server.ts
  - src/manager/registry.ts
  - src/manager/__tests__/registry.test.ts
  - src/manager/daemon.ts
autonomous: true
requirements:
  - QUICK-260418-sux-01  # list_schedules field mismatch fix
  - QUICK-260418-sux-02  # registry ghost-entry reconciliation at daemon boot
must_haves:
  truths:
    - "list_schedules MCP tool prints real agent name (e.g. 'clawdy/memory-consolidation: …'), never 'undefined/…'"
    - "On daemon boot, registry entries whose name does not resolve to a configured agent (or a live parent agent for -sub-/-thread- entries) are pruned from ~/.clawcode/manager/registry.json"
    - "Each pruned entry is logged at info level with { name, reason } so ops can see it in journalctl"
    - "Registry reconciliation runs BEFORE SessionManager.startAll or any other code consumes the registry"
    - "Pure pruner function is unit-testable without filesystem or daemon state"
  artifacts:
    - path: "src/mcp/server.ts"
      provides: "Corrected list_schedules response type + template literal using agentName"
      contains: "agentName"
    - path: "src/manager/registry.ts"
      provides: "reconcileRegistry(registry, knownAgentNames) pure function + exports"
      exports: ["reconcileRegistry"]
    - path: "src/manager/__tests__/registry.test.ts"
      provides: "Unit tests for reconcileRegistry: retains configured agents, prunes ghosts, retains live subagent/thread entries, prunes orphaned subagent/thread entries"
    - path: "src/manager/daemon.ts"
      provides: "Boot-time call to reconcileRegistry with resolvedAgents names, logging each prune, writing back registry BEFORE SessionManager uses it"
      contains: "reconcileRegistry"
  key_links:
    - from: "src/mcp/server.ts list_schedules handler"
      to: "ScheduleStatus.agentName (src/scheduler/types.ts:23)"
      via: "inline response type assertion"
      pattern: "agentName"
    - from: "src/manager/daemon.ts startDaemon() (after resolveAllAgents, before `new SessionManager(...)`)"
      to: "reconcileRegistry from ./registry.js"
      via: "readRegistry -> reconcileRegistry(registry, new Set(resolvedAgents.map(a => a.name))) -> writeRegistry"
      pattern: "reconcileRegistry"
---

<objective>
Fix two independent defects in one pass:

1. **Schedule display bug** — `list_schedules` MCP tool prints `undefined/<task>` because its inline type asserts `agent` while the real IPC field (from `ScheduleStatus` in `src/scheduler/types.ts:21-30`) is `agentName`. The daemon IPC handler (`src/manager/daemon.ts:1398-1401`) already returns the correct shape; only the MCP tool consumer is wrong. The CLI command (`src/cli/commands/schedules.ts:16-25`) is already correct — we're aligning the MCP side to match.

2. **Registry ghost entries** — `~/.clawcode/manager/registry.json` accumulates stale entries (e.g. `"Admin Clawdy"` persisting after a rename to `admin-clawdy`) because nothing prunes entries that no longer correspond to a configured agent. Add a pure reconciliation function and wire it into daemon boot BEFORE any consumer reads the registry.

Purpose:
- Users see correct schedule status output (not `undefined/...`).
- Registry reflects actual configuration; orphaned entries don't leak into dashboards, health checks, or recovery logic.

Output:
- Two-line fix in `src/mcp/server.ts`.
- New `reconcileRegistry` pure function in `src/manager/registry.ts` with exhaustive unit tests.
- One boot-time integration point in `src/manager/daemon.ts` that logs each prune.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md

<interfaces>
<!-- Contracts the executor needs. Extracted from codebase — no exploration required. -->

From src/scheduler/types.ts (lines 21-30) — the REAL shape returned by the daemon:
```typescript
export type ScheduleStatus = {
  readonly name: string;
  readonly agentName: string;   // <-- NOT `agent`
  readonly cron: string;
  readonly enabled: boolean;
  readonly lastRun: number | null;
  readonly lastStatus: "success" | "error" | "pending";
  readonly lastError: string | null;
  readonly nextRun: number | null;
};
```

From src/manager/daemon.ts (lines 1398-1401) — IPC handler already returns ScheduleStatus verbatim:
```typescript
case "schedules": {
  const statuses = taskScheduler.getStatuses();
  return { schedules: statuses };
}
```

From src/manager/types.ts (lines 20-44) — Registry entry shape:
```typescript
export type RegistryEntry = {
  readonly name: string;
  readonly status: AgentStatus;
  readonly sessionId: string | null;
  readonly startedAt: number | null;
  readonly restartCount: number;
  readonly consecutiveFailures: number;
  readonly lastError: string | null;
  readonly lastStableAt: number | null;
  readonly warm_path_ready?: boolean;
  readonly warm_path_readiness_ms?: number | null;
};

export type Registry = {
  readonly entries: readonly RegistryEntry[];
  readonly updatedAt: number;
};
```

From src/manager/registry.ts — existing pure helpers (EMPTY_REGISTRY, readRegistry, writeRegistry, createEntry, updateEntry, isNodeError). New code follows the same immutable-return style: take (registry, knownNames) → return { registry, pruned } with new objects, never mutate.

From src/discord/subagent-thread-spawner.ts:98 — subagent session naming: `${parentAgent}-sub-${shortId}`.
From src/discord/thread-manager.ts:93 — thread session naming: `${agentName}-thread-${threadId}`.
Parent agent for pruning check = `entry.name.split("-sub-")[0]` or `entry.name.split("-thread-")[0]`. Keep only if that parent is in the configured-agent Set.

From src/manager/daemon.ts:339 — `export const REGISTRY_PATH = join(MANAGER_DIR, "registry.json");` — already imported path.

From src/manager/daemon.ts:417 — `const resolvedAgents = resolveAllAgents(config);` — the source of truth for configured agent names. The reconcile call goes BETWEEN this line and `new SessionManager({ registryPath: REGISTRY_PATH, ... })` at line 450 (currently nothing uses the registry between these points).
</interfaces>

</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix list_schedules MCP tool field mismatch</name>
  <files>src/mcp/server.ts</files>
  <action>
Edit `src/mcp/server.ts` around lines 293-307 (the `list_schedules` tool handler). Two changes, both renaming `agent` → `agentName`:

1. Line ~295 — the inline type assertion. Replace:
   ```typescript
   const result = (await sendIpcRequest(SOCKET_PATH, "schedules", {})) as {
     schedules: readonly { agent: string; name: string; cron: string; enabled: boolean; nextRun: string | null }[];
   };
   ```
   with:
   ```typescript
   const result = (await sendIpcRequest(SOCKET_PATH, "schedules", {})) as {
     schedules: readonly { agentName: string; name: string; cron: string; enabled: boolean; nextRun: string | null }[];
   };
   ```

2. Line ~303 — the template literal. Replace `${s.agent}` with `${s.agentName}`:
   ```typescript
   .map((s) => `${s.agentName}/${s.name}: ${s.cron} (${s.enabled ? "enabled" : "disabled"})${s.nextRun ? ` next: ${s.nextRun}` : ""}`)
   ```

Do NOT touch the adjacent `list_webhooks` handler (lines 310-330) — its IPC response genuinely uses `agent` (see `src/cli/commands/webhooks.ts:43` — `agent: entry.agent`). The schedule field is the only mismatch.

Before editing, confirm no other caller is reading `.agent` off a ScheduleStatus: grep the repo for `s\.agent\b` or `schedule.*\.agent\b` patterns and verify the only legitimate hit is the MCP server line we're fixing. (The CLI command at `src/cli/commands/schedules.ts:133` already uses `entry.agentName` — confirms the direction of the fix.)

Coding style: rename ONLY, no logic change, no reformat of surrounding code. Keep the inline readonly-array assertion — the `scheduler.ts:Schedule Status` type is the source of truth but the MCP layer intentionally uses an inline shape (consistent with adjacent `list_webhooks`).

Why this rename (not widening to full ScheduleStatus): the MCP tool only prints four fields. Matching the IPC shape narrowly (agentName/name/cron/enabled/nextRun) keeps the inline assertion minimal and avoids dragging `lastRun`/`lastStatus`/`lastError` into a tool output that doesn't display them.
  </action>
  <verify>
    <automated>npx tsc --noEmit && grep -n "s\.agent\b" src/mcp/server.ts || echo "PASS: no stale s.agent references in mcp/server.ts"</automated>
  </verify>
  <done>
- `src/mcp/server.ts:295` asserts `agentName: string` (not `agent: string`).
- `src/mcp/server.ts:303` references `s.agentName` (not `s.agent`).
- `npx tsc --noEmit` passes with zero errors.
- `grep s\.agent\b src/mcp/server.ts` returns no results.
- No other files changed.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add reconcileRegistry pure function with unit tests</name>
  <files>src/manager/registry.ts, src/manager/__tests__/registry.test.ts</files>
  <behavior>
Add a new exported pure function in `src/manager/registry.ts`:

```typescript
/**
 * Reconcile the registry against the currently-configured set of agents.
 * Returns a new Registry with ghost entries removed, plus a list of pruned
 * entries for logging. Does NOT mutate the input registry.
 *
 * Retention rules (an entry is KEPT iff any of these is true):
 *   1. entry.name is in knownAgentNames (a configured agent).
 *   2. entry.name matches `{parent}-sub-{id}` AND parent ∈ knownAgentNames.
 *   3. entry.name matches `{parent}-thread-{id}` AND parent ∈ knownAgentNames.
 *
 * Any other entry is pruned with a reason:
 *   - "unknown-agent" — no -sub-/-thread- suffix, name not in knownAgentNames.
 *   - "orphaned-subagent" — has -sub- suffix but parent missing.
 *   - "orphaned-thread" — has -thread- suffix but parent missing.
 *
 * Empty or whitespace parent segments (e.g. an entry named "-sub-foo") are
 * treated as orphaned — never matched against knownAgentNames.
 *
 * updatedAt bumps only when entries actually changed; an empty prune list
 * returns the original registry object unchanged (reference equality) so
 * callers can skip the writeRegistry call entirely.
 */
export function reconcileRegistry(
  registry: Registry,
  knownAgentNames: ReadonlySet<string>,
): { readonly registry: Registry; readonly pruned: readonly PrunedEntry[] }

export type PrunedEntry = {
  readonly name: string;
  readonly reason: "unknown-agent" | "orphaned-subagent" | "orphaned-thread";
};
```

Tests to add to `src/manager/__tests__/registry.test.ts` under a new `describe("reconcileRegistry", ...)` block:

- **Test 1**: Empty registry → returns input unchanged (reference equality), empty pruned list.
- **Test 2**: All entries configured → returns input unchanged (reference equality), empty pruned list.
- **Test 3**: One unknown entry → pruned with reason "unknown-agent"; kept entries preserved in original order.
- **Test 4**: Rename scenario — registry has ["Admin Clawdy", "admin-clawdy"], knownAgentNames = {"admin-clawdy"} → "Admin Clawdy" pruned with reason "unknown-agent"; "admin-clawdy" retained.
- **Test 5**: Live subagent — entry "atlas-sub-abc123" with knownAgentNames = {"atlas"} → retained.
- **Test 6**: Orphaned subagent — entry "ghost-sub-xyz" with knownAgentNames = {"atlas"} → pruned with reason "orphaned-subagent".
- **Test 7**: Live thread — entry "clawdy-thread-1234" with knownAgentNames = {"clawdy"} → retained.
- **Test 8**: Orphaned thread — entry "ghost-thread-567" with knownAgentNames = {"clawdy"} → pruned with reason "orphaned-thread".
- **Test 9**: Mixed real scenario — registry has ["clawdy", "Admin Clawdy", "admin-clawdy", "clawdy-sub-abc", "ghost-sub-def", "clawdy-thread-1", "ghost-thread-2"], knownAgentNames = {"clawdy", "admin-clawdy"} → kept: ["clawdy", "admin-clawdy", "clawdy-sub-abc", "clawdy-thread-1"]; pruned (in registry order): ["Admin Clawdy" unknown-agent, "ghost-sub-def" orphaned-subagent, "ghost-thread-2" orphaned-thread].
- **Test 10**: Immutability — when pruning occurs, original registry.entries array is not mutated; returned registry is a new object.
- **Test 11**: updatedAt bumps — when pruning occurs, returned registry.updatedAt > input registry.updatedAt (use Date.now() at call time).
- **Test 12**: Edge case — entry name is exactly `"-sub-foo"` (empty parent) → pruned as orphaned-subagent (never matches a known agent).
  </behavior>
  <action>
1. **Write tests first (RED)**. Add the `describe("reconcileRegistry", ...)` block at the bottom of `src/manager/__tests__/registry.test.ts` (after the existing Phase 56 block). Use `ReadonlySet` for `knownAgentNames`: `new Set<string>(["clawdy", "admin-clawdy"])`. Import `reconcileRegistry` and `PrunedEntry` from `../registry.js`. Run `npx vitest run src/manager/__tests__/registry.test.ts` and confirm all 12 new tests FAIL with "reconcileRegistry is not a function" or similar.

2. **Implement (GREEN)**. In `src/manager/registry.ts`:
   - Add `export type PrunedEntry = { readonly name: string; readonly reason: "unknown-agent" | "orphaned-subagent" | "orphaned-thread"; };`
   - Add `export function reconcileRegistry(...)` below `updateEntry`. Implementation sketch:
     ```typescript
     export function reconcileRegistry(
       registry: Registry,
       knownAgentNames: ReadonlySet<string>,
     ): { readonly registry: Registry; readonly pruned: readonly PrunedEntry[] } {
       const pruned: PrunedEntry[] = [];
       const kept = registry.entries.filter((entry) => {
         // Rule 1: exact match to a configured agent
         if (knownAgentNames.has(entry.name)) return true;

         // Rule 2: live subagent session
         const subIdx = entry.name.indexOf("-sub-");
         if (subIdx > 0) {
           const parent = entry.name.slice(0, subIdx);
           if (knownAgentNames.has(parent)) return true;
           pruned.push({ name: entry.name, reason: "orphaned-subagent" });
           return false;
         }

         // Rule 3: live thread session
         const threadIdx = entry.name.indexOf("-thread-");
         if (threadIdx > 0) {
           const parent = entry.name.slice(0, threadIdx);
           if (knownAgentNames.has(parent)) return true;
           pruned.push({ name: entry.name, reason: "orphaned-thread" });
           return false;
         }

         pruned.push({ name: entry.name, reason: "unknown-agent" });
         return false;
       });

       if (pruned.length === 0) {
         return { registry, pruned: [] };
       }

       return {
         registry: { entries: kept, updatedAt: Date.now() },
         pruned,
       };
     }
     ```
   - Note: use `indexOf(...) > 0` (not `>= 0`) to guarantee a non-empty parent segment; this handles Test 12 (entry named `"-sub-foo"` has indexOf === 0 → falls through to the unknown-agent branch, which still prunes it, but with reason "unknown-agent"). Adjust the tests accordingly OR use a different guard that routes empty-parent to "orphaned-subagent" — pick one, make the test match the implementation, document the choice in the JSDoc. **Preferred**: route empty-parent names like `-sub-foo` / `-thread-foo` to `orphaned-subagent` / `orphaned-thread` respectively (since structurally they look like subagent/thread sessions with a broken parent). Implement by using `indexOf(...) >= 0` and checking `parent.length === 0 || !knownAgentNames.has(parent)` → prune. Update Test 12 expectation to `reason: "orphaned-subagent"`.
   - Do NOT import Node builtins (already imported). No new dependencies.

3. Run `npx vitest run src/manager/__tests__/registry.test.ts` — all 12 new tests plus the existing 10 tests MUST pass.

4. Run `npx tsc --noEmit` — zero errors.

Coding style: function is ~25 lines, immutable, no throws (invalid inputs can't exist — `Registry` is typed). JSDoc matches the style of neighbouring functions (`/** */` block with param tags where helpful).
  </action>
  <verify>
    <automated>npx vitest run src/manager/__tests__/registry.test.ts && npx tsc --noEmit</automated>
  </verify>
  <done>
- `reconcileRegistry` + `PrunedEntry` exported from `src/manager/registry.ts`.
- All 12 new unit tests pass.
- All existing registry tests still pass (no regressions).
- `npx tsc --noEmit` clean.
- Function is pure: no filesystem, no Date.now() when no pruning, immutable return.
  </done>
</task>

<task type="auto">
  <name>Task 3: Wire reconcileRegistry into daemon boot</name>
  <files>src/manager/daemon.ts</files>
  <action>
Wire the reconciliation call into `startDaemon()` in `src/manager/daemon.ts`, BEFORE `SessionManager` or anything else touches the registry.

1. **Update the import** at line 30:
   ```typescript
   import { readRegistry, reconcileRegistry, writeRegistry } from "./registry.js";
   ```
   (Current import is `import { readRegistry } from "./registry.js";` — extend it.)

2. **Insert the reconcile block** between step 5 (resolveAllAgents, line 417) and step 6 (SessionManager creation, line 450). The cleanest spot is immediately after line 446 (`log.info({ routes: routingTable.channelToAgent.size }, "routing table built");`) and before line 448 (`// 6. Create SessionManager`):

   ```typescript
   // 5d. Reconcile registry — prune ghost entries left by renamed/removed agents.
   // Runs BEFORE SessionManager so startAll never sees stale names.
   const knownAgentNames = new Set(resolvedAgents.map((a) => a.name));
   const existingRegistry = await readRegistry(REGISTRY_PATH);
   const reconciled = reconcileRegistry(existingRegistry, knownAgentNames);
   if (reconciled.pruned.length > 0) {
     for (const entry of reconciled.pruned) {
       log.info(
         { name: entry.name, reason: entry.reason },
         "pruned ghost registry entry",
       );
     }
     await writeRegistry(REGISTRY_PATH, reconciled.registry);
     log.info(
       { prunedCount: reconciled.pruned.length },
       "registry reconciliation complete",
     );
   }
   ```

3. Step numbering: the inserted block slots in as "5d" (after 5c which is the admin-agent validation at line 419-428). No renumbering of downstream comments needed — they're free-form, not load-bearing.

4. Do NOT touch `THREAD_REGISTRY_PATH` (thread-bindings registry at line 59) — that's a different file (`~/.clawcode/manager/thread-bindings.json`) with its own entry shape (`ThreadBinding` from `src/discord/thread-types.ts`). Scope is `~/.clawcode/manager/registry.json` only, per task_details.

5. Error handling: `readRegistry` already throws `ManagerError` on corrupt JSON — let it propagate (daemon startup should fail loudly on a corrupt registry, same as today). `writeRegistry` is atomic (tmp + rename). No try/catch wrapping needed — we preserve the existing fail-fast semantics.

Confirm via `grep -n "registry" src/manager/daemon.ts` that the only new registry reads happen in the new block; existing `readRegistry` at line 1341 (the later IPC handler) is unrelated and must remain.

Coding style: 5d block is ~15 lines, uses existing log child, no new imports besides extending the one-liner at line 30.
  </action>
  <verify>
    <automated>npx tsc --noEmit && npx vitest run src/manager/__tests__/registry.test.ts src/manager/__tests__/bootstrap-integration.test.ts</automated>
  </verify>
  <done>
- `src/manager/daemon.ts` imports `reconcileRegistry` and `writeRegistry` alongside `readRegistry`.
- New step 5d runs after `routingTable` log (~line 446) and before SessionManager creation (~line 450).
- Each pruned entry logged at `log.info` with `{ name, reason }` and message `"pruned ghost registry entry"`.
- Reconciliation only writes registry when `pruned.length > 0` (avoids touching updatedAt on clean boots).
- `npx tsc --noEmit` passes.
- Registry tests still pass; bootstrap-integration test still passes (confirms boot order isn't broken).
- No changes to the THREAD_REGISTRY_PATH flow.
  </done>
</task>

</tasks>

<verification>
Run the full test suite for the manager module plus tsc:

```bash
npx tsc --noEmit
npx vitest run src/manager/__tests__/registry.test.ts
npx vitest run src/manager/
```

All three must pass.

Optional manual smoke test (user will handle — not a checkpoint):
1. Seed `~/.clawcode/manager/registry.json` with a ghost entry:
   ```json
   {"entries":[{"name":"Ghost Agent","status":"stopped","sessionId":null,"startedAt":null,"restartCount":0,"consecutiveFailures":0,"lastError":null,"lastStableAt":null}],"updatedAt":0}
   ```
2. Restart daemon (`systemctl restart clawcode` or `clawcode start-all`).
3. Check journal: `journalctl -u clawcode -n 50 | grep "pruned ghost"` — should show `{ name: "Ghost Agent", reason: "unknown-agent" }`.
4. Verify `~/.clawcode/manager/registry.json` no longer contains `"Ghost Agent"`.
5. Invoke `list_schedules` from an MCP client — output must show real agent names, no `undefined/`.
</verification>

<success_criteria>
- list_schedules MCP tool output contains real agent names (e.g. `clawdy/memory-consolidation: 0 3 * * * (enabled) next: ...`), never `undefined/<task>`.
- `reconcileRegistry` is a pure, exported, unit-tested function in `src/manager/registry.ts`.
- Daemon boot prunes ghost entries (logged + persisted) BEFORE SessionManager runs.
- Subagent session entries (`{parent}-sub-{id}`) and thread session entries (`{parent}-thread-{id}`) are retained iff their parent agent is still configured.
- Zero TypeScript errors.
- All existing tests pass; 12 new unit tests added and passing.
- Three atomic commits, one per task.
</success_criteria>

<output>
After completion, create `.planning/quick/260418-sux-fix-schedule-display-field-mismatch-and-/260418-sux-SUMMARY.md` with:
- Files changed (3) and line counts.
- Test additions (12 new unit tests in registry.test.ts).
- Commit SHAs for the three commits.
- Manual-smoke-test instructions copied from the verification block (ops-ready).
- Any deviation from the plan (e.g. if Test 12 reason was changed from orphaned-subagent to unknown-agent, note the choice and why).
</output>
