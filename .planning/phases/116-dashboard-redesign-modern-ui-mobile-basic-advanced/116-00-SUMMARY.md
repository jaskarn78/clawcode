---
phase: 116
plan: 00
title: SPA scaffolding + Finding B fix + F02 backend
subsystem: dashboard
tags: [dashboard, spa, scaffolding, slos, fonts, react, vite, tailwind, shadcn]
completed: 2026-05-11
duration_minutes: ~95
tasks_completed: 10
files_modified:
  - package.json
  - package-lock.json
  - tsconfig.json
  - src/performance/slos.ts
  - src/performance/__tests__/resolve-slo-for.test.ts (new)
  - src/manager/daemon.ts
  - src/dashboard/server.ts
dependency_graph:
  requires: []
  provides:
    - SPA build pipeline (npm run build → dist/cli/index.js + dist/dashboard/spa/)
    - /dashboard/v2 static route alongside untouched / route
    - DEFAULT_MODEL_SLOS + resolveSloFor() helper
    - useAgents / useAgentCache / useSse / useViewMode foundation hooks
    - Tier 1 shadcn primitives (card / badge / progress / command / dialog / etc.)
    - Self-hosted WOFF2 font set (Cabinet Grotesk / Geist / JetBrains Mono)
  affects:
    - All subsequent Phase 116 plans (116-01 through 116-06)
    - Phase 999.38 absorbed as F02 backend (closes-eligible after F03 ships in 116-01)
tech_stack:
  added:
    - vite@8.0.12, @vitejs/plugin-react@6.0.1
    - react@19.2.6, react-dom@19.2.6
    - @tanstack/react-query@5.x, recharts@3.x, lucide-react, cmdk
    - tailwindcss@3.4.19, postcss, autoprefixer
    - class-variance-authority, clsx, tailwind-merge
    - @radix-ui/react-{dialog,popover,progress,separator,slot,tooltip,scroll-area}
    - @testing-library/react, @testing-library/jest-dom
  patterns:
    - SSE → TanStack Query cache bridge (singleton EventSource, push-driven invalidation)
    - HSL CSS variables for shadcn primitives + named hex tokens for app-specific surfaces
    - Single-root node_modules; client/package.json carries scripts only
