# Slash Command Audit (Phase 117.1-02 T01)

**Date:** 2026-05-13
**Source:** Production daemon log (`23:54:52` CMD-07 ERROR) + `/etc/clawcode/clawcode.yaml` + `src/discord/slash-commands.ts:1085-1180` registration logic + `src/manager/native-cc-commands.ts:42-65` classifier.

## Total command count breakdown — 193 commands attempted

| Source | Count | Source file |
|---|---|---|
| `DEFAULT_SLASH_COMMANDS` | 51 | `src/discord/slash-types.ts` |
| `CONTROL_COMMANDS` (includes `/clawcode-verbose`) | 15 | `src/discord/slash-types.ts` |
| Per-agent `slashCommands` from production yaml | 5 (all on Admin Clawdy) | `/etc/clawcode/clawcode.yaml` |
| **SDK-discovered native commands (post-dedup)** | **~122** | `getSupportedCommands` per agent in `slash-commands.ts:1015-1024` |
| `GSD_SLASH_COMMANDS` | 0 contributed | Routed to `gsdSubcommands` and suppressed since Phase 999.32 (`/gsd-do` consolidation) |
| **TOTAL** | **~193** | matches the production CMD-07 error |

**The 5 per-agent custom commands (Admin Clawdy):**
- `gsd-autonomous`, `gsd-plan-phase`, `gsd-execute-phase`, `gsd-debug`, `gsd-quick`

These are not the problem.

## Root cause — open-by-default native filter

`src/manager/native-cc-commands.ts:42-65` declares only:

```typescript
const CONTROL_PLANE = new Set(["model", "permissions", "effort"]);     // 3
const SKIP         = new Set(["clear", "export", "mcp"]);              // 3
// Everything else defaults to "prompt-channel" → gets registered as
// /clawcode-<name>
```

Two production agents (`admin-clawdy`, `fin-acquisition`) have `settingSources: [project, user]` set. This makes the Claude Agent SDK auto-discover and report:
- All `~/.claude/commands/*.md` files (operator's personal command library — `find-skills`, `learn`, `init`, etc.)
- All `.claude/commands/**/*.md` files in each project dir (every GSD command, every plugin command, etc.)

The SDK's `getSupportedCommands()` returns this whole surface — ~60+ commands per setting-sourced agent. After cross-agent dedup at `slash-commands.ts:1117`, ~122 unique names land in `allCommands`. Add the 51 + 15 + 5 baseline = 193. Discord refuses.

## Fix design — invert to ALLOWLIST

The open-by-default policy doesn't scale as project + user command libraries grow. Three SDK + project commands actually deserve Discord visibility; the rest are CLI-only.

**Proposed allowlist** (only these get registered with `clawcode-` prefix):

| Command | Why allowlist |
|---|---|
| `model` | Control-plane setter; control-plane behavior already exists. KEEP. |
| `permissions` | Control-plane setter for permission mode. KEEP. |
| `effort` | Control-plane setter for thinking effort. KEEP. |
| `compact` | Operator-useful: compact a session from Discord. Phase 87 CMD-04 explicitly re-provides this via native dispatch. KEEP. |
| `cost` | Operator-useful: query current session cost from Discord. Phase 87 CMD-04 also re-provides. KEEP. |
| `help` | Operator-useful: see what's available. KEEP. |

**6 native commands** total — down from ~122.

Everything else the SDK reports is skipped (no Discord registration). Operators access those via the CLI directly, which is where they'd use them anyway.

## Numbers after the fix

- DEFAULT_SLASH_COMMANDS: 51
- CONTROL_COMMANDS: 15
- Per-agent custom: 5
- **Native allowlist: 6**
- **TOTAL: ~77 commands** — comfortably under the 90 cap

No need for the conditional cap raise (T03 skipped).

## Implementation

In `src/manager/native-cc-commands.ts:42-65`:

```typescript
// Phase 117.1-02 — Switch from open-by-default + skip-set to an explicit
// allowlist. The previous policy auto-registered every SDK-reported
// command including project/user .claude/commands/*.md files (~120/agent
// after settingSources opt-in). This blew through Discord's 100/guild cap
// (CMD-07 fired in production 2026-05-12). Operators access the long tail
// via CLI; Discord only needs the control-plane setters + a small operator
// toolkit.

const ALLOWED_NATIVES = new Set(["model", "permissions", "effort", "compact", "cost", "help"]);

const CONTROL_PLANE: ReadonlySet<string> = new Set(["model", "permissions", "effort"]);

// SKIP set retained for documentation but no longer the gate.
const SKIP: ReadonlySet<string> = new Set(["clear", "export", "mcp"]);

export function classifyCommand(name: string): "control-plane" | "prompt-channel" | "skip" {
  if (!ALLOWED_NATIVES.has(name)) return "skip";
  if (CONTROL_PLANE.has(name)) return "control-plane";
  return "prompt-channel";
}
```

The change keeps the existing classifier shape (used by `buildNativeCommandDefs` + downstream merge) but flips the policy. Existing tests on `classifyCommand` need updating: previously unknown names returned `"prompt-channel"`; now they return `"skip"`.

## Recommendation

- T02: implement the allowlist change in `native-cc-commands.ts` + update its test file.
- T03 (cap raise): **SKIP** — pruning alone gets us to ~77 commands; the 90 cap stays.
- T04: deploy, restart, verify daemon log shows `commandCount: ~77` and `/clawcode-verbose` appears in Discord.

## Out of scope (deferred)

- Per-guild sharding of slash commands — unnecessary; allowlist fixes it.
- Adding `bug`, `login`, `logout`, `init`, `memory`, `agents`, `config`, `vim`, `theme`, `release-notes`, etc. to the allowlist — these aren't Discord-meaningful.
- Removing GSD commands from the SDK's discovered set — they auto-skip under the new allowlist (their names aren't in `ALLOWED_NATIVES`).
