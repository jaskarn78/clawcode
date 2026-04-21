/**
 * Phase 87 CMD-01 — native Claude Code slash-command classifier + builder.
 *
 * PURE module — no imports from session-manager, daemon, or any live runtime
 * dependency. Exists so the SlashCommandHandler.register() loop can turn an
 * SDK-reported SlashCommand[] into Discord SlashCommandDef[] without coupling
 * the discord layer to the SDK types or session plumbing.
 *
 * Three primitives:
 *
 *   1. classifyCommand(name) → 'control-plane' | 'prompt-channel' | 'skip'
 *      The dispatch discriminator Plans 02 + 03 consume via the
 *      `nativeBehavior` field on SlashCommandDef.
 *
 *   2. buildNativeCommandDefs(sdkCommands, acl) → SlashCommandDef[]
 *      Applies the ACL filter BEFORE classification, drops skip-set entries,
 *      and prefixes every surviving entry's name with `clawcode-` (Pitfall 10
 *      namespace guard). Argument hints become a single STRING option named
 *      `args`.
 *
 *   3. mergeAndDedupe(existing, native) → SlashCommandDef[]
 *      Name-collision resolution: `native` entries win so the two
 *      Phase 87 CMD-04 duplicates (`clawcode-compact`, `clawcode-usage`)
 *      removed from DEFAULT_SLASH_COMMANDS get re-provided by the
 *      SDK registration loop with their nativeBehavior discriminator intact.
 */

import type { SlashCommand } from "./sdk-types.js";
import type { SlashCommandDef } from "../discord/slash-types.js";

/**
 * Discord hard-caps slash-command descriptions at 100 characters. The SDK
 * doesn't enforce this, so we truncate defensively here.
 */
const DESCRIPTION_MAX = 100;

/**
 * Control-plane commands are dispatched via Query.setX() on the SDK
 * (Phases 83/86 blueprint: setModel, setPermissionMode, setMaxThinkingTokens).
 * They do NOT cost an LLM turn. Plan 02 owns the dispatch wiring.
 */
const CONTROL_PLANE: ReadonlySet<string> = new Set([
  "model",
  "permissions",
  "effort",
]);

/**
 * Skip-set commands are NOT registered as Discord slash commands at all.
 *
 *   - `clear`   — not SDK-dispatchable (CMD-00 spike); deferred to CMD-F2
 *                 via session-restart workaround
 *   - `export`  — not SDK-dispatchable (CLI-only REPL feature); out of
 *                 scope for v2.2
 *   - `mcp`     — already covered by Phase 85 Plan 03's `/clawcode-tools`
 *                 which redacts env/command/args (Pitfall 12 — the bare
 *                 /mcp surface would re-expose the unsafe CLI output)
 */
const SKIP: ReadonlySet<string> = new Set(["clear", "export", "mcp"]);

/**
 * Classify a SDK-reported command name for native dispatch.
 *
 * The default for unknown commands is "prompt-channel" — this matches the
 * CMD-00 spike's finding that most non-setter commands are prompt-routable
 * via SDKLocalCommandOutputMessage.
 */
export function classifyCommand(
  name: string,
): "control-plane" | "prompt-channel" | "skip" {
  if (CONTROL_PLANE.has(name)) return "control-plane";
  if (SKIP.has(name)) return "skip";
  return "prompt-channel";
}

/**
 * Per-agent ACL shape consumed by buildNativeCommandDefs.
 *
 * The `denied` set holds bare command names (no leading slash, no prefix) that
 * the agent's SECURITY.md `## Command ACLs` section refuses to register.
 * Empty set = permissive default (no ACL file / no section).
 */
export type CommandAcl = {
  readonly denied: ReadonlySet<string>;
};

