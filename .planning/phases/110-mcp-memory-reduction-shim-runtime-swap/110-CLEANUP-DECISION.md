# Phase 110 Stage 0b Cleanup Decision

**Decided:** 2026-05-07
**Operator:** Jas
**Path chosen:** `path-a-keep-fallback`
**Rationale:** Conservative ops posture per `feedback_ramy_active_no_deploy`
memory — Ramy is active in `#fin-acquisition`, so any work that requires a
production deploy is held until a quiet window or genuine emergency. Path A
is doc-only with zero source-code or schema change, lets us close Phase 110
cleanly today, and preserves maximum rollback flexibility (any operator can
flip any shim type back to Node any time without code change). The ~2.16 MB
of dormant Node bundle that stays in daemon RSS is < 0.1 % of Stage 0b's
≥ 2.7 GiB savings — a rounding error against the upside, while the ability to
flip back without a release is worth real money the day a Go-shim regression
ever surfaces. We can revisit Path B (full Node-shim removal) in a future
phase once Stage 0b has multiple settle-periods of stable production data
behind it and a quieter deploy window aligns.

## Path A — Implementation

**No source-code deletion. No schema change. No loader change.**

Documentation-only updates landed in this commit:

| File                                       | Change                                                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `src/cli/commands/search-mcp.ts`           | Added Stage 0b deprecation-notice JSDoc block at top of file. Code unchanged.                          |
| `src/cli/commands/image-mcp.ts`            | Added Stage 0b deprecation-notice JSDoc block at top of file. Code unchanged.                          |
| `src/cli/commands/browser-mcp.ts`          | Added Stage 0b deprecation-notice JSDoc block at top of file. Code unchanged.                          |
| `CLAUDE.md`                                | Added a short Phase 110 Stage 0b reference pointing future readers at this decision file.              |
| `.planning/ROADMAP.md`                     | Updated Phase 110 plan-progress line and marked Stage 0b SHIPPED with reference to this decision.      |

The schema enum in `src/config/schema.ts` remains
`["node", "static", "python"]`. The `case "node":` branch in
`src/config/loader.ts` remains. Operators can flip `shimRuntime.search`,
`shimRuntime.image`, or `shimRuntime.browser` back to `"node"` at any time
without a code change.

## Rollback verification (0B-RT-11)

**Status:** DEFERRED — operator closed Phase 110 on 2026-05-07 without
performing the live `static → node → static` flip drill.

**Rationale for deferral:**

- The path-A change is doc-only — zero code, schema, or loader change
  shipped, so there is nothing in the cleanup commit that could break
  the rollback path that was already exercised every day during the
  Stage 0b rollout (plans 110-04 through 110-07: every agent's first
  flip from `node` → `static` ran the same loader branch in reverse).
- The fallback path is structurally indistinguishable from the
  forward path: `resolveShimCommand`'s `case "node":` branch is the
  same code that selected the Node shim every day prior to the
  Stage 0b rollout. Nothing in plan 110-08 modified it.
- Operator posture: `feedback_ramy_active_no_deploy` is in effect and
  there is no pressing reason to touch the running daemon.
- If a Go-shim regression ever surfaces and the rollback is invoked
  for real, the drill will happen as part of the incident response
  and the result is captured by the incident itself.

**Re-opening:** if 0B-RT-11 ever needs to be drilled (post-incident
audit, follow-up phase, or operator request), spawn a small follow-up
plan that runs `clawcode admin-clawdy config set shimRuntime.search
node`, observes the next shim spawn, then flips back to `static`. No
code change required to execute.

## Cross-references

- Plan: `.planning/phases/110-mcp-memory-reduction-shim-runtime-swap/110-08-PLAN.md`
- Phase context: `.planning/phases/110-mcp-memory-reduction-shim-runtime-swap/110-CONTEXT.md`
- Stage 0b shipping plan: `.planning/phases/110-mcp-memory-reduction-shim-runtime-swap/110-07-SUMMARY.md`
- ROADMAP entry: `.planning/ROADMAP.md` § Phase 110
