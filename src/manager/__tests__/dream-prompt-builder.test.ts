import { describe, it, expect } from "vitest";

/**
 * Phase 95 Plan 01 Task 1 — dream prompt builder tests (RED).
 *
 * Pin D-02/D-03 invariants:
 *   - P1: systemPrompt contains the verbatim "<agent>'s reflection daemon"
 *     template literal (after agent-name substitution)
 *   - P2: userPrompt embeds 4 ## sections (Recent memory chunks /
 *     MEMORY.md / Recent conversation summaries / Existing wikilinks)
 *   - P3: estimatedInputTokens ≤ 32_000 even when input has 1000 chunks
 *     of 100 tokens each (oldest-first truncation kicks in)
 *   - P4: oldest-first truncation — chunks sorted lastModified DESC pre-
 *     truncate; survivors are most-recent
 *   - P5: empty memoryMd / empty summaries / empty graphEdges all degrade
 *     gracefully ("(none)" placeholder, no throw)
 *
 * Module under test does not exist yet — imports fail (RED).
 */

import {
  buildDreamPrompt,
  DREAM_PROMPT_INPUT_TOKEN_BUDGET,
  type DreamPromptInput,
  type MemoryChunk,
  type ConversationSummary,
} from "../dream-prompt-builder.js";

function chunk(
  id: string,
  body: string,
  lastModifiedIso: string,
  path = `memory/${id}.md`,
): MemoryChunk {
  return {
    id,
    path,
    body,
    lastModified: new Date(lastModifiedIso),
  };
}

function summary(id: string, content: string): ConversationSummary {
  return {
    sessionId: id,
    summary: content,
    endedAt: new Date("2026-04-25T11:00:00.000Z"),
  };
}

