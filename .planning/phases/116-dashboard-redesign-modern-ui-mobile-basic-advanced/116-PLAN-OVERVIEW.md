---
phase: 116
title: Dashboard redesign — wave decomposition + plan-phase overview
created: 2026-05-11
approved_by: operator (plan-mode review)
plan_file: ~/.claude/plans/yes-indexed-fountain.md
status: PLANNED — 7 plans across 4 waves, awaiting execution
---

# Phase 116 — Plan-phase overview

This document is the durable, in-repo record of the Phase 116 plan-phase decomposition that was approved on 2026-05-11 via plan-mode. The canonical feature spec (28 features, locked decisions, mockups) lives in `116-CONTEXT.md`; this file captures the **execution sequence** over that spec.

The session-local plan file (with full plan-mode review trace, exploration outputs, Plan-agent risk register) is preserved at `~/.claude/plans/yes-indexed-fountain.md`.

## Wave decomposition

```
116-00 (scaffolding) ──┬── 116-01 (Tier 1 read-only)  ─┐
                       ├── 116-02 (Tier 1 interactive) ┤
                       └── 116-03 (Tier 1.5 workflow)  ┴── 116-04 (Tier 2) ── 116-05 (fleet+cost) ── 116-06 (polish + cutover gate)
```

| Plan | Title | Features | Hours | Depends on |
|------|-------|----------|-------|------------|
| **116-00** | SPA scaffolding + Finding B fix + F02 backend | scaffolding + F02 backend + producer regression repro | 8-10 | — |
| **116-01** | Tier 1 read-only surfaces | F01, F03, F04, F05, F08 | 8-11 | 116-00 |
| **116-02** | Tier 1 interactivity | F06, F07, F09, F10 | 7-9 | 116-00 (+ partial 116-01) |
| **116-03** | Tier 1.5 operator workflow | F26, F27, F28 | 14-18 | 116-00 (parallelizable with 116-01/02) |
| **116-04** | Tier 2 deep-dive | F11, F12, F13, F14, F15 | 10-14 | 116-01, 116-02 |
| **116-05** | Fleet-scale + cost | F16, F17 | 4-6 | 116-04 |
| **116-06** | Tier 3 polish + cutover gate | F18-F25 + cutover instrumentation | 6-10 | all prior |

**Total: 57-78 executor hours across 7 atomic plans.**

## Locked decisions (operator review 2026-05-11)

- **Wave order:** Tier 1 → Tier 1.5 (F26/F27/F28) → Tier 2 → Tier 3 polish (operator chose to ship workflow features before Tier 2 inspector panels)
- **Finding B fix:** Plan 116-00 T01 wipes esbuild cache + rebuilds + verifies producer call sites land in `dist/cli/index.js`. ~10-20 min. Unblocks F07 against the new `tool_execution_ms` / `tool_roundtrip_ms` columns. Fallback path: F07 against `trace_spans` if cache wipe doesn't recover.
- **Cutover:** Operator-driven feature flag (`defaults.dashboardCutoverRedirect: false → true`). No calendar gate. Both `/` and `/dashboard/v2/` coexist indefinitely until operator green-lights `/` redirect.
- **Scope:** All 28 features (F01-F28) stay in Phase 116. F14 in-UI memory editor descopes to read-only previews in v1 only. F19 swim-lane stays in scope but eligible for defer if 116-06 runs over budget.
- **Tech stack:** Vite + React 19 + shadcn/ui + Tailwind 3.4 + Recharts 3 + TanStack Query + Lucide (locked from 116-CONTEXT.md)
- **Aesthetic:** Cabinet Grotesk display + Geist body + JetBrains Mono data; dark `#0e0e12` base + emerald `#10b981` primary
- **Build:** Single root `package.json`, Vite reads root `node_modules`; daemon-side runtime deps unchanged
- **Fonts:** Self-hosted WOFF2 (privacy, offline, zero CDN)
- **Tests:** Vitest + React Testing Library (unit/component) + Playwright (E2E per-breakpoint smoke)
- **No deploy** until explicit operator clearance

## Critical files

| File | Touched by | Purpose |
|------|------------|---------|
| `src/dashboard/server.ts` | 116-00, 116-02, 116-03, 116-04, 116-05 | New `/dashboard/v2` static route + new `/api/*` endpoints |
| `src/dashboard/sse.ts` | 116-03 | Add `conversation-turn` event (F27) |
| `package.json` | 116-00 | Build script extension + client devDeps |
| `tsup.config.ts` | 116-00 (read only) | No change — Vite builds SPA separately |
| `src/performance/slos.ts` | 116-00 | Per-model SLO threshold schema (F02) |
| `src/config/schema.ts` | 116-00 | Optional `agents[*].perf.slos` override (F02) |
| `src/config/watcher.ts` | 116-03 (read only) | F26 hot-reload (no changes — `onChange` already wired) |
| `src/migration/yaml-writer.ts` | 116-03 (read only) | F26 atomic config write (no changes — already wired) |
| `src/tasks/store.ts` | 116-03 (read only) | F28 Kanban backend (no changes — state machine already wired) |
| `src/memory/conversation-store.ts` | 116-03 (read only) | F27 FTS5 search (no changes — `searchTurnsFts` already exposed) |
| `src/manager/session-adapter.ts` | 116-00 (verify only) | No source changes — confirm producer call sites land in bundle after cache wipe |
| **NEW** `src/dashboard/client/**/*` | 116-00, then every plan | Full Vite + React 19 SPA tree |

