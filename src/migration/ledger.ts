/**
 * Append-only JSONL ledger for the OpenClaw → ClawCode migration lifecycle.
 *
 * Each row records a single state transition for a single agent. The ledger
 * is the canonical status source for `clawcode migrate openclaw list` per
 * 76-CONTEXT D-list-status-source ("list reads per-agent status from the
 * ledger, never from the target filesystem").
 *
 * File lives at `.planning/migration/ledger.jsonl` (repo-tracked for git
 * audit). Directory is created on first write.
 *
 * Invariants (enforced in code, not conventions):
 *   1. Append-only — NO delete / rewrite / truncate helpers exist here.
 *      Phase 81 rollback appends a `rolled-back` row; it never removes prior
 *      rows. Adding a truncate helper is a PR-block.
 *   2. Validated on WRITE (not just read) — appendRow zod-parses before
 *      mkdir, so a bad row cannot even create the migration dir, let alone
 *      pollute the ledger. This is load-bearing for determinism.
 *   3. `appendFile` (not `writeFile`) — concurrent migrators would lose rows
 *      under writeFile's read-modify-write pattern.
 *
 * DO NOT:
 *   - Add `clearLedger` / `truncate` / `removeRow` — violates append-only.
 *   - Use `fs.writeFile` — race conditions.
 *   - Introduce a date-parsing library — `Date.parse` + "T" presence
 *     is sufficient ISO-8601 detection for our row scale (~100 rows).
 */
import { z } from "zod/v4";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Canonical ledger-action enum. Order matches the migration lifecycle:
 *   plan → apply → verify → (optional rollback) → cutover
 */
export const LEDGER_ACTIONS = ["plan", "apply", "verify", "rollback", "cutover"] as const;
export type LedgerAction = (typeof LEDGER_ACTIONS)[number];

/**
 * Canonical ledger-status enum. Bootstrap uses `pending` on first `plan`;
 * `re-planned` marks idempotent replay rows whose source_hash differs from
 * the previous plan row for the same agent.
 */
export const LEDGER_STATUSES = ["pending", "migrated", "verified", "rolled-back", "re-planned"] as const;
export type LedgerStatus = (typeof LEDGER_STATUSES)[number];

/**
 * Canonical per-guard outcome enum for pre-flight rows (Phase 77+).
 * Narrower than `status`: `refuse` always pairs with `status: "pending"`
 * because a refused guard never advances state. `allow` pairs with
 * whatever `status` the caller chose (typically `"pending"` at apply-
 * pre-flight time — the apply phase itself is Phase 78+).
 */
export const LEDGER_OUTCOMES = ["allow", "refuse"] as const;
export type LedgerOutcome = (typeof LEDGER_OUTCOMES)[number];

/**
 * Zod validator for a single ledger row. `ts` must parse via Date.parse
 * AND contain a "T" separator — rules out ambiguous "2026-04-20" date-only
 * strings that Date.parse accepts but aren't full ISO 8601.
 *
 * Phase 77+ additive extension: `step`, `outcome`, `file_hashes` are all
 * optional — a row that omits them continues to validate exactly as before.
 * This is the load-bearing backward-compat invariant for every Phase 76
 * consumer (`appendRow` / `readRows` / `latestStatusByAgent` / the `list`
 * CLI subcommand): adding fields MUST NOT break any existing row.
 */
export const ledgerRowSchema = z.object({
  ts: z
    .string()
    .refine(
      (v) => !Number.isNaN(Date.parse(v)) && v.includes("T"),
      "ts must be ISO 8601 with time component",
    ),
  action: z.enum(LEDGER_ACTIONS),
  agent: z.string().min(1),
  status: z.enum(LEDGER_STATUSES),
  source_hash: z.string().min(1),
  target_hash: z.string().optional(),
  notes: z.string().optional(),
  // Phase 77+ additive extension (backward-compatible — all optional).
  // `step` identifies which guard produced the row, e.g.
  //   "pre-flight:daemon" / "pre-flight:secret" /
  //   "pre-flight:channel" / "pre-flight:readonly".
  step: z.string().min(1).optional(),
  // `outcome` is narrower than `status` — only `allow` / `refuse`.
  outcome: z.enum(LEDGER_OUTCOMES).optional(),
  // `file_hashes` is a map of path → sha256 for witness rows. Both keys
  // AND values must be non-empty strings — rules out `{"": "abc"}` and
  // `{"path": ""}` which carry no witness information.
  file_hashes: z.record(z.string().min(1), z.string().min(1)).optional(),
});
export type LedgerRow = z.infer<typeof ledgerRowSchema>;

/** Repo-tracked ledger location. Locked per 76-CONTEXT "Ledger path". */
export const DEFAULT_LEDGER_PATH = ".planning/migration/ledger.jsonl";

/**
 * Append a single validated row to the ledger. Creates the parent directory
 * on first write. Throws pre-mkdir if validation fails — a bad row never
 * creates the file or the directory.
 */
export async function appendRow(
  ledgerPath: string,
  row: LedgerRow,
): Promise<void> {
  const parsed = ledgerRowSchema.safeParse(row);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid LedgerRow: ${issues}`);
  }
  await mkdir(dirname(ledgerPath), { recursive: true });
  // appendFile (not writeFile) — concurrent migrators would lose rows
  // under writeFile's read-modify-write. JSONL invariant: one JSON object
  // per line, terminated by \n (including the last line — makes concat
  // simple for downstream tools).
  await appendFile(ledgerPath, `${JSON.stringify(parsed.data)}\n`, "utf8");
}

/**
 * Read and validate every row in the ledger. Returns `[]` (no throw) when
 * the file does not exist — this is the first-run case before any `plan`
 * has executed, and `list` must work on a fresh checkout.
 *
 * Blank lines are skipped (JSONL files sometimes acquire trailing newlines).
 * Malformed JSON or schema-invalid rows throw with line-number context so
 * an operator can `sed -n '<line>p'` the offending row.
 */
export async function readRows(
  ledgerPath: string,
): Promise<readonly LedgerRow[]> {
  if (!existsSync(ledgerPath)) return [];
  const text = await readFile(ledgerPath, "utf8");
  const lines = text.split("\n");
  const rows: LedgerRow[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(line);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Malformed JSON in ${ledgerPath} at line ${i + 1}: ${msg}`,
      );
    }
    const result = ledgerRowSchema.safeParse(parsedJson);
    if (!result.success) {
      const issues = result.error.issues
        .map((s) => `${s.path.join(".") || "(root)"}: ${s.message}`)
        .join("; ");
      throw new Error(
        `Invalid LedgerRow in ${ledgerPath} at line ${i + 1}: ${issues}`,
      );
    }
    rows.push(result.data);
  }
  return rows;
}

/**
 * Derive a `Map<agent, LedgerStatus>` holding ONLY the most recent status
 * per agent (insert-order = lifecycle order by convention — rows are append-
 * only and timestamped at write). Used by `list` to render the status column.
 */
export async function latestStatusByAgent(
  ledgerPath: string,
): Promise<ReadonlyMap<string, LedgerStatus>> {
  const rows = await readRows(ledgerPath);
  const map = new Map<string, LedgerStatus>();
  for (const r of rows) {
    // last-write-wins per agent. Append-only file ordering is the truth
    // source per 76-CONTEXT; do not re-sort by ts (wall-clock skew between
    // apply/verify/rollback rows would reshuffle a legitimate sequence).
    map.set(r.agent, r.status);
  }
  return map;
}
