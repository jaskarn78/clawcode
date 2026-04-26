---
status: partial
phase: 100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow
source: [100-VERIFICATION.md, SMOKE-TEST.md]
started: 2026-04-26T19:26:58Z
updated: 2026-04-26T19:26:58Z
---

## Current Test

[awaiting human testing on clawdy]

## Tests

### 1. UAT-100-A — `/gsd-debug` replies inline in `#admin-clawdy` (no subthread)
expected: Admin Clawdy responds inline in the main channel — no subagent thread spawned. The `gsd-debug` slash command falls through the dispatcher's CONTROL_COMMANDS branch since it is NOT in `GSD_LONG_RUNNERS`. Skill content loads via the symlink at `/home/clawcode/.claude/commands/gsd/`.
result: [pending]

### 2. UAT-100-B — `/gsd-plan-phase 100` spawns thread + main-channel relay
expected: Admin Clawdy posts an acknowledgement in the main channel ("Spinning up subagent..."), spawns a Discord thread named `gsd:plan:100`, dispatches the workflow to the subagent. Workflow runs end-to-end inside the thread. On completion, Admin Clawdy posts a one-line summary in the main channel that includes the line `Artifacts written: .planning/phases/100-*/` (Phase 99-M relay extension).
result: [pending]

### 3. UAT-100-C — settingSources NON_RELOADABLE restart behavior
expected: Edit `/etc/clawcode/clawcode.yaml` admin-clawdy block (e.g., toggle `settingSources` between `["project"]` and `["project", "user"]`). Tail `journalctl -u clawcode -f` and confirm the watcher fires an agent-restart log line for admin-clawdy (not a hot-reload), and that `/gsd:next-phase` plain-text invocation is recognized only when `["project", "user"]` is active.
result: [pending]

### 4. Slash registration — 5 `/gsd-*` entries visible in `#admin-clawdy` Discord menu
expected: After redeploy + agent restart, type `/` in `#admin-clawdy` and confirm the Discord slash command menu shows all 5 entries: `/gsd-autonomous`, `/gsd-plan-phase`, `/gsd-execute-phase`, `/gsd-debug`, `/gsd-quick`. Each has the description and option fields defined in `clawcode.yaml`.
result: [pending]

### 5. `clawcode gsd install` on clawdy — symlinks + sandbox bootstrap
expected: Run `sudo -u clawcode clawcode gsd install` on clawdy. Both symlinks resolve correctly: `~clawcode/.claude/get-shit-done/` → `/home/jjagpal/.claude/get-shit-done/` and `~clawcode/.claude/commands/gsd/` → `/home/jjagpal/.claude/commands/gsd/`. Sandbox project at `/opt/clawcode-projects/sandbox/` exists with `.git/` directory and an initial empty commit. Re-running the command is idempotent (no destructive deltas).
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps

[None yet — all items pending operator deployment + UAT]

## Pre-UAT Checklist (operator runs before testing)

- [ ] Build pushed to clawdy: `rsync src/ → clawcode@clawdy:/opt/clawcode/src/` + `npm run build` on clawdy
- [ ] `sudo -u clawcode clawcode gsd install` ran successfully (creates symlinks + sandbox)
- [ ] admin-clawdy block copied from local `clawcode.yaml` to `/etc/clawcode/clawcode.yaml` with production substitutions (real Discord channel ID + workspace path)
- [ ] `sudo systemctl restart clawcode` succeeded; admin-clawdy boot log shows `settingSources: [project, user]` and `gsd.projectDir: /opt/clawcode-projects/sandbox`
- [ ] Discord slash menu shows 5 `/gsd-*` entries in `#admin-clawdy`

Once all 5 pre-UAT items pass, operator runs UAT items 1-5 above. Phase 100 ships on operator sign-off.
