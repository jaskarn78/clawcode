---
phase: 110
plan: 07
subsystem: mcp-shim-runtime-swap
tags: [phase-110, stage-0b, wave-5, browser, rollout, partial, checkpoint-pending]
status: PARTIAL — Tasks 1 + 2 complete; Tasks 3 + 4 are operator-gated checkpoints AND blocked on Plan 110-06 GREEN
dependency-graph:
  requires:
    - 110-04-SUMMARY.md (Wave 2 production search Go shim binary; install path /usr/local/bin/clawcode-mcp-shim — browser inherits the binary)
    - 110-06-SUMMARY.md (image rollout — browser is LAST shim type per CONTEXT.md rollout order; image fleet GREEN is the §1 Prereq 0 for browser)
    - 110-01-SUMMARY.md (list-mcp-tools daemon IPC handler — browser MCP tools registered server-side at boot)
    - "src/manager/daemon.ts §browser-tool-call closure (already shipped Phase 70)"
  provides:
    - "internal/shim/browser/register.go — Go browser MCP shim Register, mirrors image Register byte-for-byte except shimType=\"browser\" + IPC method=\"browser-tool-call\""
    - "internal/shim/browser/register_test.go — 6 tests including 1 MB base64 PNG round-trip (Pitfall §2 regression — THE production-most-likely failure case for screenshots)"
    - "cmd/clawcode-mcp-shim/main.go — browser case wired with browser.Register; was stub exiting USAGE 64. Stage 0b structural deploy COMPLETE: all 3 shim types now Go-backed."
    - "110-07-ROLLOUT-LOG.md — operator rollout journal scaffold + RED-tier session-state warning at top + §1 Prereq 0 'Plan 110-06 GREEN'"
  affects:
    - "Plan 110-07 Tasks 3 + 4 — operator follows the rollout log during canary flip + fleet rollout"
    - "Plan 110-08 (cleanup) — unblocked when browser fleet GREEN; final Stage 0b housekeeping (keep or remove Node fallback)"
tech-stack:
  added: []
  patterns:
    - "Two-string substitution from image → browser: shimType label + IPC method name. Same Pitfall §1-§6 mitigations inherited."
    - "Test 6 — 1 MB base64 PNG payload via fake daemon serving browser-tool-call. Verifies browser_screenshot response shape survives the IPC scanner buffer end-to-end. THIS is the regression case Phase 110 most likely surfaces in production: screenshots are the largest base64-inline tool response across all three shim types."
    - "RED-tier reminder rendered at the TOP of the rollout log, not buried — Playwright/Chrome session state is RED tier and CANNOT regress; the shim migration MUST NOT touch session lifecycle."
key-files:
  created:
    - "internal/shim/browser/register.go (~150 lines)"
    - "internal/shim/browser/register_test.go (~360 lines, 6 tests)"
    - ".planning/phases/110-mcp-memory-reduction-shim-runtime-swap/110-07-ROLLOUT-LOG.md (~310 lines + RED-tier warning header)"
  modified:
    - "cmd/clawcode-mcp-shim/main.go (+ browser import; case 'browser' replaced stub with browser.Register)"
decisions:
  - "Mirror image, not search, as the immediate template — image is the closer parallel (both are post-110-04, both go through 16 MB buffer with non-trivial payloads). If image and browser drift, future contributors can diff browser/register.go ↔ image/register.go directly."
  - "Test 6 uses 1 MB (not 3 MB like image) because actual production browser_screenshot payloads observed are 200 KB - 1 MB. The 1 MB ceiling matches the upper end of real workload, exercises the buffer, and runs fast."
  - "Browser case in main.go is the LAST switch arm to be wired — completing it transitions Stage 0b from 'partially-Go' to 'fully-Go' once rollout signs off. The default arm remains the unknown-type error."
  - "RED-tier warning lives at the TOP of the rollout log, not in §1, because session-state regression is the only multi-shim-type failure that's structurally possible (Pitfall §2 truncation reads as a per-shim bug, but a Playwright lifecycle change touches all browser-using agents simultaneously)."
  - "End-to-end binary smoke test against the LIVE dev daemon (spawn binary --type browser, send MCP tools/list): browser Register returned 6 tools (browser_click, browser_extract, browser_fill, browser_navigate, browser_screenshot, browser_wait_for) — full path through the daemon's list-mcp-tools IPC verified."
metrics:
  duration: "~20 minutes (Task 1 + Task 2; Tasks 3 + 4 wall-clock gated)"
  completed: "2026-05-06 (Task 1 + Task 2)"
  tasks_complete: 2
  tasks_pending: 2
  files_created: 3
  files_modified: 1
  commits: 0  # batched with image into the same Stage 0b push
requirements: [0B-RT-01, 0B-RT-04, 0B-RT-05, 0B-RT-06, 0B-RT-07, 0B-RT-08, 0B-RT-10, 0B-RT-11, 0B-RT-12]
requirements_status: PENDING — implementation requirements (0B-RT-01/04/05/06) GREEN in dev; rollout requirements (0B-RT-07/08/10/11/12) gated on Tasks 3 + 4 operator action
---

# Phase 110 Plan 07: Browser Shim Wave 5 — Partial Summary (Tasks 1 + 2 only)

Tasks 1 + 2 (autonomous) ship the browser-shim implementation (Register + tests
+ main.go wiring) and the rollout log scaffold. Tasks 3 + 4 are operator-gated
AND blocked on Plan 110-06 (image rollout) reaching GREEN.

