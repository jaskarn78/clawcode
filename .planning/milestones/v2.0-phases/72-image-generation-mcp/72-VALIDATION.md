---
phase: 72
slug: image-generation-mcp
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-19
---

# Phase 72 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Quick run command** | `npx vitest run src/image` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds (quick) / ~4 min (full) |

## Sampling Rate

- **After every task commit:** targeted `npx vitest run <path>`
- **After every plan wave:** `npx vitest run src/image src/config/__tests__/loader.test.ts`

## Wave 0 Requirements

Per-task TDD. Test files created alongside implementation.

**Approval:** approved 2026-04-19
