---
phase: 110
plan: 00
subsystem: mcp-shim-runtime-swap
tags: [phase-110, stage-0b, wave-0, go-shim, kill-switch, spike, rss-measurement]
requires: []
provides:
  - "Working Go MCP spike binary (clawcode-mcp-shim --type search) — initialize handshake + tools/list passthrough only"
  - "Operator-runnable RSS measurement helper (scripts/integration/measure-spike-rss.sh)"
  - "Operator-runnable spike deploy + RSS measurement runbook (110-SPIKE-RUNBOOK.md)"
  - "Phase 110 Stage 0b kill-switch gate posture — Wave 1 unblocks ONLY on operator-recorded RSS ≤ 15 MB + exit-75 respawn confirmed"
affects:
  - "Stage 0b structural work — Wave 1 (Plan 110-01) blocked until operator approves Wave 0 RSS gate"
  - "Phase 110 pivot semantics — Stage 0b ABORTS to Python (FastMCP) replan if VmRSS > 15 MB OR exit-75 respawn semantics broken (locked: NO auto-fall-back to Node)"
tech-stack:
  added:
    - "Go 1.25 (transitively pulled by github.com/modelcontextprotocol/go-sdk@v1.5.0 module requirement; original target was Go 1.22+)"
    - "github.com/modelcontextprotocol/go-sdk v1.5.0 (official MCP server SDK; supports MCP spec 2025-11-25)"
    - "Transitive deps: github.com/google/jsonschema-go v0.4.2, github.com/segmentio/encoding v0.5.4, github.com/segmentio/asm v1.1.3, github.com/yosida95/uritemplate/v3 v3.0.2, golang.org/x/oauth2 v0.35.0, golang.org/x/sys v0.41.0"
  patterns:
    - "Phase 108 broker exit-code semantics replicated verbatim (SHIM_EXIT_OK=0, SHIM_EXIT_USAGE=64, SHIM_EXIT_TEMPFAIL=75) so Claude Code SDK 0.2.97 respawn behavior is identical between Node and Go shims"
    - "stderr-only slog (slog.NewJSONHandler(os.Stderr, ...)) — Pitfall §6 (stdout owned by MCP SDK)"
    - "Source-grep regression test: TestNoStdoutWritesOutsideSDK greps cmd/ + internal/ for fmt.Println / os.Stdout.Write — guards against future contributors poisoning JSON-RPC framing"
    - "Static binary build: CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags='-s -w' — produces 5.7 MB on-disk binary (under the 12 MB plan ceiling)"
key-files:
  created:
    - "go.mod (module github.com/jjagpal/clawcode-shim)"
    - "go.sum (transitive deps)"
    - "cmd/clawcode-mcp-shim/main.go (spike entrypoint with --type dispatch)"
    - "internal/shim/search/spike.go (RegisterSpike — one stub web_search tool, returns 'spike-ok')"
    - "internal/shim/search/main_test.go (4 regression tests)"
    - "scripts/integration/measure-spike-rss.sh (executable; reads /proc/<pid>/status VmRSS; exits 0/1/2 PASS/script-error/FAIL)"
    - ".planning/phases/110-mcp-memory-reduction-shim-runtime-swap/110-SPIKE-RUNBOOK.md (10-section operator runbook)"
  modified: []
decisions:
  - "Go module at REPO ROOT (not in a shim/ subtree) — VALIDATION.md task commands like `go test ./internal/shim/search` require root-level go.mod. Locked by plan task 1 action block."
  - "InputSchema as json.RawMessage (opaque pass-through) — SDK accepts json.RawMessage natively; avoids re-encoding via Go-typed schema struct."
  - "Spike tool input typed as struct{Query string} — SDK's typed AddTool generic enforces input shape against the JSON schema; query field marshals/unmarshals correctly even though we don't read its value (handler returns fixed 'spike-ok' regardless)."
  - "Exit-75 respawn verification deferred to operator runbook step 6 — cannot be automated without live SDK + admin-clawdy. Documented procedure in 110-SPIKE-RUNBOOK.md."
metrics:
  duration: "~25 minutes (Tasks 1+2 build + tests + commits; excludes the Task 3 operator gate which is not yet performed)"
  completed: "2026-05-06 (build artifacts only; operator RSS measurement gate pending)"
---

# Phase 110 Plan 00: MCP shim runtime swap — Stage 0b Wave 0 spike + kill-switch gate Summary

Wave 0 spike artifacts shipped — minimal Go MCP shim binary (search-type only, initialize handshake + tools/list passthrough, no daemon IPC) compiles to a 5.7 MB static binary, all four regression tests pass (binary dispatch, unknown-type rejection with exit 64, MCP protocol-version 2025-11-25 negotiation pin, no stdout writes outside the SDK), and the operator-runnable measurement runbook + helper script are wired. The kill-switch gate (Task 3) is a `human-action` checkpoint: operator must deploy to admin-clawdy, sample VmRSS via `/proc/<pid>/status` 3× across 30 min, verify exit-75 respawn, and respond `approved` or `aborted` per the 15 MB threshold.

