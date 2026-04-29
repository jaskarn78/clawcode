/**
 * Phase 93 Plan 01 + Phase 103 Plan 01 — pure status-render module.
 *
 * Phase 93 shipped the OpenClaw-parity 9-line block as a scaffold with 11
 * hardcoded `n/a` placeholders. Phase 103 wires 8 of those to live telemetry
 * (Tokens, Context %, Compactions, Activation, Queue, Reasoning label,
 * lastActivityAt) and DROPS the 3 OpenClaw-only fields (Fast/Elevated/Harness)
 * that have no ClawCode analog. One honest `n/a` remains: Fallbacks (no
 * current source).
 *
 * Locked decisions (Phase 93):
 *   D-93-01-2: Session id sliced to last 12 chars of `handle.sessionId`.
 *   D-93-01-3: Relative updated-time via `date-fns/formatDistanceToNow`
 *     (existing project dep — no new install).
 *   D-93-01-4: Defensive reads — every SessionManager accessor try/catch'd
 *     so a thrown SessionError on `getEffortForAgent` collapses to `unknown`
 *     rather than dropping the entire render to "Failed to read status"
 *     (Pitfall 6).
 *
 * Phase 103 additions:
 *   - Compactions: live count from SessionManager.getCompactionCountForAgent
 *     (in-memory mirror; 0 default).
 *   - Context: live fillPercentage from SessionManager.getContextFillPercentageForAgent
 *     (HeartbeatRunner zone tracker; rendered as integer %).
 *   - Tokens: live tokens_in/tokens_out from UsageTracker.getSessionUsage
 *     (requires both UsageTracker AND a sessionId; falls back to n/a).
 *   - Activation: live ms-epoch from SessionManager.getActivationAtForAgent
 *     (in-memory mirror of registry.startedAt) rendered relative.
 *   - Queue: derived from hasActiveTurn (depth-1 SerialTurnQueue inFlight) —
 *     "1 in-flight" when busy, "idle" when not.
 *   - Reasoning: human-friendly label derived from the effort tier
 *     (e.g. "medium effort", "off (no extended thinking)") via the
 *     effortToReasoningLabel helper.
 *   - lastActivityAt: read from the UsageTracker DB (MAX(timestamp) for
 *     the current sessionId) so the Session line's "updated <ago>" is real.
 *
 * Pitfall 7 closure: emoji literals are canonical-Unicode (no FE0F variation
 * selector) so rendering is consistent across Discord clients.
 *
 * Pure module — every input is dependency-injected (sessionManager,
 * resolvedAgents, now). No SessionManager / Discord imports leak into the
 * line formatters; tests construct StatusData literals or pass throwing
 * stubs without standing up real session infrastructure.
 */
import { formatDistanceToNow } from "date-fns";
import type { SessionManager } from "../manager/session-manager.js";
import type { ResolvedAgentConfig } from "../shared/types.js";
import type { UsageTracker } from "../usage/tracker.js";
import type { UsageAggregate } from "../usage/types.js";
// Phase 96 Plan 05 D-04 — single-source-of-truth filesystem capability
// renderer. The same pure renderer used to assemble the system-prompt
// <filesystem_capability> block (Phase 96 Plan 02) is reused here for
// operator-facing /clawcode-status output, ensuring LLM-visible truth and
// operator-visible truth never drift.
import {
  renderFilesystemCapabilityBlock,
  type FlapHistoryEntry,
} from "../prompt/filesystem-capability-block.js";
import type { FsCapabilitySnapshot } from "../manager/persistent-session-handle.js";

/**
 * Snapshot of all values needed to render the status block. Frozen at
 * `buildStatusData` time so the renderer is a pure function of its input.
 *
 * Phase 103 added 5 new fields: contextFillPercentage, compactionCount,
 * tokensIn, tokensOut, activationAt. lastActivityAt is now actually
 * populated (was always undefined in Phase 93).
 */
