---
phase: 130-manifest-driven-plugin-sdk
plan: 01
subsystem: plugin-sdk
tags: [zod, plugin-sdk, manifest, capability-vocabulary, skill-manifest, mcp-tool-manifest]

requires:
  - phase: (none — foundational additive package)
    provides: zod 4.x dependency already in package.json
provides:
  - "src/plugin-sdk/ in-tree package — zero new npm deps"
  - "13-capability closed vocabulary (CAPABILITY_VOCABULARY tuple + Capability type)"
  - "SkillManifestSchema (Zod) for SKILL.md frontmatter validation"
  - "MCPToolManifestSchema (Zod) for mcp-manifest.json validation"
  - "defineSkill(manifest) / defineMCPTool(manifest) helpers with structured-error throw-on-mismatch"
  - "Barrel exports at src/plugin-sdk/index.ts"
affects:
  - "130-02 (daemon-side skill-loader chokepoint that consumes SkillManifestSchema)"
  - "130-03 (admin-clawdy skills back-fill — first migration target)"
  - "131-tmux-remote-control-skill (first NEW skill following the manifest pattern)"

tech-stack:
  added: []  # zero new deps; reuses zod 4.x
  patterns:
    - "Closed enum capability vocabulary via readonly tuple + z.enum (operator-greppable)"
    - "Zod safeParse → structured-error throw pattern in define* helpers"
    - "Barrel re-export of schemas + types + helper functions + value-level enum"

key-files:
  created:
    - "src/plugin-sdk/capability-vocabulary.ts"
    - "src/plugin-sdk/manifest-schema.ts"
    - "src/plugin-sdk/define-skill.ts"
    - "src/plugin-sdk/define-mcp-tool.ts"
    - "src/plugin-sdk/index.ts"
    - "src/plugin-sdk/__tests__/manifest-schema.test.ts"
    - "src/plugin-sdk/__tests__/define-skill.test.ts"
  modified: []  # additive-only plan

key-decisions:
  - "Owner schema accepts kebab-case agent name OR literal '*' (D-01)"
  - "Strict semver M.m.p — no pre-release / build metadata this phase (keep manifest versions boring)"
  - "MCPToolManifestSchema extends SkillManifestSchema with optional mcpServer — single source of truth for shared fields"
  - "Structured error format: `Invalid skill manifest:\\n  - <path>: <message>` per issue (path falls back to `(root)`)"

patterns-established:
  - "src/plugin-sdk/ as a self-contained in-tree package — dependencies limited to zod (no project-internal imports this phase)"
  - "define* helpers return parsed-and-defaulted data, NOT the raw input — callers get filled-in default empty arrays"

requirements-completed: [D-01, D-02, D-04, D-04a]

duration: ~10min
completed: 2026-05-15
---

# Phase 130 Plan 01: Plugin SDK Package Foundation Summary

**`src/plugin-sdk/` in-tree package: 13-capability closed enum, Zod manifest schemas (SkillManifestSchema + MCPToolManifestSchema), and `defineSkill`/`defineMCPTool` helpers — additive-only, zero new dependencies, 13 tests green.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-05-15T15:25:00Z (approx)
- **Completed:** 2026-05-15T15:35:00Z (approx)
- **Tasks:** 5 (T-01..T-05)
- **Files created:** 7 (5 source + 2 test)
- **Files modified:** 0

## Accomplishments

- 13-capability closed vocabulary at `src/plugin-sdk/capability-vocabulary.ts` (filesystem, network, llm-call, discord-post, discord-read, cross-agent-delegate, subagent-spawn, memory-write, memory-read, secret-access, mcp-tool-use, schedule-cron, config-mutate)
- `SkillManifestSchema` enforces kebab-case `name`, semver `version`, `owner` (kebab-case OR `*`), and `Capability[]` enum membership for `capabilities`
- `MCPToolManifestSchema` extends with optional `mcpServer` field for tools co-located with their server
- `defineSkill` / `defineMCPTool` produce structured multiline error messages listing every offending field path
- Barrel exports the full public surface (helpers, schemas, types, value-level vocabulary)
- 13 vitest tests across two `__tests__/` files — MS-01..MS-10 + DS-01..DS-03, all green

## Task Commits

Each task was committed atomically on branch `worktree-agent-a61012859f4a2ce91`:

1. **T-01: Capability vocabulary enum** — `03c64fd` (feat)
2. **T-02: Manifest schemas (Zod)** — `5d36aee` (feat)
3. **T-03: defineSkill + defineMCPTool helpers** — `575e611` (feat)
4. **T-04: Package barrel exports** — `b3c4762` (feat)
5. **T-05: Schema + helper tests (13 cases)** — `395f667` (test)

Planning commits cherry-picked into this worktree for SUMMARY co-location:

- `debb088` — docs(130): capture phase context for manifest-driven plugin SDK
- `cb89e0f` — docs(130-01): Plan 01 — plugin-sdk package foundation

## Files Created/Modified

- `src/plugin-sdk/capability-vocabulary.ts` — 13-capability `CAPABILITY_VOCABULARY` readonly tuple + `Capability` type alias
- `src/plugin-sdk/manifest-schema.ts` — `SkillManifestSchema`, `MCPToolManifestSchema`, and inferred type exports
- `src/plugin-sdk/define-skill.ts` — `defineSkill` helper (Zod safeParse → structured throw)
- `src/plugin-sdk/define-mcp-tool.ts` — `defineMCPTool` parallel helper
- `src/plugin-sdk/index.ts` — package barrel
- `src/plugin-sdk/__tests__/manifest-schema.test.ts` — 10 cases (MS-01..MS-10)
- `src/plugin-sdk/__tests__/define-skill.test.ts` — 3 cases (DS-01..DS-03)

