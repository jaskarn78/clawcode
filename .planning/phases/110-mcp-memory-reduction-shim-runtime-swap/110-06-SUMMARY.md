---
phase: 110
plan: 06
subsystem: mcp-shim-runtime-swap
tags: [phase-110, stage-0b, wave-4, image, rollout, partial, checkpoint-pending]
status: PARTIAL — Tasks 1 + 2 complete; Tasks 3 + 4 are operator-gated checkpoints awaiting human action AND blocked on Plan 110-05 GREEN
dependency-graph:
  requires:
    - 110-04-SUMMARY.md (Wave 2 production search Go shim binary; install path /usr/local/bin/clawcode-mcp-shim — image inherits the binary)
    - 110-05-ROLLOUT-LOG.md (search rollout MUST be GREEN before image starts; 110-06-ROLLOUT-LOG.md §1 prereq #0 enforces this)
    - 110-01-SUMMARY.md (list-mcp-tools daemon IPC handler — image MCP tools registered server-side at boot regardless of per-agent enable flag)
    - "src/manager/daemon.ts §image-tool-call closure (already shipped pre-Phase-110, mirrors browser-tool-call from Phase 70)"
  provides:
    - "internal/shim/image/register.go — Go image MCP shim Register, mirrors search Register byte-for-byte except shimType=\"image\" + IPC method=\"image-tool-call\""
    - "internal/shim/image/register_test.go — 6 tests including 3 MB base64 payload round-trip (Pitfall §2 regression on the image-shim path)"
    - "cmd/clawcode-mcp-shim/main.go — image case wired with image.Register; was stub exiting USAGE 64"
    - "110-06-ROLLOUT-LOG.md — operator rollout journal scaffolded as parallel of 110-05; §1 adds NEW prereq #0 'Plan 110-05 GREEN' before any image flip"
  affects:
    - "Plan 110-06 Tasks 3 + 4 — operator follows the rollout log during canary flip + fleet rollout; results recorded into the same file"
    - "Plan 110-07 (browser rollout) — unblocked by image fleet GREEN; mirrors same Register + rollout structure"
tech-stack:
  added: []
  patterns:
    - "Two-string substitution from search → image: shimType label + IPC method name. All other Pitfall §1-§6 mitigations (16 MB scanner buffer via shared internal/shim/ipc/client.go, stderr-only logging, exit-75 semantics, no fallback/retry) inherited unchanged."
    - "Test 6 regression for Pitfall §2 — 3 MB base64 payload via fake daemon serving image-tool-call. Verifies image_generate response shape survives the IPC scanner buffer end-to-end (image responses can be several MB)."
    - "Many-small-files convention preserved: image package is its own subdirectory parallel to search, no shared package state."
key-files:
  created:
    - "internal/shim/image/register.go (~150 lines)"
    - "internal/shim/image/register_test.go (~370 lines, 6 tests)"
    - ".planning/phases/110-mcp-memory-reduction-shim-runtime-swap/110-06-ROLLOUT-LOG.md (~310 lines, 7 sections + RED-tier reminder + §1 prereq 0 'Plan 110-05 GREEN')"
  modified:
    - "cmd/clawcode-mcp-shim/main.go (+ image import; case 'image' replaced stub with image.Register; package docstring updated)"
decisions:
  - "Mechanical sed-style substitution from search/register.go: only shimType label + IPC method name change. The handler is byte-equivalent so the Pitfall §2 16 MB buffer (already in shared internal/shim/ipc/client.go) automatically protects the image path. No new IPC plumbing."
  - "Test 6 (3 MB payload) is more aggressive than search Test 6 (search has none) because image_generate responses can carry base64-encoded image data that is larger than search results. 3 MB is well below the 16 MB ceiling but well above the 64 KB default scanner buffer — exercises the buffer."
  - "Rollout log §1 adds explicit Prereq 0 'Plan 110-05 (search rollout) GREEN'. CONTEXT.md locks per-shim-type rollout order (search → image → browser); recording the prereq in the rollout log makes the gate visible during execution."
  - "End-to-end binary smoke test against the LIVE dev daemon (spawn /home/jjagpal/dev-clawcode-mcp-shim --type image, send MCP initialize + tools/list over stdio): image Register returned 3 tools (image_edit, image_generate, image_variations) — full path through the daemon's list-mcp-tools IPC verified, not just unit-test fakes."
metrics:
  duration: "~25 minutes (Task 1 + Task 2; Tasks 3 + 4 wall-clock gated, separate)"
  completed: "2026-05-06 (Task 1 + Task 2)"
  tasks_complete: 2
  tasks_pending: 2
  files_created: 3
  files_modified: 1
  commits: 0  # batched with browser into the same Stage 0b push
requirements: [0B-RT-01, 0B-RT-04, 0B-RT-05, 0B-RT-06, 0B-RT-07, 0B-RT-08, 0B-RT-10, 0B-RT-11, 0B-RT-12]
requirements_status: PENDING — implementation requirements (0B-RT-01/04/05/06) GREEN in dev; rollout requirements (0B-RT-07/08/10/11/12) gated on Tasks 3 + 4 operator action
---

# Phase 110 Plan 06: Image Shim Wave 4 — Partial Summary (Tasks 1 + 2 only)

Tasks 1 + 2 (autonomous) of plan 110-06 ship the image-shim implementation
(Register + tests + main.go wiring) and the rollout log scaffold. Tasks 3 + 4
are operator-gated checkpoints AND are blocked on Plan 110-05 (search rollout)
reaching GREEN — they cannot start in this executor invocation regardless of
operator availability.

## Status Summary

| Task | Type                    | Status                                                                                                        |
| ---- | ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1    | auto                    | **COMPLETE** — Register + 6 tests + main.go wiring; binary builds 5.7 MB (≤ 12 MB ceiling)                    |
| 2    | auto                    | **COMPLETE** — `110-06-ROLLOUT-LOG.md` scaffolded; new Prereq 0 'Plan 110-05 GREEN' added                     |
| 3    | checkpoint:human-verify | **BLOCKED** — gated on Plan 110-05 fleet GREEN AND operator-driven canary flip + 24-48h watch on admin-clawdy |
| 4    | checkpoint:human-verify | **BLOCKED** — gated on Task 3 GREEN; full-fleet image rollout                                                 |

## What Shipped (Tasks 1 + 2)

### Task 1 — image Register

`internal/shim/image/register.go` mirrors `internal/shim/search/register.go` byte-for-byte EXCEPT:

| Aspect                              | search                                              | image                                               |
| ----------------------------------- | --------------------------------------------------- | --------------------------------------------------- |
| Package                             | `package search`                                    | `package image`                                     |
| `list-mcp-tools` shimType           | `"shimType": "search"`                              | `"shimType": "image"`                               |
| Daemon tool-call IPC method         | `"search-tool-call"`                                | `"image-tool-call"`                                 |
| Test 6 (Pitfall §2 regression)      | (none — Plan 110-04 had no large-payload tool)      | **3 MB base64 payload via fake daemon — NEW**       |

Everything else is identical: shared `internal/shim/ipc/client.go`, fail-loud
contract (no retry, no Node fallback), CLAWCODE_AGENT requirement, exit-75
semantics, stderr-only logging.

### Task 2 — rollout log scaffold

`110-06-ROLLOUT-LOG.md` mirrors `110-05-ROLLOUT-LOG.md` with image substitutions:
`shimRuntime.image`, `clawcode-mcp-shim --type image`, `image_generate` smoke
tool, `measure-shim-rss.sh image`. **NEW**: §1 Prereq 0 enforces "Plan 110-05
fleet GREEN" before any image flip.

### Verification artifacts

- `go test ./internal/shim/image/... -v` → 6/6 tests pass (~45 ms)
- `go test ./...` → all 4 packages green (search, image, browser, ipc)
- `go build ./cmd/clawcode-mcp-shim` → binary 5,701,816 bytes (5.7 MB, ≤ 12 MB ceiling)
- Dev daemon end-to-end (spawn binary --type image, send MCP `tools/list`):
  - 3 tools registered: `image_edit`, `image_generate`, `image_variations`
  - stderr log shows clean `shim starting serverType=image` startup

## What Did NOT Ship

- Tasks 3 + 4 (canary + fleet rollout) — blocked on Plan 110-05 GREEN AND operator action
- No prod deploy — Phase 110 deploy auth from this morning is exhausted; explicit operator confirmation required before any clawdy restart

## Acceptance Criteria — All Green

From PLAN.md Task 1:
- ✅ `internal/shim/image/register.go` exists, package=image, has `"shimType": "image"` + `"image-tool-call"`
- ✅ no leftover `"search-tool-call"` or `"shimType": "search"` references
- ✅ `image.Register(server)` wired in `cmd/clawcode-mcp-shim/main.go`
- ✅ no stdout writes (`fmt.Println` / `os.Stdout.Write`)
- ✅ no retry / fallback / `MaxRetries` patterns
- ✅ all 6 image tests pass
- ✅ binary builds; size 5.7 MB ≤ 12 MB

From PLAN.md Task 2:
- ✅ `110-06-ROLLOUT-LOG.md` exists; `image` count = 17 (≥ 10)
- ✅ no leftover `shimRuntime.search:` or `web_search\b`
- ✅ `image_generate` smoke tool referenced
- ✅ "Fail loud" verbatim policy preserved
- ✅ Plan 110-05 prereq referenced in §1
