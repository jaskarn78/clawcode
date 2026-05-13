# Backlog: Discord Table Rendering

## 999.46 — Auto-transform markdown tables when output target is Discord

When agents emit markdown tables (`| col | col |` style) to a Discord channel, the rendering is consistently bad — especially on mobile. Tables overflow, wrap awkwardly, lose column alignment, and force horizontal scrolling on small screens. Operator has flagged this repeatedly.

### Symptoms

- 2026-05-01 — Operator flagged 4× in one day; led to `feedback_no_wide_tables_discord.md` rule for Admin Clawdy ("use stacked single-line cards or bullets")
- 2026-05-13 — Operator re-raised the issue with screenshot showing a 4-column table from Admin Clawdy on mobile that's barely readable
- The per-agent feedback rule is a workaround, not a fix — every new agent has to learn this, and well-formatted tables are still useful information when rendered correctly

### Root cause

Discord's markdown renderer doesn't support GitHub-flavored markdown tables. The `|` characters render literally. Mobile Discord makes it even worse because the limited width forces column collapse.

### Desired behavior

When an agent's output is destined for a Discord channel:

1. **Detect** markdown table syntax in the response (regex on `\|.*\|` lines + a separator row).
2. **Transform** based on table shape:
   - **≤ 2 columns** → bullet list with bolded keys: `• **Key** — value`
   - **3–4 columns** → Discord embed with one field per row, value formatted as `key1: x | key2: y`
   - **5+ columns** or **wide content** → render as a code block (monospace alignment is at least readable) OR upload as an attachment (.md or .txt)
3. **Preserve** the table when output destination isn't Discord (e.g., direct file write, logs, other clients that render markdown correctly)

### Acceptance criteria

- A response containing a markdown table sent to Discord renders cleanly on mobile (≤390px wide) without horizontal scroll
- The transformation is automatic — agents don't need to know to avoid tables
- Per-agent feedback rules like `feedback_no_wide_tables_discord.md` become obsolete and can be removed
- Round-trip preserved when relevant: if the same response is also written to a file or another channel, tables stay as tables

### Implementation hooks

- Most natural place: the Discord output formatter in the daemon (between LLM stream-json output and Discord webhook POST)
- Could also live as a post-processing step in the message-send IPC path
- Needs to handle streaming/edit cycles too — table can't be half-transformed

### Related

- `feedback_no_wide_tables_discord.md` (per-agent workaround that this fix would supersede)
- `feedback_embed_mobile_readability.md` (sibling rule about mobile-first formatting)
- 999.45 (hourglass→thumbs-up icon) — both are Discord-rendering quality improvements

### Reporter

Jas, 2026-05-13 11:04 PT. Recurring pain — flagged at least 5× across 2026-05-01 and 2026-05-13.
