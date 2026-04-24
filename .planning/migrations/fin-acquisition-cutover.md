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

---

## Phase 91: Continuous Workspace Sync

**Added by Phase 91 Plan 06 (SYNC-10).** The preceding sections cover the
one-shot OpenClaw→ClawCode cutover; this section covers the ongoing
workspace sync runner that keeps the ClawCode fin-acquisition mirror in
step with the OpenClaw source of truth (and, post-cutover, flips that
relationship).

Topology (verbatim from 91-CONTEXT.md):

- **ClawCode host (clawdy):** `clawcode@100.98.211.108` — runs the sync
  runner + translator under a systemd user account.
- **OpenClaw host:** `jjagpal@100.71.14.96` (Tailscale) — sync pulls from
  here.
- **Workspace source:** `~/.openclaw/workspace-finmentum/`
- **Workspace destination:** `/home/clawcode/.clawcode/agents/finmentum/`
- **Admin channel for conflict alerts:** `1494117043367186474`
  (admin-clawdy).

### A. SSH Key Provisioning

The sync runner runs as the `clawcode` systemd user on clawdy and pulls
via SSH from `jjagpal@100.71.14.96` over Tailscale. One-time provisioning.

1. Generate a dedicated sync key on clawdy (as the `clawcode` user, no
   passphrase because the key is unlocked by a systemd-started process):

   ```bash
   sudo -u clawcode bash -c 'ssh-keygen -t ed25519 \
     -f ~/.ssh/clawcode-sync \
     -C "clawcode-sync@clawdy" \
     -N ""'
   ```

   Expected output: `Your identification has been saved in
   /home/clawcode/.ssh/clawcode-sync` and a matching `.pub` file.

2. Copy the public key to the OpenClaw host's `authorized_keys`
   (`ssh-copy-id` would work if clawcode had an interactive TTY; this
   equivalent works without one):

   ```bash
   sudo -u clawcode cat /home/clawcode/.ssh/clawcode-sync.pub \
     | ssh jjagpal@100.71.14.96 \
       'mkdir -p ~/.ssh && chmod 700 ~/.ssh \
        && cat >> ~/.ssh/authorized_keys \
        && chmod 600 ~/.ssh/authorized_keys'
   ```

   Expected output: a single `jjagpal@100.71.14.96`'s password prompt the
   first time (interactive); thereafter, nothing. No errors.

3. Register the sync key as the default identity for the OpenClaw host in
   clawcode's SSH config (gives the runner a stable `openclaw-sync` alias
   — the bash wrapper in `scripts/sync/clawcode-sync.sh` is free to use
   either the alias or the literal hostname):

   ```bash
   sudo -u clawcode tee -a /home/clawcode/.ssh/config > /dev/null <<'EOF'

   Host openclaw-sync
       HostName 100.71.14.96
       User jjagpal
       IdentityFile ~/.ssh/clawcode-sync
       IdentitiesOnly yes
       StrictHostKeyChecking accept-new
       ServerAliveInterval 30
       ServerAliveCountMax 3
       ConnectTimeout 10
   EOF
   sudo chmod 600 /home/clawcode/.ssh/config
   ```

