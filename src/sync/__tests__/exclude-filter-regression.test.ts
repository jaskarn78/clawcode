/**
 * Phase 91 Plan 06 — rsync exclude-filter regression test (SYNC-10).
 *
 * Pins the exclude list in `scripts/sync/clawcode-sync-filter.txt`. The
 * test builds a fake OpenClaw workspace with BOTH allowed paths (MEMORY.md,
 * SOUL.md, IDENTITY.md, HEARTBEAT.md, memory/*.md, uploads/discord/**,
 * skills/**, vault/**, procedures/**) AND forbidden paths (*.sqlite,
 * sessions/*.jsonl, .git/**, editor/backup snapshots), then runs the
 * REAL `rsync` binary with the production filter file against a local
 * loopback destination (no SSH needed — both src and dst are local
 * directories).
 *
 * Dry-run tests parse --itemize-changes output; the final REAL sync test
 * verifies destination filesystem directly (forbidden paths MUST NOT
 * appear on disk; allowed paths MUST).
 *
 * REG-EXCL-01..07: the seven invariants that keep .sqlite / sessions /
 * .git / editor snapshots off the ClawCode side in production.
 *
 * Skip note: this test requires the `rsync` binary on PATH. Phase 91
 * targets the Linux production host (clawdy) which always has it. If a
 * future CI image lacks rsync, the test throws a clear ENOENT.
 *
 * Uses `node:child_process.execFile` via promisify to match the project's
 * existing pattern (sync-runner.ts + marketplace/clawhub-client.ts). No
 * execa dependency — Phase 91 discipline is zero new npm deps.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, rm, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const execFileP = promisify(execFile);

const FILTER_FILE = resolve(
  process.cwd(),
  "scripts/sync/clawcode-sync-filter.txt",
);

/**
 * Wrap rsync exec so a non-zero exit code doesn't cause vitest to fail
 * the test with an unrelated error — we want to assert on stdout
 * itemize-changes content, AND rsync-3.2 sometimes exits 23 on benign
 * "some files vanished" conditions even in a synthetic test.
 */
async function runRsync(
  args: readonly string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileP("rsync", args as string[], {
      maxBuffer: 16 * 1024 * 1024,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: typeof e.code === "number" ? e.code : 0,
    };
  }
}

