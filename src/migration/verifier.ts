/**
 * Phase 81 MIGR-04 — post-migration per-agent verifier.
 *
 * Four checks in fixed order:
 *   (a) workspace-files-present — existsSync on SOUL/IDENTITY/MEMORY/CLAUDE/
 *       USER/TOOLS at the resolved target paths. File-presence only, not
 *       content hash (content is out-of-scope for verify — covered by
 *       Phase 79 workspace-copier's hash witness at apply time).
 *   (b) memory-count — re-discover SOURCE markdown via discoverWorkspaceMarkdown
 *       (Phase 80), compare to SELECT COUNT(*) FROM memories WHERE origin_id
 *       LIKE 'openclaw:<agent>:%' against the target memories.db. Pass if
 *       abs(migrated-source)/max(source,1) <= 0.05.
 *   (c) discord-reachable — global fetch GET https://discord.com/api/v9/
 *       channels/<id> with Authorization: Bot <token>. 200 → pass, any other
 *       status → fail. Missing CLAWCODE_DISCORD_TOKEN → skip. CLAWCODE_VERIFY
 *       _OFFLINE (passed as `offline: true`) → skip.
 *   (d) daemon-parse — loadConfig(clawcodeConfigPath) + resolveAllAgents →
 *       assert agent name appears in the resolved array. No daemon process
 *       touched. A loadConfig throw is caught once and surfaced as fail in
 *       (d); checks (a)+(b) still produce deterministic fail results because
 *       resolvedAgent is undefined.
 *
 * Pure module: returns VerifyCheckResult[]. The caller (Plan 02 CLI) maps
 * results to exit code + ledger rows. verifier.ts does NOT write the ledger,
 * call process.exit, or touch the filesystem outside the checks themselves.
 *
 * DO NOT:
 *   - Add new npm deps. Uses global fetch (Node 22), node:fs existsSync,
 *     and the existing MemoryStore / discoverWorkspaceMarkdown / loadConfig.
 *   - Use execa / child_process — no subprocess work.
 *   - Construct an EmbeddingService. Memory-count uses SELECT COUNT(*)
 *     only; re-embedding is apply-time concern (Phase 80).
 *   - Hardcode the FINMENTUM_FAMILY_IDS list — verifier reads resolved
 *     config paths directly; family detection is not needed at this layer.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveAllAgents } from "../config/loader.js";
import { discoverWorkspaceMarkdown } from "./memory-translator.js";
import { MemoryStore } from "../memory/store.js";
import type { ResolvedAgentConfig } from "../shared/types.js";

/**
 * Mutable fetch-dispatch holder — the ESM-safe test monkey-patch pattern.
 * Tests assign `verifierFetch.fetch = <mock>` to intercept Discord calls
 * without vi.spyOn against frozen globals. Bound once so the mock captures
 * the same `this` the real fetch expects.
 */
export const verifierFetch: { fetch: typeof fetch } = {
  fetch: globalThis.fetch.bind(globalThis),
};

export type VerifyCheckName =
  | "workspace-files-present"
  | "memory-count"
  | "discord-reachable"
  | "daemon-parse";

export type VerifyStatus = "pass" | "fail" | "skip";

export type VerifyCheckResult = Readonly<{
  check: VerifyCheckName;
  status: VerifyStatus;
  detail: string;
}>;

/**
 * The six files every migrated agent workspace must expose. Literal array —
 * load-bearing grep contract per 81-CONTEXT decision (a).
 */
export const REQUIRED_WORKSPACE_FILES = Object.freeze([
  "SOUL.md",
  "IDENTITY.md",
  "MEMORY.md",
  "CLAUDE.md",
  "USER.md",
  "TOOLS.md",
] as const);

/**
 * Discord REST endpoint literal — grep-verifiable contract. Do NOT
 * interpolate pieces of the URL from env vars or config; any substitution
 * other than the trailing {channelId} breaks the test pinning it.
 */
export const DISCORD_CHANNEL_URL_PREFIX =
  "https://discord.com/api/v9/channels/";

