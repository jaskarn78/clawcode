---
phase: 110-mcp-memory-reduction-shim-runtime-swap
plan: 02
subsystem: config-schema-loader-observability
tags: [phase-110, stage-0b, shim-runtime, schema, loader, fleet-stats, tdd]
requirements: [0B-RT-02, 0B-RT-03, 0B-RT-10]
dependency_graph:
  requires:
    - "110-00 (Wave 0 spike + kill-switch gate)"
  provides:
    - "Operator dial: defaults.shimRuntime.{search,image,browser} accepts 'static' / 'python' (still defaults to 'node')"
    - "Loader rewrites command/args per runtime — Wave 2 just needs the binary at /usr/local/bin/clawcode-mcp-shim for an operator flip to take effect"
    - "fleet-stats /api endpoint surfaces runtime: 'static' for spawned Go shims (basename match — works for canonical and dev-build paths)"
    - "Shared resolveShimCommand helper exported from src/config/loader.ts so spawn shape (loader) and proc-scan regex shape (daemon) stay in lockstep"
  affects:
    - "src/manager/daemon.ts fleet-stats IPC handler — now derives autoInjected command/args from shimRuntimeCfg via resolveShimCommand"
tech_stack:
  added: []
  patterns:
    - "Pure resolver function shared between loader auto-inject and daemon proc-scan to keep spawn/match shapes in sync (single source of truth pattern)"
    - "Basename-match runtime classification (path-agnostic) so dev-builds at non-canonical paths still register correctly in /api/fleet-stats"
key_files:
  created:
    - "src/config/__tests__/shim-runtime-enum.test.ts"
  modified:
    - "src/config/schema.ts (lines 1626-1659 — enum widen + comment update)"
    - "src/config/loader.ts (constants + resolveShimCommand helper + 3 auto-inject blocks rewired)"
    - "src/config/__tests__/loader.test.ts (+8 runtime-conditional tests in new describe block)"
    - "src/manager/fleet-stats.ts (+ classifyShimRuntime exported function)"
    - "src/manager/__tests__/fleet-stats.test.ts (+ classifier describe + mixed-runtime aggregation describe)"
    - "src/manager/daemon.ts (autoInjected derives command/args from resolveShimCommand — Rule 2 deviation)"
decisions:
  - "Inlined the runtime constants + resolveShimCommand helper in src/config/loader.ts (not a sibling module) so the plan's acceptance grep (`grep -E 'function resolveShimCommand' src/config/loader.ts`) still matches verbatim. Daemon imports from loader.ts directly."
  - "Made resolveShimCommand the single source of truth for both spawn shape (loader.ts) and proc-scan regex shape (daemon.ts:fleet-stats handler). Without this wiring, an operator who flipped shimRuntime.search → static would see the running Go binary become invisible to /api/fleet-stats — encoded as a Rule 2 deviation in this plan's commits."
  - "Basename-match in classifyShimRuntime (split('/').pop()) instead of full-path regex so dev-build static shims at non-canonical paths still classify correctly."
  - "Distinguished 'python' (clawcode-mcp-shim.py) from 'external' (brave_search.py, fal_ai.py) by argv[1] basename inspection. This preserves Stage 0a's external-classification behavior for the existing Python externals — they continue to land in shimRuntimeBaseline=null, not in a python cohort."
metrics:
  completed: "2026-05-06T14:09:00Z"
---

# Phase 110 Plan 02: MCP shim runtime swap — Stage 0b schema + loader + observability

**One-liner:** Three-task coupled change widens the operator dial (`defaults.shimRuntime.{search,image,browser}`) from `["node"]` to `["node","static","python"]`, rewires the loader's auto-inject to emit the alternate-runtime command/args via a shared `resolveShimCommand` helper, and teaches `/api/fleet-stats` to classify the spawned `clawcode-mcp-shim` Go binary as `runtime: "static"` — all guarded by 24 new tests (TDD throughout) and the operator-locked fail-loud crash policy encoded by the absence of any try/catch around the alternate-runtime path.

## Tasks Completed

### Task 1: Schema enum widen (RED → GREEN)

- **RED commit `89b3cd4`** — added `src/config/__tests__/shim-runtime-enum.test.ts` with six tests pinning the post-widen enum shape: accepts `node`/`static`/`python`, rejects `rust`, default-preserves `node`, supports per-type independence (search=static, image=node, browser=python).
- **GREEN commit `a58021e`** — widened `defaults.shimRuntime.{search,image,browser}` from `z.enum(["node"])` to `z.enum(["node","static","python"])` in `src/config/schema.ts:1653-1657`. Default still `"node"` so existing operator config is byte-identical. Comment block expanded to document the crash-fallback policy (fail loud, no auto-fall-back) per CONTEXT.md operator decision.

### Task 2: Loader auto-inject — runtime-conditional command/args (RED → GREEN)

- **RED commit `aa09ea2`** — added a new `Phase 110 Stage 0b — runtime-conditional auto-inject` describe block to `src/config/__tests__/loader.test.ts` with 18 tests (3 shim types × 4 cases each + per-type-independence + fail-loud assertion).
- **GREEN commit `36a4e1a`** — added in `src/config/loader.ts`:
  - `STATIC_SHIM_PATH = "/usr/local/bin/clawcode-mcp-shim"` (Wave 2 deploy target)
  - `PYTHON_SHIM_PATH = "/usr/local/bin/clawcode-mcp-shim.py"` (reserved)
  - `resolveShimCommand(type, runtime)` pure helper returning `{ command, args }`
  - The three existing auto-inject blocks (browser/search/image) were rewired to call `resolveShimCommand`. Default `"node"` branch produces byte-identical output to Stage 0a.
  - **No try/catch around the alternate-runtime path. No pre-detection. No fallback.** Acceptance criteria `! grep -E '(fallback|fall.?back).*node' src/config/loader.ts` returns 0 hits.

