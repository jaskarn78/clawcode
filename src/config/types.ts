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
]);

/**
 * Field path prefixes that require a daemon restart to take effect.
 */
export const NON_RELOADABLE_FIELDS: ReadonlySet<string> = new Set([
  "agents.*.model",
  "agents.*.workspace",
  "defaults.model",
  "defaults.basePath",
]);
