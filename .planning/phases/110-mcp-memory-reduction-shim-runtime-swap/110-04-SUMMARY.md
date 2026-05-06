---
phase: 110
plan: 04
subsystem: mcp-shim-runtime-swap
tags: [phase-110, stage-0b, wave-2, go-shim, search, ipc-client, register, production]
dependency-graph:
  requires:
    - 110-00-SUMMARY.md (Wave 0 spike + kill-switch passed: VmRSS 6.4 MB on clawdy)
    - 110-01-SUMMARY.md (list-mcp-tools daemon IPC method shipped)
    - 110-02-SUMMARY.md (schema enum widened; resolveShimCommand helper; classifyShimRuntime observability)
    - 110-03-SUMMARY.md (CI Go-build + npm prebuild-install distribution pipeline)
  provides:
    - "internal/shim/ipc.SendRequest — reusable daemon IPC client (newline JSON-RPC, 16 MB buffer, one-request-per-conn)"
    - "internal/shim/search.Register — production search MCP shim (boot-time schema fetch + tools/call IPC translation, fail-loud)"
    - "cmd/clawcode-mcp-shim production binary with --type search wired end-to-end; image/browser stubs exit 64 referencing plans 110-06/110-07"
    - "Plan 110-05 deploy gate unblocked — binary is production-ready for Wave 2 (search) admin-clawdy canary"
  affects:
    - "Plan 110-05 (Wave 3 deploy) — consumes the artifact built here"
    - "Plan 110-06 (Wave 3 image) — extends main.go case 'image' with real Register"
    - "Plan 110-07 (Wave 4 browser) — extends main.go case 'browser' with real Register"
tech-stack:
  added:
    - "github.com/google/uuid v1.6.0 (request id generation in IPC client; ~50 KB binary growth)"
  patterns:
    - "Newline-delimited JSON-RPC over unix socket — byte-exact match to src/ipc/client.ts:34-46 (TypeScript source-of-truth)"
    - "16 MB bufio.Scanner buffer — Pitfall §2 mitigation; canonical regression test (4 MB payload) pinned in client_test.go"
    - "One-request-per-connection (defer conn.Close after every SendRequest) — Pitfall §3 mitigation"
    - "Boot-time schema fetch via list-mcp-tools — Pitfall §4 mitigation (Zod single-sourced; no Go schema duplication)"
    - "Fail-loud handler: IPC errors become CallToolResult{IsError: true}; NO automatic recovery, NO Node fallback (operator-locked policy)"
    - "Phase 108 broker exit-code semantics: SHIM_EXIT_OK=0, SHIM_EXIT_USAGE=64, SHIM_EXIT_TEMPFAIL=75 — Pitfall §5 SDK respawn semantics"
    - "Panic recovery → exit 75: deferred recover() in main.go converts unexpected runtime panics to TEMPFAIL so SDK respawns instead of disabling tool permanently"
    - "Source-grep regression tests: TestRegisterSourceContainsNoFallbackOrRetry + TestIntegrationNoSpikeArtifactsInSource guard against future contributors silently degrading the locked policies"
key-files:
  created:
    - "internal/shim/ipc/client.go (~135 lines — SocketPath + Request/Response/ResponseError + SendRequest)"
    - "internal/shim/ipc/client_test.go (~225 lines — 6 regression tests: round-trip, 4 MB payload, early close, error envelope, accept-count, env override)"
    - "internal/shim/search/register.go (~140 lines — Register + makeHandler + errorResult)"
    - "internal/shim/search/register_test.go (~265 lines — 5 register-level tests against fake daemon)"
    - "internal/shim/search/integration_test.go (~395 lines — 5 compiled-binary integration tests)"
  modified:
    - "cmd/clawcode-mcp-shim/main.go (RegisterSpike → Register; version 0.1.0-spike → 0.1.0; image/browser stubs added; deferred recover→exit-75 added)"
    - "go.mod / go.sum (added github.com/google/uuid v1.6.0)"
  deleted:
    - "internal/shim/search/spike.go (Wave 0 RegisterSpike; superseded by Register)"
    - "internal/shim/search/main_test.go (Wave 0 binary-spawn spike tests; superseded by register_test.go + integration_test.go)"
