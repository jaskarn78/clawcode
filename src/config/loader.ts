import { execSync } from "node:child_process";
import { readFile, access } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve as pathResolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { configSchema } from "./schema.js";
import { expandHome } from "./defaults.js";
import { ConfigFileNotFoundError, ConfigValidationError } from "../shared/errors.js";
import type {
  Config,
  AgentConfig,
  DefaultsConfig,
  McpServerSchemaConfig,
  SystemPromptDirective,
} from "./schema.js";
import type {
  ResolvedAgentConfig,
  ResolvedMarketplaceSource,
  ResolvedMarketplaceSources,
} from "../shared/types.js";

// ---------------------------------------------------------------------------
// Phase 110 Stage 0b — install paths + command resolver for the alternate
// MCP shim runtimes the loader auto-injects on operator opt-in via
// `defaults.shimRuntime.<type>`.
//
// STATIC_SHIM_PATH: the Go binary deployed by Wave 2's CI artifact
// bundling. The shim is a single binary that dispatches on `--type
// <search|image|browser>` (mirrors Phase 108 broker shim's `--type`
// pattern at `src/cli/commands/mcp-broker-shim.ts`).
//
// PYTHON_SHIM_PATH: reserved path for a future FastMCP-based Python
// translator. The Python translator does NOT exist in Stage 0b; the
// constant is defined together with STATIC so widening the schema enum
// to "python" does not require another loader change later.
//
// The `resolveShimCommand` helper is exported because
// `src/manager/daemon.ts`'s fleet-stats IPC handler builds proc-scan
// regex patterns from the SAME command/args shape so /api/fleet-stats
// can match the running shim children. Both call-sites must agree on
// the spawn shape per runtime, otherwise the dashboard goes blind when
// an operator flips a flag.
//
// Crash-fallback (LOCKED): no try/catch around the alternate-runtime
// path, no pre-detection of binary existence. If a "static" spawn
// fails the operator's tooling surfaces the failure directly — the
// operator-locked decision is fail-loud, not silent degradation.
// ---------------------------------------------------------------------------
// Phase 110 Stage 0b — install root is `/opt/clawcode/` on the canonical
// production host (clawdy). That directory is `jjagpal:clawcode 0775` so the
// deploy user writes without sudo while the clawcode daemon (group
// `clawcode`) reads+executes. Matches /opt/clawcode/dist, /opt/clawcode/
// scripts, /opt/clawcode/clawcode.yaml convention. /usr/local/bin was the
// planner's initial guess and would have required sudo grants we don't have.
//
// CLAWCODE_STATIC_SHIM_PATH / CLAWCODE_PYTHON_SHIM_PATH env overrides
// allow a parallel dev daemon (running as a different user, on a
// different config) to exercise an alternate binary location without
// rebuilding or touching production. Default values match the canonical
// install. The override is intentional defense-in-depth — same pattern
// as CLAWCODE_MANAGER_SOCK on the IPC side.
export const STATIC_SHIM_PATH =
  process.env.CLAWCODE_STATIC_SHIM_PATH ??
  "/opt/clawcode/bin/clawcode-mcp-shim";
export const PYTHON_SHIM_PATH =
  process.env.CLAWCODE_PYTHON_SHIM_PATH ??
  "/opt/clawcode/bin/clawcode-mcp-shim.py";

// Phase 110 Stage 0b — daemon IPC socket path (mirrors
// `SOCKET_PATH` in src/manager/daemon.ts:1638). Recomputed inline
// rather than imported because daemon.ts already imports from
// loader.ts and the resulting cycle would break tsup bundling. The
// Go shim's IPC client (internal/shim/ipc/client.go SocketPath) has
// the same default; this constant is what the loader injects via
// CLAWCODE_MANAGER_SOCK as defense-in-depth, so a future relocation
// of MANAGER_DIR cannot silently break alternate-runtime shims that
// were spawned with the old default baked in.
//
// MUST honor CLAWCODE_MANAGER_DIR identically to daemon.ts MANAGER_DIR.
// When the daemon's manager dir moves (e.g. for a parallel dev
// instance), the loader's injected env must follow so the shim
// children dial the actual bound socket. This was the dev-instance
// bug found 2026-05-06: dev daemon bound /home/jjagpal/.clawcode-dev-
// 110/manager/clawcode.sock but loader injected the canonical
// /home/jjagpal/.clawcode/manager/clawcode.sock — Go shim ENOENT'd
// → exit 75 → warm-path failed.
//
// Both sides MUST stay aligned with daemon.ts SOCKET_PATH. Drift is
// caught by:
//   - Go side: TestSocketPathDefaultMatchesDaemonConvention
//   - TS side: shim-runtime-env-injection assertions in
//     src/config/__tests__/loader.test.ts
const _managerDirForSocket =
  process.env.CLAWCODE_MANAGER_DIR ?? join(homedir(), ".clawcode", "manager");
export const MANAGER_SOCKET_PATH = join(_managerDirForSocket, "clawcode.sock");

export type ShimType = "search" | "image" | "browser";
export type ShimRuntime = "node" | "static" | "python";

/**
 * Phase 110 Stage 0b — resolve the command/args pair the loader emits
 * (and `src/manager/daemon.ts`'s fleet-stats proc-scan must match) for
 * a given shim type + runtime selector.
 *
 * Pure function; returns a fresh object on every call. Callers that
 * embed the result in a longer-lived structure spread `args`
 * (`[...result.args]`) so subsequent mutations don't leak into shared
 * literal references — matches the immutability discipline in CLAUDE.md.
 *
 * The "node" branch is the default-only fallthrough — exhaustiveness
 * over the schema-bound `ShimRuntime` union means any future widening
 * surfaces here as a missing case at compile time.
 */
