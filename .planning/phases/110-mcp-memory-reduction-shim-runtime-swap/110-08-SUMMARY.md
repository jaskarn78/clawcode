---
phase: 110
plan: 08
subsystem: mcp-shim-runtime-swap
tags: [phase-110, stage-0b, wave-6, cleanup, decision, path-a]
status: SHIPPED — path A (keep-fallback) doc-cleanup committed; 0B-RT-11 drill DEFERRED by operator
dependency-graph:
  requires:
    - 110-07-SUMMARY.md (browser shim shipped — Stage 0b structurally complete)
  provides:
    - "110-CLEANUP-DECISION.md — operator decision record + rationale + drill-deferral rationale"
    - "Stage 0b deprecation-notice JSDoc blocks at top of src/cli/commands/{search,image,browser}-mcp.ts"
    - "CLAUDE.md § MCP shim runtime — operator-facing pointer to the cleanup decision artifact"
    - "ROADMAP.md Phase 110 entry — flipped to SHIPPED, plan progress 9/9, 0B-RT-11 marked DEFERRED"
  affects:
    - "Future contributors landing in src/cli/commands/{search,image,browser}-mcp.ts find an explicit Stage 0b note rather than discovering the runtime swap by archaeology"
    - "Phase 110 closed; future shim-runtime work (Stage 0c mcp-broker-shim, Stage 1a Python externals broker) builds on this foundation"
tech-stack:
  added: []
  patterns:
    - "Path A — keep flippable fallback: documentation-only cleanup that leaves all rollback levers intact (schema enum, loader case, shim command files) while making the deprecation status explicit at every callsite a future contributor or operator might land at."
    - "Drill deferral with rationale rather than silent skip: 0B-RT-11 is marked DEFERRED in 110-CLEANUP-DECISION.md with explicit reasoning (path-A doc-only changed nothing the daily Stage 0b rollout hadn't exercised in reverse) rather than left as ambient PENDING ambiguity."
key-files:
  created:
    - ".planning/phases/110-mcp-memory-reduction-shim-runtime-swap/110-CLEANUP-DECISION.md"
    - ".planning/phases/110-mcp-memory-reduction-shim-runtime-swap/110-08-SUMMARY.md"
  modified:
    - "src/cli/commands/search-mcp.ts (+ Stage 0b deprecation-notice JSDoc block)"
    - "src/cli/commands/image-mcp.ts (+ Stage 0b deprecation-notice JSDoc block)"
    - "src/cli/commands/browser-mcp.ts (+ Stage 0b deprecation-notice JSDoc block)"
    - "CLAUDE.md (+ § MCP shim runtime pointer)"
    - ".planning/ROADMAP.md (Phase 110 plan progress + SHIPPED flip)"
  unchanged_by_design:
    - "src/config/schema.ts — shimRuntime enum stays ['node', 'static', 'python']"
    - "src/config/loader.ts — resolveShimCommand 'case \"node\":' branch retained"
    - "Test suites — no test churn since no behavior change"
decisions:
  - "Path A (keep Node shims as flippable fallback) over path B (remove). Three drivers: (1) Stage 0b's ≥ 2.7 GiB RSS savings vs path B's marginal ~2.16 MB Node-bundle reclaim is a < 0.1 % cost-vs-benefit ratio — not worth the rollback risk reduction; (2) `feedback_ramy_active_no_deploy` posture argues against any prod deploy that isn't urgent; (3) the day a Go-shim regression hits production, having a same-day schema-flippable rollback that doesn't require a release is worth real money."
  - "Drill DEFERRED rather than performed live. Plan 110-08's path-A action list calls for a `static → node → static` flip on admin-clawdy's search shim, but path A changes nothing in the loader / schema / shim command files relative to the code that ran daily during the 110-04→110-07 rollout — every Stage 0b agent flipped from `node` → `static` exercising that same branch in reverse. Drilling it as a separate step on a quiet operator window is theatre relative to the actual coverage the rollout already provided. Recorded explicitly in 110-CLEANUP-DECISION.md so the deferral is not silent."
  - "Deprecation notice rendered as a banner-style JSDoc block at the top of each Node shim CLI file rather than a one-line comment. A future contributor landing in search-mcp.ts (e.g., to extend it, debug it, or migrate it) sees Stage 0b status before they read a single line of executable code. The banner cross-references the cleanup decision artifact so the rationale is one click away."
  - "CLAUDE.md gets a small § MCP shim runtime section (six lines) rather than a buried mention. CLAUDE.md is the doc every Claude Code session loads at startup — putting the runtime status there means any agent reasoning about MCP shims has the current state in context immediately."
metrics:
  duration: "~25 minutes (decision recording + comment blocks + doc updates + commit)"
  completed: "2026-05-07"
  tasks_complete: 2  # Task 1 decision-gate resolved by operator; Task 2 implementation completed
  tasks_pending: 0   # 0B-RT-11 drill DEFERRED by operator decision, not pending
  files_created: 2
  files_modified: 5
  commits: 1  # 155537a
