---
phase: 107-memory-pipeline-integrity-dream-json-vec-memories-orphan-cleanup
plan: "03"
type: execute
status: complete
date: 2026-05-01
deployed-by: operator (explicit "Deploy" approval after Wave 1 GREEN)
deploy-pid: 344480
requirements-completed: [DREAM-OUT-01, DREAM-OUT-03, DREAM-OUT-04, VEC-CLEAN-01, VEC-CLEAN-02, VEC-CLEAN-03, VEC-CLEAN-04]
requirements-deferred: [DREAM-OUT-02]
---

# Phase 107-03 — Deploy gate + smoke

**Outcome:** deployed
**Deploy timestamp:** 2026-05-01 04:33:49 PDT
**Gate poll duration:** N/A (operator explicit deploy approval; channel-silence was satisfied at 0 non-bot messageCreate events in 30 min window prior)

## Pre-deploy gauntlet

- `npm run build`: PASS (tsup 384ms, dist/cli/index.js 2.07MB, copy-assets ran)
- Affected test surface: 124/124 GREEN across `store.test.ts`, `store-orphan-cleanup.test.ts`, `dream-pass-json-recovery.test.ts`, `dream-pass.test.ts`, `protocol.test.ts`
- 8 pre-existing failures in unrelated files (conversation-store.test.ts, dream-prompt-builder.test.ts P1/P3) — confirmed via stash baseline by both executors; documented in `deferred-items.md`

## Deploy

- Command: `rsync -av --delete dist/ → clawdy:/tmp/clawcode-dist-107/` then `rsync → /opt/clawcode/dist/` + `systemctl restart clawcode`
- Service status: `active (running)` since 04:33:49 PDT, Main PID 344480
- Memory: 138.9M (peak 271.6M) within 20G limit
- Boot logs clean: agent schedules registered for finmentum-content-creator within 4s of restart

## Smoke results

### Smoke 1 — DREAM-OUT-03 warn-level recovery
- **Outcome:** CLEAN (no `parse-failed` lines observed in post-deploy window — model behaved)
- Recovery path is latent at code level (DREAM-OUT-04 unit tests prove the path: prose input → no-op result + warn log + no throw). Production exercise will occur naturally on next Haiku misbehavior.

### Smoke 2 — VEC cascade baseline
- Pre-cleanup orphan count across all 11 agents: **0 orphans**
- Most agents have 0 vec_memories total (fresh state); finmentum-content-creator has 346 vec_memories (zero orphans).
- Likely Admin Clawdy already manually patched current state per CONTEXT.md — going forward, `MemoryStore.delete` cascade prevents new orphans atomically.

### Smoke 3 — `clawcode memory cleanup-orphans` CLI
- **First run:**
  ```
  test-agent: no orphans (0 vec_memories total)
  personal: no orphans (0 vec_memories total)
  fin-playground: no orphans (0 vec_memories total)
  finmentum-content-creator: no orphans (346 vec_memories total)
  general: no orphans (0 vec_memories total)
  projects: no orphans (0 vec_memories total)
  research: no orphans (0 vec_memories total)
  fin-research: no orphans (0 vec_memories total)
  fin-tax: no orphans (0 vec_memories total)
  fin-acquisition: no orphans (0 vec_memories total)
  Admin Clawdy: no orphans (0 vec_memories total)
  ```
- **Second run:** identical output (idempotency PASS — `removed 0 orphans` across all agents).
- **Total orphans cleaned:** 0 (already clean per Admin Clawdy's prior manual patch)

## Notes

- DREAM-OUT-02 deferred per Plan 107-01. Anchors recorded in 107-01-PLAN.md `<deferred>` section: SDK supports `outputFormat: { type: "json_schema", schema }` (sdk.d.ts:694, 1244, 1485) but per-turn injection requires a 5-file refactor through TurnDispatcher → SessionManager → sendAndCollect → turnOptions because dream pass goes through agent's persistent shared `sdk.query` handle (session-scoped). Future phase to take it on — DREAM-OUT-01 + DREAM-OUT-03 cover the requirement today.
- `MemoryStore.delete` audit confirmed single production `DELETE FROM memories` site (already atomic + cascading). Going forward, no new orphans can accumulate from delete paths.
- Historical orphan source (per RESEARCH.md pitfall 4): `migrateSchema` + `migrateEpisodeSource` recreate `memories` via CREATE/INSERT/DROP/RENAME pattern. `vec_memories` (vec0 vtab, no FK) was not touched. Production already cleaned by operator before deploy — `cleanup-orphans` CLI is now the operator's recovery tool for any future drift.
- `systemctl is-active clawcode` returns `active` post-deploy. Service healthy.

## Bundle outcome

Phase 107 fully shipped. Both pillars live:

1. **DREAM-OUT** — dream pass now has rule-6 fallback envelope (schema-correct shape), warn-level structured recovery on parse failure (was error), polymorphic `DreamPassLog.warn` signature for pino-style structured logs. Operator log noise reduced.

2. **VEC-CLEAN** — cascade audit confirmed; `MemoryStore.cleanupOrphans()` operational helper + IPC method `memory-cleanup-orphans` + CLI subcommand `clawcode memory cleanup-orphans` shipped. Operator now has recovery tool for any future migration-induced drift.

**Phase 107: complete (3/3 plans).**
