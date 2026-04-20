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
import { readFileSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  splitMemoryMd,
  slugifyHeading,
  computeOriginId,
  buildTagsForMemoryMd,
  buildTagsForMemoryFile,
  buildTagsForLearning,
  sha256Hex,
} from "../memory-translator.js";

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
      expect(sections[0]?.content).toBe("preamble line\n\n");
      expect(sections[1]?.heading).toBe("First");
      expect(sections[1]?.content).toBe("## First\nbody");
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
