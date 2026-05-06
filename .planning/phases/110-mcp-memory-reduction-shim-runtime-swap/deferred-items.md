# Phase 110 deferred items

## From plan 110-03

- **Pre-existing TypeScript error in `src/usage/budget.ts:138`**: `TS2367: This comparison appears to be unintentional because the types '"warning" | null' and '"exceeded"' have no overlap.` Out of scope for 110-03 (Phase 40 file). Existed before this plan's changes (verified via `git log --all --oneline src/usage/budget.ts`). Not introduced by Wave 1 CI/distribution work.

## From plan 110-02

Test failures observed during execution that are NOT caused by 110-02's
changes (verified by checking out HEAD~1 of `src/manager/daemon.ts` and
re-running — failures reproduce identically).

| File | Failure | Status |
|---|---|---|
| `src/config/__tests__/clawcode-yaml-phase100.test.ts` | ENOENT for `clawcode.yaml` (test fixture missing in CI cwd) | Pre-existing |
| `src/config/__tests__/clawcode-yaml-phase100-fu-mcp-env-overrides.test.ts` | Same ENOENT | Pre-existing |
| `src/config/__tests__/schema.test.ts > PR11` | Same ENOENT | Pre-existing |
| `src/config/__tests__/loader.test.ts > LR-RESOLVE-DEFAULT-CONST-MATCHES` | system-prompt-directives count mismatch (6 expected vs 11 received — multiple new directives shipped without updating this test) | Pre-existing |
| `src/config/__tests__/shared-workspace.integration.test.ts` | Test timeout (15s) — flaky integration test | Pre-existing |
| `src/manager/__tests__/daemon-openai.test.ts` (6-7 failures) | `startOpenAiEndpoint` returning falsy `enabled`/`port`/`host`/`apiKeysStore` — verified failing on HEAD~1 (before this plan's commits) | Pre-existing |
| `src/manager/__tests__/daemon-warmup-probe.test.ts` | EmbeddingService production constructions exceed 2 (got 3) | Pre-existing |
| `src/manager/__tests__/session-manager-warmup-timeout.test.ts > STALL-02` | `rmdir` ENOTEMPTY race | Pre-existing |

These will need to be addressed in their own debug plan; out of scope for
the Stage 0b schema/loader/observability triple.