decisions:
  - "Use Server.AddTool (lower-level, ToolHandler signature accepting json.RawMessage Arguments) instead of the generic top-level mcp.AddTool. The generic form requires a typed In struct that conflicts with our dynamic, daemon-fetched schemas. Server.AddTool accepts InputSchema as json.RawMessage (opaque pass-through) and gives us direct control over the tool-level error envelope shape."
  - "Atomic Task 2 commit: spike removal + main.go RegisterSpike→Register switch shipped together (advisor recommendation). Avoids a build-broken commit boundary where Task 2 deletes spike.go before Task 3 updates main.go."
  - "Tool-level errors (IsError=true CallToolResult) instead of Go protocol-level errors. The handler returns nil for the error parameter and instead embeds the daemon error in CallToolResult.Content with IsError=true. Matches Node shim's tool-error semantics; protocol-level errors would surface as JSON-RPC error envelopes which have different semantics in claude-side error rendering."
  - "Cmd/Env propagation in integration tests: each spawned binary gets its own Env including CLAWCODE_MANAGER_SOCK (per-test fake daemon) + CLAWCODE_AGENT=test-agent. Allows running multiple tests in parallel without socket-path collisions."
  - "Test 5 (no spike artifacts) filters comment-only references. Active-code spike usage = regression; doc-string mentions of the historical spike are acceptable. Without this filter, the test would force us to delete every reference to the prior phase from package docs, which destroys context for future contributors."
metrics:
  duration: "~30 minutes"
  completed: "2026-05-06"
  tasks: 3
  files_created: 5
  files_modified: 2
  files_deleted: 2
  tests_added: 16
  commits: 3
  binary_size_bytes: 5693624
  binary_size_ceiling_bytes: 12582912
requirements: [0B-RT-01, 0B-RT-04, 0B-RT-05, 0B-RT-06]
---

# Phase 110 Plan 04: MCP Shim Runtime Swap — Wave 2 Production Search Go Shim Summary

Wave 2 ships the production Go MCP shim for the search type. Three coupled tasks (interface-first ordering: IPC client → search Register → main wiring + integration) deliver a 5.4 MB linux/amd64 static binary that passes all 16 tests across two packages and is ready for Plan 110-05 to deploy to admin-clawdy. Image and browser remain stubs that exit `SHIM_EXIT_USAGE` with stderr messages naming the future plans (110-06, 110-07) — guarded by a regression-pinned integration test.

## What Shipped

| Commit    | Task | What                                                                              |
| --------- | ---- | --------------------------------------------------------------------------------- |
| `18dc0f4` | 1    | feat(110-04): add daemon IPC client with 16 MB buffer + 6 framing tests           |
| `7591fab` | 2    | feat(110-04): production search Register + remove Wave 0 spike                    |
| `f3da4f1` | 3    | feat(110-04): integration tests for compiled binary — 5 contracts pinned          |

### IPC Client Signature

```go
// SocketPath honors CLAWCODE_MANAGER_SOCK env override; defaults to
// ~/.clawcode/manager/manager.sock.
func SocketPath() (string, error)

// SendRequest dials the daemon, writes one JSON-RPC request, reads
// exactly one response, and closes the connection. Fail-loud on any
// network or daemon-level error.
func SendRequest(method string, params map[string]interface{}) (json.RawMessage, error)
```

### Search Register Signature

```go
// Register fetches search tool schemas at boot via list-mcp-tools and
// adds each tool to the server with a fail-loud tools/call handler.
// Returns error if CLAWCODE_AGENT unset or daemon unreachable.
func Register(server *mcp.Server) error
```

### Exit-Code Matrix

| Exit | Constant              | Trigger                                                                  |
| ---- | --------------------- | ------------------------------------------------------------------------ |
| 0    | `SHIM_EXIT_OK`        | Clean stdin EOF (normal shutdown)                                        |
| 64   | `SHIM_EXIT_USAGE`     | Missing/empty `--type`; unknown type; image/browser stubs (Wave 3/4)     |
| 75   | `SHIM_EXIT_TEMPFAIL`  | search.Register failed (daemon unreachable, CLAWCODE_AGENT unset, etc.) |
| 75   | `SHIM_EXIT_TEMPFAIL`  | server.Run returned error after boot                                     |
| 75   | `SHIM_EXIT_TEMPFAIL`  | Deferred panic recovery (unexpected runtime panic)                       |

Three call sites for `os.Exit(SHIM_EXIT_TEMPFAIL)` — each maps to a distinct failure mode and all preserve SDK respawn semantics (Pitfall §5).

