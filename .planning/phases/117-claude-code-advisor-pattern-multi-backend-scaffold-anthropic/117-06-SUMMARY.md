---
phase: 117
plan: 06
subsystem: config
tags: [config, schema, loader, advisor, defaults, per-agent-override, canary]
requires: ["117-02"]
provides:
  - defaults.advisor.{backend, model, maxUsesPerRequest, caching} Zod schema
  - agents[].advisor partial override (every sub-field optional)
  - advisorBackendSchema (locked enum "native" | "fork"; "portable-fork" rejected)
  - advisorCachingSchema (defaults-side; populates enabled:true/ttl:"5m")
  - agentAdvisorOverrideSchema (per-agent; raw caching shape preserves operator-explicit-vs-omitted)
  - resolveAdvisorBackend(agent, defaults) → "native" | "fork"
  - resolveAdvisorModel(agent, defaults) → string (verbatim alias, NOT canonical SDK id)
  - resolveAdvisorMaxUsesPerRequest(agent, defaults) → number (1–10)
  - resolveAdvisorCaching(agent, defaults) → {enabled, ttl} (per-field fall-through)
affects: []  # No call sites rewired in this plan — exports only
tech-stack:
  added: []
  patterns:
    - Phase 110 Stage 0b shimRuntime canary-dial pattern, applied to backend feature-flag rollout
    - Per-field caching fall-through (operator overrides one knob at a time)
    - Schema-level rejection of forward-deferred enum values ("portable-fork" → Phase 118)
key-files:
  created:
    - src/config/__tests__/schema-advisor.test.ts
    - src/config/__tests__/loader-advisor.test.ts
  modified:
    - src/config/schema.ts (advisor helper schemas + defaultsSchema.advisor + agentSchema.advisor)
    - src/config/loader.ts (four module-level resolvers near resolveOutputDirTemplate)
decisions:
  - Helper schemas (advisorBackendSchema, advisorCachingSchema, advisorConfigSchema, agentAdvisorOverrideSchema) live just BEFORE agentSchema declaration (line ~1110) instead of just-before-defaultsSchema. Required because TypeScript declaration order rejects use-before-declaration when agentSchema (line 1115) references agentAdvisorOverrideSchema. Both consumers (agentSchema + defaultsSchema) see the helpers above their declarations.
  - agentAdvisorOverrideSchema.caching uses a raw inner z.object({enabled: bool.optional(), ttl: enum.optional()}) instead of advisorCachingSchema.partial(). Reason — Zod 4's .partial() preserves inner .default()s, so an operator setting only {enabled:false} would have ttl auto-populated to "5m" at parse time, short-circuiting per-field fall-through in resolveAdvisorCaching. The defaults-side advisorCachingSchema keeps its inner defaults (where they belong); the per-agent override stays operator-explicit-vs-omitted at the boundary.
  - resolveAdvisorBackend signature uses local `{ advisor?: { backend?: string } }` shape instead of importing BackendId from src/advisor/types.ts. Reason — BackendId admits "portable-fork", but the resolver narrows to the schema's `"native" | "fork"` enum. Loose-input/strict-output keeps the resolver decoupled from the BackendId type and provides defensive narrowing against future type drift between BackendId and the schema enum.
  - Model string stored verbatim. The SDK call site (Plan 117-04 wires Options.advisorModel) calls Plan 117-02's resolveAdvisorModel in src/manager/model-resolver.ts to canonicalise "opus" → "claude-opus-4-7". The loader-level resolver here is operator-alias-passthrough only; canonicalisation is single-sourced.
  - Both defaults.advisor AND agents[].advisor stay `.optional()` at the parent level. Pre-117 yaml — every existing operator config parses byte-identical with advisor undefined. Loader resolvers handle the hardcoded baseline {backend:"native", model:"opus", maxUsesPerRequest:3, caching:{enabled:true, ttl:"5m"}} when both are undefined.
metrics:
  duration: ~25 minutes
  completed: 2026-05-13
  tasks: 6/6
  files_changed: 4 (2 modified, 2 created)
  tests_added: 39 (19 schema + 20 loader/round-trip)
  test_count_delta: 488 → 527 passed across src/config/ (pre-existing 1 fail + 2 file-load fails unchanged)
---

# Phase 117 Plan 06: Config schema `advisor` block + loader resolvers Summary

**One-liner:** Zod schema for `defaults.advisor.{backend, model, maxUsesPerRequest, caching}` + per-agent partial override at `agents[].advisor` + four module-level loader resolvers with per-agent → defaults → hardcoded-baseline fall-through, locked enum rejects `"portable-fork"`.

