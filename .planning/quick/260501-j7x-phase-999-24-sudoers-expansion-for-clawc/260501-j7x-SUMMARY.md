---
phase: 999.24-sudoers-expansion
plan: 260501-j7x
subsystem: server-config
tags: [sudoers, security, ops, clawdy, phase-999.24]
requires: ["existing /etc/sudoers.d/clawcode CLAWCODE_INSTALL block byte-equal"]
provides: ["clawcode user passwordless `sudo systemctl reload|restart clawcode.service`"]
affects: ["remote:clawdy:/etc/sudoers.d/clawcode"]
tech-stack:
  added: []
  patterns: ["additive sudoers Cmnd_Alias", "atomic install via `install -m 0440 -o root -g root`", "visudo -cf pre-install validation gate"]
key-files:
  created: [".planning/quick/260501-j7x-phase-999-24-sudoers-expansion-for-clawc/260501-j7x-SUMMARY.md"]
  modified: ["remote:clawdy:/etc/sudoers.d/clawcode"]
decisions:
  - "Restart and reload only — deliberately excluded `kill`, `stop`, `start`, and wildcard `systemctl * clawcode.service`. The exact path that caused today's outage (`kill -HUP`) remains forbidden by the sudoers grant."
  - "Additive only — original CLAWCODE_INSTALL block preserved byte-equal; verified by post-install `cat /etc/sudoers.d/clawcode`."
  - "No real reload/restart invoked during verification — daemon currently has no SIGHUP handler (Phase 999.23 future), and `systemctl reload` would send SIGHUP per the unit's ExecReload, killing the daemon. Verification was read-only via `sudo -l -U clawcode` + `stat`."
metrics:
  duration: "~2 minutes (single SSH-driven task)"
  completed: "2026-05-01"
---

# Phase 999.24 Plan 260501-j7x: Sudoers Expansion for clawcode User Summary

Additive `CLAWCODE_SERVICE` sudoers grant installed on clawdy enabling passwordless `systemctl reload|restart clawcode.service` for the `clawcode` user, eliminating the `kill -HUP` fallback path that caused today's 06:07 PDT outage.

## Diff Applied

**Additive only.** Original `CLAWCODE_INSTALL` block and grant line preserved byte-equal vs. pre-state captured in Step 1.

```diff
 Cmnd_Alias CLAWCODE_INSTALL = \
     /usr/bin/apt-get update, \
     /usr/bin/apt-get install -y *, \
     /usr/bin/apt-get install --no-install-recommends -y *, \
     /usr/bin/dpkg -i /tmp/*.deb, \
     /usr/bin/npx playwright install *, \
     /usr/bin/npx playwright install-deps *

+Cmnd_Alias CLAWCODE_SERVICE = \
+    /usr/bin/systemctl reload clawcode.service, \
+    /usr/bin/systemctl restart clawcode.service
+
 clawcode ALL=(root) NOPASSWD: CLAWCODE_INSTALL
+clawcode ALL=(root) NOPASSWD: CLAWCODE_SERVICE
```

Two additions:
1. New `Cmnd_Alias CLAWCODE_SERVICE` block (two systemctl commands, exact-match service name).
2. New grant line `clawcode ALL=(root) NOPASSWD: CLAWCODE_SERVICE`.

Deliberately excluded (security-by-narrowness):
- `systemctl stop` / `systemctl start` — `restart` covers legit recovery.
- `systemctl kill` (any signal) — exactly the path that caused today's outage.
- Wildcard forms like `systemctl * clawcode.service`.
- Any service other than `clawcode.service` (exact match required).

## Before — `sudo -l -U clawcode` Pre-Install (Step 1)

```
Matching Defaults entries for clawcode on clawdy:
    env_reset, mail_badpass, secure_path=/usr/local/sbin\:/usr/local/bin\:/usr/sbin\:/usr/bin\:/sbin\:/bin\:/snap/bin, use_pty

User clawcode may run the following commands on clawdy:
    (root) NOPASSWD: /usr/bin/apt-get update, /usr/bin/apt-get install -y *, /usr/bin/apt-get install --no-install-recommends -y *, /usr/bin/dpkg -i /tmp/*.deb, /usr/bin/npx playwright install *, /usr/bin/npx playwright install-deps *
```

Pre-state `/etc/sudoers.d/clawcode` content matched the planner's confirmed snapshot byte-for-byte. ABORT GATE 1 PASSED.

## After — `sudo -l -U clawcode` Post-Install (Step 6c)

```
Matching Defaults entries for clawcode on clawdy:
    env_reset, mail_badpass, secure_path=/usr/local/sbin\:/usr/local/bin\:/usr/sbin\:/usr/bin\:/sbin\:/bin\:/snap/bin, use_pty

User clawcode may run the following commands on clawdy:
    (root) NOPASSWD: /usr/bin/apt-get update, /usr/bin/apt-get install -y *, /usr/bin/apt-get install --no-install-recommends -y *, /usr/bin/dpkg -i /tmp/*.deb, /usr/bin/npx playwright install *, /usr/bin/npx playwright install-deps *
    (root) NOPASSWD: /usr/bin/systemctl reload clawcode.service, /usr/bin/systemctl restart clawcode.service
```

Two NOPASSWD lines visible — CLAWCODE_INSTALL (unchanged) and the new CLAWCODE_SERVICE.

### From clawcode-User Perspective (Step 6d)

```
    (root) NOPASSWD: /usr/bin/systemctl reload clawcode.service, /usr/bin/systemctl restart clawcode.service
```

Confirms the agent identity itself sees the new grant.

## File Mode / Owner Verification (Step 6a)

```
440 root:root /etc/sudoers.d/clawcode
```

