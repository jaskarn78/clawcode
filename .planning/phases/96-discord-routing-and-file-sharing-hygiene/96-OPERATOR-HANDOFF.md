# Phase 96 — Operator Handoff (Deploy + UAT-95)

**Status:** Code pushed to GitHub (commit `d7eb3d4`). Pulled + built on clawdy (`/opt/clawcode/dist/cli/index.js` includes 12 Phase 96 symbol refs + 2 D-10 directive matches). Awaiting operator-privileged ops.

**What I did autonomously:**
- Pushed 45 commits to `origin/master`
- SSH'd to `jjagpal@100.98.211.108`
- Ran `git pull origin master` + `npm ci` + `npm run build` in `/opt/clawcode/`
- Verified Phase 96 code bundled into the daemon binary
- Adapted UAT-95 target (Tara PDFs don't exist on clawdy; substituting with `finmentum-gs-analysis-apr25.pdf` which IS present)

**What I'm blocked on:**
- `sudo systemctl restart clawcode` — needs password
- Editing `/etc/clawcode/clawcode.yaml` — owned by `clawcode:clawcode`, needs sudo or sudo -u clawcode

---

## Operator Steps (in order)

### Step 1 — Restart daemon to load the new build

```bash
ssh jjagpal@100.98.211.108
sudo systemctl restart clawcode
sudo systemctl status clawcode | head -15   # verify Active: active (running)
```

Wait ~10s for the warm-path to complete. Phase 89 restart-greeting will fire once per agent — that's expected.

### Step 2 — Edit clawcode.yaml to add `fileAccess` for fin-acquisition

```bash
sudo nano /etc/clawcode/clawcode.yaml
```

Find the `fin-acquisition` agent block (line ~344). After the existing `memoryPath: /home/clawcode/.clawcode/agents/finmentum/memory/fin-acquisition` line (~line 434, the last line of the agent block before `- name: recol-demo`), insert these 4 lines:

```yaml
  fileAccess:
  - /home/clawcode/.clawcode/agents/finmentum/
  - /home/jjagpal/.openclaw/workspace-finmentum/
```

Save. Optionally also add fleet-wide default in the `defaults:` block:

```yaml
defaults:
  # ... existing fields ...
  fileAccess:
  - /home/clawcode/.clawcode/agents/{agent}/
```

(The `{agent}` token is intentional — it's resolved per-agent at runtime by `resolveFileAccess`.)

### Step 3 — Hot-reload picks up fileAccess change

The Phase 96 config-watcher extends `RELOADABLE_FIELDS` to include `fileAccess` + `outputDir` — so editing the yaml triggers a re-probe automatically within ~5s. No second restart needed.

### Step 4 — MANDATORY fleet probe (deploy-runbook Section 4)

This approximates D-01's "boot probe" (no separate code path; runbook Section 4 + 60s heartbeat tick together cover the boot window).

```bash
clawcode probe-fs fin-acquisition
```

Expected output: capability snapshot showing both paths as `ready` with `mode=rw` (own workspace) and `mode=ro` (operator-shared, since clawcode is in jjagpal group + group::r-x is set).

If `/home/jjagpal/.openclaw/workspace-finmentum/` shows `degraded` or `unknown`:
- ACL is grant via group membership only (no explicit `user:clawcode` ACL)
- `clawcode` user IS in `jjagpal` group, `group::r-x` is set → should work
- If still failing, run `getfacl -R /home/jjagpal/.openclaw/workspace-finmentum/ | head -10` and report

### Step 5 — Verify clawcode-status shows Capability section

```bash
clawcode fs-status -a fin-acquisition
```

OR in Discord (any channel where you have admin access):

```
/clawcode-status fin-acquisition
```

Expected: an EmbedBuilder reply with a "Capability" section listing both paths as ✓ ready.

### Step 6 — UAT-95 ADAPTED smoke test (BLOCKED-BY Step 4)

**Target file changed:** Tara PDFs don't exist on clawdy. Adapted target:
`/home/jjagpal/.openclaw/workspace-finmentum/research/finmentum-gs-analysis-apr25.pdf`

In Discord `#finmentum-client-acquisition`:

```
Send me the finmentum Goldman Sachs analysis PDF from research/.
```

**Expected behavior (post Phase 96):**
1. Agent resolves the path via `clawcode_list_files({path: "/home/jjagpal/.openclaw/workspace-finmentum/research/"})`
2. Reads file via Read tool (boundary check passes — fileAccess allowlist covers the path)
3. Calls `clawcode_share_file({path: "/home/jjagpal/.openclaw/workspace-finmentum/research/finmentum-gs-analysis-apr25.pdf"})`
4. Posts the Discord CDN URL inline
5. **NO** "not accessible from my side" message
6. **NO** recommendation to "spawn subagent on OpenClaw side" (D-10 directive prohibits this)

**If the agent says "not accessible":**
- Phase 96 D-02 wiring may not be threading the snapshot
- Run `clawcode probe-fs fin-acquisition` again
- Check `journalctl -u clawcode -f` for `fs-probe` lines

**If the agent recommends OpenClaw fallback:**
- Phase 96 D-10 directive isn't reaching the LLM prompt
- Check `cat /opt/clawcode/clawcode.yaml.local 2>/dev/null` and `grep "NEVER recommend falling back" /etc/clawcode/clawcode.yaml` (should be 0 matches in yaml — directive is bundled in code, NOT in yaml)
- The directive is in `DEFAULT_SYSTEM_PROMPT_DIRECTIVES['file-sharing']` baked into the daemon. If LLM doesn't see it, the directive plumbing is broken.

### Step 7 — Phase 91 mirror deprecation (96-06)

```bash
clawcode sync disable-timer
```

Expected: idempotent — sets sync `authoritativeSide: deprecated`, disables systemd timer, opens 7-day rollback window.

### Step 8 — Verify with `/clawcode-status` fleet-wide

In Discord: `/clawcode-status` (no agent arg) — should show all agents with their Capability sections.

---

## Rollback (within 7-day window)

If Phase 96 causes regressions:

```bash
ssh jjagpal@100.98.211.108
clawcode sync re-enable-timer       # re-enable Phase 91 mirror sync
sudo nano /etc/clawcode/clawcode.yaml   # remove the fileAccess block you added
sudo systemctl restart clawcode
```

For full code rollback:

```bash
cd /opt/clawcode
git reset --hard 442eeeb            # one commit before Phase 96 work began
npm ci && npm run build
sudo systemctl restart clawcode
```

---

## What to Report Back

- **PHASE 96 UAT-95 PASSED** + Discord CDN URL of the GS analysis PDF posted by the agent + `clawcode probe-fs fin-acquisition` snapshot
- **PHASE 96 UAT-95 FAILED: <description>** + `journalctl -u clawcode --since "5 min ago"` output + the agent's actual reply text

After PASS, we proceed to:
- Phase 97 plan (network probe + auto-injected mysql_query MCP — closes the 60s subagent latency gap + the OpenClaw-recommendation root cause)
- Phase 98 plan (complete cutover from OpenClaw to ClawCode — uses the stashed daemon.ts OpenClaw-webhook routing for visual identity preservation)

---

## Notes on Divergence from Original Deploy Runbook

| Original (96-07-DEPLOY-RUNBOOK.md) | Adapted Reality |
|------|------|
| ACL: `getfacl ... | grep clawcode` | ACL: group::r-x via `clawcode` ∈ `jjagpal` group (no explicit ACL needed) |
| UAT-95: Tara Maffeo PDFs | UAT-95: finmentum Goldman Sachs analysis PDF (only PDF on clawdy) |
| Section 4 fleet probe → all agents | Section 4 single-agent probe (`fin-acquisition` only — others don't have fileAccess configured yet) |
| `workspace-coding` exists on clawdy | Doesn't exist (only `workspace-finmentum`) |
