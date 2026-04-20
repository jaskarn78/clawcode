/**
 * Phase 80 Plan 02 — memory-translator unit suite.
 *
 * Task 1: pure helpers (splitMemoryMd / slugifyHeading / computeOriginId /
 * tag builders) + fixture sanity.
 * Task 2: discoverWorkspaceMarkdown + translateAgentMemories end-to-end
 * against the synthetic fixture workspace, plus the five MEM-XX invariants.
 *
 * All tests are file-scoped to `src/migration/memory-translator.ts` — no
 * integration coupling to runApplyAction (Plan 03's job).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, mkdtempSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, cpSync } from "node:fs";
import {
  splitMemoryMd,
  slugifyHeading,
  computeOriginId,
  buildTagsForMemoryMd,
  buildTagsForMemoryFile,
  buildTagsForLearning,
  sha256Hex,
  discoverWorkspaceMarkdown,
  translateAgentMemories,
  IMPORTANCE_MEMORY_FILE,
  IMPORTANCE_LEARNING,
} from "../memory-translator.js";
import { MemoryStore } from "../../memory/store.js";
import { ledgerRowSchema, type LedgerRow } from "../ledger.js";
import type { MemoryEntry } from "../../memory/types.js";

const FIXTURE_ROOT = join(
  __dirname,
  "fixtures",
  "workspace-memory-personal",
);

describe("memory-translator pure helpers (Phase 80 Plan 02 Task 1)", () => {
  describe("splitMemoryMd", () => {
    it("Test 1: no H2 → single whole-file section with heading=null", () => {
      const input = "just some text\nno headings here";
      const sections = splitMemoryMd(input);
      expect(sections).toHaveLength(1);
      expect(sections[0]).toEqual({ heading: null, content: input });
    });

    it("Test 2: H2 sections preserve heading and body verbatim", () => {
      const input =
        "## First\nfirst body\n## Second\nsecond body\n## Third\nthird body";
      const sections = splitMemoryMd(input);
      expect(sections).toHaveLength(3);
      expect(sections[0]?.heading).toBe("First");
      expect(sections[0]?.content).toBe("## First\nfirst body");
      expect(sections[1]?.heading).toBe("Second");
      expect(sections[1]?.content).toBe("## Second\nsecond body");
      expect(sections[2]?.heading).toBe("Third");
      expect(sections[2]?.content).toBe("## Third\nthird body");
    });

    it("Test 3: non-blank preamble before first H2 is preserved as heading=null section", () => {
      const input = "preamble line\n\n## First\nbody";
      const sections = splitMemoryMd(input);
      expect(sections).toHaveLength(2);
      expect(sections[0]?.heading).toBeNull();
      // Preamble is lines [0, H2-start) rejoined with "\n". For the input
      // above that's ["preamble line", ""] → "preamble line\n". The "\n"
      // that used to sit immediately before "## First" is the separator
      // consumed by split("\n") and is accounted for by the H2 section
      // starting at its own line. Zero content loss in the verbatim
      // concat (preamble + "\n" + h2-section === original).
      expect(sections[0]?.content).toBe("preamble line\n");
      expect(sections[1]?.heading).toBe("First");
      expect(sections[1]?.content).toBe("## First\nbody");
      // Verbatim invariant: preamble + "\n" + h2 === original input.
      expect(sections[0]!.content + "\n" + sections[1]!.content).toBe(input);
    });

    it("Test 4: whitespace-only preamble is dropped", () => {
      const input = "\n\n## First\nbody";
      const sections = splitMemoryMd(input);
      expect(sections).toHaveLength(1);
      expect(sections[0]?.heading).toBe("First");
    });

    it("Test 5: H3 is NOT treated as a section boundary", () => {
      const input = "## Top\nbody\n### Sub\nmore body";
      const sections = splitMemoryMd(input);
      expect(sections).toHaveLength(1);
      expect(sections[0]?.heading).toBe("Top");
      expect(sections[0]?.content).toBe("## Top\nbody\n### Sub\nmore body");
    });
  });

  describe("slugifyHeading", () => {
    it("lowercases and hyphenates simple headings", () => {
      expect(slugifyHeading("My Favorite Topic!")).toBe("my-favorite-topic");
    });

    it("collapses whitespace runs and trims leading/trailing hyphens", () => {
      expect(slugifyHeading("  Double   Spaces  ")).toBe("double-spaces");
    });

    it("collapses non-alphanumeric runs", () => {
      expect(slugifyHeading("Special/Chars&Things")).toBe(
        "special-chars-things",
      );
    });
  });

  describe("computeOriginId", () => {
    it("whole-file format: openclaw:<agent>:<sha256(relpath)>", () => {
      // Pinned value computed via:
      //   node -e "crypto.createHash('sha256').update('memory/entity-foo.md').digest('hex')"
      const PINNED_SHA =
        "8b08269640059ccbc87dcd37bf449e672c7a1acf0097f872994bc76dac6bb350";
      const id = computeOriginId("personal", "memory/entity-foo.md");
      expect(id).toBe(`openclaw:personal:${PINNED_SHA}`);
    });

    it("section-level format appends :section:<slug>", () => {
      const PINNED_SHA =
        "fe1ee8635685c90cf3509fed552ef721bbd322aeee1655114d4ab10c7a429973";
      const id = computeOriginId("personal", "MEMORY.md", "Discord Setup");
      expect(id).toBe(`openclaw:personal:${PINNED_SHA}:section:discord-setup`);
    });

    it("normalizes backslash paths to forward slashes before hashing", () => {
      // Cross-platform invariant — a windows-style path must hash identically
      // to its forward-slash equivalent so origin_ids are stable across OSes.
      const forward = computeOriginId("personal", "memory/entity-foo.md");
      const back = computeOriginId("personal", "memory\\entity-foo.md");
      expect(forward).toBe(back);
    });
  });

  describe("tag builders", () => {
    it("buildTagsForMemoryMd with slug returns 4 tags", () => {
      expect(buildTagsForMemoryMd("discord-setup")).toEqual([
        "migrated",
        "openclaw-import",
        "workspace-memory",
        "discord-setup",
      ]);
    });

    it("buildTagsForMemoryMd with null returns 3 tags (no slug)", () => {
      expect(buildTagsForMemoryMd(null)).toEqual([
        "migrated",
        "openclaw-import",
        "workspace-memory",
      ]);
    });

    it("buildTagsForMemoryFile appends memory-file + stem", () => {
      expect(buildTagsForMemoryFile("entity-foo")).toEqual([
        "migrated",
        "openclaw-import",
        "memory-file",
        "entity-foo",
      ]);
    });

    it("buildTagsForLearning appends learning + basename", () => {
      expect(buildTagsForLearning("lesson-discord")).toEqual([
        "migrated",
        "openclaw-import",
        "learning",
        "lesson-discord",
      ]);
    });
  });

  describe("sha256Hex", () => {
    it("returns a 64-char hex string", () => {
      const hex = sha256Hex("anything");
      expect(hex).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("fixture workspace", () => {
    it("all 5 fixture files exist and are non-empty", async () => {
      const paths = [
        "MEMORY.md",
        "memory/entity-foo.md",
        "memory/note-bar.md",
        ".learnings/lesson-discord.md",
        ".learnings/pattern-immutability.md",
      ];
      for (const p of paths) {
        const abs = join(FIXTURE_ROOT, p);
        expect(existsSync(abs)).toBe(true);
        const content = await readFile(abs, "utf8");
        expect(content.length).toBeGreaterThan(0);
      }
    });

    it("MEMORY.md contains exactly 3 H2 sections", () => {
      const content = readFileSync(join(FIXTURE_ROOT, "MEMORY.md"), "utf8");
      const h2s = content.split("\n").filter(
        (line) => line.startsWith("## ") && !line.startsWith("### "),
      );
      expect(h2s).toHaveLength(3);
    });

    it("MEMORY.md preamble (before first H2) is whitespace-only so discoverWorkspaceMarkdown returns exactly 3 sections", () => {
      const content = readFileSync(join(FIXTURE_ROOT, "MEMORY.md"), "utf8");
      const firstH2 = content.indexOf("## ");
      const preamble = content.slice(0, firstH2);
      expect(preamble.trim()).toBe("");
    });
  });
});

// ---------------------------------------------------------------------------
// Task 2 — discoverWorkspaceMarkdown + translateAgentMemories end-to-end.
//
// Tests drive against:
//   1. The static fixture under FIXTURE_ROOT (read-only)
//   2. A freshly-copied temp workspace (when the tests need to mutate, e.g.
//      removing MEMORY.md to exercise "missing subdirs" branch)
//   3. A fresh in-memory-like MemoryStore at a mkdtemp path for each test —
//      ensures idempotency tests get a clean slate
// ---------------------------------------------------------------------------

/**
 * Create a fresh tmp MemoryStore. Each invocation returns an isolated DB
 * so upserted/skipped classification tests don't bleed across cases.
 */
