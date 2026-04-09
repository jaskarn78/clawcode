---
phase: 6
slug: memory-consolidation-pipeline
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-09
---

# Phase 6 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --coverage` |
| **Estimated runtime** | ~15 seconds |

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --coverage`

## Wave 0 Requirements

Test files created inline. Existing infrastructure reused.

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| LLM summarization quality | AMEM-01 | Requires real API call | Create 7 daily logs, trigger consolidation, verify digest quality |

## Validation Sign-Off

- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-09