export type StatusData = Readonly<{
  agentName: string;
  agentVersion: string;
  /** Short git sha. Undefined → renders as "unknown". */
  commitSha: string | undefined;
  /** SessionHandle.getModel() result — wins over configModel. */
  liveModel: string | undefined;
  /** ResolvedAgentConfig.model alias — fallback when liveModel is unset. */
  configModel: string | undefined;
  /** EffortLevel string or "unknown" when accessor threw. */
  effort: string;
  /** PermissionMode string or "unknown" when accessor threw. */
  permissionMode: string;
  /** SDK UUID from handle.sessionId, or undefined when handle missing. */
  sessionId: string | undefined;
  /** ms epoch from UsageTracker latest event for this session, or undefined. */
  lastActivityAt: number | undefined;
  hasActiveTurn: boolean;
  /** Phase 103 OBS-01 — context-zone fill ratio 0-1, undefined when no data. */
  contextFillPercentage: number | undefined;
  /** Phase 103 OBS-02 — successful compactions since daemon start. */
  compactionCount: number;
  /** Phase 103 OBS-01 — UsageTracker session aggregate; undefined when missing. */
  tokensIn: number | undefined;
  tokensOut: number | undefined;
  /** Phase 103 OBS-01 — registry.startedAt ms epoch, undefined when not started. */
  activationAt: number | undefined;
  /** ms epoch — for deterministic test assertions. */
  now: number;
}>;

/**
 * Inputs to `buildStatusData`. SessionManager is narrowed via `Pick` so tests
 * can pass plain-object stubs implementing only the accessors used.
 *
 * Phase 103 widened the Pick to include 4 new accessors:
 *   - getCompactionCountForAgent (OBS-02)
 *   - getContextFillPercentageForAgent (OBS-01)
 *   - getActivationAtForAgent (OBS-01)
 *   - getUsageTracker (OBS-01 — for tokens + lastActivityAt)
 */
export type BuildStatusDataInput = Readonly<{
  sessionManager: Pick<
    SessionManager,
    | "getEffortForAgent"
    | "getModelForAgent"
    | "getPermissionModeForAgent"
    | "getSessionHandle"
    | "getCompactionCountForAgent"
    | "getContextFillPercentageForAgent"
    | "getActivationAtForAgent"
    | "getUsageTracker"
  >;
  resolvedAgents: readonly ResolvedAgentConfig[];
  agentName: string;
  agentVersion: string;
  commitSha: string | undefined;
  now: number;
}>;

/** Try/catch wrapper that collapses thrown accessors to a fallback. */
function tryRead<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/**
 * Defensively assemble StatusData. Every SessionManager accessor is wrapped
 * (Pitfall 6 closure) — a thrown SessionError on `getEffortForAgent`
 * collapses to "unknown" instead of dropping the entire render.
 *
 * Phase 103 — additionally reads:
 *   - compactionCount (defaults to 0 on throw)
 *   - contextFillPercentage (undefined on throw or missing zone data)
 *   - activationAt (undefined on throw or never started)
 *   - tokensIn/Out via getUsageTracker(name).getSessionUsage(sessionId)
 *   - lastActivityAt via tracker.getDatabase() MAX(timestamp) lookup
 */