export function resolveShimCommand(
  type: ShimType,
  runtime: ShimRuntime,
): { readonly command: string; readonly args: readonly string[] } {
  switch (runtime) {
    case "static":
      return {
        command: STATIC_SHIM_PATH,
        args: ["--type", type],
      };
    case "python":
      return {
        command: "python3",
        args: [PYTHON_SHIM_PATH, "--type", type],
      };
    case "node":
    default:
      return {
        command: "clawcode",
        args: [`${type}-mcp`],
      };
  }
}

/**
 * Resolves a 1Password `op://vault/item/field` reference to its secret value.
 *
 * Returns the resolved secret on success, OR throws if resolution fails
 * (e.g. op CLI missing, not signed in, item not found). Implementations
 * MUST be synchronous so `resolveAgentConfig` stays pure-sync — matches the
 * `execSync` pattern used for Discord.botToken in `src/manager/daemon.ts`.
 *
 * Tests can inject a pure (no I/O) implementation to avoid subprocess calls.
 * Daemon code injects `defaultOpRefResolver` (runs `op read <ref>`).
 */
export type OpRefResolver = (ref: string) => string;

/**
 * Default `op://` resolver — shells out to the 1Password CLI.
 *
 * Runs `op read "<ref>"` via `execSync` with a 10s timeout. Mirrors the
 * existing botToken resolver in daemon.ts. Trims trailing newline.
 *
 * Throws on any failure (missing op CLI, not signed in, item/field missing,
 * timeout). Callers SHOULD wrap the invocation in a try/catch at the boot
 * boundary and surface a clear error to the operator — same pattern
 * daemon.ts uses for the Discord botToken resolution.
 */
export function defaultOpRefResolver(ref: string): string {
  return execSync(`op read "${ref}"`, { encoding: "utf-8", timeout: 10_000 }).trim();
}

/**
 * Recognizes a 1Password secret-reference URI.
 *
 * `op://vault/item/field` is the canonical form. We only check the scheme
 * prefix and reject the literal `op://` placeholder (no body). Anything
 * else that starts with `op://` is handed to the resolver verbatim so it
 * can produce its own "malformed ref" error if needed.
 */
function isOpRef(value: string): boolean {
  return value.startsWith("op://") && value.length > "op://".length;
}

/**
 * Load and validate a clawcode.yaml config file.
 *
 * @param configPath - Path to the YAML config file
 * @returns Validated Config object
 * @throws ConfigFileNotFoundError if the file does not exist
 * @throws ConfigValidationError if the file fails schema validation
 */
export async function loadConfig(configPath: string): Promise<Config> {
  const expandedPath = expandHome(configPath);

  let rawText: string;
  try {
    rawText = await readFile(expandedPath, "utf-8");
  } catch {
    throw new ConfigFileNotFoundError(configPath);
  }

  const rawConfig: unknown = parseYaml(rawText);
  const result = configSchema.safeParse(rawConfig);

  if (!result.success) {
    throw new ConfigValidationError(result.error, rawConfig);
  }

  return result.data;
}

/**
 * Resolve an agent config by merging with top-level defaults.
 * Returns a new object -- never mutates inputs.
 *
 * @param agent - Raw agent config from the parsed YAML
 * @param defaults - Top-level defaults section
 * @returns Fully resolved agent config
 */
/**
 * Callback invoked when resolving an MCP server's env fails (typically an
 * `op://` reference pointing at a missing 1Password item or field). When
 * present, `resolveAgentConfig` skips the failing MCP server instead of
 * throwing — one bad credential does not take out unrelated agents. When
 * omitted, the pre-existing throw behavior is preserved (migration + CLI
 * list tooling rely on strict failure to surface config errors loudly).
 */
export type McpResolutionErrorHandler = (info: {
  readonly agent: string;
  readonly server: string;
  readonly message: string;
}) => void;

