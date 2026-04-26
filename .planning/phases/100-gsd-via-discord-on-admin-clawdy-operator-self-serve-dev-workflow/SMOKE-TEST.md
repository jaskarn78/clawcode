# Phase 100 — Smoke Test Runbook (Operator-Runnable Deploy + UAT)

**Plan:** 100-08
**Production target:** `clawdy` host (per memory note `reference_clawcode_server.md` — Tailscale-reachable; SSH access from `jjagpal` user; daemon installed at `/opt/clawcode/`; runs as `clawcode` system user; systemd unit `clawcode.service`).
**NOT this dev box.** All commands prefixed `ssh clawdy ...` target the production host. Local-box commands are pre-flight verification only.
**Deploy outcome:** Phase 100 GSD-via-Discord workflow is operationally available on Admin Clawdy in `#admin-clawdy`; UAT-100-A / UAT-100-B / UAT-100-C all pass; sign-off checklist (bottom) is fully ticked.

---

## Scope

Transition Phase 100 (GSD-via-Discord on Admin Clawdy) from dev box (`jjagpal` user, this repo) to production (`clawcode` system user on `clawdy` host) and verify the operator-self-serve dev workflow works end-to-end.

This runbook does **not** automate the deploy. Plan 100-08 only AUTHORS the procedure; the operator runs each section manually. Sections 6-8 require live Discord interaction in `#admin-clawdy` on the production guild — they cannot be executed by Claude (autonomous=false reflects this contract).

**Time budget:**
- Sections 1-5 (deploy procedure): ~30 min
- Sections 6-8 (UAT smoke tests): ~15 min
- Section 9 (rollback): ~10 min if smoke tests fail

**Phase 100 is NOT ready for general use until Sections 6-8 UAT smoke tests pass.**

---

## Section ordering — BLOCKED-BY relationships

| Step | Title                                                                  | BLOCKED-BY               |
| ---- | ---------------------------------------------------------------------- | ------------------------ |
| 1    | Prerequisites verification (dev box + clawdy host)                     | — (always first)         |
| 2    | Symlink + sandbox install via `clawcode gsd install`                   | Section 1                |
| 3    | Production clawcode.yaml edit on clawdy                                | Section 2                |
| 4    | Daemon redeploy (systemctl restart)                                    | Section 3                |
| 5    | Slash-command registration verification                                | Section 4                |
| 6    | UAT-100-A — short-runner inline smoke test (gsd-debug)                 | Section 5                |
| 7    | UAT-100-B — long-runner subthread smoke test (gsd-plan-phase)          | Section 5                |
| 8    | UAT-100-C — settingSources hot-reload-as-restart verification          | Section 7 (after UAT-B)  |
| 9    | Rollback procedure                                                     | Triggered if any UAT fails |

---

## Section 1 — Prerequisites verification

**Prerequisite:** SSH access to `clawdy` as `jjagpal`; this repo cloned at `/home/jjagpal/.openclaw/workspace-coding`; Anthropic API key already provisioned in `/etc/clawcode/` on clawdy.

**On the dev box (jjagpal user, local), confirm:**

```bash
# 1.1 — GSD source files exist (Plan 06 install helper depends on them)
test -d /home/jjagpal/.claude/get-shit-done && echo "1.1a get-shit-done dir: $?"
test -d /home/jjagpal/.claude/commands/gsd && echo "1.1b commands/gsd dir: $?"

# 1.2 — ClawCode test suite green (config + manager + discord + cli)
cd /home/jjagpal/.openclaw/workspace-coding
npx vitest run src/config/ src/manager/ src/discord/ src/cli/ 2>&1 | tail -3
# expected: 0 failures (pre-existing baseline failures may persist; confirm no NEW regressions vs commit prior to Phase 100)

# 1.3 — Plan 07 admin-clawdy block parses
npx vitest run src/config/__tests__/clawcode-yaml-phase100.test.ts
# expected: 8 tests passing (YML1..YML8)

# 1.4 — Plan 100-08 structural runbook test green
npx vitest run .planning/phases/100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow/__tests__/smoke-test-doc.test.ts
# expected: 10 tests passing (SMK1..SMK10)
```

**On the clawdy host (SSH from jjagpal user), confirm:**

