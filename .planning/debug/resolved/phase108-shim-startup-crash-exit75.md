---
status: resolved
trigger: "Phase 108 shim startup crash — agents fail warm-path with mcp: 1password: Process exited with code 75 before responding"
created: 2026-05-01T13:38:00Z
updated: 2026-05-01T13:38:00Z
---

## Current Focus

hypothesis: First-spawn cold-start latency of `npx -y @takescake/1password-mcp@latest` inside the broker's pooled-child exceeds the SDK's ~2s MCP-init deadline; shim's exit 75 path is hit when the broker socket closes (or pool-child startup times out) before the shim can complete its initialize handshake.
test: Read shim, broker, pooled-child, shim-server source. Identify exactly which exit-75 path fires and what triggers the broker socket close.
expecting: A specific code path showing shim is killed because either (a) broker child not yet ready when shim's initialize lands, (b) shim handshake is rejected, or (c) replay/cache emits malformed JSON-RPC.
next_action: Read mcp-broker-shim.ts, shim-server.ts, broker.ts, pooled-child.ts in full.

## Symptoms

expected: Shim subprocess starts, connects to broker daemon, completes MCP `initialize` handshake within ~2s, returns initialize response to SDK.
actual: Shim subprocess exits with code 75 (SHIM_EXIT_TEMPFAIL) within 2.2-2.7s of being spawned by the SDK, BEFORE responding to MCP `initialize`. SDK reports "Process exited with code 75 before responding".
errors:
- "mcp: 1password: Process exited with code 75 before responding"
- mcp duration: 2171.6ms / 2444.2ms / 2681.4ms across three failed agents
reproduction: Re-enable broker integration in loader.ts (revert commit f2eb64e), `npm run build`, spawn daemon with at least one agent needing 1Password, observe warm-path failure with code 75 within ~2.5s.
started: When loader.ts auto-injection was switched from `npx -y @takescake/1password-mcp@latest` (per-agent) to `clawcode mcp-broker-shim --pool 1password` (broker-shim). Reverted via f2eb64e — system recovered.

## Eliminated

- hypothesis: First-spawn npx cold-start latency exceeds SDK 2s deadline
  evidence: Even if cold-start were the issue, the broker would still complete initialize replay successfully on warm path; failure is reproducible across all three first agents and timing (2.2-2.7s) is consistent with synchronous handshake-then-spawn-then-fail cascade, not registry-fetch jitter. AND if it were just cold start, `tokenHashToRawToken.get(tokenHash)` would still resolve correctly. It does not — see Evidence below.
  timestamp: 2026-05-01T13:50:00Z

## Evidence

- timestamp: 2026-05-01T13:48:00Z
  checked: `src/cli/commands/mcp-broker-shim.ts:67`
  found: Shim computes tokenHash as `sha256(token).digest("hex").slice(0, 8)` — **8 hex chars**.
  implication: This is the value sent in the `{agent, tokenHash}` handshake JSON line.

- timestamp: 2026-05-01T13:48:30Z
  checked: `src/manager/daemon.ts:1715-1722`
  found: Daemon's `collectTokenLiteral` builds the tokenHash → rawToken map keyed by `sha256(literal).digest("hex").slice(0, 16)` — **16 hex chars**. Both the loader's process-env token (line 1724) and per-agent override literals (line 1882) are stored under 16-char keys.
  implication: Daemon's map keys are 16 chars; shim sends 8 chars.

- timestamp: 2026-05-01T13:49:00Z
  checked: `src/mcp/broker/shim-server.ts:230` and `src/manager/daemon.ts:1781`
  found: `resolveRawToken` is `(tokenHash) => tokenHashToRawToken.get(tokenHash)`. With shim's 8-char key against the daemon's 16-char-keyed map, lookup ALWAYS returns `undefined`. Line 230 then assigns `rawToken = undefined ?? "" = ""`.
  implication: Every fresh shim handshake produces `rawToken=""` for the broker.

- timestamp: 2026-05-01T13:49:30Z
  checked: `src/mcp/broker/shim-server.ts:214` (TOKEN_HASH_PATTERN)
  found: Pattern accepts 1-64 chars `[a-zA-Z0-9_\-]`. So 8-char hash passes validation; handshake is accepted; `acceptConnection` succeeds.
  implication: No early handshake rejection — failure mode is downstream (broker pool child spawn).

