---
phase: 124-operator-triggered-session-compaction
plan: 02
subsystem: heartbeat-policy + config-schema
tags: [heartbeat, schema, regression-test, decoupling, wave-1]
dependency-graph:
  requires: []
  provides:
    - 124-03-PLAN.md  # Discord /compact references the AUTO-COMPACT: ALLOWED block
    - 125-PLAN.md     # consumes ResolvedAgentConfig.autoCompactAt
  affects:
    - 124-03-PLAN.md
    - 125-PLAN.md
tech-stack:
  added: []
  patterns:
    - "Static-grep regression for prompt-policy invariants (Phase 90 D-10 anti-pattern shape)"
    - "Hyphenated YAML key + camelCase resolved field (mirrors Phase 117 advisor block)"
key-files:
  created:
    - src/__tests__/heartbeat-policy-decoupling.test.ts
    - src/config/__tests__/auto-compact-at-schema.test.ts
    - .planning/phases/124-operator-triggered-session-compaction/deferred-items.md
  modified:
    - clawcode.example.yaml
    - src/config/schema.ts
    - src/config/loader.ts
    - src/shared/types.ts
    - "26 ResolvedAgentConfig fixture files (see commit d8dda3f)"
decisions:
  - "Plan target re-pointed: edits land on `clawcode.example.yaml` (canonical checked-in template) instead of `clawcode.yaml` (gitignored runtime config, commit 0278e6f rename)."
  - "T-02 hardcodes `0.7` in the AUTO-COMPACT block with explicit TODO(Phase 125) for dynamic substitution — heartbeat prompt resolver has no placeholder interpolation today."
  - "Single conflated heartbeat block in clawcode.example.yaml: `fin-acquisition` agent only. admin/projects/finmentum-content-creator/personal carry no conflation."
  - "autoCompactAt added as required `readonly number` on ResolvedAgentConfig (matches Phase 89/90 precedent for greetOnRestart/greetCoolDownMs/memoryAutoLoad). 26 fixture files patched mechanically to add the field."
metrics:
  duration_minutes: 45
  completed_date: 2026-05-14
  task_count: 4
  file_count: 31
---

# Phase 124 Plan 02: Heartbeat Policy Decoupling + auto-compact-at Schema Summary

One-liner: Split fin-acquisition's conflated AUTO-RESET-DISABLED heartbeat block into AUTO-RESET + AUTO-COMPACT siblings (CONTEXT D-05), shipped `auto-compact-at` per-agent YAML knob with default 0.7 cascading per-agent → defaults → 0.7 (D-06), and pinned both with static-grep + schema/reload regressions Plan 125 will rely on.

## Commit SHAs

| Task | SHA | Title |
|------|-----|-------|
| T-01 | (audit-only) | Audit clawcode.yaml for conflated heartbeat blocks |
| T-02 | `0884060` | `feat(124-02-T02): split fin-acquisition heartbeat into AUTO-RESET + AUTO-COMPACT blocks` |
| T-03 | `926d36a` | `test(124-02-T03): static-grep regression for heartbeat policy decoupling` |
| T-04 | `d8dda3f` | `feat(124-02-T04): auto-compact-at YAML schema + loader resolver + ResolvedAgentConfig wire` |

## T-01 Audit Result (heartbeat blocks edited)

Grep `AUTO-RESET: DISABLED` in `clawcode.example.yaml` → exactly **1 match** (line 336). Block owner: agent **`fin-acquisition`** (line 279, heartbeat at L330-371).

Other agents inspected per CONTEXT specifics:
- `admin` — no heartbeat block defined.
- `projects` — dormant, no heartbeat.
- `finmentum-content-creator` — dormant, no heartbeat.
- `personal` — no heartbeat.
- All other agents (general, etc.) — no AUTO-RESET token.

T-01 acceptance ("List recorded in SUMMARY for traceability"): see above.

## T-02 Edit

Inserted `## ✅ AUTO-COMPACT: ALLOWED` sibling block after the AUTO-RESET-DISABLED block in `fin-acquisition.heartbeat.prompt`. Hardcoded threshold `0.7` with TODO(Phase 125) for placeholder interpolation. YAML parses cleanly (`yaml.parse(...)` against 11-agent config OK).

