---
phase: 93
slug: status-detail-parity-clawhub-public-catalog-defaults-plugin-manifest-url-resilience
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-24
---

# Phase 93 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4.1.3 |
| **Config file** | `vitest.config.ts` (project root) |
| **Quick run command** | `npx vitest run <changed-test-file>` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~25–35 seconds (full suite ~1450 tests) |

---

## Sampling Rate

- **After every task commit:** Run focused test for the changed file (`npx vitest run <file>`)
- **After every plan wave:** Run `npm test` (full suite)
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~35 seconds (full suite)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Sub-Plan | Test Type | Automated Command | File Exists | Status |
|---------|------|------|----------|-----------|-------------------|-------------|--------|
| 93-01-* | 01 | 1 | 93-01 | unit | `npx vitest run src/discord/__tests__/status-render.test.ts` | ❌ W0 | ⬜ pending |
| 93-01-* | 01 | 1 | 93-01 | unit | `npx vitest run src/discord/__tests__/slash-commands-status-model.test.ts` | ✅ | ⬜ pending |
| 93-02-* | 02 | 1 | 93-02 | unit | `npx vitest run src/marketplace/__tests__/catalog-clawhub-default.test.ts` | ❌ W0 | ⬜ pending |
| 93-02-* | 02 | 1 | 93-02 | unit | `npx vitest run src/manager/__tests__/daemon-marketplace.test.ts` | ✅ | ⬜ pending |
| 93-02-* | 02 | 1 | 93-02 | unit | `npx vitest run src/discord/__tests__/slash-commands-skills-browse.test.ts` | ✅ | ⬜ pending |
| 93-03-* | 03 | 1 | 93-03 | unit | `npx vitest run src/marketplace/__tests__/clawhub-client-manifest-404.test.ts` | ❌ W0 | ⬜ pending |
| 93-03-* | 03 | 1 | 93-03 | unit | `npx vitest run src/marketplace/__tests__/install-plugin-manifest-unavailable.test.ts` | ❌ W0 | ⬜ pending |
| 93-03-* | 03 | 1 | 93-03 | unit | `npx vitest run src/discord/__tests__/slash-commands-plugins-browse.test.ts` | ✅ | ⬜ pending |
| 93-03-* | 03 | 1 | 93-03 | unit | `npx vitest run src/manager/__tests__/daemon-plugin-marketplace.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/discord/__tests__/status-render.test.ts` — new file, covers 93-01 status renderer
- [ ] `src/marketplace/__tests__/catalog-clawhub-default.test.ts` — new file, covers 93-02 default-source injection
- [ ] `src/marketplace/__tests__/clawhub-client-manifest-404.test.ts` — new file, covers 93-03 ClawhubManifestNotFoundError throw
- [ ] `src/marketplace/__tests__/install-plugin-manifest-unavailable.test.ts` — new file, covers 93-03 outcome mapping

vitest already installed; no framework setup needed. Existing test conventions in `src/**/__tests__/` directories are the template.

---

## Manual-Only Verifications

| Behavior | Sub-Plan | Why Manual | Test Instructions |
|----------|----------|------------|-------------------|
| `/clawcode-status` rich block renders correctly in Discord | 93-01 | Visual rendering quirks in Discord embeds (emoji widths, ephemeral message line breaks) | Restart fin-acquisition agent; run `/clawcode-status` in the bound channel; compare visually to OpenClaw `/status` screenshot from 2026-04-24 |
| `/clawcode-skills-browse` shows local + ClawHub-public sections with divider | 93-02 | StringSelectMenu rendering may render the separator option visually identical to a real skill on some Discord clients | Restart agent with NO `marketplaceSources[{kind:"clawhub"}]` entry in clawcode.yaml; run `/clawcode-skills-browse` in fin-acquisition; verify divider option `── ClawHub public ──` appears between local and clawhub sections; verify selecting the divider produces the "pick a skill, not the divider" ephemeral response |
| `/clawcode-plugins-browse` → pick `hivemind` shows new error copy | 93-03 | End-to-end Discord interaction over live ClawHub HTTP | Run `/clawcode-plugins-browse`; pick `hivemind` from the dropdown; verify error reads `**hivemind** manifest unavailable (404) — the registry lists this plugin but can't serve its manifest. Retry later or choose a different plugin.` (NOT the previous `manifest is invalid` wording) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (4 new test files)
- [ ] No watch-mode flags (vitest run, not vitest)
- [ ] Feedback latency < 35s (full suite)
- [ ] `nyquist_compliant: true` set in frontmatter after Wave 0 completes

**Approval:** pending