### Task 3: Fleet-stats classification (RED → GREEN)

- **RED commit `8854ec0`** — added `classifyShimRuntime — Phase 110 Stage 0b cmdline classification` describe block to `src/manager/__tests__/fleet-stats.test.ts` with six tests (node/static/static-dev-path/python/python-external-distinction/external-fallback) + a mixed-runtime aggregation integration test.
- **GREEN commit `7730e1f`** — added `classifyShimRuntime(cmdline)` exported function to `src/manager/fleet-stats.ts`. Basename match (`split("/").pop()`) so dev-builds at non-canonical paths still classify. `python3` / `python` argv0 distinguishes the Stage 0b reserved translator (argv[1] basename === `clawcode-mcp-shim.py`) from generic Python externals (brave_search.py, fal_ai.py — preserved as `external`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Wired daemon fleet-stats to use resolveShimCommand**

- **Found during:** Task 3 review of acceptance criteria + advisor consultation
- **Issue:** The plan's Task 3 describes adding a per-cmdline classifier to `fleet-stats.ts`, but the actual architecture pre-tags runtime via `mcpPatterns` constructed in `src/manager/daemon.ts:4262-4304`'s `autoInjected` array. Stage 0a hardcoded that array's command/args as `clawcode <type>-mcp` regardless of `shimRuntimeCfg`. Result: when an operator flipped `shimRuntime.search → "static"`, the loader spawned `/usr/local/bin/clawcode-mcp-shim --type search`, but the daemon constructed a regex matching `clawcode search-mcp` — the static shim was invisible to `/api/fleet-stats`. This contradicts CONTEXT.md's success criterion: *"Operator can flip `defaults.shimRuntime.search: static`... and the loader will produce the static command/args... dashboard shows runtime: static"*.
- **Fix:** Imported `resolveShimCommand` and `ShimRuntime` from `src/config/loader.ts` into `src/manager/daemon.ts`. The `autoInjected` array now derives command/args from `shimRuntimeCfg[type]` via the same helper the loader uses — single source of truth, spawn shape and proc-scan regex shape stay in lockstep.
- **Files modified:** `src/manager/daemon.ts`
- **Commit:** `906f392`

### Auth Gates

None. Fully autonomous execution.

## Crash-fallback policy verification

Acceptance verified by absence:

```
$ grep -cE '(fallback|fall.?back).*node' src/config/loader.ts
0
$ grep -B2 -A4 'STATIC_SHIM_PATH' src/config/loader.ts | grep -cE "try\s*\{|catch\s*\("
0
```

The schema comment, loader comment, and Rule 2 deviation comment in `daemon.ts` all document the operator-locked decision: *"Fail loud, NO auto-fall-back to Node. Surface segfaults; do not silently degrade."*

## Acceptance Criteria — full pass

```
Task 1:
  enum widen hits (expect 3): 3
  default node hits (expect ≥3): 3
  fail-loud comment (expect ≥1): 1
  single-value-enum gone (expect 0): 0
  6 shim-runtime-enum tests: PASS
  tsc --noEmit (excluding pre-existing src/usage/budget.ts:138): clean

Task 2:
  STATIC_SHIM_PATH literal: PASS
  PYTHON_SHIM_PATH literal: PASS
  function resolveShimCommand: PASS
  resolveShimCommand( call sites (expect ≥3): 4 (helper def + 3 call sites)
  defaults.shimRuntime?.<type> reads (expect ≥3): 3
  fallback.*node hits (expect 0): 0
  try/catch around STATIC_SHIM_PATH (expect 0): 0
  18 new runtime-conditional tests: PASS
  tsc --noEmit: clean

Task 3:
  clawcode-mcp-shim hits in fleet-stats.ts: 7
  "static" return literals: 4
  clawcode-mcp-shim.py hits: 4
  basename .split("/").pop(): present
  6 classifier tests + 1 aggregation integration test: PASS
  tsc --noEmit: clean
```

## Test Counts

- New tests added: **24** (6 schema + 12 loader runtime-conditional + 6 classifier)
- Plus extended: **6** loader runtime-conditional tests inside the same describe (per-type variants), and **1** mixed-runtime aggregation test in fleet-stats.
- All new tests pass; no regressions on previously-passing tests in touched files.

## Known Stubs

None. The "python" enum value is RESERVED for a future implementation — explicitly documented in schema comment, loader comment, and `classifyShimRuntime` comment. The reserved path triggers `runtime: "python"` classification and the loader emits the python3 command, but the actual Python translator binary does not exist (no operator can flip to it productively until it ships). This is documented as the deferred Stage-future implementation; not a hidden stub.

## Deferred Issues

See `.planning/phases/110-mcp-memory-reduction-shim-runtime-swap/deferred-items.md` for the full list of pre-existing test failures observed during execution (daemon-openai.test.ts, system-prompt-directives count drift, ENOENT for clawcode.yaml fixture, etc.) — none are caused by this plan's changes.

## Self-Check: PASSED

- Files created: `src/config/__tests__/shim-runtime-enum.test.ts` — FOUND
- Commits exist: 89b3cd4, a58021e, aa09ea2, 36a4e1a, 8854ec0, 7730e1f, 906f392 — all FOUND in `git log`