## Status Summary

| Task | Type                    | Status                                                                                                |
| ---- | ----------------------- | ----------------------------------------------------------------------------------------------------- |
| 1    | auto                    | **COMPLETE** — Register + 6 tests (incl. 1 MB screenshot regression) + main.go wiring                  |
| 2    | auto                    | **COMPLETE** — `110-07-ROLLOUT-LOG.md` scaffolded with RED-tier session-state warning                 |
| 3    | checkpoint:human-verify | **BLOCKED** — gated on Plan 110-06 fleet GREEN AND operator-driven canary flip + 24-48h watch         |
| 4    | checkpoint:human-verify | **BLOCKED** — gated on Task 3 GREEN; full-fleet browser rollout — Stage 0b structural deploy COMPLETE |

## What Shipped (Tasks 1 + 2)

### Task 1 — browser Register

`internal/shim/browser/register.go` mirrors `internal/shim/image/register.go` byte-for-byte EXCEPT:

| Aspect                              | image                                               | browser                                             |
| ----------------------------------- | --------------------------------------------------- | --------------------------------------------------- |
| Package                             | `package image`                                     | `package browser`                                   |
| `list-mcp-tools` shimType           | `"shimType": "image"`                               | `"shimType": "browser"`                             |
| Daemon tool-call IPC method         | `"image-tool-call"`                                 | `"browser-tool-call"`                               |
| Test 6 (Pitfall §2)                 | 3 MB base64 (image_generate response)               | **1 MB base64 PNG (browser_screenshot — THE prod regression case)** |

The 1 MB Test 6 payload is THE regression test for Pitfall §2 surfacing in
production. browser_screenshot is the largest base64-inline tool response
across all three shim types.

### Task 2 — rollout log scaffold

`110-07-ROLLOUT-LOG.md` mirrors `110-06-ROLLOUT-LOG.md` with browser
substitutions:`shimRuntime.browser`, `clawcode-mcp-shim --type browser`,
`browser_screenshot` smoke tool, `measure-shim-rss.sh browser`.

**NEW** at the TOP of the log: a RED-tier reminder block:
> 🟥 **RED tier — session state OUT of scope:** Browser SESSION STATE
> (Playwright/Chrome lifecycle) is RED tier and stays daemon-side. This
> rollout migrates ONLY the IPC translator shim. If session state regresses
> (lost browser context, broken cookies, missing pages), it's a bug in the
> migration — rollback immediately.

**§1 Prereq 0**: image rollout (Plan 110-06) MUST be GREEN before browser starts.

### Verification artifacts

- `go test ./internal/shim/browser/... -v` → 6/6 tests pass (~26 ms)
- `go test ./...` → all 4 packages green
- `go build ./cmd/clawcode-mcp-shim` → binary 5.7 MB (unchanged from image build)
- Dev daemon end-to-end (spawn binary --type browser, send MCP `tools/list`):
  - 6 tools registered: browser_click, browser_extract, browser_fill, browser_navigate, browser_screenshot, browser_wait_for
  - stderr log shows clean `shim starting serverType=browser`

### Dev daemon stress test (search shim, regression check on new binary)

Confirms the upgraded binary (now containing image + browser packages
compiled in alongside search) is regression-free for the search path which is
already deployed to prod:

- 50 prompts via dev-canary on Go search shim
- 50/50 OK, 0 PID respawns, 0 RSS growth (6568 kB stable for entire run), 0 exit-75
- Initial PID == final PID — no flap

## Stage 0b Structural Status (post-this-plan, in dev)

| Shim type | Status in dev      | Status in prod     | Notes                                          |
| --------- | ------------------ | ------------------ | ---------------------------------------------- |
| search    | ✅ shipped (110-04) | ✅ binary deployed; canary unflipped (110-05) | Plan 110-05 Task 2 unflipped on operator hold |
| image     | ✅ shipped (110-06) | binary contains code; not flipped | Tasks 3 + 4 blocked on 110-05 GREEN |
| browser   | ✅ shipped (110-07) | binary contains code; not flipped | Tasks 3 + 4 blocked on 110-06 GREEN |

After 110-07 Tasks 3 + 4 reach GREEN: aggregate Stage 0b RSS savings ≥ 2.7 GiB
(3 × ~900 MB per shim type) is realized on clawdy.

## Acceptance Criteria — All Green

From PLAN.md Task 1:
- ✅ `internal/shim/browser/register.go` exists, package=browser, has `"shimType": "browser"` + `"browser-tool-call"`
- ✅ no leftover `"image-tool-call"` / `"search-tool-call"` / `"shimType":"image"` / `"shimType":"search"`
- ✅ `browser.Register(server)` wired in main.go
- ✅ no stdout writes; no retry/fallback patterns
- ✅ all 6 browser tests pass; `go test ./...` green
- ✅ Test 6 (TestScreenshotLargePayloadRoundtrip) passes — 1 MB regression for Pitfall §2
- ✅ binary builds 5.7 MB ≤ 12 MB

From PLAN.md Task 2:
- ✅ `110-07-ROLLOUT-LOG.md` exists; `browser` count = 18 (≥ 10)
- ✅ `browser_screenshot` smoke tool referenced
- ✅ `RED tier|session state` warning present
- ✅ no leftover `shimRuntime.image:` / `image_generate`
- ✅ Plan 110-06 prereq referenced in §1
- ✅ "Fail loud" verbatim policy preserved