Mode `0440` and `root:root` ownership are mandatory — sudo refuses to load sudoers.d entries that don't match. Verified.

`visudo -cf /etc/sudoers.d/clawcode` post-install: `parsed OK` (exit 0).

## On-Disk Content Verification

Final installed file content (verbatim, post-install):

```
Cmnd_Alias CLAWCODE_INSTALL = \
    /usr/bin/apt-get update, \
    /usr/bin/apt-get install -y *, \
    /usr/bin/apt-get install --no-install-recommends -y *, \
    /usr/bin/dpkg -i /tmp/*.deb, \
    /usr/bin/npx playwright install *, \
    /usr/bin/npx playwright install-deps *

Cmnd_Alias CLAWCODE_SERVICE = \
    /usr/bin/systemctl reload clawcode.service, \
    /usr/bin/systemctl restart clawcode.service

clawcode ALL=(root) NOPASSWD: CLAWCODE_INSTALL
clawcode ALL=(root) NOPASSWD: CLAWCODE_SERVICE
```

CLAWCODE_INSTALL block byte-equal vs. pre-state — confirmed.

## Daemon State

`systemctl is-active clawcode.service` → `active`. MainPID=439879 throughout. No reload/restart invoked. Daemon process unchanged across this change (matches plan Step 7 — verification was read-only because the daemon has no SIGHUP handler yet, that is Phase 999.23).

## Verification Checklist

- [x] Pre-state byte-equality check passed (Step 1 ABORT gate).
- [x] `visudo -cf /tmp/clawcode-sudoers.new` exited 0 (Step 3 ABORT gate).
- [x] `stat -c '%a %U:%G' /etc/sudoers.d/clawcode` returned `440 root:root` (Step 6a).
- [x] `visudo -cf /etc/sudoers.d/clawcode` exited 0 post-install (Step 6b).
- [x] `sudo -l -U clawcode` shows two `(root) NOPASSWD:` lines (Step 6c).
- [x] Daemon still active, MainPID unchanged (no reload/restart invoked).
- [x] No real password written to any planning artifact, /tmp file, or git-tracked content.
- [x] Staging file `/tmp/clawcode-sudoers.new` cleaned up.

## Rollback Procedure

Verbatim, ready to copy-paste. The literal `PASS` placeholder must be substituted with the real sudo password at invocation time only — do NOT persist it.

```
# SSH to clawdy and restore the original CLAWCODE_INSTALL-only sudoers file:
ssh jjagpal@100.98.211.108 "cat > /tmp/clawcode-sudoers.rollback <<'EOF'
Cmnd_Alias CLAWCODE_INSTALL = \\
    /usr/bin/apt-get update, \\
    /usr/bin/apt-get install -y *, \\
    /usr/bin/apt-get install --no-install-recommends -y *, \\
    /usr/bin/dpkg -i /tmp/*.deb, \\
    /usr/bin/npx playwright install *, \\
    /usr/bin/npx playwright install-deps *

clawcode ALL=(root) NOPASSWD: CLAWCODE_INSTALL
EOF"
ssh jjagpal@100.98.211.108 "echo 'PASS' | sudo -S visudo -cf /tmp/clawcode-sudoers.rollback"
ssh jjagpal@100.98.211.108 "echo 'PASS' | sudo -S install -m 0440 -o root -g root /tmp/clawcode-sudoers.rollback /etc/sudoers.d/clawcode"
ssh jjagpal@100.98.211.108 "echo 'PASS' | sudo -S rm /tmp/clawcode-sudoers.rollback"
ssh jjagpal@100.98.211.108 "echo 'PASS' | sudo -S visudo -cf /etc/sudoers.d/clawcode"
ssh jjagpal@100.98.211.108 "echo 'PASS' | sudo -S -l -U clawcode"
```

After rollback, `sudo -l -U clawcode` should show ONLY the CLAWCODE_INSTALL grant line (apt/dpkg/playwright commands) and no `systemctl reload|restart` grant.

## Future Hardening (Backlog — Out of Scope Here)

The install/update flow (`clawcode update --restart`) does NOT currently template `/etc/sudoers.d/clawcode` — see `~/.claude/projects/-home-jjagpal--openclaw-workspace-coding/memory/reference_clawcode_server.md`. A future phase should add the sudoers template (with the additive `CLAWCODE_SERVICE` block) to the install path so this grant survives reinstalls. Today's manual change drifts from the install template. Track as backlog.

Suggested follow-ups:
1. Phase 999.23 — implement SIGHUP handler in the daemon so `systemctl reload` is non-destructive (this plan's grant is currently unsafe to exercise).
2. Templated sudoers in install/update flow — keep additive grants source-of-truth in repo.

## Password Redaction Note

All sudo invocations documented in this SUMMARY.md use the literal `PASS` placeholder. The real sudo password was substituted only at invocation time during execution and is NOT persisted in:
- This SUMMARY.md
- The PLAN.md
- Any /tmp staging file (the staging file `/tmp/clawcode-sudoers.new` contained sudoers config only and has been removed)
- Any git-tracked content
- Any executor transcript artifact written to disk

Per requirement SUDOERS-01 (Phase 999.24 ROADMAP entry).

## Self-Check: PASSED

- File modified on clawdy: `/etc/sudoers.d/clawcode` — confirmed via `cat` post-install (content matches target byte-equal).
- File mode/owner: `440 root:root` — confirmed via `stat`.
- visudo: `parsed OK` — confirmed.
- Two NOPASSWD grants visible to clawcode user — confirmed via `sudo -l -U clawcode`.
- Daemon running (MainPID=439879, status=active) — confirmed via `systemctl`.
- SUMMARY.md created at expected path.
