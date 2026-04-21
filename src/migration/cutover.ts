/**
 * Phase 82 OPS-02 — cutoverAgent orchestrator.
 *
 * The ONLY module in the migration pipeline that writes to `~/.openclaw/`.
 * Modifies `openclaw.json:bindings[]` to remove every entry whose
 * `agentId === args.agentName`, protecting the source tree via a one-path
 * fs-guard allowlist exception. All other `~/.openclaw/` writes continue
 * to refuse (MIGR-07 read-only-source contract preserved).
 *
 * Three safety guards run BEFORE any write (fail-fast in order):
 *   1. Ledger status → must be `migrated` or `verified`. Any other status
 *      (absent=pending / rolled-back / re-planned) refuses with a refuse
 *      ledger row + exit-code-1 shape.
 *   2. clawcode.yaml → agent entry must exist (not just be legal YAML).
 *      Cutting over an agent that has no ClawCode-side binding would
 *      orphan the Discord channel.
 *   3. openclaw.json → if bindings have zero entries for this agent, it's
 *      either already cut over OR was never bound — idempotent no-op.
 *      Returns `already-cut-over` + exit 0 at the CLI layer.
 *
 * Write path (guards passed):
 *   - Install fs-guard with `allowlist: [resolve(openclawJsonPath)]` —
 *     EXACTLY one path gets an exception; sibling `.bak` / any other
 *     `~/.openclaw/` path still refuses.
 *   - Call `removeBindingsForAgent` (Phase 82 Task 1 write helper) which
 *     atomic-rewrites the file via temp+rename.
 *   - Capture before/after sha256 for a witness row in the ledger.
 *   - `finally` uninstalls fs-guard — NO lingering guard leaks across
 *     CLI command boundary.
 *
 * Observe hint:
 *   The pre-removal binding captures the Discord channel id, then
 *   `CUTOVER_OBSERVE_HINT_TEMPLATE` substitutes the literal `<channel_id>`
 *   with the real value. Wave 2 CLI prints this to stdout.
 *
 * DO NOT:
 *   - Skip the fs-guard install — the cutover write is the exceptional
 *     source-tree write; any OTHER accidental write in the same call-stack
 *     MUST still refuse.
 *   - Use execa / child_process — zero new deps; every write is direct fs.
 *   - Reorder the guards — status first (cheap ledger read), then
 *     clawcode.yaml (one file load), then openclaw.json (already cached
 *     via readOpenclawInventory in practice, but this module re-reads for
 *     correctness).
 *   - Leave the guard installed past the finally — other CLI subcommands
 *     must not inherit a weakened protection surface.
 *   - Double-install fs-guard — `installed` state in fs-guard is a no-op
 *     on the second call, so nested installs are safe but allowlist from
 *     the FIRST install wins; this module assumes no enclosing guard.
 */
import { resolve } from "node:path";
import { latestStatusByAgent, appendRow } from "./ledger.js";
import { loadConfig, resolveAllAgents } from "../config/loader.js";
import {
  readOpenclawInventory,
  removeBindingsForAgent,
} from "./openclaw-config-reader.js";
import { installFsGuard, uninstallFsGuard } from "./fs-guard.js";

/**
 * Observe-hint template literal. Grep-pinned by cutover.test.ts — any
 * character drift (including the `<channel_id>` placeholder token) is a
 * PR-block.
 */
export const CUTOVER_OBSERVE_HINT_TEMPLATE =
  "Now wait 15 minutes and confirm only Clawdbot responds in channel <channel_id>";

export type CutoverAgentArgs = Readonly<{
  agentName: string;
  /** ~/.openclaw/openclaw.json — the one file this module ever writes. */
  openclawJsonPath: string;
  /** ~/clawcode.yaml — read-only, used to verify agent entry exists. */
  clawcodeConfigPath: string;
  /** Append-only ledger; this module adds cutover rows. */
  ledgerPath: string;
  /** DI for test determinism — defaults to ISO 'now'. */
  ts?: () => string;
}>;

export type CutoverOutcome = "cut-over" | "already-cut-over" | "refused";

export type CutoverResult = Readonly<{
  outcome: CutoverOutcome;
  removedCount: number;
  /** Present when outcome === "cut-over" — template with channel id substituted. */
  observeHint?: string;
  /** Present when outcome === "refused" — actionable message for operator. */
  refuseReason?: string;
  /** Present when outcome === "cut-over" — sha256 of openclaw.json BEFORE the write. */
  beforeSha256?: string;
  /** Present when outcome === "cut-over" — sha256 of openclaw.json AFTER the write. */
  afterSha256?: string;
}>;

/**
 * Orchestrate a single-agent cutover. Three-guard safety check, then (on
 * pass) an fs-guard-protected write to openclaw.json. Emits ledger rows
 * on every branch so forensic replay reconstructs exact state transitions.
 */
