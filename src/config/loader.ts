import { execSync } from "node:child_process";
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { configSchema } from "./schema.js";
import { expandHome } from "./defaults.js";
import { ConfigFileNotFoundError, ConfigValidationError } from "../shared/errors.js";
import type { Config, AgentConfig, DefaultsConfig, McpServerSchemaConfig } from "./schema.js";
import type {
  ResolvedAgentConfig,
  ResolvedMarketplaceSources,
} from "../shared/types.js";

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
): ResolvedAgentConfig {
  // Resolve heartbeat: if agent has heartbeat: false, disable but keep global config values
  const heartbeatConfig = agent.heartbeat === false
    ? { ...defaults.heartbeat, enabled: false }
    : defaults.heartbeat;

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
  if (!resolvedMcpMap.has("1password") && process.env.OP_SERVICE_ACCOUNT_TOKEN) {
    resolvedMcpMap.set("1password", {
      name: "1password",
      command: "npx",
      args: ["-y", "@takescake/1password-mcp@latest"],
      env: { OP_SERVICE_ACCOUNT_TOKEN: process.env.OP_SERVICE_ACCOUNT_TOKEN },
      // Phase 85 TOOL-01 — 1Password MCP is mandatory when auto-injected.
      optional: false,
    });
  }

  // Phase 70 — auto-inject the browser MCP server so every agent gets
  // browser_navigate, browser_screenshot, browser_click, browser_fill,
  // browser_extract, browser_wait_for. The subprocess pattern mirrors the
  // `clawcode` entry: the daemon owns the singleton Chromium and this
  // subprocess is a thin IPC translator. Gated by defaults.browser.enabled
  // (default true). CLAWCODE_AGENT env is consumed by the subprocess as
  // the default agent identity for tool calls (src/browser/mcp-server.ts).
  const browserEnabled = defaults.browser?.enabled !== false;
  if (browserEnabled && !resolvedMcpMap.has("browser")) {
    resolvedMcpMap.set("browser", {
      name: "browser",
      command: "clawcode",
      args: ["browser-mcp"],
      env: { CLAWCODE_AGENT: agent.name },
      // Phase 85 TOOL-01 — browser MCP is mandatory when auto-injected.
      optional: false,
    });
  }

  // Phase 71 — auto-inject the search MCP server so every agent gets
  // web_search + web_fetch_url. The daemon owns the BraveClient/ExaClient
  // singletons; this subprocess is a thin IPC translator. Gated by
  // defaults.search.enabled (default true). CLAWCODE_AGENT env is consumed
  // by the subprocess as the default agent identity for tool calls
  // (src/search/mcp-server.ts).
  const searchEnabled = defaults.search?.enabled !== false;
  if (searchEnabled && !resolvedMcpMap.has("search")) {
    resolvedMcpMap.set("search", {
      name: "search",
      command: "clawcode",
      args: ["search-mcp"],
      env: { CLAWCODE_AGENT: agent.name },
      // Phase 85 TOOL-01 — search MCP is mandatory when auto-injected.
      optional: false,
    });
  }

  // Phase 72 — auto-inject the image MCP server so every agent gets
  // image_generate + image_edit + image_variations. The daemon owns the
  // OpenAI/MiniMax/fal provider clients; this subprocess is a thin IPC
  // translator. Gated by defaults.image.enabled (default true).
  // CLAWCODE_AGENT env is consumed by the subprocess as the default
  // agent identity for tool calls (src/image/mcp-server.ts).
  const imageEnabled = defaults.image?.enabled !== false;
  if (imageEnabled && !resolvedMcpMap.has("image")) {
    resolvedMcpMap.set("image", {
      name: "image",
      command: "clawcode",
      args: ["image-mcp"],
      env: { CLAWCODE_AGENT: agent.name },
      // Phase 85 TOOL-01 — image MCP is mandatory when auto-injected.
      optional: false,
    });
  }

  const mcpServers = [...resolvedMcpMap.values()].map((s) => ({
    name: s.name,
    command: s.command,
    args: [...s.args],
    env: Object.fromEntries(
      Object.entries(s.env ?? {}).map(([k, v]) => [
        k,
        // Two-stage env resolution: (1) `${VAR}` interpolation against
        // process.env — supports things like `${OPENAI_API_KEY}` used for
        // non-secret passthrough; (2) `op://vault/item/field` resolution
        // via the injected 1Password resolver. The passthrough branch
        // keeps existing tests + offline flows working without a live op
        // CLI; daemon boot wires `defaultOpRefResolver` so real agents
        // get real secrets instead of a literal op://... string crashing
        // the MCP child at DNS-lookup time.
        resolveMcpEnvValue(v, opRefResolver, { serverName: s.name, varName: k }),
      ]),
    ),
    // Phase 85 TOOL-01 — default to false for auto-injected servers
    // (clawcode/1password/browser/search/image) and for any entry where
    // the schema's default did not fire (e.g., string references to
    // top-level shared definitions that used the old shape). Explicitly
    // configured `optional: true` flows through unchanged.
    optional: s.optional === true,
  }));

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
): ResolvedAgentConfig[] {
  const sharedMcpServers = config.mcpServers ?? {};
  return config.agents.map((agent) =>
    resolveAgentConfig(agent, config.defaults, sharedMcpServers, opRefResolver),
  );
}

/**
 * Phase 88 MKT-02 — expand `defaults.marketplaceSources` into absolute
 * filesystem paths. Pure helper: caller controls when to invoke (typically
 * once per daemon boot, or lazily in the Plan 02 /clawcode-skills-browse
 * handler). Missing / undefined field yields `[]`; explicit `[]` yields
 * `[]`. `~/...` entries are expanded via the existing `expandHome` pattern
 * used for basePath/skillsPath. Keeps `ResolvedAgentConfig` shape unchanged
 * (no per-agent cardinality bloat for a fleet-wide list).
 */
export function resolveMarketplaceSources(
  config: Config,
): ResolvedMarketplaceSources {
  const raw = config.defaults.marketplaceSources;
  if (!raw || raw.length === 0) return [];
  return raw.map((src) =>
    Object.freeze(
      src.label !== undefined
        ? { path: expandHome(src.path), label: src.label }
        : { path: expandHome(src.path) },
    ),
  );
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