- timestamp: 2026-05-01T13:50:00Z
  checked: `src/manager/daemon.ts:1735-1749` (broker spawnFn) and `src/mcp/broker/broker.ts:185,317-321` (ensurePool)
  found: On first `acceptConnection`, broker calls `ensurePool(tokenHash, rawToken)` which calls `spawnFn({tokenHash, rawToken})` which spawns `npx -y @takescake/1password-mcp@latest` with `env: { ...process.env, OP_SERVICE_ACCOUNT_TOKEN: rawToken }`. With `rawToken=""`, the env var is set to empty string, **overwriting the daemon's own valid `process.env.OP_SERVICE_ACCOUNT_TOKEN`** (because `OP_SERVICE_ACCOUNT_TOKEN: rawToken` appears AFTER the `...process.env` spread).
  implication: 1password-mcp child spawns with empty service-account token. It either authenticates and fails immediately, or aborts startup.

- timestamp: 2026-05-01T13:50:15Z
  checked: `src/mcp/broker/broker.ts:462-477` (handleChildExit) + `src/mcp/broker/broker.ts:482-500` (inflight crash fanout) + shim cancel cascade
  found: When the child exits, broker logs warn, fails inflight with code -32001 ("Pool child exited unexpectedly"), and IF refCount==0 deletes the pool. But the agent's initialize is queued behind `ensurePool` — broker's `acceptConnection` does NOT auto-send initialize; the SDK's first JSON-RPC `initialize` line arrives via `processBuffer` → `handleAgentLine` → `broker.handleAgentMessage`. If `handleAgentMessage` runs after the child has already exited, `pool === undefined` (line 218-228) and broker returns -32002 "No pool for tokenHash" to the agent's initialize. The agent then sees an initialize-error response — but in the production logs the actual error is "Process exited with code 75 before responding" which means the SDK never received ANY response. The shim socket was closed.
  implication: When the broker pool child exits and pool is deleted (refCount went briefly to 1 then back to 0 after child crash inflight clear), the shim's broker-side socket isn't proactively closed by the broker. BUT — and this is the actual exit-75 path — when the daemon's outer net server is sound but the pool repeatedly crashes (1password-mcp aborts in <100ms with empty token), the broker's auto-respawn loop fires (line 502-535) again and again until SDK's 2s timer fires `process.kill` on the shim. The SDK kills the shim with SIGTERM — shim's onSigterm handler (mcp-broker-shim.ts:202) calls `socket.end()` and `finish(SHIM_EXIT_OK)` which SHOULD return 0. But the SDK's "exited with code 75" message tells us code 75 was returned, meaning the socket-close path won the race over SIGTERM. Either way: root cause is upstream — the empty-token pool child crash loop.

- timestamp: 2026-05-01T13:51:00Z
  checked: pre-Phase-108 working path (revert in commit f2eb64e — loader.ts diff)
  found: Pre-revert, shim-broker mode used `OP_SERVICE_ACCOUNT_TOKEN: process.env.OP_SERVICE_ACCOUNT_TOKEN` in shim env (loader.ts pre-f2eb64e). Shim's `tokenLiteral = env.OP_SERVICE_ACCOUNT_TOKEN`, hashed to 8 chars, sent. Daemon's process-env warm-path also uses `process.env.OP_SERVICE_ACCOUNT_TOKEN`, hashed to 16 chars. **Hashes are computed from the SAME literal but with DIFFERENT slice lengths — by construction they cannot match.** This is a hard logic bug, not an env/config drift.
  implication: The bug exists for 100% of agents on warm-path the moment the broker is wired in. Reverting to npx-per-agent (commit f2eb64e) bypasses the broker entirely → bug latent but not exercised.

## Resolution

root_cause: **tokenHash slice-length mismatch between shim and daemon.** `src/cli/commands/mcp-broker-shim.ts:67` slices the sha256 hex to 8 chars; `src/manager/daemon.ts:1717` slices it to 16 chars when populating `tokenHashToRawToken`. The handshake hash (8 chars) never matches a map key (16 chars), so `resolveRawToken` returns `undefined`, `rawToken` defaults to `""`, the broker spawns `@takescake/1password-mcp` with `OP_SERVICE_ACCOUNT_TOKEN=""` (which overrides daemon's own valid token via the `...process.env, OP_SERVICE_ACCOUNT_TOKEN: rawToken` spread order at daemon.ts:1743-1746), the child crashes immediately on auth with empty token, the broker auto-respawns into a tight crash loop, and the shim's socket either closes (path A: child crashes → broker kills pool → shim socket closes → exit 75) or is killed by the SDK's 2s deadline → exit 75. The SHIM doc-comment at mcp-broker-shim.ts:65 explicitly says "8-char tokenHash"; the daemon implementation drifted to 16 without updating the shim.

fix:
verification:
files_changed: []

## Resolution (2026-05-07)

Operator confirmed resolved during /gsd-progress triage. Phase 108 (shared 1password-mcp via daemon-managed broker, SHIPPED 2026-05-01) and the subsequent Phase 109 MCP/Secret Resilience bundle (broker observability + orphan reaper + preflight, SHIPPED 2026-05-03) addressed the broker startup-latency and exit-75 surface area. Confirmed in production on clawdy.
