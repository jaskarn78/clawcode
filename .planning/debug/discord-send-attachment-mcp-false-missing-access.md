# Discord MCP send_attachment false "Missing Access" + finmentum-client-acquisition channel access

**Reported:** 2026-04-24 by operator
**Diagnostic source:** Direct Discord API + bot role inspection

---

## Issue 1: `send_attachment` MCP tool returns false "Missing Access"

**Symptom:** MCP path (`send_attachment` tool) errors out with `Missing Access` (Discord 50001) even when the bot has full channel permissions and a direct Discord REST API upload succeeds against the same channel/credentials.

**Evidence:**
- Channel: `1492939095696216307` (fin-test / now fin-acquisition)
- Bot: `Clawdy Code#6121` (id `1491528639227891875`)
- Bot role (`1491538003016028325`) has **Attach Files** at guild level
- Direct Discord API upload **succeeded** with the same bot token (operator uploaded `nike-nke-research-2026-04-21.pdf` as a test; Discord CDN URL stored on attached message)
- MCP `send_attachment` path **failed** with `50001 Missing Access`

**Conclusion:** ClawCode MCP server / harness bug — not a Discord perms problem. The wrapper is computing a permission check, a channel lookup, or a webhook path incorrectly.

**Likely investigation targets (clawcode source):**
- `src/discord/**` — any attachment-send path (webhook vs bot-direct)
- MCP server definition for `send_attachment` tool (handler + permission pre-check logic)
- Phase 90.1 `bot-direct fallback` — introduced for webhook failures; may have a regression for attachments
- Look for code that independently checks channel overwrites before calling `channel.send({ files })` — Discord already enforces this server-side, a stale local cache of overwrites could false-negative
- Check whether MCP sends via webhook (needs webhook perms) vs bot (needs bot channel membership); the direct-API success suggests bot-channel path works but MCP is routing via a webhook that lacks the channel

**Reproducer (to confirm when investigating):**
1. Call `send_attachment` MCP tool to channel `1492939095696216307` with any file
2. Observe `Missing Access` error
3. Call Discord REST directly (`POST /channels/.../messages` with multipart) using the same bot token
4. Observe success

**Severity:** Medium — blocks any agentic workflow that uploads files via MCP; workaround is direct API call, but that bypasses the MCP abstraction other agents depend on.

---

## Issue 2: Bot not in `#finmentum-client-acquisition` (`1481670479017414767`)

**Symptom:** Both MCP and direct API return `50001 Missing Access` for this channel.

**Root cause:** Real this time — `@everyone` denies `View Channel`; no channel-level overwrite exists for Clawdy Code bot or role.

**Fix (operator action, Discord admin):**
Add channel permission overwrite on `1481670479017414767` for **either**:
- Bot user `Clawdy Code` (id `1491528639227891875`), OR
- Bot role `Clawdy Code` (id `1491538003016028325`) ← preferred (role-based is cleaner)

Grant:
- ✅ View Channel
- ✅ Send Messages
- ✅ Attach Files
- ✅ Embed Links
- ✅ Read Message History
- ✅ Use External Emojis (optional)

**Not fixable from ClawCode code** — Discord server admin action required.

---

## Disposition

- Issue 1 → open tech debt for investigation in clawcode source. Recommend spawning a debug session (`/gsd:debug`) scoped to the MCP send_attachment handler with the reproducer above.
- Issue 2 → operator pings Discord admin to add the role overwrite. No code change needed.

Not routing into Phase 92 scope — Phase 92 is the OpenClaw→ClawCode fin-acquisition cutover parity verifier; these are orthogonal bot-plumbing issues.