## What landed

This plan lays the config-layer scaffolding for Phase 117's feature-flag rollout — the swap from the legacy fork advisor backend to the native SDK `advisorModel` option. The shape mirrors Phase 110 Stage 0b's `defaults.shimRuntime` canary dial: operators can flip any one agent back to `fork` via `clawcode reload` without a redeploy. The locked `backend: "native"` baseline is what makes the swap the upgrade rather than an opt-in.

Four module-level resolvers ship for consumption by later plans in this phase:

- `resolveAdvisorBackend(agent, defaults)` — Plan 117-07 IPC handler gate, Plan 117-08 capability manifest
- `resolveAdvisorModel(agent, defaults)` — Plan 117-04 wires `Options.advisorModel` at session create/resume
- `resolveAdvisorMaxUsesPerRequest(agent, defaults)` — Plan 117-04/07 per-request budget cap
- `resolveAdvisorCaching(agent, defaults)` — Plan 117-04 prompt-cache toggle (per-field independence so operators flip one knob at a time)

## Files

### Modified

- **`src/config/schema.ts`** (~140 net-new lines)
  - Helper schemas at lines ~1112–1180: `advisorBackendSchema` (locked `["native","fork"]` enum), `advisorCachingSchema` (defaults-side with `enabled:true/ttl:"5m"` populated), `advisorConfigSchema` (all four defaults-side fields with defaults), `agentAdvisorOverrideSchema` (per-agent partial — caching uses raw shape WITHOUT defaults).
  - `agentSchema.advisor: agentAdvisorOverrideSchema.optional()` added at the per-agent override slot, mirroring `shimRuntime`'s placement at line ~1243.
  - `defaultsSchema.advisor: advisorConfigSchema.optional()` added near the fleet-wide `shimRuntime` block at line ~1888.

- **`src/config/loader.ts`** (+116 lines)
  - Four exported module-level resolvers added immediately after `resolveOutputDirTemplate` (~line 1024).
  - Pattern mirrors the inner `resolveRuntime` fall-through at line 392 AND the module-level `resolveOutputDirTemplate` style.

### Created

- **`src/config/__tests__/schema-advisor.test.ts`** (19 assertions)
  - A/B: backend enum admits `"native"` + `"fork"`
  - C: rejects `"portable-fork"` at defaults with Zod 4 issue shape (`"Invalid option"` + allowed-values + path)
  - D/E: `maxUsesPerRequest` range 1–10
  - F/G: per-agent partial-shape + back-compat (omitted block parses unchanged)
  - Direct helper-schema pinning so a future contributor cannot widen the enum without flipping the Phase 117→118 gate

- **`src/config/__tests__/loader-advisor.test.ts`** (20 assertions)
  - Resolver fall-through for all four resolvers (per-agent → defaults → baseline)
  - Defensive narrowing on backend (unknown string → `"native"`)
  - Per-field caching independence (operator overrides `enabled` while accepting fleet `ttl`)
  - YAML round-trip: `loadConfig` → end-to-end resolver firing on disk; in-memory `stringify`/`parse` deep-equal; `loadConfig → stringify → loadConfig` produces identical parsed shape AND resolver outputs
  - Back-compat: yaml with no `advisor` block parses and resolvers return hardcoded baselines

## Commits

| Hash      | Task | Subject                                                       |
| --------- | ---- | ------------------------------------------------------------- |
| `1dd3d7a` | T02  | add advisorConfigSchema + wire defaults.advisor               |
| `215de31` | T03  | per-agent advisor override in agentSchema                     |
| `06c72f7` | T04  | module-level advisor resolvers in loader.ts                   |
| `756fe5f` | T05  | schema-advisor tests (19 assertions)                          |
| `e3bda14` | T06  | loader resolver + YAML round-trip tests (20 assertions)       |

(T01 was read-only orientation per plan — no commit.)

## Test count

| Scope                | Before | After | Delta |
| -------------------- | -----: | ----: | ----: |
| `src/config/` passed |    488 |   527 |   +39 |
| `src/config/` failed |      1 |     1 |     0 (pre-existing — clawcode.yaml not on disk; operator-owned) |
| New test files       |      0 |     2 |    +2 |

Pre-existing test-file failures across `src/config/` (unrelated to this plan):

- `clawcode-yaml-phase100-fu-mcp-env-overrides.test.ts` (ENOENT on operator yaml)
- `clawcode-yaml-phase100.test.ts` (ENOENT on operator yaml)
- `schema.test.ts > PR11: parse-regression` (ENOENT on operator yaml)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] Schema helper placement moved to satisfy declaration order**

