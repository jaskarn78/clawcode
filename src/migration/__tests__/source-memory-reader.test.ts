import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readChunkCount,
  getMemorySqlitePath,
} from "../source-memory-reader.js";

describe("source-memory-reader", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mem-reader-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns the row count for a sqlite with a populated chunks table", () => {
    const dbPath = join(tmpDir, "populated.sqlite");
    const db = new Database(dbPath);
    try {
      db.exec(
        "CREATE TABLE chunks (id TEXT PRIMARY KEY, text TEXT); " +
          "INSERT INTO chunks VALUES ('a','one'),('b','two'),('c','three');",
      );
    } finally {
      db.close();
    }
    const result = readChunkCount(dbPath);
    expect(result.count).toBe(3);
    expect(result.missing).toBe(false);
    expect(result.tableAbsent).toBe(false);
  });

  it("returns {count:0, missing:true} when the sqlite file does not exist", () => {
    const missingPath = join(tmpDir, "no-such-agent.sqlite");
    const result = readChunkCount(missingPath);
    expect(result.count).toBe(0);
    expect(result.missing).toBe(true);
    expect(result.tableAbsent).toBe(false);
  });

  it("does NOT modify the source sqlite file's mtime (read-only open)", () => {
    const dbPath = join(tmpDir, "readonly-check.sqlite");
    const db = new Database(dbPath);
    try {
      db.exec(
        "CREATE TABLE chunks (id TEXT PRIMARY KEY); INSERT INTO chunks VALUES ('x');",
      );
    } finally {
      db.close();
    }
    const before = statSync(dbPath).mtimeMs;
    // Read-only open should not bump mtime.
    const _result = readChunkCount(dbPath);
    const after = statSync(dbPath).mtimeMs;
    expect(after).toBe(before);
  });

  it("returns {count:0, tableAbsent:true, missing:false} when sqlite has no chunks table", () => {
    const dbPath = join(tmpDir, "no-chunks-table.sqlite");
    const db = new Database(dbPath);
    try {
      db.exec(
        "CREATE TABLE documents (id TEXT PRIMARY KEY); INSERT INTO documents VALUES ('x');",
      );
    } finally {
      db.close();
    }
    const result = readChunkCount(dbPath);
    expect(result.count).toBe(0);
    expect(result.missing).toBe(false);
    expect(result.tableAbsent).toBe(true);
  });

  it("getMemorySqlitePath joins memoryDir + <agentId>.sqlite", () => {
    expect(
      getMemorySqlitePath("general", "/home/jjagpal/.openclaw/memory"),
    ).toBe("/home/jjagpal/.openclaw/memory/general.sqlite");
    expect(
      getMemorySqlitePath("fin-acquisition", "/tmp/memory"),
    ).toBe("/tmp/memory/fin-acquisition.sqlite");
  });

  it("does not throw on a non-sqlite file path with missing:false semantics (present but invalid)", () => {
    // Defensive check: if a file exists at the expected path but isn't a valid
    // sqlite, better-sqlite3 throws synchronously. We want that surfaced, not
    // swallowed — the operator needs to see the corruption error. So the test
    // asserts it DOES throw in this case (documents the contract).
    const bogusPath = join(tmpDir, "not-really-sqlite.sqlite");
    writeFileSync(bogusPath, "this is not a sqlite file");
    expect(() => readChunkCount(bogusPath)).toThrow();
  });
});
