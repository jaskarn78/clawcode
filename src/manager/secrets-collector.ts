/**
 * Phase 999.10 — collect every op:// URI reachable from the parsed
 * clawcode.yaml config so SecretsResolver.preResolveAll can warm the cache
 * once at boot, before any agent spawn.
 *
 * Three zones in scope (matches Phase 999.10 roadmap entry + plan 02
 * must-haves):
 *   1. discord.botToken (single optional string)
 *   2. mcpServers.<name>.env.<key> (server-shared env)
 *   3. agents.<name>.mcpEnvOverrides.<server>.<key> (per-agent overrides)
 *
 * Dedups via Set — the same op:// URI referenced from multiple zones
 * collapses to one cache entry (which is correct: one URI = one secret).
 *
 * Pure function, no side effects, no I/O, no logging — DI-friendly + safe
 * to call from the boot path before logger transports are fully wired.
 *
 * Predicate matches the existing `isOpRef` in src/config/loader.ts (line 57)
 * — case-sensitive `op://` prefix only; broader vault/item/field validation
 * lives at the schema layer, not here.
 */
import type { Config } from "../config/schema.js";

/**
 * Case-sensitive op:// prefix guard. Mirrors the loader's `isOpRef`
 * predicate verbatim so the walker never disagrees with the resolver about
 * what counts as a 1Password reference.
 */
function isOpRef(value: unknown): value is string {
  return (
    typeof value === "string"
    && value.startsWith("op://")
    && value.length > "op://".length
  );
}

/**
 * Walk the parsed config and return every distinct op:// URI it contains
 * across the three in-scope zones. Returns insertion-order array of unique
 * URIs (Set semantics) — caller can pass directly to
 * `SecretsResolver.preResolveAll`.
 *
 * Defensive against missing zones: a config without `discord`, `mcpServers`,
 * or any agent's `mcpEnvOverrides` returns `[]` without throwing — boot
 * paths can call this unconditionally.
 */
export function collectAllOpRefs(config: Config): readonly string[] {
  const refs = new Set<string>();

  // Zone 1: discord.botToken (single optional string).
  if (isOpRef(config.discord?.botToken)) {
    refs.add(config.discord!.botToken!);
  }

  // Zone 2: mcpServers[].env (top-level shared servers — record keyed on
  // server name; each server has an env: Record<string, string>).
  if (config.mcpServers) {
    for (const server of Object.values(config.mcpServers)) {
      if (server && typeof server === "object" && "env" in server && server.env) {
        for (const value of Object.values(server.env as Record<string, string>)) {
          if (isOpRef(value)) refs.add(value);
        }
      }
    }
  }

  // Zone 3: agents[].mcpEnvOverrides (per-agent vault-scope overrides —
  // shape: { [serverName]: { [envKey]: value } }).
  if (Array.isArray(config.agents)) {
    for (const agent of config.agents) {
      const overrides = (agent as { mcpEnvOverrides?: Record<string, Record<string, string>> })
        .mcpEnvOverrides;
      if (!overrides) continue;
      for (const serverOverride of Object.values(overrides)) {
        if (serverOverride && typeof serverOverride === "object") {
          for (const value of Object.values(serverOverride)) {
            if (isOpRef(value)) refs.add(value);
          }
        }
      }
    }
  }

  return Array.from(refs);
}