function makeTmpStore(): { store: MemoryStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "memtranslator-"));
  const store = new MemoryStore(join(dir, "memories.db"));
  return { store, dir };
}

/**
 * Copy FIXTURE_ROOT to a fresh tmp workspace so tests that need to mutate
 * (remove MEMORY.md, etc.) can do so without poisoning the read-only
 * fixture. Mirrors workspace-copier.ts's post-Phase-79 on-disk layout.
 */
function copyFixtureToTmp(): string {
  const dest = mkdtempSync(join(tmpdir(), "fixture-ws-"));
  cpSync(FIXTURE_ROOT, dest, { recursive: true });
  return dest;
}

/**
 * Deterministic serial-embed mock.
 *   - Returns a Float32Array(384) with a content-hashed filling so
 *     different inputs yield different vectors.
 *   - Tracks peakInFlight so the test can assert max 1 concurrent call
 *     (serial invariant from 80-CONTEXT — embedder singleton is
 *     non-reentrant).
 *   - Records call count for the 7-call assertion against the fixture.
 */
function makeMockEmbedder(): {
  embedder: {
    warmup: () => Promise<void>;
    embed: (text: string) => Promise<Float32Array>;
    isReady: () => boolean;
  };
  getCallCount: () => number;
  getPeakInFlight: () => number;
  getCallOrder: () => readonly string[];
} {
  let inFlight = 0;
  let peakInFlight = 0;
  let callCount = 0;
  const callOrder: string[] = [];
  const embedder = {
    async warmup(): Promise<void> {
      /* no-op */
    },
    async embed(text: string): Promise<Float32Array> {
      inFlight++;
      peakInFlight = Math.max(peakInFlight, inFlight);
      callCount++;
      // Grab a short content signature for call-order assertions.
      callOrder.push(text.slice(0, 40));
      const vec = new Float32Array(384);
      let seed = 0;
      for (let i = 0; i < text.length; i++) {
        seed = (seed * 31 + text.charCodeAt(i)) | 0;
      }
      for (let i = 0; i < 384; i++) {
        vec[i] = Math.sin(seed + i) * 0.5;
      }
      // Yield the event loop so "serial" really is observable — if the
      // translator parallelized with Promise.all, peakInFlight would
      // climb above 1 right here.
      await new Promise((r) => setImmediate(r));
      inFlight--;
      return vec;
    },
    isReady(): boolean {
      return true;
    },
  };
  return {
    embedder,
    getCallCount: () => callCount,
    getPeakInFlight: () => peakInFlight,
    getCallOrder: () => [...callOrder],
  };
}

