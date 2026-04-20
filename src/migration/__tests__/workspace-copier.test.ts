/**
 * Phase 79 Plan 01 Task 1 — workspace-copier unit tests. TDD RED first.
 *
 * Pins 15 load-bearing behaviors per 79-01-PLAN.md:
 *   1.  Happy-path text files: identical content in target, result.pass=true.
 *   2.  Filter skip — node_modules/.
 *   3.  Filter skip — .venv/ + venv/ + env/.
 *   4.  Filter skip — __pycache__/ + *.pyc + *.pyo.
 *   5.  Filter skip — .DS_Store.
 *   6.  Filter keep — .git/ (HEAD, objects, refs preserved byte-exact).
 *   7.  Filter keep — markdown + memory/ + .learnings/ + archive/.
 *   8.  Filter keep — binary blobs (byte-for-byte match).
 *   9.  Self-symlink skip — dirA/lib (real) + dirA/lib64 -> "lib" symlink; lib copied, lib64 NOT.
 *  10.  verbatimSymlinks — non-self symlink preserved (lstat isSymbolicLink).
 *  11.  mtime preservation (src mtime ≈ dst mtime within 2s).
 *  12.  hash-witness success — per-file allow rows with sha256 values.
 *  13.  hash-witness mismatch → per-agent rollback (target removed + rolled-back row).
 *  14.  readonly-source sanity — copier never writes under args.source.
 *  15.  defaultWorkspaceFilter purity (unit test on exported predicate).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtemp,
  writeFile,
  mkdir,
  symlink,
  utimes,
  readFile,
  rm,
  stat,
  lstat,
  readlink,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomBytes as cryptoRandomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { createHash } from "node:crypto";
import {
  copyAgentWorkspace,
  defaultWorkspaceFilter,
  copierFs,
  WORKSPACE_FILTER_SKIP_DIRS,
  WORKSPACE_FILTER_SKIP_FILES,
} from "../workspace-copier.js";
import { readRows } from "../ledger.js";

// Snapshot for restore.
const ORIG_FS = { ...copierFs };

describe("workspace-copier — Phase 79 Plan 01", () => {
  let tmp: string;
  let source: string;
  let target: string;
  let ledger: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "cc-p79-"));
    source = join(tmp, "source");
    target = join(tmp, "target");
    ledger = join(tmp, "planning", "migration", "ledger.jsonl");
    await mkdir(source, { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    copierFs.readFile = ORIG_FS.readFile;
    copierFs.rm = ORIG_FS.rm;
    await rm(tmp, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------
  // Test 1 — happy-path text files
  // -------------------------------------------------------------------
  it("Test 1: copies text files verbatim into the target tree", async () => {
    await mkdir(join(source, "a"), { recursive: true });
    await writeFile(join(source, "a", "b.md"), "hello");
    await writeFile(join(source, "c.txt"), "world");

    const result = await copyAgentWorkspace({
      agentId: "test",
      source,
      target,
      ledgerPath: ledger,
      sourceHash: "deadbeef",
    });

    expect(result.pass).toBe(true);
    expect(result.rolledBack).toBe(false);
    expect(result.hashMismatches).toEqual([]);
    expect(result.filesCopied).toBeGreaterThanOrEqual(2);
    expect(await readFile(join(target, "a", "b.md"), "utf8")).toBe("hello");
    expect(await readFile(join(target, "c.txt"), "utf8")).toBe("world");
  });

  // -------------------------------------------------------------------
  // Test 2 — filter skip: node_modules/
  // -------------------------------------------------------------------
  it("Test 2: skips node_modules, keeps README.md", async () => {
    await mkdir(join(source, "node_modules", "foo"), { recursive: true });
    await writeFile(join(source, "node_modules", "foo", "bar.js"), "skip-me");
    await writeFile(join(source, "README.md"), "keep-me");

    const result = await copyAgentWorkspace({
      agentId: "test",
      source,
      target,
      ledgerPath: ledger,
      sourceHash: "deadbeef",
    });

    expect(result.pass).toBe(true);
    expect(existsSync(join(target, "node_modules"))).toBe(false);
    expect(await readFile(join(target, "README.md"), "utf8")).toBe("keep-me");
  });

  // -------------------------------------------------------------------
  // Test 3 — filter skip: .venv/ + venv/ + env/
  // -------------------------------------------------------------------
  it("Test 3: skips .venv/ + venv/ + env/, keeps KEEP.md", async () => {
    await mkdir(join(source, ".venv", "bin"), { recursive: true });
    await writeFile(join(source, ".venv", "bin", "python"), "#!venv");
    await mkdir(join(source, "venv"), { recursive: true });
    await writeFile(join(source, "venv", "pyvenv.cfg"), "cfg=1");
    await mkdir(join(source, "env"), { recursive: true });
    await writeFile(join(source, "env", "pyvenv.cfg"), "cfg=2");
    await writeFile(join(source, "KEEP.md"), "keeper");

    const result = await copyAgentWorkspace({
      agentId: "test",
      source,
      target,
      ledgerPath: ledger,
      sourceHash: "deadbeef",
    });

    expect(result.pass).toBe(true);
    expect(existsSync(join(target, ".venv"))).toBe(false);
    expect(existsSync(join(target, "venv"))).toBe(false);
    expect(existsSync(join(target, "env"))).toBe(false);
    expect(await readFile(join(target, "KEEP.md"), "utf8")).toBe("keeper");
  });

  // -------------------------------------------------------------------
  // Test 4 — filter skip: __pycache__ + *.pyc + *.pyo
  // -------------------------------------------------------------------
  it("Test 4: skips __pycache__ + *.pyc + *.pyo, keeps keeper.py", async () => {
    await writeFile(join(source, "foo.pyc"), "pyc");
    await writeFile(join(source, "bar.pyo"), "pyo");
    await mkdir(join(source, "__pycache__"), { recursive: true });
    await writeFile(
      join(source, "__pycache__", "cached.cpython-312.pyc"),
      "cached",
    );
    await writeFile(join(source, "keeper.py"), "print('ok')");

    const result = await copyAgentWorkspace({
      agentId: "test",
      source,
      target,
      ledgerPath: ledger,
      sourceHash: "deadbeef",
    });

    expect(result.pass).toBe(true);
    expect(existsSync(join(target, "foo.pyc"))).toBe(false);
    expect(existsSync(join(target, "bar.pyo"))).toBe(false);
    expect(existsSync(join(target, "__pycache__"))).toBe(false);
    expect(await readFile(join(target, "keeper.py"), "utf8")).toBe("print('ok')");
  });

  // -------------------------------------------------------------------
  // Test 5 — filter skip: .DS_Store
  // -------------------------------------------------------------------
  it("Test 5: skips .DS_Store, keeps real.md", async () => {
    await writeFile(join(source, ".DS_Store"), "mac-junk");
    await writeFile(join(source, "real.md"), "real-content");

    const result = await copyAgentWorkspace({
      agentId: "test",
      source,
      target,
      ledgerPath: ledger,
      sourceHash: "deadbeef",
    });

    expect(result.pass).toBe(true);
    expect(existsSync(join(target, ".DS_Store"))).toBe(false);
    expect(await readFile(join(target, "real.md"), "utf8")).toBe("real-content");
  });

  // -------------------------------------------------------------------
  // Test 6 — filter keep: .git/ (WORK-03)
  // -------------------------------------------------------------------
  it("Test 6: preserves .git/HEAD + .git/objects + .git/refs byte-exact", async () => {
    await mkdir(join(source, ".git", "objects", "00"), { recursive: true });
    await mkdir(join(source, ".git", "refs", "heads"), { recursive: true });
    await writeFile(join(source, ".git", "HEAD"), "ref: refs/heads/main\n");
    await writeFile(
      join(source, ".git", "objects", "00", "abc"),
      "object-body",
    );
    await writeFile(
      join(source, ".git", "refs", "heads", "main"),
      "abcdef1234\n",
    );
    await writeFile(join(source, "real.md"), "keep");

    const result = await copyAgentWorkspace({
      agentId: "test",
      source,
      target,
      ledgerPath: ledger,
      sourceHash: "deadbeef",
    });

    expect(result.pass).toBe(true);
    expect(await readFile(join(target, ".git", "HEAD"), "utf8")).toBe(
      "ref: refs/heads/main\n",
    );
    expect(
      await readFile(join(target, ".git", "objects", "00", "abc"), "utf8"),
    ).toBe("object-body");
    expect(
      await readFile(join(target, ".git", "refs", "heads", "main"), "utf8"),
    ).toBe("abcdef1234\n");
  });

  // -------------------------------------------------------------------
  // Test 7 — filter keep: markdown + memory/ + .learnings/ + archive/
  // -------------------------------------------------------------------
  it("Test 7: keeps SOUL/IDENTITY markdown + memory/ + .learnings/ + archive/", async () => {
    await writeFile(join(source, "SOUL.md"), "soul");
    await writeFile(join(source, "IDENTITY.md"), "identity");
    await mkdir(join(source, "memory"), { recursive: true });
    await writeFile(join(source, "memory", "entity-foo.md"), "entity");
    await mkdir(join(source, ".learnings"), { recursive: true });
    await writeFile(join(source, ".learnings", "lesson.md"), "lesson");
    await mkdir(join(source, "archive"), { recursive: true });
    await writeFile(join(source, "archive", "old.md"), "old");

    const result = await copyAgentWorkspace({
      agentId: "test",
      source,
      target,
      ledgerPath: ledger,
      sourceHash: "deadbeef",
    });

    expect(result.pass).toBe(true);
    expect(await readFile(join(target, "SOUL.md"), "utf8")).toBe("soul");
    expect(await readFile(join(target, "IDENTITY.md"), "utf8")).toBe("identity");
    expect(await readFile(join(target, "memory", "entity-foo.md"), "utf8")).toBe(
      "entity",
    );
    expect(await readFile(join(target, ".learnings", "lesson.md"), "utf8")).toBe(
      "lesson",
    );
    expect(await readFile(join(target, "archive", "old.md"), "utf8")).toBe("old");
  });

  // -------------------------------------------------------------------
  // Test 8 — filter keep: binary blobs byte-exact
  // -------------------------------------------------------------------
  it("Test 8: binary blobs copied byte-for-byte (WORK-05)", async () => {
    const pngBytes = cryptoRandomBytes(10 * 1024);
    const pdfBytes = cryptoRandomBytes(50 * 1024);
    await writeFile(join(source, "image.png"), pngBytes);
    await writeFile(join(source, "document.pdf"), pdfBytes);

    const result = await copyAgentWorkspace({
      agentId: "test",
      source,
      target,
      ledgerPath: ledger,
      sourceHash: "deadbeef",
    });

    expect(result.pass).toBe(true);
    const copiedPng = await readFile(join(target, "image.png"));
    const copiedPdf = await readFile(join(target, "document.pdf"));
    expect(Buffer.compare(copiedPng, pngBytes)).toBe(0);
    expect(Buffer.compare(copiedPdf, pdfBytes)).toBe(0);
  });

  // -------------------------------------------------------------------
  // Test 9 — self-symlink skip
  // -------------------------------------------------------------------
  it("Test 9: self-symlink lib64 -> lib is SKIPPED; real lib/ is copied", async () => {
    // Non-venv parent to exercise the self-symlink filter (not the venv filter).
    await mkdir(join(source, "dirA", "lib"), { recursive: true });
    await writeFile(join(source, "dirA", "lib", "file-a"), "real");
    // lib64 -> ./lib (self-referential within dirA/)
    await symlink("lib", join(source, "dirA", "lib64"));

    const result = await copyAgentWorkspace({
      agentId: "test",
      source,
      target,
      ledgerPath: ledger,
      sourceHash: "deadbeef",
    });

    expect(result.pass).toBe(true);
    expect(await readFile(join(target, "dirA", "lib", "file-a"), "utf8")).toBe(
      "real",
    );
    expect(existsSync(join(target, "dirA", "lib64"))).toBe(false);
  });

  // -------------------------------------------------------------------
  // Test 10 — verbatimSymlinks: non-self symlink preserved
  // -------------------------------------------------------------------
  it("Test 10: non-self symlink preserved with verbatimSymlinks", async () => {
    await writeFile(join(source, "real.md"), "real");
    // Non-self-referential symlink (peer file in same dir).
    await symlink("real.md", join(source, "link.md"));

    const result = await copyAgentWorkspace({
      agentId: "test",
      source,
      target,
      ledgerPath: ledger,
      sourceHash: "deadbeef",
    });

    expect(result.pass).toBe(true);
    const linkStat = await lstat(join(target, "link.md"));
    expect(linkStat.isSymbolicLink()).toBe(true);
    const linkTarget = await readlink(join(target, "link.md"));
    expect(linkTarget).toBe("real.md");
  });

  // -------------------------------------------------------------------
  // Test 11 — mtime preservation (WORK-05)
  // -------------------------------------------------------------------
  it("Test 11: preserves mtime within 2s (fs timestamp resolution)", async () => {
    await writeFile(join(source, "file.md"), "timestamped");
    const fixedMtime = new Date("2020-01-01T00:00:00Z");
    await utimes(join(source, "file.md"), fixedMtime, fixedMtime);

    const result = await copyAgentWorkspace({
      agentId: "test",
      source,
      target,
      ledgerPath: ledger,
      sourceHash: "deadbeef",
    });

    expect(result.pass).toBe(true);
    const srcStat = await stat(join(source, "file.md"));
    const dstStat = await stat(join(target, "file.md"));
    expect(Math.abs(srcStat.mtime.getTime() - dstStat.mtime.getTime())).toBeLessThan(
      2000,
    );
  });

  // -------------------------------------------------------------------
  // Test 12 — hash-witness success: per-file allow rows with sha256
  // -------------------------------------------------------------------
  it("Test 12: appends per-file hash-witness allow rows with sha256 values", async () => {
    await writeFile(join(source, "a.md"), "one");
    await writeFile(join(source, "b.md"), "two");
    await writeFile(join(source, "c.md"), "three");

    const result = await copyAgentWorkspace({
      agentId: "test",
      source,
      target,
      ledgerPath: ledger,
      sourceHash: "deadbeef",
    });

    expect(result.pass).toBe(true);
    const rows = await readRows(ledger);
    const witnessAllow = rows.filter(
      (r) =>
        r.step === "workspace-copy:hash-witness" && r.outcome === "allow",
    );
    expect(witnessAllow.length).toBeGreaterThanOrEqual(3);

    // Each witness row carries a file_hashes record with exactly one entry.
    const shaOne = createHash("sha256").update("one").digest("hex");
    const shaTwo = createHash("sha256").update("two").digest("hex");
    const shaThree = createHash("sha256").update("three").digest("hex");

    const flat = new Map<string, string>();
    for (const r of witnessAllow) {
      if (r.file_hashes) {
        for (const [k, v] of Object.entries(r.file_hashes)) flat.set(k, v);
      }
    }
    expect(flat.get("a.md")).toBe(shaOne);
    expect(flat.get("b.md")).toBe(shaTwo);
    expect(flat.get("c.md")).toBe(shaThree);
  });

  // -------------------------------------------------------------------
  // Test 13 — hash-witness mismatch triggers rollback (per-agent)
  // -------------------------------------------------------------------
  it("Test 13: sha256 mismatch on target triggers rollback + removes target", async () => {
    await writeFile(join(source, "a.md"), "original");
    await writeFile(join(source, "b.md"), "other");

    // Intercept the copier's readFile holder — for the dst side of a.md,
    // return corrupted bytes so the sweep detects sha256 mismatch.
    const orig = copierFs.readFile;
    const targetAMd = join(target, "a.md");
    copierFs.readFile = (async (p: unknown, opts?: unknown) => {
      if (typeof p === "string" && p === targetAMd) {
        return Buffer.from("CORRUPTED");
      }
      return orig(
        p as Parameters<typeof orig>[0],
        opts as Parameters<typeof orig>[1],
      );
    }) as typeof copierFs.readFile;

    const result = await copyAgentWorkspace({
      agentId: "test",
      source,
      target,
      ledgerPath: ledger,
      sourceHash: "deadbeef",
    });

    expect(result.pass).toBe(false);
    expect(result.rolledBack).toBe(true);
    expect(result.hashMismatches).toContain("a.md");
    expect(existsSync(target)).toBe(false);

    const rows = await readRows(ledger);
    expect(
      rows.some(
        (r) =>
          r.step === "workspace-copy:hash-witness" && r.outcome === "refuse",
      ),
    ).toBe(true);
    expect(
      rows.some(
        (r) =>
          r.step === "workspace-copy:rollback" && r.status === "rolled-back",
      ),
    ).toBe(true);
  });

  // -------------------------------------------------------------------
  // Test 14 — readonly-source sanity: copier never writes under args.source
  // -------------------------------------------------------------------
  it("Test 14: copier never writes under args.source (readonly-source)", async () => {
    await writeFile(join(source, "a.md"), "one");
    await writeFile(join(source, "b.md"), "two");

    // Proxy copierFs.rm to record any call-site path.
    const rmCalls: string[] = [];
    const origRm = copierFs.rm;
    copierFs.rm = (async (p: unknown, opts?: unknown) => {
      rmCalls.push(String(p));
      return origRm(
        p as Parameters<typeof origRm>[0],
        opts as Parameters<typeof origRm>[1],
      );
    }) as typeof copierFs.rm;

    const result = await copyAgentWorkspace({
      agentId: "test",
      source,
      target,
      ledgerPath: ledger,
      sourceHash: "deadbeef",
    });
    expect(result.pass).toBe(true);

    // Absolutely no rm call should target a path under args.source.
    for (const p of rmCalls) {
      expect(p.startsWith(source + sep) || p === source).toBe(false);
    }
    // Source tree remains intact.
    expect(await readFile(join(source, "a.md"), "utf8")).toBe("one");
    expect(await readFile(join(source, "b.md"), "utf8")).toBe("two");
  });

  // -------------------------------------------------------------------
  // Test 15 — defaultWorkspaceFilter purity
  // -------------------------------------------------------------------
  it("Test 15: defaultWorkspaceFilter — deterministic skip/keep decisions", () => {
    // Skip
    expect(defaultWorkspaceFilter("/x/node_modules/y")).toBe(false);
    expect(defaultWorkspaceFilter("/x/.venv/y")).toBe(false);
    expect(defaultWorkspaceFilter("/x/venv/y")).toBe(false);
    expect(defaultWorkspaceFilter("/x/env/y")).toBe(false);
    expect(defaultWorkspaceFilter("/x/__pycache__/y")).toBe(false);
    expect(defaultWorkspaceFilter("/x/y.pyc")).toBe(false);
    expect(defaultWorkspaceFilter("/x/y.pyo")).toBe(false);
    expect(defaultWorkspaceFilter("/x/.DS_Store")).toBe(false);
    // Keep
    expect(defaultWorkspaceFilter("/x/.git/HEAD")).toBe(true);
    expect(defaultWorkspaceFilter("/x/SOUL.md")).toBe(true);
    expect(defaultWorkspaceFilter("/x/memory/foo.md")).toBe(true);
    expect(defaultWorkspaceFilter("/x/.learnings/l.md")).toBe(true);
    expect(defaultWorkspaceFilter("/x/archive/o.jsonl")).toBe(true);

    // Exported constants sanity.
    expect(WORKSPACE_FILTER_SKIP_DIRS).toContain("node_modules");
    expect(WORKSPACE_FILTER_SKIP_DIRS).toContain(".venv");
    expect(WORKSPACE_FILTER_SKIP_FILES).toContain(".DS_Store");
  });
});
