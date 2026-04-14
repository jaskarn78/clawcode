---
plan: 55-03
phase: 55-tool-call-overhead
status: complete
tasks: 3/3
started: 2026-04-14T05:00:00Z
completed: 2026-04-14T05:20:00Z
commits:
  - ffa8071
  - 106a84e
  - 907ce66
requirements_completed:
  - TOOL-03
---

# Plan 55-03 — Tools IPC + CLI + Dashboard + Checkpoint

## What was built

Per-tool latency surfacing: `clawcode tools <agent>` CLI, `GET /api/agents/:name/tools` REST endpoint, `tools` IPC method, and dashboard Tool Call Latency panel.

| Layer | Artifact | Shape |
|-------|----------|-------|
| IPC | `tools` method in IPC_METHODS + daemon handler | Returns `{ agent, since, tools: ToolPercentileRow[] }` |
| REST | `GET /api/agents/:name/tools?since=24h` | Same shape as CLI `--json` |
| CLI | `clawcode tools [agent]` | Table sorted by p95 DESC, columns `Tool | p50 | p95 | p99 | Count | SLO` |
| CLI flags | `--all`, `--since`, `--json` | All exercised |
| UI | Per-agent Tool Call Latency panel (below Prompt Cache) | Per-tool rows, 30s polling, SLO color coding |

## Tasks

| Task | Commits | Files |
|------|---------|-------|
| 1 — tools IPC method + daemon handler + REST endpoint | `ffa8071` (RED), `106a84e` (GREEN) | src/ipc/protocol.ts, src/ipc/__tests__/protocol.test.ts, src/manager/daemon.ts, src/manager/__tests__/daemon-tools.test.ts, src/dashboard/server.ts, src/dashboard/__tests__/server.test.ts |
| 2 — clawcode tools CLI + dashboard Tool Call Latency panel | `907ce66` | src/cli/commands/tools.ts, src/cli/commands/__tests__/tools.test.ts, src/cli/index.ts, src/dashboard/static/app.js, src/dashboard/static/styles.css |
| 3 — Human-verify checkpoint | approved 2026-04-14 | See runtime verification below |

## Phase 50 regression lesson honored

`"tools"` IPC method registered in BOTH `src/ipc/protocol.ts` IPC_METHODS AND `src/ipc/__tests__/protocol.test.ts` expected list — same commit.

## Task 3 — Human-verify checkpoint results (2026-04-14)

User delegated to orchestrator (same pattern as Phases 50-54). Workspace rsynced to clawdy `/opt/clawcode`, rebuilt, live daemon exercised with synthetic tool_call span data.

| # | Verification | Result |
|---|--------------|--------|
| 1 | `npm run build` on clawdy | ✅ Build success |
| 2 | Daemon restart with test config | ✅ Daemon started, traces.db auto-created |
| 3 | `clawcode tools --help` lists all flags | ✅ `--since`, `--all`, `--json` |
| 4 | Synthetic injection: 5 turns × mixed tool_call spans (memory_lookup cached, search_documents slow, memory_save) | ✅ Spans written with metadata_json carrying `tool_name`, `cached`, `is_parallel` |
| 5 | `clawcode tools <agent>` table output | ✅ 3-tool table sorted by p95 DESC; search_documents `[SLOW]` (p95 1700ms > 1500 SLO), memory_lookup `ok` (150ms), memory_save `ok` (85ms) |
| 6 | `clawcode tools --json` shape | ✅ Returns `{ agent, since, tools[] }` each row carrying `tool_name, p50, p95, p99, count, slo_status, slo_threshold_ms, slo_metric` |
| 7 | SLO evaluation correct | ✅ search_documents "breach" (p95 exceeds 1500), memory_lookup + memory_save "healthy" |
| 8 | Server-emit invariant | ✅ `grep -c 'DEFAULT_SLOS\|SLO_LABELS' src/dashboard/static/app.js` returns 0 |
| 9 | Full `npm test` on clawdy | ✅ **1501/1501 passing** — zero failures (vitest worktree exclusion + mcp/server.test.ts tool count fix from Plan 55-02 eliminated all historical noise) |
| 10 | Cleanup | ✅ Orphan daemon killed |

**Deferred to user** (dashboard DOM visual + live Discord tool traffic):
- Browser render of Tool Call Latency panel with per-tool rows
- Live Discord turn exercising memory_lookup + search_documents parallel dispatch + intra-turn cache

Orchestrator approved per user delegation. TOOL-03 marked complete.

## Requirements (full phase)

- TOOL-01 — Independent tool calls execute in parallel (Promise.allSettled + semaphore) — ✅ complete (Plan 55-02)
- TOOL-02 — Idempotent tool results cached within a turn (whitelist-gated, deep-frozen, per-turn GC) — ✅ complete (Plan 55-02)
- TOOL-03 — Per-tool round-trip timing logged and visible on dashboard — ✅ complete (this plan)

## Phase 52 contract preserved

Context-assembler untouched — `src/manager/context-assembler.ts` NOT in files_modified.

## Key files

- `/home/jjagpal/.openclaw/workspace-coding/src/ipc/protocol.ts`
- `/home/jjagpal/.openclaw/workspace-coding/src/ipc/__tests__/protocol.test.ts`
- `/home/jjagpal/.openclaw/workspace-coding/src/manager/daemon.ts`
- `/home/jjagpal/.openclaw/workspace-coding/src/manager/__tests__/daemon-tools.test.ts`
- `/home/jjagpal/.openclaw/workspace-coding/src/dashboard/server.ts`
- `/home/jjagpal/.openclaw/workspace-coding/src/dashboard/static/app.js`
- `/home/jjagpal/.openclaw/workspace-coding/src/dashboard/static/styles.css`
- `/home/jjagpal/.openclaw/workspace-coding/src/cli/commands/tools.ts`
- `/home/jjagpal/.openclaw/workspace-coding/src/cli/index.ts`

---
*Phase: 55-tool-call-overhead*
*Plan: 03*
*Tasks 1-3 complete: 2026-04-14 (Task 3 approved via orchestrator delegation)*