key_files:
  created:
    - src/performance/__tests__/resolve-slo-for.test.ts
    - src/dashboard/client/ (full Vite tree — vite.config.ts, tailwind.config.js, postcss.config.js, components.json, public/fonts/*.woff2 (10 files), src/{App,main,index.css,lib/utils.ts,hooks/useSse.ts,hooks/useApi.ts,hooks/useViewMode.tsx,components/ui/*.tsx (10 shadcn primitives)})
  modified:
    - src/performance/slos.ts — added DEFAULT_MODEL_SLOS, resolveSloFor, ResolveSloInput, ResolvedAgentSlos
    - src/manager/daemon.ts — case "cache" augmentation extended with computeSloFields
    - src/dashboard/server.ts — STATIC_SPA_DIR + serveSpaAsset + 3 /dashboard/v2/* route branches + extended MIME_TYPES
    - tsconfig.json — exclude src/dashboard/client/** so the Vite tree uses its own tsconfig
    - package.json — build script chains tsup → copy-assets → build:spa; build:spa + dev:spa scripts; 19 client devDeps added
decisions:
  - F02 schema preservation — kept the existing segment-based `sloOverrideSchema` and `agents[*].perf.slos[]` mechanism; added per-model defaults as a SIBLING constant (DEFAULT_MODEL_SLOS) rather than restructuring the locked shape. resolveSloFor() consults the existing override list when looking up first_token p50.
  - shadcn manual init — shadcn@4.x and 2.x both reject Tailwind 3.4 + parent-directory node_modules; wrote components.json manually with the locked New York / neutral / CSS-vars config rather than fight the wizard. shadcn add (Tier 1 component set) ran cleanly against the hand-rolled config.
  - Per-model SLO thresholds remained at the locked values (sonnet 6s / opus 8s / haiku 2s first_token p50). NO threshold re-derivation against fleet data — operator review locked them.
  - T01 Finding B fix DEFERRED — see Must-haves section below.
must_haves:
  - id: '#1'
    text: dist/cli/index.js contains 'function iterateWithTracing'
    status: NOT_SATISFIED
    rationale: deferred via T01 finding (root cause: dead-code path, not cache)
  - id: '#2'
    text: dist/cli/index.js contains ≥4 producer call sites
    status: NOT_SATISFIED
    rationale: same as #1 — producer call sites live in iterateWithTracing which is no longer the production path
  - id: '#3'
    text: npm run build produces both dist/cli/index.js AND dist/dashboard/spa/index.html
    status: SATISFIED
    rationale: T04 wired tsup → copy-assets → build:spa into a single root build
  - id: '#4'
    text: /dashboard/v2/ returns Vite-built React shell rendering live agent count from SSE
    status: SATISFIED (with caveat)
    rationale: SPA shell serves correctly with React+EventSource+useAgents wiring; verified via stub IPC + JS bundle static inspection. First-tab browser-runtime render lands in Plan 116-01 against real shadcn-styled Tier 1 cards.
  - id: '#5'
    text: / returns old dashboard byte-identical to pre-116
    status: SATISFIED
    rationale: Smoke test compared bytes of `/` response against src/dashboard/static/index.html — equal. No edits to the v1 route or assets.
  - id: '#6'
    text: /api/agents/:name/cache includes per-model resolved SLO
    status: SATISFIED
    rationale: T02 wired resolveSloFor into the daemon's case "cache" augmentation; 4 references to resolveSloFor / computeSloFields confirmed in bundle; unit tests pin the resolution paths (12 tests, all pass).
metrics:
  bundle_js_kb: 263
  bundle_js_gzip_kb: 82
  bundle_css_kb: 18
  bundle_css_gzip_kb: 4.5
  tests_added: 12
  tests_passing_in_perf_suite: 185
  shadcn_components_installed: 10
  woff2_fonts_self_hosted: 10
  commits: 10  # T01 doc + T02-T10 code
---

# Phase 116 Plan 00: SPA scaffolding + Finding B fix + F02 backend — Summary

**One-liner:** Stood up the Vite + React 19 + shadcn dashboard SPA at `/dashboard/v2/` with self-hosted fonts, foundation SSE/Query/view-mode hooks, and the F02 per-model SLO backend; deferred the Phase 115-08 producer regression after T01 root-caused it as a dead-code path, not a stale build.

## Tasks Executed

| Task | Status | Commit | Notes |
|------|--------|--------|-------|
| T01 — Finding B repro + cache wipe + verify | ✓ (deferred) | `8bfb3cc` | Cache wipe insufficient; producer call sites live in `session-adapter.ts:iterateWithTracing` which production no longer calls (`daemon.ts` → `SdkSessionAdapter` → `createPersistentSessionHandle` → `iterateUntilResult`, which has no producer wiring). Documented in 116-DEFERRED.md. F07 in 116-02 will fall back to `trace_spans`. |
| T02 — F02 backend (per-model SLOs + override resolver) | ✓ | `cecb24d` | Added `DEFAULT_MODEL_SLOS`, `resolveSloFor`, `ResolveSloInput`, `ResolvedAgentSlos`; wired into `case "cache"` augmentation in daemon.ts. 12 unit tests cover all 4 resolution paths + locked-threshold pinning. |
| T03 — Vite + React 19 SPA bootstrap | ✓ | `cdd1177` | `npm create vite@latest client -- --template react-ts --yes` succeeded; client/package.json stripped to scripts-only; vite.config.ts wired with `base: '/dashboard/v2/'`, `outDir: <root>/dist/dashboard/spa`, `@` alias. |
| T04 — Build pipeline integration | ✓ | `cfb869f` | `npm run build` now chains `tsup && npm run copy-assets && npm run build:spa`. Both bundles produce from a single command. |
| T05 — `/dashboard/v2` static route | ✓ | `98436fc` | `STATIC_SPA_DIR` + binary-safe `serveSpaAsset` + extended `MIME_TYPES`; 3 route branches (`/dashboard/v2`, `/dashboard/v2/assets/*`, `/dashboard/v2/*`) BEFORE the v1 `/` route. v1 routes untouched. 6-test smoke verified. |
| T06 — Tailwind config + WOFF2 fonts | ✓ | `392ee64` | tailwind.config.js with locked tokens (bg.base #0e0e12, primary #10b981, fg.1 #f4f4f5, etc.), 5-breakpoint screens override; 10 self-hosted WOFF2 files (Cabinet Grotesk 400/500/700, Geist 300/400/500/600, JetBrains Mono 400/500/600) all verified as valid WOFF2. |
| T07 — shadcn/ui Tier 1 components | ✓ | `9834c97` | Manual `components.json` + canonical `cn()` helper; 10 primitives installed (`card badge progress command tooltip separator dialog button skeleton scroll-area`); shadcn HSL CSS-var layer added to index.css mapped onto Phase 116 tokens. |
| T08 — useSse + useApi foundation hooks | ✓ | `cfe7632` | Singleton EventSource bridge from `/api/events` to TanStack Query cache; 7 hook wrappers around the daemon's REST endpoints. Verified event names against src/dashboard/sse.ts emitters. |
| T09 — useViewMode + ViewModeProvider | ✓ | `2cfcfe3` | Basic/Advanced toggle; localStorage `dashboard.viewMode` persistence; viewport-based default (<1024px → basic). Throws caller-bug if used outside provider. |
| T10 — Smoke component (agent card grid) | ✓ | `38deaca` | Header (connection dot, brand, agent count, mode toggle) + responsive grid (sm:1 / md:2 / lg:3 / xl:4) of shadcn `<Card>` per agent with name + model `<Badge>`. 8-test smoke verified end-to-end stack. |

## Must-haves

| # | Clause | Status | Rationale |
|---|--------|--------|-----------|
| 1 | `dist/cli/index.js` contains `function iterateWithTracing` | **NOT SATISFIED** | Deferred via T01 finding. Producer call sites live in `session-adapter.ts:iterateWithTracing` which production no longer executes (live path: `persistent-session-handle.ts:iterateUntilResult`, which lacks the producer wiring). Cache-wipe-and-rebuild produced a bundle that faithfully reflects the source; the bug is deeper. Tracked in 116-DEFERRED.md with the fix-required-and-deferred section. |
| 2 | `dist/cli/index.js` contains ≥4 producer call sites | **NOT SATISFIED** | Same root cause as #1. The 4 call sites in `session-adapter.ts` (lines 1403, 1419, 1465, 1476, 1607) belong to a function that's only invoked through the test-only `wrapSdkQuery` path; they need to be ported into `persistent-session-handle.ts:iterateUntilResult`. Estimated ~1-2h follow-up. |
| 3 | `npm run build` produces both daemon + SPA bundles | ✓ | T04 chained `tsup && copy-assets && build:spa`. Verified — `rm -rf dist && npm run build` produces both `dist/cli/index.js` (2.5MB) and `dist/dashboard/spa/index.html` + assets. |
| 4 | `/dashboard/v2/` returns Vite-built shell rendering live agent count | ✓ (with caveat) | SPA shell serves with `<div id="root">`; bundle wires EventSource + `/api/events` + `/api/status` + `dashboard.viewMode` (all verified by static bundle inspection from the smoke test). Browser-runtime first-paint of the agent card grid against real fleet data lands in Plan 116-01. |
| 5 | `/` returns old dashboard byte-identical | ✓ | Smoke test compared bytes of `/` response against `src/dashboard/static/index.html` — equal. Zero edits to the v1 routes or assets. |
| 6 | `/api/agents/:name/cache` includes per-model resolved SLO | ✓ | T02 wired `resolveSloFor` into the `case "cache"` augmentation in daemon.ts; bundle contains 4 references. Unit tests pin the resolution shape: `{ first_token_p50_ms, source, model, model_defaults }`. |

**Net:** 4 of 6 must_haves satisfied; 2 deferred with a clear follow-up plan. The deferrals were anticipated by Plan 116-00's deviation handling section ("If T01 cache wipe doesn't recover producer call sites, document in 116-DEFERRED.md, mark Finding B as needing deeper investigation, proceed with the plan. F07 in 116-02 will fall back to trace_spans"), so this is not a process failure — it's the planned fallback path firing.

## Deviations from Plan

### T01 — cache wipe insufficient; deeper fix deferred

The audit hypothesized stale esbuild cache was dropping the producer call sites. After `rm -rf dist node_modules/.cache && npm run build`, the bundle was unchanged. Root cause: TWO parallel session-handle implementations exist in source, and the one carrying the Phase 115-08 producer wiring (`session-adapter.ts:iterateWithTracing`) is only invoked through the test-only `wrapSdkQuery` path. Production goes through `persistent-session-handle.ts:iterateUntilResult` which lacks the producer wiring entirely. Per the plan's documented fallback ("If T01 cache wipe doesn't recover producer call sites, document in 116-DEFERRED.md, proceed with the plan, F07 in 116-02 falls back to `trace_spans`"), proceeded with the remaining tasks. Tracked in 116-DEFERRED.md.

### T02 — schema preservation (advisor-flagged)

Plan T02 step 3 said "Add optional `agents[*].perf.slos` field" with "the same shape" as the new per-model defaults — but `src/config/schema.ts:63` already defined `sloOverrideSchema` as segment-based, and `agents[*].perf.slos[]` already exists. Two shapes would collide. Resolution: preserved the existing schema, added per-model defaults as a sibling `DEFAULT_MODEL_SLOS` constant, made `resolveSloFor` consult the existing override mechanism (looking for `{ segment: 'first_token', metric: 'p50' }` to win over the model default). Zero schema migration needed; downstream callers of `sloOverrideSchema` / `DEFAULT_SLOS` / `mergeSloOverrides` keep working unchanged. Per-agent override path is exactly as planned, just via the existing surface.

### T06 — Cabinet Grotesk 600 weight unavailable

Plan T06 step 2 specified Cabinet Grotesk weights 400/500/600/700. Fontshare's CSS API only ships 400/500/700 for Cabinet Grotesk (verified by direct `curl` against `https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@400,500,600,700`). Shipped the available 3 weights; Tailwind's `font-medium` (500) + `font-bold` (700) cover typical headline cases. If 600 surfaces as a real need during 116-01+ design execution, promote to a follow-up to either request the weight from ITF or substitute a near-weight from a different family.

### T07 — shadcn init manual

Plan T07 step 1 specified `npx shadcn@latest init`. Both shadcn 4.x (current — requires Tailwind 4 CSS-first config) and 2.x (legacy) refused to initialize against Tailwind 3.4 + parent-directory `node_modules`. Wrote `components.json` manually with the locked config (New York / neutral / CSS variables / lucide); `shadcn add` accepted the hand-rolled config and installed all 10 Tier 1 components cleanly. Also manually added the canonical `src/lib/utils.ts` (`cn()` helper) and the shadcn HSL CSS-variable layer in `index.css`, plus the matching utilities in `tailwind.config.js`.

## Auth Gates

None. All work was local to the workspace; no Discord / 1Password / API operations required authentication during execution.

## Threat Flags

None new. The `/dashboard/v2/*` route surface is purely static-file serving against the same `dist/dashboard/` parent dir as v1; it inherits the existing dashboard's local-only binding pattern (`127.0.0.1` default per `startDashboardServer`). The F02 SLO surface adds a read-only telemetry field to an existing read-only endpoint — no trust-boundary change.

## Known Stubs

None. The smoke component (`App.tsx`) renders real fleet data flowing through `useAgents()` against the daemon's `/api/status`. The empty-state and error-state branches are intentional (not stubs) — they handle the case where the daemon is unreachable or has no agents configured.

## Deferred Issues

Only Finding B (see Must-haves #1 + #2 above). Appended to `116-DEFERRED.md` with a full root-cause writeup, the deeper-fix plan, and the F07-fallback path for Plan 116-02.

## Self-Check

Created files exist:
- `.planning/phases/116-dashboard-redesign-modern-ui-mobile-basic-advanced/116-DEFERRED.md` — updated (FOUND)
- `src/performance/__tests__/resolve-slo-for.test.ts` — FOUND
- `src/dashboard/client/vite.config.ts` — FOUND
- `src/dashboard/client/tailwind.config.js` — FOUND
- `src/dashboard/client/components.json` — FOUND
- `src/dashboard/client/src/hooks/useSse.ts` — FOUND
- `src/dashboard/client/src/hooks/useApi.ts` — FOUND
- `src/dashboard/client/src/hooks/useViewMode.tsx` — FOUND
- `src/dashboard/client/src/lib/utils.ts` — FOUND
- `src/dashboard/client/src/App.tsx` — FOUND (replaced Vite scaffold)
- `src/dashboard/client/public/fonts/{CabinetGrotesk,Geist,JetBrainsMono}-*.woff2` — 10 files FOUND
- `src/dashboard/client/src/components/ui/*.tsx` — 10 shadcn primitives FOUND

Commits exist in git log (verified):
- `8bfb3cc` T01 docs (Finding B deferred)
- `cecb24d` T02 F02 backend
- `cdd1177` T03 Vite scaffold
- `cfb869f` T04 build pipeline
- `98436fc` T05 /dashboard/v2 route
- `392ee64` T06 Tailwind + WOFF2
- `9834c97` T07 shadcn
- `cfe7632` T08 hooks
- `2cfcfe3` T09 view mode
- `38deaca` T10 smoke component

## Self-Check: PASSED

## Notes for downstream plans

- **116-01 (Tier 1 read-only):** the smoke `App.tsx` should be replaced with the real Tier 1 component grid (F03 agent tile, F01 SLO breach banner, F02 per-model SLO gauges consuming `useAgentCache().slos`, F04 Tier-1 budget meter, F05 tool cache gauge). All hooks + design tokens + shadcn primitives are ready.
- **116-02 (Tier 1 interactivity):** F07 tool latency split panel MUST use `trace_spans` (per-tool execution durations from `/api/agents/:name/tools`) instead of the new `traces` columns until Finding B's deeper fix lands. F06 Cmd+K palette uses the shadcn `command.tsx` primitive shipped here.
- **116-03 (Tier 1.5 workflow):** F26 config editor, F27 conversations view, F28 task assignment — all need new daemon-side IPC handlers; the SPA framework here is ready to consume them.
- **Bundle size watch:** 263KB JS / 82KB gzip is a fine starting point but Tier 2 plans will push past 400KB without code-splitting. Recommend route-level lazy imports when 116-04 lands the trace waterfall + cross-agent IPC inbox.