```bash
# 1.5 — clawcode user exists
ssh clawdy "id clawcode" && echo "1.5 clawcode user: $?"

# 1.6 — daemon healthy and active
ssh clawdy "systemctl status clawcode.service" | head -5
# expected: "active (running)"

# 1.7 — production install path
ssh clawdy "test -d /opt/clawcode && echo '1.7 /opt/clawcode: 0'"

# 1.8 — clawcode user's ~/.claude target dir exists (or can be created)
ssh clawdy "sudo -u clawcode mkdir -p /home/clawcode/.claude && ls -la /home/clawcode/.claude"

# 1.9 — Anthropic API key provisioned in /etc/clawcode/
ssh clawdy "sudo test -f /etc/clawcode/clawcode.yaml && echo '1.9 yaml exists: 0'"

# 1.10 — Admin Clawdy bot identity already bound to #admin-clawdy on Discord (operator confirms via Discord developer mode — note the channel ID for Section 3)
echo "1.10 — operator records #admin-clawdy channel ID: <write it down here for Section 3>"
```

**Acceptance:** all `echo` lines report `0`; vitest runs pass; operator has the production `#admin-clawdy` channel ID written down.

**Failure mitigation:**
- 1.1 fails → operator runs the GSD install/sync from their tooling chain
- 1.2 NEW regressions → investigate before deploying; do NOT proceed
- 1.5 fails → `ssh clawdy "sudo useradd -r -m -s /bin/bash clawcode"`; re-test
- 1.6 fails → `ssh clawdy "sudo systemctl start clawcode.service"`; re-test
- 1.7 fails → confirm install location with `ssh clawdy "systemctl cat clawcode.service | grep ExecStart"`; adjust paths in Sections 2-4 accordingly
- 1.10 not yet bound → operator binds the bot in Discord first; this runbook does not handle initial Discord app setup

**STOP if any prereq fails.** Premature deploy with missing prereqs causes confusing UAT failures.

---

## Section 2 — Symlink + sandbox install via `clawcode gsd install` (Plan 100-06)

**Prerequisite:** Section 1 passes.

The `clawcode gsd install` CLI subcommand (Plan 06) creates 2 symlinks (`~/.claude/get-shit-done`, `~/.claude/commands/gsd`) and bootstraps `/opt/clawcode-projects/sandbox/` as an empty git repo. It is idempotent — safe to re-run.

**Step 2a — Stage GSD source on clawdy** (so the symlinks have a real target on the production host):

```bash
# Create jjagpal-side directories on clawdy (the symlinks point INTO them from the clawcode user)
ssh clawdy "mkdir -p /home/jjagpal/.claude/commands/gsd /home/jjagpal/.claude/get-shit-done"

# Rsync the GSD content from this dev box to clawdy
rsync -avz --delete /home/jjagpal/.claude/get-shit-done/ clawdy:/home/jjagpal/.claude/get-shit-done/
rsync -avz --delete /home/jjagpal/.claude/commands/gsd/ clawdy:/home/jjagpal/.claude/commands/gsd/
```

**Step 2b — Run the install helper as the clawcode user:**

```bash
ssh clawdy "sudo -u clawcode /opt/clawcode/bin/clawcode gsd install"
```

Expected output (per Plan 06 SUMMARY):

```
clawcode gsd install — summary:
  skills symlink:   /home/clawcode/.claude/get-shit-done -> /home/jjagpal/.claude/get-shit-done   [created]
  commands symlink: /home/clawcode/.claude/commands/gsd  -> /home/jjagpal/.claude/commands/gsd    [created]
  sandbox repo:     /opt/clawcode-projects/sandbox                                                [created]

All steps completed successfully. Exit code 0.
```

