---
phase: 96
slug: discord-routing-and-file-sharing-hygiene
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-25
---

# Phase 96 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npm test -- --run --reporter=dot` |
| **Full suite command** | `npm test -- --run` |
| **Estimated runtime** | ~45 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --run --reporter=dot <changed-file>.test.ts`
- **After every plan wave:** Run `npm test -- --run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 45 seconds

---

## Per-Task Verification Map

> Filled by gsd-planner after PLAN.md files exist. Tasks within plans bind to validation dimensions below.

| Plan | Wave | Decision | Test Type | Automated Command |
|------|------|----------|-----------|-------------------|
| 96-01 | 1 | D-01, D-05, D-06 | unit | `npm test -- --run src/manager/__tests__/fs-probe.test.ts src/manager/__tests__/fs-snapshot-store.test.ts` |
| 96-01 | 1 | D-05 schema | unit | `npm test -- --run src/config/__tests__/schema-fileAccess.test.ts` |
| 96-02 | 2 | D-02 | unit | `npm test -- --run src/prompt/__tests__/filesystem-capability-block.test.ts` |
| 96-03 | 2 | D-07 | unit | `npm test -- --run src/manager/__tests__/clawcode-list-files.test.ts` |
| 96-03 | 2 | D-08 alts | unit | `npm test -- --run src/manager/__tests__/find-alternative-fs-agents.test.ts` |
| 96-04 | 2 | D-09, D-12 | unit | `npm test -- --run src/manager/__tests__/clawcode-share-file.test.ts src/manager/__tests__/resolve-output-dir.test.ts` |
| 96-04 | 2 | D-10 | unit | `npm test -- --run src/manager/__tests__/auto-upload-heuristic.test.ts` |
| 96-05 | 3 | D-03, D-04 | unit | `npm test -- --run src/discord/__tests__/probe-fs-slash.test.ts src/cli/__tests__/probe-fs-cli.test.ts` |
| 96-06 | 1 | D-11 | unit | `npm test -- --run src/sync/__tests__/sync-runner-deprecation.test.ts src/cli/__tests__/sync-deprecation.test.ts` |
| 96-07 | 3 | D-01 heartbeat, D-03 watcher, D-13 | integration | `npm test -- --run src/heartbeat/__tests__/fs-probe-check.test.ts src/config/__tests__/watcher-fileAccess-reload.test.ts` |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Validation Dimensions (8)

Per RESEARCH.md §Validation Architecture:

1. **Capability probe correctness** — given fileAccess config, runFsProbe produces correct snapshot (status: ready/degraded/unknown; mode: rw/ro/denied)
2. **System-prompt rendering** — `<filesystem_capability>` block matches snapshot state; classification (My workspace / Operator-shared / Off-limits) correct
3. **Boundary check enforcement** — `checkFsCapability(path, snapshot)` refuses out-of-allowlist; allows in-allowlist; on-cache-miss falls through to live `fs.access`
4. **Heartbeat refresh propagation** — operator config change reflected in next prompt within 60s; stable-prefix hash changes once on capability shift then re-stabilizes
5. **Tool surface integration** — `clawcode_list_files` auto-injected at session-config.ts:421 site; `clawcode_share_file` extended with outputDir resolution + Phase 94 ToolCallError schema (mapping size/missing → unknown errorClass with rich suggestion text)
6. **Discord/CLI parity** — `/clawcode-probe-fs` and `clawcode probe-fs` produce identical snapshot; `/clawcode-status` Capability block matches `clawcode fs-status` output
7. **Phase 91 deprecation surface** — sync-runner run-once errors with deprecation message; `clawcode sync status` reports deprecated; `clawcode sync re-enable-timer` within 7-day window restores; after 7 days errors; `authoritative` enum extended to 3 values
8. **End-to-end Tara-PDF acceptance (UAT-95)** — operator asks in `#finmentum-client-acquisition`, agent reads `/home/jjagpal/.openclaw/workspace-finmentum/clients/tara-maffeo/*.pdf` via ACL, calls clawcode_share_file, posts CDN URL inline, no "not accessible" or OpenClaw fallback recommendation

