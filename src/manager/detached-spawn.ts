/**
 * FIND-123-A.next T-01 — structural spawn wrapper for the Claude Agent SDK's
 * `spawnClaudeCodeProcess` hook (sdk.d.ts:1806).
 *
 * The SDK's default `spawnLocalProcess` calls `spawn()` WITHOUT `detached:
 * true`, so the spawned `claude` CLI inherits the daemon's process group.
 * When ClawCode tries to group-kill via `process.kill(-claudePid, signal)`
 * during shutdown, the kernel routes the signal to the daemon's own pgid
 * (no-op or worse). Grandchildren — the per-agent MCP servers
 * `mcp-server-mysql`, npx wrappers, etc. — outlive shutdown and reparent
 * to PID 1, where they idle until the next reaper sweep.
 *
 * This wrapper replaces the SDK default with a spawn that:
 *   - sets `detached: true` so the child becomes its own process-group leader
 *   - mirrors the SDK's stdio contract: stderr is `"ignore"` unless
 *     `DEBUG_CLAUDE_AGENT_SDK` is set in env, matching the default
 *     `G = (DEBUG_CLAUDE_AGENT_SDK || options.stderr) ? "pipe" : "ignore"`
 *     branch in `sdk.mjs:ProcessTransport.spawnLocalProcess`
 *   - keeps `windowsHide: true` (SDK default) and passes through the SDK's
 *     `AbortSignal`
 *   - captures the spawned PID into a caller-supplied mutable sink so the
 *     daemon can `process.kill(-pid, ...)` at shutdown without falling back
 *     to the legacy `/proc`-walk discovery (`discoverClaudeSubprocessPid`).
 *
 * Same pattern as the 999.28 group-kill probe-wrapper precedent
 * (`d15c8f1 fix(mcp): group-kill probe wrappers`).
 *
 * Sink semantics (locked by FIND-123-A.next operator decision):
 *   - mutate-on-every-spawn — the SDK's `ProcessTransport.initialize()` is
 *     re-callable on claude crash + daemon respawn; the latest pid wins
 *   - cleared by `createPersistentSessionHandle`'s `close()` so the daemon
 *     doesn't group-kill a recycled PID at terminal shutdown
 *
 * Out of scope for this wrapper:
 *   - `stderr` callback forwarding (the SDK Options field; not used by
 *     ClawCode today and the SDK doesn't expose it through `SpawnOptions`)
 *   - registering exit listeners — the SDK already wires those in its own
 *     transport layer and double-registration would double-fire `onExit`
 */

import { spawn } from "node:child_process";
import type {
  SpawnOptions as SdkSpawnOptions,
  SpawnedProcess as SdkSpawnedProcess,
} from "@anthropic-ai/claude-agent-sdk";

/**
 * Mutable handle the daemon reads during shutdown to obtain the live claude
 * subprocess PID. Owned by `createPersistentSessionHandle`.
 *
 * `pid` is non-null between the moment the wrapper spawns and the moment
 * the handle's `close()` clears it. Mutates on SDK respawn.
 */
export interface ClaudePidSink {
  pid: number | null;
}

/**
 * Build a `spawnClaudeCodeProcess`-compatible closure that the SDK invokes
 * once per (re-)spawn. Each invocation writes the resulting PID into
 * `pidSink` so the daemon can read it without a `/proc` walk.
 *
 * @param pidSink mutable sink — set on every spawn, cleared on handle close
 * @returns the spawn function to pass as `options.spawnClaudeCodeProcess`
 */
export function makeDetachedSpawn(
  pidSink: ClaudePidSink,
): (options: SdkSpawnOptions) => SdkSpawnedProcess {
  return ({ command, args, cwd, env, signal }: SdkSpawnOptions): SdkSpawnedProcess => {
    const wantStderr = Boolean(env["DEBUG_CLAUDE_AGENT_SDK"]);
    const child = spawn(command, args, {
      cwd,
      env,
      signal,
      stdio: ["pipe", "pipe", wantStderr ? "pipe" : "ignore"],
      windowsHide: true,
      detached: true,
    });
    pidSink.pid = child.pid ?? null;
    return child as unknown as SdkSpawnedProcess;
  };
}