export function resolveAgentConfig(
  agent: AgentConfig,
  defaults: DefaultsConfig,
  sharedMcpServers: Record<string, McpServerSchemaConfig> = {},
  /**
   * Optional 1Password secret-reference resolver. When set, every MCP
   * server env value that matches `op://...` is substituted with the
   * resolver's return value before being handed to the spawn layer.
   *
   * When omitted, `op://...` values pass through unchanged (backward-
   * compatible with tests and tools that can't reach a 1Password backend).
   * Daemon boot MUST pass `defaultOpRefResolver` — otherwise MCP children
   * receive literal `op://...` strings in env and fail (e.g. MySQL driver
   * calls `dns.lookup("op://...")` → ENOTFOUND).
   */
  opRefResolver?: OpRefResolver,
  /**
   * Optional handler invoked when an MCP server's env resolution fails.
   * When provided, the failing MCP is excluded from `mcpServers` in the
   * returned config (graceful degradation — one bad ref doesn't crash the
   * daemon). When omitted, the resolution error propagates (pre-existing
   * behavior used by migration tooling + `clawcode list` that want to
   * surface any config drift loudly).
   */
  onMcpResolutionError?: McpResolutionErrorHandler,
): ResolvedAgentConfig {
  // Resolve heartbeat:
  //   - agent.heartbeat === false → disable but keep global config values
  //   - agent.heartbeat === true / undefined → use global config as-is
  //   - agent.heartbeat === { enabled?, every?, model?, prompt? } → object
  //     shape (Phase 90 Plan 07 WIRE-02, used by fin-acquisition for the
  //     50-minute OpenClaw-style heartbeat). The daemon-level heartbeat
  //     runner still consumes `defaults.heartbeat` for intervalSeconds +
  //     contextFill; the per-agent object carries operator-specified
  //     cadence/prompt/model that downstream consumers read separately.
  const heartbeatConfig = (() => {
    const h = agent.heartbeat;
    if (h === false) return { ...defaults.heartbeat, enabled: false };
    // Phase 100 follow-up — propagate per-agent extended fields (every,
    // model) so downstream surfaces (capability manifest) can render the
    // operator-specified cadence instead of just the global intervalSeconds.
    if (typeof h === "object" && h !== null) {
      const enabled = "enabled" in h && h.enabled === false ? false : defaults.heartbeat.enabled;
      const every = h.every;
      const model = h.model;
      return { ...defaults.heartbeat, enabled, ...(every ? { every } : {}), ...(model ? { model } : {}) };
    }
    return defaults.heartbeat;
  })();

  // Resolve MCP servers: string refs -> shared lookup, objects -> passthrough
  const resolvedMcpMap = new Map<string, McpServerSchemaConfig>();
  for (const entry of agent.mcpServers ?? []) {
    if (typeof entry === "string") {
      const shared = sharedMcpServers[entry];
      if (!shared) {
        throw new Error(
          `MCP server "${entry}" not found in shared mcpServers definitions for agent "${agent.name}"`,
        );
      }
      resolvedMcpMap.set(shared.name, shared);
    } else {
      resolvedMcpMap.set(entry.name, entry);
    }
  }
  // Auto-inject the clawcode MCP server so every agent gets memory_lookup,
  // spawn_subagent_thread, ask_advisor, etc. — unless explicitly overridden.
  if (!resolvedMcpMap.has("clawcode")) {
    resolvedMcpMap.set("clawcode", {
      name: "clawcode",
      command: "clawcode",
      args: ["mcp"],
      env: {},
      // Phase 85 TOOL-01 — clawcode MCP is mandatory (default false).
      optional: false,
    });
  }

  // Auto-inject 1Password MCP when OP_SERVICE_ACCOUNT_TOKEN is available,
  // giving agents secure credential access without hardcoded secrets.
  //
  // Phase 108 — route through the daemon-managed broker. Each agent's MCP
  // client spawns `clawcode mcp-broker-shim --pool 1password`; the shim
  // hashes the literal client-side, sends {agent, tokenHash} handshake to
  // the daemon's mcp-broker.sock, then becomes a byte-transparent stdio
  // bridge. The daemon broker owns ONE pooled `@takescake/1password-mcp`
  // child per unique service-account token — N agents → 1 (or few)
  // children. Mirrors the existing browser-mcp / search-mcp / image-mcp
  // pattern. Token-literal redaction (Phase 104 SEC-07): the literal
  // never crosses the socket; broker logs only `tokenHash`.
  //
  // Existing yaml-defined `1password` entries that point at the legacy
  // npx command get rewritten to the broker shim. Per-agent token
  // overrides flow through the merged env (broker grabs the literal at
  // handshake time via daemon's tokenHashToRawToken map).
  const existing1p = resolvedMcpMap.get("1password");
  const isLegacy1pCmd =
    existing1p?.command === "npx" &&
    Array.isArray(existing1p.args) &&
    existing1p.args.some((a) => typeof a === "string" && a.includes("1password-mcp"));
  if (existing1p && isLegacy1pCmd) {
    resolvedMcpMap.set("1password", {
      ...existing1p,
      command: "clawcode",
      args: ["mcp-broker-shim", "--pool", "1password"],
      env: {
        ...(existing1p.env ?? {}),
        // Audit log identity (decision §5) — broker tags every
        // dispatched call with `agent` so operators can grep journalctl
        // per agent.
        CLAWCODE_AGENT: agent.name,
      },
    });
  } else if (!resolvedMcpMap.has("1password") && process.env.OP_SERVICE_ACCOUNT_TOKEN) {
    resolvedMcpMap.set("1password", {
      name: "1password",
      command: "clawcode",
      args: ["mcp-broker-shim", "--pool", "1password"],
      env: {
        // Token literal flows shim → handshake → broker → child spawn
        // env. Shim hashes it client-side; literal never lands in any
        // log line (Phase 104 SEC-07).
        OP_SERVICE_ACCOUNT_TOKEN: process.env.OP_SERVICE_ACCOUNT_TOKEN,
        CLAWCODE_AGENT: agent.name,
      },
      // Phase 85 TOOL-01 — 1Password MCP is mandatory when auto-injected.
      optional: false,
    });
  }

  // Phase 70/71/72 + Phase 110 Stage 0b — auto-inject browser/search/image
  // MCP servers so every agent gets the corresponding tool surface. Each
  // shim type's command/args branches on `defaults.shimRuntime.<type>`
  // (default "node" — current behavior). See `src/config/shim-runtime.ts`
  // for the per-runtime command/args mapping (kept in a shared module so
  // `src/manager/fleet-stats.ts`'s proc-scan patterns stay in sync with
  // what the loader actually spawns).
  //
  // Crash-fallback (LOCKED): no try/catch around the alternate-runtime
  // path, no pre-detection of binary existence. If a "static" spawn
  // fails, the operator's tooling surfaces the failure directly — the
  // operator-locked decision is fail-loud, not silent degradation.
  // Phase 110 Stage 0b — env injection helper for auto-injected shims.
  // Always sets CLAWCODE_AGENT (every runtime needs it). Adds
  // CLAWCODE_MANAGER_SOCK as defense-in-depth for non-`node` runtimes —
  // the Go binary's SocketPath() default (~/.clawcode/manager/clawcode.sock)
  // already matches the daemon's binding, but explicit env injection
  // survives any future relocation of MANAGER_DIR without a Go-side
  // rebuild. Node runtime imports the constant directly, so no env
  // override is needed (and would be redundant).
  const buildShimEnv = (runtime: ShimRuntime): Record<string, string> => {
    const env: Record<string, string> = { CLAWCODE_AGENT: agent.name };
    if (runtime !== "node") {
      env.CLAWCODE_MANAGER_SOCK = MANAGER_SOCKET_PATH;
    }
    return env;
  };

  // Phase 110 Stage 0b — per-agent shimRuntime override fall-through.
  // Resolution order: per-agent setting → defaults → "node" baseline.
  // Per-agent override is what makes Phase 110-05's canary rollout work:
  // flip ONE agent to "static" without touching the fleet default. The
  // override survives agent-restart because the loader re-resolves on
  // every spawn — the prior inline-mcpServers workaround did not.
  const resolveRuntime = (type: ShimType): ShimRuntime =>
    agent.shimRuntime?.[type] ?? defaults.shimRuntime?.[type] ?? "node";

  const browserEnabled = defaults.browser?.enabled !== false;
  if (browserEnabled && !resolvedMcpMap.has("browser")) {
    const runtime = resolveRuntime("browser");
    const { command, args } = resolveShimCommand("browser", runtime);
    resolvedMcpMap.set("browser", {
      name: "browser",
      command,
      args: [...args],
      env: buildShimEnv(runtime),
      // Phase 85 TOOL-01 — browser MCP is mandatory when auto-injected.
      optional: false,
    });
  }

  const searchEnabled = defaults.search?.enabled !== false;
  if (searchEnabled && !resolvedMcpMap.has("search")) {
    const runtime = resolveRuntime("search");
    const { command, args } = resolveShimCommand("search", runtime);
    resolvedMcpMap.set("search", {
      name: "search",
      command,
      args: [...args],
      env: buildShimEnv(runtime),
      // Phase 85 TOOL-01 — search MCP is mandatory when auto-injected.
      optional: false,
    });
  }

  const imageEnabled = defaults.image?.enabled !== false;
  if (imageEnabled && !resolvedMcpMap.has("image")) {
    const runtime = resolveRuntime("image");
    const { command, args } = resolveShimCommand("image", runtime);
    resolvedMcpMap.set("image", {
      name: "image",
      command,
      args: [...args],
      env: buildShimEnv(runtime),
      // Phase 85 TOOL-01 — image MCP is mandatory when auto-injected.
      optional: false,
    });
  }

  // Two-stage env resolution per MCP server:
  //   (1) `${VAR}` interpolation against process.env — supports things like
  //       `${OPENAI_API_KEY}` for non-secret passthrough;
  //   (2) `op://vault/item/field` resolution via the injected 1Password
  //       resolver. The passthrough branch keeps existing tests + offline
  //       flows working without a live op CLI.
  // Daemon boot wires `defaultOpRefResolver` so real agents get real
  // secrets instead of a literal op://... string crashing the MCP child
  // at DNS-lookup time.
  //
  // Graceful degradation: if a caller provides `onMcpResolutionError`,
  // a single MCP's env failure (e.g. bad op:// ref) logs + excludes that
  // MCP from this agent's list instead of throwing the entire config
  // load. Agents that don't reference the failing MCP are unaffected.
  // Build into a mutable local; the field on ResolvedAgentConfig is the
  // readonly view — `push`ing here is fine, the readonly modifier applies
  // to consumers of the resolved config, not to construction.
  const mcpServers: Array<ResolvedAgentConfig["mcpServers"][number]> = [];
  for (const s of resolvedMcpMap.values()) {
    try {
      const env = Object.fromEntries(
        Object.entries(s.env ?? {}).map(([k, v]) => [
          k,
          resolveMcpEnvValue(v, opRefResolver, { serverName: s.name, varName: k }),
        ]),
      );
      mcpServers.push({
        name: s.name,
        command: s.command,
        args: [...s.args],
        env,
        // Phase 85 TOOL-01 — default to false for auto-injected servers
        // (clawcode/1password/browser/search/image) and for any entry where
        // the schema's default did not fire (e.g., string references to
        // top-level shared definitions that used the old shape). Explicitly
        // configured `optional: true` flows through unchanged.
        optional: s.optional === true,
        // Phase 100 follow-up — operator-curated annotations propagated so
        // the capability manifest can render "name (description — pattern)".
        // Both fields optional; undefined when YAML omitted them.
        ...(s.description ? { description: s.description } : {}),
        ...(s.accessPattern ? { accessPattern: s.accessPattern } : {}),
      });
    } catch (err) {
      if (!onMcpResolutionError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      onMcpResolutionError({ agent: agent.name, server: s.name, message });
    }
  }

  const resolvedWorkspace =
    agent.workspace ?? join(expandHome(defaults.basePath), agent.name);

  return {
    name: agent.name,
    workspace: resolvedWorkspace,
    // Phase 75 SHARED-01 — per-agent runtime state dir (memories.db, traces.db,
    // inbox/, heartbeat.log, memory/). Fallback to resolvedWorkspace for the 10
    // dedicated-workspace agents — zero behavior change. Expansion via
    // expandHome handles `~/...` and passes `./relative` + absolute paths
    // through unchanged. Only expand when explicitly set; the fallback path
    // inherits whatever resolvedWorkspace already is.
    memoryPath: agent.memoryPath ? expandHome(agent.memoryPath) : resolvedWorkspace,
    // Phase 78 CONF-01 — file-pointer SOUL/IDENTITY expansion. Conditional:
    // only expand when the raw field is set (otherwise leave undefined so
    // session-config.ts skips the soulFile branch in its precedence chain).
    soulFile: agent.soulFile ? expandHome(agent.soulFile) : undefined,
    identityFile: agent.identityFile ? expandHome(agent.identityFile) : undefined,
    channels: agent.channels,
    model: agent.model ?? defaults.model,
    effort: agent.effort ?? defaults.effort,
    // Phase 86 MODEL-01 — resolve per-agent allowlist against fleet-wide default.
    // `defaults.allowedModels` is always populated (z default factory), so
    // consumers always see a concrete array — no downstream optional-chain
    // needed. Discord picker + SessionManager allowlist guard read this.
    allowedModels: agent.allowedModels ?? defaults.allowedModels,
    // Phase 89 GREET-07 / GREET-10 — defaults.X is always populated (zod
    // default), so the falsy-free `??` fallback is safe.
    greetOnRestart: agent.greetOnRestart ?? defaults.greetOnRestart,
    greetCoolDownMs: agent.greetCoolDownMs ?? defaults.greetCoolDownMs,
    // Phase 96 D-05 — propagate per-agent fileAccess into ResolvedAgentConfig
    // so daemon IPC handler (probe-fs / list-fs-status) and downstream
    // consumers see the per-agent override. When the agent omits the field,
    // we leave it undefined; the daemon's resolveFileAccess(agent, cfg, defaults)
    // falls back to defaults.fileAccess (always populated by zod default).
    // Bug fix 2026-04-25: 96-01 added the schema field but never extended the
    // ResolvedAgentConfig type or this resolver, so per-agent fileAccess
    // never reached the daemon — only defaults.fileAccess was visible.
    fileAccess: agent.fileAccess,
    // Phase 96 D-09 — propagate per-agent outputDir template (LITERAL string,
    // tokens preserved). Runtime resolveOutputDir expands at write time.
    outputDir: agent.outputDir,
    // Phase 999.13 DELEG-02 — propagate per-agent delegates map verbatim
    // (configSchema.superRefine has already validated that every target
    // points to a known agent name). UNDEFINED when the agent omits the
    // field — back-compat with the existing 15-agent fleet.
    delegates: agent.delegates,
    // Phase 100 GSD-02 — default settingSources to ["project"] when omitted.
    // Pitfall 3 (.min(1)) prevents `[]` from reaching here, so a populated
    // array always has at least one source. Plan 02 reads this in
    // session-adapter.ts to replace the hardcoded `settingSources: ["project"]`.
    settingSources: agent.settingSources ?? ["project"],
    // Phase 100 GSD-04 — gsd.projectDir undefined → resolved gsd undefined;
    // gsd.projectDir set → expandHome() applied (handles ~/... paths). Plan
    // 02 reads `config.gsd?.projectDir ?? config.workspace` for the SDK cwd.
    gsd: agent.gsd?.projectDir
      ? { projectDir: expandHome(agent.gsd.projectDir) }
      : undefined,
    // Phase 100 follow-up — dream config propagation. Same root-cause
    // shape as the Phase 100 settingSources / gsd.projectDir and Phase
    // 96 fileAccess fixes: agentSchema parsed `dream` but the resolver
    // dropped it, so daemon.getResolvedDreamConfig saw `undefined` and
    // silently disabled auto-fire (and manual /clawcode-dream logged
    // "skipped — dream.enabled=false" even when the yaml had
    // enabled: true). Resolution: agent.dream wins when set, otherwise
    // fall back to defaults.dream (default-bearing zod schema, always
    // populated). Per-field merge handled by the schema parse layer
    // (defaults.dream has all three fields with zod defaults filled);
    // we just thread the resolved object through.
    dream: agent.dream ?? defaults.dream,
    // Phase 90 MEM-01 — agent-level memoryAutoLoad beats defaults.memoryAutoLoad;
    // undefined falls back to defaults (zod default = true). Cannot use `??`
    // here: `false ?? true` would (correctly) yield false, but `undefined ??
    // true` yields true — keep explicit check for readability and symmetry
    // with the greetOnRestart pattern above.
    memoryAutoLoad:
      agent.memoryAutoLoad !== undefined
        ? agent.memoryAutoLoad
        : defaults.memoryAutoLoad,
    // Phase 90 MEM-01 — memoryAutoLoadPath is NOT in defaults (per-agent only).
    // Expanded via expandHome when set (handles ~/... paths); undefined when
    // unset so session-config.ts falls back to `{workspace}/MEMORY.md`.
    memoryAutoLoadPath: agent.memoryAutoLoadPath
      ? expandHome(agent.memoryAutoLoadPath)
      : undefined,
    // Phase 90 MEM-03 — per-agent top-K beats defaults.memoryRetrievalTopK.
    // defaults.* is always populated (zod default 5), so `??` fallback is safe
    // since topK=0 would be invalid (positive int constraint).
    memoryRetrievalTopK:
      agent.memoryRetrievalTopK ?? defaults.memoryRetrievalTopK,
    // Phase 90 MEM-02 — scanner gate. Use explicit `!== undefined` check so
    // `memoryScannerEnabled: false` in an agent yaml wins over a true default
    // (mirrors memoryAutoLoad shape).
    memoryScannerEnabled:
      agent.memoryScannerEnabled !== undefined
        ? agent.memoryScannerEnabled
        : defaults.memoryScannerEnabled,
    // Phase 90 MEM-04 — per-agent flush cadence beats defaults. Both sides
    // are positive-int constrained by zod so `??` cannot smuggle a zero.
    memoryFlushIntervalMs:
      agent.memoryFlushIntervalMs ?? defaults.memoryFlushIntervalMs,
    // Phase 90 MEM-05 — per-agent cue emoji beats defaults.memoryCueEmoji
    // (zod-populated default "✅").
    memoryCueEmoji: agent.memoryCueEmoji ?? defaults.memoryCueEmoji,
    // Phase 100 follow-up — autoStart precedence:
    //   explicit agent.autoStart (true|false) wins over defaults.autoStart;
    //   defaults.autoStart is zod-defaulted to true, so the resolved value
    //   is always a concrete boolean (never undefined).
    // We use an explicit `!== undefined` check (NOT `??`) because the
    // operator can set `agent.autoStart: false` and that MUST beat
    // `defaults.autoStart: true` — `false ?? true` would (correctly) yield
    // false, but the explicit form mirrors the memoryAutoLoad / greetOnRestart
    // shape elsewhere in this resolver and reads more clearly.
    autoStart:
      agent.autoStart !== undefined ? agent.autoStart : defaults.autoStart,
    // Phase 999.25 — wakeOrder pass-through (no defaults.X fallback).
    // undefined → boot-last-in-yaml-order semantics handled by the sort
    // step in daemon.ts (`a.wakeOrder ?? Infinity`).
    wakeOrder: agent.wakeOrder,
    skills: agent.skills.length > 0 ? agent.skills : defaults.skills,
    soul: agent.soul,
    identity: agent.identity,
    memory: agent.memory ?? defaults.memory,
    skillsPath: expandHome(defaults.skillsPath),
    heartbeat: heartbeatConfig,
    schedules: agent.schedules,
    admin: agent.admin ?? false,
    subagentModel: agent.subagentModel,
    threads: agent.threads ?? defaults.threads,
    webhook: agent.webhook ?? undefined,
    reactions: agent.reactions ?? true,
    security: agent.security ?? undefined,
    escalationBudget: agent.escalationBudget ?? undefined,
    contextBudgets: agent.contextBudgets ?? undefined,
    mcpServers,
    // Phase 100 follow-up — propagate per-agent mcpEnvOverrides through to
    // the resolved config VERBATIM (op:// resolution is deferred to agent-
    // start in src/manager/op-env-resolver.ts so the daemon's `op read`
    // happens once, async, with the daemon's clawdbot token in scope).
    // Loader stays sync-pure — no shell-out here. Undefined when the agent
    // omitted the field; existing 15-agent fleet behavior unchanged.
    ...(agent.mcpEnvOverrides
      ? { mcpEnvOverrides: agent.mcpEnvOverrides }
      : {}),
    slashCommands: agent.slashCommands,
    perf: agent.perf ?? defaults.perf ?? undefined,
  };
}

/**
 * Resolve a content value that may be inline text or a file path.
 *
 * Resolution logic:
 * 1. If the value contains a newline, it's inline content -- return as-is
 * 2. If the value looks like a file path (starts with /, ./, ~/) and the file exists, read it
 * 3. Otherwise return as-is (treat as inline content)
 *
 * @param value - Inline content string or file path
 * @returns Resolved content string
 */
export async function resolveContent(value: string): Promise<string> {
  // Inline content: contains newlines
  if (value.includes("\n")) {
    return value;
  }

  // File path: starts with /, ./, or ~/
  if (/^[.~\/]/.test(value)) {
    const expandedPath = expandHome(value);
    if (await fileExists(expandedPath)) {
      return readFile(expandedPath, "utf-8");
    }
  }

  // Default: treat as inline content
  return value;
}

/**
 * Resolve all agents in a config by merging with defaults.
 *
 * @param config - Validated config object
 * @param opRefResolver - Optional 1Password `op://` resolver. When set,
 *   every MCP server env value of the form `op://...` is substituted
 *   before being returned. Daemon boot MUST pass `defaultOpRefResolver`
 *   so MCP children receive resolved secrets; omitting it keeps the
 *   existing passthrough behavior used by tests and offline tooling.
 * @returns Array of fully resolved agent configs
 */
export function resolveAllAgents(
  config: Config,
  opRefResolver?: OpRefResolver,
  onMcpResolutionError?: McpResolutionErrorHandler,
): ResolvedAgentConfig[] {
  const sharedMcpServers = config.mcpServers ?? {};
  return config.agents.map((agent) =>
    resolveAgentConfig(
      agent,
      config.defaults,
      sharedMcpServers,
      opRefResolver,
      onMcpResolutionError,
    ),
  );
}

/**
 * Phase 88 MKT-02 + Phase 90 Plan 04 HUB-01 — expand
 * `defaults.marketplaceSources` into a discriminated union of
 * `ResolvedMarketplaceSource` entries. Pure helper: caller controls when
 * to invoke (typically once per daemon boot, or lazily in the
 * /clawcode-skills-browse handler). Missing / undefined field yields `[]`;
 * explicit `[]` yields `[]`.
 *
 * Legacy entries (path-based, v2.2 shape) get `kind: "legacy"` with `~/...`
 * paths expanded via `expandHome`. ClawHub entries (Phase 90) pass through
 * as `kind: "clawhub"` with baseUrl/authToken/cacheTtlMs verbatim — no
 * filesystem expansion needed (the path portion is a URL, not a home-
 * relative path).
 */
export function resolveMarketplaceSources(
  config: Config,
): ResolvedMarketplaceSources {
  const raw = config.defaults.marketplaceSources;
  if (!raw || raw.length === 0) return [];
  return raw.map((src): ResolvedMarketplaceSource => {
    // Discriminate on presence of `kind` — the legacy variant omits the
    // discriminator (v2.2 shape is backward-compatible by design).
    if ("kind" in src && src.kind === "clawhub") {
      const clawhub: ResolvedMarketplaceSource = {
        kind: "clawhub",
        baseUrl: src.baseUrl,
        ...(src.authToken !== undefined ? { authToken: src.authToken } : {}),
        ...(src.cacheTtlMs !== undefined ? { cacheTtlMs: src.cacheTtlMs } : {}),
      };
      return Object.freeze(clawhub);
    }
    // Legacy branch — v2.2-compatible path entry. Cast-narrow via a
    // positive type check because the zod union omits the discriminator
    // on the legacy variant; `!("kind" in src)` is semantically correct
    // but TS narrowing on "absent key" is weaker than on present key.
    const legacyRaw = src as { path: string; label?: string };
    const legacy: ResolvedMarketplaceSource =
      legacyRaw.label !== undefined
        ? { kind: "legacy", path: expandHome(legacyRaw.path), label: legacyRaw.label }
        : { kind: "legacy", path: expandHome(legacyRaw.path) };
    return Object.freeze(legacy);
  });
}

/**
 * Resolve ${VAR_NAME} patterns in a string against process.env.
 * Unresolvable vars become empty string (no throw).
 *
 * @param value - String potentially containing ${VAR_NAME} patterns
 * @returns String with all ${...} patterns replaced by env values
 */
export function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, varName: string) => {
    return process.env[varName] ?? "";
  });
}

