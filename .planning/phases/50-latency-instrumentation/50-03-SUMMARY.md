---
plan: 50-03
phase: 50-latency-instrumentation
status: complete
tasks: 3/3
started: 2026-04-13T18:00:00Z
completed: 2026-04-13T19:35:00Z
commits:
  - 4838d7e
  - e0eb158
  - edde55d
requirements_addressed:
  - PERF-02
---

# Plan 50-03 — Surfaces: `clawcode latency` CLI + Dashboard Latency Panel

## What was built

The user-visible surfaces for v1.7 latency data captured by Plans 50-01, 50-02, and 50-02b.

| Layer | Artifact | Shape |
|-------|----------|-------|
| CLI | `clawcode latency <agent>` | Pretty table — 4 canonical rows × `p50 / p95 / p99 / Count` columns, values with thousand separators + `ms` suffix |
| CLI flags | `--since 1h/6h/24h/7d`, `--all`, `--json` | All three exercised successfully |
| IPC | `latency` method in daemon routeMethod | Returns `{ agent, since, segments[] }` |
| REST | `GET /api/agents/:name/latency?since=24h` | Returns same JSON shape as CLI `--json` |
| UI | Per-agent card "Latency (24h)" section | 4-row percentile table, polled every 30s |

## Tasks

| Task | Commit | Files |
|------|--------|-------|
| 1 — CLI command + IPC daemon route | `4838d7e` | `src/cli/commands/latency.ts` (+151), `src/cli/index.ts` (+2), `src/manager/daemon.ts` (+38) |
| 2 — REST endpoint + dashboard panel | `e0eb158` | `src/dashboard/server.ts` (+23), `src/dashboard/static/app.js` (+94), `src/dashboard/static/styles.css` (+56) |
| 3 — Human-verify checkpoint | approved 2026-04-13 | See verification results below |

## Post-checkpoint fix (discovered during runtime verification)

Executor omitted `"latency"` from `IPC_METHODS` in `src/ipc/protocol.ts`. This would have caused the CLI request to fail Zod validation at the daemon server. Fixed in commit `edde55d`:

- Added `"latency"` to `IPC_METHODS` in `src/ipc/protocol.ts`.
- Synced `src/ipc/__tests__/protocol.test.ts` expected list to match live methods (also picked up 6 stale entries from pre-Phase-50 commits: `stop-all`, `memory-graph`, `memory-save`, `read-thread`, `message-history`, `agent-create`).

Result: `npx vitest run src/ipc/__tests__/protocol.test.ts` → 208/208 green.

## Verification (run remotely on clawdy)

| # | Step | Result |
|---|------|--------|
| 1 | `npm run build` + daemon start | ✅ Build clean; daemon starts via workspace config |
| 2 | `traces.db` auto-creation per agent | ✅ `~/.clawcode-verify/agents/<agent>/traces.db` created |
| 3 | Discord turn → trace row | ⏭ DEFERRED — 1Password auth blocks Discord bridge |
| 4 | CLI table output | ✅ 10 synthetic turns → p50 750ms / 195ms / 55ms / 85ms across canonical segments |
| 5 | CLI `--json` + `--since 7d` | ✅ Correct JSON: `agent`, `since` ISO, `segments[]` |
| 6 | CLI `--all` | ✅ Per-agent block rendered |
| 7 | Dashboard REST endpoint | ✅ Returns exact same shape as CLI `--json` |
| 8 | Retention heartbeat tick | ✅ 15-day-old synthetic trace pruned; CASCADE removed 1 orphan span; recent traces untouched |
| 9 | Subagent filter runtime | ⏭ DEFERRED — covered by `session-adapter.test.ts -t "subagent"` at SDK-message-mock level |
| 10 | `npm test` full suite | ⚠ 1068/1069 pass; the 1 failure is pre-existing (`src/mcp/server.test.ts` TOOL_DEFINITIONS count 8→16, unrelated to Phase 50) |

User approved the checkpoint with steps 3, 7 (browser DOM), and 9 deferred — they'll do those three manually after `op signin` and `sudo systemctl restart clawcode` pick up Phase 50 code in the production service.

## Deployment note

- Workspace is 28 commits ahead of `origin/master`.
- `/opt/clawcode` has been rsynced with the new code for verification but requires either a push→pull cycle OR a persistent rsync before the systemd service restart.
- Systemd service runs as user `clawcode` from `/opt/clawcode/dist/cli/index.js`; restart needs sudo.

## Requirements

- PERF-02 — p50/p95/p99 per-agent report (CLI + dashboard) — ✅ complete

## Key files

- `/home/jjagpal/.openclaw/workspace-coding/src/cli/commands/latency.ts`
- `/home/jjagpal/.openclaw/workspace-coding/src/cli/index.ts`
- `/home/jjagpal/.openclaw/workspace-coding/src/manager/daemon.ts`
- `/home/jjagpal/.openclaw/workspace-coding/src/ipc/protocol.ts`
- `/home/jjagpal/.openclaw/workspace-coding/src/ipc/__tests__/protocol.test.ts`
- `/home/jjagpal/.openclaw/workspace-coding/src/dashboard/server.ts`
- `/home/jjagpal/.openclaw/workspace-coding/src/dashboard/static/app.js`
- `/home/jjagpal/.openclaw/workspace-coding/src/dashboard/static/styles.css`
