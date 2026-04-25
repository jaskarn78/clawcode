import { execSync } from "node:child_process";
import { readFile, access } from "node:fs/promises";
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
    if (typeof h === "object" && h !== null && "enabled" in h && h.enabled === false) {
      return { ...defaults.heartbeat, enabled: false };
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
  const mcpServers: ResolvedAgentConfig["mcpServers"] = [];
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