/**
 * Resolve an MCP server env value through both `${VAR}` interpolation and
 * `op://vault/item/field` 1Password reference substitution.
 *
 * Order matters: `${VAR}` expansion runs first so a value like
 * `${SECRET_REF}` can expand to `op://...` and then get resolved. If the
 * resulting string starts with `op://` and an `opRefResolver` is provided,
 * the resolver is invoked and its return value replaces the string. When
 * no resolver is provided, `op://` values pass through unchanged (matches
 * the legacy behavior before the resolver was added — keeps tests and
 * offline tools working without a live 1Password CLI).
 *
 * Resolution errors are wrapped with context (server name + var name) so
 * operators can tell which env entry failed. The underlying resolver's
 * message is preserved in the wrapped error's `cause`.
 */
export function resolveMcpEnvValue(
  raw: string,
  opRefResolver: OpRefResolver | undefined,
  ctx: { readonly serverName: string; readonly varName: string },
): string {
  const interpolated = resolveEnvVars(raw);
  if (!opRefResolver || !isOpRef(interpolated)) {
    return interpolated;
  }
  try {
    return opRefResolver(interpolated);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to resolve 1Password reference for mcpServers.${ctx.serverName}.env.${ctx.varName} (${interpolated}): ${message}`,
      { cause: err instanceof Error ? err : undefined },
    );
  }
}

/**
 * Phase 94 TOOL-10 / D-10 — resolved directive shape.
 *
 * Carries only what the prompt assembler needs: the directive's stable key
 * (used for ordering + downstream telemetry) and its verbatim text. The
 * `enabled` flag is folded into filtering — disabled directives are
 * dropped from the resolver output entirely so consumers never see them.
 */
export interface ResolvedDirective {
  readonly key: string;
  readonly text: string;
}

/**
 * Phase 94 TOOL-10 / D-10 — per-key merge of agent override over fleet
 * defaults, returning the enabled directives in deterministic order.
 *
 * Pure function — no I/O, no clock, no SDK. Safe to call per-turn from
 * the prompt assembler. Returns a frozen array of frozen objects so
 * downstream code can't mutate either the list or its entries
 * (CLAUDE.md immutability invariant).
 *
 * Merge logic:
 *   for each key in {keys(defaults) ∪ keys(agentOverride)}:
 *     enabled = override?.enabled ?? defaults?.enabled ?? false
 *     text    = override?.text    ?? defaults?.text    ?? ""
 *     keep iff enabled && text !== ""
 *   sort by key (alphabetical) for prompt-cache hash stability.
 *
 * Per-key merge means an operator can disable the file-sharing directive
 * for one agent without dropping the cross-agent-routing directive — the
 * unspecified default flows through. This is the contract pinned by
 * REG-OVERRIDE-PARTIAL.
 */
export function resolveSystemPromptDirectives(
  agentOverride:
    | Record<string, { enabled?: boolean; text?: string }>
    | undefined,
  defaults: Record<string, SystemPromptDirective>,
): readonly ResolvedDirective[] {
  const keys = new Set<string>([
    ...Object.keys(defaults),
    ...Object.keys(agentOverride ?? {}),
  ]);

  const merged: { key: string; text: string }[] = [];
  for (const key of keys) {
    const d = defaults[key];
    const o = agentOverride?.[key];
    const enabled = o?.enabled ?? d?.enabled ?? false;
    const text = o?.text ?? d?.text ?? "";
    if (enabled && text !== "") {
      merged.push({ key, text });
    }
  }

  // Deterministic alphabetical order — required for prompt-cache hash
  // stability. Same input must produce byte-identical output across
  // processes (REG-DETERMINISTIC).
  merged.sort((a, b) => a.key.localeCompare(b.key));

  return Object.freeze(
    merged.map((m) => Object.freeze({ key: m.key, text: m.text })),
  );
}

/**
 * Phase 94 TOOL-10 — render the resolved directive list into the verbatim
 * text block prepended to the assembler's stable prefix.
 *
 * Returns "" when no directives are enabled (REG-ASSEMBLER-EMPTY-WHEN-
 * DISABLED — operators who opt out of every default see a clean stable
 * prefix WITHOUT marker comments, deterministic for prompt-cache hash).
 *
 * Block format: directive texts joined by "\n\n" (one blank line between
 * adjacent directives). No XML wrappers, no marker headings — the LLM
 * sees plain operator instructions at the start of its context.
 */
export function renderSystemPromptDirectiveBlock(
  directives: readonly ResolvedDirective[],
): string {
  if (directives.length === 0) return "";
  return directives.map((d) => d.text).join("\n\n");
}

/**
 * Phase 999.13 DELEG-02 — canonical text constants for the per-agent
 * "Specialist Delegation" directive. Constants live here (next to the
 * Phase 94 directive renderer) so static-grep regression tests pin the
 * verbatim wording against silent drift.
 *
 * Block format when rendered (single specialty example):
 *   ## Specialist Delegation
 *   For tasks matching a specialty below, delegate via the spawn-subagent-thread skill:
 *   - research → fin-research
 *   Verify the target is at opus/high before delegating; if mismatch, surface to operator and stop. The subthread posts its summary back to your channel when done.
 *
 * NEVER paraphrase. The Wave 0 RED test `delegates-canonical-text` pins
 * these constants byte-exactly.
 */
export const DELEGATES_DIRECTIVE_HEADER =
  "## Specialist Delegation\nFor tasks matching a specialty below, delegate via the spawn-subagent-thread skill:";
export const DELEGATES_DIRECTIVE_FOOTER =
  "Verify the target is at opus/high before delegating; if mismatch, surface to operator and stop. The subthread posts its summary back to your channel when done.";

/**
 * Phase 999.13 DELEG-02 / DELEG-04 — render the per-agent specialty →
 * target-agent map into the canonical "## Specialist Delegation" block
 * appended at the END of the assembler's stable prefix.
 *
 * Returns "" when delegates is undefined OR `{}` — empty short-circuits
 * with NO header, NO whitespace pollution. This is critical for prompt-
 * cache hash stability: agents without delegates render byte-identically
 * to the no-delegates baseline (CA-FS-2 / REG-DETERMINISTIC analog).
 *
 * Specialty keys are sorted alphabetically — required for prompt-cache
 * hash stability across daemon boots (Object.keys insertion order is not
 * spec-guaranteed for non-integer keys; explicit sort matches the
 * `resolveSystemPromptDirectives` pattern at line 653).
 */
export function renderDelegatesBlock(
  delegates: Readonly<Record<string, string>> | undefined,
): string {
  if (!delegates) return "";
  const keys = Object.keys(delegates);
  if (keys.length === 0) return "";
  // Alphabetical sort — required for prompt-cache hash stability (REG-DETERMINISTIC).
  keys.sort();
  const lines = keys.map((k) => `- ${k} → ${delegates[k]}`);
  return [
    DELEGATES_DIRECTIVE_HEADER,
    ...lines,
    DELEGATES_DIRECTIVE_FOOTER,
  ].join("\n");
}

/**
 * Phase 96 D-05 — resolve fileAccess paths for an agent.
 *
 * Merges defaults + per-agent override (additive — agent paths APPEND to
 * defaults), expands the literal `{agent}` token to the actual agent name,
 * canonicalizes via path.resolve (collapses `..`, no leading relative),
 * and deduplicates.
 *
 * NOTE: this helper does NOT perform fs.realpath (no I/O at this layer).
 * The runFsProbe primitive (src/manager/fs-probe.ts) handles realpath at
 * probe time; resolveFileAccess only handles syntactic canonicalization.
 *
 * @param agentName    Concrete agent name (substituted into `{agent}` token)
 * @param agentCfg     Per-agent override (may omit `fileAccess`)
 * @param defaultsCfg  Fleet-wide default (always populated by zod default)
 * @returns Deduplicated readonly array of canonical absPaths
 */
export function resolveFileAccess(
  agentName: string,
  agentCfg: { readonly fileAccess?: readonly string[] } | undefined,
  defaultsCfg: { readonly fileAccess?: readonly string[] } | undefined,
): readonly string[] {
  const merged = [
    ...(defaultsCfg?.fileAccess ?? []),
    ...(agentCfg?.fileAccess ?? []),
  ];
  const expanded = merged.map((p) => p.replace(/\{agent\}/g, agentName));
  const canonical = expanded.map((p) => pathResolve(p));
  return Array.from(new Set(canonical));
}

/**
 * Phase 96 D-09 — resolve outputDir template for an agent.
 *
 * Returns the LITERAL template string (per-agent override beats defaults;
 * else fallback to 'outputs/{date}/'). Loader does NOT expand tokens —
 * runtime resolveOutputDir(template, ctx, deps) expands at write time
 * with fresh per-call ctx. Loader-time expansion would freeze {date} at
 * config-load time (wrong on the second day) and would pin {client_slug}
 * to the load-time value (wrong across multiple client conversations).
 *
 * Distinct from src/manager/resolve-output-dir.ts:resolveOutputDir — this
 * loader helper just merges templates; the runtime helper expands them.
 *
 * @param _agentName   Agent name (currently unused — reserved for future
 *                     {agent}-token expansion if needed at loader layer)
 * @param agentCfg     Per-agent override (may omit `outputDir`)
 * @param defaultsCfg  Fleet-wide default (always populated by zod default)
 * @returns The merged outputDir template string (tokens preserved verbatim)
 */
export function resolveOutputDirTemplate(
  _agentName: string,
  agentCfg: { readonly outputDir?: string } | undefined,
  defaultsCfg: { readonly outputDir?: string } | undefined,
): string {
  return agentCfg?.outputDir ?? defaultsCfg?.outputDir ?? "outputs/{date}/";
}

/**
 * Check if a file exists at the given path.
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
