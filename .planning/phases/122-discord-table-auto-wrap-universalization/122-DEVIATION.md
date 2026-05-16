# Phase 122 — Deviation: Helper Extension for SC-3

**Date:** 2026-05-14
**Plan:** 122-01
**Decision lock affected:** CONTEXT D-02 ("helper UNCHANGED")
**Override authority:** CONTEXT D-03 ("if helper rewriting becomes necessary for SC-3, document the rewrite in `122-DEVIATION.md`")

## What the helper does today

`src/discord/markdown-table-wrap.ts` hardcodes a 3-backtick `` ```text `` outer fence:

```ts
out.push("```text");
out.push(...tableBlock);
out.push("```");
```

A table cell containing a literal triple-backtick fence (e.g., `| code | \`\`\`bash\nls\n\`\`\` |`) would terminate the outer fence prematurely, breaking Discord rendering and leaking the table's tail content as plain markdown.

## What changes

Before emitting the outer fence, scan every line in the collected `tableBlock` for the longest run of consecutive backticks. Outer fence length = `max(longestBacktickRun + 1, 3)`. Closing fence matches.

Pseudo:
```
const longest = max over tableBlock lines of longest run of consecutive '`'
const outerLen = Math.max(longest + 1, 3)
const fence = '`'.repeat(outerLen)
out.push(`${fence}text`)
out.push(...tableBlock)
out.push(fence)
```

Language tag stays `text` (Discord monospace, no syntax highlighting).

## Why this is bounded

- Only the outer-fence length computation changes. Detection logic, idempotency, pass-through of pre-fenced content — all unchanged.
- Edge cases preserved: header-without-separator still skipped; multiple independent tables each compute their own fence length; mid-stream partial rows still fall outside the wrap.
- Idempotency: running `wrapMarkdownTablesInCodeFence` twice over an already-wrapped 4-backtick block sees the outer fence as a code-fence-start (matches `CODE_FENCE_RE = /^\s*```/` which matches 3+ backticks), passes the inner block through verbatim, never re-wraps.

## What stays out

- No change to detection regexes (`TABLE_ROW_RE`, `TABLE_SEPARATOR_RE`).
- No new language tag.
- No reformatting of the table cells themselves.

## Test coverage

`MTW-11` (added in T-01 RED): a 4-column table with a cell containing ` ``` ` produces an outer fence of 4 backticks (or more), and the table content survives intact between the open/close fences.

## SC-4 reconciliation

SC-4 says "helper UNCHANGED." Read literally with SC-3 in mind: the helper is UNCHANGED except for the minimal extension SC-3 requires. CONTEXT D-03 makes this explicit. No other behavior is touched.