## Pitfall Mitigation Evidence

| Pitfall | Mitigation                                                                                              | Verified by                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| §1 Protocol version drift | `mcp.NewServer` from official Go SDK v1.5.0 (2025-11-25 spec)                              | `TestProtocolVersionPin` (now living implicitly inside the integration suite via initialize handshake)        |
| §2 64 KB buffer truncation | `scanner.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)` in `internal/shim/ipc/client.go`  | `TestSendRequestLargePayload` — 4 MB base64 round-trip succeeds without `bufio.Scanner: token too long`       |
| §3 Connection pooling     | `defer conn.Close()` after every `SendRequest`; no `sync.Pool`; no module-level conn vars              | `TestSendRequestOneRequestPerConnection` — fake daemon counts 2 distinct accepts after 2 SendRequest calls    |
| §4 Schema drift           | Boot-time `list-mcp-tools` IPC fetch; Zod single-sourced in TypeScript                                  | `TestRegisterFetchesToolsAtBoot` — server emits exactly the daemon-served tool names                          |
| §5 Exit-code semantics    | Phase 108 constants (0/64/75); deferred panic→exit-75; server.Run failure→exit-75                       | `TestIntegrationDaemonSocketGoneExitsTempfail` (exit=75); `TestIntegrationCleanStdinEOFExitsZero` (exit=0)    |
| §6 stdout poisoning       | `slog.NewJSONHandler(os.Stderr, ...)`; zero `fmt.Println` / `os.Stdout.Write` in cmd/ + internal/shim/  | Source-grep tests in both `register_test.go` and the existing Wave 0 source-grep pattern (still passes)      |

## Test Results

```
$ go test ./...
?   	github.com/jjagpal/clawcode-shim/cmd/clawcode-mcp-shim	[no test files]
ok  	github.com/jjagpal/clawcode-shim/internal/shim/ipc	0.105s
ok  	github.com/jjagpal/clawcode-shim/internal/shim/search	0.405s
```

**16 tests pass:**

| Package | Test | Verifies |
| --- | --- | --- |
| ipc | `TestSendRequestSingleRoundTrip` | Wire format byte-exact match to TypeScript |
| ipc | `TestSendRequestLargePayload` | 4 MB payload through 16 MB buffer (Pitfall §2 regression) |
| ipc | `TestSendRequestServerClosesEarly` | Early-close → clear error, no hang |
| ipc | `TestSendRequestErrorEnvelope` | JSON-RPC error envelope embeds code+message |
| ipc | `TestSendRequestOneRequestPerConnection` | 2 SendRequest → 2 distinct accepts (Pitfall §3) |
| ipc | `TestSocketPathEnvOverride` | CLAWCODE_MANAGER_SOCK override + default path shape |
| search | `TestRegisterFetchesToolsAtBoot` | list-mcp-tools fetch + 2 tools registered |
| search | `TestRegisterHandlerDispatchesSearchToolCall` | tools/call → search-tool-call params byte-exact |
| search | `TestRegisterHandlerPropagatesDaemonError` | Daemon error → IsError=true, callCount==1 (no retry) |
| search | `TestRegisterRequiresClawcodeAgent` | Unset env → clear error |
| search | `TestRegisterSourceContainsNoFallbackOrRetry` | Source-grep: no search-mcp / MaxRetries / etc. |
| search | `TestIntegrationSearchDispatchesToProductionRegister` | Binary tools/list emits daemon-served names |
| search | `TestIntegrationImageBrowserStubsExitUsage/image` | exit 64 + stderr "110-06" + "not yet implemented" |
| search | `TestIntegrationImageBrowserStubsExitUsage/browser` | exit 64 + stderr "110-07" + "not yet implemented" |
| search | `TestIntegrationDaemonSocketGoneExitsTempfail` | Boot-time IPC failure → exit 75 |
| search | `TestIntegrationCleanStdinEOFExitsZero` | Clean stdin EOF → exit 0 |
| search | `TestIntegrationNoSpikeArtifactsInSource` | No active-code spike references after cutover |

## Binary Size Measurement

| Artifact                                        | Size (bytes) | Size (MB) | Ceiling     |
| ----------------------------------------------- | ------------ | --------- | ----------- |
| Linux/amd64 with `-ldflags="-s -w"`             | 5,693,624    | 5.43      | 12 MB       |