describe("memory-translator discoverWorkspaceMarkdown (Phase 80 Plan 02 Task 2)", () => {
  it("returns exactly 7 discovered memories for the full fixture workspace", async () => {
    const out = await discoverWorkspaceMarkdown(FIXTURE_ROOT, "personal");
    expect(out).toHaveLength(7);
  });

  it("ordering is stable: MEMORY.md sections first, then memory/ alpha, then .learnings/ alpha", async () => {
    const out = await discoverWorkspaceMarkdown(FIXTURE_ROOT, "personal");
    // 3 MEMORY.md sections
    expect(out[0]?.kind).toBe("memory-md-section");
    expect(out[0]?.relpath).toBe("MEMORY.md");
    expect(out[1]?.kind).toBe("memory-md-section");
    expect(out[2]?.kind).toBe("memory-md-section");
    // 2 memory/*.md (alphabetical)
    expect(out[3]?.kind).toBe("memory-file");
    expect(out[3]?.relpath).toBe("memory/entity-foo.md");
    expect(out[4]?.kind).toBe("memory-file");
    expect(out[4]?.relpath).toBe("memory/note-bar.md");
    // 2 .learnings/*.md (alphabetical)
    expect(out[5]?.kind).toBe("learning");
    expect(out[5]?.relpath).toBe(".learnings/lesson-discord.md");
    expect(out[6]?.kind).toBe("learning");
    expect(out[6]?.relpath).toBe(".learnings/pattern-immutability.md");
  });

  it("importance assignments: first MEMORY.md=0.6, others 0.5, memory=0.5, learning=0.7", async () => {
    const out = await discoverWorkspaceMarkdown(FIXTURE_ROOT, "personal");
    expect(out[0]?.importance).toBe(0.6);
    expect(out[1]?.importance).toBe(0.5);
    expect(out[2]?.importance).toBe(0.5);
    expect(out[3]?.importance).toBe(IMPORTANCE_MEMORY_FILE);
    expect(out[4]?.importance).toBe(IMPORTANCE_MEMORY_FILE);
    expect(out[5]?.importance).toBe(IMPORTANCE_LEARNING);
    expect(out[6]?.importance).toBe(IMPORTANCE_LEARNING);
  });

  it("tags match 80-CONTEXT scheme exactly", async () => {
    const out = await discoverWorkspaceMarkdown(FIXTURE_ROOT, "personal");
    // MEMORY.md sections
    expect(out[0]?.tags).toEqual([
      "migrated",
      "openclaw-import",
      "workspace-memory",
      "discord-setup",
    ]);
    expect(out[1]?.tags).toEqual([
      "migrated",
      "openclaw-import",
      "workspace-memory",
      "project-clawcode",
    ]);
    expect(out[2]?.tags).toEqual([
      "migrated",
      "openclaw-import",
      "workspace-memory",
      "server-topology",
    ]);
    // memory/*.md
    expect(out[3]?.tags).toEqual([
      "migrated",
      "openclaw-import",
      "memory-file",
      "entity-foo",
    ]);
    // .learnings/*.md — literal "learning" tag satisfies MEM-04.
    expect(out[5]?.tags).toEqual([
      "migrated",
      "openclaw-import",
      "learning",
      "lesson-discord",
    ]);
  });

  it("origin_ids: MEMORY.md sections carry :section:<slug>; others are whole-file; all unique", async () => {
    const out = await discoverWorkspaceMarkdown(FIXTURE_ROOT, "personal");
    // MEMORY.md sections have :section: suffix
    expect(out[0]?.originId).toMatch(/^openclaw:personal:[0-9a-f]{64}:section:discord-setup$/);
    expect(out[1]?.originId).toMatch(/^openclaw:personal:[0-9a-f]{64}:section:project-clawcode$/);
    expect(out[2]?.originId).toMatch(/^openclaw:personal:[0-9a-f]{64}:section:server-topology$/);
    // memory/ and .learnings/ are whole-file (no :section: suffix)
    expect(out[3]?.originId).toMatch(/^openclaw:personal:[0-9a-f]{64}$/);
    expect(out[5]?.originId).toMatch(/^openclaw:personal:[0-9a-f]{64}$/);
    // All 7 are unique
    const ids = new Set(out.map((d) => d.originId));
    expect(ids.size).toBe(7);
  });

  it("missing MEMORY.md: returns only memory/ + .learnings/ entries", async () => {
    const tmp = copyFixtureToTmp();
    require("node:fs").rmSync(join(tmp, "MEMORY.md"));
    const out = await discoverWorkspaceMarkdown(tmp, "personal");
    expect(out).toHaveLength(4); // 2 memory + 2 learnings
    expect(out.every((d) => d.kind !== "memory-md-section")).toBe(true);
  });

  it("missing memory/: returns only MEMORY.md sections + .learnings/", async () => {
    const tmp = copyFixtureToTmp();
    require("node:fs").rmSync(join(tmp, "memory"), {
      recursive: true,
      force: true,
    });
    const out = await discoverWorkspaceMarkdown(tmp, "personal");
    expect(out).toHaveLength(5); // 3 MEMORY.md + 2 learnings
    expect(out.every((d) => d.kind !== "memory-file")).toBe(true);
  });

  it("missing .learnings/: returns only MEMORY.md sections + memory/", async () => {
    const tmp = copyFixtureToTmp();
    require("node:fs").rmSync(join(tmp, ".learnings"), {
      recursive: true,
      force: true,
    });
    const out = await discoverWorkspaceMarkdown(tmp, "personal");
    expect(out).toHaveLength(5); // 3 MEMORY.md + 2 memory
    expect(out.every((d) => d.kind !== "learning")).toBe(true);
  });

  it("MEM-01: content is byte-verbatim against each source file", async () => {
    const out = await discoverWorkspaceMarkdown(FIXTURE_ROOT, "personal");
    // Whole-file entries match readFile exactly.
    const entityFoo = readFileSync(
      join(FIXTURE_ROOT, "memory/entity-foo.md"),
      "utf8",
    );
    expect(out[3]?.content).toBe(entityFoo);
    const learning = readFileSync(
      join(FIXTURE_ROOT, ".learnings/lesson-discord.md"),
      "utf8",
    );
    expect(out[5]?.content).toBe(learning);
    // H2 sections: concat(section[0] + "\n" + section[1] + "\n" + section[2]) = MEMORY.md
    // minus the whitespace preamble (which is whitespace-only by fixture design).
    const memoryMd = readFileSync(join(FIXTURE_ROOT, "MEMORY.md"), "utf8");
    const stitched = out
      .filter((d) => d.kind === "memory-md-section")
      .map((d) => d.content)
      .join("\n");
    // The preamble newlines are the only delta — strip them to check the
    // body is verbatim in aggregate.
    const firstH2 = memoryMd.indexOf("## ");
    expect(stitched).toBe(memoryMd.slice(firstH2).replace(/\n+$/, ""));
  });
});