## Decisions Made

- **Owner ordering as `z.literal("*") | regex`:** Putting the literal branch first in the union surfaces a cleaner error path for the common fleet-wide case while still permitting kebab-case agent names. Functionally equivalent to the reverse order in the plan body — chosen for readability.
- **Strict semver (`^\d+\.\d+\.\d+$`):** Pre-release tags / build metadata intentionally rejected this phase. Manifest versions stay boring; relax later if a real use case demands it.
- **Optional `mcpServer` on `MCPToolManifestSchema`:** Plan body specified `optional()`; preserved as-is. Avoids forcing every MCP tool manifest to declare its host server when ergonomics suggest it's often implicit from file location.
- **`(root)` fallback in error path-formatting:** When a Zod issue has an empty `path` (top-level type mismatch), the helper renders `(root): <message>` instead of an empty leading prefix. Minor UX polish that the plan body's code snippet didn't include explicitly.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] `@ts-expect-error` directive flagged as unused in DS-02**
- **Found during:** Task 5 (T-05 test authoring) — `npx tsc --noEmit` failed with `TS2578: Unused '@ts-expect-error' directive` on the deliberately invalid input in `define-skill.test.ts`.
- **Issue:** The plan body suggested casting to invalid input to exercise the runtime error path; with structural typing, the literal-shaped object satisfied TS without the directive.
- **Fix:** Replaced the `@ts-expect-error` directive with an explicit `as unknown as Parameters<typeof defineSkill>[0]` cast through `unknown`. Same runtime semantics (passes invalid data), clean tsc.
- **Files modified:** `src/plugin-sdk/__tests__/define-skill.test.ts`
- **Verification:** `npx tsc --noEmit` clean; `npx vitest run src/plugin-sdk/__tests__/` 13/13 green.
- **Committed in:** `395f667` (Task 5 commit)

**2. [Rule 3 — Blocking] Cherry-picked planning commits into worktree for SUMMARY co-location**
- **Found during:** Post-T-05 — needed to write `.planning/phases/130-manifest-driven-plugin-sdk/130-01-SUMMARY.md` at the canonical phase-dir location, but the phase directory existed only on `master`, not on the worktree branch.
- **Issue:** Worktree branch was forked at `91535c7`, before `c2df189`/`d9170ac` introduced the phase directory. Writing the SUMMARY would have created an orphan file from master's perspective.
- **Fix:** `git cherry-pick c2df189 d9170ac` to bring `130-CONTEXT.md` and `130-01-PLAN.md` into the worktree branch; `cp` BACKLOG.md from the master working tree (committed below as part of the SUMMARY metadata commit).
- **Files modified:** `.planning/phases/130-manifest-driven-plugin-sdk/{130-CONTEXT.md,130-01-PLAN.md,BACKLOG.md}` (all carried over from master, not authored here)
- **Verification:** All three planning files present in the worktree alongside the new SUMMARY.
- **Committed in:** cherry-picks `debb088` + `cb89e0f`; BACKLOG.md + SUMMARY rolled into the metadata commit.

---

**Total deviations:** 2 auto-fixed (both Rule 3 — blocking issues unrelated to plan scope).
**Impact on plan:** None on the package surface or test coverage. Static-grep coverage targets all exceeded (`defineSkill`: 12, `CAPABILITY_VOCABULARY`: 7, `SkillManifestSchema`: 18). Plan executed exactly as written for the package itself.

## Issues Encountered

- Full-suite `npx vitest run` (against the whole `src/`) was kicked off in the background as a regression check but did not produce parseable output within the SUMMARY window. Since this plan is strictly additive (zero production files modified) and the targeted `npx vitest run src/plugin-sdk/__tests__/` invocation reported 13/13 green, regression risk is bounded by construction — no shared module touched.

## Self-Check

- `[ -f src/plugin-sdk/capability-vocabulary.ts ]` — FOUND
- `[ -f src/plugin-sdk/manifest-schema.ts ]` — FOUND
- `[ -f src/plugin-sdk/define-skill.ts ]` — FOUND
- `[ -f src/plugin-sdk/define-mcp-tool.ts ]` — FOUND
- `[ -f src/plugin-sdk/index.ts ]` — FOUND
- `[ -f src/plugin-sdk/__tests__/manifest-schema.test.ts ]` — FOUND
- `[ -f src/plugin-sdk/__tests__/define-skill.test.ts ]` — FOUND
- Commits `03c64fd`, `5d36aee`, `575e611`, `b3c4762`, `395f667` — all present in `git log`.

**Self-Check: PASSED**

## Threat Flags

None. This plan ships only schemas and helper functions; no new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries. Plan 02 introduces the daemon-side loader chokepoint where threat-surface review will be in scope.

## User Setup Required

None — additive in-tree package, no operator configuration.

## Next Phase Readiness

- **Plan 02 (skill-loader chokepoint):** Ready. Imports `SkillManifestSchema` from `src/plugin-sdk` to validate YAML frontmatter from `~/.clawcode/agents/<agent>/skills*/SKILL.md`. Per `feedback_silent_path_bifurcation.md`, the cache + invalidation MUST live in ONE place (the skill-loader chokepoint), not per-call-site.
- **Plan 03 (admin-clawdy migration):** Ready conceptually. Back-fills `SKILL.md` frontmatter using the schema landed here.
- **No blockers.** Zero production code touched in Plan 01 — Plan 02 inherits a clean slate.

---
*Phase: 130-manifest-driven-plugin-sdk*
*Plan: 01*
*Completed: 2026-05-15*
