---
phase: 110
slug: mcp-memory-reduction-shim-runtime-swap
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-05
---

# Phase 110 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (TypeScript)** | vitest 4.x (existing) |
| **Framework (Go)** | `go test` (Wave 0 installs Go toolchain) |
| **Config file** | `vitest.config.ts` (exists); `go.mod` (Wave 0 creates) |
| **Quick run command (TS)** | `npx vitest run --reporter=basic <changed files>` |
| **Full suite command (TS)** | `npx vitest run` |
| **Quick run command (Go)** | `go test ./internal/shim/...` |
| **Full suite command (Go)** | `go test ./...` |
| **Estimated runtime** | TS ~30s; Go ~5s after Wave 0 |

---

## Sampling Rate

- **After every task commit:** Run quick command for the language touched (TS quick OR Go quick).
- **After every plan wave:** Run BOTH full suites (TS + Go).
- **Before `/gsd:verify-work`:** Both full suites must be green.
- **Max feedback latency:** 60 seconds (TS quick + Go quick combined).

---

## Per-Task Verification Map

> **Note:** Task IDs and exact commands are populated by the planner during PLAN.md generation. This map is the contract — every plan task MUST appear here with an automated verification command OR a documented Wave 0 dependency.

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 110-01-01 | 01 | 0 | Spike RSS measurement | manual | `ssh clawdy 'cat /proc/$(pgrep -f clawcode-mcp-shim)/status \| grep VmRSS'` | ❌ W0 | ⬜ pending |
| 110-02-01 | 02 | 1 | `list-mcp-tools` IPC method | unit | `npx vitest run src/manager/__tests__/list-mcp-tools.test.ts` | ❌ W0 | ⬜ pending |
| 110-02-02 | 02 | 1 | Schema enum widening | unit | `npx vitest run src/config/__tests__/shim-runtime-enum.test.ts` | ❌ W0 | ⬜ pending |
| 110-02-03 | 02 | 1 | Go CI matrix builds | CI | `gh workflow run go-build.yml --ref <branch>` | ❌ W0 | ⬜ pending |
| 110-03-01 | 03 | 2 | search-mcp Go shim — initialize handshake | unit | `go test ./internal/shim/search -run TestInitializeHandshake` | ❌ W0 | ⬜ pending |
| 110-03-02 | 03 | 2 | search-mcp Go shim — id rewriting | unit | `go test ./internal/shim/search -run TestRequestIdRewrite` | ❌ W0 | ⬜ pending |
| 110-03-03 | 03 | 2 | search-mcp 16 MB buffer | unit | `go test ./internal/shim/search -run TestLargePayload` | ❌ W0 | ⬜ pending |
| 110-03-04 | 03 | 2 | search-mcp hot-reload flip | integration | `npx vitest run src/manager/__tests__/shim-runtime-hotreload.test.ts` | ❌ W0 | ⬜ pending |
| 110-04-01 | 04 | 3 | image-mcp Go shim parity | unit | `go test ./internal/shim/image` | ❌ W0 | ⬜ pending |
| 110-05-01 | 05 | 4 | browser-mcp Go shim parity | unit | `go test ./internal/shim/browser` | ❌ W0 | ⬜ pending |
| 110-06-01 | 06 | 5 | Dead Node code path removed | grep | `! grep -r "shim-runtime.*node-only" src/` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

> Planner refines task IDs and commands based on actual plan breakdown. The contract: every task gets an automated verify OR an explicit Wave 0 dependency (test fixture creation, infra install, etc.).

---

## Wave 0 Requirements

- [ ] **Go toolchain installed in CI** — `actions/setup-go@v5` with cache, in `.github/workflows/go-build.yml`
- [ ] `go.mod` initialized at repo root or in `internal/shim/` subtree (planner decides exact location)
- [ ] `internal/shim/search/` — minimal spike binary: initialize handshake + tools/list passthrough only
- [ ] `internal/shim/search/main_test.go` — test fixture for protocol-version negotiation regression
- [ ] `tests/__fakes__/clawdy-spike-shim.ts` — fixture wiring for daemon-side spike-flip integration tests
- [ ] **Spike deploy + measurement runbook** — short markdown doc at `.planning/phases/110-mcp-memory-reduction-shim-runtime-swap/110-SPIKE-RUNBOOK.md` documenting how to deploy the spike to admin-clawdy and read `/proc/<pid>/status`

> **Wave 0 kill-switch criterion:** Spike binary RSS ≤ 15 MB on clawdy host (admin-clawdy agent context). Fail → STOP. Pivot to Python before any Wave 1 structural work commits.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Wave 0 RSS measurement on real clawdy host | Stage 0b kill-switch gate | `/proc/<pid>/status` measurement requires live deploy on production-shaped host (admin-clawdy); CI VM RSS will not match clawdy's cgroup-constrained reality | Deploy spike binary to clawdy. Run `pgrep -f 'clawcode-mcp-shim --type search'` to find pid. `cat /proc/<pid>/status \| grep VmRSS`. Record value in 110-SPIKE-RUNBOOK.md. Pass if ≤ 15 MB. |
| 24-48h dashboard watch between waves | Per-wave rollout gate | Production observability over real workload time can't be unit-tested | After flipping `defaults.shimRuntime.<type>: "static"` for one agent, watch fleet-stats dashboard for: per-shim-type RSS holding sub-15 MB, no broker error spikes, no claude-process drift. After 24-48h green, expand to fleet. |
| Crash-fallback policy verification | LOCKED operator decision | Real-world Go shim crash needed; SIGSEGV via fault injection in test ≠ real crash semantics | If a real Go shim crash occurs in production, verify: claude proc surfaces error to operator (no silent degrade), no auto-fall-back to Node, journal logs the crash with PID + signal. |
| 11-agent concurrent hammer | Resource exhaustion test | FD leaks + race conditions in alternate runtime only surface at full fleet scale on real host | After Wave 4 (browser migration complete), spawn all 11 fleet agents simultaneously. Monitor: aggregate FD count via `lsof -p <daemon-pid> \| wc -l`, no socket-EMFILE errors, no goroutine leaks via Go pprof. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (Go toolchain install, go.mod, spike binary, fixture wiring, runbook doc)
- [ ] No watch-mode flags in commands
- [ ] Feedback latency < 60s for quick TS+Go combined
- [ ] `nyquist_compliant: true` set in frontmatter (after planner refines per-task entries)

**Approval:** pending — set after gsd-planner completes PLAN.md files and gsd-plan-checker verifies coverage