export function buildStatusData(input: BuildStatusDataInput): StatusData {
  const { sessionManager, resolvedAgents, agentName, agentVersion, commitSha, now } = input;

  const effort = tryRead<string>(
    () => sessionManager.getEffortForAgent(agentName),
    "unknown",
  );
  const liveModel = tryRead<string | undefined>(
    () => sessionManager.getModelForAgent(agentName),
    undefined,
  );
  const permissionMode = tryRead<string>(
    () => sessionManager.getPermissionModeForAgent(agentName),
    "unknown",
  );
  const handle = tryRead<unknown>(
    () => sessionManager.getSessionHandle(agentName),
    undefined,
  ) as
    | { sessionId?: string; hasActiveTurn?: () => boolean }
    | undefined;

  const sessionId =
    handle && typeof handle.sessionId === "string" ? handle.sessionId : undefined;
  const hasActiveTurn =
    handle && typeof handle.hasActiveTurn === "function"
      ? tryRead<boolean>(() => (handle.hasActiveTurn as () => boolean)(), false)
      : false;

  const configModel = resolvedAgents.find((a) => a.name === agentName)?.model;

  // Phase 103 OBS-02 — compaction counter mirror.
  const compactionCount = tryRead<number>(
    () => sessionManager.getCompactionCountForAgent(agentName),
    0,
  );

  // Phase 103 OBS-01 — context-zone fillPercentage from HeartbeatRunner.
  const contextFillPercentage = tryRead<number | undefined>(
    () => sessionManager.getContextFillPercentageForAgent(agentName),
    undefined,
  );

  // Phase 103 OBS-01 — registry.startedAt mirror.
  const activationAt = tryRead<number | undefined>(
    () => sessionManager.getActivationAtForAgent(agentName),
    undefined,
  );

  // Phase 103 OBS-01 — tokens + lastActivityAt from UsageTracker. Requires
  // both a UsageTracker AND a sessionId. If either missing, both fields stay
  // undefined and the renderer emits "n/a" / "unknown" respectively.
  let tokensIn: number | undefined;
  let tokensOut: number | undefined;
  let lastActivityAt: number | undefined;
  if (sessionId !== undefined) {
    const tracker = tryRead<UsageTracker | undefined>(
      () => sessionManager.getUsageTracker(agentName),
      undefined,
    );
    if (tracker !== undefined) {
      const agg = tryRead<UsageAggregate | undefined>(
        () => tracker.getSessionUsage(sessionId),
        undefined,
      );
      if (agg !== undefined && agg.event_count > 0) {
        tokensIn = agg.tokens_in;
        tokensOut = agg.tokens_out;
        // Read the latest event timestamp directly from the tracker DB. The
        // aggregate exposes duration_ms but no per-event timestamp; a direct
        // SELECT MAX(timestamp) keeps the renderer pure and avoids adding a
        // dedicated tracker accessor for v1. Wrapped in a try/catch — schema
        // drift / locked DB / null row all degrade to "unknown" gracefully.
        try {
          const row = tracker
            .getDatabase()
            .prepare(
              "SELECT MAX(timestamp) AS ts FROM usage_events WHERE session_id = ?",
            )
            .get(sessionId) as { ts: string | null } | undefined;
          if (row?.ts) {
            const parsed = Date.parse(row.ts);
            if (!Number.isNaN(parsed)) lastActivityAt = parsed;
          }
        } catch {
          // observational — leave lastActivityAt undefined
        }
      }
    }
  }

  return Object.freeze({
    agentName,
    agentVersion,
    commitSha,
    liveModel,
    configModel,
    effort,
    permissionMode,
    sessionId,
    lastActivityAt,
    hasActiveTurn,
    contextFillPercentage,
    compactionCount,
    tokensIn,
    tokensOut,
    activationAt,
    now,
  });
}

/**
 * Phase 103 OBS-01 — friendly Reasoning label derived from the effort tier.
 * Phase 93's "Reasoning: n/a" was a placeholder; Phase 103 sources the label
 * from effort because the two are semantically the same in ClawCode (effort
 * IS the reasoning level). Kept as a separate field for OpenClaw parity.
 */
function effortToReasoningLabel(effort: string): string {
  switch (effort) {
    case "off":
      return "off (no extended thinking)";
    case "low":
      return "low effort";
    case "medium":
      return "medium effort";
    case "high":
      return "high effort";
    case "xhigh":
      return "extra-high effort";
    case "max":
      return "max effort";
    case "auto":
      return "model default";
    default:
      return effort;
  }
}