4. **Verify non-interactive SSH connectivity** (BatchMode prevents the
   client from ever prompting for a password — failure here means the
   key isn't trusted):

   ```bash
   sudo -u clawcode ssh -o BatchMode=yes openclaw-sync 'echo OK; hostname'
   # Expected: "OK" on the first line, OpenClaw hostname on the second.
   # If you see: "Permission denied (publickey)" → authorized_keys
   # wasn't written correctly on the remote; repeat step 2.
   ```

5. **Verify the session traverses Tailscale** (the remote should answer
   from a `100.x.x.x` IPv4; if it answers from a public IP, your DNS is
   wrong and traffic isn't on the VPN):

   ```bash
   sudo -u clawcode ssh openclaw-sync 'ip -4 addr show | grep -E "inet 100\\."'
   # Expected: "inet 100.71.14.96/32 ..." or similar Tailscale CIDR.
   ```

6. **Verify authorized_keys on the OpenClaw side** has exactly the key
   we just pushed (operator sanity — prevents stale keys piling up):

   ```bash
   sudo -u clawcode ssh openclaw-sync \
     'grep clawcode-sync@clawdy ~/.ssh/authorized_keys | wc -l'
   # Expected: 1 (exactly one matching entry).
   ```

**Failure modes:**

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Permission denied (publickey)` from step 4 | `authorized_keys` not updated | Re-run step 2; check remote `~/.ssh/authorized_keys` permissions are `600` |
| `BatchMode` output prompts for password | Key isn't in `authorized_keys` OR `IdentitiesOnly yes` missing from config | Re-check step 3 SSH config exists and key path is correct |
| Step 5 shows a non-`100.x` IP | Tailscale not connected on one side | `sudo tailscale status` on both hosts; reconnect with `sudo tailscale up` if needed |

### B. Systemd Timer Installation

Two user-systemd timers run on the `clawcode` account:

- `clawcode-sync.timer` → `clawcode-sync.service` — 5-minute workspace rsync
- `clawcode-translator.timer` → `clawcode-translator.service` — hourly
  conversation-turn translator (replays OpenClaw `sessions/*.jsonl` into
  ClawCode's ConversationStore)

1. Install the unit files (system-wide user-service location so every
   user account — including `clawcode` — picks them up):

   ```bash
   sudo install -m 644 /opt/clawcode/scripts/systemd/clawcode-sync.service       /etc/systemd/user/
   sudo install -m 644 /opt/clawcode/scripts/systemd/clawcode-sync.timer         /etc/systemd/user/
   sudo install -m 644 /opt/clawcode/scripts/systemd/clawcode-translator.service /etc/systemd/user/
   sudo install -m 644 /opt/clawcode/scripts/systemd/clawcode-translator.timer   /etc/systemd/user/
   ```

2. Ensure the wrapper scripts are executable (defensive — repo ships
   them `0755` but a cherry-pick or zip extract can strip the bit):

   ```bash
   sudo chmod +x /opt/clawcode/scripts/sync/clawcode-sync.sh
   sudo chmod +x /opt/clawcode/scripts/sync/clawcode-translator.sh
   ```

3. **Enable lingering** so user-systemd timers run without an active
   login session for `clawcode`:

   ```bash
   sudo loginctl enable-linger clawcode
   # Verify: loginctl show-user clawcode | grep Linger
   # Expected: Linger=yes
   ```

4. Reload user-systemd and enable + start both timers (run as the
   `clawcode` user — `XDG_RUNTIME_DIR` must point to their runtime dir):

   ```bash
   sudo -u clawcode XDG_RUNTIME_DIR=/run/user/$(id -u clawcode) \
     systemctl --user daemon-reload

   sudo -u clawcode XDG_RUNTIME_DIR=/run/user/$(id -u clawcode) \
     systemctl --user enable --now clawcode-sync.timer

   sudo -u clawcode XDG_RUNTIME_DIR=/run/user/$(id -u clawcode) \
     systemctl --user enable --now clawcode-translator.timer
   ```

5. **Verify both timers are armed**:

   ```bash
   sudo -u clawcode XDG_RUNTIME_DIR=/run/user/$(id -u clawcode) \
     systemctl --user list-timers --all | grep clawcode
   # Expected output (2 rows):
   #   ... 5min left   ...  clawcode-sync.timer       clawcode-sync.service
   #   ... 1h left     ...  clawcode-translator.timer clawcode-translator.service
   ```

6. **Tail the first real run** via the per-user journal (both services
   log to the journal via `StandardOutput=journal`):

   ```bash
   sudo -u clawcode XDG_RUNTIME_DIR=/run/user/$(id -u clawcode) \
     journalctl --user -u clawcode-sync.service -f -n 50
   ```

   Expected first-cycle behaviour: exit 0, no `failed-ssh`/`failed-rsync`
   outcome in `~/.clawcode/manager/sync.jsonl`. If the service exits 1
   with `flock-skip`, that's benign — a prior cycle is still in flight
   (rare on the first run; expected if you restarted the timer during a
   long initial sync).

7. **Verify the first sync.jsonl line** looks sane:

   ```bash
   sudo -u clawcode tail -n 1 /home/clawcode/.clawcode/manager/sync.jsonl \
     | jq '{ts: .timestamp, status, filesUpdated, bytes: .bytesTransferred}'
   # Expected: status="synced" (or "skipped-no-changes" on a second run),
   #           filesUpdated >= 0, bytes >= 0.
   ```

**Failure modes:**

| Symptom | Cause | Fix |
|---------|-------|-----|
| `list-timers` shows timers but "n/a" next run | `Persistent=false` + machine just booted; first `OnBootSec` hasn't elapsed yet | Wait 2min (sync) or 10min (translator) from boot — these are the `OnBootSec` warmups |
| Service exits immediately with "flock: No such file or directory" | Lock-dir missing | `sudo -u clawcode mkdir -p /home/clawcode/.clawcode/manager` |
| All cycles log `failed-ssh` | SSH key not provisioned (Section A skipped) | Complete Section A first |

### C. Sync Cutover Flip Procedure

Once Phase 90 Plan 07's channel-binding flip is in place (OpenClaw bot
silenced, ClawCode bot live in the channel), the OpenClaw workspace is
still the sync source of truth (`authoritativeSide = openclaw`). This
section flips that — ClawCode becomes authoritative, OpenClaw freezes.

**Pre-flight checklist** (every box must be checked):

- [ ] All sync cycles in the last hour are green — `/clawcode-sync-status`
      in admin-clawdy shows zero conflicts + `status: synced`.
- [ ] `/clawcode-sync-status` in admin-clawdy shows
      `authoritativeSide: openclaw` (this command flips it — shouldn't
      already be `clawcode`).
- [ ] Both systemd timers show active + successful last-run (Section B
      step 5 + 7).
- [ ] Ramy (operator) is notified the flip is happening in the next ~5
      minutes so he doesn't lose an OpenClaw-side edit in the drain.
- [ ] No active OpenClaw session on the fin-acquisition agent — SSH in
      and check: `ssh openclaw-sync 'ps -ef | grep -i "claude.*fin-acquisition" | grep -v grep'`
      should be empty.

**Flip sequence** (runs on clawdy as the clawcode user):

1. Invoke the cutover command — this performs D-17 drain-then-flip:

   ```bash
   sudo -u clawcode /opt/clawcode/dist/cli/index.js sync set-authoritative clawcode --confirm-cutover
   #
   # Internals:
   #   1. Reads sync-state.json; refuses if already authoritativeSide=clawcode.
   #   2. Runs one synchronous OpenClaw→ClawCode syncOnce() cycle.
   #   3. Prints SyncRunOutcome: {synced | skipped-no-changes | partial-conflicts
   #      | failed-ssh | failed-rsync}.
   #   4. If partial-conflicts → REFUSES to flip; prints "resolve first" hint.
   #   5. If synced/skipped → prompts "Drain complete. Flip authoritative
   #      to 'clawcode'? (y/N)"
   #   6. On 'y': atomically writes authoritativeSide=clawcode to
   #      sync-state.json (Phase 83 temp+rename pattern).
   #   7. On 'N' or abort: state unchanged, exit 0 (normal operator flow).
   ```

2. **Verify the flag flipped**:

   ```bash
   sudo -u clawcode jq .authoritativeSide \
     /home/clawcode/.clawcode/manager/sync-state.json
   # Expected: "clawcode"
   ```

3. **Verify the next 5-minute timer tick is a no-op** (reverse sync is
   opt-in per D-18; without the flag file, syncOnce returns
   `paused`):

   ```bash
   # Force a cycle now instead of waiting:
   sudo -u clawcode XDG_RUNTIME_DIR=/run/user/$(id -u clawcode) \
     systemctl --user start clawcode-sync.service

   # Inspect the latest sync.jsonl line:
   sudo -u clawcode tail -n 1 /home/clawcode/.clawcode/manager/sync.jsonl \
     | jq '{ts: .timestamp, status, reason}'
   # Expected: status="paused",
   #           reason="authoritative-is-clawcode-no-reverse-opt-in"
   ```

4. **Verify the OpenClaw workspace is now frozen**: touch a file on the
   OpenClaw side and confirm it does NOT propagate to clawdy:

   ```bash
   sudo -u clawcode ssh openclaw-sync \
     'touch ~/.openclaw/workspace-finmentum/CUTOVER-FROZEN-TEST.md'
   sleep 600  # wait ~10 minutes for 2 timer ticks
   sudo -u clawcode ls /home/clawcode/.clawcode/agents/finmentum/ \
     | grep -c CUTOVER-FROZEN-TEST.md
   # Expected: 0 (the file is NOT mirrored because sync is paused)

   # Clean up:
   sudo -u clawcode ssh openclaw-sync \
     'rm -f ~/.openclaw/workspace-finmentum/CUTOVER-FROZEN-TEST.md'
   ```

5. **(Optional) Opt into reverse sync** — ClawCode→OpenClaw mirroring so
   the OpenClaw workspace stays warm as a rollback target. D-18 says
   this is operator-opt-in:

   ```bash
   sudo -u clawcode /opt/clawcode/dist/cli/index.js sync start --reverse
   # Creates sentinel flag at ~/.clawcode/manager/reverse-sync-enabled.flag
   # Next timer tick will start running ClawCode→OpenClaw rsync.
   ```

   To disable reverse sync later:

   ```bash
   sudo -u clawcode /opt/clawcode/dist/cli/index.js sync stop
   ```

**Day-0 post-flip checklist:**

- [ ] `/clawcode-sync-status` in admin-clawdy reports
      `authoritativeSide: clawcode`.
- [ ] Next scheduled cycle logs `status: paused` (or `status: synced` if
      reverse sync was enabled in step 5).
- [ ] Operator runs `clawcode sync status | jq '.conflictCount'` →
      expected `0`.

**Failure modes:**

| Symptom | Cause | Fix |
|---------|-------|-----|
| `--confirm-cutover` refuses with "Drain produced conflicts" | One or more files diverged during the drain | Resolve with `clawcode sync resolve <path> --side openclaw` (or `clawcode`); re-run |
| `--confirm-cutover` aborts with "already authoritativeSide=clawcode" | Flip already happened | Verify with step 2; if this is a re-run, skip this section |
| Flag flipped but step 3 shows cycles still syncing | Reverse sync was already enabled before flip | `sudo -u clawcode ls /home/clawcode/.clawcode/manager/reverse-sync-enabled.flag` — if present, this is expected |

### D. 7-Day Rollback Window Checklist

For 7 days post-cutover, the OpenClaw workspace remains frozen as a
rollback target. This is the window where `clawcode sync
set-authoritative openclaw --revert-cutover` is a clean, non-destructive
operation; after Day 7 it requires `--force-rollback` and warns about
data loss.

**Daily canary** (perform on Day 1, 3, 5, and 7):

- [ ] `/clawcode-sync-status` in admin-clawdy shows
      `authoritativeSide: clawcode`, `conflictCount: 0`, last cycle
      `status: paused` (or `synced` if reverse sync is on).
- [ ] Spot-check a live session flow — ask fin-acquisition via Discord a
      question about a recent client, verify the answer cites content
      from a recent `memory/YYYY-MM-DD-*.md` file.
- [ ] Check uploads growth (new Discord attachments Ramy drops in):

  ```bash
  du -sh /home/clawcode/.clawcode/agents/finmentum/uploads/discord
  ```

- [ ] Spot-check journal for repeated errors:

  ```bash
  sudo -u clawcode XDG_RUNTIME_DIR=/run/user/$(id -u clawcode) \
    journalctl --user -u clawcode-sync.service -n 50 --since "24 hours ago" \
    | grep -Ei 'error|warn' | head -20
  ```

- [ ] If reverse sync is enabled (per Section C step 5), verify the
      OpenClaw-side reflection of a recent ClawCode edit:

  ```bash
  # On ClawCode side — touch a known-safe file:
  sudo -u clawcode touch /home/clawcode/.clawcode/agents/finmentum/memory/rollback-canary.md

  # Wait one 5-minute timer tick + a bit:
  sleep 360

  # Verify reflection on OpenClaw:
  sudo -u clawcode ssh openclaw-sync \
    'ls ~/.openclaw/workspace-finmentum/memory/rollback-canary.md'
  # Expected: the file exists on OpenClaw side.

  # Clean up:
  rm /home/clawcode/.clawcode/agents/finmentum/memory/rollback-canary.md
  ```

**If rollback needed within 7 days** (something is broken on ClawCode
side and OpenClaw needs authority back):

```bash
# 1. Revert the sync cutover flag:
sudo -u clawcode /opt/clawcode/dist/cli/index.js sync set-authoritative openclaw --revert-cutover
# Internals:
#   - Validates current authoritativeSide=clawcode.
#   - Validates < 7 days since the cutover timestamp.
#   - Prints an advisory about stopping reverse sync first (does NOT
#     auto-stop it — operator decides; see D-19 in 91-CONTEXT.md).
#   - Atomically writes authoritativeSide=openclaw.

# 2. Stop reverse sync if it was enabled:
sudo -u clawcode /opt/clawcode/dist/cli/index.js sync stop

# 3. Re-arm the forward (OpenClaw→ClawCode) timer — already enabled; the
#    next tick will detect authoritativeSide=openclaw and resume real
#    sync cycles. No action needed.

# 4. Flip the OpenClaw Discord channel binding back (refer to
#    Section "OpenClaw Channel Config Flip" above — reverse the jq
#    edit so OpenClaw owns the channel again).
```

**Day-7 finalize prompt** — after 7 days, close the book on the OpenClaw
side:

```bash
sudo -u clawcode /opt/clawcode/dist/cli/index.js sync finalize
# Internals:
#   - If <7 days elapsed: rejected with "X days remain in rollback window"
#     (unless --force is passed — operator escape hatch).
#   - If >=7 days: prompts "7-day rollback window closed. Print the
#     manual archive command? (y/N)"
#   - On 'y': prints the exact ssh command to archive the frozen
#     OpenClaw mirror — NEVER auto-deletes. Operator reviews then runs
#     the command by hand.
#   - Example printed command:
#       ssh openclaw-sync 'mv ~/.openclaw/workspace-finmentum \
#           ~/.openclaw/workspace-finmentum.archived-YYYYMMDD'
```

**After Day 7 — rollback still possible with `--force-rollback`**:

```bash
sudo -u clawcode /opt/clawcode/dist/cli/index.js sync set-authoritative openclaw --force-rollback
# Use ONLY if something is broken on ClawCode side AND the 7-day window
# has expired. Expect data loss for ClawCode-side edits since cutover
# that never reached OpenClaw (because reverse sync was off, or because
# the operator disabled it partway through the window).
```

**Failure modes:**

| Symptom | Cause | Fix |
|---------|-------|-----|
| `--revert-cutover` rejected with "X days remain" | Attempt was within the window but clock skew or cutover timestamp confusion | Verify with `jq .cutoverStartedAt sync-state.json`; if genuinely within window, re-try |
| `--revert-cutover` rejected with "7-day window expired" | More than 7 days elapsed | Use `--force-rollback` (accepts data loss) |
| `sync finalize` prompts but the printed command fails | OpenClaw-side permissions / path changed | Run the command as root on OpenClaw: `sudo mv ...` |

### E. Operator-Observable Logs & Common Failure Modes

**Log locations** — where to look for what:

| What | Where |
|------|-------|
| Per-cycle structured summary | `/home/clawcode/.clawcode/manager/sync.jsonl` |
| Current sync state snapshot | `/home/clawcode/.clawcode/manager/sync-state.json` |
| Conversation-translator cursor | `/home/clawcode/.clawcode/manager/conversation-translator-cursor.json` |
| Reverse-sync opt-in flag | `/home/clawcode/.clawcode/manager/reverse-sync-enabled.flag` (present = enabled) |
| Sync service journal | `sudo -u clawcode XDG_RUNTIME_DIR=/run/user/$(id -u clawcode) journalctl --user -u clawcode-sync.service` |
| Translator service journal | `sudo -u clawcode XDG_RUNTIME_DIR=/run/user/$(id -u clawcode) journalctl --user -u clawcode-translator.service` |
| Discord status surface | `/clawcode-sync-status` in admin-clawdy (channel `1494117043367186474`) |
| Conflict alerts | Bot-direct embeds in admin-clawdy (Phase 90.1 pattern) |
| rsync filter spec | `/opt/clawcode/scripts/sync/clawcode-sync-filter.txt` (17 include + 21 exclude rules; pinned by the SYNC-10 regression test) |

**Quick health check** (one-liner — paste into a shell on clawdy as the
clawcode user):

```bash
sudo -u clawcode jq -c 'select(.timestamp > (now - 3600 | todate)) \
    | {ts: .timestamp, status, conflicts: (.conflicts // [] | length), \
       filesUpdated, bytes: .bytesTransferred}' \
  /home/clawcode/.clawcode/manager/sync.jsonl \
  | tail -20
```

Expected shape — one line per cycle in the last hour, each with a
status, conflict count, files touched, and bytes transferred.

**Common failure modes:**

| Symptom | Likely cause | Remediation |
|---------|--------------|-------------|
| `sync.jsonl` status=`failed-ssh` | Tailscale down / OpenClaw host unreachable | `sudo -u clawcode ssh openclaw-sync hostname` — if fails, `sudo tailscale status` on both ends |
| Cycles stuck at `failed-rsync` exitCode=23 | Partial transfer / permission issue on destination | `sudo -u clawcode ls -la /home/clawcode/.clawcode/agents/finmentum/` — verify clawcode owns everything; fix with `sudo chown -R clawcode:clawcode ...` |
| admin-clawdy spammed with conflict alerts | Operator edited both sides — expected during the cutover transition | Review conflicts with `clawcode sync status | jq .conflicts`; resolve with `clawcode sync resolve <path> --side openclaw` (or `clawcode`) one at a time |
| Translator cursor missing / corrupt | First run OR prior crash | Delete `conversation-translator-cursor.json`; translator starts from line 0 next hourly cycle — idempotent via Phase 80 `origin_id UNIQUE` constraint |
| `/clawcode-sync-status` command times out in Discord | Daemon not running or IPC socket missing | `sudo systemctl --user status clawcode` (on clawdy); restart with `sudo systemctl --user restart clawcode` |
| Unit file changed but `systemctl --user` still shows old config | Forgot `daemon-reload` after editing | `sudo -u clawcode XDG_RUNTIME_DIR=/run/user/$(id -u clawcode) systemctl --user daemon-reload` |
| `list-timers` shows the right services but they never fire | Lingering not enabled | Re-run Section B step 3 (`loginctl enable-linger clawcode`) |

**Emergency pause** — stop sync entirely without flipping authority (e.g.
during OpenClaw maintenance window):

```bash
sudo -u clawcode XDG_RUNTIME_DIR=/run/user/$(id -u clawcode) \
  systemctl --user stop clawcode-sync.timer clawcode-translator.timer
```

Resume when maintenance is done:

```bash
sudo -u clawcode XDG_RUNTIME_DIR=/run/user/$(id -u clawcode) \
  systemctl --user start clawcode-sync.timer clawcode-translator.timer
```

**Manual one-off cycle** (operator wants to force-sync NOW, not wait for
the 5-minute timer):

```bash
sudo -u clawcode /opt/clawcode/dist/cli/index.js sync run-once
# Exits 0 on synced/skipped/partial/paused.
# Exits 1 on failed-ssh/failed-rsync/throw.
# Appends one line to sync.jsonl either way.
```

**Reading the filter spec** — the exclude list (`*.sqlite`,
`sessions/**`, `.git`, editor snapshots, etc.) is pinned in
`scripts/sync/clawcode-sync-filter.txt` AND asserted by
`src/sync/__tests__/exclude-filter-regression.test.ts`. Do NOT edit the
filter file without reading the regression test — removing an exclude
there will leak `.sqlite` files or session jsonl onto the destination
and CI will catch it.

---

*Phase 91 sections added by Plan 06 (SYNC-10). Runbook is now a live
operator document; Phase 91 sync work is complete on Day-7 after
operator runs `clawcode sync finalize`.*
