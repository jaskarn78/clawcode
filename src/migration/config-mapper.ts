/**
 * Phase 78 CONF-01 / CONF-02 / CONF-03 — pure-function agent config
 * mapper. Takes one OpenclawSourceEntry + mapping context, produces a
 * target MappedAgentNode ready for YAML serialization (Plan 03) plus a
 * structured warnings array.
 *
 * This module does ZERO I/O. No fs reads, no yaml writes, no subprocess
 * spawns. The sole consumer is the Plan 03 yaml-writer, which converts
 * MappedAgentNode arrays into Document AST nodes.
 *
 * DO NOT:
 *   - Parse YAML here — that's the writer's job.
 *   - Call expandHome on target paths — they are ALREADY absolute
 *     (coming from getTargetBasePath + getTargetMemoryPath, which are
 *     injected by the caller via Phase 76 diff-builder).
 *   - Inject `browser` / `search` / `image` MCP refs — those are
 *     auto-injected at RUNTIME by loader.ts. The YAML needs only
 *     `clawcode` + `1password`.
 */
import { join } from "node:path";
import type { OpenclawSourceEntry } from "./openclaw-config-reader.js";
import { mapModel } from "./model-map.js";

export type MappedAgentNode = {
  readonly name: string;
  readonly workspace: string;
  readonly memoryPath?: string;
  readonly soulFile: string;
  readonly identityFile: string;
  readonly model: string;
  readonly channels: readonly string[];
  readonly mcpServers: readonly string[];
};

export type MapAgentWarning =
  | { readonly kind: "unmappable-model"; readonly id: string; readonly agent: string }
  | { readonly kind: "unknown-mcp-server"; readonly name: string; readonly agent: string };

export type MapAgentResult = {
  readonly node: MappedAgentNode;
  readonly warnings: readonly MapAgentWarning[];
};

/**
 * EMPTY per 82.2 gap closure — `clawcode` (memory_lookup, spawn_subagent_thread,
 * send_message, browser/search/image MCPs) and `1password` are DAEMON-INJECTED
 * at runtime, not user-declared in clawcode.yaml. Writing them into an agent's
 * mcpServers list (as string refs) breaks `loadConfig` because those names
 * don't exist in the top-level `mcpServers:` map. The daemon attaches these
 * tools to every agent regardless of YAML content.
 *
 * Order is stable for byte-deterministic plan hashing.
 */
const AUTO_INJECT_MCP: readonly string[] = Object.freeze([]);

export function mapAgent(args: {
  readonly source: OpenclawSourceEntry;
  readonly targetBasePath: string;
  readonly targetMemoryPath: string;
  readonly modelMap: Readonly<Record<string, string>>;
  readonly existingTopLevelMcp: ReadonlySet<string>;
  readonly perAgentMcpNames: readonly string[];
}): MapAgentResult {
  const warnings: MapAgentWarning[] = [];

  // Model mapping — mapped may be undefined for unknown ids. We use only
  // the `mapped` field here; the literal warning copy is assembled at the
  // CLI/writer layer (which already knows the PlanReport shape). This
  // keeps the mapper decoupled from the warning-string format — the CLI
  // owns that copy, we emit structured data.
  const { mapped } = mapModel(args.source.model.primary, args.modelMap);
  if (mapped === undefined) {
    warnings.push({
      kind: "unmappable-model",
      id: args.source.model.primary,
      agent: args.source.id,
    });
  }

  // workspace / memoryPath — finmentum agents have distinct memoryPath
  // under the shared basePath; dedicated agents omit memoryPath entirely
  // (schema fallback inherits workspace).
  const isFinmentum = args.source.isFinmentumFamily;
  const memoryPath = isFinmentum ? args.targetMemoryPath : undefined;

  // soulFile / identityFile — for shared-basePath agents (finmentum
  // family) these live at the SHARED basePath root: workspace-copier
  // places SOUL.md / IDENTITY.md at <root>/finmentum/ (shared across all
  // 5 family members per 82.1 gap closure — YAML pointer must agree
  // with on-disk location or `verify` reports the files as missing).
  // Dedicated agents use targetMemoryPath, which callers set to
  // targetBasePath anyway — behavior unchanged (regression-pinned in
  // config-mapper.test.ts). Absolute paths, no ~-expansion needed
  // (caller's getTargetBasePath already resolved basePath absolutely).
  const soulBase = isFinmentum ? args.targetBasePath : args.targetMemoryPath;
  const soulFile = join(soulBase, "SOUL.md");
  const identityFile = join(soulBase, "IDENTITY.md");

  // mcpServers — auto-inject AUTO_INJECT_MCP first, then per-agent names.
  // Dedup while preserving insertion order. Unknown per-agent names emit
  // an 'unknown-mcp-server' warning and are skipped.
  const seen = new Set<string>();
  const mcpServers: string[] = [];
  for (const name of AUTO_INJECT_MCP) {
    if (!seen.has(name)) {
      seen.add(name);
      mcpServers.push(name);
    }
  }
  for (const name of args.perAgentMcpNames) {
    if (seen.has(name)) continue;
    if (AUTO_INJECT_MCP.includes(name)) {
      // Explicit user request for clawcode / 1password — dedup path, not an error.
      continue;
    }
    if (!args.existingTopLevelMcp.has(name)) {
      warnings.push({
        kind: "unknown-mcp-server",
        name,
        agent: args.source.id,
      });
      continue;
    }
    seen.add(name);
    mcpServers.push(name);
  }

  // channels — single Discord channel per source agent (from binding
  // join). Empty array when no binding (surfaces as 'missing-discord-
  // binding' warning via diff-builder, not here).
  const channels = args.source.discordChannelId !== undefined
    ? [args.source.discordChannelId]
    : [];

  const node: MappedAgentNode = {
    name: args.source.id,
    workspace: args.targetBasePath,
    memoryPath,
    soulFile,
    identityFile,
    // When mapping fails we leave the RAW source model string in the
    // node. Plan 03's writer refuses to land the YAML if any
    // unmappable-model warning is present (gates on opts.force or
    // --model-map override); intermediate state is still observable in
    // plan output for operator inspection.
    model: mapped ?? args.source.model.primary,
    channels,
    mcpServers,
  };
  return { node, warnings };
}
