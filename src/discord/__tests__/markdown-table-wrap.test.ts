import { describe, it, expect } from "vitest";
import { wrapMarkdownTablesInCodeFence } from "../markdown-table-wrap.js";

describe("wrapMarkdownTablesInCodeFence", () => {
  it("MTW-1: empty input passes through", () => {
    expect(wrapMarkdownTablesInCodeFence("")).toBe("");
  });

  it("MTW-2: pure prose without tables passes through unchanged", () => {
    const input = "Hello world.\n\nNo tables here.\nJust paragraphs.";
    expect(wrapMarkdownTablesInCodeFence(input)).toBe(input);
  });

  it("MTW-3: a single table gets wrapped in ```text``` fence", () => {
    const input = [
      "| Col1 | Col2 |",
      "| ---- | ---- |",
      "| A | B |",
      "| C | D |",
    ].join("\n");
    const result = wrapMarkdownTablesInCodeFence(input);
    expect(result).toContain("```text");
    expect(result).toContain("```");
    // Original table content present
    expect(result).toContain("| Col1 | Col2 |");
    expect(result).toContain("| A | B |");
    // Fence is on its own line BEFORE the header
    expect(result.split("\n")[0]).toBe("```text");
  });

  it("MTW-4: multiple tables separated by prose are each wrapped", () => {
    const input = [
      "First section.",
      "",
      "| A | B |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "Some prose between.",
      "",
      "| X | Y |",
      "| - | - |",
      "| 9 | 8 |",
    ].join("\n");
    const result = wrapMarkdownTablesInCodeFence(input);
    // Two opening fences
    const fenceCount = (result.match(/```text/g) ?? []).length;
    expect(fenceCount).toBe(2);
    // Prose preserved between
    expect(result).toContain("Some prose between.");
  });

  it("MTW-5: header without separator is NOT wrapped (just a sentence with pipes)", () => {
    const input = "Use | as separator | in CSV.\nNo separator below this line.";
    const result = wrapMarkdownTablesInCodeFence(input);
    expect(result).not.toContain("```text");
    expect(result).toBe(input);
  });

  it("MTW-6: existing code fenced content is preserved (not double-wrapped)", () => {
    const input = [
      "Here's some code:",
      "```python",
      "def hello():",
      "    print('hi')",
      "```",
      "And below.",
    ].join("\n");
    const result = wrapMarkdownTablesInCodeFence(input);
    expect(result).toBe(input);
  });

  it("MTW-7: a table inside a code fence is preserved (pass-through)", () => {
    const input = [
      "Here's a literal example:",
      "```",
      "| Col1 | Col2 |",
      "| ---- | ---- |",
      "| A | B |",
      "```",
      "End.",
    ].join("\n");
    const result = wrapMarkdownTablesInCodeFence(input);
    // Should be unchanged — fence preserved, table inside not double-wrapped
    expect(result).toBe(input);
    expect((result.match(/```/g) ?? []).length).toBe(2); // existing pair, no new fences
  });

  it("MTW-8: mid-stream partial table (last row truncated mid-line) — partial row falls outside wrap, complete rows inside", () => {
    // Simulates streaming where the last line is mid-arrival
    const input = [
      "| Col1 | Col2 |",
      "| ---- | ---- |",
      "| A | B |",
      "| C | D",  // truncated — no closing pipe
    ].join("\n");
    const result = wrapMarkdownTablesInCodeFence(input);
    // Header + separator + first complete row should be wrapped
    expect(result).toContain("```text");
    // The truncated row stays raw outside the fence
    expect(result).toContain("| C | D");
  });

  it("MTW-9: Discord-style pipe table with alignment markers gets wrapped", () => {
    const input = [
      "| Plan | Limit |",
      "|:-----|------:|",
      "| SIMPLE IRA | $16,500 |",
      "| Solo 401(k) | $23,500 |",
    ].join("\n");
    const result = wrapMarkdownTablesInCodeFence(input);
    expect(result).toContain("```text");
    expect(result).toContain("|:-----|------:|");
  });

  it("MTW-10: idempotent — running twice produces same output as once", () => {
    const input = [
      "Above.",
      "",
      "| A | B |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "Below.",
    ].join("\n");
    const once = wrapMarkdownTablesInCodeFence(input);
    const twice = wrapMarkdownTablesInCodeFence(once);
    expect(twice).toBe(once);
  });

  it("MTW-11 (SC-3): a cell containing triple-backtick fence is wrapped with 4+ outer backticks", () => {
    // 4-column table where one cell contains a literal ```bash fence.
    // With a 3-backtick outer fence the embedded ``` would terminate the
    // outer block early, breaking Discord rendering. Helper must escalate
    // the outer fence to longest-inner-run + 1.
    const input = [
      "| Lang | Use | Example | Notes |",
      "| ---- | --- | ------- | ----- |",
      "| Bash | shell | ```bash ls ``` | safe |",
      "| Py | logic | print('hi') | safe |",
    ].join("\n");
    const result = wrapMarkdownTablesInCodeFence(input);
    // Outer fence must be at least 4 backticks — the cell contains a run
    // of 3, so 4 is the minimum that prevents breakout.
    const lines = result.split("\n");
    const openFence = lines[0];
    expect(openFence.startsWith("````")).toBe(true);
    expect(openFence).toMatch(/^`{4,}text$/);
    // The original cell content (with its inner ``` intact) survives.
    expect(result).toContain("```bash ls ```");
    // Closing fence matches the opening fence length.
    const openLen = (openFence.match(/^`+/) ?? [""])[0].length;
    const closeFence = "`".repeat(openLen);
    expect(result.endsWith(closeFence)).toBe(true);
    // Idempotent under SC-3 escalation — running twice produces same output.
    expect(wrapMarkdownTablesInCodeFence(result)).toBe(result);
  });
});
