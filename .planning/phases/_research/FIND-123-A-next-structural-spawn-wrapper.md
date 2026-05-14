# FIND-123-A.next — SDK exposes the spawn hook; structural fix is implementable without forking the SDK

**Filed:** 2026-05-14
**Source:** Investigation triggered by `.planning/phases/_research/FIND-123-A-orphan-reaper-shutdown-path.md`
**Status:** investigation-complete, scope-decision-required before code change

## TL;DR

The Claude Agent SDK exposes a `spawnClaudeCodeProcess` option that allows ClawCode to dictate `spawn()` flags — including `detached: true` — without modifying SDK source. The structural fix is implementable. **Before any code lands**, the operator must pick between two scopes (see §Scope decision required).

## Evidence — the SDK hook is real and sufficient

1. **Public Options field.** `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1791-1806` declares:
   ```ts
   spawnClaudeCodeProcess?: (options: SpawnOptions) => SpawnedProcess;
   ```
   with `SpawnOptions = {command, args, cwd?, env, signal}` (sdk.d.ts:5458-5471) and `SpawnedProcess` (sdk.d.ts:5417-5453) being structurally compatible with Node's `ChildProcess`.

2. **SDK default spawn — confirmed non-detached.** In `sdk.mjs` (`ProcessTransport.spawnLocalProcess`):
   ```js
   spawn(command, args, {
     cwd, stdio: ["pipe", "pipe", G], signal, env, windowsHide: true
   })
   ```
   where `G = (DEBUG_CLAUDE_AGENT_SDK || options.stderr) ? "pipe" : "ignore"`. No `detached`. The grep confirms the FIND's root-cause claim.

3. **Hook invocation.** `sdk.mjs` `initialize()`:
   ```js
   if (this.options.spawnClaudeCodeProcess)
     this.process = this.options.spawnClaudeCodeProcess(VJ);
   else
     this.process = this.spawnLocalProcess(VJ);
   ```
   `VJ = {command, args, cwd, env, signal: this.abortController.signal}`. The override fully replaces the default — ClawCode owns the spawn-flags decision when the hook is set.

4. **`ChildProcess` satisfies `SpawnedProcess`.** stdin/stdout streams, `killed`, `exitCode`, `kill(signal)`, `on`/`once`/`off` for `'exit'`/`'error'` all match natively. The SDK comment "ChildProcess already satisfies this interface" (sdk.d.ts:5415) is accurate.

## Implementation outline (if/when greenlit)

A minimal, faithful drop-in for `spawnLocalProcess`:

```ts
import { spawn } from "node:child_process";
function makeDetachedSpawn(pidSink: { pid: number | null }, opts?: { stderr?: (s: string) => void }) {
  return ({ command, args, cwd, env, signal }: SpawnOptions): SpawnedProcess => {
    const wantStderr = !!(env.DEBUG_CLAUDE_AGENT_SDK || opts?.stderr);
    const child = spawn(command, args, {
      cwd, env, signal,
      stdio: ["pipe", "pipe", wantStderr ? "pipe" : "ignore"],
      windowsHide: true,
      detached: true,                       // <-- the entire point
    });
    pidSink.pid = child.pid ?? null;
    // Sanity: child must be its own pgid leader.
    if (child.pid && process.getpgid(child.pid) !== child.pid) {
      // log.warn — fix did not take; advisor #4
    }
    if (wantStderr && opts?.stderr) child.stderr?.on("data", (b) => opts.stderr!(b.toString()));
    return child;                            // ChildProcess ⊂ SpawnedProcess
  };
}
```