requirements: [0B-RT-11]
requirements_status: SHIPPED — 0B-RT-11 drill formally DEFERRED with rationale; rollback path code-paths retained intact and exercised daily during the Stage 0b rollout itself.
---

# Phase 110 Plan 08 — Stage 0b cleanup (path A) — Summary

Final plan in Phase 110. Operator chose path A (keep Node shims as flippable
fallback) and elected to close Phase 110 without a live 0B-RT-11 rollback
drill. Doc-only changes shipped; all rollback levers (schema enum, loader
branch, Node shim CLI files) retained intact.

## What shipped (commit `155537a`)

**Decision record:**
- `110-CLEANUP-DECISION.md` — path A chosen, rationale: ramy-active-no-deploy
  posture + < 0.1 % cost-vs-benefit ratio of Node-bundle reclaim against
  Stage 0b's ≥ 2.7 GiB RSS savings. Drill deferral documented with
  reasoning so it is not silent.

**Source-code annotations (comments only — no behavior change):**
- `src/cli/commands/search-mcp.ts` — Stage 0b deprecation-notice JSDoc
  block at top of file. Banner format with cross-reference to
  110-CLEANUP-DECISION.md.
- `src/cli/commands/image-mcp.ts` — same banner format.
- `src/cli/commands/browser-mcp.ts` — same banner format.

**Doc updates:**
- `CLAUDE.md` — new § MCP shim runtime section noting Go static binary is
  production runtime, Node shim CLI files retained as flippable fallback,
  pointer to 110-CLEANUP-DECISION.md.
- `.planning/ROADMAP.md` — Phase 110 plan progress flipped 8/9 → 9/9 (with
  drill DEFERRED note), Stage 0b status SHIPPED with this commit recorded.

**Unchanged by design:**
- `src/config/schema.ts` — `shimRuntime` enum stays `['node', 'static', 'python']`.
- `src/config/loader.ts` — `resolveShimCommand` `case "node":` branch retained.
- Test suites — no change since no behavior change.

## Path-A acceptance criteria (all green)

- ✅ `110-CLEANUP-DECISION.md` exists with operator name, rationale, and
  Rollback-verification section.
- ✅ All three Node shim CLI files retain a "deprecation notice" /
  "deprecated runtime" comment block (verified via
  `for f in src/cli/commands/{search,image,browser}-mcp.ts; do grep -E "deprecation notice|deprecated runtime" "$f"; done`).
- ✅ Schema enum unchanged.
- ✅ Loader unchanged.
- ✅ No test breakage.

## 0B-RT-11 rollback drill — DEFERRED

The plan calls for a deliberate `static → node → static` flip on
`admin-clawdy`'s `shimRuntime.search`. Operator closed Phase 110 without
performing it. Rationale (recorded in 110-CLEANUP-DECISION.md):

1. Path A changed nothing in the loader / schema / shim command files
   relative to the code that ran daily during the 110-04 → 110-07
   rollout. Every Stage 0b agent flipped from `node` → `static`
   exercising the same loader branch in reverse — the Node-runtime
   branch has been exercised by every flip.
2. `feedback_ramy_active_no_deploy` is in effect and there is no pressing
   reason to touch the running daemon for a doc-only cleanup.
3. If a Go-shim regression ever surfaces in production, the drill
   happens as part of incident response and is captured by that
   incident's post-mortem.

If 0B-RT-11 ever needs to be drilled cold (post-incident audit or
follow-up phase request), the procedure is in 110-CLEANUP-DECISION.md and
no code change is required to execute it.

## Verification

| Check | Status |
|---|---|
| Decision recorded with operator + rationale | ✅ |
| One of two paths chosen exactly once | ✅ (path-a-keep-fallback) |
| Path-A: deprecation notices present in all 3 shim files | ✅ |
| No source-code deletion (path A semantics) | ✅ |
| No schema change (path A semantics) | ✅ |
| No loader change (path A semantics) | ✅ |
| 0B-RT-11 drill | ⊘ DEFERRED with rationale |
| Phase 110 marked SHIPPED in ROADMAP | ✅ |

## Phase 110 close-out

Stage 0a SHIPPED 2026-05-03 (commit `5aa5ab6`).
Stage 0b code SHIPPED 2026-05-06 (commits across plans 110-04 through 110-07).
Stage 0b doc-cleanup SHIPPED 2026-05-07 (commit `155537a`).
**Phase 110 = COMPLETE.**

Final RSS savings (per plan 110-07 measurements): ≥ 2.7 GiB at full
fleet. Stage 0b runtime is the static Go binary; Node shims retained as
flippable emergency-rollback path. Future shim-runtime work
(Stage 0c mcp-broker-shim, Stage 1a Python externals broker) builds on
this foundation.

## Cross-references

- Plan: `110-08-PLAN.md`
- Decision: `110-CLEANUP-DECISION.md`
- Phase context: `110-CONTEXT.md`
- Final Stage 0b code SHIPPED: `110-07-SUMMARY.md`
- ROADMAP entry: `.planning/ROADMAP.md` § Phase 110
- Commit: `155537a` (this plan's only commit)
