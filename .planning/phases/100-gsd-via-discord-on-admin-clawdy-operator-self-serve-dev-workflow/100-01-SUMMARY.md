---
phase: 100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow
plan: 01
subsystem: config
tags: [zod, schema, additive-optional, settingSources, gsd, projectDir, claude-agent-sdk, ResolvedAgentConfig]

# Dependency graph
requires:
  - phase: 96
    provides: 11th additive-optional schema blueprint (outputDir / fileAccess) — Phase 100 GSD-02/04 = 12th application
  - phase: 95
    provides: dreamConfigSchema additive-optional precedent — same blueprint
  - phase: 90
    provides: memoryAutoLoad / memoryAutoLoadPath / memoryRetrievalTopK additive precedents
  - phase: 89
    provides: greetOnRestart / greetCoolDownMs additive precedents
  - phase: 86
    provides: allowedModels per-agent override + atomic YAML writer pattern
  - phase: 83
    provides: effortSchema per-agent override blueprint
provides:
  - agent.settingSources?: ('project'|'user'|'local')[] schema field (additive, .min(1) gate)
  - agent.gsd?: { projectDir?: string } schema field (additive, optional inner)
  - ResolvedAgentConfig.settingSources (always populated, default ['project'])
  - ResolvedAgentConfig.gsd?.projectDir (undefined when unset; expandHome'd when set)
  - resolveAgentConfig propagation with documented defaults (settingSources → ['project'], gsd → undefined)
  - Schema regression pin via PR11 — 10-agent in-tree clawcode.yaml parses unchanged
affects: [Plan 100-02 (session-adapter wiring), Plan 100-03 (differ classification), Plan 100-04 (slash dispatcher), Plan 100-05 (subagent thread spawner), Plan 100-07 (clawcode.yaml fixture)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "12th application of additive-optional schema blueprint (Phases 83/86/89/90/94/95/96)"
    - "Cascade-watch — adding a required field to ResolvedAgentConfig propagates to 22 mock fixtures across test files (handled identically to Phase 89/90/96 cascades)"
    - "Pitfall 3 enforcement — .min(1) on enum array rejects [] at parse time when empty would silently disable infrastructure"

key-files:
  created: []
  modified:
    - src/config/schema.ts (agentSchema +14 lines: settingSources + gsd fields)
    - src/shared/types.ts (ResolvedAgentConfig +20 lines: readonly settingSources + gsd)
    - src/config/loader.ts (resolveAgentConfig +9 lines: defaults + expandHome)
    - src/config/__tests__/schema.test.ts (+154 lines: 12 PR1..PR12 tests + describe block)
    - src/config/__tests__/loader.test.ts (+207 lines: 8 LR1..LR8 tests + describe block)
    - 22 test files extended with `settingSources: ["project"]` cascade fix

key-decisions:
  - "Apply .min(1) on settingSources array to reject [] at parse time per RESEARCH.md Pitfall 3 — prevents silent infrastructure disablement"
  - "settingSources at ResolvedAgentConfig level is ALWAYS populated (never undefined) so consumers don't need optional-chain — defaults to ['project'] in resolver"
  - "gsd at ResolvedAgentConfig level is conditionally populated (undefined when unset) — Plan 02 reads `config.gsd?.projectDir ?? config.workspace`"
  - "expandHome applied at resolver layer for gsd.projectDir so consumers see absolute paths (no raw ~/...)"
  - "Cascade pattern: 22 test fixtures got `settingSources: [\"project\"]` after their `memoryCueEmoji` line — matches Phase 89/90/96 22-fixture-cascade pattern"

patterns-established:
  - "Additive-optional 12th application: schema field is `.optional()` so v2.5/v2.6 fleet parses unchanged; resolver applies default (['project']); ResolvedAgentConfig field always populated"
  - "Pitfall 3 (.min(1)) — explicit empty-array rejection at schema layer when [] would silently disable infrastructure"
  - "PR11 in-tree clawcode.yaml regression pin — read clawcode.yaml literally + parse via configSchema + assert no throw; catches accidental required-field cascades"

requirements-completed: [REQ-100-01, REQ-100-02, REQ-100-04, REQ-100-05]

# Metrics
duration: 14min
completed: 2026-04-26
---

# Phase 100 Plan 01: Schema extensions — agent.settingSources + agent.gsd.projectDir Summary

**Per-agent settingSources + gsd.projectDir additive-optional schema fields wired through ResolvedAgentConfig with documented defaults — 12th application of the Phase 83/86/89/90/94/95/96 blueprint, zero behavior change for v2.5/v2.6 fleet.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-04-26T18:00:00Z
- **Completed:** 2026-04-26T18:15:00Z
- **Tasks:** 2 (RED + GREEN per TDD)
- **Files modified:** 27 (5 source/test in plan + 22 cascade fixtures)

## Accomplishments

- **agentSchema.settingSources** — optional array of `('project'|'user'|'local')` with `.min(1)` gate. Pitfall 3 satisfied: empty array now rejects at parse time. Zero behavior change for v2.5/v2.6 fleet (PR11 pinned).
- **agentSchema.gsd** — optional `{ projectDir?: string }` block. Future-extensible (Plan 100 only carries `projectDir`; future fields like `commitsAllowed`, `autoThreadKey` would land here).
- **ResolvedAgentConfig** — `settingSources` always populated (defaults to `['project']`); `gsd?.projectDir` undefined-when-unset, `expandHome`'d when set. Documented contract enables Plan 02's session-adapter rewrite of the hardcoded `cwd: config.workspace` and `settingSources: ["project"]` at lines 588/592/627/631.
- **Loader resolver** — `agent.settingSources ?? ["project"]` for default-bearing field; `agent.gsd?.projectDir ? { projectDir: expandHome(...) } : undefined` for the conditional one. Existing `expandHome` import at loader.ts:6 reused — no new imports.
- **20 new tests** — 12 PR* schema tests + 8 LR* loader tests covering omit, populate, reject-empty, enum-reject, duplicates-allowed, gsd absolute-path, gsd ~-expansion, gsd-empty-object, immutability, and multi-agent integration via `resolveAllAgents`.
- **PR11 regression** — reads in-tree clawcode.yaml literally, parses via configSchema, asserts 10 agents all carry `settingSources: undefined` and `gsd: undefined`. Catches accidental required-field cascades.

## Task Commits

1. **Task 1: TDD RED — 12 schema parse tests** — `2d6a85a` (test): tests pinning settingSources + gsd parse semantics. 10 of 12 RED, 2 vacuously green (PR1 + PR11) because zod strips unknown fields.
2. **Task 2: GREEN — schema/types/resolver + 8 loader tests + 22-fixture cascade** — `402c94b` (feat): all 20 tests pass; cascade fix lands `settingSources: ["project"]` after `memoryCueEmoji` in 22 test files.

**Plan metadata:** TBD (final commit on this SUMMARY + STATE.md + ROADMAP.md update)

## Files Created/Modified

### Source

- `src/config/schema.ts:949-967` — agentSchema gains `settingSources: z.array(z.enum(["project","user","local"])).min(1).optional()` + `gsd: z.object({ projectDir: z.string().min(1).optional() }).optional()` between `outputDir` and `skills`. JSDoc cites Phase 100 GSD-02/04 + RESEARCH.md Pitfall 3.
- `src/shared/types.ts:60-79` — ResolvedAgentConfig gains `readonly settingSources: readonly ("project"|"user"|"local")[]` (always populated) + `readonly gsd?: { readonly projectDir: string }` (undefined-when-unset). JSDoc points to Plan 02's session-adapter consumer at `:592` / `:631`.
- `src/config/loader.ts:335-343` — resolveAgentConfig propagates both fields. settingSources defaults to `["project"]`; gsd applies `expandHome` when set.

### Tests

- `src/config/__tests__/schema.test.ts:1798-1942` — `describe("Phase 100 — agent.settingSources + agent.gsd.projectDir")` with 12 PR* tests. Imports `readFileSync` + `parseYaml` for PR11 in-tree-yaml regression.
- `src/config/__tests__/loader.test.ts:1898-2104` — `describe("Phase 100 — settingSources + gsd resolution")` with 8 LR* tests covering loader semantics + immutability + multi-agent integration.

### Cascade-fix test fixtures (22 files, all single-line additions)

- `src/agent/__tests__/workspace.test.ts`
- `src/bootstrap/__tests__/detector.test.ts`
- `src/discord/__tests__/router.test.ts`
- `src/discord/subagent-thread-spawner.test.ts`
- `src/discord/thread-manager.test.ts`
- `src/heartbeat/__tests__/runner.test.ts` (5 fixtures via replace_all)
- `src/heartbeat/checks/__tests__/mcp-reconnect.test.ts`
- `src/manager/__tests__/config-reloader.test.ts`
- `src/manager/__tests__/effort-state-store.test.ts`
- `src/manager/__tests__/fork-effort-quarantine.test.ts`
- `src/manager/__tests__/fork-migrated-agent.test.ts`
- `src/manager/__tests__/mcp-session.test.ts`
- `src/manager/__tests__/persistent-session-recovery.test.ts`
- `src/manager/__tests__/restart-greeting.test.ts`
- `src/manager/__tests__/session-config-mcp.test.ts`
- `src/manager/__tests__/session-config.test.ts` (7 fixtures via replace_all)
- `src/manager/__tests__/session-manager-memory-failure.test.ts`
- `src/manager/__tests__/session-manager-set-model.test.ts`
- `src/manager/__tests__/session-manager-set-permission-mode.test.ts`
- `src/manager/__tests__/session-manager.test.ts` (2 fixtures via replace_all)
- `src/manager/__tests__/warm-path-mcp-gate.test.ts`
- `src/manager/fork.test.ts`

## Decisions Made

- **`.min(1)` on settingSources array.** Per RESEARCH.md Pitfall 3 — Claude Agent SDK treats empty `settingSources: []` as "load nothing" (no skills, no CLAUDE.md, no commands). Schema explicitly rejects `[]` so operators can't silently disable filesystem settings. PR5 pins this.
- **settingSources is ALWAYS populated at the resolved layer.** Mirrors Phase 89's `greetOnRestart` / `greetCoolDownMs` pattern: schema is `.optional()`, resolver fills with default, ResolvedAgentConfig field is concrete (never undefined). Consumers don't need optional-chain.
- **gsd is CONDITIONALLY populated at the resolved layer.** Mirrors Phase 96's `outputDir` pattern: undefined-when-unset so Plan 02 can use `config.gsd?.projectDir ?? config.workspace` ergonomically. Conditional avoids the "always-empty-object" footgun.
- **Cascade fix to 22 test fixtures.** Adding a required field to ResolvedAgentConfig forced 22 mock fixtures to populate `settingSources`. Matches Phases 89/90/96's 22-fixture cascade per RESEARCH.md Wave 0 §22-fixture-cascade. Net result: 13 fewer tsc errors than master baseline (some pre-existing fixtures got incidentally aligned).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] 22-fixture cascade fix**
- **Found during:** Task 2 (after `npx tsc --noEmit` showed cascade errors)
- **Issue:** Adding `readonly settingSources` (required) to ResolvedAgentConfig caused TS2741 "Property 'settingSources' is missing" in 22 test fixtures that build mock ResolvedAgentConfig objects manually. RESEARCH.md Wave 0 §22-fixture-cascade flagged this as a known consequence of the additive blueprint when the resolved type gains an always-populated field.
- **Fix:** Added `settingSources: ["project"], // Phase 100 GSD-02` after `memoryCueEmoji` line in each of 22 test fixtures via `replace_all` Edit calls. Pattern matches Phase 89 GREET-07/10 + Phase 90 MEM-01..05 + Phase 96 D-05 cascade fixes verbatim.
- **Files modified:** 22 test files listed above
- **Verification:** Final tsc count is 101 errors vs master baseline of 114 (13 NET reduction — Phase 100 fixed more cascade-related errors than it introduced). All 20 Phase 100 tests pass GREEN. Zero NEW test failures introduced (4 pre-existing failures unchanged).
- **Committed in:** `402c94b` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Cascade fix was anticipated by RESEARCH.md and is necessary for typecheck integrity. No scope creep — every fixture got a single-line addition matching the established 22-fixture-cascade pattern.

## Issues Encountered

- **Pre-existing tsc errors (114 on master, 101 with my changes — 13 reduction).** Multiple pre-existing tsc errors in unrelated files (`src/tasks/task-manager.ts`, `src/usage/budget.ts`, `src/cli/commands/__tests__/dream.test.ts`, etc.) were verified out-of-scope per CLAUDE.md SCOPE BOUNDARY rule. Documented but not fixed.
- **Pre-existing test failure: `LR-RESOLVE-DEFAULT-CONST-MATCHES`.** This `resolveSystemPromptDirectives` test asserts `["cross-agent-routing", "file-sharing"]` but actual output includes `subagent-routing` (Phase 99-K). Confirmed pre-existing on master via `git stash` baseline check. Out of scope.
- **`resolveAllAgents` signature edge case in LR8.** Initial test draft passed `(agents, defaults)` but signature is `(config: Config, ...)`. Fixed inline by constructing a `Config` object.

## User Setup Required

None — schema-tier change only. Production deploy is an operator-driven manual step on clawdy after the full Phase 100 lands (per Plan 100-08 SMOKE-TEST runbook + the deployment_constraint that this conversation's executor never touches clawdy).

## Next Phase Readiness

**Plan 02 hand-off — exact 4-line change in `src/manager/session-adapter.ts`:**
- Line 588 (createSession): `cwd: config.workspace,` → `cwd: config.gsd?.projectDir ?? config.workspace,`
- Line 592 (createSession): `settingSources: ["project"],` → `settingSources: config.settingSources,`
- Line 627 (resumeSession): `cwd: config.workspace,` → `cwd: config.gsd?.projectDir ?? config.workspace,`
- Line 631 (resumeSession): `settingSources: ["project"],` → `settingSources: config.settingSources,`

(Plan 01 verified line numbers via the in-tree source — Plan 02 should re-verify before editing in case rebase shifts them.)

Plan 02 dependencies satisfied:
- ✓ ResolvedAgentConfig carries `settingSources` (always populated)
- ✓ ResolvedAgentConfig carries `gsd?.projectDir` (undefined-when-unset)
- ✓ Both fields propagate through `resolveAgentConfig` with documented defaults
- ✓ 22 test fixtures already populate `settingSources` so Plan 02's session-adapter test extensions won't trigger a second cascade
- ✓ PR11 regression pin guards against future cascade introductions

Plans 03/04/05/07 also unblocked: they read `ResolvedAgentConfig.settingSources` and `ResolvedAgentConfig.gsd?.projectDir` directly with no further plumbing.

---
*Phase: 100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow*
*Plan: 01*
*Completed: 2026-04-26*

## Self-Check: PASSED

- ✓ src/config/schema.ts FOUND
- ✓ src/shared/types.ts FOUND
- ✓ src/config/loader.ts FOUND
- ✓ src/config/__tests__/schema.test.ts FOUND
- ✓ src/config/__tests__/loader.test.ts FOUND
- ✓ commit 2d6a85a (RED) FOUND
- ✓ commit 402c94b (GREEN) FOUND
- ✓ All 20 Phase 100 tests pass GREEN (12 PR* + 8 LR*)
- ✓ Zero new tsc errors caused by Phase 100 (-13 net vs master)
- ✓ Zero new test failures introduced
- ✓ PR11 in-tree clawcode.yaml regression pin holds (10 agents parse unchanged)