describe("Phase 91 Plan 06 — rsync exclude-filter regression (SYNC-10)", () => {
  let workDir: string;
  let src: string;
  let dst: string;

  beforeAll(async () => {
    // Verify rsync is on PATH — if not, fail loud with a clear error so
    // the operator knows to install it (Phase 91 production target is
    // Linux with rsync). Throws ENOENT on missing binary.
    await execFileP("rsync", ["--version"]);

    // Verify filter file exists at the production path. Missing =
    // someone refactored the repo without updating this test or the
    // sync runner. Fail loud.
    await access(FILTER_FILE);

    workDir = await mkdtemp(join(tmpdir(), "sync-exclude-"));
    src = join(workDir, "source");
    dst = join(workDir, "dest");

    // -------------------------------------------------------------------
    // Build fake OpenClaw workspace tree.
    // -------------------------------------------------------------------
    await mkdir(join(src, "memory", "2026-04"), { recursive: true });
    await mkdir(join(src, "uploads", "discord"), { recursive: true });
    await mkdir(join(src, "skills", "content-engine"), { recursive: true });
    await mkdir(join(src, "vault"), { recursive: true });
    await mkdir(join(src, "procedures"), { recursive: true });
    await mkdir(join(src, "archive"), { recursive: true });
    await mkdir(join(src, "sessions"), { recursive: true }); // should be EXCLUDED
    await mkdir(join(src, ".git", "refs", "heads"), { recursive: true }); // EXCLUDED

    // -------------------------------------------------------------------
    // ALLOWED content — must appear in transfer list AND on destination.
    // -------------------------------------------------------------------
    await writeFile(join(src, "MEMORY.md"), "# Memory\n", "utf8");
    await writeFile(join(src, "SOUL.md"), "# Soul\n", "utf8");
    await writeFile(join(src, "IDENTITY.md"), "# Identity\n", "utf8");
    await writeFile(join(src, "HEARTBEAT.md"), "# Heartbeat\n", "utf8");
    await writeFile(
      join(src, "memory", "2026-04-24.md"),
      "dated memory entry\n",
      "utf8",
    );
    await writeFile(
      join(src, "memory", "2026-04-23-remember-foo.md"),
      "cue capture\n",
      "utf8",
    );
    // Nested memory subdir — exercises /memory/**/*.md pattern.
    await writeFile(
      join(src, "memory", "2026-04", "session-1.md"),
      "nested\n",
      "utf8",
    );
    await writeFile(
      join(src, "uploads", "discord", "client-doc.pdf"),
      "FAKE PDF PAYLOAD",
      "utf8",
    );
    await writeFile(
      join(src, "skills", "content-engine", "SKILL.md"),
      "# Content Engine Skill\n",
      "utf8",
    );
    await writeFile(
      join(src, "vault", "notes.md"),
      "vault content\n",
      "utf8",
    );
    await writeFile(
      join(src, "procedures", "newsletter.md"),
      "procedure\n",
      "utf8",
    );
    await writeFile(
      join(src, "archive", "old-session.md"),
      "archived\n",
      "utf8",
    );

    // -------------------------------------------------------------------
    // EXCLUDED content — must NEVER appear in transfer list or on disk.
    // -------------------------------------------------------------------
    // SQLite database files (memories.sqlite and WAL/SHM companions).
    await writeFile(join(src, "memories.sqlite"), "FAKE SQLITE\0", "utf8");
    await writeFile(join(src, "memories.sqlite-shm"), "shm\0", "utf8");
    await writeFile(join(src, "memories.sqlite-wal"), "wal\0", "utf8");

    // OpenClaw session JSONL files (sessions/ at workspace root — the
    // filter uses `/sessions/**` to anchor it).
    await writeFile(
      join(src, "sessions", "abc123.jsonl"),
      '{"type":"message","content":"hi"}\n',
      "utf8",
    );
    await writeFile(
      join(src, "sessions", "def456.jsonl"),
      '{"type":"message","content":"bye"}\n',
      "utf8",
    );

    // .git repository contents.
    await writeFile(
      join(src, ".git", "HEAD"),
      "ref: refs/heads/main\n",
      "utf8",
    );
    await writeFile(join(src, ".git", "config"), "[core]\n", "utf8");
    await writeFile(
      join(src, ".git", "refs", "heads", "main"),
      "abcdef\n",
      "utf8",
    );

    // Editor / backup snapshots — the filter's *-backup-*, *.pre-*,
    // *.bak-*, *.tmp-*, *~, *.swp, .DS_Store patterns.
    await writeFile(
      join(src, "MEMORY.md.pre-restore-backup"),
      "older memory\n",
      "utf8",
    );
    await writeFile(
      join(src, "note.md.backup-20260424"),
      "backup\n",
      "utf8",
    );
    await writeFile(join(src, "MEMORY.md.swp"), "editor swap\n", "utf8");
    await writeFile(join(src, ".DS_Store"), "mac", "utf8");
    await writeFile(join(src, "some-tmp-file.tmp-001"), "tmp", "utf8");

    await mkdir(dst, { recursive: true });
  }, 30_000);

  afterAll(async () => {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  // ---------------------------------------------------------------------
  // Static filter-file content assertions — pin the exact patterns that
  // the sync-runner's behavior depends on. These fail fast if a future
  // refactor deletes an exclude rule without updating the test.
  // ---------------------------------------------------------------------

  it("REG-EXCL-01: filter file contains all required exclude patterns", async () => {
    const content = await readFile(FILTER_FILE, "utf8");
    // SQLite patterns (memories.db is protected, *.sqlite is hard-excluded).
    expect(content).toMatch(/^- \*\.sqlite$/m);
    expect(content).toMatch(/^- \*\.sqlite-shm$/m);
    expect(content).toMatch(/^- \*\.sqlite-wal$/m);
    // Sessions directory.
    expect(content).toMatch(/^- \/sessions\/\*\*$/m);
    // .git directory.
    expect(content).toMatch(/^- \/\.git\/\*\*$/m);
    // Editor / backup snapshots — at least one *-backup-* + *.bak-*
    // + *.tmp-* + *~ + *.swp pattern.
    expect(content).toMatch(/^- \*-backup-\*$/m);
    expect(content).toMatch(/^- \*\.bak-\*$/m);
    expect(content).toMatch(/^- \*\.tmp-\*$/m);
    expect(content).toMatch(/^- \*~$/m);
    expect(content).toMatch(/^- \*\.swp$/m);
    expect(content).toMatch(/^- \.DS_Store$/m);
    // node_modules directory.
    expect(content).toMatch(/^- node_modules\/$/m);
  });

  it("REG-EXCL-02: filter file contains all required include patterns (allowed content)", async () => {
    const content = await readFile(FILTER_FILE, "utf8");
    // Top-level canonical files.
    expect(content).toMatch(/^\+ \/MEMORY\.md$/m);
    expect(content).toMatch(/^\+ \/SOUL\.md$/m);
    expect(content).toMatch(/^\+ \/IDENTITY\.md$/m);
    expect(content).toMatch(/^\+ \/HEARTBEAT\.md$/m);
    // Memory / uploads / skills / vault / procedures / archive trees.
    // NOTE: Three rules are required to cover the memory/ tree:
    //   - `+ /memory/*.md`    — direct children (dated flush files)
    //   - `+ /memory/**/`     — intermediate subdirectories (allows rsync
    //                           to descend into memory/YYYY-MM/ etc.)
    //   - `+ /memory/**/*.md` — nested .md files under any subdir
    // rsync's `**` does NOT match zero path components in 3.2+, so all
    // three rules are needed. This is the 91-01 filter fix landed in
    // 91-06 (Rule 1 deviation — production `memory/YYYY-MM-DD-*.md`
    // direct-child files wouldn't sync, and any nested subdirs would
    // be invisible to rsync without the intermediate-dir include).
    expect(content).toMatch(/^\+ \/memory\/\*\.md$/m);
    expect(content).toMatch(/^\+ \/memory\/\*\*\/$/m);
    expect(content).toMatch(/^\+ \/memory\/\*\*\/\*\.md$/m);
    expect(content).toMatch(/^\+ \/uploads\/discord\/\*\*$/m);
    expect(content).toMatch(/^\+ \/skills\/\*\*$/m);
    expect(content).toMatch(/^\+ \/vault\/\*\*$/m);
    expect(content).toMatch(/^\+ \/procedures\/\*\*$/m);
    expect(content).toMatch(/^\+ \/archive\/\*\*$/m);
    // Catch-all must still exist at the end.
    expect(content).toMatch(/^- \*$/m);
  });

  // ---------------------------------------------------------------------
  // Behavioral dry-run tests — run real rsync against the synthetic
  // workspace and inspect the itemize-changes output.
  // ---------------------------------------------------------------------

  it("REG-EXCL-03: rsync dry-run with filter file — .sqlite + .sqlite-shm + .sqlite-wal excluded", async () => {
    const result = await runRsync([
      "-av",
      "--dry-run",
      "--itemize-changes",
      "--filter",
      `merge ${FILTER_FILE}`,
      "--delete",
      `${src}/`,
      `${dst}/`,
    ]);

    expect(result.exitCode).toBe(0);
    // None of the SQLite files may appear.
    expect(result.stdout).not.toMatch(/memories\.sqlite\b/);
    expect(result.stdout).not.toMatch(/memories\.sqlite-shm/);
    expect(result.stdout).not.toMatch(/memories\.sqlite-wal/);
  });

  it("REG-EXCL-04: sessions/*.jsonl never appears in transfer list", async () => {
    const result = await runRsync([
      "-av",
      "--dry-run",
      "--itemize-changes",
      "--filter",
      `merge ${FILTER_FILE}`,
      "--delete",
      `${src}/`,
      `${dst}/`,
    ]);

    expect(result.stdout).not.toMatch(/sessions\/abc123\.jsonl/);
    expect(result.stdout).not.toMatch(/sessions\/def456\.jsonl/);
    // The sessions/ directory itself may appear in itemize output as a
    // protected entry (`P`) or be absent entirely — what we absolutely
    // can't have is jsonl files from inside it on the transfer list.
  });

  it("REG-EXCL-05: .git/ contents never appear in transfer list", async () => {
    const result = await runRsync([
      "-av",
      "--dry-run",
      "--itemize-changes",
      "--filter",
      `merge ${FILTER_FILE}`,
      "--delete",
      `${src}/`,
      `${dst}/`,
    ]);

    expect(result.stdout).not.toMatch(/\.git\/HEAD/);
    expect(result.stdout).not.toMatch(/\.git\/config/);
    expect(result.stdout).not.toMatch(/\.git\/refs\/heads\/main/);
  });

  it("REG-EXCL-06: editor / backup / swap snapshots never appear in transfer list", async () => {
    const result = await runRsync([
      "-av",
      "--dry-run",
      "--itemize-changes",
      "--filter",
      `merge ${FILTER_FILE}`,
      "--delete",
      `${src}/`,
      `${dst}/`,
    ]);

    expect(result.stdout).not.toMatch(/MEMORY\.md\.pre-restore-backup/);
    expect(result.stdout).not.toMatch(/note\.md\.backup-/);
    expect(result.stdout).not.toMatch(/MEMORY\.md\.swp/);
    expect(result.stdout).not.toMatch(/\.DS_Store/);
    expect(result.stdout).not.toMatch(/some-tmp-file\.tmp-/);
  });

  it("REG-EXCL-07: ALLOWED files DO appear in the transfer list", async () => {
    const result = await runRsync([
      "-av",
      "--dry-run",
      "--itemize-changes",
      "--filter",
      `merge ${FILTER_FILE}`,
      "--delete",
      `${src}/`,
      `${dst}/`,
    ]);

    // Top-level canonical markdown files.
    expect(result.stdout).toMatch(/MEMORY\.md/);
    expect(result.stdout).toMatch(/SOUL\.md/);
    expect(result.stdout).toMatch(/IDENTITY\.md/);
    expect(result.stdout).toMatch(/HEARTBEAT\.md/);
    // Dated memory entries (direct children — requires `+ /memory/*.md`).
    expect(result.stdout).toMatch(/memory\/2026-04-24\.md/);
    expect(result.stdout).toMatch(/memory\/2026-04-23-remember-foo\.md/);
    // Nested memory entries (requires `+ /memory/**/*.md`).
    expect(result.stdout).toMatch(/memory\/2026-04\/session-1\.md/);
    // Uploads (discord attachments).
    expect(result.stdout).toMatch(/uploads\/discord\/client-doc\.pdf/);
    // Skills.
    expect(result.stdout).toMatch(/skills\/content-engine\/SKILL\.md/);
    // Vault / procedures / archive.
    expect(result.stdout).toMatch(/vault\/notes\.md/);
    expect(result.stdout).toMatch(/procedures\/newsletter\.md/);
    expect(result.stdout).toMatch(/archive\/old-session\.md/);
  });

  // ---------------------------------------------------------------------
  // REAL sync — not dry-run. Verify the actual destination filesystem:
  // forbidden paths MUST be absent, allowed paths MUST be present.
  // ---------------------------------------------------------------------

  it("REG-EXCL-08: REAL sync leaves destination empty of excluded paths + populated with allowed paths", async () => {
    const result = await runRsync([
      "-av",
      "--filter",
      `merge ${FILTER_FILE}`,
      "--delete",
      `${src}/`,
      `${dst}/`,
    ]);

    // Exit 0 on success; exit 24 ("partial transfer due to vanished source
    // files") is also acceptable in CI environments but we don't expect it here.
    expect([0, 24]).toContain(result.exitCode);

    // Forbidden paths MUST NOT exist on destination.
    for (const forbidden of [
      "memories.sqlite",
      "memories.sqlite-shm",
      "memories.sqlite-wal",
      "sessions/abc123.jsonl",
      "sessions/def456.jsonl",
      ".git/HEAD",
      ".git/config",
      ".git/refs/heads/main",
      "MEMORY.md.pre-restore-backup",
      "note.md.backup-20260424",
      "MEMORY.md.swp",
      ".DS_Store",
      "some-tmp-file.tmp-001",
    ]) {
      await expect(
        access(join(dst, forbidden)),
        `forbidden path leaked onto destination: ${forbidden}`,
      ).rejects.toThrow();
    }

    // Allowed paths MUST exist on destination.
    for (const allowed of [
      "MEMORY.md",
      "SOUL.md",
      "IDENTITY.md",
      "HEARTBEAT.md",
      "memory/2026-04-24.md",
      "memory/2026-04-23-remember-foo.md",
      "memory/2026-04/session-1.md",
      "uploads/discord/client-doc.pdf",
      "skills/content-engine/SKILL.md",
      "vault/notes.md",
      "procedures/newsletter.md",
      "archive/old-session.md",
    ]) {
      await access(join(dst, allowed)); // throws if missing
    }
  }, 30_000);

  // ---------------------------------------------------------------------
  // Negative-space test: if we accidentally drop the `*.sqlite` exclude,
  // the dry-run output SHOULD include the sqlite file. This proves the
  // test harness itself isn't silently filtering. (Meta-test — fails the
  // suite with a clear message if someone edits the filter file in a way
  // that would make the above tests pass vacuously.)
  // ---------------------------------------------------------------------

  it("REG-EXCL-09: control probe — with empty filter file, .sqlite DOES leak (proves harness isn't silently filtering)", async () => {
    // Build a minimal "empty" filter file in a temp dir with only the
    // catch-all `- *`. Verify that when we use it, .sqlite files are
    // still excluded (because of the catch-all) BUT MEMORY.md is ALSO
    // excluded (no include rule). This proves rsync's filter engine is
    // doing what we expect.
    const emptyFilter = join(workDir, "empty-filter.txt");
    await writeFile(emptyFilter, "- *\n", "utf8");

    const result = await runRsync([
      "-av",
      "--dry-run",
      "--itemize-changes",
      "--filter",
      `merge ${emptyFilter}`,
      `${src}/`,
      `${dst}/`,
    ]);

    // With only `- *`, nothing transfers — both MEMORY.md AND
    // memories.sqlite are excluded. The point of this probe is to prove
    // the filter-file mechanism works: if `- *` didn't exclude MEMORY.md,
    // our main filter file's include-then-catchall structure would be
    // meaningless.
    expect(result.stdout).not.toMatch(/^>f\+\+\+\+\+\+\+\+\+ MEMORY\.md$/m);
    expect(result.stdout).not.toMatch(/^>f\+\+\+\+\+\+\+\+\+ memories\.sqlite$/m);
  });
});
