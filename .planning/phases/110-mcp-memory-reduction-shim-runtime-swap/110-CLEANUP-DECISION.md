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

**Status:** PENDING operator drill

The plan calls for a deliberate `static → node → static` flip on
`admin-clawdy`'s `shimRuntime.search` to verify the rollback path is
working post-cleanup. Per `feedback_no_auto_deploy` and
`feedback_ramy_active_no_deploy`, the flip is held until the operator
explicitly authorises it in a quiet window. Once executed, this section
is updated with:

- Date / time of drill
- Agent flipped (admin-clawdy)
- Shim type flipped (search)
- Observed Node shim PID / log line confirming Node runtime spawned
- Flip-back observation confirming Go static runtime restored
- Final RSS measurement (sanity check Stage 0b savings preserved)

## Cross-references

- Plan: `.planning/phases/110-mcp-memory-reduction-shim-runtime-swap/110-08-PLAN.md`
- Phase context: `.planning/phases/110-mcp-memory-reduction-shim-runtime-swap/110-CONTEXT.md`
- Stage 0b shipping plan: `.planning/phases/110-mcp-memory-reduction-shim-runtime-swap/110-07-SUMMARY.md`
- ROADMAP entry: `.planning/ROADMAP.md` § Phase 110
