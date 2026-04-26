---
phase: 100
slug: gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-26
---

# Phase 100 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.3 (already in use across the codebase) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run --reporter=dot src/config src/discord src/manager` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~30s quick, ~120s full |

---

## Sampling Rate

- **After every task commit:** Run quick command (config + discord + manager subset)
- **After every plan wave:** Run full suite
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~30s

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 100-01-01 | 01 | 1 | settingSources schema field | unit | `npx vitest run src/config/__tests__/loader.test.ts` | ⚠️ Wave-0 (extend existing) | ⬜ pending |
| 100-01-02 | 01 | 1 | gsd.projectDir schema field | unit | `npx vitest run src/config/__tests__/loader.test.ts` | ⚠️ Wave-0 (extend existing) | ⬜ pending |
| 100-02-01 | 02 | 2 | session-adapter reads cwd from config | unit | `npx vitest run src/manager/__tests__/session-adapter.test.ts` | ⚠️ Wave-0 (extend existing) | ⬜ pending |
| 100-02-02 | 02 | 2 | session-adapter reads settingSources from config | unit | `npx vitest run src/manager/__tests__/session-adapter.test.ts` | ⚠️ Wave-0 (extend existing) | ⬜ pending |
| 100-03-01 | 03 | 2 | differ detects settingSources change → restart | unit | `npx vitest run src/config/__tests__/differ.test.ts` | ⚠️ Wave-0 (extend existing) | ⬜ pending |
| 100-04-01 | 04 | 3 | slash dispatcher detects /gsd-* | unit | `npx vitest run src/discord/__tests__/slash-commands.test.ts` | ⚠️ Wave-0 (extend existing) | ⬜ pending |
| 100-04-02 | 04 | 3 | dispatcher pre-spawns thread for long-runners | unit | `npx vitest run src/discord/__tests__/slash-commands.test.ts` | ⚠️ Wave-0 (extend existing) | ⬜ pending |
| 100-04-03 | 04 | 3 | dispatcher inline-handles short commands | unit | `npx vitest run src/discord/__tests__/slash-commands.test.ts` | ⚠️ Wave-0 (extend existing) | ⬜ pending |
| 100-05-01 | 05 | 3 | relayCompletionToParent prompt includes artifacts | unit | `npx vitest run src/discord/__tests__/subagent-thread-spawner.test.ts` | ⚠️ Wave-0 (extend existing) | ⬜ pending |
| 100-06-01 | 06 | 4 | install helper creates 2 symlinks | unit | `npx vitest run src/cli/commands/__tests__/gsd-install.test.ts` | ❌ W0 | ⬜ pending |
| 100-06-02 | 06 | 4 | install helper creates sandbox dir | unit | `npx vitest run src/cli/commands/__tests__/gsd-install.test.ts` | ❌ W0 | ⬜ pending |
| 100-07-01 | 07 | 4 | local clawcode.yaml fixture admin-clawdy block | regex | `grep -q '^- name: admin-clawdy' clawcode.yaml` | ✅ | ⬜ pending |
| 100-08-01 | 08 | 5 | smoke test runbook exists | file | `test -f .planning/phases/100-*/SMOKE-TEST.md` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/config/__tests__/loader.test.ts` — extend with settingSources + gsd.projectDir cases
- [ ] `src/config/__tests__/differ.test.ts` — extend with settingSources-change-triggers-restart case
- [ ] `src/manager/__tests__/session-adapter.test.ts` — extend with config-driven cwd + settingSources passthrough
- [ ] `src/discord/__tests__/slash-commands.test.ts` — extend with /gsd-* dispatcher cases (long-runner thread spawn + short inline)
- [ ] `src/discord/__tests__/subagent-thread-spawner.test.ts` — extend with relay-prompt-artifact-paths case
- [ ] `src/cli/commands/__tests__/gsd-install.test.ts` — NEW: symlink + sandbox creation
- [ ] `.planning/phases/100-*/SMOKE-TEST.md` — operator-runnable runbook

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Operator types `/gsd-autonomous` in #admin-clawdy → subthread spawned → workflow runs end-to-end | E2E smoke | Live Discord interaction, real Anthropic API calls, real subagent thread | Follow SMOKE-TEST.md runbook on clawdy after deployment |
| GSD AskUserQuestion-style prompts render in subthread + operator answers in same thread | UX validation | Live Discord + real GSD workflow with grey areas | Run `/gsd-plan-phase` on a phase with grey areas; verify thread Q&A flow |
| settingSources hot-reload restarts only Admin Clawdy (not other agents) | Non-regression | Live config-watcher behavior | Edit clawcode.yaml settingSources; tail journalctl; assert single agent restart |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
