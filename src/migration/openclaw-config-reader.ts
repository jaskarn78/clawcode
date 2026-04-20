/**
 * OpenClaw source-config reader — parses `~/.openclaw/openclaw.json` into a
 * typed, redacted inventory of agents + Discord bindings.
 *
 * Load-bearing contract for every Phase 76–82 migration module. Contents:
 *   - `openclawSourceAgentSchema` — zod validator for each `agents.list[]` entry
 *   - `openclawBindingSchema`    — zod validator for each `bindings[]` entry
 *   - `readOpenclawInventory`    — read+parse+join bindings, return sorted inventory
 *   - `isFinmentumFamily`        — 5-id hardcoded membership (D-Finmentum decision)
 *
 * DO NOT add env / auth / channels.discord.token / credential fields to the
 * schema. Phase 77 refuses them anyway; surfacing them here would tempt
 * downstream code to leak secrets into the target config. This module reads
 * only what's safe to read.
 *
 * All exports are pure-read: no writes, no side effects, no external I/O other
 * than the single `readFile` against the source path.
 */
import { z } from "zod/v4";
import { readFile } from "node:fs/promises";

/**
 * Shape of a single agent entry in `agents.list[]` from openclaw.json.
 *
 * Required fields (id, name, workspace, agentDir, model, identity) are always
 * present on the 15 on-box agents (verified 2026-04-20). Optional fields vary
 * per agent; `tools` is deliberately left as `z.unknown()` pass-through — Phase
 * 77/78 will refine tool-shape rules on the migrator side.
 */
export const openclawSourceAgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  workspace: z.string().min(1),
  agentDir: z.string().min(1),
  model: z.object({
    primary: z.string().min(1),
    fallbacks: z.array(z.string()).default([]),
  }),
  identity: z
    .object({
      emoji: z.string().optional(),
      name: z.string().optional(),
    })
    .partial(),
  heartbeat: z
    .object({
      every: z.string(),
      model: z.string(),
      prompt: z.string(),
    })
    .optional(),
  subagents: z.object({ model: z.string() }).optional(),
  reasoningDefault: z.string().optional(),
  thinkingDefault: z.string().optional(),
  // Deliberate pass-through: tool schemas differ per-agent; refinement lives
  // in the migrator (Phase 77/78). Do NOT tighten here — would reject valid
  // on-box entries like `{deny: [...], fs: {...}}`.
  tools: z.unknown().optional(),
});
export type OpenclawSourceAgent = z.infer<typeof openclawSourceAgentSchema>;

/**
 * Shape of a single `bindings[]` entry. Some on-box entries carry a `type`
 * (e.g. `"route"`) or `accountId` field; both are ignored at this layer
 * since they don't affect the channel-id join.
 */
export const openclawBindingSchema = z
  .object({
    agentId: z.string().min(1),
    match: z.object({
      channel: z.string(),
      peer: z.object({
        kind: z.string(),
        id: z.string(),
      }),
    }),
  })
  // Accept extra top-level fields (`type`, `accountId`, etc.) without failing
  // — the canonical join only needs agentId + match.peer.
  .passthrough();
export type OpenclawBinding = z.infer<typeof openclawBindingSchema>;

/**
 * A validated source-agent enriched with the joined Discord channel id (if
 * any) and the finmentum-family boolean. This is the shape every downstream
 * migration module consumes (Phase 77 guards, 78 mapper, 81 verify).
 */
export type OpenclawSourceEntry = OpenclawSourceAgent & {
  readonly discordChannelId: string | undefined;
  readonly isFinmentumFamily: boolean;
};

/**
 * Returned shape from `readOpenclawInventory`. Agents are sorted alphabetically
 * by `id` (localeCompare) — this is the determinism anchor for plan-output
 * SHA256 hash, asserted in Phase 76 Plan 02's CLI tests.
 */
export type OpenclawSourceInventory = {
  readonly agents: readonly OpenclawSourceEntry[];
  readonly bindings: readonly OpenclawBinding[];
  readonly sourcePath: string;
};

