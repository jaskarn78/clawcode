Re-plan Phase 110 with corrected scope after preflight investigation.

PREFLIGHT FINDINGS (docs/phase-110/preflight-procs.md, 2026-05-03):

The interrupted partial plan claimed daemon-internal search/image shims
are "~30 MB each, out of scope." Empirical measurement on clawdy host
(7 running agents) shows they are ~147 MB each. Live counts:

  clawcode search-mcp   (node shim)    7 × 147MB = 1.0 GiB
  clawcode image-mcp    (node shim)    7 × 146MB = 1.0 GiB
  clawcode browser-mcp  (node shim)    7 × 147MB = 1.0 GiB
  brave_search.py       (python ext.)  7 × 57MB  = 399 MB
  fal_ai.py             (python ext.)  7 × 20MB  = 146 MB
  TOTAL: 35 procs / ~3.6 GiB

The 17-search / 9-image proc-count discrepancy from the original ultraplan
RESOLVED: today the math is clean 1:1 (7 procs : 7 agents), no fanout,
no orphans. The earlier counts were pre-Phase-109 stale data; the orphan-
claude reaper (109-B) cleaned the backlog at deploy.

SCOPE INVERSION:

Stage 0 (NEW, biggest win): node-shim consolidation. The clawcode
<type>-mcp shims are pure IPC translators (src/cli/commands/{search,
image,browser}-mcp.ts → unix socket → daemon-singleton backend). Each
costs 147 MB because it loads the full bundled CLI for translation work
the daemon already does once. At full 11-agent fleet: ~3.2 GiB across
the three types. Replacing each shim with a static binary or sub-10 MB
process saves ~3 GiB.

Stage 1 (Phase-108 broker, smaller win): brave_search.py + fal_ai.py.
Pure Python externals, no per-agent state. ~480 MB savings at full fleet.

Stage 2: any future green-tier servers (finnhub, finmentum-content,
finmentum-db read paths) — not currently running, classify on appearance.

ASKS:

A. SHIM CONSOLIDATION DESIGN (Stage 0)
   - Can we replace the node shim with a Go/Rust static binary?
   - Or a python translator (~5 MB instead of 147 MB)?
   - Or eliminate the shim entirely — claude proc speaks JSON-RPC stdin
     and a tiny inline-spawned wrapper bridges to the unix socket?
   - The MCP transport requires per-claude-process stdin/stdout, so we
     can't share one shim across multiple claudes. But we CAN make the
     shim ~95% lighter.
   - Browser-mcp shim is in scope (it's just IPC translation); browser
     session state (Playwright/Chrome) stays per-agent (RED tier
     unchanged).

B. STAGE 1 BROKER CONTRACT V2 (unchanged from partial plan)
   - Generalize OnePasswordMcpBroker → multi-server typed pool
   - mcp-broker-shim --type <server-id>
   - brokers.<server-id>.{enabled,maxConcurrent,spawnArgs,env,drainOnIdle}
   - Hot-reloadable via ConfigReloader
   - Backwards-compat: --pool 1password remains as alias for --type 1password
   - Apply to brave_search and fal_ai

C. ROLLOUT ORDER
   - Stage 0 (shim consolidation) ships FIRST — biggest win, lowest risk
     (no shared state, just process-shape change)
   - Stage 1 (Phase-108-style broker for brave/fal) ships SECOND
   - Each stage independent feature flag, 48h dashboard gate before next

OBSERVABILITY (ship before structural changes):
  - per-shim-type RSS aggregate (so we measure Stage 0 savings)
  - per-server broker metrics (rps, queue depth, p50/p99) for Stage 1
  - claude:tracked drift (existing 109-D signal)

ROLLBACK:
  - Per-shim-type feature flag (defaults.shimRuntime.<type>: node|static)
  - Per-server broker enabled flag (existing Phase-108 pattern)
  - Each toggleable independently without daemon restart

DELIVERABLES:
  1. Stage 0 design doc — shim runtime alternatives benchmarked
     (node vs static binary vs python vs eliminated). Include actual
     RSS measurements, not estimates.
  2. Stage 1 broker-contract-v2 spec (yaml schema, IPC, observability).
  3. Observability spec landed BEFORE Stage 0.
  4. Test plan covering: shim crash mid-flight, hot-reload of shim
     runtime config, broker process killed mid-flight, 11-agent
     concurrent hammer.
  5. Rollback runbook with kill-switches per type.
  6. Memory-savings measurement plan: baseline ~3.6 GiB across these 5
     types today, target post-rollout TBD by Stage 0 design.

CALLER-OF-RECORD:
  Origin: Phase 110 ultraplan v1 (interrupted) + 2026-05-03 preflight
  Operator: Jas
  Predecessor: Phase 109 (deployed)
  Reference: docs/phase-110/preflight-procs.md