## T-03 Regression Test

`src/__tests__/heartbeat-policy-decoupling.test.ts` — 3 assertions:
1. Shape check (≥1 agent has `heartbeat.prompt`).
2. **Conflation scan** — for each `##`-delimited block in every agent's heartbeat, fail if it contains both `AUTO-RESET: DISABLED` and `auto-compact` (case-insensitive).
3. Distinct-block pin: fin-acquisition has BOTH headers, in **different** blocks.

**Bite-verified** by temporarily re-conflating the fin-acquisition block — test FAILED with explicit `fin-acquisition: ⚠️ AUTO-RESET: DISABLED ... auto-compact ...` violation line. Reverted; green again.

## T-04 Schema + Loader

- `defaultsSchema['auto-compact-at']: z.number().min(0).max(1).default(0.7)`.
- `agentSchema['auto-compact-at']: z.number().min(0).max(1).optional()`.
- `configSchema.defaults` fallback (when `defaults:` omitted entirely) populates `"auto-compact-at": 0.7`.
- `resolveAutoCompactAt(agent, defaults)` resolver added to `loader.ts` — fall-through per-agent → defaults → 0.7.
- `ResolvedAgentConfig.autoCompactAt: number` added to `src/shared/types.ts`; `resolveAgentConfig` populates it.
- **Reload integration**: `loadConfig` re-reads + re-resolves on every watcher fire; schema-only addition flows through automatically (verified by `loadConfig` round-trip test — disk edit → reload → new value visible without daemon restart).

17 schema tests pass (`auto-compact-at-schema.test.ts`). `tsc --noEmit` clean.

## Deviations from Plan

### Rule 3 (blocking fix) — Plan-target file rename

Plan targets `clawcode.yaml`; commit `0278e6f` renamed it to `clawcode.example.yaml` (gitignored the runtime file). Re-pointed all edits + the regression test path to the canonical example file. Audit revealed 1 conflated block, not 4 (plan speculated multiple agents — only fin-acquisition matched).

### Rule 3 (blocking fix) — 26 ResolvedAgentConfig fixture patches

Adding `readonly autoCompactAt: number` to `ResolvedAgentConfig` triggered 26 tsc errors in fixture builders. Mechanical patch matching Phase 89/90/100 precedent: inserted `autoCompactAt: 0.7, // Phase 124 D-06` after `greetCoolDownMs:` in every inline fixture. Files: see commit `d8dda3f` (full list in `git show --stat d8dda3f`).

## Deferred Items

See `deferred-items.md`:
- **DEFERRED-124-A** — `schema.test.ts:1967` ENOENT on gitignored `clawcode.yaml` (pre-existing master failure).
- **DEFERRED-124-B** — 41 pre-existing test failures across the touched trees (slash-commands, daemon-openai, bootstrap-integration, etc.). Branch net effect: **ZERO new failures** vs master (verified via `git stash` round-trip: master 42 fails, branch 41 fails — excluding the new test file).

## Self-Check: PASSED

- Created files exist:
  - FOUND: `src/__tests__/heartbeat-policy-decoupling.test.ts`
  - FOUND: `src/config/__tests__/auto-compact-at-schema.test.ts`
  - FOUND: `.planning/phases/124-operator-triggered-session-compaction/deferred-items.md`
- Commits exist:
  - FOUND: `0884060` (T-02)
  - FOUND: `926d36a` (T-03)
  - FOUND: `d8dda3f` (T-04)
- Plan-introduced tests: 20/20 passing.
- `tsc --noEmit` clean (0 errors).
- Plan net effect on test failures: -1 (branch has one fewer than master).
- D-10 deploy hold respected — no clawdy deploy attempted.

## Operator Notes

- **DO NOT DEPLOY** (D-10, Ramy active). `clawcode.example.yaml` is local; production `/opt/clawcode/clawcode.yaml` on `clawdy` is untouched.
- The static-grep regression test (T-03) is now the long-term backstop — any future commit that re-conflates AUTO-RESET + auto-compact under one `##` header fails CI.
- Plan 125 consumes `ResolvedAgentConfig.autoCompactAt` to gate auto-compaction firing; this plan ships only the primitive.