## Build Artifacts Produced

| Artifact | Path | Bytes / Lines |
| --- | --- | --- |
| Go module | `go.mod` | 14 lines |
| Module checksum | `go.sum` | 20 lines |
| Spike entrypoint | `cmd/clawcode-mcp-shim/main.go` | 60 lines |
| Spike registrar | `internal/shim/search/spike.go` | 51 lines |
| Test fixture | `internal/shim/search/main_test.go` | 241 lines (4 tests) |
| RSS measurement helper | `scripts/integration/measure-spike-rss.sh` | 35 lines (executable) |
| Operator runbook | `.planning/phases/110-mcp-memory-reduction-shim-runtime-swap/110-SPIKE-RUNBOOK.md` | 161 lines (10 sections) |
| Compiled binary | `/tmp/clawcode-mcp-shim` (build artifact) | 5,701,816 bytes (5.7 MB on-disk) |

## Test Results

```
$ go test ./internal/shim/search/ -run "TestSpikeBinaryDispatchesSearchType|TestSpikeRejectsUnknownType|TestProtocolVersionPin|TestNoStdoutWritesOutsideSDK" -v
=== RUN   TestSpikeBinaryDispatchesSearchType
--- PASS: TestSpikeBinaryDispatchesSearchType (0.00s)
=== RUN   TestSpikeRejectsUnknownType
--- PASS: TestSpikeRejectsUnknownType (0.00s)
=== RUN   TestProtocolVersionPin
--- PASS: TestProtocolVersionPin (0.00s)
=== RUN   TestNoStdoutWritesOutsideSDK
--- PASS: TestNoStdoutWritesOutsideSDK (0.00s)
PASS
ok  	github.com/jjagpal/clawcode-shim/internal/shim/search	0.957s
```

## Operator Gate (Task 3) — PENDING

The kill-switch checkpoint cannot be performed in this executor because it requires:

1. SSH access to the clawdy host
2. Modifying admin-clawdy's `mcpServers.search` config to point at `/usr/local/bin/clawcode-mcp-shim --type search`
3. Restarting admin-clawdy via `clawcode restart admin-clawdy`
4. Running `pgrep` + `cat /proc/<pid>/status` against the live spike process at 3 timestamps across 30 minutes
5. Replacing the binary with an exit-75 stub to verify SDK respawn

The full procedure is documented at `.planning/phases/110-mcp-memory-reduction-shim-runtime-swap/110-SPIKE-RUNBOOK.md`.

**Decision posture:** the gate is a `human-action` checkpoint. Auto-approval is NOT applicable here — the operator must measure live RSS on production-shaped hardware. The orchestrator's auto-mode cannot perform real-host deployment + measurement.

### Awaiting

- Operator runs §1-§7 of `110-SPIKE-RUNBOOK.md` and fills in the Decision recording table.
- Operator responds `approved` (median VmRSS ≤ 15 MB AND exit-75 respawn confirmed) → Wave 1 (Plan 110-01) unblocks.
- Operator responds `aborted` with measured RSS (median > 15 MB OR respawn semantics broken) → Stage 0b stops; replanner pivots to Python via `/gsd:replan-phase 110 --pivot=python`.

### Locked policy

NO auto-fall-back to Node. Quoted verbatim from 110-CONTEXT.md:
> "Fail loud, NO auto-fall-back to Node. Surface segfaults; do not silently degrade."

## Deviations from Plan

### Auto-fixed (Rule 1 — Bug)

**1. [Rule 1 - Bug] mcp.AddTool API signature mismatch — generic, panics on error, no return value**

