---
phase: 70
slug: browser-automation-mcp
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-19
---

# Phase 70 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TypeScript ESM, existing) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/browser` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~45 seconds (quick, includes short Playwright integration) / ~4 minutes (full) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <scoped-path>` for files touched
- **After every plan wave:** Run `npx vitest run src/browser src/manager/__tests__/daemon-warmup-probe.test.ts`
- **Before verify:** Full suite (`npm test`) green + local Playwright integration smoke
- **Max feedback latency:** 45 seconds

---

## Per-Task Verification Map

| Task | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|------|------|------|-------------|-----------|-------------------|--------|
| Config + schema | 01 | 1 | BROWSER-06 | unit | `npx vitest run src/config/__tests__/schema.test.ts` | ⬜ pending |
| BrowserManager singleton | 01 | 1 | BROWSER-06 | integration | `npx vitest run src/browser/__tests__/manager.test.ts` | ⬜ pending |
| Tool handlers | 02 | 2 | BROWSER-01..05 | unit + integration | `npx vitest run src/browser/__tests__/tools.test.ts` | ⬜ pending |
| MCP subprocess | 02 | 2 | BROWSER-01..06 | unit | `npx vitest run src/browser/__tests__/mcp-server.test.ts` | ⬜ pending |
| Auto-inject + daemon warm-up | 03 | 3 | BROWSER-06 | integration | `npx vitest run src/manager/__tests__/daemon-warmup-probe.test.ts src/config/__tests__/loader.test.ts` | ⬜ pending |
| E2E smoke | 03 | 3 | BROWSER-01..06 | E2E | `node scripts/browser-smoke.mjs` | ⬜ pending |

---

## Wave 0 Requirements

Per-task TDD pattern — tests are created alongside implementation in each task (`tdd="true"` where applicable). Test files that will be created as part of implementation tasks:

- `src/browser/__tests__/manager.test.ts`
- `src/browser/__tests__/tools.test.ts`
- `src/browser/__tests__/mcp-server.test.ts`
- Extension of `src/manager/__tests__/daemon-warmup-probe.test.ts`
- `src/config/__tests__/schema.test.ts` extension for `browserConfigSchema`
- `src/config/__tests__/loader.test.ts` extension for browser auto-inject
- `scripts/browser-smoke.mjs`

Vitest + playwright-core already installable; no framework bootstrap.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Instructions |
|----------|-------------|------------|--------------|
| Real-public-URL navigation | BROWSER-01..04 | Needs network access + live internet | Run `node scripts/browser-smoke.mjs` against `https://example.com` |
| N-agent memory footprint | BROWSER-06 | Needs daemon under load with N agents active | Measure RSS after 14-agent boot; compare to baseline |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] No watch-mode flags
- [ ] Feedback latency < 45s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-19

**Wave 0 rationale:** Per-task TDD (`tdd="true"` on each implementation task) satisfies sampling continuity without a separate Wave 0 stub pass.
