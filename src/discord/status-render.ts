/**
 * Phase 93 Plan 01 — pure status-render module.
 *
 * Replaces the 3-line `/clawcode-status` output (Phase 83 EFFORT-07 daemon
 * short-circuit) with the rich OpenClaw-parity 9-line block. Honors the
 * locked CONTEXT.md decisions:
 *   - D-93-01-1: NO new token-counter plumbing — Context/Compactions/Tokens
 *     render `n/a` placeholders. Output ALL lines unconditionally.
 *   - D-93-01-2: Session id sliced to last 12 chars of `handle.sessionId`.
 *   - D-93-01-3: Relative updated-time via `date-fns/formatDistanceToNow`
 *     (existing project dep — no new install).
 *   - D-93-01-4: Defensive reads — every SessionManager accessor try/catch'd
 *     so a thrown SessionError on `getEffortForAgent` collapses to `unknown`
 *     rather than dropping the entire render to "Failed to read status"
 *     (Pitfall 6).
 *
 * Pitfall 7 closure: emoji literals are canonical-Unicode (no FE0F variation
 * selector) so rendering is consistent across Discord clients.
 *
 * Pure module — every input is dependency-injected (sessionManager,
 * resolvedAgents, now). No SessionManager / Discord imports leak into the
 * line formatters; tests construct StatusData literals or pass throwing
 * stubs without standing up real session infrastructure.
 *
 * Carry-forward: when a future phase plumbs `lastActivityAt` + token
 * counters, the renderer's `lastActivityAt`/Context/Compactions/Tokens
 * fields are the integration points (no schema changes needed — just
 * StatusData population).
 */
import { formatDistanceToNow } from "date-fns";
import type { SessionManager } from "../manager/session-manager.js";
import type { ResolvedAgentConfig } from "../shared/types.js";
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
  /** ms epoch — currently always undefined; reserved for future plumbing. */
  lastActivityAt: number | undefined;
  hasActiveTurn: boolean;
  /** ms epoch — for deterministic test assertions. */
  now: number;
}>;

/**
 * Inputs to `buildStatusData`. SessionManager is narrowed via `Pick` so tests
 * can pass plain-object stubs implementing only the four accessors used.
 */
export type BuildStatusDataInput = Readonly<{
  sessionManager: Pick<
    SessionManager,
    | "getEffortForAgent"
    | "getModelForAgent"
    | "getPermissionModeForAgent"
    | "getSessionHandle"
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
 * `lastActivityAt` is currently always undefined: no per-handle accessor
 * exists yet. CONTEXT.md DEFERRED list (token counters + compactions) has
 * the same posture — the renderer surface is in place; future phase plumbs
 * the data.
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

  // No per-handle lastActivityAt accessor exists yet — render "unknown" until
  // a future phase plumbs SessionHandle.lastActivityAt. CONTEXT.md DEFERRED
  // list (token counters + compactions are the other deferred axis).
  const lastActivityAt: number | undefined = undefined;

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
    now,
  });
}

/**
 * Render the 9-line OpenClaw-parity status block.
 *
 * Every line emits unconditionally; unknown values render as `unknown` /
 * `n/a` per the locked decision (D-93-01-1). The output shape is pinned by
 * the R-01..R-07 unit tests in `__tests__/status-render.test.ts` — line
 * indices and prefix strings are the contract.
 */
export function renderStatus(data: StatusData): string {
  // Line 0 — version + commit sha
  const versionLine = `🦞 ClawCode v${data.agentVersion} (${data.commitSha ?? "unknown"})`;

  // Line 1 — model + key source. ClawCode authenticates via SDK (not
  // OAuth/API key), so the "🔑" annotation is hard-coded "sdk".
  const modelDisplay = data.liveModel ?? data.configModel ?? "unknown";
  const modelLine = `🧠 Model: ${modelDisplay} · 🔑 sdk`;

  // Lines 2-4 — placeholders for OpenClaw-only fields. CONTEXT.md DEFERRED:
  // token counters and compactions plumb in a future phase.
  const fallbacksLine = "🔄 Fallbacks: n/a";
  const contextLine = "📚 Context: unknown · 🧹 Compactions: n/a";
  const tokensLine = "🧮 Tokens: n/a";

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

  // Line 7 — runtime/options compound line. ClawCode-only fields (Runner,
  // Fast, Harness, Reasoning, Elevated) are constants; Think + Permissions
  // sourced from live handle accessors.
  const optionsLine =
    `⚙️ Runtime: SDK session · Runner: n/a · Think: ${data.effort} · ` +
    `Fast: n/a · Harness: n/a · Reasoning: n/a · ` +
    `Permissions: ${data.permissionMode} · Elevated: n/a`;

  // Line 8 — activation + queue. ClawCode is bound-channel by construction
  // (one agent per Discord channel via routing-table); queue is depth-1 in
  // the SerialTurnQueue but no per-agent queue-depth accessor yet → n/a.
  const activationLine = "👥 Activation: bound-channel · 🪢 Queue: n/a";

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
