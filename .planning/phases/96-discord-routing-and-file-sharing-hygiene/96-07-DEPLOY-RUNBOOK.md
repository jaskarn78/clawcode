# Phase 96 Deploy Runbook — Operator Procedure

**Plan:** 96-07
**Production target:** clawdy server (`jjagpal@100.98.211.108`)
**NOT this dev box.** Tara PDFs may exist locally for development reference, but the production agent runs on clawdy.
**Deploy outcome:** D-01 / D-03 / D-13 / D-14 honored; UAT-95 Tara-PDF E2E acceptance smoke test validates Phase 96 end-to-end.

---

## Scope

Deploy Phase 96 (filesystem capability awareness, ACL-driven file sharing, OpenClaw-fallback prohibition, Phase 91 mirror deprecation) to clawdy production server. Validate via UAT-95 Tara-PDF smoke test in `#finmentum-client-acquisition` Discord channel.

**D-01 boot probe APPROXIMATION:** No separate session-start probe code path exists. Boot coverage is achieved via the **TWO-STEP** combination of:
1. **Section 4 (this runbook)** — mandatory fleet-wide `clawcode probe-fs <agent>` per agent, immediately post-redeploy.
2. **First 60s heartbeat tick** — `fs-probe` check (96-07 Task 1) fires on every agent within 60s of daemon start.