**Headroom:** ~6.6 MB (54% under ceiling). Wave 3 and Wave 4 will add image and browser Register implementations; expected total binary growth is well under the headroom budget.

## Acceptance Criteria Self-Check

### Task 1 — IPC client
- ✅ `internal/shim/ipc/client.go` exists
- ✅ `scanner.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)` literal present
- ✅ `defer conn.Close()` present (one-request-per-connection enforced)
- ✅ `net.Dial("unix", ...)` present
- ✅ `CLAWCODE_MANAGER_SOCK` env override present
- ✅ Default path `.clawcode/manager/manager.sock` present
- ✅ No `fmt.Println` / `os.Stdout.Write` in `internal/shim/ipc/`
- ✅ No `sync.Pool` / `connPool` / module-level `conn[A-Z]` (no pooling)
- ✅ All 6 tests pass
- ✅ `go.sum` has `github.com/google/uuid` entries

### Task 2 — Search Register
- ✅ `internal/shim/search/register.go` exists
- ✅ `internal/shim/search/spike.go` deleted
- ✅ `CLAWCODE_AGENT` referenced in register.go
- ✅ `"list-mcp-tools"` referenced
- ✅ `"search-tool-call"` referenced
- ✅ `"shimType": "search"` present
- ✅ No `fmt.Println` / `os.Stdout.Write` in `internal/shim/search/`
- ✅ No `search-mcp` / `node-shim` / `fallback.*node` references
- ✅ No `retry` / `attempts:` / `MaxRetries` / `exponentialBackoff` references
- ✅ All 5 tests pass

### Task 3 — main.go integration
- ✅ `search.Register(server)` wired (production, not RegisterSpike)
- ✅ No active-code spike artifacts (RegisterSpike, 0.1.0-spike) in cmd/ or internal/shim/
- ✅ `SHIM_EXIT_TEMPFAIL = 75` constant present
- ✅ `os.Exit(SHIM_EXIT_TEMPFAIL)` appears 3 times (panic recovery + Register failure + server.Run error)
- ✅ `os.Exit(SHIM_EXIT_OK)` present (clean EOF path)
- ✅ `recover()` deferred in main()
- ✅ `case "image":` present
- ✅ `case "browser":` present
- ✅ Plan refs `110-06` and `110-07` appear 5 times in main.go (multiple references each)
- ✅ No stdout writes in cmd/clawcode-mcp-shim/
- ✅ Binary builds (CGO_ENABLED=0 GOOS=linux GOARCH=amd64)
- ✅ All 5 integration tests pass
- ✅ Binary size 5,693,624 bytes ≤ 12,582,912 (54% under ceiling)

## Deviations from Plan

### Rule 1 — Bug fix: SDK API signature mismatch with plan's example code

**Found during:** Task 2 implementation against `modelcontextprotocol/go-sdk@v1.5.0`.

**Issue:** Plan task 2 action block specified:
```go
mcp.AddTool(server, &mcp.Tool{...}, func(ctx, req, args) (*CallToolResult, json.RawMessage, error) { ... })
```

The top-level `mcp.AddTool[In, Out any]` is a **typed generic** that requires a struct/map In type and forces tools to conform to the MCP spec via automatic schema validation. With our dynamic, daemon-fetched JSON-Schema InputSchema, the generic form is wrong: the In type cannot be inferred from a `json.RawMessage` schema.

**Fix:** Use `Server.AddTool(t *Tool, h ToolHandler)` (lower-level) — accepts `InputSchema any` (we pass `json.RawMessage`) and `ToolHandler = func(ctx, *CallToolRequest) (*CallToolResult, error)`. Inside the handler, decode `req.Params.Arguments` (which is `json.RawMessage` per `CallToolParamsRaw`) into our own `map[string]interface{}`.

**Files modified:** `internal/shim/search/register.go` (uses `server.AddTool` not `mcp.AddTool`)
**Commit:** `7591fab`

### Rule 1 — Bug fix: Tool-level errors instead of protocol-level

**Found during:** Task 2 test design.

**Issue:** Plan implied IPC errors should bubble up as Go errors from the handler (`return nil, nil, ipcErr`). With the lower-level `ToolHandler`, returning a non-nil error makes the SDK report a JSON-RPC protocol-level error to the client. The Node shim's existing behavior is **tool-level errors** (CallToolResult.IsError=true with the error in TextContent) so the byte-exact compatibility goal requires matching that shape.