export async function cutoverAgent(
  args: CutoverAgentArgs,
): Promise<CutoverResult> {
  const ts = args.ts ?? (() => new Date().toISOString());

  // ---- Guard 1: ledger status -----------------------------------------
  const latestByAgent = await latestStatusByAgent(args.ledgerPath);
  const status = latestByAgent.get(args.agentName) ?? "pending";
  if (status !== "migrated" && status !== "verified") {
    const refuseReason = `agent ${args.agentName} is not migrated or verified (current status: ${status}) — run apply + verify first`;
    await appendRow(args.ledgerPath, {
      ts: ts(),
      action: "cutover",
      agent: args.agentName,
      status: "pending",
      source_hash: "n/a",
      step: "cutover:refuse",
      outcome: "refuse",
      notes: `guard-a: status=${status}`,
    });
    return Object.freeze({
      outcome: "refused",
      removedCount: 0,
      refuseReason,
    });
  }

  // ---- Guard 2: clawcode.yaml has agent entry -------------------------
  let hasYamlEntry = false;
  try {
    const cfg = await loadConfig(args.clawcodeConfigPath);
    const resolved = resolveAllAgents(cfg);
    hasYamlEntry = resolved.some((a) => a.name === args.agentName);
  } catch {
    hasYamlEntry = false;
  }
  if (!hasYamlEntry) {
    const refuseReason = `agent ${args.agentName} not found in clawcode.yaml — cutover would orphan the Discord channel`;
    await appendRow(args.ledgerPath, {
      ts: ts(),
      action: "cutover",
      agent: args.agentName,
      status: "pending",
      source_hash: "n/a",
      step: "cutover:refuse",
      outcome: "refuse",
      notes: "guard-b: clawcode.yaml absent",
    });
    return Object.freeze({
      outcome: "refused",
      removedCount: 0,
      refuseReason,
    });
  }

  // ---- Guard 3: openclaw.json has bindings for this agent -------------
  // Capture pre-removal binding to compute observeHint channel id
  const inventory = await readOpenclawInventory(args.openclawJsonPath);
  const matchingBindings = inventory.bindings.filter(
    (b) => b.agentId === args.agentName,
  );
  if (matchingBindings.length === 0) {
    await appendRow(args.ledgerPath, {
      ts: ts(),
      action: "cutover",
      agent: args.agentName,
      status: "migrated",
      source_hash: "n/a",
      step: "cutover:no-op",
      outcome: "allow",
      notes: "already cut over OR never bound",
    });
    return Object.freeze({
      outcome: "already-cut-over",
      removedCount: 0,
    });
  }

  // Resolve the first channel id for observeHint (first match wins —
  // deterministic per inventory source order).
  const firstChannelBinding = matchingBindings.find(
    (b) => b.match.peer.kind === "channel",
  );
  const channelId = firstChannelBinding?.match.peer.id ?? "<unknown>";

  // ---- Write: fs-guard allowlist carve-out ----------------------------
  // Install the guard with EXACTLY one exception — the canonical resolved
  // path to openclaw.json. Every other `~/.openclaw/` write still refuses.
  const allowlistEntry = resolve(args.openclawJsonPath);
  installFsGuard({ allowlist: [allowlistEntry] });
  try {
    const removeResult = await removeBindingsForAgent(
      args.openclawJsonPath,
      args.agentName,
    );
    // Edge-case belt: if removeBindingsForAgent reports removed=0 here,
    // inventory disagreed with the read-then-write (concurrent editor?).
    // Treat as already-cut-over to avoid double-writing.
    if (removeResult.removed === 0) {
      await appendRow(args.ledgerPath, {
        ts: ts(),
        action: "cutover",
        agent: args.agentName,
        status: "migrated",
        source_hash: "n/a",
        step: "cutover:no-op",
        outcome: "allow",
        notes: "already cut over (race-condition path)",
      });
      return Object.freeze({
        outcome: "already-cut-over",
        removedCount: 0,
      });
    }
    await appendRow(args.ledgerPath, {
      ts: ts(),
      action: "cutover",
      agent: args.agentName,
      status: "migrated",
      source_hash: "n/a",
      step: "cutover:write",
      outcome: "allow",
      file_hashes: {
        "openclaw.json.before": removeResult.beforeSha256,
        "openclaw.json.after": removeResult.afterSha256,
      },
      notes: `removed ${removeResult.removed} binding(s)`,
    });
    const observeHint = CUTOVER_OBSERVE_HINT_TEMPLATE.replace(
      "<channel_id>",
      channelId,
    );
    return Object.freeze({
      outcome: "cut-over",
      removedCount: removeResult.removed,
      observeHint,
      beforeSha256: removeResult.beforeSha256,
      afterSha256: removeResult.afterSha256,
    });
  } finally {
    uninstallFsGuard();
  }
}
