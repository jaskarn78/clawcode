# Phase 110 deferred items

## From plan 110-03

- **Pre-existing TypeScript error in `src/usage/budget.ts:138`**: `TS2367: This comparison appears to be unintentional because the types '"warning" | null' and '"exceeded"' have no overlap.` Out of scope for 110-03 (Phase 40 file). Existed before this plan's changes (verified via `git log --all --oneline src/usage/budget.ts`). Not introduced by Wave 1 CI/distribution work.