describe("memory-translator translateAgentMemories (Phase 80 Plan 02 Task 2)", () => {
  it("first run — all 7 upserted, zero skipped, 7 ledger rows (step=memory-translate:embed-insert)", async () => {
    const { store } = makeTmpStore();
    const mock = makeMockEmbedder();
    const result = await translateAgentMemories({
      agentId: "personal",
      targetWorkspace: FIXTURE_ROOT,
      memoryPath: "/tmp/unused-in-this-test",
      store,
      embedder: mock.embedder,
      sourceHash: "plan-hash-abc123",
    });
    expect(result.upserted).toBe(7);
    expect(result.skipped).toBe(0);
    expect(result.ledgerRows).toHaveLength(7);
    for (const row of result.ledgerRows) {
      expect(row.step).toBe("memory-translate:embed-insert");
      expect(row.outcome).toBe("allow");
      expect(row.notes).toBe("new");
      expect(row.action).toBe("apply");
      expect(row.agent).toBe("personal");
      expect(row.status).toBe("pending");
      expect(row.source_hash).toBe("plan-hash-abc123");
    }
    store.close();
  });

  it("MEM-02: re-run against same store returns upserted=0, skipped=7, notes=already-imported", async () => {
    const { store } = makeTmpStore();
    const mock = makeMockEmbedder();
    await translateAgentMemories({
      agentId: "personal",
      targetWorkspace: FIXTURE_ROOT,
      memoryPath: "/tmp/unused",
      store,
      embedder: mock.embedder,
      sourceHash: "plan-hash",
    });
    const second = await translateAgentMemories({
      agentId: "personal",
      targetWorkspace: FIXTURE_ROOT,
      memoryPath: "/tmp/unused",
      store,
      embedder: mock.embedder,
      sourceHash: "plan-hash",
    });
    expect(second.upserted).toBe(0);
    expect(second.skipped).toBe(7);
    for (const row of second.ledgerRows) {
      expect(row.notes).toBe("already-imported");
    }
    store.close();
  });

  it("serial embedder: peak-in-flight === 1 (no Promise.all), call count === 7", async () => {
    const { store } = makeTmpStore();
    const mock = makeMockEmbedder();
    await translateAgentMemories({
      agentId: "personal",
      targetWorkspace: FIXTURE_ROOT,
      memoryPath: "/tmp/unused",
      store,
      embedder: mock.embedder,
      sourceHash: "plan-hash",
    });
    expect(mock.getCallCount()).toBe(7);
    expect(mock.getPeakInFlight()).toBe(1);
    store.close();
  });

  it("MEM-03: MemoryStore.insert is the ONLY write path — throwing mock on any other method still completes", async () => {
    const { store } = makeTmpStore();
    const mock = makeMockEmbedder();
    let insertCalls = 0;
    const storeProxy: MemoryStore = new Proxy(store, {
      get(target, prop: string | symbol, receiver) {
        if (prop === "insert") {
          return function (...args: unknown[]): MemoryEntry {
            insertCalls++;
            // Forward to the real method to keep origin_id semantics working.
            return (target.insert as Function).apply(target, args);
          };
        }
        if (prop === "close") {
          return target.close.bind(target);
        }
        // Any other method call fails the test.
        const value = Reflect.get(target, prop, receiver);
        if (typeof value === "function") {
          return function (): never {
            throw new Error(
              `translator called forbidden method: ${String(prop)}`,
            );
          };
        }
        return value;
      },
    });
    await translateAgentMemories({
      agentId: "personal",
      targetWorkspace: FIXTURE_ROOT,
      memoryPath: "/tmp/unused",
      store: storeProxy,
      embedder: mock.embedder,
      sourceHash: "plan-hash",
    });
    expect(insertCalls).toBe(7);
    store.close();
  });

  it("ledger rows validate against ledgerRowSchema; file_hashes has exactly one 64-char sha256 entry", async () => {
    const { store } = makeTmpStore();
    const mock = makeMockEmbedder();
    const result = await translateAgentMemories({
      agentId: "personal",
      targetWorkspace: FIXTURE_ROOT,
      memoryPath: "/tmp/unused",
      store,
      embedder: mock.embedder,
      sourceHash: "plan-hash",
    });
    for (const row of result.ledgerRows) {
      const parsed = ledgerRowSchema.safeParse(row);
      expect(parsed.success).toBe(true);
      expect(row.file_hashes).toBeDefined();
      const entries = Object.entries(row.file_hashes ?? {});
      expect(entries).toHaveLength(1);
      const [relpath, hex] = entries[0]!;
      expect(relpath.length).toBeGreaterThan(0);
      expect(hex).toMatch(/^[0-9a-f]{64}$/);
    }
    store.close();
  });

  it("MEM-05: module source never imports better-sqlite3, references openclaw sqlite, or calls loadExtension", () => {
    const src = readFileSync(
      join(__dirname, "..", "memory-translator.ts"),
      "utf8",
    );
    // Literal imports (doc-comment mentions are allowed — they spell out
    // the DO-NOT list). Match only real import/require forms.
    expect(src).not.toMatch(/from\s+["']better-sqlite3["']/);
    expect(src).not.toMatch(/require\s*\(\s*["']better-sqlite3["']\s*\)/);
    expect(src).not.toMatch(/\.loadExtension\s*\(/);
    // No reads from the OpenClaw sqlite index location.
    expect(src).not.toMatch(/~\/\.openclaw\/memory/);
    expect(src).not.toMatch(/\.openclaw\/memory/);
    // No raw SQL against vec_memories / memories.
    expect(src).not.toMatch(/INSERT\s+INTO\s+vec_memories/i);
    expect(src).not.toMatch(/INSERT\s+INTO\s+memories/i);
  });

  it("MEM-04: after translation, findByTag('learning') returns 2 entries with .learnings content verbatim", async () => {
    const { store } = makeTmpStore();
    const mock = makeMockEmbedder();
    await translateAgentMemories({
      agentId: "personal",
      targetWorkspace: FIXTURE_ROOT,
      memoryPath: "/tmp/unused",
      store,
      embedder: mock.embedder,
      sourceHash: "plan-hash",
    });
    const learnings = store.findByTag("learning");
    expect(learnings).toHaveLength(2);
    const lessonDiscord = readFileSync(
      join(FIXTURE_ROOT, ".learnings/lesson-discord.md"),
      "utf8",
    );
    const patternImmut = readFileSync(
      join(FIXTURE_ROOT, ".learnings/pattern-immutability.md"),
      "utf8",
    );
    const contents = new Set(learnings.map((m) => m.content));
    expect(contents.has(lessonDiscord)).toBe(true);
    expect(contents.has(patternImmut)).toBe(true);
    store.close();
  });

  it("every inserted memory has source='manual'", async () => {
    const { store } = makeTmpStore();
    const mock = makeMockEmbedder();
    await translateAgentMemories({
      agentId: "personal",
      targetWorkspace: FIXTURE_ROOT,
      memoryPath: "/tmp/unused",
      store,
      embedder: mock.embedder,
      sourceHash: "plan-hash",
    });
    const all = store.findByTag("migrated");
    expect(all).toHaveLength(7);
    for (const m of all) {
      expect(m.source).toBe("manual");
    }
    store.close();
  });

  it("static grep: exactly one store.insert call site and one embedder.embed call site", () => {
    const src = readFileSync(
      join(__dirname, "..", "memory-translator.ts"),
      "utf8",
    );
    const insertMatches = src.match(/\bstore\.insert\s*\(/g) ?? [];
    expect(insertMatches.length).toBe(1);
    const embedMatches = src.match(/\bembedder\.embed\s*\(/g) ?? [];
    expect(embedMatches.length).toBe(1);
    // No Promise.all / allSettled — the serial invariant isn't just
    // runtime-proven via peakInFlight above, it's also source-pinned
    // so a regression at the static level is caught by this test.
    expect(src).not.toMatch(/\bPromise\.all\b/);
    expect(src).not.toMatch(/\bPromise\.allSettled\b/);
  });

  it("file_hashes key is the relpath (forward-slash normalized)", async () => {
    const { store } = makeTmpStore();
    const mock = makeMockEmbedder();
    const result = await translateAgentMemories({
      agentId: "personal",
      targetWorkspace: FIXTURE_ROOT,
      memoryPath: "/tmp/unused",
      store,
      embedder: mock.embedder,
      sourceHash: "plan-hash",
    });
    const relpaths = result.ledgerRows.flatMap((r) =>
      Object.keys(r.file_hashes ?? {}),
    );
    // Expected 7 relpaths — 3× MEMORY.md + entity-foo + note-bar + 2 learnings.
    expect(relpaths.filter((r) => r === "MEMORY.md")).toHaveLength(3);
    expect(relpaths).toContain("memory/entity-foo.md");
    expect(relpaths).toContain("memory/note-bar.md");
    expect(relpaths).toContain(".learnings/lesson-discord.md");
    expect(relpaths).toContain(".learnings/pattern-immutability.md");
    // None contain backslashes (cross-platform invariant).
    for (const r of relpaths) {
      expect(r.includes("\\")).toBe(false);
    }
    store.close();
  });
});
