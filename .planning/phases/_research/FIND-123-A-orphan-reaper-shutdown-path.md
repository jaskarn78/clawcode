# FIND-123-A — `mcp-server-mysql` orphan reaper has multi-minute cadence on `systemctl restart clawcode`

**Filed:** 2026-05-14
**Source:** Phase 123 Variant A soak — `.planning/phases/123-mcp-lifecycle-verification-soak/123-VERIFICATION.md`
**Severity:** medium (operator-visible; resource leak; not a correctness bug for end-user agents)

## TL;DR

`systemctl restart clawcode` leaks 1–2 `mcp-server-mysql` processes to `ppid==1` per restart. The periodic orphan reaper catches them on its next sweep, but the cadence (≥60s, observed ≥4 min, fully clean only at T+9 min) leaves a visible orphan window that the soak's instantaneous-zero check fails.

## Root cause

ClawCode does **not** own the `claude` subprocess spawn — the Claude Agent SDK does, and it spawns `claude` **non-detached**. Every MCP child the SDK launches (`npx -y @benborla29/mcp-server-mysql`, which in turn forks `sh -c <…>` → `node /.../bin/mcp-server-mysql`) shares the daemon's pgid.

`McpProcessTracker.discoverAgentMcpPids` (`src/mcp/proc-scan.ts:342`) only records the **direct** children of `claudePid` (the `npx` wrapper PID). The `mcp-server-mysql` grandchild is never tracked.

At shutdown:

1. `manager.stopAll()` → per-agent `stopAgent()` → `killAgentGroup()` calls `process.kill(-npxPid, SIGTERM)`. The npx wrapper is **not** a pgid leader (it inherited the daemon's pgid), so the syscall returns `ESRCH` and `killGroup()` swallows it as idempotent success — silent no-op.
2. `handle.close()` → SDK closes its query iterator → `claude` exits → its child tree, including the previously-untouched `mcp-server-mysql` grandchild, reparents to PID 1.
3. `mcpTracker.killAll(5_000)` repeats the silent-no-op pattern.
4. SIGKILL fallback uses **positive** pid → kills the npx wrapper only (if alive) → grandchild still reparented.
5. Daemon exits. `mcp-server-mysql` survives on PID 1 until the next daemon's periodic reaper sweep catches it.

The Phase 999.28 fix (`d15c8f1 fix(mcp): group-kill probe wrappers …`) addressed the structurally-identical **probe** path by `spawn(…, { detached: true })` + `killGroup`. That spawn site is owned by ClawCode (`src/mcp/health.ts`, `src/mcp/json-rpc-call.ts`); the live-agent MCP spawn is not.

## Fix (this report)

Commit `fix(123-A-T02): add shutdown-scan orphan reap as deterministic backstop` — adds a synchronous `reapOrphans({ reason: "shutdown-scan", graceMs: 2_000 })` call to the daemon shutdown closure, immediately after `mcpTracker.killAll()` and before pid/socket cleanup. The shutdown reap sweeps `ppid==1 + uid + pattern-match` orphans created moments earlier when claude exited.

`ReaperReason` gained a third variant `"shutdown-scan"` for log discriminator hygiene. Mirrors the existing `boot-scan` one-shot at the symmetric lifecycle boundary.

Test coverage in `src/manager/__tests__/daemon-shutdown-orphan-scan.test.ts`:

- canonical pino log shape with `reason: "shutdown-scan"`
- SIGKILL straggler path with positive pid + `graceMs` logged
- shutdown ordering invariant (clearInterval → killAll → shutdown-reap → unlink)
- grandchild reparent simulation: tracked parent at `ppid==12_345` excluded; orphaned grandchild at `ppid==1` reaped

## Reproducer (deploy-gated)

```bash
# On clawdy:
for i in 1 2 3 4 5; do
  sudo systemctl restart clawcode
  sleep 35
  echo "restart $i: orphans=$(ps -ef | awk '$3==1 && /mcp-server-mysql/' | wc -l)"
done
```

**Pre-fix:** orphan count > 0 every iteration; persists ≥4 min after the last restart.
**Post-fix expected:** orphan count == 0 every iteration; steady-state immediately.

## Acceptance criteria for next deploy verification

After the fix is deployed:

1. Run the reproducer above. Every line must print `orphans=0`.
2. Total MCP child count `pgrep -cf mcp-server-mysql` must equal live agent count × MCP-server count once agents settle back online (Phase 123 SC-4 invariant — currently a passing check, must not regress).
3. `journalctl -u clawcode | grep '"reason":"shutdown-scan"'` should show SIGTERM (or SIGKILL straggler) entries on each restart where orphans existed. Empty when nothing reparented.

## Follow-up — structural fix (FIND-123-A.next)

The shutdown reap is a **backstop**, not the root fix. The cleaner architectural path is:

- ClawCode wraps the SDK spawn via the SDK's `spawn_claude_code_process` hook with `{ detached: true, env: { ... } }` so `claude` becomes a pgid leader.
- `mcpTracker` records and signals the **claudePid** (already stored, see `RegisteredAgent.claudePid`) via `process.kill(-claudePid, SIGTERM)` at `killAgentGroup`/`killAll`. One signal takes the whole subtree (claude + npx + sh + node-grandchild).
- The MCP child tracker becomes a diagnostic / observability tool, not the kill mechanism.

Acceptance for the follow-up: drop the shutdown-scan reap entirely once the structural fix lands and Variant A passes ≥5 consecutive restarts with no orphans, no shutdown-scan log entries.

## Out-of-scope considerations (informational)

- **systemd `KillMode`.** `systemctl cat clawcode` not checked in this session (operator constraint: no deploy). If `KillMode=control-group` is in effect, systemd would already SIGTERM the whole cgroup on restart — orphans would only persist if the daemon takes too long to exit and systemd's `TimeoutStopSec` expires. Worth verifying as part of the next deploy.
- **Daemon shutdown wall time.** With 14 agents × stopAgent flush + summarization, shutdown can take tens of seconds. The 2-second grace on the shutdown-scan is intentional — these processes are seconds old as orphans; SIGTERM-then-SIGKILL is fast.