**Fix:** `makeHandler` always returns `(*CallToolResult, nil)`. On IPC error, builds `CallToolResult{IsError: true, Content: [TextContent{Text: "daemon error: ..."}]}`. Test 3 (`TestRegisterHandlerPropagatesDaemonError`) explicitly asserts the handler returns no Go error AND `res.IsError == true`.

**Files modified:** `internal/shim/search/register.go` (handler always returns nil error; embeds error in CallToolResult)
**Commit:** `7591fab`

### Rule 3 — Better solution: Atomic Task 2 commit (advisor recommendation)

**Found during:** advisor() consultation before substantive work.

**Issue:** Plan task 2 says "delete spike.go". Plan task 3 says "swap RegisterSpike → Register in main.go". Doing them in separate commits would leave Task 2's commit unbuildable (main.go references the just-deleted RegisterSpike).

**Fix:** Task 2 commit bundles spike.go deletion AND the main.go RegisterSpike→Register switch + image/browser stubs. Task 3 commit then layers integration tests on top of an already-green main.go. Build is green at every commit boundary.

**Files modified:** `cmd/clawcode-mcp-shim/main.go` moved from Task 3 to Task 2 commit
**Commit:** `7591fab`

### Rule 1 — Bug fix: Test 5 (source grep) over-matched comments

**Found during:** Task 3 first test run — TestIntegrationNoSpikeArtifactsInSource failed.

**Issue:** First implementation of the source-grep test failed because:
- The test file itself contains the literal patterns "RegisterSpike" / "0.1.0-spike" (necessary to grep for them).
- `register.go`'s package documentation comment legitimately mentions "Wave 0 spike (RegisterSpike, deleted in plan 110-04 Task 2)" — historical reference, not active code.

**Fix:** Filter grep output to skip lines inside `integration_test.go` and lines that are pure Go comments (start with `//` or `*`). Active code references are the regression we care about; doc-string history is fine.

**Files modified:** `internal/shim/search/integration_test.go`
**Commit:** `f3da4f1`

## Self-Check: PASSED

| Item | Status |
| --- | --- |
| `internal/shim/ipc/client.go` | FOUND |
| `internal/shim/ipc/client_test.go` | FOUND |
| `internal/shim/search/register.go` | FOUND |
| `internal/shim/search/register_test.go` | FOUND |
| `internal/shim/search/integration_test.go` | FOUND |
| `cmd/clawcode-mcp-shim/main.go` (modified) | FOUND |
| `internal/shim/search/spike.go` | DELETED (correct) |
| `internal/shim/search/main_test.go` | DELETED (correct) |
| Commit `18dc0f4` (Task 1 — IPC client) | FOUND |
| Commit `7591fab` (Task 2 — Register + main.go switch + spike removal) | FOUND |
| Commit `f3da4f1` (Task 3 — integration tests) | FOUND |
| `go test ./...` exits 0 | VERIFIED |
| Binary builds (CGO_ENABLED=0 linux/amd64) | VERIFIED |
| Binary size ≤ 12 MB | VERIFIED (5.43 MB) |

## Output Hand-Off to Plan 110-05

Plan 110-05 (Wave 3 — admin-clawdy canary deploy) consumes this artifact:

- **Binary path on build:** `./cmd/clawcode-mcp-shim` (build with `CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o clawcode-mcp-shim ./cmd/clawcode-mcp-shim`)
- **Install path on clawdy:** `/opt/clawcode/bin/clawcode-mcp-shim` (replaces the Wave 0 spike at the same path)
- **Invocation contract:** `/opt/clawcode/bin/clawcode-mcp-shim --type search` with stdin connected to claude proc, env vars `CLAWCODE_AGENT=<agent-name>` and `CLAWCODE_MANAGER_SOCK` (optional override; defaults to `~/.clawcode/manager/manager.sock`)
- **Failure modes for the operator runbook:**
  - Exit 64 → operator misconfiguration (missing --type, unknown type, missing CLAWCODE_AGENT). Investigate before retry.
  - Exit 75 → daemon-side issue or boot-time list-mcp-tools failure. SDK respawns automatically on next tool need; investigate if persistent.
  - Exit 0 → clean shutdown (claude proc closed stdin). Normal end-of-session behavior.