**Wiring points (per advisor #3, factory-closure pid capture, no /proc race):**

- `createPersistentSessionHandle(...)` (`src/manager/persistent-session-handle.ts:165`) accepts a new `pidSink: { pid: number | null }` arg, builds the closure above, and passes it as `sdk.query({ options: { ..., spawnClaudeCodeProcess: detachedSpawn } })`.
- `SessionManager.start` (currently discovers `claudePid` via `/proc` scan over a 30s window — `session-manager.ts:991-1041`) **replaces** that scan with a synchronous read from the sink. This eliminates the bootstrap race and shrinks startup latency.
- The daemon's existing tracker (`tracker.register(name, claudePid, mcpPids)`) and shutdown path (`tracker.killAll`) consume the same pid; new addition is **explicit** `process.kill(-claudePid, "SIGTERM")` BEFORE `killAll`, with a 2s grace then `-SIGKILL`. Keep `tracker.killAll` (advisor #6 — additive, not replacement).

**Tests required:**

1. Unit — `makeDetachedSpawn` returns an object with `child.pid && getpgid(pid) === pid` on Linux.
2. Unit — when set, the closure writes `child.pid` into the supplied sink synchronously.
3. Unit — `AbortSignal` from `SpawnOptions.signal` propagates to `child.kill("SIGTERM")` (advisor #2; `spawn(…, {signal})` already wires this, but assert it).
4. Integration — synthetic `sleep 30` "claude" worker via the closure; daemon shutdown sends `process.kill(-pid, SIGTERM)`; assert no `ESRCH` and grandchild (child of synthetic) receives the signal.
5. Stdio mirror — assert stderr defaults to `"ignore"` and switches to `"pipe"` when `DEBUG_CLAUDE_AGENT_SDK` env or `options.stderr` is set (advisor #1 — silent error swallowing prevention).
6. Static-grep regression — see scope decision below.

## Scope decision required — operator pick before code lands

The task brief asks for a static-grep regression that every `sdk.query(` call passes `detached: true`. The FIND, however, only implicates **the live persistent path** (the only SDK spawn that gives birth to MCP child trees). The two are in conflict:

| Option | Scope | Sites touched | Risk profile |
|---|---|---|---|
| **A — Narrow (FIND-aligned)** | Apply `spawnClaudeCodeProcess` only to `createPersistentSessionHandle`. Ephemeral queries (advisor, haiku-direct, summarize, json-rpc-call, benchmarks) unchanged — they don't launch MCP servers. | 1 wiring point + 1 sink + 1 test file | Lowest. Surface area matches the FIND's reproducer. Static-grep regression must be **path-scoped** (e.g., `grep -L spawnClaudeCodeProcess src/manager/persistent-session-handle.ts`) rather than global. |
| **B — Broad (every `sdk.query(`)** | Build a shared helper, thread `spawnClaudeCodeProcess` through 6+ sites: `persistent-session-handle`, `session-adapter` (`initialQuery` + 3 in-file `sdk.query`s), `manager/haiku-direct`, `mcp/json-rpc-call`, `manager/summarize-with-haiku`, `advisor/backends/anthropic-sdk`, `benchmarks/runner`. | 6+ files + shared helper + global static-grep regression | Higher diff blast-radius. Ephemeral query paths inherit `detached: true` semantics they don't structurally need. Catches future regressions globally though. |

**Recommendation:** A (narrow). Reasoning: the FIND's root cause is grandchild orphan reparenting, which is exclusive to long-lived MCP-bearing sessions. Ephemeral `sdk.query()` calls in advisor/haiku-direct/etc. don't `--mcp-config` anything that persists. The principled scope is "wherever the SDK launches a process that loads `mcpServers`," which is currently only the persistent path. Applying broadly is defensible (silent-path-bifurcation prevention; memory `feedback_silent_path_bifurcation`) but should be its own follow-up plan after the narrow fix proves the pattern.

## Out-of-scope / preserved invariants

- **Backstop stays.** The FIND-123-A `shutdown-scan` reaper (commits 69e7a20 + 9f1012b + 21af28f) remains as defense-in-depth, per operator constraint.
- **No SDK source edits.** Confirmed — the hook makes patching `node_modules/` unnecessary.
- **`killAgentGroup`'s negative-pid kill stays.** Advisor #6 — keep the existing `process.kill(-npxPid)` calls; the new `process.kill(-claudePid)` is **additional**, not a replacement, until a soak proves the npxPid kill is now redundant.
- **`/proc`-based `discoverClaudeSubprocessPid`** can be removed only after structural fix is verified on production — sink capture is synchronous and authoritative, but the discoverer is also used by recovery / drift detection paths (`mcpReaperPidCheck`) that aren't in this scope.

## Open questions for the operator

1. **Scope A or B?** Block until answered.
2. **Sink semantics for re-spawns** — the SDK's `ProcessTransport.initialize()` can re-spawn after a `claude` crash (see `pendingWrites` / `deferSpawn` paths). Does the sink mutate on every spawn or only the first? Likely mutate-on-every-spawn (latest pid wins); tracker.register must be call-on-respawn. Confirm.
3. **Removing `discoverClaudeSubprocessPid`** — defer to a follow-up or include in the same plan? Cleaner-but-larger.

## References

- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1791-1806` — Options.spawnClaudeCodeProcess
- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:5417-5471` — SpawnedProcess / SpawnOptions
- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs` — `class u7` `spawnLocalProcess` + `initialize` (search "spawnClaudeCodeProcess" — single occurrence in invocation)
- `src/manager/persistent-session-handle.ts:165-199` — single live-path `sdk.query` call site
- `src/manager/session-manager.ts:991-1045` — current `/proc` `claudePid` discovery (replaceable by sink)
- `src/manager/daemon.ts:8120-8145` — shutdown `killAll` + `shutdown-scan` reaper
- 999.28 precedent — `d15c8f1 fix(mcp): group-kill probe wrappers` — the same pattern on ClawCode-owned spawn sites
