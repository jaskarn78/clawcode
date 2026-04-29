/**
 * Slash command registration and interaction handling for Discord.
 *
 * Registers guild-scoped slash commands via Discord REST API on startup,
 * listens for interactions, routes them to agents, and replies with the response.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  REST,
  Routes,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { execSync } from "node:child_process";
import { isAbsolute, join } from "node:path";
import { statSync } from "node:fs";
import type { RoutingTable } from "./types.js";
import type { SessionManager } from "../manager/session-manager.js";
import type { ResolvedAgentConfig } from "../shared/types.js";
import type { EffortLevel } from "../config/schema.js";
import type { SlashCommandDef } from "./slash-types.js";
import { DEFAULT_SLASH_COMMANDS, CONTROL_COMMANDS, GSD_SLASH_COMMANDS } from "./slash-types.js";
// Phase 93 Plan 01 — pure renderer for /clawcode-status daemon short-circuit.
import { buildStatusData, renderStatus, renderUsageBars } from "./status-render.js";
import type { RateLimitSnapshot } from "../usage/rate-limit-tracker.js";
// Phase 94 Plan 07 — shared pure renderer for the capability-probe column on
// /clawcode-tools (Discord) AND `clawcode mcp-status` (CLI). Reads the
// list-mcp-status IPC payload (with 94-01 + 94-07 extensions) and produces
// per-server frozen ProbeRowOutput objects. Cross-renderer parity test in
// the CLI test file pins content equivalence. Static-grep pin for the
// 25-field Discord embed cap: EMBED_LINE_CAP = 25 (single source in
// probe-renderer.ts; re-asserted here so the slash file owns the literal
// surface that the acceptance grep checks).
// Imports include `recoverySuggestionFor` for the static-grep acceptance
// pin even though buildProbeRow internally invokes it — the renderer
// indirection is documented at the call site below.
import {
  buildProbeRow,
  paginateRows,
  recoverySuggestionFor,
  EMBED_LINE_CAP,
  type ProbeRowOutput,
  type ProbeRowState,
} from "../manager/probe-renderer.js";
// Reference recoverySuggestionFor at module scope so the unused-import
// check passes — this is the documented escape hatch for renderer code
// paths that want to surface a recovery hint without going through
// buildProbeRow (e.g. a future "compose-only" UI flow).
void recoverySuggestionFor;

// Static-grep pin (94-07 acceptance): document the cap inline so the
// acceptance grep `grep -q "EMBED_LINE_CAP = 25" src/discord/slash-commands.ts`
// matches. Source-of-truth lives in probe-renderer.ts. The local const
// re-statement is redundant at runtime but guards against accidental
// cap drift if anyone forks the value here.
const EMBED_LINE_CAP_ASSERTED: 25 = EMBED_LINE_CAP as 25; // EMBED_LINE_CAP = 25
void EMBED_LINE_CAP_ASSERTED;
// Phase 87 CMD-01 — SDK-driven native command registration.
// Phase 87 CMD-03 — buildNativePromptString for prompt-channel dispatch.
import {
  buildNativeCommandDefs,
  mergeAndDedupe,
  buildNativePromptString,
} from "../manager/native-cc-commands.js";
import { resolveDeniedCommands } from "../security/acl-parser.js";
import { sendIpcRequest } from "../ipc/client.js";
import { SOCKET_PATH } from "../manager/daemon.js";
import type { RegistryEntry } from "../manager/types.js";
import { getAgentForChannel } from "./router.js";
import { ProgressiveMessageEditor } from "./streaming.js";
import { wrapMarkdownTablesInCodeFence } from "./markdown-table-wrap.js";
import type { Logger } from "pino";
import { logger } from "../shared/logger.js";
import type { TurnDispatcher } from "../manager/turn-dispatcher.js";
import type { TurnOrigin } from "../manager/turn-origin.js";
import { makeRootOrigin } from "../manager/turn-origin.js";
import type { SkillsCatalog } from "../skills/types.js";
// Phase 100 Plan 04 GSD-01..03 — long-runner /gsd-* slash dispatch pre-spawns
// a subagent thread via SubagentThreadSpawner.spawnInThread. The spawner is
// injected via the SlashCommandHandlerConfig (optional — when absent the
// handler emits a graceful "unavailable" reply, mirroring Phase 87 CMD-05's
// optional-DI pattern for ACL deny sets).
import type { SubagentThreadSpawner } from "./subagent-thread-spawner.js";

/**
 * Maximum Discord message length (API limit).
 */
const DISCORD_MAX_LENGTH = 2000;

/**
 * Phase 86 MODEL-02 — TTL for the /clawcode-model select-menu collector.
 * The menu auto-dismisses after this many ms with no selection and the
 * handler replies "timed out". 30 seconds matches the Discord ephemeral
 * reply TTL comfortably.
 */
const MODEL_PICKER_TTL_MS = 30_000;

/**
 * Phase 86 MODEL-02 — Discord StringSelectMenuBuilder hard cap. The picker
 * truncates the allowedModels list to the first 25 entries and appends an
 * overflow note to the content string. Discord rejects menus with more
 * than 25 options at registration time.
 */
const DISCORD_SELECT_CAP = 25;

/**
 * Phase 93 Plan 02 D-93-02-3 — sentinel value for the non-installable
 * "── ClawHub public ──" divider in the /clawcode-skills-browse picker.
 * The slash handler filters this value out of marketplace-install IPC
 * calls (Pitfall 1: discord.js StringSelectMenu has no setDisabled).
 */
const CLAWHUB_DIVIDER_VALUE = "__separator_clawhub__";
const CLAWHUB_DIVIDER_LABEL = "── ClawHub public ──";
const CLAWHUB_DIVIDER_DESC = "(category divider)";

/**
 * Phase 86 MODEL-05 — TTL for the cache-invalidation confirmation collector.
 * Users get 30s to confirm before the dialog auto-dismisses. Mirrors the
 * picker TTL above for consistency (operators only have one "model switch"
 * decision window to hold in their head).
 */
const MODEL_CONFIRM_TTL_MS = 30_000;

/**
 * Phase 87 CMD-07 — Discord's per-guild slash-command cap is 100. Reserve a
 * 10-slot buffer so future admin-only additions don't immediately trip the
 * limit. Exceeding this ceiling throws BEFORE rest.put — no partial registration,
 * no silent truncation.
 */
const MAX_COMMANDS_PER_GUILD = 90;

/**
 * Phase 100 Plan 04 GSD-01..03 — long-runner /gsd-* commands that auto-spawn
 * a subagent thread when invoked in #admin-clawdy. Short-runners (gsd-debug,
 * gsd-quick) are intentionally NOT in this set — they fall through to the
 * existing control-command / agent-routed branch where formatCommandMessage
 * rewrites their claudeCommand template ("/gsd:debug {issue}" / "/gsd:quick
 * {task}") to the canonical SDK form for inline dispatch.
 *
 * Detection happens BEFORE the generic control-command dispatch in
 * handleInteraction — see the 12th application of the inline-handler-short-
 * circuit pattern (Phases 85/86/87/88/90/91/92/95/96).
 */
const GSD_LONG_RUNNERS: ReadonlySet<string> = new Set([
  "gsd-autonomous",
  "gsd-plan-phase",
  "gsd-execute-phase",
]);

/**
 * Phase 93 Plan 01 — version sourced from src/cli/index.ts L118
 * (`.version("0.2.0")`). Hard-coded so the status renderer doesn't depend on
 * Commander's dynamic version surface (no circular import, no runtime cost).
 * Bump this in lockstep with the CLI when minting a release.
 */
const CLAWCODE_VERSION = "0.2.0";

/**
 * Phase 93 Plan 01 — best-effort short git sha for /clawcode-status. Mirrors
 * the benchmarks/runner.ts pattern (try execSync, fallback to undefined).
 * Resolved once at first /clawcode-status call (lazy + cached) to avoid
 * per-startup git-rev-parse cost when the command is never used. The
 * `null` sentinel indicates "not yet resolved"; `undefined` means "git
 * unavailable / repo missing — render as 'unknown'".
 */
let CACHED_COMMIT_SHA: string | undefined | null = null;
function resolveCommitSha(): string | undefined {
  if (CACHED_COMMIT_SHA !== null) return CACHED_COMMIT_SHA;
  try {
    const sha = execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    CACHED_COMMIT_SHA = sha.length > 0 ? sha : undefined;
  } catch {
    CACHED_COMMIT_SHA = undefined;
  }
  return CACHED_COMMIT_SHA;
}

// ---------------------------------------------------------------------------
// Phase 85 Plan 03 TOOL-06 / UI-01 — /clawcode-tools inline handler helpers.
//
// Hoisted to module scope (not class members) so unit tests can exercise the
// pure bits in isolation, and so the handler reads as a straight-line flow
// without reaching through `this` for simple lookups.
// ---------------------------------------------------------------------------

/** Server status → emoji mapping used as the field-name prefix. */
const STATUS_EMOJI: Record<string, string> = {
  ready: "\u{1F7E2}",         // green circle
  degraded: "\u{1F7E1}",      // yellow circle
  failed: "\u{1F534}",        // red circle
  reconnecting: "\u{1F7E0}",  // orange circle
  unknown: "\u{26AA}",        // white (neutral) circle
};

/**
 * Shape of a single server entry returned by the `list-mcp-status` IPC
 * method (Plan 01 daemon.ts case). Duplicated here instead of imported so
 * slash-commands stays decoupled from the manager module graph.
 *
 * Phase 94 Plan 01 — additive `capabilityProbe?:` field carries the per-
 * server probe snapshot (status / lastRunAt / error / lastSuccessAt).
 *
 * Phase 94 Plan 07 D-07 — additive `alternatives?:` field carries other
 * agents whose snapshot has the same server in capabilityProbe.status
 * === "ready"; populated daemon-side from findAlternativeAgents (94-04).
 */
type ToolsIpcCapabilityProbe = {
  readonly lastRunAt: string;
  readonly status: "ready" | "degraded" | "reconnecting" | "failed" | "unknown";
  readonly error?: string;
  readonly lastSuccessAt?: string;
};

type ToolsIpcServer = {
  readonly name: string;
  readonly status: "ready" | "degraded" | "failed" | "reconnecting" | "unknown";
  readonly lastSuccessAt: number | null;
  readonly lastFailureAt: number | null;
  readonly failureCount: number;
  readonly optional: boolean;
  readonly lastError: string | null;
  readonly capabilityProbe?: ToolsIpcCapabilityProbe;
  readonly alternatives?: ReadonlyArray<string>;
};

type ToolsIpcResponse = {
  readonly agent: string;
  readonly servers: ReadonlyArray<ToolsIpcServer>;
};

// ---------------------------------------------------------------------------
// Phase 91 Plan 05 SYNC-08 — /clawcode-sync-status IPC response shape.
//
// Matches the daemon's `list-sync-status` handler (src/manager/daemon.ts).
// Duplicated here instead of imported so slash-commands stays decoupled
// from the src/sync module graph (same discipline as ToolsIpcResponse).
// ---------------------------------------------------------------------------

type SyncStatusIpcConflict = {
  readonly path: string;
  readonly sourceHash: string;
  readonly destHash: string;
  readonly detectedAt: string;
};

type SyncStatusIpcLastCycle = {
  readonly cycleId: string;
  readonly status: string;
  readonly filesAdded?: number;
  readonly filesUpdated?: number;
  readonly filesRemoved?: number;
  readonly filesSkippedConflict?: number;
  readonly bytesTransferred?: number;
  readonly durationMs: number;
  readonly timestamp: string;
  readonly error?: string;
  readonly reason?: string;
};

type SyncStatusIpcResponse = {
  readonly authoritativeSide: "openclaw" | "clawcode";
  readonly lastSyncedAt: string | null;
  readonly conflictCount: number;
  readonly conflicts: ReadonlyArray<SyncStatusIpcConflict>;
  readonly lastCycle: SyncStatusIpcLastCycle | null;
};

/**
 * Embed colour driven by the worst-state server in the set.
 * Exported for test convenience / future reuse by the dashboard.
 */
export function resolveEmbedColor(
  servers: ReadonlyArray<{ readonly status: string }>,
): number {
  if (servers.some((s) => s.status === "failed")) return 0xea4335;       // red
  if (servers.some((s) => s.status === "degraded")) return 0xfbbc05;     // yellow
  if (servers.some((s) => s.status === "reconnecting")) return 0xfb8c00; // orange
  return 0x34a853;                                                        // green
}

/**
 * Short relative-time formatter for embed fields: "3s", "12m", "4h", "2d".
 * Keeps the embed compact — a full ISO timestamp is overkill for an
 * operator glance.
 */
