# fin-acquisition Cutover Runbook

**Status:** Prepared, NOT executed. The OpenClaw → ClawCode cutover of the
`fin-acquisition` agent in Discord channel `1481670479017414767` (Ramy's
advisory workflow) is a manual operator step deferred per user directive on
2026-04-24 ("we're going to prepare the agent but not cutover yet I'll do
that manually").

**Prerequisites (already shipped in Phase 90 Plans 01-07):**

- `clawcode.yaml` fin-acquisition entry patched with 6 MCPs, heartbeat
  (50m/haiku/verbatim-HEARTBEAT.md), `effort: auto`, `allowedModels`,
  `greetOnRestart: true`, `greetCoolDownMs: 300000` — WIRE-01..04 landed.
- `clawcode memory backfill fin-acquisition` CLI exists and wraps Plan
  90-02 `MemoryScanner.backfill()` — WIRE-06 landed.
- Webhook identity probe (`verifyAgentWebhookIdentity`) wired at daemon
  boot — WIRE-05 landed.
- Phase 90 memory subsystem (MEM-01 stable-prefix MEMORY.md auto-load +
  MEM-02 chokidar scanner + MEM-03 hybrid RRF retrieval + MEM-04/05/06
  flush + cue + subagent capture) is shipped.

**What this runbook covers:** the operator-executable steps to perform the
actual channel flip and 513 MB uploads mirror when the user is ready.

---

## Pre-cutover Checklist

Each item must pass BEFORE flipping the channel binding. Items are ordered
to fail fast on the cheap checks first.

```bash
# 1. ClawCode daemon is running + healthy
systemctl --user status clawcode
clawcode health

# 2. clawcode.yaml fin-acquisition entry is correctly wired
awk '/name: fin-acquisition/,/name: finmentum-content-creator/' \
  /etc/clawcode/clawcode.yaml | grep -E 'effort|allowedModels|heartbeat|greetOnRestart'

# 3. 1Password resolvers ready (finmentum-db and finmentum-content depend on them)
op read "op://clawdbot/MySQL DB - Unraid/password" >/dev/null && echo ok
op read "op://clawdbot/HeyGen API Key/credential" >/dev/null && echo ok
```

- [ ] `clawcode health` reports no critical status.
- [ ] clawcode.yaml entry grep finds all 4 fields.
- [ ] 1Password refs resolve without error.
- [ ] Memory backfill run: `clawcode memory backfill fin-acquisition`
      exits 0 and reports ≥ 62 indexed files and ≥ 200 chunks.
- [ ] `clawcode mcp-status fin-acquisition` shows 6/6 MCPs ready.
- [ ] `clawcode restart fin-acquisition` produces a "Finance Clawdy"
      restart greeting in the bound channel with 🤝 avatar (Phase 89
      GREET-01 + WIRE-05).
- [ ] OpenClaw channel volume check: send "status?" to channel
      `1481670479017414767` — OpenClaw should still respond (baseline).
      Low-volume quiet window confirmed before proceeding.
- [ ] Regression probe: ask "what's our firm legal name?" in a test
      channel bound to a fin-acquisition dev agent. Answer should contain
      "Finmentum LLC" (Plan 90-01 MEM-01 stable-prefix auto-load).

## MCP Readiness Verification

```bash
# All 6 MCPs must show status: ready (Phase 85 TOOL-04 verbatim-error
# pass-through means any failure surfaces here with the exact transport
# error, not a phantom).
clawcode mcp-status fin-acquisition
```

Expected output shape (6 rows, all `ready`):

```
Agent: fin-acquisition
  finmentum-db       ready   (last success: 2026-04-24T...)
  finmentum-content  ready   (last success: 2026-04-24T...)
  google-workspace   ready   (last success: 2026-04-24T...)
  browserless        ready   (last success: 2026-04-24T...)
  fal-ai             ready   (last success: 2026-04-24T...)
  brave-search       ready   (last success: 2026-04-24T...)
```

- [ ] All 6 servers report `ready`.
- [ ] No `degraded`, `failed`, or `reconnecting` entries.
- [ ] `/clawcode-tools` in the Discord channel (dev probe) matches the
      CLI output 1:1 (Phase 85 TOOL-05).

If any MCP is NOT ready:

```bash
# Per-MCP probe — tails last-error for debugging
clawcode mcp-servers --agent fin-acquisition --verbose

# Daemon log (most recent MCP readiness handshakes)
journalctl --user -u clawcode --since "10 minutes ago" | grep -i 'mcp'
```

Do NOT proceed if any MCP is degraded; fix first.

## Upload Rsync (513MB)

OpenClaw's `~/.openclaw/workspace-finmentum/uploads/` contains 513 MB of
client transcripts, PDFs, HeyGen renders, and screenshots. Mirror to the
ClawCode agent workspace BEFORE the channel flip (so the first post-cutover
turn can access historical uploads).

```bash
# Mirror uploads; -a preserves timestamps+permissions, -P shows progress
rsync -aP --info=progress2 ~/.openclaw/workspace-finmentum/uploads/ ~/.clawcode/agents/finmentum/uploads/
```

- [ ] rsync completes without errors.
- [ ] Byte-count parity check:

```bash
du -sb ~/.openclaw/workspace-finmentum/uploads/ \
       ~/.clawcode/agents/finmentum/uploads/
```

- [ ] Totals match within 4 KB (filesystem rounding OK).

If the rsync is interrupted, safe to re-run — rsync is idempotent.

## OpenClaw Channel Config Flip

The OpenClaw fin-acquisition bot currently owns Discord channel
`1481670479017414767`. Flip:

```bash
# 1. Back up the live OpenClaw config
cp ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.bak-pre-clawcode-cutover-$(date +%Y%m%d-%H%M%S)

# 2. Edit ~/.openclaw/openclaw.json — find the fin-acquisition agent block
#    and either set its Discord binding to an empty array OR remove the
#    agent entry entirely (retiring OpenClaw fin-acquisition for good).
#    EXAMPLE (jq shown for illustration — use your editor of choice):
jq '.agents."fin-acquisition".channels = []' \
   ~/.openclaw/openclaw.json > ~/.openclaw/openclaw.json.tmp && \
   mv ~/.openclaw/openclaw.json.tmp ~/.openclaw/openclaw.json

# 3. Restart OpenClaw so it picks up the edit
systemctl --user restart openclaw
# OR: pm2 restart openclaw, depending on how OpenClaw is managed

# 4. Confirm the OpenClaw bot no longer posts — wait 2-3 minutes and send
#    a "status?" probe message into the channel. OpenClaw should NOT reply.
#    (Discord shows only the user message, no bot response.)
```

- [ ] Backup of `openclaw.json` created.
- [ ] OpenClaw config edited, daemon restarted.
- [ ] OpenClaw bot confirmed silent on a test message.

## Cutover Command Sequence

With the channel vacant, bring ClawCode's fin-acquisition online:

```bash
# 1. clawcode.yaml already binds fin-acquisition.channels[0] to
#    "1481670479017414767" (unchanged by Phase 90 Plan 07 — this is the
#    whole point of the "deferred" scope). Confirm:
awk '/name: fin-acquisition/,/memoryPath/' /etc/clawcode/clawcode.yaml

# 2. Restart the agent so it re-reads config and registers its Discord
#    channel binding
clawcode restart fin-acquisition

# 3. Watch the daemon log for the restart greeting dispatch
journalctl --user -u clawcode -f | grep -E 'fin-acquisition|webhook|greeting'
```

- [ ] `clawcode restart fin-acquisition` exits 0.
- [ ] Daemon log shows `webhook identity probe` entry for fin-acquisition
      with `status: verified` (WIRE-05).
- [ ] "Finance Clawdy" + 🤝 restart greeting lands in channel
      `1481670479017414767` within 10 s (Phase 89 GREET-01).
- [ ] First live operator turn ("hey") gets a real response, not a
      "memory's coming up empty" fallback.

## Day-1 Canary Observability

For the first 24 hours post-cutover, monitor:

```bash
# MCP health — run every 15 min, eyeball for status changes
watch -n 900 'clawcode mcp-status fin-acquisition'

# Tail daemon log for fin-acquisition-specific warnings / errors
journalctl --user -u clawcode -f | grep -E 'fin-acquisition|memory-scanner|flush|cue'
```

Watch for:

- [ ] `warm-path` errors (session startup failures)
- [ ] `memory-scanner` failures (chokidar or embedder issues)
- [ ] `flush failed` (Plan 90-03 MEM-04)
- [ ] `cue write failed` (Plan 90-03 MEM-05)
- [ ] `subagent capture failed` (Plan 90-03 MEM-06)

User test (within first 2 hours):

- [ ] Ramy sends "what's the most recent thing we worked on?" — answer
      includes content from the most recent `memory/YYYY-MM-DD-HHMM.md`
      flush or a recent dated file (proves MEM-02 + MEM-03 hybrid RRF
      retrieval is hitting).
- [ ] Ramy sends "what's our firm legal name?" — answer contains
      "Finmentum LLC" (proves MEM-01 stable-prefix auto-load).
- [ ] Ramy sends "remember this: <fact>" — agent posts ✅ reaction and
      writes a new file under `memory/YYYY-MM-DD-remember-*.md` (MEM-05
      cue capture).

Latency check: compare first-token time against OpenClaw baseline.
Sub-3s expected (Phase 73 budget).

## Rollback Procedure

If the cutover produces regressions the ClawCode team cannot fix quickly:

```bash
# 1. Revert OpenClaw binding
cp ~/.openclaw/openclaw.json.bak-pre-clawcode-cutover-* ~/.openclaw/openclaw.json
# OR edit openclaw.json again and restore the original channels array
systemctl --user restart openclaw

# 2. Stop the ClawCode fin-acquisition agent so it doesn't race the
#    re-armed OpenClaw bot for the same channel
clawcode stop fin-acquisition

# 3. Confirm OpenClaw resumes posting in the channel (send test message)
# 4. File issue with the ClawCode team:
#    - ~/.clawcode/manager/logs/*.log (tail of fin-acquisition entries)
#    - sqlite3 ~/.clawcode/agents/finmentum/memory/fin-acquisition/memories.db "SELECT count(*) FROM memory_chunks"
#    - list of recent memory/*.md files: ls -lt ~/.clawcode/agents/finmentum/memory/ | head -20
```

**No data loss** — `memory_chunks` lives in ClawCode's SQLite independent
of which bot owns the channel. Re-cutover is safe once the regression is
fixed; re-running the rsync mirror is idempotent.

## Post-Cutover Verification

24 hours after cutover, confirm durability:

```bash
# 1. Flushes happened (MEM-04)
ls -lt ~/.clawcode/agents/finmentum/memory/*.md | head -20
# Expect files with recent timestamps every ~15 min during active use

# 2. memory_chunks grew beyond the initial backfill count
sqlite3 ~/.clawcode/agents/finmentum/memory/fin-acquisition/memories.db \
  "SELECT count(*) FROM memory_chunks"

# 3. No phantom MCP errors (Phase 85 TOOL-04 verbatim-error pass-through
#    should surface ANY real MCP failure, not a generic "tool unavailable")
journalctl --user -u clawcode --since yesterday | grep -Ei 'phantom|tool unavailable' | head -5
# Expect empty output

# 4. Restart greeting cool-down honored (Phase 89 GREET-10)
clawcode restart fin-acquisition; sleep 5; clawcode restart fin-acquisition
# First produces greeting; second should NOT (within 5-minute cool-down)

# 5. Webhook identity still verified
clawcode restart fin-acquisition 2>&1 | grep -i 'webhook'
# Expect "webhook identity probe ... status: verified" (NOT "provisioned"
# — if provisioned fires on every restart, the webhook is being
# overwritten, which is a bug)
```

- [ ] Memory flushes happening (3+ new `memory/YYYY-MM-DD-HHMM.md` files).
- [ ] `memory_chunks` count grew by at least +10 beyond initial backfill.
- [ ] Zero phantom MCP errors in the log.
- [ ] Restart cool-down honored.
- [ ] Webhook identity consistently reports `verified` (NOT `provisioned`
      on repeat restarts).

## Emergency Contact

If cutover fails AND rollback fails (rare — both bots racing the same
channel is the worst case):

```bash
# 1. Pause all clawcode services — vacates the channel entirely
systemctl --user stop clawcode

# 2. Restore the latest known-good ~/.openclaw/openclaw.json from the
#    backup chain
ls -lt ~/.openclaw/openclaw.json.bak-* | head
cp ~/.openclaw/openclaw.json.bak-<CHOSEN> ~/.openclaw/openclaw.json
systemctl --user restart openclaw

# 3. Document the failure mode for postmortem
mkdir -p .planning/debug
$EDITOR .planning/debug/fin-acquisition-cutover-$(date +%Y-%m-%d).md
```

Include in the postmortem:

- Exact timeline of restart + first-failure
- Daemon log excerpts around the failure
- MCP status snapshot at failure time
- Discord message ID of the last OpenClaw reply + first ClawCode reply

---

*Runbook generated during Phase 90 Plan 07 (WIRE-07).*
*Execution deferred to operator per user directive 2026-04-24.*