/**
 * Render the 9-line OpenClaw-parity status block.
 *
 * Phase 103 reshape — line-by-line:
 *   0. 🦞 ClawCode v<version> (<commit>)
 *   1. 🧠 Model: <live|config|unknown> · 🔑 sdk
 *   2. 🔄 Fallbacks: n/a                     (honest — no current source)
 *   3. 📚 Context: <pct>% · 🧹 Compactions: N
 *   4. 🧮 Tokens: <in> in / <out> out         (or n/a)
 *   5. 🧵 Session: …<last12> • updated <ago>
 *   6. 📋 Task: <busy|idle>
 *   7. ⚙️ Runtime: SDK session · Think: <effort> · Reasoning: <label> · Permissions: <mode>
 *   8. 👥 Activation: <ago> · 🪢 Queue: <1 in-flight|idle>
 *
 * Dropped from Phase 93 line 7: Runner / Fast / Harness / Elevated. The
 * OpenClaw-only fields have no ClawCode analog. Drop is pinned by the
 * "DOES NOT emit Fast:/Elevated:/Harness:" tests in __tests__/.
 */
export function renderStatus(data: StatusData): string {
  // Line 0 — version + commit sha
  const versionLine = `🦞 ClawCode v${data.agentVersion} (${data.commitSha ?? "unknown"})`;

  // Line 1 — model + key source. ClawCode authenticates via SDK (not
  // OAuth/API key), so the "🔑" annotation is hard-coded "sdk".
  const modelDisplay = data.liveModel ?? data.configModel ?? "unknown";
  const modelLine = `🧠 Model: ${modelDisplay} · 🔑 sdk`;

  // Line 2 — Fallbacks remain `n/a` — no current source (Research §11).
  const fallbacksLine = "🔄 Fallbacks: n/a";

  // Line 3 — Context % from HeartbeatRunner zone; Compactions live count.
  const contextPctLabel =
    data.contextFillPercentage !== undefined
      ? `${Math.round(data.contextFillPercentage * 100)}%`
      : "unknown";
  const contextLine = `📚 Context: ${contextPctLabel} · 🧹 Compactions: ${data.compactionCount}`;

  // Line 4 — Tokens from UsageTracker session aggregate. Both fields must be
  // defined (tokens_in alone is meaningless); else honest n/a.
  const tokensLine =
    data.tokensIn !== undefined && data.tokensOut !== undefined
      ? `🧮 Tokens: ${data.tokensIn} in / ${data.tokensOut} out`
      : "🧮 Tokens: n/a";

  // Line 5 — abbreviated session id + relative updated-time. D-93-01-2:
  // last 12 chars of handle.sessionId (a UUID in ClawCode; OpenClaw's
  // "channel-prefix" notion does not apply). D-93-01-3: date-fns
  // formatDistanceToNow with explicit " ago" suffix for stable test
  // assertions (addSuffix:false avoids "in X minutes" for timezone-skewed
  // clocks).
  const sessionPrefix =
    data.sessionId !== undefined ? `…${data.sessionId.slice(-12)}` : "unknown";
  const updatedLabel =
    data.lastActivityAt !== undefined
      ? `${formatDistanceToNow(data.lastActivityAt, { addSuffix: false })} ago`
      : "unknown";
  const sessionLine = `🧵 Session: ${sessionPrefix} • updated ${updatedLabel}`;

  // Line 6 — task state from SessionHandle.hasActiveTurn() (depth-1
  // SerialTurnQueue inFlight slot, per Phase 73).
  const taskLine = `📋 Task: ${data.hasActiveTurn ? "busy" : "idle"}`;

  // Line 7 — runtime / Think / Reasoning / Permissions. Phase 103 dropped
  // Runner / Fast / Harness / Elevated (OpenClaw-only). Reasoning is a
  // human-friendly label of the effort tier, not a separate field.
  const reasoningLabel = effortToReasoningLabel(data.effort);
  const optionsLine =
    `⚙️ Runtime: SDK session · Think: ${data.effort} · ` +
    `Reasoning: ${reasoningLabel} · Permissions: ${data.permissionMode}`;

  // Line 8 — Activation from registry.startedAt; Queue from hasActiveTurn
  // (depth-1 SerialTurnQueue — busy ⇒ "1 in-flight", idle ⇒ "idle").
  const activationLabel =
    data.activationAt !== undefined
      ? `${formatDistanceToNow(data.activationAt, { addSuffix: false })} ago`
      : "unknown";
  const queueLabel = data.hasActiveTurn ? "1 in-flight" : "idle";
  const activationLine = `👥 Activation: ${activationLabel} · 🪢 Queue: ${queueLabel}`;

  return [
    versionLine,
    modelLine,
    fallbacksLine,
    contextLine,
    tokensLine,
    sessionLine,
    taskLine,
    optionsLine,
    activationLine,
  ].join("\n");
}

