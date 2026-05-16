# Phase 110 Stage 0b: MCP Shim Runtime Swap — Research

**Researched:** 2026-05-05
**Domain:** MCP stdio translator runtime selection (replace ~147 MB Node shims with sub-10 MB equivalents)
**Confidence:** HIGH on runtime choice; HIGH on protocol surface; MEDIUM on rollout sequencing
**Stage 0a status:** SHIPPED 2026-05-03 (commit `5aa5ab6`, PR #6) — schema dial + observability landed, accepts only `"node"` today

## Summary

The Stage 0a scaffolding already names the answer in code. The `McpRuntime` type at `src/manager/fleet-stats.ts:54` enumerates exactly four values: `"node" | "static" | "python" | "external"`. The schema enums at `src/config/schema.ts:1634-1640` are pinned at `["node"]` today and explicitly comment that Stage 0b widens them to `["node","static","python"]`. The choice has been pre-narrowed to **Go static binary** vs **Python translator** vs leaving Node — and the empirical evidence on the host plus public benchmarks make this lopsided.

**Primary recommendation:** Replace the three Node shims (`search-mcp`, `image-mcp`, `browser-mcp`) with a **single Go static binary** built against the official `modelcontextprotocol/go-sdk` (v1.5.0+, Google-maintained). Dispatch by argv0 or `--type` flag (`clawcode-mcp-shim --type search|image|browser`). Expected RSS: **~3-7 MB per shim** vs today's 147 MB — savings of ~140 MB × 3 types × 11 agents = **~4.6 GiB at full fleet**, exceeding the ~3 GiB target.

⚠️ **The ~3-7 MB RSS figure is extrapolated from public Go HTTP-server benchmarks (Datadog, Povilas Versockas) — not measured on this host.** This is THE hypothesis the entire phase rests on. **Wave 0 MUST begin with a "spike" task: build the simplest possible Go shim (`mcp.NewServer` + a single passthrough tool), deploy to clawdy, measure live RSS via `/proc/<pid>/status`. If the measured RSS exceeds 15 MB the phase pivots to the Python alternative (see below) before any structural work commits.** This kill-switch decision point is the FIRST item in the Wave 0 task list.

**Schema enum widening — match Stage 0a's documented intent:** Stage 0a's code comment (`src/config/schema.ts:1629-1630`) names the post-widen enum as `["node","static","python"]`. This research recommends widening to **all three values** as documented, even though the primary implementation targets `"static"` only. Reason: keeps the operator-side flag-flip surface aligned with the foundational scaffolding's stated plan, allows `"python"` as a runtime-flippable alternative if a per-shim-type bug appears mid-rollout, and avoids a second schema migration if the Wave 0 spike forces the Python pivot.

**Alternative track if the Wave 0 spike rejects Go:** A **Python translator using FastMCP** (`PrefectHQ/fastmcp`, ~70% market share among Python MCP servers). Empirical RSS on this host: 20-57 MB (`brave_search.py`/`fal_ai.py` already running). Less win (~5x reduction vs ~30x for Go), but still beats Node. Python is already in the toolchain, so the build-cost delta is small. This is a runtime-flippable alternative once the schema enum is widened to include `"python"` — operators can flip per shim type without redeploy if Go misbehaves on a specific type.

**Eliminated candidates:**

- **Bun-compile (E)** — Standalone binaries are 51-91 MB on disk for a hello world (bundles full Bun runtime + JavaScriptCore). Acknowledged as "way too big" by Bun maintainers (issue #14546). Fails the sub-10 MB target before measuring RSS.
- **Rust static binary (B)** — No official MCP SDK at github.com/modelcontextprotocol. Community SDKs only. Steeper learning curve than Go for marginal RSS difference (~3-7 MB Rust vs ~3-7 MB Go). No reason to pay the toolchain tax.
- **Dumb-pipe / eliminated shim (D)** — Closer inspection shows the daemon socket speaks **ClawCode IPC, not MCP** (methods like `search-tool-call`, `browser-tool-call`). The shim does protocol-level work: MCP `initialize` handshake, `tools/list` registration with Zod-derived schemas, `tools/call` translation into `sendIpcRequest(SOCKET_PATH, "<type>-tool-call", {agent, toolName, args})`. The mcp-broker-shim byte-pipe pattern works ONLY because the broker socket *itself* speaks MCP (proxying to a real `1password-mcp` child). Replicating that here would require re-architecting the daemon to expose an MCP-native socket — a much larger phase. Out of scope.
- **Native MCP-SDK runtime swap to Anthropic-shipped binary (F)** — No such thing exists. Anthropic ships SDKs (TypeScript, Python, Go, C#, Java, Ruby, Kotlin, Swift), not pre-compiled translator binaries. `modelcontextprotocol/go-sdk` is a library, not a runnable.

## User Constraints (from constraints prompt)

### Locked Decisions

- **Three shim types in scope:** `clawcode search-mcp`, `clawcode image-mcp`, `clawcode browser-mcp`. All are JSON-RPC translators today.
- **Browser-mcp shim IS in scope** (translator process). Browser SESSION STATE (Playwright/Chrome) stays per-agent in the daemon, RED tier, untouched.
- **MCP transport contract is per-process stdin/stdout.** One shim PROCESS per claude PROCESS. Cannot pool across claude procs (this is what eliminated the Phase 108 broker pattern from this surface).
- **Cannot break the existing Node path.** Per-shim-type feature flag `defaults.shimRuntime.<type>`. New runtime must coexist with Node fallback. Hot-reload must work without daemon restart.
- **Stack is TypeScript + Node 22 LTS** per CLAUDE.md. Adding Go is a real toolchain cost, weighed and accepted in this research.
- **Stage 0a foundation is FROZEN:** `defaults.shimRuntime.{search,image,browser}` (single-value enum `["node"]`) and `defaults.brokers` schema map are landed. Stage 0b widens enum and lands the alternate-runtime spawn path.
- **Empirical baseline:** ~147 MB per Node shim × 3 types × 7 agents = ~3.0 GiB today; ~4.8 GiB projected at 11-agent fleet.

### Claude's Discretion

- Choice of runtime (Go/Python/Bun/Rust/dumb-pipe) — research recommendation drives this.
- Single binary with `--type` dispatch vs three separate binaries — research recommends single.
- Build/CI strategy (matrix cross-compile vs single linux/amd64).
- Where the binary lives at runtime (bundled in clawcode npm package vs separate package vs system path).
- How tool schemas are sourced in the new runtime (duplicated, generated from Zod, fetched at boot).
- Rollout sequencing (`search` first / `image` first / all-at-once behind shared flag).

### Deferred Ideas (OUT OF SCOPE)

- **Stage 1a broker generalization** for `brave_search.py` + `fal_ai.py` Python externals (~480 MB at full fleet — separate phase, lower priority).
- **`mcp-broker-shim` (Phase 108 1Password) runtime decision.** Its requirements are different (it's a dumb byte-pipe). Same Go binary *could* serve it later as a separate flag, but flagged as Open Question, not a Stage 0b deliverable.
- Browser session state (Playwright/Chrome lifecycle) — RED tier, untouched.
- Stage 2 green-tier servers (finnhub, finmentum-content, finmentum-db) — not running on host today.

## Project Constraints (from CLAUDE.md)

| Constraint | Implication for Stage 0b |
|------------|--------------------------|
| Stack: TypeScript + Node 22 LTS | New Go toolchain is a deviation; justify by ~30x memory reduction operational priority |
| Zero new npm deps preferred | Go binary is NOT an npm dep — it's a sibling artifact distributed alongside `clawcode`. No new TypeScript libraries added. |
| Run through GSD workflow | This research is the GSD research artifact; planner consumes it next |
| Immutability, small files | Go server stays small (~150-300 LOC per type, single shared binary) |
| Always handle errors comprehensively | MCP error envelope handling is critical — see Pitfall 3 |
| Validate at system boundaries | Tool args validated by daemon (Zod schemas in `src/{search,image,browser}/tools.ts`); shim is a translator, not a validator |
| No hardcoded secrets | Shim reads `CLAWCODE_AGENT` from env; no secret material in shim |
| Operator constraint: no auto-deploy | Rollout via per-shim-type flag with manual flip; canary 1 agent for 48h |

## Phase Requirements

> `.planning/REQUIREMENTS.md` does not exist for this phase yet. Phase 110 Stage 0b requirement IDs will be authored by the planner. The functional surface this research covers:

| Pseudo-ID | Description | Research Support |
|-----------|-------------|------------------|
| 0B-RT-00 | **Wave 0 spike:** measured RSS of minimal Go shim on clawdy host before any structural work | Summary §kill-switch; Wave 0 Gaps lists this as FIRST gap |
| 0B-RT-01 | Shim alternate-runtime selection per type | Standard Stack §Core picks Go binary; Architecture Patterns §Pattern 1 shows dispatch |
| 0B-RT-02 | Widen `defaults.shimRuntime.<type>` enum from `["node"]` to `["node","static","python"]` | Schema change at `src/config/schema.ts:1634-1640`; matches the post-widen enum named in Stage 0a code comment at `src/config/schema.ts:1629-1630` |
| 0B-RT-03 | Loader auto-inject reads `defaults.shimRuntime.<type>` and rewrites `command`/`args` | `src/config/loader.ts:240-294` is the rewrite point — current `command: "clawcode"`, `args: ["search-mcp"]` becomes runtime-conditional |
| 0B-RT-04 | New runtime preserves MCP `initialize` handshake byte-exact | Common Pitfalls §Pitfall 1 |
| 0B-RT-05 | New runtime preserves `tools/list` schema parity | Common Pitfalls §Pitfall 4; Code Examples §Tool definition source-of-truth |
| 0B-RT-06 | New runtime translates `tools/call` to daemon IPC byte-exact | Code Examples §IPC framing |
| 0B-RT-07 | Per-shim-type rollout — search/image/browser independently flippable | Architecture Patterns §Pattern 3 |
| 0B-RT-08 | Hot-reload of `shimRuntime` without daemon restart | Already wired by Stage 0a + ConfigWatcher (`98ff1bc` pattern) |
| 0B-RT-09 | Static binary distribution alongside `clawcode` install | Architecture Patterns §Pattern 4 |
| 0B-RT-10 | Per-shim-type RSS observable in `/api/fleet-stats` | Already wired by Stage 0a (`fleet-stats.ts:153-184` aggByLabel) — verify Stage 0b binary surfaces `runtime: "static"` correctly |
| 0B-RT-11 | Rollback runbook: flip flag back to `"node"` triggers re-spawn under Node | Architecture Patterns §Pattern 5 |
| 0B-RT-12 | Memory-savings measurement plan | Standard Stack §Verification Targets |
| 0B-RT-13 | **Daemon-side `list-mcp-tools` IPC method** ships BEFORE Go shim builds against it | Pattern 1 §Sequencing note; Common Pitfalls §Pitfall 4 |

## Standard Stack

### Core

| Library / Tool | Version | Purpose | Why Standard |
|----------------|---------|---------|--------------|
| Go | 1.22+ | Compile target | Static binaries, no runtime dependencies, ~2-5 MB RSS for stdio servers (Datadog, Povilas Versockas Go memory benchmarks). Industry standard for sidecar processes at scale. **RSS hypothesis MUST be confirmed by Wave 0 spike — see Summary kill-switch.** |
| `github.com/modelcontextprotocol/go-sdk` | v1.5.0 (2026-04-07) | Official MCP server SDK | Anthropic + Google maintained. Supports MCP spec 2025-11-25. `mcp.NewServer()`, `mcp.AddTool()`, `mcp.StdioTransport{}` — minimal stdio server is ~25-30 lines. 1,040+ inbound dependents, score 92.77 in MCP framework index. Spec parity guarantees a community library can't make. |
| `encoding/json` (stdlib) | Go 1.22+ | JSON-RPC framing for daemon IPC | Newline-delimited JSON-RPC 2.0 over unix socket — `json.NewEncoder(socket).Encode(req)` + `bufio.Scanner(socket)` for response. Trivial. |
| `net` (stdlib) | Go 1.22+ | Unix socket dial to daemon | `net.Dial("unix", "/home/$USER/.clawcode/manager/manager.sock")`. One connection per IPC request matches existing `sendIpcRequest` semantics — see Pitfall 5. |
| GitHub Actions matrix build | — | CI cross-compile linux/amd64 + linux/arm64 | ~30 lines of YAML. `wangyoucao577/go-release-action@v1` is a viable shortcut. |

**Stage 0a artifacts already shipped that Stage 0b builds on:**

- `defaults.shimRuntime.{search,image,browser}` schema dial (currently `["node"]` only — Stage 0b widens to `["node","static","python"]` per the Stage 0a code comment naming the post-widen enum)
- `defaults.brokers` dispatch table (Stage 1a wires this; not relevant to Stage 0b)
- `McpRuntime` enum in `src/dashboard/types.ts:182` and `src/manager/fleet-stats.ts:54` already includes `"static"` and `"python"` cases
- `mcp-broker-shim --type` CLI alias (Stage 0a) — establishes the `--type` flag convention; Stage 0b shim binary follows this naming

### Supporting

| Library / Tool | Version | Purpose | When to Use |
|----------------|---------|---------|-------------|
| `golang.org/x/sys/unix` | latest | (Optional) socket peer credentials | Only if Stage 0b adds peer-uid checks — not required for parity with current shims |
| `log/slog` (stdlib) | Go 1.22+ | Structured stderr logging | Match the `serverType` log field convention from `mcp-broker-shim.ts:166` so journalctl greps work day one |
| `bufio.Scanner` (stdlib) | Go 1.22+ | Newline-delimited frame reader on daemon socket | Daemon writes `JSON.stringify(response) + "\n"` then closes — match this exactly |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Official `modelcontextprotocol/go-sdk` | `mark3labs/mcp-go` (community, more dependents) | Community SDK has 2.85x more dependents and 2.9-point score advantage in framework index. But official SDK has spec parity guarantees, Anthropic+Google staffing, OpenSSF scorecard. **Use official.** Inspires from mark3labs but cleanly designed; 23 releases since launch. |
| Go static binary | Python translator with FastMCP | Python on this host runs ~20-57 MB RSS (`brave_search.py`/`fal_ai.py` empirical), 3-10x worse than Go. Python is in the existing toolchain so build cost is nil — but the memory win is the entire point of this phase. **Documented as flippable alternative (enum includes `"python"`); becomes primary only if Wave 0 spike rejects Go.** |
| Go static binary | Rust static binary | Comparable RSS (~3-7 MB). No official Rust MCP SDK. Steeper learning curve. Operator and team Go familiarity > Rust. **Eliminated.** |
| Single Go binary `clawcode-mcp-shim --type X` | Three Go binaries (`clawcode-search-shim`, etc) | Single binary easier to ship, version, and rollback. `--type` dispatch matches the established `mcp-broker-shim --type` convention from Stage 0a. **Single binary.** |
| Embed/duplicate Zod tool schemas | Have shim fetch tool list from daemon at boot via new IPC method | Pitfall 4 explores this. Recommendation: **boot-time IPC fetch** keeps schemas single-sourced in TypeScript Zod definitions. Daemon adds new method `list-mcp-tools` returning the static `TOOL_DEFINITIONS` arrays converted to JSON Schema. Shim caches result for session lifetime. |

**Build/install commands (operator-side):**

```bash
# Build (CI):
cd shim/  # new Go module
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o clawcode-mcp-shim ./cmd/shim

# Install (deploy):
cp clawcode-mcp-shim /usr/local/bin/clawcode-mcp-shim
chmod +x /usr/local/bin/clawcode-mcp-shim
```

**Verification targets (Phase 110 success criteria):**

- Per-shim RSS: **<10 MB** (target ~3-7 MB for Go) — **MUST be measured in Wave 0 spike before any other Wave 0 work commits**
- Total fleet shim RSS at 11 agents × 3 types: **<330 MB** (today: ~4.8 GiB projected)
- Cgroup memory pressure at 11 agents: **<60% MemoryMax** (today: hits 97.8% at 7 agents)
- MCP `initialize` handshake byte-equivalent to Node shim (compare via mitm capture)
- All existing search/image/browser tool tests pass against the new shim

## Architecture Patterns

### Recommended Project Structure

```
shim/                                    # NEW — Go module sibling to TypeScript src/
├── cmd/
│   └── shim/
│       └── main.go                     # ~30 LOC — argv parse, dispatch by --type
├── internal/
│   ├── search/
│   │   ├── tools.go                    # tool defs (fetched from daemon at boot OR generated)
│   │   └── handler.go                  # tools/call → daemon IPC translation (~80 LOC)
│   ├── image/
│   │   ├── tools.go
│   │   └── handler.go                  # mirrors search
│   ├── browser/
│   │   ├── tools.go
│   │   └── handler.go                  # adds image-content envelope handling for screenshots
│   └── ipc/
│       ├── client.go                   # newline-delimited JSON-RPC over unix socket (~50 LOC)
│       └── socket.go                   # path resolution mirroring src/manager/daemon.ts
├── go.mod
├── go.sum
└── README.md                            # links back to .planning/phases/110-*

src/cli/commands/                        # EXISTING — Node shims kept indefinitely as fallback
├── search-mcp.ts                       # unchanged
├── image-mcp.ts                        # unchanged
└── browser-mcp.ts                      # unchanged

src/config/loader.ts                     # MODIFIED — read defaults.shimRuntime.<type>;
                                         #   if "static": command="/usr/local/bin/clawcode-mcp-shim",
                                         #               args=["--type","<type>"]
                                         #   if "python": command="python3",
                                         #               args=[FASTMCP_SHIM_PATH,"--type","<type>"]
                                         #   if "node":   keep existing command="clawcode",
                                         #               args=["<type>-mcp"]

src/manager/daemon.ts                    # MODIFIED — register new IPC method `list-mcp-tools`
                                         #   that returns TOOL_DEFINITIONS for the requested type
                                         #   converted to JSON Schema (zod-to-json-schema).
                                         #   MUST ship BEFORE Go shim builds against it.

.github/workflows/release-shim.yml       # NEW — matrix build + attach to release
```

### Pattern 1: Single binary, type dispatch via flag

Mirrors the established `mcp-broker-shim --type 1password` convention from Stage 0a (`src/cli/commands/mcp-broker-shim.ts:271-288`). One binary, one config dial, easier rollback.

**Sequencing constraint:** This shim depends on a new daemon IPC method `list-mcp-tools` (used by `Register()` to fetch tool schemas at boot — see Pitfall 4 and Code Examples). The daemon-side method MUST ship FIRST, in its own task, before any Go shim work depends on it. Order:
1. Daemon: add `list-mcp-tools` IPC method + handler + test (TypeScript-only change, deployable independently)
2. Daemon: deploy and verify the new method responds correctly via `clawcode` CLI exercise or curl-equivalent
3. Go shim: build cmd/shim, internal/{search,image,browser}, internal/ipc against the now-live daemon method
4. Loader auto-inject change + schema enum widening (after Go binary exists at the install path)

```go
// cmd/shim/main.go (verified pattern from modelcontextprotocol/go-sdk README)
package main

import (
    "context"
    "flag"
    "log"
    "github.com/modelcontextprotocol/go-sdk/mcp"
    "clawcode/shim/internal/search"
    "clawcode/shim/internal/image"
    "clawcode/shim/internal/browser"
)

func main() {
    serverType := flag.String("type", "", "search|image|browser (required)")
    flag.Parse()

    server := mcp.NewServer(
        &mcp.Implementation{Name: *serverType, Version: "0.1.0"},
        nil,
    )

    switch *serverType {
    case "search":
        search.Register(server)
    case "image":
        image.Register(server)
    case "browser":
        browser.Register(server)
    default:
        log.Fatalf("unknown --type: %q (want search|image|browser)", *serverType)
    }

    if err := server.Run(context.Background(), &mcp.StdioTransport{}); err != nil {
        log.Fatal(err)
    }
}
```

### Pattern 2: Daemon IPC client (newline-delimited JSON-RPC, one-request-per-conn)

**Source-of-truth for framing:** `src/ipc/client.ts:34` writes `JSON.stringify(request) + "\n"`, `src/ipc/client.ts:42-46` reads up to first `\n`, then `socket.destroy()`. This is the contract — Go side must match exactly.

```go
// internal/ipc/client.go
package ipc

import (
    "bufio"
    "encoding/json"
    "fmt"
    "net"
    "os"
    "path/filepath"
    "github.com/google/uuid"  // OR generate nanoid-style id; daemon accepts any string
)

type ipcRequest struct {
    Jsonrpc string                 `json:"jsonrpc"`
    ID      string                 `json:"id"`
    Method  string                 `json:"method"`
    Params  map[string]interface{} `json:"params"`
}

type ipcResponse struct {
    Jsonrpc string          `json:"jsonrpc"`
    ID      string          `json:"id"`
    Result  json.RawMessage `json:"result,omitempty"`
    Error   *ipcError       `json:"error,omitempty"`
}

type ipcError struct {
    Code    int             `json:"code"`
    Message string          `json:"message"`
    Data    json.RawMessage `json:"data,omitempty"`
}

func socketPath() string {
    home, _ := os.UserHomeDir()
    return filepath.Join(home, ".clawcode", "manager", "manager.sock")
}

func SendRequest(method string, params map[string]interface{}) (json.RawMessage, error) {
    conn, err := net.Dial("unix", socketPath())
    if err != nil {
        return nil, fmt.Errorf("dial daemon: %w", err)
    }
    defer conn.Close()

    req := ipcRequest{
        Jsonrpc: "2.0",
        ID:      uuid.NewString(),  // any unique string
        Method:  method,
        Params:  params,
    }
    if err := json.NewEncoder(conn).Encode(req); err != nil {
        return nil, fmt.Errorf("encode request: %w", err)
    }

    scanner := bufio.NewScanner(conn)
    // Match daemon's max-line size: search-mcp screenshot inline base64 may be ~1 MB
    scanner.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
    if !scanner.Scan() {
        return nil, fmt.Errorf("no response: %w", scanner.Err())
    }

    var resp ipcResponse
    if err := json.Unmarshal(scanner.Bytes(), &resp); err != nil {
        return nil, fmt.Errorf("decode response: %w", err)
    }
    if resp.Error != nil {
        return nil, fmt.Errorf("daemon error %d: %s", resp.Error.Code, resp.Error.Message)
    }
    return resp.Result, nil
}
```

**Critical:** the daemon closes the socket after one response. Go side MUST `defer conn.Close()` and dial a fresh connection per `tools/call`. This matches the existing TypeScript `sendIpcRequest` behavior — DO NOT pool connections.

### Pattern 3: Loader auto-inject — runtime-conditional command/args

The decision point is `src/config/loader.ts:248-294` (current Node-shim auto-inject). Stage 0b modifies it:

```typescript
// src/config/loader.ts (modified, Stage 0b)
const browserEnabled = defaults.browser?.enabled !== false;
if (browserEnabled && !resolvedMcpMap.has("browser")) {
  const runtime = defaults.shimRuntime?.browser ?? "node";
  let command: string;
  let args: string[];
  switch (runtime) {
    case "static":
      command = STATIC_SHIM_PATH;                            // "/usr/local/bin/clawcode-mcp-shim"
      args = ["--type", "browser"];
      break;
    case "python":
      command = "python3";
      args = [PYTHON_SHIM_PATH, "--type", "browser"];        // FastMCP-based fallback if it ships
      break;
    case "node":
    default:
      command = "clawcode";
      args = ["browser-mcp"];
  }
  resolvedMcpMap.set("browser", {
    name: "browser",
    command,
    args,
    env: { CLAWCODE_AGENT: agent.name },
    optional: false,
  });
}
// ...same for search, image
```

**Hot-reload:** ConfigWatcher already triggers loader re-run on yaml change (Stage 0a + commit `98ff1bc` pattern). On flag flip, daemon restarts the affected agent's MCP children — the SDK detects MCP child exit and respawns under the new command. No daemon restart needed.

### Pattern 4: Static binary distribution

**Two viable options:**

| Option | Pros | Cons |
|--------|------|------|
| **A. Bundled in clawcode npm package** under `bin/` | Single install path, version-locked | npm tarball bloats by ~5 MB × 2 archs (linux/amd64 + linux/arm64); cross-platform install logic needed (postinstall script picks arch) |
| **B. Separate GitHub release artifact, installed by deploy script** | Clean separation, smaller npm package | Two-artifact install — can drift if operator forgets the second step |

**Recommend A** for tight version coupling — postinstall script copies the right arch into `node_modules/.bin/clawcode-mcp-shim`. Mirrors the `better-sqlite3` prebuild-install pattern already in the stack.

### Pattern 5: Rollback (per-type flag flip)

Each shim type has its own dial:

```yaml
# clawcode.yaml
defaults:
  shimRuntime:
    search:  static    # FLIP TO "node" TO ROLLBACK SEARCH ONLY (or "python" if Go has bug)
    image:   node      # canary: image stays on Node until search proves stable
    browser: node
```

Rollback procedure:
1. Edit `clawcode.yaml`, change `search: static` → `search: node` (or `python`)
2. ConfigWatcher detects change, reloads daemon config (no restart)
3. Daemon-managed agent restart (or operator-driven `clawcode restart` per agent) cycles MCP children under the new command
4. `/api/fleet-stats` `runtime` field flips back to `"node"` (or `"python"`) for search shims
5. Hold image/browser on `static` (independent rollback granularity)

### Anti-Patterns to Avoid

- **Hand-rolling MCP `initialize` handshake instead of using the official Go SDK.** The protocol version negotiation (`protocolVersion: "2025-11-25"`), capability advertising, and serverInfo response have specific shape requirements that change across spec versions. The Go SDK handles version drift; hand-rolled code breaks silently. **Use `mcp.NewServer` + `server.Run(&mcp.StdioTransport{})`.**
- **Pooling daemon socket connections.** The daemon's `sendIpcRequest` model is one-request-per-connection. Multiplexing breaks framing assumptions on the daemon side.
- **Including the bundled clawcode CLI as a Go cgo library.** Tempting to "share code" — but cgo blows up RSS (issue #43160 in golang/go), defeats the static-binary win, and re-introduces the 147 MB cost.
- **Speaking MCP protocol version different from what TypeScript SDK speaks.** Pin Go SDK to a release that supports the same `protocolVersion` as `@modelcontextprotocol/sdk` ^1.x in this repo. Verify in CI.
- **Logging tool args at INFO.** Image generation prompts and search queries are sometimes secret-laden. Match the `mcp-broker-shim.ts:113-122` pino redaction posture using slog handlers — drop any field named `args`, `query`, `prompt` from default log levels.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MCP `initialize` handshake | Custom JSON-RPC parser for capabilities exchange | `mcp.NewServer()` from official Go SDK | Spec version negotiation drift; the SDK tracks 2025-11-25 spec and back-compat with prior versions |
| `tools/list` envelope shape | Hand-built `Tool[]` array marshaler | `mcp.AddTool(server, &mcp.Tool{...}, handler)` | SDK enforces correct schema shape; hand-built code drifts when Anthropic adds annotations like `outputSchema` |
| `tools/call` request id mapping | Manual id-rewriting | SDK's `server.Run` handles dispatch | The TypeScript shim doesn't even rewrite ids (it uses the `McpServer` SDK on the same process); Go SDK is symmetric |
| Newline-delimited JSON-RPC framing on daemon socket | Custom byte scanner | `bufio.Scanner` with explicit buffer size | One-line stdlib pattern; the only gotcha is buffer size for screenshot inline base64 — set `scanner.Buffer(_, 16*1024*1024)` |
| Tool input validation | Re-implement Zod schemas in Go | Trust daemon-side validation; OR generate JSON Schema from Zod and embed | Tool args are validated by daemon's pure handlers (`src/{search,image,browser}/tools.ts`); shim is a translator, not a validator. Shim only needs schemas for `tools/list` advertising. See Pitfall 4. |
| GitHub Actions cross-compile | Hand-write GOOS/GOARCH loops | `wangyoucao577/go-release-action@v1` | 30 lines of YAML, attaches binaries to release automatically |
| Process supervision / restart-on-crash | Build a wrapper script | Already handled by Claude Agent SDK — exits with non-zero, SDK respawns on next tool need (matches `mcp-broker-shim.ts` SHIM_EXIT_TEMPFAIL=75 pattern) | The shim is a one-shot per session; SDK handles lifecycle |

**Key insight:** This is a translator process. The daemon does the work. The shim's only job is `stdin (MCP) ↔ unix socket (ClawCode IPC)`. Anything beyond that, in any runtime, is over-engineering and a path back to 147 MB of accidental complexity.

## Runtime State Inventory

(Stage 0b is a runtime additive change, not a rename/refactor — but capturing checked categories explicitly per process discipline.)

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — shim is stateless, no persistent storage | None |
| Live service config | `clawcode.yaml` `defaults.shimRuntime.{search,image,browser}` (Stage 0a schema, currently `["node"]` only); SystemD unit `/etc/systemd/system/clawcode.service` (no shim-runtime references) | Widen schema enum to `["node","static","python"]` (matches Stage 0a code-comment intent); no SystemD edits |
| OS-registered state | None — shim binary lives at `/usr/local/bin/clawcode-mcp-shim`; not registered with init system, cron, or PATH-via-env | Deploy step copies binary to install path |
| Secrets/env vars | `CLAWCODE_AGENT` (env passthrough — not secret); no shim-side secret material | None — shim never sees op:// refs (those resolve daemon-side) |
| Build artifacts | NEW: `shim/` Go module compiled output. `node_modules/clawcode/bin/clawcode-mcp-shim-{linux-amd64,linux-arm64}` (if Pattern 4 option A) | Build pipeline produces; deploy script verifies binary exists pre-restart |

## Common Pitfalls

### Pitfall 1: MCP protocol version mismatch between Go SDK and Claude Code SDK

**What goes wrong:** Claude Code spawns the shim, sends `initialize` with `protocolVersion: "2025-11-25"`. If Go SDK responds with an older or newer version it doesn't support, Claude Code logs an obscure error and the agent's tools silently disappear.

**Why it happens:** Spec version drift. Anthropic publishes new MCP spec revisions; SDKs catch up at different rates.

**How to avoid:**
- Pin Go SDK to `v1.5.0` minimum (supports 2025-11-25 spec per official README, "Version 1.4.0+ supports the latest 2025-11-25 specification")
- Verify in CI: spawn shim, send mock `initialize` with the exact protocol version that `@modelcontextprotocol/sdk` ^1.x sends, assert response shape
- On Go SDK upgrade, regression-test against the canary agent before fleet rollout

**Warning signs:** Agent boots cleanly but `client/list_tools` returns empty. `journalctl` shows shim process started but no `tools/call` ever lands. Compare `initialize` capture from working Node shim vs new Go shim.

### Pitfall 2: Buffer-size limit on daemon socket scanner

**What goes wrong:** `browser-mcp` screenshot tool returns inline base64 PNG. A typical 1280×720 screenshot is ~200-800 KB base64. `bufio.Scanner` defaults to 64 KB max line size — silently truncates and corrupts the JSON.

**Why it happens:** Go's `bufio.Scanner` MaxScanTokenSize default is 64 KB. The daemon writes the entire response on a single newline-delimited line.

**How to avoid:** Always call `scanner.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)` immediately after constructing the scanner. 16 MB buffer covers any practical screenshot. Add a unit test that round-trips a 4 MB base64 payload through the IPC client.

**Warning signs:** `browser_screenshot` tool returns `Error: invalid character ',' looking for beginning of value` — the JSON was truncated mid-string.

### Pitfall 3: Connection-per-request mismatch with daemon

**What goes wrong:** Performance-minded engineer assumes one socket connection can serve many requests. Reuses the connection across multiple `tools/call`. First response arrives correctly; second hangs forever.

**Why it happens:** Daemon's `src/ipc/server.ts` (and the client at `src/ipc/client.ts:42-46`) closes the socket after sending one response. The protocol is one-shot per connection, not session-oriented.

**How to avoid:** `defer conn.Close()` after every `SendRequest` call. NEVER pool. Each shim handler dials fresh. Performance is fine (unix socket dial is ~10 µs).

**Warning signs:** Tools work for first call after agent boot, then hang on subsequent calls.

### Pitfall 4: Tool schema drift between TypeScript Zod and Go

**What goes wrong:** Search tool gains a new `safesearch: "strict" | "moderate" | "off"` parameter on the TypeScript side (in `src/search/tools.ts` Zod schema). Go shim's hardcoded schema doesn't include it. Claude can't see the parameter exists, never sends it, daemon either rejects or applies a default — divergent behavior between Node-shim and Go-shim agents.

**Why it happens:** Two sources of truth (TypeScript Zod + Go struct schema) drift independently. This is the recurring maintenance cost.

**How to avoid (recommended):** Daemon adds new IPC method `list-mcp-tools { type: "search" | "image" | "browser" }` returning the JSON Schema-converted `TOOL_DEFINITIONS` from `src/{search,image,browser}/tools.ts`. Go shim calls this at boot, caches the result for the session lifetime. Schemas stay single-sourced in TypeScript. Boot adds one IPC round-trip (~1 ms), negligible. **Sequencing: daemon-side `list-mcp-tools` ships in its own task BEFORE the Go shim builds against it — see Pattern 1 §Sequencing constraint.**

**How to avoid (alternative):** Generate JSON Schema from Zod at build time (use `zod-to-json-schema` package, already idiomatic), embed as `embed.go` resource. Less round-trip cost, but build pipeline gets a coupling step.

**Warning signs:** New parameter added to a tool ships to Node-shim agents but doesn't appear when Go-shim agents call `tools/list`. Operators see "tool X doesn't accept Y" only on a subset of agents.

### Pitfall 5: Exit code semantics — SDK respawn behavior

**What goes wrong:** Go shim hits an unrecoverable error (daemon socket gone). Exits with `os.Exit(1)`. Claude Code SDK interprets exit-1 as "MCP server failed permanently" — disables the tool for the session.

**Why it happens:** Phase 108's `mcp-broker-shim` uses exit-75 (`EX_TEMPFAIL`) specifically to signal "transient failure, please retry." Claude SDK respawns on next tool need. Other exit codes have different semantics.

**How to avoid:** Mirror `mcp-broker-shim.ts` exit codes:
- `0` (`SHIM_EXIT_OK`): clean stdin EOF, normal shutdown
- `64` (`SHIM_EXIT_USAGE`): missing required env / bad args
- `75` (`SHIM_EXIT_TEMPFAIL`): daemon socket gone; SDK should retry

In Go: `os.Exit(75)` for daemon-side failures, `os.Exit(0)` for clean stdin close.

**Verify in Wave 0 spike:** Claude Code SDK 0.2.97 (per CLAUDE.md, pre-1.0, version-pinned EXACT) is the SDK in use today. Phase 108's broker-shim works in production with exit-75, so this is empirically correct — but the SDK is pre-1.0 and unannounced behavior could shift. Confirm respawn behavior in the Wave 0 spike against the live SDK version before depending on it.

**Warning signs:** Tool stops working after first daemon restart, doesn't recover until agent fully restarts.

### Pitfall 6: stderr noise breaking MCP framing

**What goes wrong:** Go shim writes diagnostic output to stdout (e.g., `fmt.Println("starting shim...")`). Claude Code parses stdout as MCP JSON-RPC. The diagnostic line poisons the framing.

**Why it happens:** Go's default `log` package writes to stderr (correct), but `fmt.Println` writes to stdout (wrong for stdio MCP servers).

**How to avoid:**
- Use `log/slog` with `slog.NewJSONHandler(os.Stderr, ...)` — never write to stdout from shim code
- Code review: zero `fmt.Println` / `os.Stdout.Write` calls in shim source (the SDK owns stdout)
- Lint rule: `forbidigo` to ban stdout writes outside the MCP SDK

**Warning signs:** Claude logs "Failed to parse MCP message" with garbled JSON immediately on shim startup.

## Code Examples

### Tool definition source-of-truth (TypeScript, current — DO NOT duplicate in Go)

```typescript
// src/search/tools.ts (existing, ~lines 1-30 — pseudocode-summarized)
export const TOOL_DEFINITIONS: ReadonlyArray<{
  name: "web_search" | "web_fetch_url";
  description: string;
  schemaBuilder: (z: typeof import("zod/v4")) => Record<string, unknown>;
}> = [
  {
    name: "web_search",
    description: "Search the web via Brave / Exa.",
    schemaBuilder: (z) => ({
      query: z.string(),
      count: z.number().int().min(1).max(20).optional(),
      // ... future fields drift here, NOT in Go
    }),
  },
  // ...
] as const;
```

### Recommended: Go shim fetches tool list at boot

```go
// internal/search/register.go
package search

import (
    "context"
    "encoding/json"
    "github.com/modelcontextprotocol/go-sdk/mcp"
    "clawcode/shim/internal/ipc"
)

type toolDef struct {
    Name        string          `json:"name"`
    Description string          `json:"description"`
    InputSchema json.RawMessage `json:"inputSchema"`  // JSON Schema, opaque to Go
}

func Register(server *mcp.Server) error {
    // Boot-time IPC fetch — schemas single-sourced in TypeScript
    raw, err := ipc.SendRequest("list-mcp-tools", map[string]interface{}{
        "type": "search",
    })
    if err != nil {
        return err
    }
    var tools []toolDef
    if err := json.Unmarshal(raw, &tools); err != nil {
        return err
    }

    for _, td := range tools {
        td := td  // capture
        mcp.AddTool(
            server,
            &mcp.Tool{
                Name:        td.Name,
                Description: td.Description,
                InputSchema: td.InputSchema,  // pass JSON Schema through opaque
            },
            func(ctx context.Context, req *mcp.CallToolRequest, args map[string]any) (*mcp.CallToolResult, json.RawMessage, error) {
                // Forward to daemon via existing search-tool-call IPC
                agent := agentFromEnv()
                params := map[string]interface{}{
                    "agent":    agent,
                    "toolName": td.Name,
                    "args":     args,
                }
                result, err := ipc.SendRequest("search-tool-call", params)
                if err != nil {
                    return nil, nil, err
                }
                return &mcp.CallToolResult{
                    Content: []mcp.Content{
                        mcp.TextContent{Text: string(result)},
                    },
                }, nil, nil
            },
        )
    }
    return nil
}
```

### IPC framing — TypeScript side (existing reference)

Source: `src/ipc/client.ts:34` and `:42-46` — newline-delimited, one request per connection, `socket.destroy()` after first newline. Go side must match exactly (see Pattern 2).

### GitHub Actions matrix build (~30 lines)

```yaml
# .github/workflows/release-shim.yml
name: Release Go Shim
on:
  release:
    types: [created]
jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        goarch: [amd64, arm64]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'
      - name: Build
        env:
          GOOS: linux
          GOARCH: ${{ matrix.goarch }}
          CGO_ENABLED: 0
        working-directory: shim
        run: |
          go build -ldflags="-s -w" -o ../clawcode-mcp-shim-linux-${{ matrix.goarch }} ./cmd/shim
      - name: Upload to release
        uses: softprops/action-gh-release@v1
        with:
          files: clawcode-mcp-shim-linux-${{ matrix.goarch }}
```

### Stage 0a precedent — `--type` flag and serverType log convention

Source: `src/cli/commands/mcp-broker-shim.ts:271-288` — Go shim's `--type` flag follows this exact pattern. Source: `mcp-broker-shim.ts:160-166` — Go shim logs `slog.Info("...", "serverType", *serverType, ...)` so journalctl greps work day one.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hand-rolled MCP JSON-RPC in Go (early 2025) | Official `modelcontextprotocol/go-sdk` v1+ | Released early 2026, v1.5.0 by 2026-04-07 | Spec parity guarantees, version negotiation handled, OSSF-scored |
| `mark3labs/mcp-go` (community, dominant 2024-2025) | Official Go SDK + mark3labs as alternative | Official launched early 2026 | Most ecosystem still on mark3labs (4x more dependents), but new projects should default to official |
| Bun-compile as "free" alternative for TypeScript projects | Bun-compile remains 50-90 MB binaries | Acknowledged limitation in Bun issue #14546 (still open 2026) | Eliminated as Stage 0b candidate |
| sqlite-vss for vector search (project-adjacent context) | sqlite-vec | 2024 deprecation | Not relevant to Stage 0b but illustrates the SOTA-flux pattern in this stack |

**Deprecated/outdated:**

- Hand-rolling MCP server protocol — official SDKs make this obsolete in any supported language
- Bun-compile as a sub-10 MB option — abandoned for this use case
- @xenova/transformers (note from CLAUDE.md, unrelated to 110 but illustrates "verify package names" discipline)

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Go toolchain | Stage 0b build (CI only — not on clawdy host) | TBD on CI | 1.22+ | None at runtime; binary ships pre-built |
| Pre-built `clawcode-mcp-shim` linux/amd64 | clawdy production host | Will exist post-build | TBD | Per-type flag flips back to `"node"` shim (always present) |
| Pre-built `clawcode-mcp-shim` linux/arm64 | (Future Mac mini / cloud arm hosts) | Optional for Stage 0b | TBD | Linux/amd64 only is acceptable for Stage 0b — clawdy is x86_64 |
| Existing Node shim (`clawcode {search,image,browser}-mcp`) | Fallback runtime | ✓ (currently running on host) | Bundled in clawcode pkg | n/a — this IS the fallback |
| `journalctl` access | Diagnostic log inspection | ✓ | systemd 250+ | n/a |
| ConfigWatcher hot-reload (Stage 0a + commit `98ff1bc`) | Shim runtime flag flip without daemon restart | ✓ | Already shipped | Daemon restart is the manual fallback |

**Missing dependencies with no fallback:** None — the Node shim path remains the fallback at runtime; Go is a build-time dep only.

**Missing dependencies with fallback:** None blocking — arm64 binary is post-Stage-0b nice-to-have.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| TypeScript tests | Vitest (existing — `src/**/*.test.ts`) |
| Go tests | `go test ./...` (NEW — covers shim/) |
| Quick run command | `npm test` (TS side) + `cd shim && go test ./...` (Go side) |
| Full suite command | `npm test && cd shim && go test ./...` |
| Integration test command | `tsx scripts/integration/shim-roundtrip.ts` (NEW — spawns Go shim, sends initialize + tools/list + tools/call, asserts byte-equivalence with Node shim output) |

### Phase Requirements → Test Map

| Pseudo-Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---------------|----------|-----------|-------------------|-------------|
| 0B-RT-00 | **Wave 0 spike: minimal Go shim measured RSS <15 MB on clawdy** | manual / journaled | `scripts/integration/measure-spike-rss.sh` | ❌ Wave 0 (FIRST GAP) |
| 0B-RT-01 | `--type search\|image\|browser` dispatch | unit (Go) | `cd shim && go test ./cmd/shim/...` | ❌ Wave 0 |
| 0B-RT-02 | Schema enum widened to `["node","static","python"]` | unit (TS) | `npx vitest run src/config/__tests__/schema.test.ts` | partially (Stage 0a tests exist; Wave 0 adds widen-cases) |
| 0B-RT-03 | Loader auto-inject reads `defaults.shimRuntime` | unit (TS) | `npx vitest run src/config/__tests__/loader.test.ts` | partially |
| 0B-RT-04 | MCP `initialize` byte-equivalent Node↔Go | integration (Node spawn + capture) | `tsx scripts/integration/shim-initialize.ts` | ❌ Wave 0 |
| 0B-RT-05 | `tools/list` schemas match daemon source-of-truth | integration | `tsx scripts/integration/shim-tools-list.ts` | ❌ Wave 0 |
| 0B-RT-06 | `tools/call` translates to daemon IPC byte-exact | integration | `tsx scripts/integration/shim-tools-call.ts` | ❌ Wave 0 |
| 0B-RT-07 | Per-type flag independence | unit (TS) | `npx vitest run src/config/__tests__/shim-runtime.test.ts` | ❌ Wave 0 |
| 0B-RT-08 | Hot-reload of shimRuntime without daemon restart | integration (manual sample) | `scripts/integration/shim-hot-reload.sh` | ❌ Wave 0 |
| 0B-RT-09 | Static binary present at install path | smoke | `test -x /usr/local/bin/clawcode-mcp-shim` | ❌ Wave 0 |
| 0B-RT-10 | `/api/fleet-stats` reports `runtime: "static"` | integration | `curl localhost:.../api/fleet-stats \| jq` | unit-test scaffolding from Stage 0a exists |
| 0B-RT-11 | Rollback flip works | integration (manual canary) | `scripts/integration/shim-rollback.sh` | ❌ Wave 0 |
| 0B-RT-12 | Memory measurement: full-fleet per-shim RSS <10 MB after rollout | manual / journaled | `scripts/integration/measure-shim-rss.sh` | ❌ Wave 0 |
| 0B-RT-13 | Daemon-side `list-mcp-tools` IPC method | unit (TS) + integration | `npx vitest run src/manager/__tests__/list-mcp-tools.test.ts` | ❌ Wave 0 (ships FIRST in plan ordering) |

### Sampling Rate

- **Per task commit:** `cd shim && go test ./...` (Go side only — fast, ~2s)
- **Per wave merge:** `npm test && cd shim && go test ./...` + `tsx scripts/integration/shim-roundtrip.ts`
- **Phase gate:** Full suite green + 48-hour canary on `search` shim alone before flipping `image`/`browser`

### Wave 0 Gaps

**FIRST — kill-switch task (must complete before any other Wave 0 work commits):**

- [ ] **`scripts/integration/measure-spike-rss.sh` + minimal Go spike** — build the simplest possible `cmd/shim/main.go` (`mcp.NewServer` + one passthrough tool, no IPC client, no daemon dependency), deploy to clawdy, run as a `clawcode browser-mcp`-equivalent under one canary agent for 30 minutes, sample RSS via `/proc/<pid>/status`. **Acceptance: measured RSS <15 MB**. If the figure exceeds 15 MB, the phase pivots to the Python alternative track and the rest of Wave 0 stays unbuilt until the planner re-scopes.

**Sequenced after the kill-switch passes:**

- [ ] Daemon-side `list-mcp-tools` IPC method + handler (in `src/manager/daemon.ts`) + tests — **must ship BEFORE Go shim builds against it**
- [ ] `shim/` Go module scaffold (go.mod, cmd/shim/main.go, internal/{search,image,browser,ipc}/)
- [ ] `shim/cmd/shim/main_test.go` — argv dispatch test
- [ ] `shim/internal/ipc/client_test.go` — newline-delimited framing test, including 4 MB payload buffer test
- [ ] `scripts/integration/shim-initialize.ts` — spawns shim, sends MCP initialize, compares to Node shim
- [ ] `scripts/integration/shim-tools-list.ts` — tools/list byte-equivalence check
- [ ] `scripts/integration/shim-tools-call.ts` — tools/call → daemon IPC capture & assert
- [ ] `scripts/integration/measure-shim-rss.sh` — sample full-fleet RSS via /proc, assert <10 MB
- [ ] `src/config/__tests__/shim-runtime.test.ts` — schema enum widen tests + per-type flag isolation
- [ ] Update `src/config/__tests__/loader.test.ts` — runtime-conditional command/args branches
- [ ] `.github/workflows/release-shim.yml` — Go matrix build
- [ ] Postinstall script (or deploy script) that places binary at `/usr/local/bin/clawcode-mcp-shim`
- [ ] Schema enum widening: `defaults.shimRuntime.<type>` from `["node"]` → `["node","static","python"]` (last so the dial only opens once Go binary is real on the host)

## Open Questions

1. **Should `mcp-broker-shim` (Phase 108 1Password) share the Go runtime?**
   - What we know: It's a dumb byte-pipe (different requirements from translator shims). Currently Node, ~140 MB RSS. Same Go binary could host it as `--type 1password-broker` mode.
   - What's unclear: Whether the broker socket-credential handshake (token-hash, agent identity) ports cleanly to Go without re-implementing Phase 108's redaction posture.
   - Recommendation: Defer to a follow-up phase (Stage 0c). Stage 0b focuses on the three protocol-translator shims where the savings are clearest.

2. **Single binary vs three binaries — version coupling implications?**
   - What we know: Single binary with `--type` matches Stage 0a precedent (`mcp-broker-shim --type`). One artifact to ship, version, and rollback.
   - What's unclear: If one shim type's bug forces a hold on Stage 0b deploy, the other two are blocked too. With three binaries, search bug doesn't block image/browser.
   - Recommendation: Single binary. Per-type flag still gives independent rollout. Bug fixes ship via binary version bump; flag flips control which binary version each type uses (introduce binary-path-per-type config if this becomes a real problem).

3. **Tool schema fetch-at-boot vs build-time generation?**
   - What we know: Fetch-at-boot keeps Zod single-sourced; adds 1 IPC round-trip per shim startup (~1ms, negligible). Build-time codegen avoids round-trip but couples the build pipeline.
   - What's unclear: Operator preference. Fetch-at-boot creates a startup-time ordering: daemon must be up before shim can register tools. Today's daemon-up assumption holds (loader auto-inject runs after daemon boot), but worth verifying.
   - Recommendation: Fetch-at-boot. Daemon-up assumption is already in place. Single source of truth wins.

4. **Distribution: bundled in npm pkg vs separate GitHub release?**
   - What we know: Bundled-in-npm (Pattern 4 option A) is the better-sqlite3 pattern this stack already uses. Separate-release is cleaner separation but two-artifact install.
   - What's unclear: Tarball bloat. ~5 MB binary × 2 archs = ~10 MB extra in npm package. Acceptable for an internal tool but check if external consumers (clawcode CLI is shippable) care.
   - Recommendation: Bundle in npm. Postinstall picks arch.

5. **Should Stage 0b include the symmetrical change to `mcp-broker-shim` even though it's "deferred"?**
   - What we know: Constraint says broker-shim is symmetric to consider. Empirical: broker-shim is also Node, also pays the 147 MB cost (1Password broker process at ~10 procs/agent).
   - What's unclear: Whether the operator wants Stage 0b to scope-creep to include broker-shim (4 shim types instead of 3), or stay tight.
   - Recommendation: Stay tight. Stage 0b = three translator shims. Broker-shim = follow-up Stage 0c using same Go binary. Lower blast radius.

6. **Does Claude Code SDK 0.2.97 actually treat exit-75 as retry-eligible?**
   - What we know: Phase 108's `mcp-broker-shim` works in production with `SHIM_EXIT_TEMPFAIL=75`, and the SDK respawns the shim on next tool need. So this is empirically correct on the version in use.
   - What's unclear: The SDK is pinned to EXACT 0.2.97 (per CLAUDE.md, pre-1.0 churn risk). A hypothetical SDK upgrade could change exit-code interpretation.
   - Recommendation: Confirm in Wave 0 spike against the live SDK version. Add a regression test that asserts the SDK respawns the Go shim after a deliberate exit-75. Block any future SDK upgrade on this test passing.

## Sources

### Primary (HIGH confidence)

- [Model Context Protocol Go SDK (github.com/modelcontextprotocol/go-sdk)](https://github.com/modelcontextprotocol/go-sdk) — Official SDK v1.5.0, Google collaboration, supports MCP spec 2025-11-25
- [Model Context Protocol Python SDK (github.com/modelcontextprotocol/python-sdk)](https://github.com/modelcontextprotocol/python-sdk) — Official Python SDK v1.x stable
- [Model Context Protocol SDKs index (modelcontextprotocol.io/docs/sdk)](https://modelcontextprotocol.io/docs/sdk) — Confirms which languages have official SDKs (TS, Python, Go, C#, Java, Ruby, Kotlin, Swift). NO Rust SDK.
- `src/ipc/client.ts:34` (in this repo) — JSON-RPC framing source-of-truth: `JSON.stringify(request) + "\n"` then read until first `\n`, then `socket.destroy()`. One request per connection.
- `src/cli/commands/mcp-broker-shim.ts:271-321` — Stage 0a precedent for `--type` flag, exit-75 (`SHIM_EXIT_TEMPFAIL`) semantics, serverType log field.
- `src/manager/fleet-stats.ts:54` — `McpRuntime` enum: `"node" | "static" | "python" | "external"` already includes the Stage 0b targets.
- `src/config/schema.ts:1634-1640` — Stage 0a `defaults.shimRuntime` schema dial (single-value `["node"]` enum, comments name Stage 0b widening as `["node","static","python"]`).
- `src/config/loader.ts:248-294` — Loader auto-inject decision point (current `command: "clawcode", args: ["{search,image,browser}-mcp"]`).
- `docs/phase-110/preflight-procs.md` (this repo, 2026-05-03) — Empirical RSS measurements: Node shims ~147 MB each, Python `brave_search.py`/`fal_ai.py` 20-57 MB.

### Secondary (MEDIUM confidence)

- [Bun standalone executable docs (bun.com/docs/bundler/executables)](https://bun.com/docs/bundler/executables) — Official Bun docs admit binary size is "way too big"
- [Bun issue #14546: minimal runtime for binary executables (github.com/oven-sh/bun/issues/14546)](https://github.com/oven-sh/bun/issues/14546) — Open issue acknowledging 50-90 MB hello-world binaries
- [seanmcp.com Go vs JS executables comparison](https://www.seanmcp.com/articles/quick-comparison-of-javascript-and-go-executables/) — Go binary size benchmarks
- [Datadog Go memory metrics blog (datadoghq.com/blog/go-memory-metrics/)](https://www.datadoghq.com/blog/go-memory-metrics/) — Go RSS measurement methodology
- [Povilas Versockas Go memory management (povilasv.me/go-memory-management/)](https://povilasv.me/go-memory-management/) — Hello HTTP server measured at 5.11 MB RSS
- [AgentRank MCP Server Framework Comparison 2026 (agentrank-ai.com/blog/mcp-server-framework-comparison)](https://agentrank-ai.com/blog/mcp-server-framework-comparison/) — `mark3labs/mcp-go` vs official Go SDK adoption metrics
- [Tech-Insider FastMCP guide 2026 (tech-insider.org/mcp-server-tutorial-python-fastmcp-claude-2026)](https://tech-insider.org/mcp-server-tutorial-python-fastmcp-claude-2026/) — FastMCP at ~70% market share for Python MCP
- [wangyoucao577/go-release-action (github.com/wangyoucao577/go-release-action)](https://github.com/wangyoucao577/go-release-action) — Standard Go cross-compile + release GitHub Action

### Tertiary (LOW confidence — flagged for validation in Wave 0 spike)

- Specific RSS for Go MCP server with full SDK loaded (extrapolated from Go HTTP server 5 MB benchmark; **VALIDATE in Wave 0 by building cmd/shim and measuring RSS — this is the kill-switch task**).
- Whether postinstall script can reliably place binary at `/usr/local/bin/clawcode-mcp-shim` across all clawcode install paths (operator runs as a SystemD service; verify the unit's `User=` matches binary perms).
- Tool schema JSON Schema conversion fidelity — if Zod has features that don't round-trip cleanly (refinements, transforms, branded types), the fetch-at-boot pattern degrades. **Validate in Wave 0 by exporting current TOOL_DEFINITIONS to JSON Schema and diffing against handcrafted equivalent.**
- Claude Code SDK 0.2.97 exit-75 retry semantics — empirically working in Phase 108 production but not formally documented. **Validate in Wave 0 spike by deliberately exiting the Go shim with code 75 and asserting SDK respawn on next tool need.**

## Metadata

**Confidence breakdown:**

- Standard Stack: **HIGH** — Go SDK confirmed at v1.5.0 official, Bun eliminated by primary-source maintainer admission, Python eliminated as primary by empirical host measurement (20-57 MB RSS already observed). Go RSS hypothesis is extrapolated; Wave 0 spike validates it before phase commits.
- Architecture: **HIGH** — Loader/schema/fleet-stats wiring fully decoded from in-repo source; `--type` dispatch precedent set by Stage 0a; daemon IPC framing is unambiguous (newline-delimited, one-per-conn). Sequencing constraint (daemon `list-mcp-tools` ships first) is explicit.
- Pitfalls: **HIGH** — Pitfalls 1-6 each cite specific source files in this repo or established Go gotchas (bufio.Scanner default size, exit-code semantics matching Phase 108)
- Open Questions: **MEDIUM** — Q1 (broker-shim symmetry), Q5 (scope creep), and Q6 (SDK exit-code semantics) are operator-discretion or validation calls, not research gaps

**Research date:** 2026-05-05
**Valid until:** 2026-06-05 (30-day window — Go SDK is pre-1.5 stable but Anthropic ships fast; recheck spec version pins before Wave 0 implementation)
