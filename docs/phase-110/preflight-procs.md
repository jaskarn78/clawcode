# Phase 110 Preflight — Search/Image/Browser Proc Classification

**Sampled**: 2026-05-03, clawdy host, 7 running agents (Admin Clawdy,
fin-acquisition, fin-research, research, projects, finmentum-content-creator,
personal). Method: walk `/proc` for any pid whose cmdline matches
`search-mcp|image-mcp|browser-mcp|brave_search|fal_ai`, classify by argv0,
attribute to parent claude proc.

## Aggregate

| Process type | Lang | Count | Avg RSS | Total RSS | Per-agent? |
|---|---|---|---|---|---|
| `clawcode search-mcp` | node | 7 | 147 MB | **1.0 GiB** | yes (1:1) |
| `clawcode image-mcp` | node | 7 | 146 MB | **1.0 GiB** | yes (1:1) |
| `clawcode browser-mcp` | node | 7 | 147 MB | **1.0 GiB** | yes (1:1) |
| `brave_search.py` | python | 7 | 57 MB | 399 MB | yes (1:1) |
| `fal_ai.py` | python | 7 | 20 MB | 146 MB | yes (1:1) |
| **Total** | — | 35 | — | **~3.6 GiB** | |

## Discrepancy resolution

The original ultraplan cited "17 search procs / 9 image procs at 7 running
agents" and posited two hypotheses: per-call worker fanout, or 999.14
reaper-pending orphans.

**Neither holds today.** Live count is 7 of each — exact 1:1 with running
agents. No fanout, no orphans. Most likely the original numbers were stale
pre-Phase-109 data; the 109-B orphan-claude reaper plus the 109 deploy
restart cleaned the prior backlog. Confirmed via parent-pid walk: every
shim's PPID is a registered claude proc (no PPID=1 or PPID=daemon orphans).

## The scope inversion

The interrupted plan's architecture section started with:

> If the daemon-internal search/image shims show real RAM (more than ~30MB
> each) we open a separate phase to trim them — likely not via Phase 108
> broker but via shim-process consolidation. Out of scope here.

Empirically, **the shims are ~147 MB each, not ~30 MB.** They are the
single largest in-scope cost:

- **3.0 GiB** sits in `clawcode <type>-mcp` Node shims (search + image + browser)
- **0.5 GiB** sits in the externals (brave_search.py + fal_ai.py)

So the priority must invert. Brokering the Python externals (Phase-108-style)
saves at most ~480 MB at full fleet. **Consolidating the Node shims saves
~3 GiB** — six to nine times more, depending on whether browser is in scope.

## Why the shims are heavy

Each `clawcode <type>-mcp` is a full Node process loading the daemon's
bundled CLI (`/usr/bin/clawcode`, ~2.16 MB ESM + dependency graph).
Shim source: `src/cli/commands/{search,image,browser}-mcp.ts` →
`src/{search,image,browser}/mcp-server.ts` → IPC to daemon-singleton
backend (BraveClient, ExaClient, image providers, BrowserManager).

The shim does *no* heavy work. It's a JSON-RPC stdin/stdout pipe to a unix
socket. The 147 MB is base Node + the bundled CLI loader, not actual
shim logic. That cost is paid 7 times today (21 procs total) and would
be paid 11 times at full fleet — **~3.2 GiB at full fleet across the three
types**, for translation work that the daemon already does once.

## Implications for Phase 110 scope

1. **Stage 0 (NEW, biggest win)**: shim consolidation. Replace per-agent
   `clawcode <type>-mcp` shims with one shared node process per type
   (or eliminate the shim layer entirely — agents could JSON-RPC the
   daemon socket directly via a much smaller shim, e.g. a static binary
   or a python-based translator). Three shim types in scope; browser-mcp
   *shim* is in scope here even though *browser session state* (RED tier)
   is not — the shim is just IPC translation.
2. **Stage 1 (Phase-108 broker, smaller win)**: brave_search +
   fal_ai externals. Pure Python, no per-agent state, ~480 MB at full
   fleet. Still worth doing but lower priority.
3. **Stage 2**: any green-tier servers identified later
   (finnhub, finmentum-content, finmentum-db read paths) — not currently
   running on the host, classify when they appear.

## Open questions for next plan iteration

- Can the shims be replaced with a static binary (Go/Rust) doing
  JSON-RPC stdin → unix socket? Closest analog: `mcp-broker-shim`
  itself is currently node, but it could be replaced by a tiny static
  binary; same logic applies.
- Is the per-agent shim required by the Claude Agent SDK MCP contract,
  or can one shim serve multiple claude procs? The MCP transport is
  per-process stdin/stdout, so we need one shim *process* per claude
  *process* — but the shim can be much smaller than 147 MB.
- Replacing the node shim with a sub-10 MB process gets us to ~70 MB
  total across all agents+types, vs today's ~3 GiB. Worth a dedicated
  prototype before the broker work.

## Caller-of-record

Origin: Phase 110 ultraplan investigation 2026-05-03, after partial-plan
interruption identified the daemon-internal-vs-external server confusion.
Operator: Jas. This report unblocks the next ultraplan iteration with
corrected scope.