(On second run after first success, the three `[created]` markers become `[already-present]` — the install is idempotent by construction per Plan 06's readlink-comparison + stat-existence checks.)

**Step 2c — Verify symlinks resolve and sandbox is a git repo:**

```bash
ssh clawdy "sudo -u clawcode readlink /home/clawcode/.claude/get-shit-done"
# expected: /home/jjagpal/.claude/get-shit-done

ssh clawdy "sudo -u clawcode readlink /home/clawcode/.claude/commands/gsd"
# expected: /home/jjagpal/.claude/commands/gsd

ssh clawdy "sudo -u clawcode test -d /opt/clawcode-projects/sandbox/.git && echo '2.c .git exists: 0'"
# expected: 0
```

**Acceptance:** `clawcode gsd install` exits 0; both `readlink` outputs match the expected jjagpal-side paths; `.git` directory exists in the sandbox.

**Failure mitigation:**
- exit code != 0 → re-run with `--help` to inspect override flags; check that Step 2a rsync completed
- readlink wrong target → manually delete the symlink and re-run install: `ssh clawdy "sudo -u clawcode rm /home/clawcode/.claude/get-shit-done && sudo -u clawcode /opt/clawcode/bin/clawcode gsd install"`
- sandbox missing → operator may have deleted `/opt/clawcode-projects/sandbox` between runs; re-run install (idempotent)

---

## Section 3 — Production clawcode.yaml edit on clawdy (Plan 100-07 block)

**Prerequisite:** Section 2 passes.

Edit `/etc/clawcode/clawcode.yaml` on clawdy (or wherever the daemon's `ExecStart -c` flag points — verify with `ssh clawdy "systemctl cat clawcode.service | grep ExecStart"`).

Append the admin-clawdy agent block VERBATIM from this repo's `clawcode.yaml` lines 344-409 (Plan 07 fixture). The dev block is the production template — only TWO substitutions are required:

**Production substitutions (the two fields that DIFFER from the dev fixture):**

1. **`channels: []`** in dev → `channels: ["<production #admin-clawdy Discord channel ID from Section 1.10>"]`
2. **`workspace: /tmp/admin-clawdy`** in dev → operator's chosen workspace on clawdy (e.g. `/home/clawcode/admin-clawdy`)

**All OTHER fields land byte-identical** — `model: sonnet`, `settingSources: [project, user]`, `gsd.projectDir: /opt/clawcode-projects/sandbox`, the 5 slashCommands entries with their claudeCommand templates, soul, identity. Per Plan 07 hand-off this byte-identical replication preserves Plan 04's dispatcher contract + Plan 02's SDK-passthrough invariant + Plan 06's sandbox-path matching.

**Reference template** (copy from `/home/jjagpal/.openclaw/workspace-coding/clawcode.yaml` lines 344-409 on the dev box):

```yaml
  - name: admin-clawdy
    model: sonnet
    workspace: /home/clawcode/admin-clawdy   # production substitution (was /tmp/admin-clawdy in dev)
    channels:
      - "PRODUCTION_CHANNEL_ID_FROM_SECTION_1.10"  # production substitution (was [] in dev)
    settingSources: [project, user]
    gsd:
      projectDir: /opt/clawcode-projects/sandbox
    slashCommands:
      - name: gsd-autonomous
        description: Run all remaining phases autonomously
        claudeCommand: "/gsd:autonomous {args}"
        options:
          - name: args
            type: 3
            description: "Optional flags (e.g. --from 100)"
            required: false
      - name: gsd-plan-phase
        description: Create phase plan with verification loop
        claudeCommand: "/gsd:plan-phase {phase}"
        options:
          - name: phase
            type: 3
            description: "Phase number + optional flags"
            required: false
      - name: gsd-execute-phase
        description: Execute all plans in a phase
        claudeCommand: "/gsd:execute-phase {phase}"
        options:
          - name: phase
            type: 3
            description: "Phase number + optional flags"
            required: false
      - name: gsd-debug
        description: Systematic debugging with persistent state
        claudeCommand: "/gsd:debug {issue}"
        options:
          - name: issue
            type: 3
            description: "Issue description"
            required: true
      - name: gsd-quick
        description: Quick task with GSD guarantees
        claudeCommand: "/gsd:quick {task}"
        options:
          - name: task
            type: 3
            description: "Task description"
            required: true
    soul: |
      # Admin Clawdy — GSD operator surface
      You drive ClawCode's own GSD workflow from Discord. Operators type
      /gsd-* in #admin-clawdy; long-runners auto-spawn a subagent thread
      and you summarize completion in main channel. Stay terse.
    identity: |
      Name: Admin Clawdy
      Role: GSD operator surface for ClawCode itself
      Model: sonnet
      Vibe: Competent, dry, references Phase 100 plans by ID when useful.
```

**Optional — back up the production yaml before editing** (recommended for Section 9 rollback):

```bash
ssh clawdy "sudo cp /etc/clawcode/clawcode.yaml /etc/clawcode/clawcode.yaml.before-phase100"
```

**Validate the edit parses (dry-run, no daemon impact):**

```bash
ssh clawdy "sudo -u clawcode /opt/clawcode/bin/clawcode init -c /etc/clawcode/clawcode.yaml --dry-run" | grep admin-clawdy
# expected: lists admin-clawdy among the configured agents; exit 0
```

**Acceptance:** `clawcode init --dry-run` lists `admin-clawdy`; no schema validation errors; the production yaml's admin-clawdy block matches the dev fixture except for the two documented substitutions.

**Failure mitigation:**
- `clawcode init --dry-run` reports schema error → diff the production yaml against the dev `clawcode.yaml:344-409` block; fix indentation or missing fields
- channel ID format error → Discord channel IDs are 17-19 digit strings; quote them in YAML
- `sudo` access denied → operator's account needs sudo or direct write access to `/etc/clawcode/`; coordinate with infra if needed

---

## Section 4 — Daemon redeploy (systemctl restart)

**Prerequisite:** Section 3 passes.

Restart the clawcode daemon to load the new admin-clawdy agent block:

```bash
ssh clawdy "sudo systemctl restart clawcode.service"

# Wait for boot — the daemon spawns N agent sessions sequentially; admin-clawdy is added to that fleet
sleep 10

ssh clawdy "systemctl status clawcode.service" | head -5
# expected: "active (running)"; uptime resets to <1m

# Verify admin-clawdy boot in journalctl (settingSources + gsd.projectDir should show in the agent's startup log)
ssh clawdy "sudo journalctl -u clawcode.service --since '30 seconds ago' | grep admin-clawdy"
# expected: at least one log line mentioning admin-clawdy session start; should reference settingSources or gsd
```

**Acceptance:** systemctl status reports `active (running)`; journalctl shows admin-clawdy in the boot list; no unhandled exception traces in the post-restart window.

**Failure mitigation:**
- systemctl status reports `failed` → `ssh clawdy "sudo journalctl -u clawcode.service -n 50"` for traceback; common cause is a yaml schema error that slipped past `--dry-run` (Section 3 redo)
- admin-clawdy missing from journalctl → confirm the yaml edit landed correctly: `ssh clawdy "sudo grep -A 2 'name: admin-clawdy' /etc/clawcode/clawcode.yaml"`

---

## Section 5 — Slash-command registration verification

**Prerequisite:** Section 4 passes.

On Discord (operator's client, navigate to `#admin-clawdy` on the production guild):

1. Type `/` in the input field.
2. Wait up to 30 seconds for Discord's slash menu to populate.
3. Confirm the 5 GSD entries appear:
   - `/gsd-autonomous`
   - `/gsd-plan-phase`
   - `/gsd-execute-phase`
   - `/gsd-debug`
   - `/gsd-quick`

If they do NOT appear within 30 seconds:

- Re-check Section 4 daemon status (`systemctl status` should be `active (running)`)
- Check journalctl for slash registration: `ssh clawdy "sudo journalctl -u clawcode.service | grep -iE 'slash command|registered'"`
- Cross-reference the per-guild Discord cap: total registered slash commands across all ClawCode agents should be `<= 90` per Discord's API cap. Phase 100 adds 5; if the count is near 90, slash registration may be silently dropping. Run `ssh clawdy "sudo -u clawcode /opt/clawcode/bin/clawcode mcp-status"` (or the CLI equivalent that lists registered commands) to inspect.

**Acceptance:** all 5 `/gsd-*` entries visible in the Discord slash menu in `#admin-clawdy`; selecting each shows the option fields per Plan 04 dispatcher contract (e.g. `/gsd-plan-phase` shows a `phase` option).

**Failure mitigation:**
- 0 entries appear → daemon may not have called Discord's slash registration on boot; restart again or check `/clawcode-status` from another bound channel
- only some entries appear → admin-clawdy block has a typo in `slashCommands.name`; revisit Section 3
- entries appear in the WRONG channel (e.g. visible in `#general`) → channels: array misconfigured in Section 3; only `#admin-clawdy` ID should be listed

---

## Section 6 — UAT-100-A — short-runner inline smoke test (gsd-debug)

**Prerequisite:** Section 5 passes (5 slash entries visible).

Goal: verify that short-runners (NOT in Plan 04's `GSD_LONG_RUNNERS` Set) fall through to the legacy claudeCommand-template path and respond INLINE in `#admin-clawdy` — no subthread spawn.

In `#admin-clawdy` on production Discord, type:

```
/gsd-debug fake issue for smoke test — please respond
```

Expected behavior:

- Discord acknowledges the slash command immediately (no "interaction failed" red banner).
- Admin Clawdy replies INLINE in `#admin-clawdy` (NOT in a subthread). The Discord thread sidebar should show NO new `gsd:*` thread.
- Reply mentions a debug-related response (per the `/gsd:debug` skill content delivered via the symlinked `~/.claude/commands/gsd/`).
- Round-trip time: ~5-30 seconds.

**Acceptance UAT-100-A:**
- Inline reply received in `#admin-clawdy`.
- Thread sidebar shows NO new `gsd:*` thread.
- Reply is contextually relevant to the `/gsd:debug` skill (proves the symlinked commands surface is loaded).

**Failure mitigation:**
- "Unknown command" reply → settingSources: [project, user] is not loading user-level commands; check Section 2 symlinks and Section 3 yaml block
- subthread spawned (when none expected) → Plan 04 dispatcher misclassified gsd-debug as a long-runner; check `GSD_LONG_RUNNERS` in `slash-commands.ts:156`
- no reply at all → daemon may have crashed; check `ssh clawdy "sudo journalctl -u clawcode.service -n 100"`

---

## Section 7 — UAT-100-B — long-runner subthread smoke test (gsd-plan-phase)

**Prerequisite:** Section 6 passes.

Goal: verify long-runners (in Plan 04's `GSD_LONG_RUNNERS` Set) auto-spawn a Discord subagent thread, dispatch the canonical `/gsd:plan-phase` to the subagent, and on completion the parent posts a main-channel summary including the artifact paths from Plan 100-05's relay extension.

In `#admin-clawdy` on production Discord, type:

```
/gsd-plan-phase 100 --skip-research
```

Expected behavior (in order):

1. **Within 3 seconds:** Admin Clawdy posts an ack message in `#admin-clawdy` main channel containing `Spawned gsd:plan:100 subthread` (or the equivalent per Plan 04 dispatcher's `editReply` content) plus a Discord thread URL.
2. **A new thread** appears in the Discord sidebar named exactly `gsd:plan:100` (per Plan 04 thread-name-compute step).
3. **Within 30 seconds:** the subagent posts an initial reply in the thread acknowledging the `/gsd:plan-phase 100 --skip-research` task; may ask clarifying questions.
4. **Operator interacts with the subagent** in the thread as needed (answering grey-area questions per CONTEXT.md decision: in-thread Q&A, no ButtonBuilder).
5. **On completion (typically 2-5 minutes):** the parent (Admin Clawdy) posts a main-channel summary in `#admin-clawdy` that includes an `Artifacts written:` line referencing `.planning/phases/100-*/` directory paths (per Plan 100-05 relay extension's `discoverArtifactPaths` helper).

**Acceptance UAT-100-B:**
- All 5 expected behaviors observed in order.
- Thread name is exactly `gsd:plan:100`.
- Main-channel summary surfaces an `Artifacts written:` (or `Artifacts:`) line per Plan 100-05.
- The artifact path mentioned is a relative path under `.planning/phases/100-...` (NOT absolute — Plan 100-05 RESEARCH.md Pitfall 8 enforced relative paths to avoid Discord embed truncation).

**Failure mitigation:**
- ack within 3s but no thread spawned → check `subagentThreadSpawner` DI wiring; missing spawner emits `"Subagent thread spawning unavailable"` reply per Plan 04 GSD-14
- thread spawned but wrong name (e.g. `gsd:plan-phase:100`) → check Plan 04 `shortName` mapping (`gsd-plan-phase` should strip `-phase` suffix → `plan`)
- subagent doesn't respond in thread → check that the symlinked `~/.claude/commands/gsd/plan-phase.md` exists; check daemon logs for the subagent's session start
- main-channel summary missing `Artifacts written:` line → verify admin-clawdy.gsd.projectDir is set to `/opt/clawcode-projects/sandbox`; verify the subagent actually created `.planning/phases/100-*/` files within the last 24h; verify the directory name has the phase number prefix (Plan 100-05's phase-prefix priority sort)
- non-admin channel rejection (mistakenly testing in `#general`) → expect `"/gsd-* commands are restricted to #admin-clawdy."` per Plan 04 GSD-7 channel guard

---

## Section 8 — UAT-100-C — settingSources hot-reload-as-restart verification

**Prerequisite:** Section 7 passes.

Goal: prove Plan 100-03's classification of `settingSources` as `NON_RELOADABLE` actually surfaces correctly to the operator. The watcher must detect the YAML edit AND emit an "agent restart needed" signal; runtime requires manual `clawcode restart admin-clawdy` (or systemctl restart) to apply. This UAT also exercises the `/gsd:autonomous` plain-message-body path (CONTEXT.md decision lock-in: settingSources: ['user'] enables SDK-level skill discovery via plain `/gsd:*` text).

**Step 8a — Edit the production yaml on clawdy:**

Change admin-clawdy's `settingSources: [project, user]` to `settingSources: [project]` (drop the `user` entry). Save.

```bash
# Operator-driven edit (e.g. via vim on clawdy)
ssh clawdy "sudo -u root vi /etc/clawcode/clawcode.yaml"
# OR if using a sed-style automation (NOT recommended — see Section 9 rollback):
# ssh clawdy "sudo sed -i.bak 's/settingSources: \[project, user\]/settingSources: [project]/' /etc/clawcode/clawcode.yaml"
```

**Step 8b — Within 30 seconds, the config-watcher should detect the edit. Check journalctl for the agent-restart-needed signal:**

```bash
ssh clawdy "sudo journalctl -u clawcode.service --since '30 seconds ago' | grep -iE 'reload|restart|agent.*restart.*needed|settingSources'"
```

Expected: a log entry indicating "agent restart needed for admin-clawdy" (exact wording depends on Phase 22 watcher format — Plan 100-03 didn't change the watcher's emission format, only the differ classification).

**Step 8c — Verify the edit has NOT yet taken effect** (settingSources is NON_RELOADABLE — runtime still uses pre-edit `[project, user]` until restart):

In `#admin-clawdy`, type the plain-message-body form (NOT the slash form):

```
/gsd:autonomous --help
```

Expected: Admin Clawdy invokes the skill (proving settingSources still includes `user` at runtime). This is the pre-restart state.

**Step 8d — Restart admin-clawdy to apply the edit:**

```bash
# Per-agent restart (preferred — does not bounce the entire fleet)
ssh clawdy "sudo -u clawcode /opt/clawcode/bin/clawcode restart admin-clawdy"

# Wait for restart to complete
sleep 5
ssh clawdy "systemctl status clawcode.service" | head -3
```

**Step 8e — In `#admin-clawdy`, type the plain-message-body form again:**

```
/gsd:autonomous --help
```

Expected: SDK reports "Unknown command" (or equivalent — exact wording depends on Claude Agent SDK version). This proves settingSources no longer includes `user`, so `~/.claude/commands/gsd/` is no longer loaded by the SDK at session start.

**Step 8f — Revert the YAML edit and restart:**

```bash
# Revert via the .bak created by sed (or manual edit)
ssh clawdy "sudo cp /etc/clawcode/clawcode.yaml.bak /etc/clawcode/clawcode.yaml"
# OR manually re-add `, user` to the settingSources array

# Restart admin-clawdy
ssh clawdy "sudo -u clawcode /opt/clawcode/bin/clawcode restart admin-clawdy"
sleep 5

# In Discord #admin-clawdy:
#   /gsd:autonomous --help
# expected: works again — proves the revert + restart restored user-level skill loading
```

**Acceptance UAT-100-C:**
- Step 8b: agent-restart-needed log fires within 30s of the edit.
- Step 8c (pre-restart): `/gsd:autonomous --help` works (settingSources still effectively `[project, user]` from the previous boot).
- Step 8e (post-restart with [project] only): `/gsd:autonomous --help` reports "Unknown command".
- Step 8f (post-revert + restart): `/gsd:autonomous --help` works again.

**Failure mitigation:**
- 8b log not visible → confirm the watcher is running (Phase 22): `ssh clawdy "sudo journalctl -u clawcode.service | grep -i watcher | tail -3"`
- 8e still works after restart → admin-clawdy may have failed to restart cleanly; check journalctl for restart trace
- 8f revert doesn't restore behavior → likely a restart timing issue; wait 10 seconds after restart before retesting

---

## Section 8.5 — UAT-100-D — `/clawcode-effort` admin-clawdy guard (Phase 100 follow-up)

**Goal:** confirm `/clawcode-effort` is restricted to `#admin-clawdy` AND that the optional `agent:` option correctly targets any configured agent from there.

### 8.5a — Negative case: invoke from a non-admin channel

In any non-admin channel bound to another agent (e.g., `#finmentum-client-acquisition`), type:

```
/clawcode-effort level:high
```

Expected reply: `` `/clawcode-effort` is restricted to #admin-clawdy. Invoke from the admin channel and use `agent:` to target other agents. ``

The targeted agent's effort MUST NOT change. Verify:

```bash
# In admin-clawdy after the negative test:
/clawcode-status
# expected: fin-acquisition's "Think:" line is unchanged from its pre-test value
```

### 8.5b — Positive case (default target): self-target from admin-clawdy

In `#admin-clawdy`, type:

```
/clawcode-effort level:medium
```

Expected reply: `Effort set to **medium** for admin-clawdy`

### 8.5c — Positive case (cross-agent target): bump fin-acquisition from admin-clawdy

In `#admin-clawdy`, type:

```
/clawcode-effort level:high agent:fin-acquisition
```

Expected reply: `Effort set to **high** for fin-acquisition`

Verify with `/clawcode-status` in `#finmentum-client-acquisition`:

```
🤖 ... · ⚙️ Think: high
```

### 8.5d — Negative case: unknown agent name

In `#admin-clawdy`:

```
/clawcode-effort level:low agent:nonexistent-agent
```

Expected reply: `` Unknown agent: `nonexistent-agent`. ``

`setEffortForAgent` MUST NOT be called.

**Acceptance UAT-100-D:**
- 8.5a: invocation from non-admin channel → restriction message; no effort change.
- 8.5b: invocation from `#admin-clawdy` without `agent:` → applies to admin-clawdy.
- 8.5c: invocation from `#admin-clawdy` with `agent:fin-acquisition` → applies to fin-acquisition (verify via `/clawcode-status` in fin's bound channel).
- 8.5d: unknown agent name → clear error reply, no effort change.

**Failure mitigation:**
- 8.5a still applies effort → check that the new code shipped: `ssh clawdy "grep -c 'restricted to #admin-clawdy' /opt/clawcode/dist/cli/index.js"` should be ≥ 2 (gsd guard + effort guard).
- 8.5c rejects fin-acquisition → check that fin-acquisition is in clawcode.yaml on clawdy AND that admin-clawdy is correctly bound to the channel you're invoking from.

### 8.5e — Hardening: hide `/clawcode-effort` outside `#admin-clawdy` in the slash menu (manual)

**Why this is manual:** Discord requires a USER OAuth token to set per-channel command permissions. Bots cannot push this themselves (verified at `https://discord.com/developers/docs/interactions/application-commands#permissions`). The `default_member_permissions: "0"` we set in code already hides the command from every non-admin user; this step further hides it from admins (i.e., you) outside `#admin-clawdy`.

**Steps:**

1. Open Discord → your server → **Server Settings** → **Integrations**
2. Find the **ClawCode** bot → click **Manage**
3. Locate `/clawcode-effort` in the command list → click it
4. Toggle **All channels** OFF
5. Add channel override → select `#admin-clawdy` → toggle ON
6. Save

**Verification:**

- In `#admin-clawdy`, type `/`. The slash menu shows `/clawcode-effort`. ✓
- In any other channel (e.g., `#finmentum-client-acquisition`), type `/`. The slash menu does NOT show `/clawcode-effort`. ✓
- Even attempting `/clawcode-effort level:high` from a non-admin channel by typing it manually: Discord blocks the submission client-side (the command isn't authorized in that channel).

**Acceptance UAT-100-D-hardening (optional):**
- Slash menu in non-admin channels does not list `/clawcode-effort`.
- Slash menu in `#admin-clawdy` still lists `/clawcode-effort` with both options.

**Why we ship 8.5e as optional:** the handler-level guard (Section 8.5a) already rejects invocations from non-admin channels with a clear restriction message, AND `default_member_permissions: "0"` already hides the command from anyone other than guild admins. UAT-100-D-hardening is the third defense layer — recommended for muscle memory ("this command literally cannot be invoked outside admin"), but the system is safe without it.

---

## Section 9 — Rollback procedure

**Trigger:** any UAT section (6, 7, or 8) fails AND debugging via the per-section "Failure mitigation" lists doesn't resolve it.

**Operator-initiated only** — never autonomous. Each rollback step is destructive in different ways; the operator chooses based on what failed.

### 9a — Revert the clawcode.yaml admin-clawdy block

```bash
# If you backed up before Section 3:
ssh clawdy "sudo cp /etc/clawcode/clawcode.yaml.before-phase100 /etc/clawcode/clawcode.yaml"

# OR if the production yaml is git-tracked:
ssh clawdy "cd /etc/clawcode && sudo git checkout HEAD~1 -- clawcode.yaml"
```

### 9b — Restart the daemon to apply the revert

```bash
ssh clawdy "sudo systemctl restart clawcode.service"
sleep 5
ssh clawdy "systemctl status clawcode.service" | head -3
# expected: active (running)
```

### 9c — Confirm the 5 /gsd-* slash entries have vanished from Discord

In `#admin-clawdy`, type `/`. The slash menu should NO LONGER show the 5 GSD entries (the admin-clawdy block was reverted, so its slashCommands aren't registered).

### 9d — Optional: remove the symlinks and sandbox (full clean rollback)

Only do this if you want to fully un-install Phase 100 from clawdy. Skip if you want to preserve the install artifacts for a future retry.

```bash
# Remove the symlinks
ssh clawdy "sudo -u clawcode rm -f /home/clawcode/.claude/get-shit-done /home/clawcode/.claude/commands/gsd"

# Remove the sandbox repo (DESTRUCTIVE — all sandbox state lost)
ssh clawdy "sudo rm -rf /opt/clawcode-projects/sandbox"
```

**Acceptance Rollback:**
- 9a + 9b: daemon active; admin-clawdy yaml block reverted.
- 9c: `/gsd-*` entries vanish from Discord slash menu in `#admin-clawdy`.
- 9d (optional): symlinks gone; sandbox dir gone.
- Daemon still boots without errors (other agents — fin-acquisition, content-creator, etc. — unaffected).

**After rollback:** investigate the root cause of the UAT failure, fix it locally on the dev box, re-run the test suite (Section 1.2), and restart the runbook from Section 1 once fixed.

---

## Sign-off Checklist

Phase 100 ships when ALL of these are checked:

- [ ] Section 1 prerequisites verified (dev box + clawdy host + Anthropic key + #admin-clawdy channel ID written down)
- [ ] Section 2 install completed (2 symlinks created/already-present + sandbox `.git` exists)
- [ ] Section 3 yaml edit applied + `clawcode init --dry-run` validates
- [ ] Section 4 daemon redeploy successful (systemctl active; journalctl shows admin-clawdy boot)
- [ ] Section 5 Discord slash menu shows the 5 `/gsd-*` entries in `#admin-clawdy`
- [ ] Section 6 UAT-100-A: short-runner inline reply works (no thread spawn for `/gsd-debug`)
- [ ] Section 7 UAT-100-B: long-runner subthread spawn works for `/gsd-plan-phase 100` (thread `gsd:plan:100` + main-channel summary with `Artifacts written:` line)
- [ ] Section 8 UAT-100-C: settingSources NON_RELOADABLE behavior verified (log fires; per-restart effect confirmed; revert restores)
- [ ] Section 8.5 UAT-100-D: `/clawcode-effort` admin-clawdy guard + agent target option works (negative non-admin reject, default self-target, cross-agent target, unknown-agent reject)
- [ ] Section 9 rollback procedure confirmed (do NOT actually run unless smoke tests fail)

On sign-off:

```bash
# Update STATE.md to mark Phase 100 shipped (operator-driven, on dev box):
cd /home/jjagpal/.openclaw/workspace-coding
# edit .planning/STATE.md "Current Position" → "Phase 100 SHIPPED <date>"
# edit .planning/ROADMAP.md Phase 100 status → "Shipped <date>"
git add .planning/STATE.md .planning/ROADMAP.md
git commit -m "docs(100): mark Phase 100 shipped after operator UAT sign-off"
```

---

## Cross-references

- **Plan 100-01** — schema fields (settingSources, gsd.projectDir) consumed in Section 3
- **Plan 100-02** — session-adapter wiring; Sections 4 + 5 verify SDK passthrough
- **Plan 100-03** — differ classification; Section 8 UAT-100-C verifies operator-visible
- **Plan 100-04** — slash dispatcher with auto-thread; Sections 6 + 7 verify
- **Plan 100-05** — Phase 99-M relay extension with artifact paths; Section 7 acceptance criterion includes `Artifacts written:` line
- **Plan 100-06** — `clawcode gsd install` CLI subcommand; Section 2 invokes it
- **Plan 100-07** — clawcode.yaml admin-clawdy fixture; Section 3 references it as the production template

---

*Phase: 100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow*
*Plan: 08*
*Document type: SMOKE-TEST runbook*
*Authored: 2026-04-26*
