---
phase: 50
slug: latency-instrumentation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-13
---

# Phase 50 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.3 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/performance` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~45 seconds (quick); ~180 seconds (full) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/performance`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green + manual dashboard smoke check
- **Max feedback latency:** ~45 seconds (new subsystem subset)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 50-00-01 | 00 | 0 | PERF-01 | unit | `npx vitest run src/performance/__tests__/trace-collector.test.ts` | ❌ W0 | ⬜ pending |
| 50-00-02 | 00 | 0 | PERF-01 | unit | `npx vitest run src/performance/__tests__/trace-store.test.ts` | ❌ W0 | ⬜ pending |
| 50-00-03 | 00 | 0 | PERF-02 | unit | `npx vitest run src/performance/__tests__/percentiles.test.ts` | ❌ W0 | ⬜ pending |
| 50-00-04 | 00 | 0 | PERF-02 | unit | `npx vitest run src/cli/commands/__tests__/latency.test.ts` | ❌ W0 | ⬜ pending |
| 50-00-05 | 00 | 0 | PERF-01 | unit | `npx vitest run src/heartbeat/checks/__tests__/trace-retention.test.ts` | ❌ W0 | ⬜ pending |
| 50-01-01 | 01 | 1 | PERF-01 | unit | `npx vitest run src/performance/__tests__/trace-collector.test.ts` | ✅ W0 | ⬜ pending |
| 50-01-02 | 01 | 1 | PERF-01 | unit | `npx vitest run src/performance/__tests__/trace-store.test.ts -t "cascade"` | ✅ W0 | ⬜ pending |
| 50-01-03 | 01 | 1 | PERF-02 | unit | `npx vitest run src/performance/__tests__/percentiles.test.ts` | ✅ W0 | ⬜ pending |
| 50-02-01 | 02 | 2 | PERF-01 | unit | `npx vitest run src/discord/__tests__/bridge.test.ts -t "receive span"` | ✅ | ⬜ pending |
| 50-02-02 | 02 | 2 | PERF-01 | unit | `npx vitest run src/manager/__tests__/context-assembler.test.ts -t "tracing"` | ✅ | ⬜ pending |
| 50-02-03 | 02 | 2 | PERF-01 | unit | `npx vitest run src/manager/__tests__/session-adapter.test.ts -t "first_token"` | ✅ | ⬜ pending |
| 50-02-04 | 02 | 2 | PERF-01 | unit | `npx vitest run src/manager/__tests__/session-adapter.test.ts -t "tool_call"` | ✅ | ⬜ pending |
| 50-02-05 | 02 | 2 | PERF-01 | unit | `npx vitest run src/manager/__tests__/session-adapter.test.ts -t "subagent"` | ✅ | ⬜ pending |
| 50-02-06 | 02 | 2 | PERF-01 | unit | `npx vitest run src/heartbeat/checks/__tests__/trace-retention.test.ts` | ✅ W0 | ⬜ pending |
| 50-03-01 | 03 | 3 | PERF-02 | unit | `npx vitest run src/cli/commands/__tests__/latency.test.ts` | ✅ W0 | ⬜ pending |
| 50-03-02 | 03 | 3 | PERF-02 | integration | `npx vitest run src/dashboard/__tests__/server.test.ts -t "latency"` | ✅ | ⬜ pending |
| 50-03-03 | 03 | 3 | PERF-02 | manual-only | Browser smoke check: per-agent Latency panel renders p50/p95/p99 | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/performance/__tests__/trace-collector.test.ts` — stubs for PERF-01 (startTurn/startSpan/end/flush behavior)
- [ ] `src/performance/__tests__/trace-store.test.ts` — SQLite pragma init, schema, CASCADE deletion
- [ ] `src/performance/__tests__/percentiles.test.ts` — ROW_NUMBER() percentile math + `--since` parser
- [ ] `src/cli/commands/__tests__/latency.test.ts` — CLI formatter and flag handling (follow `costs.test.ts` pattern)
- [ ] `src/heartbeat/checks/__tests__/trace-retention.test.ts` — retention delete + default retention days

No framework install needed — vitest 4.1.3 already present.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Dashboard latency panel visual rendering | PERF-02 | DOM rendering; no Playwright/E2E infra in repo | 1) `npm run build` 2) `clawcode dashboard` 3) open URL 4) confirm "Latency" section in agent card with p50/p95/p99 columns and a count |
| Runtime confirmation that `parent_tool_use_id` filters subagent messages correctly | PERF-01 | Flagged LOW-confidence in research; real SDK behavior during subagent turn must match type-inferred contract | 1) Trigger subagent via `spawn_subagent_thread` 2) Inspect written trace — parent turn `first_token` should reflect the PARENT assistant text, not the subagent's first token |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
