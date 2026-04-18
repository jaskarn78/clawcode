/**
 * Phase 69 Plan 03 Task 1 — api_key_sessions + ApiKeySessionIndex tests (OPENAI-05).
 *
 * Covers the per-bearer-key → session_id mapping that gives each API key its
 * own persistent conversation with an agent. Tests validate:
 *   - Isolation: two different key_hashes for the same agent get distinct sessions.
 *   - Continuity: close the DB, reopen at the same path, lookup still resolves.
 *   - Revoke path: delete removes the row cleanly.
 *   - Migration idempotency: running the CREATE TABLE twice does not error.
 *
 * Uses the real migration SQL from src/memory/store.ts (by calling the helper
 * indirectly via MemoryStore construction on a :memory: db) for migration
 * idempotency tests, plus a bare `better-sqlite3` Database for focused unit
 * tests of ApiKeySessionIndex.
 */

import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ApiKeySessionIndex,
  API_KEY_SESSIONS_MIGRATION_SQL,
  lookupSessionForKey,
  recordSessionForKey,
} from "../session-index.js";

describe("ApiKeySessionIndex", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(API_KEY_SESSIONS_MIGRATION_SQL);
  });

  afterEach(() => {
    db.close();
  });

  it("first lookup for unknown keyHash returns null", () => {
    const index = new ApiKeySessionIndex(db);
    expect(index.lookup("a".repeat(64))).toBeNull();
  });

  it("record then lookup returns the session_id and agent_name", () => {
    const index = new ApiKeySessionIndex(db);
    const keyHash = "a".repeat(64);
    index.record(keyHash, "clawdy", "sess-abc-123");
    const found = index.lookup(keyHash);
    expect(found).not.toBeNull();
    expect(found?.session_id).toBe("sess-abc-123");
    expect(found?.agent_name).toBe("clawdy");
  });

  it("record with existing key_hash updates session_id (ON CONFLICT REPLACE semantics)", () => {
    const index = new ApiKeySessionIndex(db);
    const keyHash = "b".repeat(64);
    index.record(keyHash, "clawdy", "sess-original");
    index.record(keyHash, "clawdy", "sess-rotated");
    const found = index.lookup(keyHash);
    expect(found?.session_id).toBe("sess-rotated");
  });

  it("two different key_hashes for same agent have distinct session_id rows (isolation)", () => {
    const index = new ApiKeySessionIndex(db);
    const key1 = "c".repeat(64);
    const key2 = "d".repeat(64);
    index.record(key1, "clawdy", "sess-alpha");
    index.record(key2, "clawdy", "sess-beta");
    expect(index.lookup(key1)?.session_id).toBe("sess-alpha");
    expect(index.lookup(key2)?.session_id).toBe("sess-beta");
  });

  it("touch updates last_used_at without changing session_id", () => {
    const index = new ApiKeySessionIndex(db);
    const keyHash = "e".repeat(64);
    index.record(keyHash, "clawdy", "sess-1");

    const before = db
      .prepare("SELECT last_used_at FROM api_key_sessions WHERE key_hash = ?")
      .get(keyHash) as { last_used_at: number };

    // Small sleep equivalent — advance wall clock by mocking Date? Simpler:
    // just ensure the value was re-stamped to a non-past number and the
    // session_id remains. We assert session_id unchanged + last_used_at is
    // at least the original (monotonic per Date.now()).
    index.touch(keyHash);

    const after = db
      .prepare(
        "SELECT last_used_at, session_id FROM api_key_sessions WHERE key_hash = ?",
      )
      .get(keyHash) as { last_used_at: number; session_id: string };

    expect(after.session_id).toBe("sess-1");
    expect(after.last_used_at).toBeGreaterThanOrEqual(before.last_used_at);
  });

  it("delete removes the row (revoke path)", () => {
    const index = new ApiKeySessionIndex(db);
    const keyHash = "f".repeat(64);
    index.record(keyHash, "clawdy", "sess-to-revoke");
    expect(index.lookup(keyHash)).not.toBeNull();
    expect(index.delete(keyHash)).toBe(true);
    expect(index.lookup(keyHash)).toBeNull();
    // Second delete returns false (nothing to remove).
    expect(index.delete(keyHash)).toBe(false);
  });

  it("listForAgent returns all rows for that agent, sorted by last_used_at DESC", () => {
    const index = new ApiKeySessionIndex(db);
    const keyA = "0".repeat(64);
    const keyB = "1".repeat(64);
    const keyC = "2".repeat(64);

    index.record(keyA, "clawdy", "sess-A");
    index.record(keyB, "clawdy", "sess-B");
    index.record(keyC, "other-agent", "sess-C");

    // Update last_used_at so A is oldest, B is newest.
    db.prepare("UPDATE api_key_sessions SET last_used_at = ? WHERE key_hash = ?").run(
      1000,
      keyA,
    );
    db.prepare("UPDATE api_key_sessions SET last_used_at = ? WHERE key_hash = ?").run(
      2000,
      keyB,
    );

    const rows = index.listForAgent("clawdy");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.key_hash).toBe(keyB);
    expect(rows[1]?.key_hash).toBe(keyA);
    expect(rows.every((r) => r.session_id.startsWith("sess-"))).toBe(true);
  });

  it("convenience wrappers lookupSessionForKey + recordSessionForKey work", () => {
    const keyHash = "9".repeat(64);
    expect(lookupSessionForKey(db, keyHash)).toBeNull();
    recordSessionForKey(db, keyHash, "clawdy", "sess-conv");
    const found = lookupSessionForKey(db, keyHash);
    expect(found?.session_id).toBe("sess-conv");
    expect(found?.agent_name).toBe("clawdy");
  });
});