---

## Wave 0 Requirements

> Test files Wave 1 must create before implementation begins. TDD-first per project conventions.

- [ ] `src/manager/__tests__/fs-probe.test.ts` — stubs for D-01, D-05, D-06 (probe schedule, declaration model, boundary check)
- [ ] `src/manager/__tests__/fs-snapshot-store.test.ts` — atomic write, reload-safe, snapshot shape
- [ ] `src/config/__tests__/schema-fileAccess.test.ts` — Zod schema for `defaults.fileAccess`, `agents.*.fileAccess`, `agents.*.outputDir` (additive-optional)
- [ ] `src/prompt/__tests__/filesystem-capability-block.test.ts` — block rendering from snapshot (D-02)
- [ ] `src/manager/__tests__/clawcode-list-files.test.ts` — D-07 tool implementation (depth/entries guards, glob, boundary check)
- [ ] `src/manager/__tests__/find-alternative-fs-agents.test.ts` — D-08 alternatives lookup
- [ ] `src/manager/__tests__/clawcode-share-file.test.ts` — Phase 94 test extended for D-09 outputDir resolution + D-12 error classification
- [ ] `src/manager/__tests__/resolve-output-dir.test.ts` — pure-fn template token resolution (D-09)
- [ ] `src/manager/__tests__/auto-upload-heuristic.test.ts` — D-10 post-turn missed-upload soft warning
- [ ] `src/sync/__tests__/sync-runner-deprecation.test.ts` — D-11 sync-runner deprecation flag enforcement
- [ ] `src/cli/__tests__/sync-deprecation.test.ts` — D-11 CLI subcommands (disable-timer, re-enable-timer, status reporting)
- [ ] `src/discord/__tests__/probe-fs-slash.test.ts` — D-03 slash command + D-04 status block
- [ ] `src/cli/__tests__/probe-fs-cli.test.ts` — CLI parity
- [ ] `src/heartbeat/__tests__/fs-probe-check.test.ts` — D-01 heartbeat layer integration
- [ ] `src/config/__tests__/watcher-fileAccess-reload.test.ts` — D-03 config-watcher trigger

*Existing test infrastructure (vitest already wired). No framework install needed.*

---

## Manual-Only Verifications

| Behavior | Decision | Why Manual | Test Instructions |
|----------|----------|------------|-------------------|
| Tara-PDF E2E acceptance (UAT-95) | D-14 | Requires real Discord channel, real fin-acquisition agent on clawdy server, real ACL setup, real Tara PDFs in /home/jjagpal/.openclaw/workspace-finmentum/clients/tara-maffeo/ | Post-deploy: in `#finmentum-client-acquisition`, ask Clawdy "Send me the Tara Maffeo financial worksheet." Verify: (a) no "not accessible from my side" reply, (b) no OpenClaw fallback recommendation, (c) Discord CDN URL posted inline. Repeat for speech-coaching PDF. |
| Stable-prefix cache miss observability | D-04 | Requires production telemetry to confirm cache miss happens once on capability shift then prefix re-stabilizes | After deploy + heartbeat tick fires fs-probe re-render, inspect dashboard for one-off cache miss in stable-prefix hash; subsequent turns should hit cache |
| Operator-side prereq verification on clawdy | D-14 prereq | Dev box does not have clawcode user/ACLs/relaxed systemd; production target is clawdy server (jjagpal@100.98.211.108) | SSH to clawdy: `id clawcode \| grep jjagpal` (group membership), `getfacl /home/jjagpal/.openclaw/workspace-finmentum/ \| grep clawcode` (ACL grants), `systemctl cat clawcode \| grep ProtectHome` (relaxed) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (15 test files listed above)
- [ ] No watch-mode flags (vitest --run only)
- [ ] Feedback latency < 45s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending — set to approved after gsd-planner produces plans aligned to this strategy