/**
 * Phase 96 Plan 05 D-04 — render the filesystem capability section for
 * /clawcode-status (operator inspection surface).
 *
 * REUSES `renderFilesystemCapabilityBlock` from Phase 96 Plan 02 — single
 * source of truth between the LLM system-prompt block AND the operator's
 * /clawcode-status inspection. A separate render path would drift over
 * time; sharing the same renderer guarantees what the operator sees IS
 * what the LLM sees (modulo the operator-friendly diagnostic suffix below
 * which is appended OUTSIDE the LLM-visible XML block).
 *
 * Operator-friendly diagnostic suffix:
 *   When the snapshot has degraded entries, append a "Degraded paths
 *   (operator diagnostic)" section listing each degraded path with its
 *   lastProbeAt timestamp + verbatim error. Operators inspect via
 *   /clawcode-status to see EVERYTHING (including paths the LLM is
 *   intentionally NOT shown — degraded/unknown/sticky). Phase 96 D-04
 *   spec — "operator inspects via /clawcode-status".
 *
 * Status emoji LOCKED ✓/⚠ matches the renderProbeFsEmbed convention.
 *
 * @param snapshot           ReadonlyMap<canonicalPath, FsCapabilitySnapshot>
 *                           keyed by canonical absPath (from
 *                           SessionHandle.getFsCapabilitySnapshot()).
 * @param agentWorkspaceRoot Canonical absPath of this agent's workspace
 *                           (e.g. /home/clawcode/.clawcode/agents/{agent}).
 * @param flapHistory        Optional flap-stability tracker (Phase 94/96
 *                           5-min sticky-degraded window).
 * @returns Formatted markdown string. Empty string when snapshot is empty
 *          AND no degraded entries — preserves stable-prefix invariant.
 */
export function renderCapabilityBlock(
  snapshot: ReadonlyMap<string, FsCapabilitySnapshot>,
  agentWorkspaceRoot: string,
  flapHistory?: Map<string, FlapHistoryEntry>,
): string {
  // Single-source-of-truth: reuse the pure renderer from 96-02. The output
  // is the SAME XML-tagged block injected into the LLM system prompt.
  const block = renderFilesystemCapabilityBlock(
    snapshot,
    agentWorkspaceRoot,
    flapHistory !== undefined ? { flapHistory } : undefined,
  );

  // Operator-friendly diagnostic suffix — degraded entries with lastProbeAt
  // freshness signal. CRITICAL invariant: lastProbeAt MUST appear so
  // operators see freshness. Pinned by static-grep on "lastProbeAt" in
  // status-render.ts (96-05 acceptance criteria).
  const degraded: string[] = [];
  for (const [path, state] of snapshot) {
    if (state.status === "degraded") {
      const errSuffix = state.error ? `, error: ${state.error}` : "";
      degraded.push(
        `- ⚠ ${path} (lastProbeAt: ${state.lastProbeAt}${errSuffix})`,
      );
    }
  }

  if (block.length === 0 && degraded.length === 0) {
    // Nothing advertisable AND nothing degraded — empty string preserves
    // /clawcode-status invariant for v2.5 fixtures without fileAccess.
    return "";
  }

  if (degraded.length === 0) {
    return block;
  }

  const diagnosticSection = [
    "",
    "## Degraded paths (operator diagnostic)",
    ...degraded,
  ].join("\n");

  // When the LLM-visible block is empty (all entries degraded/sticky) we
  // still surface the diagnostic for the operator. The block + diagnostic
  // join honors the W-4 invariant from 96-02: an empty `block` does NOT
  // produce a stub header.
  return block.length === 0 ? diagnosticSection.trim() : `${block}${diagnosticSection}`;
}
