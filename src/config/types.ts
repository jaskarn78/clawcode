/**
 * Types and constants for config hot-reload infrastructure.
 */

/**
 * A single field-level change detected between two config versions.
 */
export type ConfigChange = {
  readonly fieldPath: string;
  readonly oldValue: unknown;
  readonly newValue: unknown;
  readonly reloadable: boolean;
};

/**
 * Result of diffing two config objects.
 */
export type ConfigDiff = {
  readonly changes: readonly ConfigChange[];
  readonly hasReloadableChanges: boolean;
  readonly hasNonReloadableChanges: boolean;
};

/**
 * A single entry in the JSONL audit trail.
 */
export type AuditEntry = {
  readonly timestamp: string;
  readonly fieldPath: string;
  readonly oldValue: unknown;
  readonly newValue: unknown;
};

/**
 * Event emitted when a config change is detected.
 */
export type ConfigChangeEvent = {
  readonly diff: ConfigDiff;
  readonly timestamp: string;
};

/**
 * Field path prefixes that can be hot-reloaded without daemon restart.
 */
export const RELOADABLE_FIELDS: ReadonlySet<string> = new Set([
  "agents.*.channels",
  "agents.*.skills",
  "agents.*.schedules",
  "agents.*.heartbeat",
  "defaults.heartbeat",
  // Phase 83 EFFORT-01 — runtime override via handle.setEffort → next turn.
  // No socket/db/workspace resource touched; buildOptions re-reads
  // currentEffort per turn, so YAML edits are picked up on restart AND a
  // live /clawcode-effort call invokes q.setMaxThinkingTokens immediately.
  "agents.*.effort",
  "defaults.effort",
  // Phase 86 MODEL-01 — allowlist is read lazily by the Discord picker
  // on every invocation (no cached state in a session handle). A YAML
  // edit takes effect on the NEXT /clawcode-model interaction without
  // restart. Runtime model SWITCHES remain non-reloadable (agents.*.model
  // still requires session restart per types.ts:63) — the allowlist
  // governs what's PICKABLE, not what's active.
  "agents.*.allowedModels",
  "defaults.allowedModels",
  // Phase 89 GREET-07 — both flags read lazily by SessionManager.restartAgent
  // on every call (no cached state). A YAML edit takes effect on the NEXT
  // restart without daemon bounce.
  "agents.*.greetOnRestart",
  "defaults.greetOnRestart",
  "agents.*.greetCoolDownMs",
  "defaults.greetCoolDownMs",
  // Phase 90 MEM-01 — Next session boot picks up a YAML edit. MEMORY.md
  // content itself is re-read at every session boot (mtime naturally
  // busts the stable-prefix cache); the schema flag gates the read.
  "agents.*.memoryAutoLoad",
  "defaults.memoryAutoLoad",
  "agents.*.memoryAutoLoadPath",
  // Phase 90 MEM-03 — top-K + token budget read lazily by
  // getMemoryRetrieverForAgent at each turn. A YAML edit takes effect on
  // the NEXT turn without daemon bounce.
  "agents.*.memoryRetrievalTopK",
  "defaults.memoryRetrievalTopK",
  "defaults.memoryRetrievalTokenBudget",
  // Phase 90 MEM-02 — scanner enable flag. Reloadable semantics: a YAML
  // flip from true→false at runtime does NOT stop an already-running
  // scanner (requires daemon restart); a false→true flip starts scanners
  // only for newly-added agents. Pragmatic compromise vs. full watcher-
  // lifecycle churn.
  "agents.*.memoryScannerEnabled",
  "defaults.memoryScannerEnabled",
  // Phase 90 MEM-04 — flush cadence. Reloadable: YAML edit takes effect
  // on the NEXT agent start (current timers keep running at the old
  // interval). A full daemon restart is NOT required for the fleet to
  // pick up a new default.
  "agents.*.memoryFlushIntervalMs",
  "defaults.memoryFlushIntervalMs",
  // Phase 90 MEM-05 — reaction emoji read lazily by TurnDispatcher at each
  // cue-detection event. A YAML edit takes effect on the NEXT cue-detected
  // turn.
  "agents.*.memoryCueEmoji",
  "defaults.memoryCueEmoji",
  // Phase 94 TOOL-10 / D-10 — system-prompt directives. Reloadable: a
  // YAML edit takes effect on the NEXT prompt assembly (per-turn boundary
  // — assembler reads via the loader resolver each turn). No socket / DB /
  // workspace restart required. 8th application of the Phase 83/86/89/90
  // additive-optional reloadable blueprint.
  "agents.*.systemPromptDirectives",
  "defaults.systemPromptDirectives",
]);

/**
 * Field path prefixes that require a daemon restart to take effect.
 */
export const NON_RELOADABLE_FIELDS: ReadonlySet<string> = new Set([
  "agents.*.model",
  "agents.*.workspace",
  // Phase 75 SHARED-01 — memoryPath determines which memories.db / inbox/ /
  // heartbeat.log / session-state dir this agent owns. Swapping those at
  // runtime would require (a) closing the live MemoryStore + UsageTracker +
  // TraceStore, (b) re-opening against new paths, and (c) re-attaching the
  // chokidar InboxSource watcher and heartbeat runner — none of which are
  // implemented and all of which risk data loss. Operators must run
  // `systemctl stop clawcode && apply && systemctl start clawcode`.
  // The classifier falls through to `false` for any field not in
  // RELOADABLE_FIELDS, so this entry is documentation-of-intent; the
  // differ tests in differ.test.ts assert memoryPath ends up reloadable:false.
  "agents.*.memoryPath",
  "defaults.model",
  "defaults.basePath",
]);
