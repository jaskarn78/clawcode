/**
 * Agent lifecycle status — represents the state machine for each agent.
 * Transitions: stopped -> starting -> running -> stopping -> stopped
 * Error path: running -> crashed -> restarting -> starting
 * Terminal: crashed -> failed (after max retries)
 */
export type AgentStatus =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "crashed"
  | "restarting"
  | "failed";

/**
 * A single agent's entry in the persistent registry.
 * All fields are readonly — updates produce new objects.
 */
export type RegistryEntry = {
  readonly name: string;
  readonly status: AgentStatus;
  readonly sessionId: string | null;
  readonly startedAt: number | null;
  readonly restartCount: number;
  readonly consecutiveFailures: number;
  readonly lastError: string | null;
  readonly lastStableAt: number | null;
  /**
   * Phase 56 Plan 01 — warm-path readiness flag. Flips to `true` after
   * `runWarmPathCheck` succeeds for this agent (wired in Plan 02).
   *
   * OPTIONAL for backward compatibility: entries persisted before Phase 56
   * lack this field. Consumers MUST treat `undefined` as "not ready" and
   * re-run the warm-path check on next startup.
   */
  readonly warm_path_ready?: boolean;
  /**
   * Phase 56 Plan 01 — total warm-path duration in milliseconds for this
   * agent's last successful readiness check. `null` while the check is
   * pending; a number after success. `undefined` on pre-Phase-56 entries.
   */
  readonly warm_path_readiness_ms?: number | null;
  /**
   * Timestamp (ms since epoch) when the entry most recently transitioned to
   * status="stopped" via stopAgent. Consumed by `reconcileRegistry` to TTL-prune
   * subagent / thread-session "gravestones" so the registry does not grow
   * unboundedly.
   *
   * OPTIONAL for backward compatibility: entries persisted before the
   * clawdy-v2-stability fix (2026-04-19) lack this field. The reap path treats
   * `undefined` as "stopped long ago" → eligible for immediate prune on first
   * boot (one-time cleanup of legacy zombies).
   */
  readonly stoppedAt?: number | null;
};

/**
 * The full registry — an immutable collection of agent entries.
 */
export type Registry = {
  readonly entries: readonly RegistryEntry[];
  readonly updatedAt: number;
};

/**
 * Configuration for the exponential backoff calculator.
 */
export type BackoffConfig = {
  readonly baseMs: number;
  readonly maxMs: number;
  readonly maxRetries: number;
  readonly stableAfterMs: number;
};

/**
 * Configuration passed to the SessionAdapter when creating a session.
 *
 * Phase 52 Plan 02:
 *   - `systemPrompt` now carries ONLY the STABLE PREFIX (identity + stable
 *     hot-tier + tool definitions). The SDK adapter wraps it in
 *     `{ type: "preset", preset: "claude_code", append: systemPrompt }` so
 *     the preset's cache scaffolding kicks in.
 *   - `mutableSuffix` is NEW — per-turn block (discord bindings, context
 *     summary, and hot-tier when composition just drifted) that the adapter
 *     prepends to the user message, sitting OUTSIDE the cached block.
 *   - `hotStableToken` is NEW — sha256 of the hot-tier signature THIS turn,
 *     carried forward by SessionManager for next-turn comparison so
 *     hot-tier enters/exits the cacheable block without thrashing.
 */
export type AgentSessionConfig = {
  readonly name: string;
  readonly model: "sonnet" | "opus" | "haiku";
  // Mirrors `effortSchema` in config/schema.ts and ResolvedAgentConfig.effort
  // — the canonical 7-value union. Was previously narrowed to 4 values which
  // diverged from the schema after `xhigh`/`auto`/`off` were added.
  readonly effort: "low" | "medium" | "high" | "xhigh" | "max" | "auto" | "off";
  readonly workspace: string;
  readonly systemPrompt: string;
  readonly mutableSuffix?: string;
  readonly hotStableToken?: string;
  readonly channels: readonly string[];
  readonly contextSummary?: string;
  readonly mcpServers?: readonly {
    readonly name: string;
    readonly command: string;
    readonly args: readonly string[];
    readonly env: Readonly<Record<string, string>>;
    /**
     * Phase 85 TOOL-01 — mirrors ResolvedAgentConfig.mcpServers[].optional.
     * Defaults to false (mandatory) at the config/loader layer.
     */
    readonly optional: boolean;
  }[];
  /**
   * Phase 100 GSD-02 — per-agent SDK settingSources passthrough. When omitted
   * (existing fleet, all 15+ agents), session-adapter applies the
   * ['project'] default at lines 592/631. When set (Admin Clawdy + future
   * GSD-enabled agents), passes through verbatim. Mirrors
   * ResolvedAgentConfig.settingSources but stays optional at this boundary
   * so existing call sites that build AgentSessionConfig don't need updates
   * until they choose to opt in. See RESEARCH.md Architecture Pattern 5.
   */
  readonly settingSources?: readonly ("project" | "user" | "local")[];
  /**
   * Phase 100 GSD-04 — per-agent gsd block. UNDEFINED when not set (existing
   * fleet). When set, session-adapter uses gsd.projectDir as the SDK cwd
   * instead of config.workspace at lines 588/627. Mirrors
   * ResolvedAgentConfig.gsd verbatim.
   */
  readonly gsd?: { readonly projectDir: string };
  /**
   * Phase 99 sub-scope N (2026-04-26) — SDK-level deny-list. When set, the
   * LLM physically cannot invoke any tool whose name matches an entry. Used
   * for the subagent recursion guard: subagent sessions disallow
   * `mcp__clawcode__spawn_subagent_thread` so they cannot chain further
   * subagents (subagents inherit the parent's "delegate, don't execute"
   * soul and would otherwise loop indefinitely). Forwarded verbatim into
   * the SDK's `disallowedTools` option in both `createSession` and
   * `resumeSession` (symmetric-edits Rule 3). Empty/undefined → omitted
   * from baseOptions so the existing 15+ agent fleet is unaffected.
   */
  readonly disallowedTools?: readonly string[];
  /**
   * Phase 115 sub-scope 14 — operator-toggle for the diagnostic baseopts
   * dump. UNDEFINED for the existing fleet (no behavior change). When set,
   * `dumpBaseOptionsOnSpawn === true` enables the per-agent baseopts dump
   * to ~/.clawcode/agents/<agent>/diagnostics/baseopts-<flow>-<ts>.json on
   * every createSession/resumeSession (secrets redacted via redactSecrets
   * in session-adapter.ts). Replaces the temporary hardcoded fin-acquisition
   * + Admin Clawdy allowlist. Mirrors `ResolvedAgentConfig.debug` verbatim
   * but stays optional at this boundary so existing call sites that build
   * AgentSessionConfig don't need updates until they choose to opt in.
   */
  readonly debug?: {
    readonly dumpBaseOptionsOnSpawn: boolean;
  };
};

/**
 * Default backoff configuration per D-12, D-13, D-14:
 * - 1s base delay
 * - 5 minute cap
 * - 10 max retries
 * - 5 minute stability window
 */
export const DEFAULT_BACKOFF_CONFIG: BackoffConfig = {
  baseMs: 1_000,
  maxMs: 300_000,
  maxRetries: 10,
  stableAfterMs: 300_000,
} as const;