/**
 * Build Discord SlashCommandDef[] from an SDK-reported SlashCommand[].
 *
 *   - ACL-denied names are filtered out BEFORE classification (so skip-set
 *     names are still pre-empted by the ACL if an admin wants them gone)
 *   - Classifier skip-set names produce zero output (even with empty ACL)
 *   - Every surviving entry gets `clawcode-` prepended to its name
 *     (Pitfall 10 — NO bare-name registrations allowed)
 *   - Every entry carries a `nativeBehavior` discriminator so Plans 02/03
 *     can route without re-discovery
 *   - Descriptions are clamped to 100 chars (Discord API limit); empty
 *     descriptions fall back to `"Native /<name>"` so the Discord REST
 *     payload is never rejected for zero-length descriptions
 *   - argumentHint turns into a single optional STRING option named `args`
 *     (Discord option type 3)
 */
export function buildNativeCommandDefs(
  sdkCommands: readonly SlashCommand[],
  acl: CommandAcl,
): readonly SlashCommandDef[] {
  const out: SlashCommandDef[] = [];
  for (const cmd of sdkCommands) {
    if (acl.denied.has(cmd.name)) continue;
    const behavior = classifyCommand(cmd.name);
    if (behavior === "skip") continue;

    const rawDescription =
      cmd.description.length > 0 ? cmd.description : `Native /${cmd.name}`;
    const description =
      rawDescription.length > DESCRIPTION_MAX
        ? rawDescription.slice(0, DESCRIPTION_MAX)
        : rawDescription;

    const options =
      cmd.argumentHint.length > 0
        ? [
            {
              name: "args",
              type: 3,
              description: cmd.argumentHint.slice(0, DESCRIPTION_MAX),
              required: false,
            },
          ]
        : [];

    out.push({
      name: `clawcode-${cmd.name}`,
      description,
      // claudeCommand is populated by the Plan 03 dispatch site for
      // prompt-channel entries; control-plane entries never hit the prompt
      // channel so the empty string is correct by construction.
      claudeCommand: "",
      options,
      nativeBehavior: behavior,
    });
  }
  return out;
}

/**
 * Merge an `existing` SlashCommandDef[] with a `native` SlashCommandDef[]
 * by name, letting `native` win on collision. Preserves insertion order
 * (existing first, then unique native additions).
 *
 * This is how Phase 87 CMD-04 re-provides the two duplicates removed from
 * DEFAULT_SLASH_COMMANDS: the SDK-reported `/compact` and `/cost` land in
 * `native` with `nativeBehavior="prompt-channel"` and displace any
 * stale existing entry that shares the `clawcode-compact` / `clawcode-usage`
 * name without losing the discriminator Plans 02/03 need.
 */
export function mergeAndDedupe(
  existing: readonly SlashCommandDef[],
  native: readonly SlashCommandDef[],
): readonly SlashCommandDef[] {
  const byName = new Map<string, SlashCommandDef>();
  for (const cmd of existing) byName.set(cmd.name, cmd);
  for (const cmd of native) byName.set(cmd.name, cmd); // native wins
  return [...byName.values()];
}

/**
 * Phase 87 Plan 03 CMD-03 — canonical prompt-string builder for prompt-channel
 * native-CC dispatch.
 *
 * The SDK's Options docstring confirms slash commands are processed when
 * sent as prompt input (sdk.d.ts). The string format MUST be the bare
 * `/<name>` — NOT the clawcode-<name> Discord prefix (the SDK has no
 * knowledge of the clawcode namespace; it parses the literal /<name>
 * against its own slash-command dispatcher and emits
 * SDKLocalCommandOutputMessage when the name is a known local command).
 *
 * Invariants:
 *   - Strips a leading `clawcode-` prefix idempotently — both
 *     "clawcode-compact" and "compact" yield "/compact".
 *   - Trims leading/trailing whitespace in args (Discord form padding).
 *   - Empty / whitespace-only / missing args → no trailing space
 *     (produces "/compact", never "/compact ").
 *   - Present args → single space separator, passed through VERBATIM
 *     (no escaping, no quoting — the SDK parses as-is; over-escaping
 *     silently breaks arg passthrough).
 */
export function buildNativePromptString(
  commandName: string,
  args: string | undefined,
): string {
  const bare = commandName.replace(/^clawcode-/, "");
  const trimmed = (args ?? "").trim();
  return trimmed.length > 0 ? `/${bare} ${trimmed}` : `/${bare}`;
}