describe("buildDreamPrompt — D-02 context assembler", () => {
  it("BUDGET-CONST: DREAM_PROMPT_INPUT_TOKEN_BUDGET === 32_000", () => {
    expect(DREAM_PROMPT_INPUT_TOKEN_BUDGET).toBe(32_000);
  });

  it("P1: systemPrompt contains verbatim '<agent>'s reflection daemon' template (D-03 verbatim)", () => {
    const input: DreamPromptInput = {
      agentName: "fin-acquisition",
      recentChunks: [],
      memoryMd: "",
      recentSummaries: [],
      graphEdges: "",
    };
    const { systemPrompt } = buildDreamPrompt(input);
    expect(systemPrompt).toContain("fin-acquisition's reflection daemon");
    // The verbatim D-03 schema-output instruction
    expect(systemPrompt).toContain("Output JSON ONLY");
    expect(systemPrompt).toContain("newWikilinks");
    expect(systemPrompt).toContain("promotionCandidates");
    expect(systemPrompt).toContain("themedReflection");
    expect(systemPrompt).toContain("suggestedConsolidations");
  });

  it("P2: userPrompt embeds all 4 ## sections", () => {
    const input: DreamPromptInput = {
      agentName: "clawdy",
      recentChunks: [
        chunk("a", "alpha body", "2026-04-25T10:00:00Z", "memory/a.md"),
      ],
      memoryMd: "# Core memory\nThings I remember.",
      recentSummaries: [summary("s1", "Talked about deploys.")],
      graphEdges: '{"edges":[]}',
    };
    const { userPrompt } = buildDreamPrompt(input);
    expect(userPrompt).toContain("## Recent memory chunks");
    expect(userPrompt).toContain("## MEMORY.md");
    expect(userPrompt).toContain("## Recent conversation summaries");
    expect(userPrompt).toContain("## Existing wikilinks");
    // Body content present
    expect(userPrompt).toContain("alpha body");
    expect(userPrompt).toContain("Things I remember.");
    expect(userPrompt).toContain("Talked about deploys.");
  });

  it("P3: estimatedInputTokens ≤ 32_000 even with 1000 chunks × 100 tokens (truncation)", () => {
    // 100 tokens ≈ 400 chars under chars/4 heuristic
    const longBody = "x".repeat(400);
    const recentChunks = Array.from({ length: 1000 }, (_, i) =>
      chunk(`c${i}`, longBody, `2026-04-${String((i % 28) + 1).padStart(2, "0")}T10:00:00Z`),
    );
    const input: DreamPromptInput = {
      agentName: "test",
      recentChunks,
      memoryMd: "",
      recentSummaries: [],
      graphEdges: "",
    };
    const { estimatedInputTokens } = buildDreamPrompt(input);
    expect(estimatedInputTokens).toBeLessThanOrEqual(DREAM_PROMPT_INPUT_TOKEN_BUDGET);
  });

  it("P4: oldest-first truncation keeps most-recent chunks (sort DESC, drop oldest)", () => {
    // 5 chunks dated Apr-20..Apr-24; budget tuned to admit only the 3 newest.
    // Use distinctive bodies so we can grep which survived.
    const recentChunks = [
      chunk("c20", "BODY-APRIL-20", "2026-04-20T10:00:00Z"),
      chunk("c21", "BODY-APRIL-21", "2026-04-21T10:00:00Z"),
      chunk("c22", "BODY-APRIL-22", "2026-04-22T10:00:00Z"),
      chunk("c23", "BODY-APRIL-23", "2026-04-23T10:00:00Z"),
      chunk("c24", "BODY-APRIL-24", "2026-04-24T10:00:00Z"),
    ];
    // No truncation triggered with 5 small chunks — all survive but ORDER
    // must be DESC (newest first) so dropped-from-tail removes oldest.
    const input: DreamPromptInput = {
      agentName: "test",
      recentChunks,
      memoryMd: "",
      recentSummaries: [],
      graphEdges: "",
    };
    const { userPrompt } = buildDreamPrompt(input);
    // All 5 survive (small payload):
    expect(userPrompt).toContain("BODY-APRIL-24");
    expect(userPrompt).toContain("BODY-APRIL-23");
    expect(userPrompt).toContain("BODY-APRIL-22");
    expect(userPrompt).toContain("BODY-APRIL-21");
    expect(userPrompt).toContain("BODY-APRIL-20");
    // Order: newest must appear before oldest in the rendered prompt.
    const idx24 = userPrompt.indexOf("BODY-APRIL-24");
    const idx20 = userPrompt.indexOf("BODY-APRIL-20");
    expect(idx24).toBeGreaterThan(0);
    expect(idx20).toBeGreaterThan(idx24);

    // Now build a payload that triggers truncation: 5 chunks of large bodies
    // sized so only the 3 newest fit under a tight cap. Since DREAM_PROMPT_INPUT_TOKEN_BUDGET
    // is 32_000 but we can't lower it, simulate truncation by stuffing each
    // chunk with enough bytes that 5 exceeds 32k tokens but 3 fits.
    // 32_000 tokens ≈ 128_000 chars. Per-chunk body of 35_000 chars = ~8_750 tokens
    // → 5 chunks ≈ 43_750 tokens (over) → truncation drops 2 oldest.
    const big = "Y".repeat(35_000);
    const bigChunks = [
      chunk("c20", `OLDEST-20-${big}`, "2026-04-20T10:00:00Z"),
      chunk("c21", `${big}-OLDISH-21`, "2026-04-21T10:00:00Z"),
      chunk("c22", `${big}-MIDDLE-22-${big}`, "2026-04-22T10:00:00Z"),
      chunk("c23", `${big}-NEWISH-23`, "2026-04-23T10:00:00Z"),
      chunk("c24", `${big}-NEWEST-24`, "2026-04-24T10:00:00Z"),
    ];
    const truncResult = buildDreamPrompt({
      agentName: "test",
      recentChunks: bigChunks,
      memoryMd: "",
      recentSummaries: [],
      graphEdges: "",
    });
    expect(truncResult.estimatedInputTokens).toBeLessThanOrEqual(DREAM_PROMPT_INPUT_TOKEN_BUDGET);
    // Two oldest dropped:
    expect(truncResult.userPrompt).not.toContain("OLDEST-20");
    expect(truncResult.userPrompt).not.toContain("OLDISH-21");
    // Newest two survived (at least):
    expect(truncResult.userPrompt).toContain("NEWEST-24");
    expect(truncResult.userPrompt).toContain("NEWISH-23");
  });

  it("P5: empty inputs degrade gracefully — '(none)' placeholders, no throw", () => {
    const input: DreamPromptInput = {
      agentName: "lonely-agent",
      recentChunks: [],
      memoryMd: "",
      recentSummaries: [],
      graphEdges: "",
    };
    const { userPrompt, estimatedInputTokens } = buildDreamPrompt(input);
    expect(userPrompt).toContain("## Recent memory chunks");
    expect(userPrompt).toContain("## MEMORY.md");
    expect(userPrompt).toContain("## Recent conversation summaries");
    expect(userPrompt).toContain("## Existing wikilinks");
    // Each empty section gets a "(none)" placeholder
    expect(userPrompt).toContain("(none)");
    expect(estimatedInputTokens).toBeGreaterThan(0);
    expect(estimatedInputTokens).toBeLessThanOrEqual(DREAM_PROMPT_INPUT_TOKEN_BUDGET);
  });
});