/**
 * The 5 agents in the Finmentum family. Hardcoded per roadmap D-Finmentum
 * decision ("dynamic heuristic risks mis-grouping finmentum-dashboard /
 * finmentum-studio"). All 5 target a shared `basePath` at migration time.
 */
export const FINMENTUM_FAMILY_IDS: readonly string[] = Object.freeze([
  "fin-acquisition",
  "fin-research",
  "fin-playground",
  "fin-tax",
  "finmentum-content-creator",
]);

/** True iff `id` is one of the 5 hardcoded finmentum-family agent ids. */
export function isFinmentumFamily(id: string): boolean {
  return FINMENTUM_FAMILY_IDS.includes(id);
}

/**
 * Read, parse, and validate an openclaw.json at `sourcePath`. Returns an
 * inventory with:
 *   - agents sorted alphabetically by id, each enriched with its joined
 *     Discord channel id (if any) and the finmentum-family boolean.
 *   - bindings in source order (stable per the JSON file).
 *   - sourcePath echoed back for downstream error-surfacing.
 *
 * Error contract:
 *   - ENOENT / permission / other read errors → Error with both "openclaw.json"
 *     and the offending sourcePath in the message (grep-detectable from
 *     operator logs).
 *   - JSON parse failure → Error with sourcePath + parser message.
 *   - agents.list or bindings fail zod validation → Error listing each issue
 *     as `path: message`, newline-separated.
 */
export async function readOpenclawInventory(
  sourcePath: string,
): Promise<OpenclawSourceInventory> {
  let text: string;
  try {
    text = await readFile(sourcePath, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to read openclaw.json at ${sourcePath}: ${msg}`,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON in openclaw.json at ${sourcePath}: ${msg}`);
  }

  // Structural guard — raw must be an object with `agents.list`.
  if (!raw || typeof raw !== "object") {
    throw new Error(
      `Invalid openclaw.json at ${sourcePath}: expected object at root`,
    );
  }
  const obj = raw as {
    agents?: { list?: unknown };
    bindings?: unknown;
  };
  if (!obj.agents || obj.agents.list === undefined) {
    throw new Error(
      `Invalid openclaw.json at ${sourcePath}: missing agents.list`,
    );
  }

  const agentsParse = z
    .array(openclawSourceAgentSchema)
    .safeParse(obj.agents.list);
  if (!agentsParse.success) {
    const issues = agentsParse.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(
      `openclaw.json agents.list invalid at ${sourcePath}:\n${issues}`,
    );
  }

  const rawBindings = obj.bindings ?? [];
  const bindingsParse = z
    .array(openclawBindingSchema)
    .safeParse(rawBindings);
  if (!bindingsParse.success) {
    const issues = bindingsParse.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(
      `openclaw.json bindings invalid at ${sourcePath}:\n${issues}`,
    );
  }

  // Build agentId → channelId map. Only channel-kind peers contribute;
  // first entry wins if duplicate (source order = deterministic).
  const bindingByAgentId = new Map<string, string>();
  for (const b of bindingsParse.data) {
    if (b.match.peer.kind !== "channel") continue;
    if (bindingByAgentId.has(b.agentId)) continue;
    bindingByAgentId.set(b.agentId, b.match.peer.id);
  }

  const enriched: OpenclawSourceEntry[] = agentsParse.data.map((agent) => ({
    ...agent,
    discordChannelId: bindingByAgentId.get(agent.id),
    isFinmentumFamily: FINMENTUM_FAMILY_IDS.includes(agent.id),
  }));

  // Sort by id ascending (localeCompare). This ordering is load-bearing:
  // downstream plan-output SHA256 hash asserts determinism across two runs.
  enriched.sort((a, b) => a.id.localeCompare(b.id));

  return {
    agents: enriched,
    bindings: bindingsParse.data,
    sourcePath,
  };
}
