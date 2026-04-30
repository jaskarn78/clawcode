---
phase: 104
slug: daemon-op-secret-cache-and-retry-backoff
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-30
---

# Phase 104 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x (project standard, ESM, TypeScript-native) |
| **Config file** | `vitest.config.ts` at repo root |
| **Quick run command** | `npx vitest run src/manager/__tests__/secrets-resolver.test.ts -t "<test-name>"` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~30 seconds (resolver + watcher + IPC) / ~3 minutes (full suite) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/manager/__tests__/secrets-resolver*.test.ts src/ipc/__tests__/secrets-status.test.ts`
- **After every plan wave:** Run `npx vitest run src/manager/__tests__/ src/config/__tests__/ src/ipc/__tests__/`
- **Before `/gsd:verify-work`:** Full suite must be green — `npx vitest run`
- **Max feedback latency:** 30 seconds (per-task); 180 seconds (full suite)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 104-00-01 | 00 | 0 | Wave 0 — test scaffolding | unit | `npx vitest run src/manager/__tests__/secrets-resolver.test.ts` | ❌ W0 | ⬜ pending |
| 104-01-01 | 01 | 1 | SEC-01 | unit | `npx vitest run src/manager/__tests__/secrets-resolver-callsites.test.ts` | ❌ W0 | ⬜ pending |
| 104-01-02 | 01 | 1 | SEC-02 | unit | `npx vitest run secrets-resolver.test.ts -t "RES-01: cache hit avoids opRead"` | ❌ W0 | ⬜ pending |
| 104-01-03 | 01 | 1 | SEC-02 | unit | `npx vitest run secrets-resolver.test.ts -t "RES-02: inflight dedup"` | ❌ W0 | ⬜ pending |
| 104-01-04 | 01 | 1 | SEC-03 | unit | `npx vitest run secrets-resolver.test.ts -t "RES-03: retry succeeds before exhaustion"` | ❌ W0 | ⬜ pending |
| 104-01-05 | 01 | 1 | SEC-03 | unit | `npx vitest run secrets-resolver.test.ts -t "RES-04: rate-limit bails early"` | ❌ W0 | ⬜ pending |
| 104-01-06 | 01 | 1 | SEC-03 | unit | `npx vitest run secrets-resolver.test.ts -t "RES-05: empty resolution throws AbortError"` | ❌ W0 | ⬜ pending |
| 104-02-01 | 02 | 2 | SEC-04 | unit | `npx vitest run secrets-resolver.test.ts -t "RES-06: preResolveAll partial failure"` | ❌ W0 | ⬜ pending |
| 104-02-02 | 02 | 2 | SEC-04 | integration | `npx vitest run src/manager/__tests__/daemon-boot-secrets-degraded.test.ts` | ❌ W0 | ⬜ pending |
| 104-03-01 | 03 | 3 | SEC-05 | unit | `npx vitest run src/manager/__tests__/secrets-resolver-watcher.test.ts -t "WATCH-01: changed URI invalidates"` | ❌ W0 | ⬜ pending |
| 104-03-02 | 03 | 3 | SEC-05 | unit | extend `src/manager/__tests__/recovery-op-refresh.test.ts` REC-OP-REFRESH-INV-01 | ⚠️ EXTEND | ⬜ pending |
| 104-04-01 | 04 | 3 | SEC-06 | unit | `npx vitest run src/ipc/__tests__/secrets-status.test.ts` | ❌ W0 | ⬜ pending |
| 104-04-02 | 04 | 3 | SEC-06 | unit | `npx vitest run secrets-resolver.test.ts -t "RES-07: counters track lifecycle"` | ❌ W0 | ⬜ pending |
| 104-05-01 | 05 | 3 | SEC-07 | unit | `npx vitest run secrets-resolver.test.ts -t "RES-08: resolved value never logged"` | ❌ W0 | ⬜ pending |
| 104-05-02 | 05 | 3 | SEC-07 | unit | `npx vitest run secrets-resolver.test.ts -t "RES-09: error messages contain only URI"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Task IDs above are illustrative — final IDs are assigned by gsd-planner during planning. Each requirement (SEC-01..SEC-07) MUST have at least one task carrying its automated verify command.*

---

## Wave 0 Requirements

- [ ] `src/manager/secrets-resolver.ts` — implements `SecretsResolver` class (covers SEC-01..SEC-04, SEC-06, SEC-07)
- [ ] `src/manager/secrets-collector.ts` — `collectAllOpRefs(config)` walks config tree extracting `op://` URIs
- [ ] `src/manager/__tests__/secrets-resolver.test.ts` — covers RES-01..RES-09
- [ ] `src/manager/__tests__/secrets-resolver-callsites.test.ts` — grep-based assertion that no stray `op read` execSync exists outside `loader.ts:defaultOpRefResolver` (kept for back-compat) and `secrets-resolver.ts`
- [ ] `src/manager/__tests__/secrets-resolver-watcher.test.ts` — covers SEC-05 (ConfigWatcher hook)
- [ ] `src/manager/__tests__/daemon-boot-secrets-degraded.test.ts` — integration test for SEC-04 (partial pre-resolve failure)
- [ ] `src/ipc/__tests__/secrets-status.test.ts` — covers SEC-06 IPC handler
- [ ] Extension to `src/manager/__tests__/recovery-op-refresh.test.ts` — REC-OP-REFRESH-INV-01 verifies the recovery handler invalidates cache before re-resolve
- [ ] Add `p-retry@^8.0.0` to package.json + commit lockfile

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real 1Password rate-limit recovery window vs. configured backoff (1s/2s/4s + jitter) | SEC-03 | Requires triggering an actual 1P service-account throttle — staging-only. Faking the rate-limit error in unit tests verifies the AbortError path but not real recovery timing. | Post-deploy: in staging, fire `op read` in a tight loop until rate-limited, observe `secrets-status` IPC counter for `rateLimitHits`, confirm next agent spawn after 4–8s succeeds without error. Tune backoff if recovery window is consistently >8s. |
| 2026-04-30 incident regression — daemon survives N-agent restart storm | SEC-02, SEC-04 | Reproducing the systemd crash-loop × 14 agents × 5 secrets pattern is destructive on prod and impractical to fake locally. | Post-deploy: in staging, restart the daemon 5 times in 60 seconds with all agents enabled. Confirm only one `op read` per unique URI in pino logs (cache hit on 2nd+ boot), no agent failed to start, `secrets-status` shows `hits >> misses` after 3rd restart. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s (per-task) / 180s (full suite)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
