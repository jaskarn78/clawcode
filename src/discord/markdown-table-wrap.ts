/**
 * Phase 100 follow-up — wrap raw markdown tables in code fences for Discord.
 *
 * Operator-reported 2026-04-28: Discord doesn't render markdown tables
 * (pipes show as literal characters, rows don't visually align), making
 * tables hard to read on desktop and miserable on mobile. Wrapping tables
 * in ```text code fences forces Discord to render them as monospace, where
 * pipe alignment becomes meaningful and columns line up.
 *
 * Sometimes the agent legitimately wants tabular structure — this helper
 * preserves the table while making it Discord-readable. The directive
 * "no-markdown-tables-in-discord" (deferred) would steer agents away from
 * tables when bullet/definition-list works better; this wrapper is the
 * structural safety net for cases where tables ARE the right format.
 *
 * Detection: a "table" is a header row (line of `| ... |`) immediately
 * followed by a separator row (line matching `| --- | --- |` style with
 * optional `:` for alignment). Rows are collected until the next non-row
 * line, then wrapped in a code fence as a single block.
 *
 * Edge cases handled:
 *   - Tables inside existing code blocks → pass through unchanged
 *     (don't double-wrap; respect existing fenced sections)
 *   - Header without separator → not wrapped (sentence with pipes ≠ table)
 *   - Multiple tables separated by prose → each wrapped independently
 *   - Streaming partial content → safe; mid-stream tables get wrapped as
 *     soon as the separator row arrives, additional rows extend the wrap
 *
 * Pure function — no I/O, no logging, no side effects.
 */

const TABLE_ROW_RE = /^\s*\|.+\|\s*$/;
const TABLE_SEPARATOR_RE = /^\s*\|[\s:|-]+\|\s*$/;
const CODE_FENCE_RE = /^\s*```/;
const BACKTICK_RUN_RE = /`+/g;
const MIN_FENCE_LEN = 3;

/**
 * Phase 122 SC-3 — longest run of consecutive backticks across the given
 * block of lines. Used to compute an outer code fence that won't be
 * terminated prematurely by an embedded triple-backtick (or longer) run
 * inside a table cell.
 */
function longestBacktickRun(block: readonly string[]): number {
  let longest = 0;
  for (const line of block) {
    BACKTICK_RUN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = BACKTICK_RUN_RE.exec(line)) !== null) {
      if (m[0].length > longest) longest = m[0].length;
    }
  }
  return longest;
}

/**
 * Returns the input with every standalone markdown table block wrapped in
 * a ```text``` code fence. Idempotent: existing fenced tables are preserved
 * exactly as written.
 */
export function wrapMarkdownTablesInCodeFence(content: string): string {
  if (!content || content.length === 0) return content;
  const lines = content.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Pass through any content already inside a code fence — never
    // double-wrap. Mirror the closing fence too.
    if (CODE_FENCE_RE.test(line)) {
      out.push(line);
      i++;
      while (i < lines.length && !CODE_FENCE_RE.test(lines[i])) {
        out.push(lines[i]);
        i++;
      }
      if (i < lines.length) {
        out.push(lines[i]); // closing fence
        i++;
      }
      continue;
    }
    // Detect table start: header row + separator row pair.
    if (
      TABLE_ROW_RE.test(line) &&
      i + 1 < lines.length &&
      TABLE_SEPARATOR_RE.test(lines[i + 1])
    ) {
      // Collect consecutive table rows. The separator counts as a row.
      const tableBlock: string[] = [];
      while (i < lines.length && TABLE_ROW_RE.test(lines[i])) {
        tableBlock.push(lines[i]);
        i++;
      }
      // Phase 122 SC-3 — outer fence must be longer than the longest run
      // of backticks inside any cell, else an embedded ``` would terminate
      // the wrap and leak the rest of the table as raw markdown. Floor at
      // 3 so prose without nested fences keeps the historical ```text shape.
      const outerLen = Math.max(longestBacktickRun(tableBlock) + 1, MIN_FENCE_LEN);
      const fence = "`".repeat(outerLen);
      out.push(`${fence}text`);
      out.push(...tableBlock);
      out.push(fence);
      continue;
    }
    out.push(line);
    i++;
  }
  return out.join("\n");
}
