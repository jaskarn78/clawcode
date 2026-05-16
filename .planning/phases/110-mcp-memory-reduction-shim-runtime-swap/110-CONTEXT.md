# Phase 110 Stage 0b: MCP shim runtime swap — Context

**Gathered:** 2026-05-05
**Status:** Ready for planning
**Source:** `/gsd:list-phase-assumptions 110` (operator confirmed all six defaults 2026-05-05)

<domain>
## Phase Boundary

This is **Phase 110 Stage 0b** — the structural shim runtime swap that follows the Stage 0a foundational scaffolding (SHIPPED 2026-05-03, commit `5aa5ab6`, PR #6).

**Stage 0b delivers:** Replacement of three Node-based MCP shim processes (`clawcode search-mcp`, `clawcode image-mcp`, `clawcode browser-mcp`) — each ~147 MB RSS — with sub-10 MB Go static binaries. Target: ~3 GiB RSS savings at full 11-agent fleet (~96% reduction on this surface).

**Out of scope (deferred to future stages):**
- Stage 0c — `mcp-broker-shim` (Phase 108 1Password broker shim) migration
- Stage 1a — broker generalization for `brave_search.py` + `fal_ai.py` Python externals (~480 MB savings, smaller win)
- Browser session state (Playwright/Chrome lifecycle) — RED tier, untouched
- Schema codegen / build-time type sharing between TS and Go (operator decision: fetch-at-boot pattern instead)

</domain>

<decisions>
## Implementation Decisions

### Runtime Choice (LOCKED)
- **Primary runtime:** Go static binary using official `modelcontextprotocol/go-sdk` v1.5.0 (Google-maintained, stable since 2026-04-07)
- **Fallback runtime:** Python translator via FastMCP — schema-flippable, not abandon-and-restart
- **Schema enum widens to:** `["node", "static", "python"]` in `src/config/schema.ts` (Stage 0a left this as a TODO at lines 1629-1630)
- **Eliminated candidates:** Bun-compile (51-91 MB binary, maintainers admit "way too big"), Rust (no official MCP SDK), dumb-pipe (daemon speaks ClawCode IPC, not MCP)

### Distribution & CI (LOCKED)
- **Single binary** named `clawcode-mcp-shim` accepting `--type search|image|browser` (not three separate binaries)
- **Bundled in npm package** via prebuild-install pattern (matches `better-sqlite3` precedent on this stack)
- **CI: GitHub Actions matrix** — cross-compile linux-x64 (and arm64 if needed), use `actions/setup-go@v5` with cache
- **Schema source-of-truth:** Zod schemas in TypeScript remain canonical. Shim fetches tool schemas at boot via new `list-mcp-tools` daemon IPC method. NO codegen of types into Go at build time.

### IPC Framing (LOCKED — reverse-engineered from `src/ipc/client.ts:34-46`)
- Newline-delimited JSON-RPC 2.0
- One request per connection
- `socket.destroy()` after first newline received
- Go side MUST use `bufio.Scanner` with **explicit 16 MB buffer** (default 64 KB will truncate screenshot base64 payloads ~1 MB)

### Rollout Policy (LOCKED — operator decisions 2026-05-05)
| Decision | Choice |
|---|---|
| **Wave 0 kill-switch threshold** | RSS > 15 MB → pivot to Python before any structural work commits |
| **Wave 0 spike target agent** | admin-clawdy (low-traffic test, not fin-acquisition) |
| **Rollout gate duration between waves** | 24-48h dashboard watch between per-shim-type flips |
| **Crash-fallback policy** | Fail loud, NO auto-fall-back to Node. Surface segfaults; do not silently degrade. |
| **Per-shim-type rollout order** | search → image → browser (lowest blast radius first) |
| **mcp-broker-shim inclusion** | NO — defer to Stage 0c. Stay tight on 3 translator shims. |

### Sequencing Constraint (LOCKED — research finding)
- **Daemon-side `list-mcp-tools` IPC method MUST ship in its own task BEFORE any Go shim builds against it.** The shim fetches tool schemas at boot to keep Zod single-sourced. This creates a hard prerequisite ordering:
  - Wave 0: Spike measurement (kill-switch gate)
  - Wave 1: Daemon-side `list-mcp-tools` IPC + schema enum widening + CI Go pipeline
  - Wave 2-4: Per-shim-type migrations (search → image → browser), each gated by 24-48h watch
  - Wave 5: Cleanup of dead Node shim code paths

### Hot-Reload Behavior (LOCKED — research finding)
- Per-shim-type runtime selector is `defaults.shimRuntime.<type>` (search/image/browser)
- Hot-reloadable via the ConfigWatcher pattern from commit `98ff1bc`
- Mid-flight runtime flip semantics:
  - Existing shim children of currently-running agents drain naturally (do NOT churn)
  - New shim spawns use the new runtime
  - Per-child runtime tag in the tracker so observability can distinguish

### Claude's Discretion
The following implementation details are NOT pre-decided and the planner can choose:
- Exact Go module path naming (e.g., `internal/shim/search` vs `cmd/search-shim`)
- Logger implementation choice in Go (stdlib `log/slog` is the natural default)
- Test framework choice in Go (stdlib `testing` is the natural default; `testify` only if assertions get unwieldy)
- Specific test fixtures for protocol-version negotiation regression
- npm postinstall script implementation details for the prebuild-install pattern
- Spike binary's exact tool surface (research suggests "search type only, no real protocol work" — planner refines)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 110 source-of-truth
- `.planning/phases/110-mcp-memory-reduction-shim-runtime-swap/110-RESEARCH.md` — Comprehensive research with runtime decision matrix, MCP SDK landscape, IPC framing reverse-engineering, common pitfalls
- `docs/phase-110/preflight-procs.md` — Empirical RSS measurements (147 MB per Node shim, 7-agent baseline), scope inversion findings
- `docs/phase-110/ultraplan-prompt.md` — Original ultraplan with asks A/B/C, deliverables list

### Stage 0a foundation (already shipped)
- `src/config/schema.ts` — Look for `defaults.shimRuntime` and `defaults.brokers` schemas. Lines 1629-1630 contain the TODO note about widening the enum.
- `src/dashboard/types.ts` — `McpRuntime` classification ("node" | "static" | "python" | "external")
- `src/manager/fleet-stats.ts` — Per-shim-type RSS observability emitting today

### Existing shims (to be replaced)
- `src/cli/commands/search-mcp.ts` — Current Node search shim entry
- `src/cli/commands/image-mcp.ts` — Current Node image shim entry
- `src/cli/commands/browser-mcp.ts` — Current Node browser shim entry
- `src/search/mcp-server.ts` — Inner translator (search)
- `src/image/mcp-server.ts` — Inner translator (image)
- `src/browser/mcp-server.ts` — Inner translator (browser)
- `src/cli/commands/mcp-broker-shim.ts` — Phase 108 1Password broker shim (out-of-scope analog; reference for `--type` dispatch pattern)

### Daemon IPC contract
- `src/ipc/client.ts:34-46` — Newline-delimited JSON-RPC framing definition (canonical wire format)
- `src/ipc/protocol.ts` — IPC method registry (new `list-mcp-tools` method registers here)

### Project stack constraints
- `CLAUDE.md` — TypeScript + Node 22 LTS stack; no new npm deps without justification; Go toolchain is a net-new addition gated on this phase's success

### Recent precedents to follow
- Commit `98ff1bc` (PR #8) — ConfigWatcher hot-reload pattern (reaper newConfig pass-through)
- Phase 108 broker (`src/mcp/broker/`) — `--type` CLI dispatch precedent
- Stage 0a (commit `5aa5ab6`, PR #6) — Schema additions + observability without behavior change

</canonical_refs>

<specifics>
## Specific Ideas

### Wave 0 spike-and-kill-switch task scope
- Build minimal Go shim (search type only, no real protocol work — initialize handshake + tools/list passthrough only)
- Single binary, statically linked
- Deploy to **admin-clawdy** (low-traffic test agent)
- Measure actual RSS via `/proc/<pid>/status` (specifically `VmRSS:` line)
- **Pass criterion:** RSS ≤ 15 MB
- **Fail criterion:** RSS > 15 MB → STOP. Pivot to Python before any Wave 1 structural work commits.

### Daemon `list-mcp-tools` IPC method shape (Wave 1)
- Method name: `list-mcp-tools`
- Request: `{ shimType: "search" | "image" | "browser" }`
- Response: `{ tools: ToolSchema[] }` where ToolSchema mirrors MCP `tools/list` response shape
- Source-of-truth: existing TypeScript Zod schemas in `src/{search,image,browser}/mcp-server.ts`
- Adapter logic: serialize Zod schemas to JSON Schema for cross-language consumption (Zod has `zod-to-json-schema` package; verify it's already in deps before adding)

### Per-shim-type rollout per wave
- Wave 2 (search): flip `defaults.shimRuntime.search: "static"` for admin-clawdy first, observe 24-48h, then fleet
- Wave 3 (image): same pattern, gated on Wave 2 success + green dashboard for full gate window
- Wave 4 (browser): same pattern, gated on Wave 3 success
- Each per-agent flip MUST be hot-reload-driven (no daemon restart) per Phase 999.27 lessons

### Test plan must cover
- MCP `initialize` handshake (protocol version negotiation pinned via regression test)
- Request id rewriting round-trip (claude local id ↔ daemon-namespaced id)
- Shim crash mid-flight (claude proc surfaces error, no hang)
- Hot-reload runtime flip (existing shims drain, new shims use new runtime)
- 11-agent concurrent hammer (no FD leaks in Go, no race in alternate runtime)
- 16 MB buffer size validates against real screenshot base64 payloads (~1 MB observed)
- stderr handling — Go shim's stderr does NOT confuse claude proc

</specifics>

<deferred>
## Deferred Ideas

- **Stage 0c — `mcp-broker-shim` migration to Go.** Likely reuses the same Go binary with a fourth `--type` value. Defer until Stage 0b proves the runtime swap pattern works for translator shims.
- **Stage 1a — broker generalization for Python externals.** Phase 108-style broker for `brave_search.py` + `fal_ai.py`. Independent surface; can ship in parallel with Stage 0c.
- **arm64 Go cross-compile.** Stage 0b ships linux-x64 only (clawdy host architecture). arm64 added when needed (e.g., if a future agent host runs on ARM).
- **Build-time codegen of Go types from Zod.** Operator chose fetch-at-boot pattern. Codegen revisited only if fetch-at-boot causes operational pain.
- **Auto-fall-back to Node on Go shim crash.** Operator chose fail-loud. Auto-fallback revisited only if a real-world incident proves fail-loud is too noisy.
- **Distribution as separate GitHub release artifact.** Operator chose npm bundle. Separate release revisited only if npm package size becomes a download concern.

</deferred>

---

*Phase: 110-mcp-memory-reduction-shim-runtime-swap*
*Context gathered: 2026-05-05 via `/gsd:list-phase-assumptions` confirmation pass*