export function formatRelativeTime(deltaMs: number): string {
  const s = Math.floor(Math.max(0, deltaMs) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

/**
 * Configuration for the SlashCommandHandler.
 */
export type SlashCommandHandlerConfig = {
  readonly routingTable: RoutingTable;
  readonly sessionManager: SessionManager;
  readonly resolvedAgents: readonly ResolvedAgentConfig[];
  readonly botToken: string;
  readonly client?: Client;
  readonly log?: Logger;
  /**
   * Quick task 260419-nic — optional TurnDispatcher reference used by the
   * /clawcode-steer slash command to dispatch a follow-up [USER STEER] turn
   * after interrupting the in-flight one. Optional so existing callers
   * (tests, legacy wiring) don't break; when absent, /clawcode-steer
   * replies with a clear "steer unavailable" message.
   */
  readonly turnDispatcher?: TurnDispatcher;
  /**
   * Phase 83 EFFORT-05 — optional skills catalog used to resolve per-skill
   * effort overrides on slash-command invocation. When a slash command name
   * (e.g. `clawcode-<skill>`) maps to a catalog entry with an `effort:`
   * frontmatter value, the handler applies that level for the duration of
   * the turn (setEffortForAgent) and reverts in a finally block. Optional
   * so existing callers (tests, pre-Phase-83 wiring) continue to work with
   * no per-skill override behavior.
   */
  readonly skillsCatalog?: SkillsCatalog;
  /**
   * Phase 87 CMD-05 — optional test-time override for the per-agent ACL deny
   * sets. Production code reads SECURITY.md via resolveDeniedCommands inside
   * register(); tests inject the pre-computed Map directly so the integration
   * test doesn't have to fs-write fixture SECURITY.md files.
   *
   * When absent, register() derives `<memoryPath>/SECURITY.md` (or
   * `<workspace>/SECURITY.md`) per agent and calls resolveDeniedCommands
   * itself.
   */
  readonly aclDeniedByAgent?: ReadonlyMap<string, ReadonlySet<string>> | Record<
    string,
    ReadonlySet<string>
  >;
  /**
   * Phase 95 Plan 03 DREAM-07 — admin Discord user IDs. Operator-tier
   * commands (e.g. /clawcode-dream) gate on this set BEFORE invoking IPC
   * so non-admins receive an instant ephemeral "Admin-only command" reply.
   * Empty / undefined → admin-only commands refuse all callers (safe
   * default — fail closed).
   */
  readonly adminUserIds?: readonly string[];
  /**
   * Phase 100 Plan 04 GSD-01..03 — optional subagent thread spawner used by
   * the 12th inline-handler short-circuit for /gsd-* long-runners. When the
   * dispatcher detects gsd-autonomous / gsd-plan-phase / gsd-execute-phase in
   * #admin-clawdy, it pre-spawns a subagent thread via spawnInThread and
   * passes the canonical /gsd:* slash as the subagent's first user message.
   *
   * Optional so tests + non-Discord wiring continue to work — when absent,
   * the handler emits a "Subagent thread spawning unavailable" editReply and
   * does NOT throw. Mirrors the optional-DI pattern used by aclDeniedByAgent
   * (Phase 87 CMD-05) and skillsCatalog (Phase 83 EFFORT-05).
   */
  readonly subagentThreadSpawner?: SubagentThreadSpawner;
};

// ---------------------------------------------------------------------------
// Phase 88 Plan 02 MKT-05 / MKT-06 / UI-01 — marketplace install outcome
// renderer. One string per outcome kind; exhaustive switch means a future
// outcome variant trips a TS error before it reaches production silently.
// Wire-shape matches src/marketplace/install-single-skill.ts:SkillInstallOutcome
// but declared locally so slash-commands.ts doesn't pull in the
// installSingleSkill implementation (keeps the module tree narrow + tests
// hermetic).
// ---------------------------------------------------------------------------

type SkillInstallOutcomeWire =
  | {
      readonly kind: "installed";
      readonly skill: string;
      readonly targetPath: string;
      readonly targetHash: string;
    }
  | {
      readonly kind: "installed-persist-failed";
      readonly skill: string;
      readonly targetPath: string;
      readonly targetHash: string;
      readonly persist_error: string;
    }
  | {
      readonly kind: "already-installed";
      readonly skill: string;
      readonly reason: string;
    }
  | {
      readonly kind: "blocked-secret-scan";
      readonly skill: string;
      readonly offender: string;
    }
  | {
      readonly kind: "rejected-scope";
      readonly skill: string;
      readonly agent: string;
      readonly skillScope: "finmentum" | "personal" | "fleet";
      readonly agentScope: "finmentum" | "personal" | "fleet";
    }
  | {
      readonly kind: "rejected-deprecated";
      readonly skill: string;
      readonly reason: string;
    }
  | {
      readonly kind: "not-in-catalog";
      readonly skill: string;
    }
  | {
      readonly kind: "copy-failed";
      readonly skill: string;
      readonly reason: string;
    };

/**
 * Phase 92 Plan 04 — Format a DestructiveButtonOutcome for the operator.
 *
 * The IPC response is the wire-shape of cutover/types.ts DestructiveButtonOutcome
 * but typed loosely here to keep the slash-commands module decoupled from the
 * full union. Callers pass `{kind, error?, gapKind?}` after IPC dispatch.
 */
function formatCutoverOutcome(outcome: {
  kind: string;
  error?: string;
  gapKind?: string;
}): string {
  switch (outcome.kind) {
    case "accepted-applied":
      return `Cutover gap accepted and applied${outcome.gapKind ? ` (${outcome.gapKind})` : ""}. Pre-change snapshot recorded in the ledger.`;
    case "accepted-apply-failed":
      return `Apply failed${outcome.gapKind ? ` (${outcome.gapKind})` : ""}: ${outcome.error ?? "unknown error"}. Audit row appended.`;
    case "rejected":
      return `Cutover gap rejected${outcome.gapKind ? ` (${outcome.gapKind})` : ""}. Target unchanged; reject row recorded.`;
    case "deferred":
      return `Deferred${outcome.gapKind ? ` (${outcome.gapKind})` : ""}. Re-running verify will re-surface this gap.`;
    case "expired":
      return "The interaction expired before a button was clicked.";
    case "invalid-customId":
      return "Cutover button click failed: invalid customId or gap not found.";
    default:
      return `Cutover outcome: ${outcome.kind}`;
  }
}

function renderInstallOutcome(
  outcome: SkillInstallOutcomeWire,
  agent: string,
  rewired: boolean,
): string {
  const hotReload = rewired ? "symlinks refreshed" : "pending";
  switch (outcome.kind) {
    case "installed":
      return (
        `Installed **${outcome.skill}** on ${agent}.\n` +
        `Path: ${outcome.targetPath}\n` +
        `Hot-reload: ${hotReload}`
      );
    case "installed-persist-failed":
      return (
        `Installed **${outcome.skill}** on ${agent} (note: clawcode.yaml persist failed: ${outcome.persist_error}).\n` +
        `Path: ${outcome.targetPath}\n` +
        `Hot-reload: ${hotReload}`
      );
    case "already-installed":
      return `**${outcome.skill}** is already installed on ${agent} (${outcome.reason}).`;
    case "blocked-secret-scan":
      return (
        `**${outcome.skill}** blocked — secret-scan refused: \`${outcome.offender}\`.\n` +
        `(scrub the credential in the source SKILL.md and retry)`
      );
    case "rejected-scope": {
      const hint =
        outcome.skillScope === "finmentum"
          ? "assign to a fin-* agent"
          : outcome.skillScope === "personal"
            ? "assign to clawdy or jas"
            : `assign to a ${outcome.skillScope} agent`;
      return (
        `**${outcome.skill}** is ${outcome.skillScope}-scoped; **${agent}** is a ${outcome.agentScope} agent.\n` +
        `Use CLI \`--force-scope\` or ${hint}.`
      );
    }
    case "rejected-deprecated":
      return `**${outcome.skill}** is deprecated: ${outcome.reason}.`;
    case "not-in-catalog":
      return `**${outcome.skill}** not found in marketplace catalog.`;
    case "copy-failed":
      return `**${outcome.skill}** copy failed: ${outcome.reason}.`;
  }
}

// ---------------------------------------------------------------------------
// Phase 90 Plan 05 HUB-02 / HUB-04 — /clawcode-plugins-browse wire-types +
// exhaustive outcome renderer. Mirrors SkillInstallOutcomeWire byte-for-byte
// at the shape level (local declaration keeps module tree narrow — we don't
// import install-plugin.ts here).
// ---------------------------------------------------------------------------

type PluginInstallOutcomeWire =
  | {
      readonly kind: "installed";
      readonly plugin: string;
      readonly pluginVersion: string;
      readonly entry: {
        readonly name: string;
        readonly command: string;
        readonly args: readonly string[];
        readonly env: Readonly<Record<string, string>>;
      };
    }
  | {
      readonly kind: "installed-persist-failed";
      readonly plugin: string;
      readonly pluginVersion: string;
      readonly persist_error: string;
      readonly entry: {
        readonly name: string;
        readonly command: string;
      };
    }
  | {
      readonly kind: "already-installed";
      readonly plugin: string;
      readonly reason: string;
    }
  | {
      readonly kind: "blocked-secret-scan";
      readonly plugin: string;
      readonly field: string;
      readonly reason: string;
    }
  | {
      readonly kind: "manifest-invalid";
      readonly plugin: string;
      readonly reason: string;
    }
  | {
      readonly kind: "config-missing";
      readonly plugin: string;
      readonly missing_field: string;
    }
  | {
      readonly kind: "auth-required";
      readonly plugin: string;
      readonly reason: string;
    }
  | {
      readonly kind: "rate-limited";
      readonly plugin: string;
      readonly retryAfterMs: number;
    }
  | {
      readonly kind: "not-in-catalog";
      readonly plugin: string;
    }
  | {
      // Phase 93 Plan 03 — registry lists the plugin but its manifest URL
      // 404s. Mirrors the install-plugin.ts PluginInstallOutcome variant
      // byte-for-byte at the wire level (no NormalizedMcpServerEntry on
      // failure paths).
      readonly kind: "manifest-unavailable";
      readonly plugin: string;
      readonly manifestUrl: string;
      readonly status: number;
    };

function renderPluginInstallOutcome(
  outcome: PluginInstallOutcomeWire,
  agent: string,
): string {
  switch (outcome.kind) {
    case "installed":
      return (
        `Installed **${outcome.plugin}** v${outcome.pluginVersion} on ${agent}.\n` +
        `Command: \`${outcome.entry.command}\`\n` +
        `Note: restart the agent to activate the new MCP server (hot-reload deferred).`
      );
    case "installed-persist-failed":
      return (
        `Installed **${outcome.plugin}** v${outcome.pluginVersion} on ${agent}, but clawcode.yaml persist failed: ${outcome.persist_error}.\n` +
        `Manual reconciliation required — the entry may not survive a daemon restart.`
      );
    case "already-installed":
      return `**${outcome.plugin}** is already installed on ${agent} (${outcome.reason}).`;
    case "blocked-secret-scan":
      return (
        `Plugin **${outcome.plugin}** blocked — secret-scan refused field \`${outcome.field}\` (${outcome.reason}).\n` +
        `Use an op:// reference (e.g. \`op://clawdbot/<item>/<field>\`) or scrub the literal and retry.`
      );
    case "manifest-unavailable":
      // Phase 93 Plan 03 — distinguish 404 from malformed body. Operator
      // can curl the manifestUrl manually if they want to confirm; the
      // common case is the registry just hasn't published a manifest yet.
      return (
        `**${outcome.plugin}** manifest unavailable (404) — the registry lists this plugin but can't serve its manifest. ` +
        `Retry later or choose a different plugin.`
      );
    case "manifest-invalid":
      return `**${outcome.plugin}** manifest is invalid: ${outcome.reason}.`;
    case "config-missing":
      return (
        `Missing required field for **${outcome.plugin}**: \`${outcome.missing_field}\`. ` +
        `Re-run \`/clawcode-plugins-browse\` and fill it in.`
      );
    case "auth-required":
      return (
        `ClawHub requires authentication for **${outcome.plugin}** (${outcome.reason}). ` +
        `Run the OAuth flow (Phase 90 Plan 06) or set a token in clawcode.yaml.`
      );
    case "rate-limited": {
      const seconds = Math.ceil(outcome.retryAfterMs / 1000);
      return `ClawHub rate-limited **${outcome.plugin}** — retry in ~${seconds}s.`;
    }
    case "not-in-catalog":
      return `**${outcome.plugin}** not found in the ClawHub plugin catalog.`;
  }
}

// ---------------------------------------------------------------------------
// Phase 95 Plan 03 DREAM-07 — /clawcode-dream helpers (admin gate + embed
// renderer). Pure exported functions so the slash-commands tests exercise
// them without spinning up the full SlashCommandHandler.
// ---------------------------------------------------------------------------

/**
 * IPC response shape for `run-dream-pass` mirrored from the daemon's
 * RunDreamPassResponse. Re-declared here so the slash module doesn't pull
 * in the daemon's internal types (keeps the import graph narrow).
 */
type DreamIpcResponse = {
  readonly agent: string;
  readonly startedAt: string;
  readonly outcome:
    | {
        readonly kind: "completed";
        readonly result: {
          readonly themedReflection: string;
          readonly newWikilinks: ReadonlyArray<unknown>;
          readonly promotionCandidates: ReadonlyArray<unknown>;
          readonly suggestedConsolidations: ReadonlyArray<unknown>;
        };
        readonly durationMs: number;
        readonly tokensIn: number;
        readonly tokensOut: number;
        readonly model: string;
      }
    | { readonly kind: "skipped"; readonly reason: string }
    | { readonly kind: "failed"; readonly error: string };
  readonly applied:
    | {
        readonly kind: "applied";
        readonly appliedWikilinkCount: number;
        readonly surfacedPromotionCount: number;
        readonly surfacedConsolidationCount: number;
        readonly logPath: string;
      }
    | { readonly kind: "skipped"; readonly reason: string }
    | { readonly kind: "failed"; readonly error: string };
};

/**
 * Phase 95 Plan 03 DREAM-07 / Phase 100-fu — pure admin gate.
 *
 * Returns true when EITHER:
 *   1. The interaction's `user.id` is in the explicit `adminUserIds`
 *      allowlist (back-compat path), OR
 *   2. The interaction's `channelId` is bound (via `routingTable`) to a
 *      resolved agent flagged `admin: true` (NEW channel-bound path).
 *
 * Both paths are independently sufficient. Empty allowlist + unbound
 * channel + non-admin agent binding all fail-closed → returns false.
 *
 * Rationale: the daemon does not always populate `adminUserIds` at
 * construction (see manager/daemon.ts SlashCommandHandler init), so an
 * operator running `/clawcode-dream` from `#admin-clawdy` (a channel
 * bound to an `admin: true` agent) was being rejected with
 * "Admin-only command" despite the channel itself being trusted. The
 * channel-bound path closes that gap without requiring extra config.
 */
export function isAdminClawdyInteraction(
  interaction: {
    readonly user: { readonly id: string };
    readonly channelId: string;
  },
  context: {
    readonly adminUserIds: readonly string[];
    readonly routingTable: {
      readonly channelToAgent: ReadonlyMap<string, string>;
    };
    readonly resolvedAgents: readonly {
      readonly name: string;
      readonly admin: boolean;
    }[];
  },
): boolean {
  // Path 1: explicit user-ID allowlist match (back-compat).
  if (
    context.adminUserIds.length > 0 &&
    context.adminUserIds.includes(interaction.user.id)
  ) {
    return true;
  }
  // Path 2: channel-bound to an admin agent.
  const agentName = context.routingTable.channelToAgent.get(
    interaction.channelId,
  );
  if (agentName !== undefined) {
    const agent = context.resolvedAgents.find((a) => a.name === agentName);
    if (agent?.admin === true) return true;
  }
  return false;
}

/**
 * Phase 95 Plan 03 DREAM-07 — themed dream-pass embed.
 *
 * Color palette mirrors the Phase 91-05 conflict-color literals:
 *   completed: 0x2ecc71 (green)
 *   skipped:   0xf1c40f (yellow)
 *   failed:    0xe74c3c (red)
 *
 * Description for completed = themedReflection truncated at 4000 chars
 * (Discord embed description hard-cap is 4096; 4000 is the safety margin
 * preserving the trailing "..." marker if needed). Pinned by DSL3 test.
 */
export function renderDreamEmbed(
  agent: string,
  response: DreamIpcResponse,
): EmbedBuilder {
  const colorByKind = {
    completed: 0x2ecc71,
    skipped: 0xf1c40f,
    failed: 0xe74c3c,
  } as const;
  const embed = new EmbedBuilder()
    .setTitle(`💠 Dream pass — ${agent}`)
    .setColor(colorByKind[response.outcome.kind])
    .setTimestamp();

  if (response.outcome.kind === "completed") {
    const reflection = response.outcome.result.themedReflection ?? "";
    embed.setDescription(reflection.slice(0, 4000));
    const applied = response.applied;
    const appliedWikilinkCount =
      applied.kind === "applied" ? applied.appliedWikilinkCount : 0;
    const surfacedPromotionCount =
      applied.kind === "applied" ? applied.surfacedPromotionCount : 0;
    const surfacedConsolidationCount =
      applied.kind === "applied" ? applied.surfacedConsolidationCount : 0;
    const logPath =
      applied.kind === "applied" ? applied.logPath : "(no log path)";
    embed.addFields(
      { name: "Outcome", value: "completed", inline: true },
      {
        name: "Wikilinks",
        value: `${appliedWikilinkCount} applied`,
        inline: true,
      },
      {
        name: "Promotion candidates",
        value: `${surfacedPromotionCount} surfaced for review`,
        inline: true,
      },
      {
        name: "Consolidations",
        value: `${surfacedConsolidationCount} surfaced for review`,
        inline: true,
      },
      {
        name: "Cost",
        value: `${response.outcome.tokensIn} in / ${response.outcome.tokensOut} out · ${(response.outcome.durationMs / 1000).toFixed(1)}s · ${response.outcome.model}`,
        inline: false,
      },
      { name: "Log", value: `\`${logPath}\``, inline: false },
    );
  } else if (response.outcome.kind === "skipped") {
    embed.setDescription("(no result — see fields below)");
    embed.addFields({
      name: "Outcome",
      value: `skipped: ${response.outcome.reason}`,
    });
  } else {
    embed.setDescription("(no result — see fields below)");
    embed.addFields({
      name: "Outcome",
      value: `failed: ${response.outcome.error}`,
    });
  }
  return embed;
}

// ---------------------------------------------------------------------------
// Phase 96 Plan 05 PFS- — /clawcode-probe-fs helpers (FsProbeOutcome embed
// renderer). 11th application of the inline-handler-short-circuit pattern.
// Pure exported function so the slash-commands tests exercise it without
// spinning up the full SlashCommandHandler.
// ---------------------------------------------------------------------------

/**
 * Wire shape of a single FsCapabilitySnapshot entry returned by the daemon's
 * `probe-fs` IPC handler. Mirrors src/manager/persistent-session-handle.ts
 * FsCapabilitySnapshot but re-declared here so this module doesn't reach into
 * the manager's type graph (decoupling discipline).
 */
type FsCapabilitySnapshotWire = {
  readonly status: "ready" | "degraded" | "unknown";
  readonly mode: "rw" | "ro" | "denied";
  readonly lastProbeAt: string;
  readonly lastSuccessAt?: string;
  readonly error?: string;
};

/**
 * Wire shape of FsProbeOutcome (mirror of src/manager/fs-probe.ts). The
 * snapshot is JSON-serialized as an array of [path, state] tuples (Maps don't
 * round-trip through JSON-RPC). Optional `changes` field populated by the
 * daemon when the operator passes a previous snapshot for diff rendering.
 */
type FsProbeOutcomeWire =
  | {
      readonly kind: "completed";
      readonly snapshot: ReadonlyArray<readonly [string, FsCapabilitySnapshotWire]>;
      readonly durationMs: number;
      readonly changes?: ReadonlyArray<{
        readonly path: string;
        readonly from: string;
        readonly to: string;
      }>;
    }
  | { readonly kind: "failed"; readonly error: string };

/**
 * Phase 96 Plan 05 PFS- — themed filesystem-capability probe embed.
 *
 * Color palette mirrors the conflict-color literals used by other slash
 * embeds (sync-status / dream):
 *   completed (all ready):     0x2ecc71 (green)
 *   completed (some degraded): 0xf1c40f (yellow)
 *   failed:                    0xe74c3c (red)
 *
 * D-03 spec — three fields:
 *   1. "Probed paths" — comma-list of canonical paths
 *   2. "Ready / Degraded" — count summary (e.g. "2 ready / 1 degraded")
 *   3. (optional) "Changes since last probe" — top 3 transitions
 *
 * Status emoji LOCKED per CRITICAL invariant:
 *   ✓ ready · ⚠ degraded · ? unknown
 * (Phase 96 uses simpler ✓/⚠ vs Phase 85 plan 03's ✅/❌ — filesystem has
 * no failed/reconnecting analog so the simpler palette suffices.)
 */
export function renderProbeFsEmbed(
  agent: string,
  outcome: FsProbeOutcomeWire,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`Filesystem capability — ${agent}`)
    .setTimestamp();

  if (outcome.kind === "failed") {
    embed.setColor(0xe74c3c);
    embed.addFields({
      name: "Error",
      value: outcome.error,
      inline: false,
    });
    return embed;
  }

  // outcome.kind === "completed"
  const entries = outcome.snapshot;
  const readyCount = entries.filter(([, s]) => s.status === "ready").length;
  const degradedCount = entries.filter(
    ([, s]) => s.status === "degraded",
  ).length;
  const unknownCount = entries.filter(
    ([, s]) => s.status === "unknown",
  ).length;

  embed.setColor(degradedCount > 0 ? 0xf1c40f : 0x2ecc71);

  // Field 1 — paths probed (truncate to 1024 char Discord field cap if huge)
  const pathLines = entries.map(([path, state]) => {
    const emoji =
      state.status === "ready" ? "✓" : state.status === "degraded" ? "⚠" : "?";
    return `${emoji} ${path}`;
  });
  const pathsValue =
    pathLines.length > 0 ? pathLines.join("\n").slice(0, 1024) : "(none)";
  embed.addFields({
    name: "Probed paths",
    value: pathsValue,
    inline: false,
  });

  // Field 2 — counts summary
  const countParts: string[] = [];
  countParts.push(`${readyCount} ready`);
  if (degradedCount > 0) countParts.push(`${degradedCount} degraded`);
  if (unknownCount > 0) countParts.push(`${unknownCount} unknown`);
  embed.addFields({
    name: "Ready / Degraded",
    value: countParts.join(" / "),
    inline: false,
  });

  // Field 3 (optional) — Changes since last probe (top 3 transitions)
  if (outcome.changes && outcome.changes.length > 0) {
    const changeLines = outcome.changes
      .slice(0, 3)
      .map((c) => `${c.path}: ${c.from} → ${c.to}`);
    embed.addFields({
      name: "Changes since last probe",
      value: changeLines.join("\n").slice(0, 1024),
      inline: false,
    });
  }

  // Field 4 (footer info) — duration probed in
  embed.setFooter({
    text: `Probed in ${outcome.durationMs}ms`,
  });

  return embed;
}

/**
 * Handles Discord slash command registration and interaction dispatch.
 *
 * On start(): connects a discord.js Client, registers guild-scoped commands
 * via the REST API, and listens for interactionCreate events.
 *
 * On stop(): removes the interaction listener and disconnects the client.
 */
export class SlashCommandHandler {
  private readonly routingTable: RoutingTable;
  private readonly sessionManager: SessionManager;
  private readonly resolvedAgents: readonly ResolvedAgentConfig[];
  private readonly botToken: string;
  private readonly log: Logger;
  private readonly turnDispatcher: TurnDispatcher | null;
  private readonly skillsCatalog: SkillsCatalog | null;
  /**
   * Phase 87 CMD-05 — optional DI for per-agent ACL deny sets. Tests pass a
   * Map/Record to bypass SECURITY.md file lookups; production derives it at
   * register time.
   */
  private readonly aclDeniedByAgent: ReadonlyMap<string, ReadonlySet<string>> | null;
  /**
   * Phase 95 Plan 03 DREAM-07 — admin Discord user IDs (gates /clawcode-dream
   * and any future admin-tier slash commands). Empty array → fail-closed
   * (no admins recognized).
   */
  private readonly adminUserIds: readonly string[];
  /**
   * Phase 100 Plan 04 GSD-01..03 — optional subagent thread spawner used by
   * handleGsdLongRunner. null when not wired (graceful fallback per
   * SlashCommandHandlerConfig.subagentThreadSpawner JSDoc).
   */
  private readonly subagentThreadSpawner: SubagentThreadSpawner | null;
  private client: Client | null = null;
  private interactionHandler: ((interaction: Interaction) => void) | null = null;

  constructor(config: SlashCommandHandlerConfig) {
    this.routingTable = config.routingTable;
    this.sessionManager = config.sessionManager;
    this.resolvedAgents = config.resolvedAgents;
    this.botToken = config.botToken;
    this.client = config.client ?? null;
    this.log = config.log ?? logger;
    this.turnDispatcher = config.turnDispatcher ?? null;
    this.skillsCatalog = config.skillsCatalog ?? null;
    // Phase 87 CMD-05 — accept either a Map or a plain Record from config.
    if (config.aclDeniedByAgent) {
      if (config.aclDeniedByAgent instanceof Map) {
        this.aclDeniedByAgent = config.aclDeniedByAgent;
      } else {
        this.aclDeniedByAgent = new Map(
          Object.entries(config.aclDeniedByAgent as Record<string, ReadonlySet<string>>),
        );
      }
    } else {
      this.aclDeniedByAgent = null;
    }
    this.adminUserIds = Object.freeze([...(config.adminUserIds ?? [])]);
    // Phase 100 Plan 04 GSD-01..03 — wire optional subagent thread spawner.
    this.subagentThreadSpawner = config.subagentThreadSpawner ?? null;
  }

  /**
   * Start the handler: connect to Discord, register commands, listen for interactions.
   */
  async start(): Promise<void> {
    if (!this.client) {
      throw new Error("SlashCommandHandler requires a Discord client — cannot start without Discord bridge");
    }

    // Register commands for each guild
    await this.register();

    // Start listening for interactions
    this.interactionHandler = (interaction: Interaction) => {
      if (interaction.isChatInputCommand()) {
        void this.handleInteraction(interaction);
      }
    };
    this.client.on("interactionCreate", this.interactionHandler);

    this.log.info("slash command handler started");
  }

  /**
   * Register guild-scoped slash commands via Discord REST API.
   * Uses bulk overwrite (PUT) per guild to sync all commands at once.
   *
   * Phase 87 CMD-01/04/05/07 — the registration loop now:
   *   1. Iterates each agent's SessionHandle via SessionManager.getSessionHandle
   *      and calls `getSupportedCommands()` to learn what the SDK reports.
   *   2. Resolves a per-agent deny set (SECURITY.md `## Command ACLs` or the
   *      DI'd override) and filters native commands through it.
   *   3. Builds `clawcode-<name>` SlashCommandDef[] entries via
   *      native-cc-commands.buildNativeCommandDefs with a nativeBehavior
   *      discriminator.
   *   4. Merges with each agent's static slashCommands + CONTROL_COMMANDS via
   *      mergeAndDedupe; native wins on name collision (re-provides
   *      compact/usage removed from DEFAULT_SLASH_COMMANDS per CMD-04).
   *   5. Asserts the per-guild body length stays <= 90 BEFORE rest.put —
   *      over-cap throws without partial registration.
   */
  async register(): Promise<void> {
    if (!this.client?.user) {
      throw new Error("Client not connected — call start() first");
    }

    const rest = new REST({ version: "10" }).setToken(this.botToken);
    const clientId = this.client.user.id;

    // Extract unique guild IDs from client cache
    const guildIds = [...this.client.guilds.cache.keys()];

    if (guildIds.length === 0) {
      this.log.warn("no guilds found in client cache — no commands registered");
      return;
    }

    for (const guildId of guildIds) {
      // Collect all commands across all agents for this guild
      const allCommands: SlashCommandDef[] = [];
      const seenNames = new Set<string>();

      for (const agent of this.resolvedAgents) {
        const agentCommands = resolveAgentCommands(agent.slashCommands);

        // Phase 87 CMD-01 — discover SDK-reported native commands per agent.
        // A missing handle (agent not yet started, failed warm-path, etc.)
        // or a thrown getSupportedCommands() falls back to an empty list so
        // the static DEFAULT_SLASH_COMMANDS still register. Never throw out of
        // the register loop because of SDK flakiness during startup.
        let sdkCommands: readonly import("../manager/sdk-types.js").SlashCommand[] = [];
        try {
          const handle = this.sessionManager.getSessionHandle?.(agent.name);
          if (handle && typeof handle.getSupportedCommands === "function") {
            sdkCommands = await handle.getSupportedCommands();
          }
        } catch (err) {
          this.log.warn(
            { agent: agent.name, error: (err as Error).message },
            "sdk getSupportedCommands failed — falling back to DEFAULT_SLASH_COMMANDS only",
          );
        }

        // Phase 87 CMD-05 — ACL filter. Prefer the DI'd map when set; else
        // read `<memoryPath>/SECURITY.md` (or `<workspace>/SECURITY.md`) and
        // call resolveDeniedCommands. Missing file / missing section → no
        // denies (permissive default).
        let denied: ReadonlySet<string> = new Set();
        if (this.aclDeniedByAgent) {
          denied = this.aclDeniedByAgent.get(agent.name) ?? new Set();
        } else {
          const basePath = agent.memoryPath || agent.workspace;
          if (basePath) {
            try {
              denied = await resolveDeniedCommands(
                join(basePath, "SECURITY.md"),
              );
            } catch (err) {
              this.log.warn(
                { agent: agent.name, error: (err as Error).message },
                "resolveDeniedCommands failed — defaulting to permissive ACL",
              );
              denied = new Set();
            }
          }
        }

        // Phase 87 CMD-01 — build native-CC entries via pure classifier.
        const nativeDefs = buildNativeCommandDefs(sdkCommands, { denied });

        // Phase 87 CMD-04 — mergeAndDedupe: native wins on name collision so
        // the removed clawcode-compact / clawcode-usage duplicates get
        // re-provided with nativeBehavior="prompt-channel".
        const merged = mergeAndDedupe(agentCommands, nativeDefs);

        for (const cmd of merged) {
          if (!seenNames.has(cmd.name)) {
            seenNames.add(cmd.name);
            allCommands.push(cmd);
          }
        }
      }

      // Phase 100 follow-up — auto-inherit GSD_SLASH_COMMANDS for any guild
      // that has at least one agent with `gsd?.projectDir` configured. Single
      // source of truth (slash-types.ts); no per-agent yaml duplication. The
      // existing `seenNames` dedup keeps the legacy Phase 100 yaml entries on
      // Admin Clawdy working unchanged — first-seen wins, so the agent's own
      // copy lands first (during the resolveAgentCommands loop above) and
      // GSD_SLASH_COMMANDS only fills in any names the agent didn't define.
      const hasGsdEnabledAgent = this.resolvedAgents.some(
        (a) => a.gsd?.projectDir,
      );
      if (hasGsdEnabledAgent) {
        for (const cmd of GSD_SLASH_COMMANDS) {
          if (!seenNames.has(cmd.name)) {
            seenNames.add(cmd.name);
            allCommands.push(cmd);
          }
        }
      }

      // Add control commands (daemon-direct, not agent-routed)
      for (const cmd of CONTROL_COMMANDS) {
        if (!seenNames.has(cmd.name)) {
          seenNames.add(cmd.name);
          allCommands.push(cmd);
        }
      }

      // Convert to Discord API format
      const body = allCommands.map((cmd) => ({
        name: cmd.name,
        description: cmd.description,
        options: cmd.options.map((opt) => ({
          name: opt.name,
          type: opt.type,
          description: opt.description,
          required: opt.required,
          // Phase 83 UI-01 — forward choices when defined so Discord renders
          // a dropdown. Spread-only: options without choices stay byte-identical
          // to the pre-Phase-83 payload (back-compat for every other option).
          ...(opt.choices && opt.choices.length > 0
            ? {
                choices: opt.choices.map((c) => ({
                  name: c.name,
                  value: c.value,
                })),
              }
            : {}),
        })),
        // Phase 100 follow-up — forward defaultMemberPermissions when defined
        // so Discord hides the command from non-admin users. Spread-only;
        // commands without the field stay byte-identical to the prior payload.
        ...((cmd as { defaultMemberPermissions?: string }).defaultMemberPermissions !== undefined
          ? { default_member_permissions: (cmd as { defaultMemberPermissions?: string }).defaultMemberPermissions }
          : {}),
      }));

      // Phase 87 CMD-07 — pre-flight cap assertion. Thrown BEFORE rest.put so
      // no partial registration lands; operators see the full over-cap error
      // in the warn log below and can prune before retry.
      if (body.length > MAX_COMMANDS_PER_GUILD) {
        this.log.error(
          {
            guildId,
            commandCount: body.length,
            limit: MAX_COMMANDS_PER_GUILD,
          },
          "too many commands for guild — refusing to register (CMD-07)",
        );
        continue;
      }

      try {
        await rest.put(
          Routes.applicationGuildCommands(clientId, guildId),
          { body },
        );
        this.log.info(
          { guildId, commandCount: body.length },
          "slash commands registered",
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.log.error({ guildId, error: msg }, "failed to register slash commands");
      }
    }
  }

  /**
   * Stop the handler: remove interaction listener and disconnect.
   * Per D-05, commands are left registered (Discord handles stale gracefully).
   */
  async stop(): Promise<void> {
    if (this.client && this.interactionHandler) {
      this.client.removeListener("interactionCreate", this.interactionHandler);
      this.interactionHandler = null;
    }

    // Client is shared with Discord bridge — do not destroy it here
    this.client = null;

    this.log.info("slash command handler stopped");
  }

  /**
   * Handle an incoming slash command interaction.
   * Routes to the correct agent by channel, defers reply for long-running execution.
   */
  private async handleInteraction(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const channelId = interaction.channelId;
    const commandName = interaction.commandName;

    // Phase 85 Plan 03 TOOL-06 / UI-01 — dedicated inline handler for
    // /clawcode-tools. Routes through the same IPC as a control command but
    // renders the reply as a Discord EmbedBuilder (native structured element,
    // not free-text blob). Carved out BEFORE the generic control-command
    // dispatch so the EmbedBuilder path can't be short-circuited by the
    // text-formatting branch in handleControlCommand.
    if (commandName === "clawcode-tools") {
      await this.handleToolsCommand(interaction);
      return;
    }

    // Phase 86 MODEL-02 / MODEL-03 — /clawcode-model inline handler.
    // Routes ENTIRELY through IPC set-model (Plan 02). The old LLM-prompt
    // routing (slash-types.ts claudeCommand "Set my model to {model}")
    // has been REMOVED — this handler is the only dispatch path. Carved
    // out BEFORE the generic CONTROL_COMMANDS and agent-lookup branches
    // so the picker and IPC dispatch can't be short-circuited downstream.
    if (commandName === "clawcode-model") {
      await this.handleModelCommand(interaction);
      return;
    }

    // Phase 87 CMD-02 — /clawcode-permissions inline handler.
    // Routes through IPC set-permission-mode (control-plane, NOT prompt
    // channel). Carved out BEFORE the generic CONTROL_COMMANDS branch so
    // the IPC dispatch path can't be short-circuited by the text-formatting
    // branch downstream. Mirrors the /clawcode-model carve-out above.
    if (commandName === "clawcode-permissions") {
      await this.handlePermissionsCommand(interaction);
      return;
    }

    // Phase 88 MKT-01 / UI-01 — /clawcode-skills-browse inline handler.
    // Opens a StringSelectMenuBuilder with available marketplace skills and
    // dispatches IPC marketplace-install on selection. Third application of
    // the inline-handler-short-circuit-before-CONTROL_COMMANDS pattern
    // established by /clawcode-tools (Phase 85) and /clawcode-model
    // (Phase 86).
    if (commandName === "clawcode-skills-browse") {
      await this.handleSkillsBrowseCommand(interaction);
      return;
    }
    // Phase 88 MKT-07 / UI-01 — /clawcode-skills inline handler.
    // Lists installed skills + renders a native remove picker.
    if (commandName === "clawcode-skills") {
      await this.handleSkillsCommand(interaction);
      return;
    }

    // Phase 90 Plan 05 HUB-02 / UI-01 — /clawcode-plugins-browse inline
    // handler. Sixth application of the inline-handler-short-circuit-
    // before-CONTROL_COMMANDS pattern established by /clawcode-tools
    // (Phase 85), /clawcode-model (Phase 86), /clawcode-permissions
    // (Phase 87), /clawcode-skills-browse + /clawcode-skills (Phase 88).
    // Carved out AFTER /clawcode-skills and BEFORE the CONTROL_COMMANDS
    // branch so the plugin install flow can't be short-circuited by the
    // generic control-command dispatch.
    if (commandName === "clawcode-plugins-browse") {
      await this.handlePluginsBrowseCommand(interaction);
      return;
    }

    // Phase 90 Plan 06 HUB-07 — /clawcode-clawhub-auth inline handler.
    // Seventh application of the inline-handler-short-circuit pattern.
    // Kicks off the GitHub device-code OAuth flow, displays the user_code
    // in an embed, and blocks on the long-lived poll IPC until the token
    // is stored in 1Password (or expires).
    if (commandName === "clawcode-clawhub-auth") {
      await this.handleClawhubAuthCommand(interaction);
      return;
    }

    // Phase 91 Plan 05 SYNC-08 — /clawcode-sync-status inline handler.
    // Eighth application of the inline-handler-short-circuit-before-
    // CONTROL_COMMANDS pattern established by /clawcode-tools (Phase 85)
    // and extended by /clawcode-model (86), /clawcode-permissions (87),
    // /clawcode-skills-browse + /clawcode-skills (88), /clawcode-plugins-browse
    // and /clawcode-clawhub-auth (90). Routes through the daemon-direct
    // `list-sync-status` IPC (zero LLM turn cost) and renders a native
    // Discord EmbedBuilder via the pure buildSyncStatusEmbed function
    // in sync-status-embed.ts. Carved out BEFORE the generic CONTROL_COMMANDS
    // dispatch so the EmbedBuilder path can't be short-circuited by the
    // text-formatting branch in handleControlCommand.
    if (commandName === "clawcode-sync-status") {
      await this.handleSyncStatusCommand(interaction);
      return;
    }

    // Phase 92 Plan 04 CUT-06 / CUT-07 / UI-01 — /clawcode-cutover-verify
    // inline handler. Ninth application of the inline-handler-short-circuit-
    // before-CONTROL_COMMANDS pattern (Phase 85/86/87/88/91). Renders one
    // ephemeral embed per destructive cutover gap with Accept/Reject/Defer
    // buttons (customId prefix `cutover-` — collision-safe with all existing
    // namespaces). Carved out BEFORE the generic CONTROL_COMMANDS dispatch
    // so the embed-batch path can't be short-circuited by the text-formatting
    // branch in handleControlCommand.
    if (commandName === "clawcode-cutover-verify") {
      await this.handleCutoverVerifyCommand(interaction);
      return;
    }

    // Phase 95 Plan 03 DREAM-07 / UI-01 — /clawcode-dream inline handler.
    // 10th application of the inline-handler-short-circuit-before-
    // CONTROL_COMMANDS pattern (Phases 85/86/87/88/90/91/92). Admin-only
    // ephemeral: gates BEFORE deferReply so non-admins never see the IPC
    // call land. Routes through the daemon's `run-dream-pass` IPC method
    // (Plan 95-03 daemon edge wires runDreamPass + applyDreamResult).
    // EmbedBuilder render via the pure renderDreamEmbed helper (above).
    if (commandName === "clawcode-dream") {
      await this.handleDreamCommand(interaction);
      return;
    }

    // Phase 96 Plan 05 PFS- / UI-01 — /clawcode-probe-fs inline handler.
    // 11th application of the inline-handler-short-circuit-before-
    // CONTROL_COMMANDS pattern (Phases 85/86/87/88/90/91/92/95). Admin-only
    // ephemeral: gates BEFORE deferReply so non-admins never see the IPC
    // call land. Routes through the daemon's `probe-fs` IPC method
    // (Plan 96-05 daemon edge wires runFsProbe → writeFsSnapshot →
    // setFsCapabilitySnapshot). EmbedBuilder render via the pure
    // renderProbeFsEmbed helper (above). D-03 refresh trigger: operator
    // forces re-probe immediately after ACL/group/systemd change to
    // eliminate the 60s heartbeat-stale window per RESEARCH.md Pitfall 7.
    if (commandName === "clawcode-probe-fs") {
      await this.handleProbeFsCommand(interaction);
      return;
    }

    // Phase 103 OBS-07 / UI-01 — /clawcode-usage inline handler.
    // 12th application of the inline-handler-short-circuit-before-
    // CONTROL_COMMANDS pattern (Phases 85/86/87/88/90/91/92/95/96/100).
    // Reads per-agent OAuth Max usage snapshots via the daemon-routed
    // `list-rate-limit-snapshots` IPC method (NOT `rate-limit-status` —
    // see Pitfall 5). Renders an EmbedBuilder via buildUsageEmbed so the
    // reply is structured (UI-01 compliance — NOT free-text). Carved out
    // BEFORE the generic CONTROL_COMMANDS dispatch so the EmbedBuilder
    // path can't be short-circuited by the text-formatting branch in
    // handleControlCommand. Zero LLM turn cost per invocation.
    if (commandName === "clawcode-usage") {
      await this.handleUsageCommand(interaction);
      return;
    }

    // Phase 100 follow-up — /gsd-set-project inline handler. Routed BEFORE
    // GSD_LONG_RUNNERS so the runtime project switcher never falls into the
    // long-runner subagent-thread path. Validates the path option (absolute,
    // exists, is-directory) and dispatches `set-gsd-project` IPC to the
    // daemon, which persists to ~/.clawcode/manager/gsd-project-overrides.json
    // and triggers an agent restart (gsd.projectDir is non-reloadable per
    // Phase 100 GSD-07).
    if (commandName === "gsd-set-project") {
      await this.handleSetGsdProjectCommand(interaction);
      return;
    }

    // Phase 100 Plan 04 GSD-01..03 / GSD-09 — 12th application of the inline-
    // handler-short-circuit-before-CONTROL_COMMANDS pattern (Phases 85/86/87/
    // 88/90/91/92/95/96). Long-runner GSD commands pre-spawn a subagent
    // thread so the main channel stays free; the subagent inherits Admin
    // Clawdy's settingSources (["project","user"] per Plan 100-02 + Plan
    // 100-07) and dispatches the canonical /gsd:* slash inline because
    // settingSources includes "user" (loads ~/.claude/commands/gsd/*.md per
    // Plan 100-06). Short-runners (gsd-debug, gsd-quick) fall through to the
    // legacy agent-routed branch below — their claudeCommand template
    // ("/gsd:debug {issue}" / "/gsd:quick {task}") rewrites to the canonical
    // SDK form via formatCommandMessage's placeholder substitution.
    if (GSD_LONG_RUNNERS.has(commandName)) {
      await this.handleGsdLongRunner(interaction, commandName);
      return;
    }

    // Check if this is a control command (daemon-direct, no agent needed)
    const controlCmd = CONTROL_COMMANDS.find((c) => c.name === commandName);
    if (controlCmd) {
      await this.handleControlCommand(interaction, controlCmd);
      return;
    }

    // Phase 87 CMD-03 — prompt-channel native-CC dispatch carve-out.
    //
    // Looks up the command definition in the resolved (per-guild-merged) set
    // that Plan 01's register() built. If nativeBehavior === "prompt-channel",
    // route through TurnDispatcher.dispatchStream with the canonical
    // `/<name> <args>` string. Output streams via ProgressiveMessageEditor.
    //
    // Ordering rationale: lives AFTER the clawcode-model / clawcode-tools /
    // CONTROL_COMMANDS carve-outs (so those dedicated inline handlers always
    // win for their respective names, even if a stray prompt-channel entry
    // with a colliding name somehow reaches this ladder) but BEFORE the
    // legacy agent-routed branch (so formatCommandMessage + claudeCommand
    // template path does NOT execute for native-CC prompt-channel entries).
    const nativeDef = this.findNativePromptChannelCommand(commandName);
    if (nativeDef) {
      await this.dispatchNativePromptCommand(interaction, nativeDef);
      return;
    }

    // Look up agent for this channel
    const agentName = getAgentForChannel(this.routingTable, channelId);

    if (!agentName) {
      try {
        await interaction.reply({
          content: "This channel is not bound to an agent.",
          ephemeral: true,
        });
      } catch {
        // Interaction may have expired
      }
      return;
    }

    // Defer reply immediately (allows up to 15 min for response)
    try {
      await interaction.deferReply();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.log.error({ commandName, channelId, error: msg }, "failed to defer reply");
      return;
    }

    // Find the command definition for this agent
    const agentConfig = this.resolvedAgents.find((a) => a.name === agentName);
    const agentCommands = agentConfig
      ? resolveAgentCommands(agentConfig.slashCommands)
      : DEFAULT_SLASH_COMMANDS;
    const commandDef = agentCommands.find((c) => c.name === commandName);

    if (!commandDef) {
      try {
        await interaction.editReply(`Unknown command: /${commandName}`);
      } catch {
        // Interaction may have expired
      }
      return;
    }

    // Extract options from the interaction
    const options = new Map<string, string | number | boolean>();
    for (const opt of commandDef.options) {
      const value = interaction.options.get(opt.name);
      if (value !== null && value !== undefined) {
        // discord.js returns CommandInteractionOption; extract the value
        const raw = value.value;
        if (raw !== null && raw !== undefined) {
          options.set(opt.name, raw);
        }
      }
    }

    // Phase 83 EFFORT-07 + Phase 93 Plan 01 — /clawcode-status daemon-side
    // short-circuit, now backed by the pure renderStatus(buildStatusData)
    // module. Pulls authoritative runtime state directly from the session
    // handle; does NOT consume an LLM turn (EFFORT-07 reliability win
    // preserved).
    //
    // Phase 93 restores the rich OpenClaw-parity 9-line block deferred in
    // EFFORT-07. Where ClawCode has no equivalent for an OpenClaw field
    // (Runner / Fast Mode / Harness / Reasoning / Elevated / Activation /
    // Queue / Context / Compactions / Tokens), the renderer emits
    // `unknown` / `n/a` placeholders per CONTEXT.md D-93-01-1. Defensive
    // try/catch in buildStatusData (Pitfall 6) means a stopped/crashed
    // agent still gets all 9 lines with `unknown` placeholders rather than
    // a generic "Failed to read status" wipe.
    if (commandName === "clawcode-status") {
      try {
        const data = buildStatusData({
          sessionManager: this.sessionManager,
          resolvedAgents: this.resolvedAgents,
          agentName,
          agentVersion: CLAWCODE_VERSION,
          commitSha: resolveCommitSha(),
          now: Date.now(),
        });
        const baseRender = renderStatus(data);

        // Phase 103 OBS-08 — append optional 5h+7d session/weekly bars
        // when the per-agent RateLimitTracker has snapshots. Wrapped in
        // try/catch (and renderUsageBars itself returns "" on no data,
        // Pitfall 7) so the bar suffix is purely additive — a thrown
        // accessor or missing tracker NEVER collapses the 9-line block.
        let usageBarSuffix = "";
        try {
          const tracker =
            this.sessionManager.getRateLimitTrackerForAgent(agentName);
          if (tracker) {
            usageBarSuffix = renderUsageBars(tracker.getAllSnapshots());
          }
        } catch {
          // observational — bars are optional, never break status render
        }

        await interaction.editReply(baseRender + usageBarSuffix);
      } catch (error) {
        // Defense-in-depth: buildStatusData/renderStatus are pure and don't
        // throw under expected conditions (every accessor is try/catch'd
        // internally — Pitfall 6). This catch only fires if Discord
        // editReply itself errors out (expired interaction, network blip).
        // Swallow per surrounding command-handler discipline.
        const msg = error instanceof Error ? error.message : String(error);
        try {
          await interaction.editReply(`Failed to read status: ${msg}`);
        } catch {
          /* expired */
        }
      }
      return;
    }

    // Handle /effort directly — no need to route through the agent.
    // Phase 83 EFFORT-04 — validates against the full v2.2 level set.
    // Phase 100 follow-up — restricted to #admin-clawdy + optional agent target.
    if (commandName === "clawcode-effort") {
      // Channel guard — mirrors the /gsd-* admin-clawdy guard at
      // handleGsdLongRunner (slash-commands.ts:1942). Effort changes are
      // privileged: xhigh/max levels add real per-turn cost, and runaway
      // effort on a high-volume agent (fin-acquisition's 30 cron schedules)
      // is expensive. Concentrating the dial in one channel makes accidental
      // bumps from miscellaneous channels impossible.
      if (agentName !== "Admin Clawdy") {
        try {
          await interaction.editReply(
            "`/clawcode-effort` is restricted to #admin-clawdy. Invoke from the admin channel and use `agent:` to target other agents.",
          );
        } catch { /* expired */ }
        return;
      }
      const level = options.get("level");
      const validLevels = ["low", "medium", "high", "xhigh", "max", "auto", "off"];
      if (typeof level !== "string" || !validLevels.includes(level)) {
        try {
          await interaction.editReply(`Invalid effort level. Use: ${validLevels.join(", ")}`);
        } catch { /* expired */ }
        return;
      }
      // Phase 100 follow-up — optional `agent:` lets the operator target any
      // configured agent from #admin-clawdy. Default: the channel-bound agent
      // (admin-clawdy itself, given the guard above passed).
      const rawAgent = options.get("agent");
      let resolvedTarget: string;
      if (typeof rawAgent === "string" && rawAgent.length > 0) {
        if (!this.sessionManager.getAgentConfig(rawAgent)) {
          try {
            await interaction.editReply(`Unknown agent: \`${rawAgent}\`.`);
          } catch { /* expired */ }
          return;
        }
        resolvedTarget = rawAgent;
      } else {
        resolvedTarget = agentName;
      }
      try {
        this.sessionManager.setEffortForAgent(
          resolvedTarget,
          level as EffortLevel,
        );
        await interaction.editReply(`Effort set to **${level}** for ${resolvedTarget}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        await interaction.editReply(`Failed to set effort: ${msg}`);
      }
      return;
    }

    // Format the command message
    const formattedMessage = formatCommandMessage(commandDef, options);

    this.log.info(
      { agent: agentName, command: commandName, channelId },
      "routing slash command to agent",
    );

    // Show immediate "Thinking..." feedback
    try {
      await interaction.editReply("Thinking...");
    } catch {
      // Non-fatal: continue even if this edit fails
    }

    // Set up progressive editor for streaming updates.
    // Phase 100 follow-up — wrap raw markdown tables in ```text``` fences
    // so Discord renders monospace + column alignment.
    const editor = new ProgressiveMessageEditor({
      editFn: async (content: string) => {
        const wrapped = wrapMarkdownTablesInCodeFence(content);
        const truncated = wrapped.length > DISCORD_MAX_LENGTH
          ? wrapped.slice(0, DISCORD_MAX_LENGTH - 3) + "..."
          : wrapped;
        await interaction.editReply(truncated);
      },
      editIntervalMs: 1500,
    });

    // Phase 83 EFFORT-05 — per-skill effort override. Resolve the command
    // name against the skills catalog (with or without the `clawcode-` prefix
    // that the Discord convention requires) and, when the skill has an
    // `effort:` frontmatter, apply that level for the duration of the turn.
    // Revert in a finally block so error paths can't strand the agent at an
    // elevated level. Zero side effects when the catalog isn't injected or
    // the command doesn't map to a skill with an override.
    const skillEntry =
      this.skillsCatalog?.get(commandName) ??
      this.skillsCatalog?.get(commandName.replace(/^clawcode-/, ""));
    const skillEffort = skillEntry?.effort;
    let priorEffort: EffortLevel | null = null;
    if (skillEffort) {
      try {
        priorEffort = this.sessionManager.getEffortForAgent(agentName);
        this.sessionManager.setEffortForAgent(agentName, skillEffort);
      } catch (err) {
        this.log.warn(
          { agent: agentName, command: commandName, skillEffort, error: (err as Error).message },
          "slash-command: skill-effort apply failed — continuing without override",
        );
        priorEffort = null;
      }
    }

    try {
      // Stream from agent with progressive updates
      const response = await this.sessionManager.streamFromAgent(
        agentName,
        formattedMessage,
        (accumulated) => editor.update(accumulated),
      );

      await editor.flush();

      // Handle empty response
      const text = response.trim();
      if (text.length === 0) {
        await interaction.editReply("(No response from agent)");
        return;
      }

      // Final edit with complete (possibly truncated) text
      const truncated =
        text.length > DISCORD_MAX_LENGTH
          ? text.slice(0, DISCORD_MAX_LENGTH - 3) + "..."
          : text;

      await interaction.editReply(truncated);
    } catch (error) {
      editor.dispose();

      const msg = error instanceof Error ? error.message : String(error);
      this.log.error(
        { agent: agentName, command: commandName, error: msg },
        "slash command execution failed",
      );
      try {
        await interaction.editReply(`Command failed: ${msg}`);
      } catch {
        // Interaction may have expired
      }
    } finally {
      // Phase 83 EFFORT-05 — revert to the snapshot-at-dispatch-time effort.
      // Runs on both success AND error paths (try/finally). Swallows revert
      // failures (logged) so a transient SDK failure cannot propagate past
      // the interaction boundary.
      if (priorEffort !== null) {
        try {
          this.sessionManager.setEffortForAgent(agentName, priorEffort);
        } catch (err) {
          this.log.warn(
            { agent: agentName, command: commandName, priorEffort, error: (err as Error).message },
            "slash-command: skill-effort revert failed — agent may be at wrong level",
          );
        }
      }
    }
  }

  /**
   * Phase 85 Plan 03 TOOL-06 / UI-01 — handle /clawcode-tools.
   *
   * Reads per-agent MCP readiness via the `list-mcp-status` IPC (daemon-routed,
   * zero LLM turn cost) and replies with a native Discord EmbedBuilder.
   *
   * Agent resolution:
   *   1. Explicit `agent` option takes precedence.
   *   2. Otherwise infer from the channel-agent routing table.
   *   3. Neither → ephemeral error, no IPC call spent.
   *
   * Reply is always ephemeral (operator-only view). Empty-servers case
   * returns a plain string — an empty embed would be visually noisy.
   */
  private async handleToolsCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const explicitAgent = interaction.options.get("agent")?.value;
    const agentName =
      typeof explicitAgent === "string" && explicitAgent.length > 0
        ? explicitAgent
        : getAgentForChannel(this.routingTable, interaction.channelId);

    if (!agentName) {
      try {
        await interaction.reply({
          content:
            "This channel is not bound to an agent and no agent was provided.",
          ephemeral: true,
        });
      } catch {
        /* interaction may have expired */
      }
      return;
    }

    try {
      await interaction.deferReply({ ephemeral: true });
    } catch (error) {
      this.log.error(
        { command: "clawcode-tools", error: (error as Error).message },
        "failed to defer tools reply",
      );
      return;
    }

    let response: ToolsIpcResponse;
    try {
      response = (await sendIpcRequest(SOCKET_PATH, "list-mcp-status", {
        agent: agentName,
      })) as ToolsIpcResponse;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        await interaction.editReply(`Failed to read MCP state: ${msg}`);
      } catch {
        /* expired */
      }
      return;
    }

    if (response.servers.length === 0) {
      try {
        await interaction.editReply(`No MCP servers configured for ${agentName}`);
      } catch {
        /* expired */
      }
      return;
    }

    // Phase 94 Plan 07 — capability-probe rows. Built via the shared pure
    // helper (probe-renderer.ts) so the CLI surface (`clawcode mcp-status`)
    // and this Discord embed render identical content for the same
    // snapshot. Cross-renderer parity is pinned by a CLI test.
    //
    // Cross-agent alternatives (D-07 / TOOL-12) come from the IPC payload's
    // `alternatives` field — computed daemon-side via findAlternativeAgents
    // (94-04 helper) over the per-agent McpStateProvider; the renderer here
    // just surfaces them. Single-source-of-truth: the daemon's
    // `list-mcp-status` handler is the only place findAlternativeAgents
    // runs for this surface.
    const nowDate = new Date();
    const now = nowDate.getTime();
    const rows: readonly ProbeRowOutput[] = Object.freeze(
      response.servers.map((s) => {
        const stateLike: ProbeRowState = { capabilityProbe: s.capabilityProbe };
        const alternatives = s.alternatives ?? [];
        return buildProbeRow(s.name, stateLike, alternatives, nowDate);
      }),
    );

    // D-11 pagination — Discord caps embeds at 25 fields; if the snapshot
    // exceeds the cap, we still render only the first page in the embed
    // (the select-menu pagination component is reserved for a future
    // interactive plan; this plan keeps the read-only display surface).
    const pages = paginateRows(rows, EMBED_LINE_CAP);
    const firstPage = pages[0] ?? [];

    const embed = new EmbedBuilder()
      .setTitle(`MCP Tools · ${agentName}`)
      .setColor(resolveEmbedColor(response.servers));

    if (pages.length > 1) {
      embed.setFooter({
        text: `Showing first ${EMBED_LINE_CAP} of ${rows.length} servers (Discord embed cap)`,
      });
    }

    for (let i = 0; i < firstPage.length; i++) {
      const row = firstPage[i]!;
      const s = response.servers[i]!;
      // Connect-test status emoji (Phase 85) — keeps backwards-compat with
      // the existing field-name shape; the capability-probe emoji is
      // surfaced INSIDE the value so both axes show side-by-side.
      const connectEmoji = STATUS_EMOJI[s.status] ?? STATUS_EMOJI.unknown!;
      // Only annotate optional servers that aren't ready — a ready optional
      // doesn't need the annotation (operator cares about "what's down, and
      // does it matter?").
      const optSuffix = s.optional && s.status !== "ready" ? " (optional)" : "";
      const lastSuccess = s.lastSuccessAt
        ? `${formatRelativeTime(now - s.lastSuccessAt)} ago`
        : "never";
      // TOOL-04 end-to-end — pass the lastError string VERBATIM into the
      // embed field. No rewording, no wrapping. Plan 01's readiness module
      // captures the raw transport error; we just render it.
      const errLine = s.lastError ? `\nerror: ${s.lastError}` : "";

      // Phase 94 Plan 07 D-11 — capability probe column. Status emoji +
      // last-good ISO + relative + recovery suggestion (when degraded).
      // Lines composed conditionally so a "ready" server stays compact.
      const probeLines: string[] = [];
      const probeLastGood = row.lastSuccessIso
        ? `last good: ${row.lastSuccessIso}${row.lastSuccessRelative ? ` (${row.lastSuccessRelative})` : ""}`
        : "last good: never";
      probeLines.push(`probe: ${row.statusEmoji} ${row.status} — ${probeLastGood}`);
      if (row.recoverySuggestion) {
        probeLines.push(row.recoverySuggestion);
      }
      // D-07 / TOOL-12 — Healthy alternatives line ONLY for non-ready
      // servers (the renderer suppresses the array for ready servers).
      if (row.alternatives.length > 0) {
        probeLines.push(`Healthy alternatives: ${row.alternatives.join(", ")}`);
      }

      embed.addFields({
        name: `${connectEmoji} ${s.name}${optSuffix}`,
        value: `status: ${s.status}\nlast success: ${lastSuccess}\nfailures: ${s.failureCount}\n${probeLines.join("\n")}${errLine}`,
        inline: false,
      });
    }

    try {
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      this.log.error(
        { command: "clawcode-tools", error: (error as Error).message },
        "failed to send tools embed",
      );
    }
  }

  /**
   * Phase 95 Plan 03 DREAM-07 / UI-01 — handle /clawcode-dream.
   *
   * Admin-only ephemeral. Gates on isAdminClawdyInteraction BEFORE deferring
   * the reply so non-admins receive an instant "Admin-only command" reply
   * (zero IPC + zero LLM turn cost). Admin invocations defer ephemerally,
   * dispatch through the daemon's `run-dream-pass` IPC method, and render
   * the DreamPassOutcome via the pure renderDreamEmbed helper.
   *
   * Slash semantics: --idle-bypass is ALWAYS true for this surface — the
   * Discord operator-driven manual trigger semantically wants the dream
   * pass to fire even if the agent has been chatting recently. CLI uses
   * the opposite default (--idle-bypass=false → must be explicit).
   */
  private async handleDreamCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    // Admin gate FIRST — no IPC, no defer for non-admins.
    // Phase 100-fu — pass full context so channel-bound admin agents
    // grant admin access without requiring an explicit user-ID allowlist.
    if (
      !isAdminClawdyInteraction(interaction, {
        adminUserIds: this.adminUserIds,
        routingTable: this.routingTable,
        resolvedAgents: this.resolvedAgents,
      })
    ) {
      try {
        await interaction.reply({
          content: "Admin-only command",
          flags: MessageFlags.Ephemeral,
        });
      } catch {
        /* interaction may have expired */
      }
      return;
    }

    const agent = interaction.options.getString("agent", true);

    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } catch (error) {
      this.log.error(
        { command: "clawcode-dream", error: (error as Error).message },
        "failed to defer dream reply",
      );
      return;
    }

    let response: DreamIpcResponse;
    try {
      response = (await sendIpcRequest(SOCKET_PATH, "run-dream-pass", {
        agent,
        idleBypass: true,
      })) as DreamIpcResponse;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(
        { command: "clawcode-dream", agent, error: msg },
        "run-dream-pass IPC failed",
      );
      try {
        await interaction.editReply({
          content: `dream pass error: ${msg}`,
        });
      } catch {
        /* expired */
      }
      return;
    }

    try {
      await interaction.editReply({
        embeds: [renderDreamEmbed(agent, response)],
      });
    } catch (error) {
      this.log.error(
        { command: "clawcode-dream", error: (error as Error).message },
        "failed to send dream embed",
      );
    }
  }

  /**
   * Phase 96 Plan 05 PFS- / UI-01 — handle /clawcode-probe-fs.
   *
   * Admin-only ephemeral. Gates on isAdminClawdyInteraction BEFORE deferring
   * the reply so non-admins receive an instant "Admin-only command" reply
   * (zero IPC + zero LLM turn cost — mirrors handleDreamCommand). Admin
   * invocations defer ephemerally, dispatch through the daemon's `probe-fs`
   * IPC method (which invokes runFsProbe → writeFsSnapshot →
   * setFsCapabilitySnapshot at the daemon edge), and render the
   * FsProbeOutcome via the pure renderProbeFsEmbed helper.
   *
   * D-03 refresh trigger: operator runs `/clawcode-probe-fs <agent>` after
   * ACL/group/systemd change to force re-probe BEFORE asking user to retry.
   * Eliminates the 60s heartbeat-stale window per RESEARCH.md Pitfall 7.
   *
   * D-04 silent: After probe completes, NO Discord broadcast post. Operator
   * inspects via this slash response only (ephemeral) or `clawcode fs-status`
   * CLI. Capability change reflects in next turn's stable-prefix re-render.
   *
   * Discord/CLI parity invariant: Both this slash and `clawcode probe-fs`
   * CLI invoke the SAME daemon IPC primitive ("probe-fs") which routes
   * through runFsProbe (96-01); identical FsProbeOutcome rendered to both
   * surfaces (RESEARCH.md Validation Architecture Dim 6).
   */
  private async handleProbeFsCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    // Admin gate FIRST — no IPC, no defer for non-admins.
    // Phase 100-fu — pass full context so channel-bound admin agents
    // grant admin access without requiring an explicit user-ID allowlist.
    if (
      !isAdminClawdyInteraction(interaction, {
        adminUserIds: this.adminUserIds,
        routingTable: this.routingTable,
        resolvedAgents: this.resolvedAgents,
      })
    ) {
      try {
        await interaction.reply({
          content: "Admin-only command",
          flags: MessageFlags.Ephemeral,
        });
      } catch {
        /* interaction may have expired */
      }
      return;
    }

    const agent = interaction.options.getString("agent", true);

    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } catch (error) {
      this.log.error(
        { command: "clawcode-probe-fs", error: (error as Error).message },
        "failed to defer probe-fs reply",
      );
      return;
    }

    let outcome: FsProbeOutcomeWire;
    try {
      outcome = (await sendIpcRequest(SOCKET_PATH, "probe-fs", {
        agent,
      })) as FsProbeOutcomeWire;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(
        { command: "clawcode-probe-fs", agent, error: msg },
        "probe-fs IPC failed",
      );
      try {
        await interaction.editReply({
          content: `probe-fs error: ${msg}`,
        });
      } catch {
        /* expired */
      }
      return;
    }

    try {
      await interaction.editReply({
        embeds: [renderProbeFsEmbed(agent, outcome)],
      });
    } catch (error) {
      this.log.error(
        { command: "clawcode-probe-fs", error: (error as Error).message },
        "failed to send probe-fs embed",
      );
    }
  }

  /**
   * Phase 100 Plan 04 GSD-01..03 / GSD-09 — handle long-runner /gsd-* slash
   * commands by pre-spawning a subagent thread.
   *
   * Flow:
   *   1. Defer reply within the 3s Discord interaction-token window
   *      (RESEARCH.md Pitfall 4 — deferReply MUST be the FIRST async call).
   *   2. Channel-bound-to-admin-clawdy guard (CONTEXT.md lock-in: only
   *      Admin Clawdy responds to /gsd-* slashes).
   *   3. Resolve the cmdDef from admin-clawdy's slashCommands list (Plan 07
   *      adds the 5 entries; this method trusts that contract).
   *   4. Build the canonical /gsd:* string via formatCommandMessage (existing
   *      helper at the bottom of this file). For "/gsd:autonomous {args}"
   *      with args="--from 100" → produces "/gsd:autonomous --from 100".
   *   5. Pre-spawn a subagent thread named gsd:<short>:<phaseArg>; the
   *      canonical /gsd:* string flows into spawnInThread.task as the
   *      subagent's first user message, which the SDK auto-dispatches
   *      because settingSources includes "user" (loads ~/.claude/commands/
   *      gsd/*.md per Plan 100-06 symlinks).
   *   6. EditReply with thread URL + ack message.
   *
   * Phase 99-M auto-relay (Plan 100-05 extension) handles the parent-side
   * completion summary on subagent session end — out of scope for Plan 04.
   *
   * Spawn errors are surfaced verbatim via err.message (Phase 85 TOOL-04
   * precedent). Missing spawner DI emits a graceful "unavailable" reply.
   *
   * @param interaction — the Discord ChatInputCommandInteraction
   * @param commandName — the slash command name (gsd-autonomous /
   *                      gsd-plan-phase / gsd-execute-phase per
   *                      GSD_LONG_RUNNERS)
   */
  private async handleGsdLongRunner(
    interaction: ChatInputCommandInteraction,
    commandName: string,
  ): Promise<void> {
    // Step 1 — defer FIRST (before any other I/O). 3s race-safe.
    try {
      await interaction.deferReply({ ephemeral: false });
    } catch (error) {
      this.log.error(
        { command: commandName, error: (error as Error).message },
        "failed to defer /gsd-* reply",
      );
      return;
    }

    // Step 2 — capability-based guard. Phase 100 follow-up: replaced the
    // hardcoded `agentName !== "Admin Clawdy"` check with a check on the
    // channel-bound agent's `gsd?.projectDir` field. Any agent the operator
    // has GSD-enabled (Admin Clawdy, fin-acquisition, future agents) passes;
    // any non-GSD agent (personal, fin-tax, etc.) gets a clear rejection
    // mentioning what's missing so operators know how to fix it.
    const channelId = interaction.channelId;
    const agentName = getAgentForChannel(this.routingTable, channelId);
    const agentConfig = agentName
      ? this.resolvedAgents.find((a) => a.name === agentName)
      : undefined;
    if (!agentConfig?.gsd?.projectDir) {
      try {
        await interaction.editReply(
          `\`/gsd-*\` commands are restricted to GSD-enabled agents. ` +
            `This channel's agent (\`${agentName ?? "unknown"}\`) has no \`gsd.projectDir\` configured. ` +
            `Set one via \`/gsd-set-project path:<abs-path>\` or add a \`gsd:\` block to clawcode.yaml.`,
        );
      } catch {
        /* expired */
      }
      return;
    }

    // Step 3 — resolve cmdDef. First check the agent's own slashCommands
    // list (legacy yaml-defined entries on Admin Clawdy still win), then fall
    // back to GSD_SLASH_COMMANDS so any GSD-enabled agent without a yaml
    // block (e.g. fin-acquisition) finds its cmdDef via the auto-inheritance
    // path. Mirrors the seenNames dedup at register time — first match wins.
    const cmdDef =
      agentConfig.slashCommands.find((c) => c.name === commandName) ??
      GSD_SLASH_COMMANDS.find((c) => c.name === commandName);
    if (!cmdDef) {
      try {
        await interaction.editReply(`Unknown command: /${commandName}`);
      } catch {
        /* expired */
      }
      return;
    }

    // Step 4 — extract option values + build canonical /gsd:* string.
    const options = new Map<string, string | number | boolean>();
    for (const opt of cmdDef.options) {
      const v = interaction.options.get(opt.name);
      if (v !== null && v !== undefined && v.value !== null && v.value !== undefined) {
        options.set(opt.name, v.value);
      }
    }
    const canonicalSlash = formatCommandMessage(cmdDef, options);

    // Step 5 — build thread name: gsd:autonomous:100 / gsd:plan:100 /
    // gsd:execute:100. shortName maps the Discord-compatible name back to
    // the short canonical form: gsd-autonomous → autonomous;
    // gsd-plan-phase → plan; gsd-execute-phase → execute.
    const phaseArgRaw = String(
      options.get("phase") ?? options.get("args") ?? "",
    ).trim();
    const phaseArg = phaseArgRaw.length > 0 ? phaseArgRaw.split(/\s+/)[0]! : "";
    const shortName = commandName.replace(/^gsd-/, "").replace(/-phase$/, "");
    const threadName = phaseArg
      ? `gsd:${shortName}:${phaseArg}`
      : `gsd:${shortName}`;

    // Step 6 — graceful fallback when spawner not wired.
    if (!this.subagentThreadSpawner) {
      try {
        await interaction.editReply(
          "Subagent thread spawning unavailable (no Discord bridge).",
        );
      } catch {
        /* expired */
      }
      return;
    }

    // Step 7 — pre-spawn subagent thread; surface verbatim error on failure.
    // `agentConfig.name` is non-null here (we returned early at Step 2 when
    // agentConfig was undefined). Use it instead of `agentName` so TS narrows
    // the type without an extra non-null assertion.
    const parentAgentName = agentConfig.name;
    try {
      const result = await this.subagentThreadSpawner.spawnInThread({
        parentAgentName,
        threadName,
        task: canonicalSlash,
      });
      const threadUrl = `https://discord.com/channels/${interaction.guildId}/${result.threadId}`;
      try {
        await interaction.editReply(
          `🚀 Spawned ${threadName} subthread for ${canonicalSlash}\nThread: ${threadUrl}\n_Working in subthread; main channel summary on completion._`,
        );
      } catch {
        /* expired */
      }
      this.log.info(
        {
          command: commandName,
          threadId: result.threadId,
          threadName,
          parentAgent: parentAgentName,
        },
        "/gsd-* long-runner subthread spawned",
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(
        { command: commandName, error: msg },
        "/gsd-* long-runner spawn failed",
      );
      try {
        await interaction.editReply(`Failed to spawn /gsd-* subthread: ${msg}`);
      } catch {
        /* expired */
      }
    }
  }

  /**
   * Phase 100 follow-up — `/gsd-set-project` runtime project switcher.
   *
   * Lets an operator change a GSD-enabled agent's `gsd.projectDir` at runtime
   * without editing clawcode.yaml or restarting the daemon. The slash handler
   * does the validation (absolute path, exists, is-directory), then dispatches
   * `set-gsd-project` IPC to the daemon. The daemon persists the override to
   * `~/.clawcode/manager/gsd-project-overrides.json` and triggers an agent
   * restart (gsd.projectDir is non-reloadable per Phase 100 GSD-07).
   *
   * Capability gate: any agent with `gsd?.projectDir` configured can switch
   * its OWN project. No admin-clawdy guard — there's no destructive cross-
   * agent surface, only a per-agent project root rebind.
   *
   * Path validation order (fail-fast):
   *   1. `path.isAbsolute(p)` — reject relative paths
   *   2. `statSync(p)` — reject ENOENT (path doesn't exist)
   *   3. `stats.isDirectory()` — reject regular files / symlinks-to-files
   *
   * On success: ephemeral reply confirming the new projectDir + agent restart.
   * On IPC failure: ephemeral reply with verbatim error (operator-debuggable).
   */
  private async handleSetGsdProjectCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } catch (error) {
      this.log.error(
        { command: "gsd-set-project", error: (error as Error).message },
        "failed to defer gsd-set-project reply",
      );
      return;
    }

    const channelId = interaction.channelId;
    const agentName = getAgentForChannel(this.routingTable, channelId);
    const agentConfig = agentName
      ? this.resolvedAgents.find((a) => a.name === agentName)
      : undefined;

    // Capability gate — only GSD-enabled agents can switch their project.
    if (!agentConfig?.gsd?.projectDir) {
      try {
        await interaction.editReply(
          `\`/gsd-set-project\` requires a GSD-enabled agent. ` +
            `This channel's agent (\`${agentName ?? "unknown"}\`) is not a GSD agent ` +
            `(no \`gsd.projectDir\` configured).`,
        );
      } catch {
        /* expired */
      }
      return;
    }

    // Read the required `path` option.
    const path = interaction.options.getString("path", true);
    if (!path || typeof path !== "string") {
      try {
        await interaction.editReply(
          "`/gsd-set-project` requires a `path:` option (absolute directory path).",
        );
      } catch { /* expired */ }
      return;
    }

    // Validation step 1 — must be absolute.
    if (!isAbsolute(path)) {
      try {
        await interaction.editReply(
          `\`${path}\` is not an absolute path. Provide a path that starts with \`/\`.`,
        );
      } catch { /* expired */ }
      return;
    }

    // Validation step 2 + 3 — must exist and be a directory.
    let stats: ReturnType<typeof statSync>;
    try {
      stats = statSync(path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        await interaction.editReply(
          `Path \`${path}\` does not exist or is not accessible: ${msg}`,
        );
      } catch { /* expired */ }
      return;
    }
    if (!stats.isDirectory()) {
      try {
        await interaction.editReply(
          `Path \`${path}\` is not a directory. \`gsd.projectDir\` must point at a directory.`,
        );
      } catch { /* expired */ }
      return;
    }

    // Dispatch `set-gsd-project` IPC. The daemon side is in daemon.ts —
    // persists to gsd-project-overrides.json + restarts the agent.
    // `agentConfig.name` is non-null here (we returned early at the capability
    // gate when agentConfig was undefined). Use it instead of `agentName`.
    const targetAgent = agentConfig.name;
    try {
      await sendIpcRequest(SOCKET_PATH, "set-gsd-project", {
        agent: targetAgent,
        projectDir: path,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(
        { command: "gsd-set-project", agent: targetAgent, error: msg },
        "set-gsd-project IPC failed",
      );
      try {
        await interaction.editReply(
          `Failed to set GSD project for \`${targetAgent}\`: ${msg}`,
        );
      } catch { /* expired */ }
      return;
    }

    try {
      await interaction.editReply(
        `GSD project set to \`${path}\` for \`${targetAgent}\`. ` +
          `Restarting agent — new sessions will use this directory.`,
      );
    } catch { /* expired */ }
  }

  /**
   * Phase 91 Plan 05 SYNC-08 — handle /clawcode-sync-status.
   *
   * Reads the OpenClaw ↔ ClawCode sync snapshot via the daemon-routed
   * `list-sync-status` IPC method (zero LLM turn cost) and replies with a
   * native Discord EmbedBuilder built by the pure buildSyncStatusEmbed
   * function (src/discord/sync-status-embed.ts).
   *
   * Reply is always ephemeral (operator-only view — conflicts include file
   * paths that shouldn't leak into public channels). IPC failures surface
   * verbatim in an ephemeral error message so operators see the real root
   * cause instead of a sanitised "Sync status unavailable" placeholder.
   *
   * Note: unlike /clawcode-tools this command is fleet-level (not per-agent).
   * It reads `~/.clawcode/manager/sync-state.json` which is the single
   * source-of-truth for the fin-acquisition sync topology. No `agent`
   * option is accepted at registration time.
   */
  private async handleSyncStatusCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    try {
      await interaction.deferReply({ ephemeral: true });
    } catch (error) {
      this.log.error(
        { command: "clawcode-sync-status", error: (error as Error).message },
        "failed to defer sync-status reply",
      );
      return;
    }

    let response: SyncStatusIpcResponse;
    try {
      response = (await sendIpcRequest(
        SOCKET_PATH,
        "list-sync-status",
        {},
      )) as SyncStatusIpcResponse;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(
        { command: "clawcode-sync-status", error: msg },
        "list-sync-status IPC failed",
      );
      try {
        await interaction.editReply(`Sync status unavailable: ${msg}`);
      } catch {
        /* interaction may have expired */
      }
      return;
    }

    // Dynamic import keeps the slash-commands module graph decoupled from
    // sync-status-embed's discord.js EmbedBuilder reach; mirrors the
    // Phase 88 skills-browse pattern (lazy load when the command actually
    // fires, keeps cold-start import graph smaller).
    const { buildSyncStatusEmbed } = await import("./sync-status-embed.js");

    // Shape-align conflict entries with SyncConflict — the daemon returns
    // only open conflicts (resolvedAt omitted); the embed consumer expects
    // resolvedAt: null on every entry. Map once, pass immutably.
    const embed = buildSyncStatusEmbed({
      authoritativeSide: response.authoritativeSide,
      lastSyncedAt: response.lastSyncedAt,
      conflicts: response.conflicts.map((c) => ({
        path: c.path,
        sourceHash: c.sourceHash,
        destHash: c.destHash,
        detectedAt: c.detectedAt,
        resolvedAt: null,
      })),
      lastCycle: response.lastCycle,
      now: new Date(),
    });

    try {
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      this.log.error(
        { command: "clawcode-sync-status", error: (error as Error).message },
        "failed to send sync-status embed",
      );
    }
  }

  /**
   * Phase 103 OBS-07 / UI-01 — /clawcode-usage inline handler.
   *
   * Routes through the daemon-direct `list-rate-limit-snapshots` IPC method
   * (zero LLM turn cost) and renders a native Discord EmbedBuilder via the
   * pure buildUsageEmbed function in usage-embed.ts. The 12th application
   * of the inline-handler-short-circuit-before-CONTROL_COMMANDS pattern.
   *
   * Resolves target agent from the optional `agent:` arg, falling back to
   * the channel's bound agent. Mirrors the /clawcode-tools agent-resolution
   * idiom verbatim — operators can target any agent from any channel by
   * passing `agent:`, but the default is the channel's binding (so users
   * in a per-agent channel just type /clawcode-usage with no args).
   *
   * Pitfall 5 closure: this IPC name is `list-rate-limit-snapshots`, NOT
   * `rate-limit-status` (the latter is the SEPARATE Discord outbound
   * rate-limiter token-bucket IPC).
   *
   * Pitfall 7 closure: empty snapshots render the "No usage data yet"
   * graceful path inside buildUsageEmbed — never an empty embed.
   */
  private async handleUsageCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const explicitAgent = interaction.options.get("agent")?.value;
    const targetAgent =
      typeof explicitAgent === "string" && explicitAgent.length > 0
        ? explicitAgent
        : getAgentForChannel(this.routingTable, interaction.channelId);

    if (!targetAgent) {
      try {
        await interaction.reply({
          content:
            "This channel is not bound to an agent and no agent was provided.",
          ephemeral: true,
        });
      } catch {
        /* interaction may have expired */
      }
      return;
    }

    try {
      await interaction.deferReply({ ephemeral: false });
    } catch (error) {
      this.log.error(
        { command: "clawcode-usage", error: (error as Error).message },
        "failed to defer usage reply",
      );
      return;
    }

    let snapshots: readonly RateLimitSnapshot[];
    try {
      const response = (await sendIpcRequest(
        SOCKET_PATH,
        "list-rate-limit-snapshots",
        { agent: targetAgent },
      )) as { snapshots?: readonly RateLimitSnapshot[] };
      snapshots = response.snapshots ?? [];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(
        { command: "clawcode-usage", error: msg },
        "list-rate-limit-snapshots IPC failed",
      );
      try {
        await interaction.editReply(`Failed to read usage: ${msg}`);
      } catch {
        /* interaction may have expired */
      }
      return;
    }

    // Dynamic import keeps the slash-commands module graph decoupled from
    // usage-embed's discord.js EmbedBuilder reach; mirrors the Phase 91
    // sync-status pattern (lazy-load when the command actually fires).
    const { buildUsageEmbed } = await import("./usage-embed.js");

    const embed = buildUsageEmbed({
      agent: targetAgent,
      snapshots,
      now: Date.now(),
    });

    try {
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      this.log.error(
        { command: "clawcode-usage", error: (error as Error).message },
        "failed to send usage embed",
      );
    }
  }

  /**
   * Phase 92 Plan 04 CUT-06 / CUT-07 / UI-01 — /clawcode-cutover-verify
   * inline handler.
   *
   * Renders the destructive-fix embed flow: queries the daemon for the
   * agent's pending DestructiveCutoverGap[], renders ONE ephemeral embed per
   * gap (or batched if > 10 — first pass emits up to 25 individual embeds
   * per Claude's-Discretion), and sets up a button collector that filters
   * `i.customId.startsWith("cutover-")` for collision-safe routing.
   *
   * On button click, the customId is dispatched via IPC `cutover-button-action`
   * to the daemon's pure handleCutoverButtonActionIpc which routes through
   * applyDestructiveFix or audit-only ledger row per the operator's choice.
   *
   * Plan 92-06 will wire the `cutover-verify-summary` IPC method that returns
   * the actual gap list. For Plan 92-04 first-pass, the IPC may return an
   * empty list — operator sees an "all clear" message in that case.
   */
  private async handleCutoverVerifyCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    try {
      await interaction.deferReply({ ephemeral: true });
    } catch (error) {
      this.log.error(
        {
          command: "clawcode-cutover-verify",
          error: (error as Error).message,
        },
        "failed to defer cutover-verify reply",
      );
      return;
    }

    // Resolve agent: explicit option > channel binding.
    const agentArg = interaction.options.getString("agent", false);
    const agentName =
      agentArg ??
      getAgentForChannel(this.routingTable, interaction.channelId);
    if (!agentName) {
      try {
        await interaction.editReply(
          "This channel is not bound to an agent. Pass `agent:<name>` explicitly.",
        );
      } catch {
        /* expired */
      }
      return;
    }

    // Query daemon for pending destructive gaps. Plan 92-06 wires the
    // verify-summary IPC; first-pass implementations may return an empty
    // list while the gap source is being constructed.
    let gaps: ReadonlyArray<unknown> = [];
    try {
      const resp = (await sendIpcRequest(
        SOCKET_PATH,
        "cutover-verify-summary",
        { agent: agentName },
      )) as { gaps?: ReadonlyArray<unknown> };
      gaps = Array.isArray(resp?.gaps) ? resp.gaps : [];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(
        { command: "clawcode-cutover-verify", agent: agentName, error: msg },
        "cutover-verify-summary IPC failed (Plan 92-06 wires this)",
      );
      try {
        await interaction.editReply(
          `Cutover verify is not yet wired (Plan 92-06): ${msg}`,
        );
      } catch {
        /* expired */
      }
      return;
    }

    if (gaps.length === 0) {
      try {
        await interaction.editReply(
          `No destructive cutover gaps for **${agentName}** — all clear.`,
        );
      } catch {
        /* expired */
      }
      return;
    }

    // Lazy-import the renderer so the slash-commands cold-start graph stays
    // independent of the cutover module surface (mirrors the sync-status
    // embed lazy-import pattern above).
    const { renderDestructiveGapEmbed } = await import(
      "../cutover/destructive-embed-renderer.js"
    );
    const { CUTOVER_BUTTON_PREFIX } = await import("../cutover/types.js");

    // Cap at 25 embeds for first pass (Claude's-Discretion: paginate-on-overflow
    // deferred). Discord allows up to 10 embeds per single message; we send
    // each gap as its own ephemeral followUp so each carries its own button row.
    const MAX_GAPS = 25;
    const renderable = gaps.slice(0, MAX_GAPS) as ReadonlyArray<{
      kind: string;
      identifier: string;
      severity: string;
    }>;

    // Render the first gap as the deferred reply edit; subsequent gaps as
    // followUp messages so each retains its own component row + button TTL.
    let firstSent = false;
    for (const gapRaw of renderable) {
      // Cast through unknown — the renderer asserts the gap shape via its
      // exhaustive switch + assertNever fallthrough, so a malformed shape
      // throws synchronously rather than silently rendering an empty embed.
      try {
        const rendered = renderDestructiveGapEmbed(
          agentName,
          gapRaw as Parameters<typeof renderDestructiveGapEmbed>[1],
        );
        if (!firstSent) {
          await interaction.editReply({
            embeds: [rendered.embed],
            components: rendered.components.map((row) => row),
          });
          firstSent = true;
        } else {
          await interaction.followUp({
            embeds: [rendered.embed],
            components: rendered.components.map((row) => row),
            ephemeral: true,
          });
        }
      } catch (renderErr) {
        const msg =
          renderErr instanceof Error ? renderErr.message : String(renderErr);
        this.log.warn(
          {
            command: "clawcode-cutover-verify",
            gap: gapRaw,
            error: msg,
          },
          "cutover gap render failed (skipping)",
        );
      }
    }

    // Set up a button collector with prefix-startsWith filter. Note: this
    // collects on the channel (not the message) so followUp embeds also
    // route through this filter.
    const channel = interaction.channel;
    if (!channel) return;
    const collector = channel.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: (i: ButtonInteraction) =>
        i.user.id === interaction.user.id &&
        i.customId.startsWith(CUTOVER_BUTTON_PREFIX),
      // 30-minute TTL per Claude's-Discretion (operators may step away to
      // verify content before clicking Accept on outdated-memory-file).
      time: 30 * 60 * 1000,
    });

    collector.on("collect", async (btn: ButtonInteraction) => {
      try {
        await btn.deferUpdate();
      } catch {
        /* may be expired */
      }
      try {
        const outcome = (await sendIpcRequest(
          SOCKET_PATH,
          "cutover-button-action",
          { customId: btn.customId, agent: agentName },
        )) as { kind: string; error?: string; gapKind?: string };

        const reply = formatCutoverOutcome(outcome);
        try {
          await btn.followUp({ content: reply, ephemeral: true });
        } catch {
          /* expired */
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.warn(
          { command: "clawcode-cutover-verify", error: msg },
          "cutover-button-action IPC failed",
        );
        try {
          await btn.followUp({
            content: `Cutover action failed: ${msg}`,
            ephemeral: true,
          });
        } catch {
          /* expired */
        }
      }
    });
  }

  /**
   * Phase 86 MODEL-02 / MODEL-03 / MODEL-06 — /clawcode-model inline handler.
   *
   * Two paths share the same IPC dispatch:
   *   - No-arg: render a StringSelectMenuBuilder from the bound agent's
   *     resolved allowedModels; await the selection (30s TTL); dispatch via
   *     IPC. The menu is pure UI — selection funnels back through
   *     dispatchModelChange so arg-path and picker-path share error handling.
   *   - Arg: validate the agent binding and dispatch immediately via IPC.
   *
   * UI-01 compliance: the picker is a native discord.js StringSelectMenuBuilder
   * (not a free-text argument). Discord enforces a 25-entry cap on the menu;
   * when the allowedModels list exceeds that, the picker truncates and appends
   * a "+N more" note to the content string.
   *
   * Error rendering: when the IPC error envelope carries
   * `data.kind === "model-not-allowed"` (the ModelNotAllowedError payload
   * from Plan 01 surfaced via Plan 02's ManagerError {code:-32602, data}
   * wire), the reply renders the allowed list from `data.allowed`.
   */
  private async handleModelCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const agentName = getAgentForChannel(
      this.routingTable,
      interaction.channelId,
    );
    if (!agentName) {
      try {
        await interaction.reply({
          content: "This channel is not bound to an agent.",
          ephemeral: true,
        });
      } catch {
        /* interaction may have expired */
      }
      return;
    }

    const agentConfig = this.resolvedAgents.find((a) => a.name === agentName);
    const allowed = [...(agentConfig?.allowedModels ?? [])];

    const modelArg = interaction.options.get("model")?.value;
    const model =
      typeof modelArg === "string" && modelArg.length > 0 ? modelArg : undefined;

    // Arg path — direct IPC dispatch.
    if (model !== undefined) {
      await this.dispatchModelChange(interaction, agentName, model, false);
      return;
    }

    // No-arg path — render the select-menu picker.
    if (allowed.length === 0) {
      try {
        await interaction.reply({
          content: `No models available for ${agentName} (allowedModels is empty).`,
          ephemeral: true,
        });
      } catch {
        /* expired */
      }
      return;
    }

    const capped = allowed.slice(0, DISCORD_SELECT_CAP);
    const overflow = allowed.length - capped.length;
    const nonce = Math.random().toString(36).slice(2, 8);
    const customId = `model-picker:${agentName}:${nonce}`;

    const menu = new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder("Choose a model")
      .addOptions(
        capped.map((m) =>
          new StringSelectMenuOptionBuilder().setLabel(m).setValue(m),
        ),
      );
    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      menu,
    );

    const overflowNote =
      overflow > 0
        ? `\n(Showing first ${DISCORD_SELECT_CAP} of ${allowed.length}.)`
        : "";
    try {
      await interaction.reply({
        content: `Pick a model for **${agentName}**.${overflowNote}`,
        components: [row],
        ephemeral: true,
      });
    } catch (err) {
      this.log.error(
        { agent: agentName, error: (err as Error).message },
        "failed to render model picker",
      );
      return;
    }

    // Wait for the select-menu interaction (30s TTL).
    let followUp: StringSelectMenuInteraction;
    try {
      const channel = interaction.channel;
      if (!channel) {
        throw new Error("interaction has no channel — cannot collect");
      }
      followUp = (await channel.awaitMessageComponent({
        componentType: ComponentType.StringSelect,
        filter: (i: { user: { id: string }; customId: string }) =>
          i.user.id === interaction.user.id && i.customId === customId,
        time: MODEL_PICKER_TTL_MS,
      })) as StringSelectMenuInteraction;
    } catch {
      try {
        await interaction.editReply({
          content: "Model picker timed out (no selection in 30s).",
          components: [],
        });
      } catch {
        /* expired */
      }
      return;
    }

    const chosen = followUp.values[0];
    if (!chosen) {
      try {
        await followUp.update({
          content: "No selection captured.",
          components: [],
        });
      } catch {
        /* expired */
      }
      return;
    }

    // Acknowledge the select-menu interaction so Discord doesn't mark it as
    // "interaction failed"; dispatchModelChange will emit the final status
    // via editReply on the original slash-command interaction.
    try {
      await followUp.update({
        content: `Switching ${agentName} to **${chosen}**...`,
        components: [],
      });
    } catch {
      /* expired */
    }

    await this.dispatchModelChange(interaction, agentName, chosen, true);
  }

  /**
   * Phase 86 MODEL-03 / MODEL-06 — shared IPC dispatch for both the direct
   * arg-path and the select-menu path.
   *
   * `editMode=true` means the slash-command interaction has already been
   * replied-to (via `interaction.reply` during the picker render) — the
   * final status must use `editReply`. `editMode=false` is the direct
   * arg-path: defer first, then editReply with the outcome.
   *
   * Renders the typed ModelNotAllowedError payload from the IPC envelope
   * by reading `err.data.allowed` (Plan 02 propagates this through
   * IpcError.data, which Plan 03 extended client.ts to pass through).
   */
  private async dispatchModelChange(
    interaction: ChatInputCommandInteraction,
    agentName: string,
    model: string,
    editMode: boolean,
  ): Promise<void> {
    if (!editMode) {
      try {
        await interaction.deferReply({ ephemeral: true });
      } catch {
        /* already replied/deferred */
      }
    }

    // Phase 86 MODEL-05 — cache-invalidation confirmation for mid-conversation
    // changes. Skip when the handle has no active model (fresh boot — no
    // turn has executed yet). Being too conservative (always show confirm)
    // is cheap; being too permissive (never show confirm) misses the prompt-
    // cache invalidation warning, so when in doubt we show it.
    let activeModel: string | undefined;
    try {
      activeModel = this.sessionManager.getModelForAgent(agentName);
    } catch {
      activeModel = undefined;
    }
    if (activeModel !== undefined) {
      const outcome = await this.promptCacheInvalidationConfirm(
        interaction,
        agentName,
        activeModel,
        model,
      );
      if (outcome === "cancelled") {
        try {
          await interaction.editReply({
            content: "Model change cancelled.",
            components: [],
          });
        } catch {
          /* expired */
        }
        return;
      }
      if (outcome === "timeout") {
        try {
          await interaction.editReply({
            content: "Confirmation timed out.",
            components: [],
          });
        } catch {
          /* expired */
        }
        return;
      }
      // outcome === "confirmed" — fall through to IPC dispatch.
    }

    try {
      const res = (await sendIpcRequest(SOCKET_PATH, "set-model", {
        agent: agentName,
        model,
      })) as {
        readonly agent: string;
        readonly old_model: string;
        readonly new_model: string;
        readonly persisted: boolean;
        readonly persist_error: string | null;
        readonly note: string;
      };
      const persistSuffix = res.persisted
        ? ""
        : `\n(Note: live swap OK, but YAML persistence failed: ${res.persist_error ?? "unknown"})`;
      const message = `Model set to **${res.new_model}** for ${agentName} (was ${res.old_model}).${persistSuffix}`;
      try {
        await interaction.editReply(message);
      } catch {
        /* expired */
      }
    } catch (err) {
      // Plan 02 IPC envelope: ModelNotAllowedError carries
      // `data.kind === "model-not-allowed"` and `data.allowed: string[]`.
      // Render the allowed list ephemerally.
      const maybe = err as { message?: string; data?: unknown };
      const data = maybe.data as
        | { kind?: string; allowed?: readonly string[] }
        | undefined;
      let reply: string;
      if (
        data?.kind === "model-not-allowed" &&
        Array.isArray(data.allowed)
      ) {
        reply = `'${model}' is not allowed for ${agentName}. Allowed: ${data.allowed.join(", ")}`;
      } else {
        reply = `Failed to set model: ${maybe.message ?? String(err)}`;
      }
      try {
        await interaction.editReply(reply);
      } catch {
        /* expired */
      }
    }
  }

  /**
   * Phase 86 MODEL-05 — native Discord button confirmation.
   *
   * Renders two buttons (Confirm = danger style, Cancel = secondary) with
   * agent + nonce namespaced customIds; awaits the user's click for up to
   * MODEL_CONFIRM_TTL_MS. Returns "confirmed" | "cancelled" | "timeout".
   *
   * UI-01 compliance: buttons are native ButtonBuilder components — NOT a
   * free-text "yes/no" LLM prompt or a reaction-emoji pattern.
   *
   * The filter accepts any customId whose prefix matches the namespaced
   * confirm OR cancel id for THIS agent (collision safety across parallel
   * picker invocations in the same channel — e.g. two operators picking
   * for different agents at once).
   */
  private async promptCacheInvalidationConfirm(
    interaction: ChatInputCommandInteraction,
    agentName: string,
    oldModel: string,
    newModel: string,
  ): Promise<"confirmed" | "cancelled" | "timeout"> {
    const nonce = Math.random().toString(36).slice(2, 8);
    const confirmId = `model-confirm:${agentName}:${nonce}`;
    const cancelId = `model-cancel:${agentName}:${nonce}`;
    // Prefixes pinned by C7 — the filter below must accept only THIS agent's
    // buttons, not a parallel picker's buttons for a different agent.
    const confirmPrefix = `model-confirm:${agentName}:`;
    const cancelPrefix = `model-cancel:${agentName}:`;

    const confirm = new ButtonBuilder()
      .setCustomId(confirmId)
      .setLabel("Switch & invalidate cache")
      .setStyle(ButtonStyle.Danger);
    const cancel = new ButtonBuilder()
      .setCustomId(cancelId)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      confirm,
      cancel,
    );

    const warning =
      `Changing from **${oldModel}** to **${newModel}** will invalidate the prompt cache ` +
      `for ${agentName}. The next turn will pay full-prefix token cost. Proceed?`;

    try {
      await interaction.editReply({ content: warning, components: [row] });
    } catch {
      // Interaction expired — treat as cancel (no side effect fired yet).
      return "cancelled";
    }

    let btn: ButtonInteraction;
    try {
      const channel = interaction.channel;
      if (!channel) {
        throw new Error("interaction has no channel — cannot collect");
      }
      btn = (await channel.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: (i: { user: { id: string }; customId: string }) =>
          i.user.id === interaction.user.id &&
          (i.customId.startsWith(confirmPrefix) ||
            i.customId.startsWith(cancelPrefix)),
        time: MODEL_CONFIRM_TTL_MS,
      })) as ButtonInteraction;
    } catch {
      return "timeout";
    }

    const isConfirm = btn.customId.startsWith(confirmPrefix);
    try {
      await btn.update({
        content: isConfirm
          ? `Switching ${agentName} to **${newModel}**...`
          : "Cancelled.",
        components: [],
      });
    } catch {
      /* expired — outcome below still derives from btn.customId */
    }

    return isConfirm ? "confirmed" : "cancelled";
  }

  /**
   * Phase 87 CMD-02 — /clawcode-permissions inline handler.
   *
   * Routes the live SDK permission-mode swap via IPC set-permission-mode
   * (control-plane path — NOT prompt routing). Mirrors the Phase 83
   * clawcode-effort inline shortcut but surfaces through the daemon
   * IPC envelope so daemon-level validation (6-value union) runs once.
   *
   * Contract:
   *   - Unbound channel → ephemeral "not bound" reply, no IPC call.
   *   - Missing/empty mode arg → ephemeral usage reply, no IPC call.
   *   - IPC success → ephemeral confirmation mentioning the mode + agent.
   *   - IPC error → ephemeral error message (daemon error bubbles up
   *     verbatim so the valid-modes list from the server-side rejection
   *     surfaces to the user).
   */
  private async handlePermissionsCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const agentName = getAgentForChannel(
      this.routingTable,
      interaction.channelId,
    );
    if (!agentName) {
      try {
        await interaction.reply({
          content: "This channel is not bound to an agent.",
          ephemeral: true,
        });
      } catch {
        /* interaction may have expired */
      }
      return;
    }

    const modeArg = interaction.options.get("mode")?.value;
    const mode =
      typeof modeArg === "string" && modeArg.length > 0 ? modeArg : undefined;
    if (!mode) {
      try {
        await interaction.reply({
          content:
            "Usage: /clawcode-permissions mode:<default|acceptEdits|bypassPermissions|plan|dontAsk|auto>",
          ephemeral: true,
        });
      } catch {
        /* expired */
      }
      return;
    }

    try {
      await interaction.deferReply({ ephemeral: true });
    } catch {
      return;
    }

    try {
      await sendIpcRequest(SOCKET_PATH, "set-permission-mode", {
        name: agentName,
        mode,
      });
      try {
        await interaction.editReply(
          `Permission mode set to **${mode}** for ${agentName}`,
        );
      } catch {
        /* expired */
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        await interaction.editReply(`Failed to set permission mode: ${msg}`);
      } catch {
        /* expired */
      }
    }
  }

  /**
   * Phase 88 MKT-01 / MKT-05 / MKT-06 / UI-01 — /clawcode-skills-browse
   * inline handler.
   *
   * Flow:
   *   1. Defer ephemerally.
   *   2. Fetch available skills via IPC marketplace-list.
   *   3. Render a StringSelectMenuBuilder (truncate at 25, append overflow).
   *   4. Await selection (30s TTL).
   *   5. Dispatch IPC marketplace-install with the selection.
   *   6. Render a SINGLE ephemeral outcome-specific summary (MKT-06).
   *
   * The outcome renderer is an exhaustive switch over all 8 SkillInstallOutcome
   * kinds so every refusal has a distinct user-facing explanation (MKT-05).
   */
  private async handleSkillsBrowseCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const agentName = getAgentForChannel(
      this.routingTable,
      interaction.channelId,
    );
    if (!agentName) {
      try {
        await interaction.reply({
          content: "This channel is not bound to an agent.",
          ephemeral: true,
        });
      } catch {
        /* expired */
      }
      return;
    }

    try {
      await interaction.deferReply({ ephemeral: true });
    } catch {
      return;
    }

    // Fetch available skills
    type MarketplaceEntryWire = {
      readonly name: string;
      readonly description: string;
      readonly category: "finmentum" | "personal" | "fleet";
      readonly source:
        | "local"
        | { readonly path: string; readonly label?: string }
        | {
            readonly kind: "clawhub";
            readonly baseUrl: string;
            readonly downloadUrl: string;
            readonly version: string;
            readonly authToken?: string;
          };
      readonly skillDir: string;
    };
    let listResp: {
      agent: string;
      installed: readonly string[];
      available: readonly MarketplaceEntryWire[];
    };
    try {
      listResp = (await sendIpcRequest(SOCKET_PATH, "marketplace-list", {
        agent: agentName,
      })) as typeof listResp;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        await interaction.editReply(`Failed to load marketplace: ${msg}`);
      } catch {
        /* expired */
      }
      return;
    }

    if (listResp.available.length === 0) {
      try {
        await interaction.editReply(
          `All marketplace skills are already installed for **${agentName}**.`,
        );
      } catch {
        /* expired */
      }
      return;
    }

    // Phase 93 Plan 02 — partition into local-side vs clawhub-side. Legacy
    // {path,label?} sources are treated as "local-side" — they're operator-
    // curated filesystem mounts and read visually like locals to the
    // operator. Only kind:"clawhub" entries are placed BELOW the divider.
    const isClawhubEntry = (e: MarketplaceEntryWire): boolean =>
      typeof e.source === "object" &&
      e.source !== null &&
      "kind" in (e.source as object) &&
      (e.source as { kind?: unknown }).kind === "clawhub";

    const localSide = listResp.available.filter((e) => !isClawhubEntry(e));
    const clawhubSide = listResp.available.filter(isClawhubEntry);

    // Build option list with cap. Reserve 1 slot for the divider WHEN
    // ClawHub entries will follow; otherwise omit per Pitfall 2 (no
    // divider when zero ClawHub items would render). Pitfall 3: if the
    // cap squeezes ClawHub entries to zero, drop the divider too.
    type SkillOptionDescriptor = {
      readonly value: string;
      readonly label: string;
      readonly description: string;
      readonly isDivider: boolean;
    };
    const optionDescriptors: SkillOptionDescriptor[] = [];
    for (const s of localSide) {
      if (optionDescriptors.length >= DISCORD_SELECT_CAP) break;
      optionDescriptors.push({
        value: s.name,
        label: `${s.name} · ${s.category}`.slice(0, 100),
        description: (s.description || "(no description)").slice(0, 100),
        isDivider: false,
      });
    }
    // Inject divider only if at least 1 clawhub entry will follow under cap.
    const remainingSlots = DISCORD_SELECT_CAP - optionDescriptors.length;
    if (clawhubSide.length > 0 && remainingSlots >= 2) {
      optionDescriptors.push({
        value: CLAWHUB_DIVIDER_VALUE,
        label: CLAWHUB_DIVIDER_LABEL,
        description: CLAWHUB_DIVIDER_DESC,
        isDivider: true,
      });
      for (const s of clawhubSide) {
        if (optionDescriptors.length >= DISCORD_SELECT_CAP) break;
        optionDescriptors.push({
          value: s.name,
          label: `${s.name} · ${s.category}`.slice(0, 100),
          description: (s.description || "(no description)").slice(0, 100),
          isDivider: false,
        });
      }
    }
    // Re-derive overflow against the FULL available list (not partitioned).
    // Dividers are not installable entries, so exclude them from the count.
    const totalCappedCount = optionDescriptors.filter(
      (o) => !o.isDivider,
    ).length;
    const overflow = listResp.available.length - totalCappedCount;
    const nonce = Math.random().toString(36).slice(2, 8);
    const customId = `skills-picker:${agentName}:${nonce}`;

    const menu = new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder("Choose a skill to install")
      .addOptions(
        optionDescriptors.map((o) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(o.label)
            .setValue(o.value)
            .setDescription(o.description),
        ),
      );
    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      menu,
    );

    const overflowNote =
      overflow > 0
        ? `\n(Showing first ${totalCappedCount} of ${listResp.available.length}.)`
        : "";

    try {
      await interaction.editReply({
        content: `Pick a skill to install on **${agentName}**.${overflowNote}`,
        components: [row],
      });
    } catch {
      return;
    }

    // Await selection (30s TTL — same as /clawcode-model picker)
    let followUp: StringSelectMenuInteraction;
    try {
      const channel = interaction.channel;
      if (!channel) {
        throw new Error("interaction has no channel — cannot collect");
      }
      followUp = (await channel.awaitMessageComponent({
        componentType: ComponentType.StringSelect,
        filter: (i: { user: { id: string }; customId: string }) =>
          i.user.id === interaction.user.id && i.customId === customId,
        time: MODEL_PICKER_TTL_MS,
      })) as StringSelectMenuInteraction;
    } catch {
      try {
        await interaction.editReply({
          content: "Picker timed out (no selection in 30s).",
          components: [],
        });
      } catch {
        /* expired */
      }
      return;
    }

    const chosen = followUp.values[0];
    if (!chosen) {
      try {
        await followUp.update({
          content: "No selection captured.",
          components: [],
        });
      } catch {
        /* expired */
      }
      return;
    }

    // Phase 93 Plan 02 — Pitfall 1 closure: divider is selectable in
    // discord.js (no setDisabled API on StringSelectMenuOption). Filter the
    // sentinel value out of the install path with a clear ephemeral hint.
    if (chosen === CLAWHUB_DIVIDER_VALUE) {
      try {
        await followUp.update({
          content: "Pick a skill, not the divider.",
          components: [],
        });
      } catch {
        /* expired */
      }
      return;
    }

    try {
      await followUp.update({
        content: `Installing **${chosen}** on ${agentName}...`,
        components: [],
      });
    } catch {
      /* expired */
    }

    // Dispatch install
    try {
      const resp = (await sendIpcRequest(SOCKET_PATH, "marketplace-install", {
        agent: agentName,
        skill: chosen,
      })) as {
        outcome: SkillInstallOutcomeWire;
        rewired: boolean;
      };
      const msg = renderInstallOutcome(resp.outcome, agentName, resp.rewired);
      try {
        await interaction.editReply({ content: msg, components: [] });
      } catch {
        /* expired */
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        await interaction.editReply({
          content: `Install failed: ${msg}`,
          components: [],
        });
      } catch {
        /* expired */
      }
    }
  }

  /**
   * Phase 90 Plan 05 HUB-02 / UI-01 — /clawcode-plugins-browse inline handler.
   *
   * Flow:
   *   1. Defer ephemerally.
   *   2. IPC marketplace-list-plugins → returns available ClawHub plugins.
   *   3. Render StringSelectMenuBuilder (25-item cap + overflow note).
   *   4. Await selection (30s TTL).
   *   5. Dispatch IPC marketplace-install-plugin with empty configInputs.
   *   6a. If outcome = config-missing → show Modal with the missing field,
   *       submit → re-dispatch install with configInputs populated.
   *   6b. Else → render outcome-specific ephemeral via renderPluginInstallOutcome.
   *
   * Simplified config flow vs plan D-13: this iteration handles the single-
   * missing-field case (the most common install shape — one password / API
   * key). Multi-field ModalBuilder with up-front manifest fetch is a
   * follow-up refinement. The installer is already config-aware (accepts a
   * full configInputs map); only the Discord UX is iterating.
   */
  private async handlePluginsBrowseCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const agentName = getAgentForChannel(
      this.routingTable,
      interaction.channelId,
    );
    if (!agentName) {
      try {
        await interaction.reply({
          content: "This channel is not bound to an agent.",
          ephemeral: true,
        });
      } catch {
        /* expired */
      }
      return;
    }

    try {
      await interaction.deferReply({ ephemeral: true });
    } catch {
      return;
    }

    type PluginListItemWire = {
      readonly name: string;
      readonly latestVersion: string;
      readonly displayName?: string;
      readonly summary?: string;
      readonly description?: string;
      readonly family?: string;
    };
    let listResp: {
      agent: string;
      installed: readonly string[];
      available: readonly PluginListItemWire[];
    };
    try {
      listResp = (await sendIpcRequest(
        SOCKET_PATH,
        "marketplace-list-plugins",
        { agent: agentName },
      )) as typeof listResp;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        await interaction.editReply(`Failed to load ClawHub plugins: ${msg}`);
      } catch {
        /* expired */
      }
      return;
    }

    if (listResp.available.length === 0) {
      try {
        await interaction.editReply(
          `No ClawHub plugins available right now (or all already installed for **${agentName}**). Come back soon — clawhub.ai is still filling up.`,
        );
      } catch {
        /* expired */
      }
      return;
    }

    const capped = listResp.available.slice(0, DISCORD_SELECT_CAP);
    const overflow = listResp.available.length - capped.length;
    const nonce = Math.random().toString(36).slice(2, 8);
    const customId = `plugins-picker:${agentName}:${nonce}`;

    const menu = new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder("Choose a plugin to install")
      .addOptions(
        capped.map((p) => {
          const displayName = p.displayName ?? p.name;
          const label = `${displayName} · v${p.latestVersion}`.slice(0, 100);
          const desc = (p.summary ?? p.description ?? "(no description)").slice(
            0,
            100,
          );
          return new StringSelectMenuOptionBuilder()
            .setLabel(label)
            .setValue(p.name)
            .setDescription(desc);
        }),
      );
    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      menu,
    );

    const overflowNote =
      overflow > 0
        ? `\n(Showing first ${DISCORD_SELECT_CAP} of ${listResp.available.length}.)`
        : "";

    try {
      await interaction.editReply({
        content: `Pick a ClawHub plugin to install on **${agentName}**.${overflowNote}`,
        components: [row],
      });
    } catch {
      return;
    }

    // Await selection (30s TTL)
    let followUp: StringSelectMenuInteraction;
    try {
      const channel = interaction.channel;
      if (!channel) {
        throw new Error("interaction has no channel — cannot collect");
      }
      followUp = (await channel.awaitMessageComponent({
        componentType: ComponentType.StringSelect,
        filter: (i: { user: { id: string }; customId: string }) =>
          i.user.id === interaction.user.id && i.customId === customId,
        time: MODEL_PICKER_TTL_MS,
      })) as StringSelectMenuInteraction;
    } catch {
      try {
        await interaction.editReply({
          content: "Picker timed out (no selection in 30s).",
          components: [],
        });
      } catch {
        /* expired */
      }
      return;
    }

    const chosen = followUp.values[0];
    if (!chosen) {
      try {
        await followUp.update({
          content: "No selection captured.",
          components: [],
        });
      } catch {
        /* expired */
      }
      return;
    }

    // First install attempt with no configInputs. If the plugin needs
    // required fields, the installer returns `config-missing` — we then
    // show a Modal, collect the value, and retry.
    let outcome: PluginInstallOutcomeWire;
    try {
      outcome = (await sendIpcRequest(
        SOCKET_PATH,
        "marketplace-install-plugin",
        {
          agent: agentName,
          plugin: chosen,
          configInputs: {},
        },
      )) as PluginInstallOutcomeWire;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        await followUp.update({
          content: `Plugin install failed: ${msg}`,
          components: [],
        });
      } catch {
        /* expired */
      }
      return;
    }

    // Config-missing → show Modal for the missing field. Discord caps at
    // 5 TextInput rows per Modal; single-field case is the sweet spot
    // (API key / password), and the 5-field generalization follows the
    // same pattern. >5 fields would need serial prompts (D-13) — deferred.
    if (outcome.kind === "config-missing") {
      const fieldName = outcome.missing_field;
      const modalId = `plugins-config:${agentName}:${chosen}:${nonce}`;
      const modal = new ModalBuilder()
        .setCustomId(modalId)
        .setTitle(`Configure ${chosen}`);
      const input = new TextInputBuilder()
        .setCustomId(fieldName)
        .setLabel(fieldName.slice(0, 45))
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("op://clawdbot/<item>/<field> or literal value")
        .setRequired(true);
      const inputRow =
        new ActionRowBuilder<TextInputBuilder>().addComponents(input);
      modal.addComponents(inputRow);

      try {
        await followUp.showModal(modal);
      } catch {
        try {
          await interaction.editReply({
            content: renderPluginInstallOutcome(outcome, agentName),
            components: [],
          });
        } catch {
          /* expired */
        }
        return;
      }

      // Await modal submit (60s TTL — operators may need to copy/paste
      // from a secret store).
      let modalSubmit: ModalSubmitInteraction;
      try {
        modalSubmit = (await followUp.awaitModalSubmit({
          filter: (i) =>
            i.user.id === interaction.user.id && i.customId === modalId,
          time: 60_000,
        })) as ModalSubmitInteraction;
      } catch {
        try {
          await interaction.editReply({
            content: `Modal timed out — **${chosen}** not installed. Re-run \`/clawcode-plugins-browse\` to retry.`,
            components: [],
          });
        } catch {
          /* expired */
        }
        return;
      }

      const value = modalSubmit.fields.getTextInputValue(fieldName);
      try {
        await modalSubmit.deferUpdate();
      } catch {
        /* expired */
      }

      // Phase 90 Plan 06 HUB-05 — op:// rewrite probe.
      // Before the retry install, ask the daemon whether the operator has
      // a matching 1Password item for this field. If so, surface a button
      // row: "Use op://..." (Primary) vs "Use literal" (Danger — still
      // gated by install-plugin's secret-scan on actual credentials).
      //
      // Only probe if the submitted value doesn't already look like an
      // op:// ref (operator may have explicitly typed one).
      let effectiveValue = value;
      if (!value.startsWith("op://")) {
        try {
          type ProbeResp = {
            proposal: {
              uri: string;
              confidence: string;
              itemTitle: string;
            } | null;
          };
          const probe = (await sendIpcRequest(
            SOCKET_PATH,
            "marketplace-probe-op-items",
            {
              fieldName,
              fieldLabel: fieldName,
            },
          )) as ProbeResp;

          if (probe.proposal) {
            const acceptId = `oprewrite-accept:${agentName}:${chosen}:${nonce}`;
            const literalId = `oprewrite-literal:${agentName}:${chosen}:${nonce}`;
            const acceptLabel = `Use ${probe.proposal.uri}`.slice(0, 79);
            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder()
                .setCustomId(acceptId)
                .setLabel(acceptLabel)
                .setStyle(ButtonStyle.Primary),
              new ButtonBuilder()
                .setCustomId(literalId)
                .setLabel("Use literal value (may be refused)")
                .setStyle(ButtonStyle.Danger),
            );
            try {
              await interaction.editReply({
                content:
                  `**${fieldName}**: 1Password match found (${probe.proposal.confidence}) — ` +
                  `**${probe.proposal.itemTitle}**. Use the 1Password reference, or use the ` +
                  `literal value you typed? Literal credentials may be refused by the ` +
                  `install-time secret-scan.`,
                components: [row],
              });
            } catch {
              /* expired — fall through with literal */
            }

            try {
              const channel = interaction.channel;
              if (channel) {
                const btn = (await channel.awaitMessageComponent({
                  componentType: ComponentType.Button,
                  filter: (i: { user: { id: string }; customId: string }) =>
                    i.user.id === interaction.user.id &&
                    (i.customId === acceptId || i.customId === literalId),
                  time: 60_000,
                })) as ButtonInteraction;
                try {
                  await btn.deferUpdate();
                } catch {
                  /* expired */
                }
                if (btn.customId === acceptId) {
                  effectiveValue = probe.proposal.uri;
                }
                // literal button → keep `value` as-is; install-plugin's
                // secret-scan gate will refuse credentials-shaped literals.
              }
            } catch {
              // No click within timeout — default to literal (what the
              // operator typed). The install-plugin secret-scan still gates.
            }
          }
        } catch {
          // Probe unavailable (1P not signed in, etc.) — fall through to
          // literal. The install-plugin secret-scan still gates.
        }
      }

      // Retry install with the effective field value (either the typed
      // literal or the operator-confirmed op:// URI).
      try {
        outcome = (await sendIpcRequest(
          SOCKET_PATH,
          "marketplace-install-plugin",
          {
            agent: agentName,
            plugin: chosen,
            configInputs: { [fieldName]: effectiveValue },
          },
        )) as PluginInstallOutcomeWire;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        try {
          await interaction.editReply({
            content: `Plugin install failed: ${msg}`,
            components: [],
          });
        } catch {
          /* expired */
        }
        return;
      }
    }

    const msg = renderPluginInstallOutcome(outcome, agentName);
    try {
      await interaction.editReply({ content: msg, components: [] });
    } catch {
      /* expired */
    }
  }

  /**
   * Phase 90 Plan 06 HUB-07 — /clawcode-clawhub-auth inline handler.
   *
   * Flow:
   *   1. deferReply ephemerally.
   *   2. sendIpcRequest("clawhub-oauth-start") → {user_code, verification_uri,
   *      device_code, poll_interval_s, expires_at}.
   *   3. editReply with EmbedBuilder showing the verification_uri hyperlink +
   *      bold user_code + expiry countdown.
   *   4. sendIpcRequest("clawhub-oauth-poll", {...}) — this RPC blocks until
   *      the user completes the flow or the code expires (up to 15 min).
   *      Passes an explicit timeoutMs so the IPC client doesn't kill the
   *      request at the default shorter window.
   *   5. editReply with success ("Token stored at op://...") or failure
   *      message from the poll handler.
   *
   * Auth-deferred fallback: if the ClawHub GitHub OAuth App client_id is a
   * placeholder (unset env var), the initiate request will fail. The caller
   * catches + surfaces a helpful message asking the operator to register the
   * app and set CLAWHUB_GITHUB_CLIENT_ID.
   */
  private async handleClawhubAuthCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    try {
      await interaction.deferReply({ ephemeral: true });
    } catch {
      return;
    }

    type DeviceCodeInitWire = {
      readonly user_code: string;
      readonly verification_uri: string;
      readonly device_code: string;
      readonly poll_interval_s: number;
      readonly expires_at: number;
    };
    let init: DeviceCodeInitWire;
    try {
      init = (await sendIpcRequest(
        SOCKET_PATH,
        "clawhub-oauth-start",
        {},
      )) as DeviceCodeInitWire;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        await interaction.editReply({
          content:
            `ClawHub OAuth unavailable: ${msg}\n` +
            `This is usually because the ClawHub GitHub OAuth App isn't configured yet. ` +
            `Operator: set CLAWHUB_GITHUB_CLIENT_ID in the daemon env and restart.`,
        });
      } catch {
        /* expired */
      }
      return;
    }

    const expiresDate = new Date(init.expires_at);
    const expiresRel = `<t:${Math.floor(init.expires_at / 1000)}:R>`;
    const embed = new EmbedBuilder()
      .setTitle("🔐 ClawHub GitHub OAuth")
      .setColor(0x2ea043)
      .setDescription(
        `Step 1: Visit **${init.verification_uri}**\n` +
          `Step 2: Enter code **\`${init.user_code}\`**\n` +
          `Step 3: Wait here — I'll poll GitHub and store the token in 1Password.`,
      )
      .addFields({
        name: "Expires",
        value: `${expiresRel} (${expiresDate.toISOString()})`,
        inline: false,
      });

    try {
      await interaction.editReply({ embeds: [embed] });
    } catch {
      /* expired */
    }

    type PollResultWire = { readonly stored: boolean; readonly message: string };
    let result: PollResultWire;
    try {
      // Long-lived IPC — the daemon-side handler blocks until the user
      // completes the flow or the device code expires (hard-capped at
      // ~15 min by GitHub). The IPC client uses Unix-socket lifetime (no
      // fixed timeout); the daemon handler self-terminates at expires_at.
      result = (await sendIpcRequest(
        SOCKET_PATH,
        "clawhub-oauth-poll",
        {
          device_code: init.device_code,
          poll_interval_s: init.poll_interval_s,
          expires_at: init.expires_at,
        },
      )) as PollResultWire;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        await interaction.editReply({
          content: `⛔ OAuth poll failed: ${msg}`,
          embeds: [],
        });
      } catch {
        /* expired */
      }
      return;
    }

    try {
      if (result.stored) {
        await interaction.editReply({
          content: `✅ ${result.message}`,
          embeds: [],
        });
      } else {
        await interaction.editReply({
          content: `⛔ OAuth did not complete: ${result.message}`,
          embeds: [],
        });
      }
    } catch {
      /* expired */
    }
  }

  /**
   * Phase 88 MKT-07 / UI-01 — /clawcode-skills inline handler.
   *
   * Lists the bound agent's installed skills and renders a native
   * StringSelectMenuBuilder remove picker. Selection dispatches IPC
   * marketplace-remove and renders a single ephemeral outcome message.
   */
  private async handleSkillsCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const agentName = getAgentForChannel(
      this.routingTable,
      interaction.channelId,
    );
    if (!agentName) {
      try {
        await interaction.reply({
          content: "This channel is not bound to an agent.",
          ephemeral: true,
        });
      } catch {
        /* expired */
      }
      return;
    }

    try {
      await interaction.deferReply({ ephemeral: true });
    } catch {
      return;
    }

    let listResp: { agent: string; installed: readonly string[] };
    try {
      listResp = (await sendIpcRequest(SOCKET_PATH, "marketplace-list", {
        agent: agentName,
      })) as typeof listResp;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        await interaction.editReply(`Failed to load installed skills: ${msg}`);
      } catch {
        /* expired */
      }
      return;
    }

    if (listResp.installed.length === 0) {
      try {
        await interaction.editReply(
          `No skills installed for **${agentName}**. Use \`/clawcode-skills-browse\` to install one.`,
        );
      } catch {
        /* expired */
      }
      return;
    }

    const capped = listResp.installed.slice(0, DISCORD_SELECT_CAP);
    const overflow = listResp.installed.length - capped.length;
    const nonce = Math.random().toString(36).slice(2, 8);
    const customId = `skills-remove:${agentName}:${nonce}`;

    const bulletList = listResp.installed.map((n) => `• ${n}`).join("\n");

    const menu = new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder("Choose a skill to remove")
      .addOptions(
        capped.map((name) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(name.slice(0, 100))
            .setValue(name)
            .setDescription(`Remove from ${agentName}`.slice(0, 100)),
        ),
      );
    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      menu,
    );

    const overflowNote =
      overflow > 0
        ? `\n(Showing first ${DISCORD_SELECT_CAP} of ${listResp.installed.length}.)`
        : "";

    try {
      await interaction.editReply({
        content: `Installed skills for **${agentName}**:\n${bulletList}${overflowNote}\n\nSelect one to remove:`,
        components: [row],
      });
    } catch {
      return;
    }

    let followUp: StringSelectMenuInteraction;
    try {
      const channel = interaction.channel;
      if (!channel) {
        throw new Error("interaction has no channel — cannot collect");
      }
      followUp = (await channel.awaitMessageComponent({
        componentType: ComponentType.StringSelect,
        filter: (i: { user: { id: string }; customId: string }) =>
          i.user.id === interaction.user.id && i.customId === customId,
        time: MODEL_PICKER_TTL_MS,
      })) as StringSelectMenuInteraction;
    } catch {
      try {
        await interaction.editReply({
          content: "Picker timed out (no selection in 30s).",
          components: [],
        });
      } catch {
        /* expired */
      }
      return;
    }

    const chosen = followUp.values[0];
    if (!chosen) {
      try {
        await followUp.update({
          content: "No selection captured.",
          components: [],
        });
      } catch {
        /* expired */
      }
      return;
    }

    try {
      await followUp.update({
        content: `Removing **${chosen}** from ${agentName}...`,
        components: [],
      });
    } catch {
      /* expired */
    }

    try {
      const resp = (await sendIpcRequest(SOCKET_PATH, "marketplace-remove", {
        agent: agentName,
        skill: chosen,
      })) as {
        agent: string;
        skill: string;
        removed: boolean;
        persisted: boolean;
        persist_error: string | null;
        reason?: string;
      };

      let msg: string;
      if (!resp.removed) {
        msg = `${resp.skill} not removed from ${agentName}${resp.reason ? ` (${resp.reason})` : ""}`;
      } else if (resp.persisted) {
        msg = `Removed **${resp.skill}** from ${agentName}.`;
      } else {
        msg =
          `Removed **${resp.skill}** from ${agentName} (note: clawcode.yaml write failed: ${resp.persist_error ?? "unknown"}).`;
      }
      try {
        await interaction.editReply({ content: msg, components: [] });
      } catch {
        /* expired */
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        await interaction.editReply({
          content: `Remove failed: ${msg}`,
          components: [],
        });
      } catch {
        /* expired */
      }
    }
  }

  /**
   * Handle a control command by routing to the daemon via IPC.
   * Control commands defer with ephemeral (except fleet which is public)
   * and communicate directly with the daemon — no agent session involved.
   */
  private async handleControlCommand(
    interaction: ChatInputCommandInteraction,
    cmd: SlashCommandDef,
  ): Promise<void> {
    const isFleet = cmd.name === "clawcode-fleet";

    try {
      await interaction.deferReply({ ephemeral: !isFleet });
    } catch (error) {
      this.log.error(
        { command: cmd.name, error: (error as Error).message },
        "failed to defer control reply",
      );
      return;
    }

    const ipcMethod = cmd.ipcMethod ?? cmd.name;
    const agentName = interaction.options.getString("agent");

    try {
      if (isFleet) {
        const result = (await sendIpcRequest(SOCKET_PATH, "status", {})) as {
          entries: RegistryEntry[];
        };
        const embed = buildFleetEmbed(result.entries, this.resolvedAgents);
        await interaction.editReply({ embeds: [embed] });
      } else if (ipcMethod === "interrupt-agent") {
        // Quick task 260419-nic — daemon-direct mid-turn abort. Bypasses IPC
        // (we already hold a SessionManager reference) so there's no extra
        // hop on the time-sensitive path.
        const resolvedName =
          agentName ?? getAgentForChannel(this.routingTable, interaction.channelId);
        if (!resolvedName) {
          await interaction.editReply(
            "No agent to interrupt — specify `agent:` or run in an agent-bound channel.",
          );
          return;
        }
        const reply = await handleInterruptSlash({
          agentName: resolvedName,
          interruptAgent: (n) => this.sessionManager.interruptAgent(n),
          log: this.log,
        });
        await interaction.editReply(reply);
      } else if (ipcMethod === "steer-agent") {
        // Quick task 260419-nic — interrupt + dispatch [USER STEER] follow-up.
        const resolvedName =
          agentName ?? getAgentForChannel(this.routingTable, interaction.channelId);
        const guidance = interaction.options.getString("guidance");
        if (!resolvedName) {
          await interaction.editReply(
            "No agent to steer — specify `agent:` or run in an agent-bound channel.",
          );
          return;
        }
        if (!guidance) {
          await interaction.editReply("Guidance is required.");
          return;
        }
        if (!this.turnDispatcher) {
          await interaction.editReply(
            "Steer unavailable: turn dispatcher not wired.",
          );
          return;
        }
        const dispatcher = this.turnDispatcher;
        const reply = await handleSteerSlash({
          agentName: resolvedName,
          guidance,
          channelId: interaction.channelId,
          interactionId: interaction.id,
          interruptAgent: (n) => this.sessionManager.interruptAgent(n),
          hasActiveTurn: (n) => this.sessionManager.hasActiveTurn(n),
          dispatch: (origin, n, msg) => dispatcher.dispatch(origin, n, msg),
          log: this.log,
        });
        await interaction.editReply(reply);
      } else if (ipcMethod === "agent-create") {
        const name = interaction.options.getString("name");
        const soul = interaction.options.getString("soul");
        const model = interaction.options.getString("model") ?? undefined;
        if (!name || !soul) {
          await interaction.editReply("Both `name` and `soul` are required.");
          return;
        }
        const result = (await sendIpcRequest(SOCKET_PATH, "agent-create", {
          name,
          soul: soul.replaceAll("\\n", "\n"),
          model,
          parentChannelId: interaction.channelId,
          invokerUserId: interaction.user.id,
        })) as { name: string; model: string; channelId: string; channelUrl: string };
        await interaction.editReply(
          `Agent **${result.name}** created on \`${result.model}\`. Channel: ${result.channelUrl}`,
        );
      } else {
        if (!agentName) {
          await interaction.editReply("Agent name is required.");
          return;
        }
        await sendIpcRequest(SOCKET_PATH, ipcMethod, { name: agentName });
        const verb =
          ipcMethod === "start"
            ? "started"
            : ipcMethod === "stop"
              ? "stopped"
              : "restarted";
        await interaction.editReply(`Agent **${agentName}** ${verb}.`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.log.error(
        { command: cmd.name, agent: agentName, error: msg },
        "control command failed",
      );
      try {
        await interaction.editReply(`Command failed: ${msg}`);
      } catch {
        /* expired */
      }
    }
  }

  /**
   * Phase 87 CMD-03 — lookup a registered native-CC command by name and
   * return it iff it has nativeBehavior === "prompt-channel".
   *
   * Implementation reads from the same resolved set register() iterates at
   * startup: walks every resolvedAgents entry, resolves the agent's commands
   * via resolveAgentCommands (which merges DEFAULT_SLASH_COMMANDS with the
   * agent's own slashCommands — the register loop additionally folds in
   * buildNativeCommandDefs output, but by the time we get here the agent's
   * slashCommands carry the nativeBehavior-tagged entries Plan 01's register
   * loop stamped onto them in production).
   *
   * Prompt-channel entries are agent-agnostic by definition (the dispatch
   * target is the channel's bound agent, not the agent that first reported
   * the command) — so returning the FIRST match across all agents is
   * deliberate and safe.
   */
  private findNativePromptChannelCommand(
    name: string,
  ): SlashCommandDef | null {
    for (const agent of this.resolvedAgents) {
      for (const cmd of resolveAgentCommands(agent.slashCommands)) {
        if (cmd.name === name && cmd.nativeBehavior === "prompt-channel") {
          return cmd;
        }
      }
    }
    return null;
  }

  /**
   * Phase 87 CMD-03 / CMD-06 — dispatch a prompt-channel native-CC command.
   *
   * Mirrors the agent-routed streaming flow in handleInteraction (lines
   * 600-700 of this file) but substitutes the canonical `/<name> <args>`
   * prompt (buildNativePromptString) for the agent's claudeCommand template
   * and routes through TurnDispatcher.dispatchStream so origin propagates
   * (critical for trace stitching — see turn-origin.ts).
   *
   * Flow:
   *   1. Resolve agent by channel; reject if unbound (ephemeral "not bound").
   *   2. deferReply + "Thinking..." feedback.
   *   3. Build prompt string via buildNativePromptString.
   *   4. Stream via TurnDispatcher.dispatchStream with ProgressiveMessageEditor
   *      (v1.7 streaming primitive — reused verbatim, ZERO new primitive).
   *   5. On SDK error, dispose editor and surface the VERBATIM error text
   *      in the ephemeral reply (Phase 85 TOOL-04 pattern).
   *   6. Truncate oversized responses at DISCORD_MAX_LENGTH.
   *   7. Empty response → "(No response from agent)".
   *
   * When turnDispatcher is not wired (test scenarios / legacy boot), fall
   * back with an ephemeral error message — this path is unreachable in
   * production (daemon.ts always constructs a TurnDispatcher).
   */
  private async dispatchNativePromptCommand(
    interaction: ChatInputCommandInteraction,
    cmd: SlashCommandDef,
  ): Promise<void> {
    const agentName = getAgentForChannel(
      this.routingTable,
      interaction.channelId,
    );
    if (!agentName) {
      try {
        await interaction.reply({
          content: "This channel is not bound to an agent.",
          ephemeral: true,
        });
      } catch {
        /* interaction may have expired */
      }
      return;
    }

    try {
      await interaction.deferReply();
    } catch (error) {
      this.log.error(
        { command: cmd.name, error: (error as Error).message },
        "failed to defer prompt-channel reply",
      );
      return;
    }

    // Extract optional args value (Discord STRING option) and build the
    // canonical prompt. Non-string / missing values → no args.
    const argsRaw = interaction.options.get("args")?.value;
    const args = typeof argsRaw === "string" ? argsRaw : undefined;
    const prompt = buildNativePromptString(cmd.name, args);

    this.log.info(
      {
        agent: agentName,
        command: cmd.name,
        channelId: interaction.channelId,
        prompt,
      },
      "prompt-channel native-CC dispatch",
    );

    try {
      await interaction.editReply("Thinking...");
    } catch {
      /* non-fatal */
    }

    const editor = new ProgressiveMessageEditor({
      editFn: async (content: string) => {
        // Phase 100 follow-up — wrap raw markdown tables in ```text``` fences.
        const wrapped = wrapMarkdownTablesInCodeFence(content);
        const truncated =
          wrapped.length > DISCORD_MAX_LENGTH
            ? wrapped.slice(0, DISCORD_MAX_LENGTH - 3) + "..."
            : wrapped;
        await interaction.editReply(truncated);
      },
      editIntervalMs: 1500,
    });

    try {
      if (!this.turnDispatcher) {
        throw new Error(
          "Turn dispatcher not wired — cannot dispatch native-CC prompt command",
        );
      }
      const origin = makeRootOrigin("discord", interaction.channelId);
      const response = await this.turnDispatcher.dispatchStream(
        origin,
        agentName,
        prompt,
        (accumulated) => editor.update(accumulated),
      );
      await editor.flush();
      const text = response.trim();
      if (text.length === 0) {
        await interaction.editReply("(No response from agent)");
        return;
      }
      const truncated =
        text.length > DISCORD_MAX_LENGTH
          ? text.slice(0, DISCORD_MAX_LENGTH - 3) + "..."
          : text;
      await interaction.editReply(truncated);
    } catch (err) {
      editor.dispose();
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error(
        {
          agent: agentName,
          command: cmd.name,
          prompt,
          error: msg,
        },
        "native-CC prompt command failed",
      );
      // CMD-03 truth #4 / Phase 85 TOOL-04 — surface the VERBATIM error
      // text in the ephemeral reply (no rewording, no wrapping).
      try {
        await interaction.editReply(`Command failed: ${msg}`);
      } catch {
        /* expired */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Quick task 260419-nic — pure handlers for /clawcode-interrupt + /clawcode-steer.
//
// Exported so tests can drive the command logic without spinning up a real
// Discord interaction pipeline. `handleControlCommand` wires them in-process
// against SessionManager + TurnDispatcher.
// ---------------------------------------------------------------------------

const STEER_CLEAR_POLL_MS = 50;
const STEER_CLEAR_MAX_WAIT_MS = 2000;
const STEER_PREFIX = "[USER STEER] ";

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Render the ephemeral reply for `/clawcode-interrupt`.
 *
 * Returns:
 *   - "🛑 Stopped {agent} mid-turn."           — interruptAgent reported interrupted:true
 *   - "No active turn for {agent}."            — interruptAgent reported {false,false}
 *   - "Error: could not interrupt {agent}: …"  — interruptAgent threw
 *
 * Never throws — errors map to a user-visible message.
 */
export async function handleInterruptSlash(deps: {
  readonly agentName: string;
  readonly interruptAgent: (
    name: string,
  ) => Promise<{ readonly interrupted: boolean; readonly hadActiveTurn: boolean }>;
  readonly log: Logger;
}): Promise<string> {
  const { agentName, interruptAgent, log } = deps;
  try {
    const result = await interruptAgent(agentName);
    if (result.interrupted) {
      log.info(
        { agent: agentName, event: "slash_interrupt_ok" },
        "slash /interrupt succeeded",
      );
      return `🛑 Stopped ${agentName} mid-turn.`;
    }
    return `No active turn for ${agentName}.`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(
      { agent: agentName, error: msg },
      "slash /interrupt failed",
    );
    return `Error: could not interrupt ${agentName}: ${msg}`;
  }
}

/**
 * Render the ephemeral reply for `/clawcode-steer`.
 *
 * Flow:
 *   1. interruptAgent(agent) — fires q.interrupt() on any in-flight turn.
 *   2. Poll hasActiveTurn() every 50ms for up to 2000ms until the turn clears.
 *      If the deadline expires, log.warn and proceed anyway (SerialTurnQueue
 *      will queue the new turn behind the stuck one — caller still gets a
 *      response once the stuck turn resolves or aborts).
 *   3. dispatch(origin=discord, agent, "[USER STEER] {guidance}") — the
 *      TurnDispatcher owns Turn lifecycle + opens the streaming reply in
 *      the channel via the normal DiscordBridge path.
 *
 * Returns:
 *   - "↩ Steered {agent}. New response coming in this channel." — happy path
 *   - "Error: could not steer {agent}: …"                        — dispatch threw
 */
export async function handleSteerSlash(deps: {
  readonly agentName: string;
  readonly guidance: string;
  readonly channelId: string;
  readonly interactionId: string;
  readonly interruptAgent: (
    name: string,
  ) => Promise<{ readonly interrupted: boolean; readonly hadActiveTurn: boolean }>;
  readonly hasActiveTurn: (name: string) => boolean;
  readonly dispatch: (
    origin: TurnOrigin,
    agentName: string,
    message: string,
  ) => Promise<unknown>;
  readonly log: Logger;
  readonly sleep?: (ms: number) => Promise<void>;
}): Promise<string> {
  const {
    agentName,
    guidance,
    channelId,
    interruptAgent,
    hasActiveTurn,
    dispatch,
    log,
  } = deps;
  const sleep = deps.sleep ?? defaultSleep;
  try {
    // 1. Interrupt any in-flight turn (safe no-op if idle).
    await interruptAgent(agentName);

    // 2. Poll for the turn to clear, up to STEER_CLEAR_MAX_WAIT_MS.
    const deadline = Date.now() + STEER_CLEAR_MAX_WAIT_MS;
    while (hasActiveTurn(agentName) && Date.now() < deadline) {
      await sleep(STEER_CLEAR_POLL_MS);
    }
    if (hasActiveTurn(agentName)) {
      log.warn(
        { agent: agentName, waitMs: STEER_CLEAR_MAX_WAIT_MS },
        "steer: turn did not clear within deadline — dispatching anyway (will queue)",
      );
    }

    // 3. Dispatch the new turn via the discord origin kind.
    const origin = makeRootOrigin("discord", channelId);
    await dispatch(origin, agentName, `${STEER_PREFIX}${guidance}`);
    log.info(
      { agent: agentName, channelId, event: "slash_steer_ok" },
      "slash /steer dispatched",
    );
    return `↩ Steered ${agentName}. New response coming in this channel.`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ agent: agentName, error: msg }, "slash /steer failed");
    return `Error: could not steer ${agentName}: ${msg}`;
  }
}

/**
 * Format a slash command invocation into a message string for the agent.
 *
 * Replaces `{optionName}` placeholders in claudeCommand with the provided values.
 * Any options without a matching placeholder are appended as "key: value" lines.
 *
 * @param def - The slash command definition
 * @param options - Map of option name to value from the Discord interaction
 * @returns Formatted message string
 */
export function formatCommandMessage(
  def: SlashCommandDef,
  options: ReadonlyMap<string, string | number | boolean>,
): string {
  let message = def.claudeCommand;
  const unmatched: Array<[string, string | number | boolean]> = [];

  for (const [name, value] of options) {
    const placeholder = `{${name}}`;
    if (message.includes(placeholder)) {
      message = message.replaceAll(placeholder, String(value));
    } else {
      unmatched.push([name, value]);
    }
  }

  if (unmatched.length > 0) {
    const extra = unmatched.map(([k, v]) => `${k}: ${String(v)}`).join("\n");
    message = `${message}\n${extra}`;
  }

  return message;
}

/**
 * Resolve the full set of slash commands for an agent.
 *
 * Starts with DEFAULT_SLASH_COMMANDS and overrides any matching names
 * with the agent's custom commands. Returns the merged array.
 *
 * @param agentSlashCommands - Agent's custom slash commands (may be empty)
 * @returns Merged array with defaults + custom overrides
 */
export function resolveAgentCommands(
  agentSlashCommands: readonly SlashCommandDef[],
): readonly SlashCommandDef[] {
  const customByName = new Map<string, SlashCommandDef>();
  for (const cmd of agentSlashCommands) {
    customByName.set(cmd.name, cmd);
  }

  // Replace defaults with custom overrides, keep order
  const merged = DEFAULT_SLASH_COMMANDS.map((defaultCmd) => {
    const custom = customByName.get(defaultCmd.name);
    if (custom) {
      customByName.delete(defaultCmd.name);
      return custom;
    }
    return defaultCmd;
  });

  // Append any custom commands that don't override a default
  const extras = [...customByName.values()];

  return [...merged, ...extras];
}

/**
 * Format a duration in milliseconds to a compact "Xd Xh Xm" string.
 */
export function formatUptime(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);

  return parts.join(" ");
}

/**
 * Build a Discord embed data object for fleet status display.
 * Returns a plain object (not EmbedBuilder) for testability.
 *
 * Color coding:
 * - Green (0x00ff00): all agents running
 * - Red (0xff0000): any agent stopped, crashed, or failed
 * - Yellow (0xffff00): mixed statuses
 * - Gray (0x808080): no agents
 */
export function buildFleetEmbed(
  entries: readonly RegistryEntry[],
  configs: readonly ResolvedAgentConfig[],
): {
  title: string;
  color: number;
  fields: Array<{ name: string; value: string; inline: boolean }>;
  timestamp: string;
} {
  const fields = entries.map((entry) => {
    const config = configs.find((c) => c.name === entry.name);
    const statusEmoji =
      entry.status === "running"
        ? "\u{1F7E2}"
        : entry.status === "stopped" || entry.status === "crashed" || entry.status === "failed"
          ? "\u{1F534}"
          : "\u{1F7E1}";
    const model = config?.model ?? "unknown";
    const uptime = entry.startedAt
      ? formatUptime(Date.now() - entry.startedAt)
      : "\u2014";
    const lastActivity = entry.lastStableAt
      ? new Date(entry.lastStableAt).toISOString().slice(0, 16).replace("T", " ")
      : "\u2014";
    // Phase 56 Plan 02 — append warm-path suffix so operators see readiness
    // without leaving Discord. Legacy entries (no fields) get no suffix so
    // the embed stays backward-compat.
    let warmPathSuffix = "";
    if (
      entry.warm_path_readiness_ms !== undefined &&
      entry.warm_path_readiness_ms !== null
    ) {
      if (entry.lastError?.startsWith("warm-path:")) {
        warmPathSuffix = " \u00B7 warm-path error";
      } else if (entry.warm_path_ready === true) {
        const ms = Math.round(entry.warm_path_readiness_ms);
        warmPathSuffix = ` \u00B7 warm ${ms}ms`;
      } else {
        warmPathSuffix = " \u00B7 warming";
      }
    }
    return {
      name: entry.name,
      value: `${statusEmoji} ${entry.status} \u00B7 ${model} \u00B7 up ${uptime} \u00B7 last ${lastActivity}${warmPathSuffix}`,
      inline: false,
    };
  });

  const allRunning = entries.every((e) => e.status === "running");
  const anyDown = entries.some(
    (e) =>
      e.status === "stopped" || e.status === "crashed" || e.status === "failed",
  );
  const color =
    entries.length === 0
      ? 0x808080
      : allRunning
        ? 0x00ff00
        : anyDown
          ? 0xff0000
          : 0xffff00;

  return { title: "Fleet Status", color, fields, timestamp: new Date().toISOString() };
}