- **Found during:** T03 (typecheck failed with TS2448 — `agentAdvisorOverrideSchema` used before declaration)
- **Issue:** The plan T02 step 1 placed the helper schemas at a "near other helper schemas" location, which in the existing file is *after* `agentSchema`. When T03 added `advisor: agentAdvisorOverrideSchema.optional()` to `agentSchema`, TypeScript rejected the forward reference.
- **Fix:** Relocate all four advisor helper schemas from just-before-`defaultsSchema` to just-before-`agentSchema`. Both `agentSchema` (line 1115) and `defaultsSchema` (line ~1535) now see the helpers above their declarations. No behavior change — pure ordering.
- **Files modified:** `src/config/schema.ts`
- **Captured in commit:** T03 commit body (`215de31`)

**2. [Rule 1 - Bug] Per-agent caching schema diverged from defaults-side to preserve operator-explicit-vs-omitted**

- **Found during:** T05 (test "accepts a partial caching override (`enabled` only)" failed — `ttl` was populated to `"5m"` at parse time even though the operator did not set it).
- **Issue:** The plan T03 step 2 used `caching: advisorCachingSchema.partial().optional()` for the per-agent shape. Zod 4's `.partial()` makes inner fields optional but does NOT strip inner `.default()`s, so an operator setting only `{enabled: false}` would silently have `ttl: "5m"` injected at parse. That kills `resolveAdvisorCaching`'s per-field fall-through to `defaults.advisor.caching.ttl` — defeating the whole point of partial override.
- **Fix:** Replace the per-agent caching schema with a raw `z.object({enabled: z.boolean().optional(), ttl: z.enum(...).optional()}).optional()`. The defaults-side `advisorCachingSchema` keeps its inner defaults (where they belong); the per-agent override stays operator-explicit-vs-omitted at the boundary.
- **Files modified:** `src/config/schema.ts`
- **Captured in commit:** T05 commit body (`756fe5f`)

**3. [Rule 1 - Bug] Test fixture yaml `version` field corrected**

- **Found during:** T06 (`loadConfig` rejected `version: 2.2` with `"expected 1"`)
- **Issue:** The plan T06 step 2 didn't specify a config version. I initially wrote `version: 2.2` (matching the CLAUDE.md "v2.2 skills migration" terminology). The actual schema literal is `z.literal(1)` at line 2184.
- **Fix:** Changed `version: 2.2` → `version: 1` in all three yaml test fixtures.
- **Files modified:** `src/config/__tests__/loader-advisor.test.ts`
- **Captured in commit:** T06 commit body (`e3bda14`)

### Architectural decisions made WITHOUT user consultation (Rule 4 candidates that didn't qualify)

- **Resolver argument types use loose `{ advisor?: { backend?: string } }` shapes rather than importing `BackendId` from `src/advisor/types.ts`.** Reason — `BackendId` admits `"portable-fork"`, but the resolver's return type narrows to the schema enum `"native" | "fork"`. The loose-input/strict-output shape is defensive against future type drift between `BackendId` and the schema. Not a Rule 4 because the plan T04 example code explicitly used `BackendId` import, but the function signature in the plan also said `Promise<"native" | "fork">` — those two are incompatible unless I narrow. I narrowed.

## Authentication gates

None encountered.

## Out of scope (NOT done — by design)

- Wiring `Options.advisorModel` to the SDK call site — Plan 117-04
- IPC handler dispatch re-point in `daemon.ts` — Plan 117-07
- Capability manifest backend surfacing — Plan 117-08
- `clawcode.example.yaml` documentation — Plan 117-10

## Known Stubs

None. All exports are live and consumed by tests; no UI-facing placeholder data.

## Self-Check: PASSED

- `src/config/__tests__/schema-advisor.test.ts` exists — FOUND
- `src/config/__tests__/loader-advisor.test.ts` exists — FOUND
- Commit `1dd3d7a` (T02) — FOUND in `git log`
- Commit `215de31` (T03) — FOUND in `git log`
- Commit `06c72f7` (T04) — FOUND in `git log`
- Commit `756fe5f` (T05) — FOUND in `git log`
- Commit `e3bda14` (T06) — FOUND in `git log`
- `npm run typecheck` — clean (zero errors)
- `npm test -- src/config/__tests__/schema-advisor.test.ts src/config/__tests__/loader-advisor.test.ts` — 39/39 green
- `npm test -- src/config/` — 527 passed (+39 from baseline 488), 1 pre-existing fail unchanged