export type VerifyAgentArgs = Readonly<{
  agentName: string;
  clawcodeConfigPath: string;
  openclawRoot: string;        // source root — ~/.openclaw (read-only)
  openclawMemoryDir: string;   // source memory dir — ~/.openclaw/memory
  discordToken?: string;       // from CLAWCODE_DISCORD_TOKEN (caller reads env)
  offline?: boolean;           // from CLAWCODE_VERIFY_OFFLINE (caller reads env)
}>;

/**
 * Run the four verification checks for a single migrated agent. Returns a
 * frozen array of results in fixed order. Never throws — any unexpected
 * error surfaces as a check-level fail with the error message in `detail`.
 */
export async function verifyAgent(
  args: VerifyAgentArgs,
): Promise<readonly VerifyCheckResult[]> {
  // Resolve the agent config ONCE — checks (a), (b), (d) all need it. A
  // loadConfig throw is captured and surfaced as a deterministic fail in
  // each dependent check; never propagates.
  let resolvedAgent: ResolvedAgentConfig | undefined;
  let loadConfigError: Error | undefined;
  try {
    const cfg = await loadConfig(args.clawcodeConfigPath);
    const resolved = resolveAllAgents(cfg);
    resolvedAgent = resolved.find((a) => a.name === args.agentName);
  } catch (err) {
    loadConfigError = err instanceof Error ? err : new Error(String(err));
  }

  const results: VerifyCheckResult[] = [];

  // (a) workspace-files-present
  results.push(
    checkWorkspaceFiles(args.agentName, resolvedAgent, loadConfigError),
  );

  // (b) memory-count ±5%
  results.push(await checkMemoryCount(args, resolvedAgent, loadConfigError));

  // (c) discord-reachable
  results.push(await checkDiscordReachable(args, resolvedAgent));

  // (d) daemon-parse
  results.push(
    buildDaemonParseResult(args.agentName, resolvedAgent, loadConfigError),
  );

  return Object.freeze(results);
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

function checkWorkspaceFiles(
  agentName: string,
  resolved: ResolvedAgentConfig | undefined,
  loadConfigError: Error | undefined,
): VerifyCheckResult {
  if (!resolved) {
    return Object.freeze({
      check: "workspace-files-present" as const,
      status: "fail" as const,
      detail: loadConfigError
        ? `cannot resolve agent ${agentName}: ${loadConfigError.message}`
        : `agent ${agentName} not in clawcode.yaml`,
    });
  }
  const missing: string[] = [];
  for (const f of REQUIRED_WORKSPACE_FILES) {
    // SOUL / IDENTITY may be file-ref paths OUTSIDE the workspace (Phase 78
    // CONF-01 file-ref schema). Prefer the explicit fields; fall back to
    // <workspace>/<filename> for inline agents.
    let path: string;
    if (f === "SOUL.md" && resolved.soulFile) path = resolved.soulFile;
    else if (f === "IDENTITY.md" && resolved.identityFile)
      path = resolved.identityFile;
    else path = join(resolved.workspace, f);
    if (!existsSync(path)) missing.push(f);
  }
  if (missing.length === 0) {
    return Object.freeze({
      check: "workspace-files-present" as const,
      status: "pass" as const,
      detail: `all ${REQUIRED_WORKSPACE_FILES.length} files present`,
    });
  }
  return Object.freeze({
    check: "workspace-files-present" as const,
    status: "fail" as const,
    detail: `missing: ${missing.join(", ")}`,
  });
}

async function checkMemoryCount(
  args: VerifyAgentArgs,
  resolved: ResolvedAgentConfig | undefined,
  loadConfigError: Error | undefined,
): Promise<VerifyCheckResult> {
  if (!resolved) {
    return Object.freeze({
      check: "memory-count" as const,
      status: "fail" as const,
      detail: loadConfigError
        ? `cannot resolve agent: ${loadConfigError.message}`
        : `agent ${args.agentName} not in clawcode.yaml`,
    });
  }
  // SOURCE count via re-discovery against ~/.openclaw/workspace-<agent>/.
  // Read-only — discoverWorkspaceMarkdown only issues fs.readFile / readdir.
  const sourceWorkspace = join(
    args.openclawRoot,
    `workspace-${args.agentName}`,
  );
  let sourceCount = 0;
  if (existsSync(sourceWorkspace)) {
    const discovered = await discoverWorkspaceMarkdown(
      sourceWorkspace,
      args.agentName,
    );
    sourceCount = discovered.length;
  }
  // MIGRATED count via target memories.db. memoryPath resolves to the
  // per-agent memory dir for finmentum-shared agents (Phase 75) and to the
  // workspace itself for dedicated agents.
  const dbPath = join(resolved.memoryPath, "memory", "memories.db");
  if (!existsSync(dbPath)) {
    return Object.freeze({
      check: "memory-count" as const,
      status: "fail" as const,
      detail: `memories.db not found at ${dbPath} (source=${sourceCount})`,
    });
  }
  let migratedCount = 0;
  const store = new MemoryStore(dbPath);
  try {
    const db = store.getDatabase();
    const row = db
      .prepare(
        "SELECT COUNT(*) AS c FROM memories WHERE origin_id LIKE ?",
      )
      .get(`openclaw:${args.agentName}:%`) as { c: number } | undefined;
    migratedCount = row?.c ?? 0;
  } finally {
    store.close();
  }
  const drift =
    Math.abs(migratedCount - sourceCount) / Math.max(sourceCount, 1);
  const status = drift <= 0.05 ? ("pass" as const) : ("fail" as const);
  return Object.freeze({
    check: "memory-count" as const,
    status,
    detail: `source=${sourceCount} migrated=${migratedCount} drift=${(drift * 100).toFixed(1)}%`,
  });
}

async function checkDiscordReachable(
  args: VerifyAgentArgs,
  resolved: ResolvedAgentConfig | undefined,
): Promise<VerifyCheckResult> {
  if (args.offline) {
    return Object.freeze({
      check: "discord-reachable" as const,
      status: "skip" as const,
      detail: "offline mode (CLAWCODE_VERIFY_OFFLINE=true)",
    });
  }
  if (!args.discordToken) {
    return Object.freeze({
      check: "discord-reachable" as const,
      status: "skip" as const,
      detail: "CLAWCODE_DISCORD_TOKEN absent",
    });
  }
  if (!resolved || resolved.channels.length === 0) {
    return Object.freeze({
      check: "discord-reachable" as const,
      status: "fail" as const,
      detail: "no channels configured for agent",
    });
  }
  const details: string[] = [];
  for (const channelId of resolved.channels) {
    const url = `${DISCORD_CHANNEL_URL_PREFIX}${channelId}`;
    try {
      const res = await verifierFetch.fetch(url, {
        headers: { Authorization: `Bot ${args.discordToken}` },
      });
      if (res.ok) {
        return Object.freeze({
          check: "discord-reachable" as const,
          status: "pass" as const,
          detail: `channel ${channelId} reachable (200)`,
        });
      }
      details.push(`${channelId}=${res.status}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      details.push(`${channelId}=network:${msg}`);
    }
  }
  return Object.freeze({
    check: "discord-reachable" as const,
    status: "fail" as const,
    detail: details.join(", "),
  });
}

function buildDaemonParseResult(
  agentName: string,
  resolved: ResolvedAgentConfig | undefined,
  loadConfigError: Error | undefined,
): VerifyCheckResult {
  if (loadConfigError) {
    return Object.freeze({
      check: "daemon-parse" as const,
      status: "fail" as const,
      detail: `loadConfig threw: ${loadConfigError.message}`,
    });
  }
  if (!resolved) {
    return Object.freeze({
      check: "daemon-parse" as const,
      status: "fail" as const,
      detail: `agent ${agentName} not in resolveAllAgents output`,
    });
  }
  return Object.freeze({
    check: "daemon-parse" as const,
    status: "pass" as const,
    detail: `resolved as ${resolved.name} (model=${resolved.model})`,
  });
}

/**
 * Pure helper — maps a verify-result array to a process exit code.
 *   0 if no 'fail' entries; 1 if any 'fail' entry. 'skip' does not fail.
 * Used by Plan 02's CLI; kept here so unit tests can pin the semantics.
 */
export function computeVerifyExitCode(
  results: readonly VerifyCheckResult[],
): 0 | 1 {
  for (const r of results) {
    if (r.status === "fail") return 1;
  }
  return 0;
}
