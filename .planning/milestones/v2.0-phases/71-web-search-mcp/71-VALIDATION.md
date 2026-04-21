---
phase: 71
slug: web-search-mcp
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-19
---

# Phase 71 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Quick run command** | `npx vitest run src/search` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds (quick) / ~4 min (full) |

## Sampling Rate

- **After every task commit:** `npx vitest run <scoped-path>`
- **After every plan wave:** `npx vitest run src/search src/config/__tests__/loader.test.ts`
- **Max feedback latency:** 15 seconds

## Wave 0 Requirements

Per-task TDD. Test files created alongside implementation in each task.

## Manual-Only Verifications

- Live search via running daemon + real Brave API key (one-time smoke)

**Approval:** approved 2026-04-19

**Wave 0 rationale:** Per-task TDD satisfies sampling continuity.
