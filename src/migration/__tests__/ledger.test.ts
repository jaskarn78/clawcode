import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendRow,
  readRows,
  latestStatusByAgent,
  ledgerRowSchema,
  DEFAULT_LEDGER_PATH,
  LEDGER_ACTIONS,
  LEDGER_STATUSES,
  LEDGER_OUTCOMES,
  type LedgerRow,
} from "../ledger.js";

const goodRow = (overrides: Partial<LedgerRow> = {}): LedgerRow => ({
  ts: new Date().toISOString(),
  action: "plan",
  agent: "general",
  status: "pending",
  source_hash: "abc123",
  ...overrides,
});

describe("ledger", () => {
  let tmpDir: string;
  let ledgerPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ledger-test-"));
    // Nested under a missing subdir to exercise the mkdir recursive path.
    ledgerPath = join(tmpDir, "planning", "migration", "ledger.jsonl");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates .planning/migration/ dir on first write and appends one JSONL line", async () => {
    expect(existsSync(ledgerPath)).toBe(false);
    await appendRow(ledgerPath, goodRow());
    expect(existsSync(ledgerPath)).toBe(true);
    const rows = await readRows(ledgerPath);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.agent).toBe("general");
  });

  it("two successive appendRow calls produce two rows in insert order", async () => {
    await appendRow(
      ledgerPath,
      goodRow({ agent: "research", ts: "2026-04-20T10:00:00.000Z" }),
    );
    await appendRow(
      ledgerPath,
      goodRow({ agent: "general", ts: "2026-04-20T10:01:00.000Z" }),
    );
    const rows = await readRows(ledgerPath);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.agent).toBe("research");
    expect(rows[1]?.agent).toBe("general");
  });

  it("readRows returns [] when the ledger file does not yet exist", async () => {
    const missing = join(tmpDir, "never-existed", "ledger.jsonl");
    const rows = await readRows(missing);
    expect(rows).toEqual([]);
  });

  it("readRows skips blank lines and throws with line number on malformed JSON", async () => {
    // Seed a file by hand — includes a blank line to verify skip, and a
    // malformed line to verify the error message contains the line number.
    const valid = JSON.stringify(goodRow({ agent: "work" }));
    const malformed = "{not-json";
    // mkdir indirectly via appendRow on a valid row first:
    await appendRow(ledgerPath, goodRow({ agent: "work" }));
    // Now append raw bytes to corrupt line 3.
    writeFileSync(ledgerPath, valid + "\n\n" + malformed + "\n");

    let caught: Error | undefined;
    try {
      await readRows(ledgerPath);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    // The third line is malformed (line 1 = valid JSON, line 2 = blank skipped,
    // line 3 = malformed).
    expect(caught?.message).toMatch(/line 3/);
    expect(caught?.message).toContain(ledgerPath);
  });

  it("latestStatusByAgent returns only the last status per agent", async () => {
    await appendRow(ledgerPath, goodRow({ agent: "general", status: "pending", ts: "2026-04-20T10:00:00.000Z" }));
    await appendRow(ledgerPath, goodRow({ agent: "research", status: "pending", ts: "2026-04-20T10:01:00.000Z" }));
    await appendRow(ledgerPath, goodRow({ agent: "general", status: "migrated", ts: "2026-04-20T10:02:00.000Z", action: "apply" }));
    await appendRow(ledgerPath, goodRow({ agent: "general", status: "verified", ts: "2026-04-20T10:03:00.000Z", action: "verify" }));
    await appendRow(ledgerPath, goodRow({ agent: "research", status: "rolled-back", ts: "2026-04-20T10:04:00.000Z", action: "rollback" }));

    const map = await latestStatusByAgent(ledgerPath);
    expect(map.get("general")).toBe("verified");
    expect(map.get("research")).toBe("rolled-back");
    expect(map.size).toBe(2);
  });

  it("rejects unknown action values at schema level", () => {
    const bad = { ...goodRow(), action: "delete" };
    const result = ledgerRowSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects non-ISO ts strings at schema level", () => {
    const bad = { ...goodRow(), ts: "not-a-date-at-all" };
    const result = ledgerRowSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("exposes the locked constants: DEFAULT_LEDGER_PATH, LEDGER_ACTIONS, LEDGER_STATUSES", () => {
    expect(DEFAULT_LEDGER_PATH).toBe(".planning/migration/ledger.jsonl");
    expect(LEDGER_ACTIONS).toEqual([
      "plan",
      "apply",
      "verify",
      "rollback",
      "cutover",
    ]);
    expect(LEDGER_STATUSES).toEqual([
      "pending",
      "migrated",
      "verified",
      "rolled-back",
      "re-planned",
    ]);
  });

  it("appendRow throws before writing when given an invalid row", async () => {
    const bad = { ...goodRow(), status: "not-a-status" } as unknown as LedgerRow;
    let caught: Error | undefined;
    try {
      await appendRow(ledgerPath, bad);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    // File must NOT have been created — validation happens pre-mkdir.
    expect(existsSync(ledgerPath)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Phase 77+ additive schema extension — minimal RED guard for Task 1.
  // Verifies the closed-enum tuple is exposed and the schema accepts the
  // three new optional fields. Round-trip + full negative-shape coverage
  // lives in the dedicated `ledger schema extensions (Phase 77)` suite below.
  // ---------------------------------------------------------------------------
  it("exposes LEDGER_OUTCOMES as readonly tuple ['allow','refuse']", () => {
    expect(LEDGER_OUTCOMES).toEqual(["allow", "refuse"]);
  });

  it("accepts a row with step + outcome + file_hashes populated (schema-level)", () => {
    const row = {
      ...goodRow(),
      step: "pre-flight:daemon",
      outcome: "refuse" as const,
      file_hashes: { "/home/u/.clawcode/clawcode.yaml": "deadbeef" },
    };
    const result = ledgerRowSchema.safeParse(row);
    expect(result.success).toBe(true);
  });
});