- **Found during:** Task 1 implementation against modelcontextprotocol/go-sdk@v1.5.0
- **Issue:** Plan task 1 action block specified `return mcp.AddTool(server, &mcp.Tool{...}, handler)` — implying `AddTool` returns an `error`. The actual SDK signature at `github.com/modelcontextprotocol/go-sdk@v1.5.0/mcp/server.go:503` is `func AddTool[In, Out any](s *Server, t *Tool, h ToolHandlerFor[In, Out])` — generic, no return, panics on schema validation failure.
- **Fix:** Adjusted `RegisterSpike` to invoke `mcp.AddTool(...)` without `return`, and `RegisterSpike` itself returns `nil`. The caller (`main.go`) handles the spike-only case where `RegisterSpike` cannot fail at runtime via Go semantics — schema panics surface at startup via `server.Run()` reporting the error to stderr, matching the Pitfall §6 stdout-hygiene contract.
- **Files modified:** `internal/shim/search/spike.go`, `cmd/clawcode-mcp-shim/main.go` (removed the `if err := ...` guard around `RegisterSpike` since it never returns non-nil)
- **Commit:** captured in `81f98c6` (parallel-executor staged my files into 110-03's commit; see "Commit Attribution" below)

**2. [Rule 1 - Bug] mcp.TextContent must be passed by pointer**

- **Found during:** Task 1 implementation
- **Issue:** Plan said `mcp.TextContent{Text: "spike-ok"}` (value). The SDK's `Content` interface implementation requires `*TextContent` (pointer). Passing by value causes compile error.
- **Fix:** Changed to `&mcp.TextContent{Text: "spike-ok"}`.
- **Files modified:** `internal/shim/search/spike.go`
- **Commit:** as above (81f98c6)

**3. [Rule 3 - Blocking] Go SDK requires Go 1.25+, plan specified Go 1.22+**

- **Found during:** `go get github.com/modelcontextprotocol/go-sdk@v1.5.0`
- **Issue:** SDK module declares `go >= 1.25.0`. Local toolchain was Go 1.22.2. The `go` command auto-upgraded to Go 1.25.9 via toolchain directive ("`upgraded go 1.22.2 => 1.25.0`").
- **Fix:** Accepted the auto-upgrade; build + tests work with Go 1.25.9. The plan's "Go 1.22+" phrasing is now under-spec — the binding constraint is Go 1.25+ for SDK v1.5.0.
- **Files modified:** none (toolchain upgrade is automatic via go.mod toolchain directive)
- **Commit:** as above (81f98c6); future plans (110-03, CI matrix) should reflect Go 1.25+ if not already.

## Commit Attribution

**Note on parallel-executor file race (2026-05-06 13:54 UTC):** I (110-00 executor) wrote five files (`go.mod`, `go.sum`, `cmd/clawcode-mcp-shim/main.go`, `internal/shim/search/spike.go`, `internal/shim/search/main_test.go`) and ran tests successfully. Before I could commit them under a `feat(110-00):` message, the parallel 110-03 executor staged its working tree (including my as-yet-unstaged Wave 0 files, since both agents share the same git working tree) and committed under `feat(110-03):` (commit `81f98c6`). My five files are in that commit verbatim — exact byte content matches what I wrote — but the commit attribution is on 110-03 because of the staging race.

This is an acknowledged hazard of parallel executors sharing one working tree; the plan output (binary, tests passing, runbook + script) is materially correct. Task 2 commit landed cleanly under my own message at `5e1af28`.

| Task | Files | Commit | Author message |
| --- | --- | --- | --- |
| 1 (Bootstrap module + spike) | `go.mod`, `go.sum`, `cmd/clawcode-mcp-shim/main.go`, `internal/shim/search/spike.go`, `internal/shim/search/main_test.go` | `81f98c6` | `feat(110-03): implement postinstall-shim ...` (parallel-executor race; my files in commit verbatim) |
| 2 (Runbook + RSS helper) | `scripts/integration/measure-spike-rss.sh`, `.planning/phases/110-mcp-memory-reduction-shim-runtime-swap/110-SPIKE-RUNBOOK.md` | `5e1af28` | `docs(110-00): author spike deploy runbook + RSS measurement helper` |
| 3 (Operator kill-switch gate) | (operator-driven; 110-SPIKE-RUNBOOK.md Decision recording table fills in post-measurement) | (pending operator action) | n/a |

## PASS/FAIL Decision and Rationale

**Build artifacts:** PASS (Tasks 1+2 — all 13 acceptance criteria across both tasks met; 4/4 tests pass; binary 5.7 MB on disk under 12 MB ceiling).

**Operator RSS gate:** PENDING — cannot be performed by the executor agent. Operator follows `110-SPIKE-RUNBOOK.md` and records the decision in §7's table.

If the operator's measured median VmRSS ≤ 15 MB AND exit-75 respawn is confirmed, Wave 1 (Plan 110-01) unblocks for execution. If either condition fails, Stage 0b ABORTS for Python pivot replan via `/gsd:replan-phase 110 --pivot=python`.

## Self-Check: PASSED

All claimed artifacts and commit hashes exist on disk + in git history.

| Item | Status |
| --- | --- |
| `go.mod` | FOUND |
| `go.sum` | FOUND |
| `cmd/clawcode-mcp-shim/main.go` | FOUND |
| `internal/shim/search/spike.go` | FOUND |
| `internal/shim/search/main_test.go` | FOUND |
| `scripts/integration/measure-spike-rss.sh` | FOUND |
| `.planning/phases/110-mcp-memory-reduction-shim-runtime-swap/110-SPIKE-RUNBOOK.md` | FOUND |
| `.planning/phases/110-mcp-memory-reduction-shim-runtime-swap/110-00-SUMMARY.md` | FOUND (this file) |
| Commit `81f98c6` (Task 1 files; parallel-executor race) | FOUND |
| Commit `5e1af28` (Task 2 — runbook + RSS helper) | FOUND |
