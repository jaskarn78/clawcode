# Backlog: Discord Table Rendering

## 999.46 — Auto-wrap markdown tables in a code block when output target is Discord

When agents emit markdown tables (`| col | col |` style) to a Discord channel, Discord's renderer doesn't recognize them and shows the raw pipes. Columns collapse on mobile, alignment breaks, content becomes hard to read. The fix is small and obvious in hindsight: **wrap every markdown table in a code block.** Code blocks render in monospace, which preserves column alignment, and Discord handles them well on both desktop and mobile (mobile gets a horizontal-scroll container — annoying but readable, vs. broken).

Operator pointed out that this matches what tree structures already get — directory trees and other ASCII-aligned content are wrapped in code blocks and they render fine. Tables should follow the same pattern.

### Symptoms

- 2026-05-01 — Operator flagged 4× in one day; led to `feedback_no_wide_tables_discord.md` rule for Admin Clawdy ("use stacked single-line cards or bullets")
- 2026-05-13 — Operator re-raised the issue with screenshot showing a 4-column table from Admin Clawdy on mobile that's barely readable. Asked: "why cant they be wrapped in code blocks like the tree structure above it?" — pointing out that we already use this pattern for trees, just not tables.
- Per-agent feedback rule is a workaround, not a fix — every new agent has to learn this, and well-formatted tables are still useful information when rendered correctly.

### Root cause

Discord's markdown renderer doesn't support GitHub-flavored markdown tables. The `|` characters render literally. Mobile makes it worse because limited width forces column collapse.

### Desired behavior

**Default transform (covers ~95% of cases):**

When an agent's output is destined for a Discord channel and contains markdown table syntax:

1. **Detect** the table — a contiguous block of `| ... |` lines with a separator row (e.g. `| --- | --- |`).
2. **Wrap** the entire table block in a fenced code block:
   ````
   ```
   | col1 | col2 | col3 |
   | ---- | ---- | ---- |
   | a    | b    | c    |
   ```
   ````
3. **Pad columns** to equal width based on cell content, so monospace alignment is preserved (basic `printf`-style padding — cheap to compute).
4. **Preserve** the original markdown table when output destination isn't Discord (file writes, logs, clients that render GFM correctly).

**Optional refinements (only if needed later):**

- **2-column key/value tables** → could fall back to bullets `• **Key** — value` for prettier rendering. But code-block also works, so this is polish.
- **Very wide tables** (>2000 char message limit or rows exceeding mobile scroll-comfort) → upload as `.md` attachment instead.
- **Discord embed with `addField()`** is **not** recommended — embeds add visual chrome, mix poorly with surrounding prose, and break when the response is part of a streaming edit.

### Acceptance criteria

- Markdown table in agent response → renders as monospace-aligned text on Discord (desktop and mobile)
- Columns stay aligned regardless of cell content widths (padding handles it)
- Bold/links inside cells degrade to raw markdown text inside the code block — acceptable tradeoff for alignment
- Per-agent `feedback_no_wide_tables_discord.md` rules become obsolete and can be removed
- Round-trip preserved: same response written to a file keeps the original markdown table without code-block wrapping

### Implementation notes

- Single place to hook: the Discord output formatter in the daemon (between LLM stream-json output and webhook POST). Same path that already handles message length limits and `[Download draft]` link injection.
- Streaming/edit cycles need care — wrap the table only when the table block is complete (separator row seen + at least one data row). Don't half-wrap during streaming.
- Column padding can be naive — measure max width per column from raw cell content, then pad. Don't try to render bold/italics inside; treat cell contents as plain text.

### Related

- `feedback_no_wide_tables_discord.md` (per-agent workaround that this fix would supersede)
- `feedback_embed_mobile_readability.md` (sibling rule about mobile-first formatting)
- 999.45 (hourglass→thumbs-up icon) — both are Discord-rendering quality improvements

### Reporter

Jas, 2026-05-13 11:04 PT (recurring pain — flagged 5×+ across 2026-05-01 and 2026-05-13). Code-block-as-default approach suggested by Jas 11:07 PT in follow-up: "why cant they be wrapped in code blocks like the tree structure above it?"