## Risk register (top 8)

1. **SPA build pipeline split-brain** → mitigated by single root `package.json`, Vite reads root `node_modules`
2. **Phase 115-08 cache regression masking F07** → 116-00 T01 dispatches; fallback to `trace_spans` if needed
3. **Old dashboard regression during soak** → isolation rule: zero edits to `src/dashboard/static/*` in plans 116-00 through 116-05
4. **Mobile testing without device** → Playwright `--device "iPhone 14"` (375px) + `--device "iPad Pro 11"` (1024px)
5. **F26 hot-reload safety** → PUT endpoint returns which agents need restart vs hot-reload; UI shows status
6. **F27 high-cardinality SSE** → broadcast metadata only `{agent, turnId, ts, role}`; UI fetches content on demand
7. **SPA bundle <2s load** → Vite default + route-level code splitting; Tier 2/3 lazy-imported
8. **Discord allowlist for `npm install` / `npx shadcn add`** → recommend allowlist for Phase 116 execution

## Plan files

Each plan has its own PLAN.md with frontmatter + task breakdown. Plans are designed for atomic execution by `gsd-executor` (one plan = one sitting).

- [116-00-PLAN.md](./116-00-PLAN.md) — Scaffolding (load-bearing; sequence-blocking for all others)
- [116-01-PLAN.md](./116-01-PLAN.md) — Tier 1 read-only surfaces
- [116-02-PLAN.md](./116-02-PLAN.md) — Tier 1 interactivity
- [116-03-PLAN.md](./116-03-PLAN.md) — Tier 1.5 operator workflow
- [116-04-PLAN.md](./116-04-PLAN.md) — Tier 2 deep-dive
- [116-05-PLAN.md](./116-05-PLAN.md) — Fleet-scale + cost
- [116-06-PLAN.md](./116-06-PLAN.md) — Tier 3 polish + operator-driven cutover gate

## Pre-execution checklist

Before dispatching `gsd-executor` against Plan 116-00:

- [ ] Operator confirms deploy hold continues to be active (no deploy at end of 116-00)
- [ ] Discord allowlist for `npm install` / `npx shadcn add` configured to reduce permission-prompt fatigue (optional but recommended)
- [ ] Phase 115 wave-4 perf-comparison report available for F02 Opus threshold derivation in 116-00 T02
- [ ] No active subagent dispatches against `src/dashboard/server.ts` to avoid merge conflicts (Phase 116 plans modify it heavily)

## Verification at phase completion

End-to-end test (after all 7 plans ship):

1. `npm run build` succeeds producing both `dist/cli/index.js` (daemon) AND `dist/dashboard/spa/` (SPA)
2. `/` returns old dashboard byte-identical to pre-Phase-116
3. `/dashboard/v2/` returns new React shell rendering live fleet state
4. Mobile viewport at 375px: page loads, no horizontal scroll, Basic mode active
5. Desktop at 1920px: 4-column grid with all Tier 1 metrics
6. F02 SLO recalibration: Opus agents render based on Opus thresholds, Sonnet on Sonnet thresholds, per-agent overrides work
7. F07 tool latency split panel shows both `tool_execution_ms` and `tool_roundtrip_ms` per tool (Finding B fixed)
8. F26 config editor changes `fin-acquisition.model = sonnet` via UI, `clawcode.yaml` updates, ConfigWatcher fires hot-reload
9. F27 FTS search for "Ramy" returns hits across multiple agents
10. F28 Kanban drag-drop from Backlog → Scheduled transitions task state in `tasks.db`
11. Cutover gate `defaults.dashboardCutoverRedirect: false` → `true` flips `/` to redirect to `/dashboard/v2/`
12. SPA loads in <2s cold cache; SSE updates appear <100ms

## Folds in

- **Phase 999.38** — "Dashboard SLO recalibration per model" — fully absorbed as F02. The fix for "every opus tile shows red" lands in Plan 116-00 T02 alongside the per-model threshold config in `slos.ts`. 999.38 closes when Phase 116 ships.

## Out of scope (deferred)

- F14 in-UI MEMORY.md/SOUL.md editor (operator overwriting mid-turn is high-risk) — read-only previews only in v1
- Approval-driven governance UI (Mission Control pattern) — single-operator tool, not needed
- Multi-framework adapters (CrewAI / LangGraph)
- Session replay / time-travel debugging
- OpenTelemetry native instrumentation
- i18n
- Cloud-hosted dashboard mode / auth