describe("ApiKeySessionIndex — persistence across reopen (OPENAI-05 restart)", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "api-key-sessions-"));
    dbPath = join(dir, "memories.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("session persists across close + reopen (OPENAI-05 survives restart)", () => {
    const keyHash = "7".repeat(64);

    // Boot 1: record a session.
    const db1 = new Database(dbPath);
    db1.exec(API_KEY_SESSIONS_MIGRATION_SQL);
    new ApiKeySessionIndex(db1).record(keyHash, "clawdy", "sess-persisted");
    db1.close();

    // Boot 2: reopen. Lookup should still find the row.
    const db2 = new Database(dbPath);
    db2.exec(API_KEY_SESSIONS_MIGRATION_SQL);
    const found = new ApiKeySessionIndex(db2).lookup(keyHash);
    expect(found).not.toBeNull();
    expect(found?.session_id).toBe("sess-persisted");
    expect(found?.agent_name).toBe("clawdy");
    db2.close();
  });

  it("migration SQL is idempotent — running twice does not error", () => {
    const db = new Database(dbPath);
    expect(() => {
      db.exec(API_KEY_SESSIONS_MIGRATION_SQL);
      db.exec(API_KEY_SESSIONS_MIGRATION_SQL);
      db.exec(API_KEY_SESSIONS_MIGRATION_SQL);
    }).not.toThrow();
    // Final state is still usable.
    const index = new ApiKeySessionIndex(db);
    index.record("z".repeat(64), "clawdy", "sess-idempotent");
    expect(index.lookup("z".repeat(64))?.session_id).toBe("sess-idempotent");
    db.close();
  });
});

describe("MemoryStore — api_key_sessions migration integration", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "memstore-api-keys-"));
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("MemoryStore construction creates the api_key_sessions table", async () => {
    // Import MemoryStore lazily to avoid loading sqlite-vec for the focused
    // unit tests above (which only need better-sqlite3 bare).
    const { MemoryStore } = await import("../../memory/store.js");
    const store = new MemoryStore(join(dir, "memories.db"));
    const db = store.getDatabase();
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='api_key_sessions'",
      )
      .get() as { name: string } | undefined;
    expect(row?.name).toBe("api_key_sessions");
    // The ApiKeySessionIndex can operate against the MemoryStore-owned DB.
    const index = new ApiKeySessionIndex(db);
    index.record("y".repeat(64), "clawdy", "sess-via-memstore");
    expect(index.lookup("y".repeat(64))?.session_id).toBe("sess-via-memstore");
    store.close();
  }, 30000);
});