Together, Steps 4 + heartbeat tick eliminate the boot-window stale-belief gap. **Skipping Section 4 breaks D-01 coverage and risks UAT-95 false-negative** (smoke test running within the boot's 60s heartbeat-stale window).

---

## Section ordering — BLOCKED-BY relationships

| Step | Title | BLOCKED-BY |
|------|-------|------------|
| 1    | Clawdy-side prerequisites verification | — (always first) |
| 2    | clawcode.yaml edit | Step 1 (prereqs must pass first) |
| 3    | Daemon redeploy | Step 2 |
| 4    | **MANDATORY** fleet-wide probe | Step 3 (daemon must be ready) |
| 5    | clawcode sync disable-timer | Step 3 (independent of Step 4; can run in parallel) |
| 6    | **UAT-95** Tara-PDF smoke test | **Step 4** (must complete fleet probe before smoke test — see RESEARCH.md Risk 1) |
| 7    | Phase 91 sync mirror cleanup verification | Step 5 |
| 8    | /clawcode-status fleet verification | Step 6 (smoke test passes first) |
| 9    | Rollback procedure | Triggered ONLY if Step 6 fails |

---

## Section 1 — Clawdy-side prerequisites verification

**Prerequisite:** SSH access to clawdy as `jjagpal`.

**Risk addressed:** RESEARCH.md Pitfall 2 + Pitfall 6 (production target is clawdy server, NOT dev box; clawcode user / ACLs / relaxed systemd unit don't exist on dev).

```bash
# SSH to production target
ssh jjagpal@100.98.211.108

# 1.1 — clawcode user exists and is in the jjagpal group
id clawcode | grep -q jjagpal
echo "1.1 clawcode in jjagpal group: $?"  # MUST exit 0

# 1.2 — ACLs grant clawcode rwX on the operator-shared workspace
getfacl /home/jjagpal/.openclaw/workspace-finmentum/ 2>/dev/null | grep -q "user:clawcode:rwx"
echo "1.2 ACL clawcode:rwx: $?"  # MUST exit 0

# 1.3 — clawcode systemd unit relaxed (no ProtectHome=tmpfs)
# The grep -v ensures we DON'T find tmpfs-mode ProtectHome
systemctl cat clawcode 2>/dev/null | grep -E "^ProtectHome=" | grep -v "ProtectHome=tmpfs"
SYSTEMD_PROTECT_OK=$?
# Either ProtectHome= is unset entirely (no match), or set to a non-tmpfs value.
echo "1.3 systemd ProtectHome NOT tmpfs: $SYSTEMD_PROTECT_OK (0 means a non-tmpfs ProtectHome line was found OR no matching ProtectHome line at all)"

# 1.4 — Tara PDFs exist (UAT-95 source artifacts)
test -f /home/jjagpal/.openclaw/workspace-finmentum/clients/tara-maffeo/tara-maffeo-financial-worksheet-apr24.pdf
echo "1.4a Tara financial worksheet exists: $?"  # MUST exit 0

test -f /home/jjagpal/.openclaw/workspace-finmentum/clients/tara-maffeo/tara-maffeo-speech-coaching-apr24.pdf
echo "1.4b Tara speech coaching exists: $?"  # MUST exit 0
```

**Expected:** all `echo` lines report `0`.

**Failure mitigation:**
- 1.1 fails → `sudo usermod -aG jjagpal clawcode` (then re-test)
- 1.2 fails → `sudo setfacl -R -m u:clawcode:rwX /home/jjagpal/.openclaw/workspace-finmentum/` + `sudo setfacl -R -d -m u:clawcode:rwX /home/jjagpal/.openclaw/workspace-finmentum/` (default ACL for new files)
- 1.3 fails → edit `/etc/systemd/system/clawcode.service` (or `~/.config/systemd/user/clawcode.service`), remove `ProtectHome=tmpfs` (or set to `false`), `systemctl daemon-reload`
- 1.4 fails → operator must copy missing PDFs to the expected paths (or place test fixtures there)

**STOP if any prereq fails.** Do NOT proceed to Section 2 until ALL prereqs pass. Premature deploy with missing prereqs causes UAT-95 to fail with EACCES — confusing operator + wasted time.

---

## Section 2 — clawcode.yaml edit

**Prerequisite:** Section 1 passes.

Edit clawcode.yaml on clawdy (path: `/opt/clawcode/clawcode.yaml` per memory note `reference_clawcode_server.md`):

```yaml
defaults:
  # Phase 96 D-05 — fleet-wide own-workspace default
  # The {agent} token is preserved literally and resolved by the loader's
  # resolveFileAccess(agentName, ...) helper at probe time.
  fileAccess:
    - "/home/clawcode/.clawcode/agents/{agent}/"

  # Phase 96 D-09 — fleet-wide dated-output template
  # Tokens resolved by resolveOutputDir(template, ctx) at write time:
  #   {date} → YYYY-MM-DD
  #   {agent} → agent name
  #   {channel_name} → current Discord channel slug
  #   {client_slug} → from conversation context (LLM-filled)
  outputDir: "outputs/{date}/"

agents:
  - name: fin-acquisition
    # ... existing fields preserved ...
    # Phase 96 D-05 — operator-shared workspace via ACL
    fileAccess:
      - "/home/jjagpal/.openclaw/workspace-finmentum/"
    # Phase 96 D-09 — client-organized output
    outputDir: "clients/{client_slug}/{date}/"

  # ... other agents unchanged (defaults.fileAccess + defaults.outputDir
  # apply automatically via additive-optional schema) ...
```

**Verification:** YAML still parses (no daemon restart needed yet — config-watcher will pick up the edit at Section 3 redeploy):

```bash
# On clawdy
clawcode config validate /opt/clawcode/clawcode.yaml
echo "2 yaml validates: $?"  # MUST exit 0
```

**Failure:** `clawcode config validate` exits non-zero → revert the edit, fix syntax, re-validate.

---

## Section 3 — Daemon redeploy

**Prerequisite:** Section 2 passes.

Phase 96 deploys via daemon redeploy. **No agent restart required** (D-13 invariant: in-flight session migration via auto-refresh on next heartbeat tick).

```bash
# On clawdy — pull latest code, restart systemd-managed daemon
cd /opt/clawcode
sudo systemctl restart clawcode  # or `systemctl --user restart clawcode` per install
sleep 5  # allow daemon to come up

# Verify daemon started clean
sudo systemctl status clawcode | grep -E "Active: active|Active: running"
echo "3 daemon active: $?"  # MUST exit 0

# Verify daemon log shows clean startup (no Phase 96 schema validation errors)
sudo journalctl -u clawcode --since "30s ago" | grep -E "ERROR|FATAL|panic" || echo "3 no startup errors"
```

**Expected:** `Active: active (running)` + no ERROR/FATAL entries in last 30s.

**D-13 cache cost:** Stable-prefix hash changes once per agent on Phase 96 deploy → ONE Anthropic cache miss per agent → cache re-stabilizes on subsequent turns. Acceptable cost (Phase 94 D-04 same trade-off).

---

## Section 4 — **MANDATORY** post-deploy fleet-wide on-demand probe

**Prerequisite:** Section 3 passes (daemon must be ready).

**Risk addressed:** RESEARCH.md Risk 1 — without this section, agents have ≤60s of stale capability state on Phase 96 deploy → UAT-95 (Section 6) may fail on first attempt within the heartbeat-stale window.

**This section APPROXIMATES the D-01 boot probe.** No separate session-start code path exists; instead, the deploy runbook makes the fleet probe **mandatory** before UAT-95.

```bash
# On clawdy, for every agent in the fleet — eliminates the 60s stale window
for agent in fin-acquisition fin-tax admin-clawdy clawdy code-clawdy; do
  echo "=== probing $agent ==="
  clawcode probe-fs "$agent"
  PROBE_EXIT=$?
  echo "4 probe-fs $agent exit: $PROBE_EXIT"
  if [ "$PROBE_EXIT" -ne 0 ]; then
    echo "FAILED: $agent — fix before proceeding to Section 6"
  fi
done
```

**Expected:** every agent's probe exits 0; output shows the probed paths + ready/degraded counts.

**Failure mitigation:**
- Probe exits non-zero for an agent → check `clawcode fs-status -a <agent>` for the verbatim error
- If error mentions `EACCES` → re-verify Section 1 prereqs (ACL/group/ProtectHome may have regressed)
- If error mentions `ENOENT` → re-verify the path exists (Section 1.4)
- If error mentions IPC/socket → daemon may not be fully warm; `sleep 30` and re-run

> **MANDATORY:** Section 6 (UAT-95) is **BLOCKED-BY** Section 4 — do NOT proceed to Section 6 until every agent in the fleet has been probed successfully via this section.

---

## Section 5 — clawcode sync disable-timer (Phase 91 mirror deprecation)

**Prerequisite:** Section 3 passes (independent of Section 4; can run in parallel).

Per Phase 96 D-11 (96-06): disable the Phase 91 5-minute systemd sync timer; sync-state.json `authoritativeSide` flips to `deprecated` with `deprecatedAt` ISO timestamp; 7-day rollback window honored.

```bash
# On clawdy
clawcode sync disable-timer
echo "5 disable-timer exit: $?"  # MUST exit 0

# Verify deprecation surface
clawcode sync status
# Expected output includes:
#   authoritativeSide: deprecated
#   deprecatedAt: <ISO timestamp>
#   rollback window: ~7 days remaining
```

**Failure:** non-zero exit → see `clawcode sync status` for diagnostic; if systemctl unit absent, the command logs warning + exits 0 gracefully (Phase 96 D-11 + RESEARCH.md Pitfall 6 — dev box graceful degradation).

---

## Section 6 — UAT-95 Tara-PDF smoke test

> **BLOCKED-BY:** Section 4 (fleet-wide probe) — operator MUST complete fleet probe before running this smoke test. Skipping Section 4 risks running smoke test within boot's 60s heartbeat-stale window, producing a false-negative result.

**Prerequisite:** Section 4 passes (every agent's fleet probe exited 0). VERIFY this BEFORE proceeding.

**Verification before starting:**
```bash
# Re-confirm fleet probe completion — NO probe should report failure
for agent in fin-acquisition fin-tax admin-clawdy clawdy code-clawdy; do
  clawcode fs-status -a "$agent" | grep -q "ready"
  echo "6-pre $agent fs-status has ready: $?"  # MUST exit 0 for the agents we care about
done
```

If any agent doesn't show `ready` paths → **STOP**. Re-run Section 4. Do NOT run smoke test until fleet is fully probed.

### UAT-95 step-by-step (operator-driven in Discord)

**Channel:** `#finmentum-client-acquisition`
**Test artifacts:** `tara-maffeo-financial-worksheet-apr24.pdf` + `tara-maffeo-speech-coaching-apr24.pdf` at `/home/jjagpal/.openclaw/workspace-finmentum/clients/tara-maffeo/`

**Test 6.1 — financial worksheet:**

1. Operator types in `#finmentum-client-acquisition`:
   > Send me Tara Maffeo's financial worksheet PDF.

2. Expected agent (Clawdy, fin-acquisition) behavior:
   - Reads `/home/jjagpal/.openclaw/workspace-finmentum/clients/tara-maffeo/tara-maffeo-financial-worksheet-apr24.pdf` via 96-01 boundary check (cached snapshot says ready, mode=ro)
   - Calls `clawcode_share_file({path: "<absolute path>"})` (96-04 — outputDir-aware; for absolute path inside fileAccess, passthrough; webhook upload via Phase 1.6)
   - Posts CDN URL inline in Discord
   - **NO mention of "not accessible from my side"**
   - **NO recommendation to use OpenClaw fallback**

3. Operator clicks the CDN URL — PDF downloads + opens. ✓

**Test 6.2 — speech coaching:**

4. Operator types in `#finmentum-client-acquisition`:
   > Send me Tara Maffeo's speech coaching PDF.

5. Expected agent behavior: identical to Test 6.1 with the speech-coaching PDF.

6. Operator clicks the CDN URL — PDF downloads + opens. ✓

### Pass criteria

ALL of the following:
- ✓ Section 4 fleet probe complete (verified above)
- ✓ Both PDFs upload successfully
- ✓ Agent NEVER says "not accessible" / "from my side" / "I cannot access"
- ✓ Agent NEVER suggests OpenClaw fallback / "the OpenClaw side" / "OpenClaw agent"
- ✓ /clawcode-status fin-acquisition shows the workspace-finmentum path as `ready (RO)` (Section 8)
- ✓ clawcode sync status reports `authoritativeSide: deprecated` (Section 5)

### Fail criteria

ANY of the above conditions not met. If smoke test fails:

1. **Capture diagnostic data:**
   - Discord transcript (copy the bot's exact reply)
   - Agent prompt: `clawcode prompt-snapshot fin-acquisition` (or equivalent)
   - Capability snapshot: `clawcode fs-status -a fin-acquisition`
   - Heartbeat log: `tail -50 ~/.clawcode/agents/fin-acquisition/memory/heartbeat.log`

2. **Triage:**
   - If Section 4 was skipped → re-run Section 4, then re-attempt Test 6.1 ONCE
   - If agent says "not accessible" but capability snapshot shows ready → check stable-prefix re-render: was the system prompt actually refreshed since deploy? Force restart: `clawcode restart fin-acquisition` (one-time; D-13 should not require this in steady state)
   - If agent recommends OpenClaw fallback → check `defaults.systemPromptDirectives.file-sharing` in clawcode.yaml — was the 2026-04-25 update (96-CONTEXT.md D-10 second paragraph) deployed? Re-verify with `clawcode prompt-snapshot fin-acquisition | grep -i "openclaw"` (should NOT find recommendation language)
   - If agent says "EACCES" or filesystem error → re-verify Section 1 prereqs

3. **Rollback:** if smoke test still fails after triage → execute Section 9 (rollback procedure)

---

## Section 7 — Phase 91 sync mirror cleanup verification

**Prerequisite:** Section 5 passes.

**Critical:** Do NOT delete the Phase 91 mirror destination directory. Per Phase 91 plan 06 finalize semantics + Phase 96 D-11 (96-06), the directory must remain intact for the 7-day rollback window. Operator can `rm -rf` after 7 days.

```bash
# On clawdy — confirm mirror destination intact
du -sh /home/clawcode/.clawcode/agents/finmentum-mirror/ 2>/dev/null || \
  echo "WARN: mirror destination not found at expected path (may differ per install)"
echo "7 mirror destination preserved (size shown above)"
```

**Expected:** `du -sh` reports a non-zero size (~513MB at last measurement per 96-CONTEXT.md). Directory intact.

**Failure:** if directory missing or size suspiciously small (< 10MB) → operator may have prematurely deleted; rollback (Section 9) requires the mirror destination. **STOP** and investigate before proceeding.

---

## Section 8 — /clawcode-status fleet verification

**Prerequisite:** Section 6 passes.

In Discord, run `/clawcode-status -a fin-acquisition` (admin-only via Phase 85 admin gate). The Capability section (96-05 renderCapabilityBlock + 96-02 renderFilesystemCapabilityBlock single-source-of-truth renderer) should display:

```
## Filesystem Capability

### My workspace (full RW)
- /home/clawcode/.clawcode/agents/fin-acquisition/ ✓ ready (rw)

### Operator-shared paths (per ACL)
- /home/jjagpal/.openclaw/workspace-finmentum/ ✓ ready (ro)

### Off-limits — do not attempt
- (anything outside the above)
```

Plus operator-friendly diagnostic suffix listing degraded paths with lastProbeAt freshness signal (none expected post-Phase-96 if Sections 1-6 succeeded).

**Repeat for each agent:** `/clawcode-status -a fin-tax`, `/clawcode-status -a admin-clawdy`, etc. Every agent's Capability section should render with their respective fileAccess paths.

**Failure:** Capability section missing or degraded → check `clawcode fs-status -a <agent>` for verbatim probe errors; re-run Section 4 for the affected agent.

---

## Section 9 — Rollback procedure

**Trigger:** Section 6 (UAT-95) fails after triage; OR critical regression detected post-deploy.

**Window:** 7 days from `deprecatedAt` timestamp (per Phase 91 plan 06 finalize + Phase 96 D-11). After 7 days, `clawcode sync re-enable-timer` errors out with deadline-exceeded.

```bash
# On clawdy — within 7-day window of Section 5

# 9.1 — Re-enable the Phase 91 sync timer (restores file-mirror)
clawcode sync re-enable-timer
echo "9.1 re-enable-timer exit: $?"  # MUST exit 0

# 9.2 — Verify systemctl status
sudo systemctl status clawcode-sync-finmentum.timer | grep -E "Active: active"
echo "9.2 sync timer active: $?"  # MUST exit 0

# 9.3 — Revert clawcode.yaml fileAccess + outputDir edits
sudo cp /opt/clawcode/clawcode.yaml.pre-phase-96.bak /opt/clawcode/clawcode.yaml  # if backup taken
# OR: manually remove the defaults.fileAccess / defaults.outputDir / per-agent
# fileAccess / outputDir blocks added in Section 2

clawcode config validate /opt/clawcode/clawcode.yaml
echo "9.3 yaml validates after revert: $?"

# 9.4 — Restart daemon to pick up reverted config
sudo systemctl restart clawcode
sleep 5
sudo systemctl status clawcode | grep -E "Active: active"
echo "9.4 daemon restarted clean: $?"

# 9.5 — Verify Phase 91 mirror sync resumes (next 5min tick)
sleep 310  # one full sync cycle
clawcode sync status
# Expected: authoritativeSide: openclaw (or whatever the pre-Phase-96 value was)
echo "9.5 sync status restored to pre-Phase-96 state"
```

**File a Phase 96 gap-closure issue** documenting the failure cause (capability snapshot output, agent prompt diff, Discord transcript). Phase 96 deploy is SUSPENDED pending fix.

---

## Post-deploy reporting

After successful UAT-95 (Section 6 pass criteria all ✓), report back with:

```
PHASE 96 UAT-95 RESULT: PASSED
- Section 1 prereqs: ✓
- Section 2 yaml edit: ✓
- Section 3 daemon redeploy: ✓
- Section 4 fleet probe (MANDATORY): ✓ for [N] agents
- Section 5 sync disable-timer: ✓
- Section 6 UAT-95 Tara-PDF E2E:
    - 6.1 financial worksheet: ✓ uploaded as <CDN URL>
    - 6.2 speech coaching: ✓ uploaded as <CDN URL>
- Section 7 mirror destination preserved: ✓ (<size>)
- Section 8 /clawcode-status Capability section: ✓ for [N] agents
- 60s stale-window mitigated via Section 4

Phase 96 deploy COMPLETE. ClawCode now reads operator-shared workspaces
via ACL; OpenClaw mirror deprecated (7-day rollback window open until
<deprecatedAt + 7d>).
```

---

*Phase: 96-discord-routing-and-file-sharing-hygiene*
*Plan: 07*
*Last updated: 2026-04-25*
