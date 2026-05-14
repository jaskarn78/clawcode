# Backlog: deploy-clawdy.sh — agent-workspace prompt-corpus rsync

## 999.54 — Extend `scripts/deploy-clawdy.sh` to ship per-agent prompt-corpus files alongside daemon binary + dashboard + `.planning/`

Today `deploy-clawdy.sh` syncs three trees from dev → clawdy on every deploy:

1. Daemon binary (`dist/cli/index.js`)
2. Dashboard SPA (`dist/dashboard/spa/`)
3. `.planning/` tree

It does NOT sync `~/.clawcode/agents/<agent>/` — the per-agent workspace where prompt-corpus files (`AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `HEARTBEAT.md`, `TOOLS.md`, `skills/*/SKILL.md`) live. Result: prompt-corpus edits made in the dev workspace never reach production unless the operator manually `scp`s + `sudo cp`s each changed file. The 2026-05-14 Phase 119 Plan 04 closeout surfaced this gap as the blocker on SC-4 (HEARTBEAT_OK soak couldn't start because the agent-workspace commit `e634b7b` had nowhere to ride to prod).

### Why this matters

Prompt-corpus IS part of the daemon's effective behavior. An agent's `AGENTS.md` / `SOUL.md` / `HEARTBEAT.md` instructions are read by the LLM on every session boot and shape every turn — they're as deploy-relevant as the daemon binary. Today they're a soft side-channel that ships out-of-band, which is the exact "silent path bifurcation" pattern flagged in `feedback_silent_path_bifurcation` memory: dev and prod can quietly diverge on prompt content with no operator-visible signal.

### Constraints (why this isn't a one-liner `rsync ~/.clawcode/agents/ clawdy:...`)

Agent workspaces are NOT pure prompt-corpus. The `projects` agent's workspace alone has ~9000 files: media/uploads, daily-notes (`memory/YYYY-MM-DD.md`), `MEMORY.md` curated long-term memory, `state/` runtime state, `.openclaw/` legacy migration cruft, `.clawmetry-*.db` telemetry, `audits/` snapshots, scripts, `.backups/` directories. A blanket `rsync --delete` would:

- **Clobber production-only operational state** — `memory/` daily-notes the agent has written on prod since the last dev sync; `state/active-state.yaml` produced per the Phase 125 active-state header; `.clawmetry-*.db` cgroup metrics; agent-self-spawned `.backups/` directories.
- **Push dev-only experiment debris to prod** — temp PNGs, half-finished scripts, large video assets that should stay on the dev host.
- **Race the agent's own writes** — agents write to `memory/YYYY-MM-DD.md` mid-session; an inopportune rsync mid-write produces a half-truncated file.

### Required shape — allowlist sync, not blanket rsync

The deploy stanza must use an `--include`/`--exclude` allowlist that ships ONLY prompt-corpus files. Proposed allowlist (treated as canonical):

```
AGENTS.md
HEARTBEAT.md
SOUL.md
IDENTITY.md
USER.md
TOOLS.md
clawcode.yaml      (the per-agent yaml if one exists — distinct from /etc/clawcode/clawcode.yaml)
skills/            (entire directory)
skills/**          (all files inside)
```

Explicit denylist (never sync):

```
memory/            (daily notes, MEMORY.md, episodes — agent writes these)
state/             (active-state, runtime state — daemon writes these)
.openclaw/         (legacy migration)
.clawmetry-*.db    (telemetry)
.clawmetry-*.json  (telemetry)
.backups/          (agent-self-spawned)
audits/            (audit snapshots)
.git/              (per-agent VC if any)
*.png *.jpg *.mp4 *.mov *.wav *.mp3 *.zip  (media artifacts)
*.py *.php *.sh    (one-off scripts — should live in skills/ if they're permanent)
```

The rsync command shape (mirrors the existing `.planning/` stanza):

```bash
PROMPT_CORPUS_STAGING="$REMOTE_USER@$HOST:~/clawcode-staging-agents/<agent>/"
PROMPT_CORPUS_DEPLOY="/home/clawcode/.clawcode/agents/<agent>/"

rsync -az \
  --include='AGENTS.md' --include='HEARTBEAT.md' --include='SOUL.md' \
  --include='IDENTITY.md' --include='USER.md' --include='TOOLS.md' \
  --include='clawcode.yaml' \
  --include='skills/' --include='skills/**' \
  --exclude='*' \
  "$HOME/.clawcode/agents/<agent>/" "$PROMPT_CORPUS_STAGING"

# server-side: cp into place + chown
ssh clawdy "sudo sh -c \"rsync -a $PROMPT_CORPUS_STAGING $PROMPT_CORPUS_DEPLOY && chown -R clawcode:clawcode $PROMPT_CORPUS_DEPLOY\""
```

Iterate over each agent in `clawcode.example.yaml`'s `agents:` list (or read the production yaml's agents array and sync each name). Idempotent — re-running redeploys with no changes is a no-op.

### Acceptance criteria

- `scripts/deploy-clawdy.sh` synchronizes each agent's prompt-corpus files alongside the daemon binary on a normal deploy.
- Dry-run mode (`--dry-run`) lists which prompt-corpus files would change per agent.
- Production-only operational state under `memory/`, `state/`, `.clawmetry-*`, `.backups/`, `audits/`, media files, scripts is NOT touched by the sync.
- A test deploy ships a known prompt-corpus change (e.g. add a sentinel line to `~/.clawcode/agents/test-agent/AGENTS.md`) and verifies the line appears at `/home/clawcode/.clawcode/agents/test-agent/AGENTS.md` on clawdy post-deploy.
- Re-running deploy with no changes produces zero modifications under `/home/clawcode/.clawcode/agents/*/` (idempotent).

### Direct unblock for Phase 119 SC-4

Once this lands, the next `deploy-clawdy.sh` invocation will ship the local `e634b7b` agent-workspace commit (4 prompt-corpus sites + new `skills/cron-poll/SKILL.md`). At that point:

1. SC-4 24h soak window can start.
2. Operator surfaces to projects agent: "Recreate your TMUX_POLL crons per `skills/cron-poll/SKILL.md`" (item B in `119-PHASE-SUMMARY.md`).
3. 24h later, `journalctl -u clawcode --since "24 hours ago" | grep -c "HEARTBEAT_OK.*projects"` returns `0` → SC-4 verified.

### Non-goals

- **NOT a generalized "deploy agent state" mechanism.** This ships PROMPT-CORPUS only. Runtime state (memory, telemetry, secrets, db files) stays on the side of whichever host produces it.
- **NOT a two-way sync.** One-direction (dev → prod). Prod-side prompt-corpus edits (rare — typically the operator copies a prod-state change back into dev manually) remain out of scope.
- **NOT a per-file change-detection optimizer.** rsync's mtime/size diff is sufficient; no need for content-hash-aware deploy.

### Sequencing

- Single-task plan: extend `deploy-clawdy.sh` with the agent-workspace stanza + allowlist + dry-run support.
- No code changes outside the deploy script.
- Wave 1 of whichever vNext milestone takes it. Naturally pairs with any other deploy-tooling improvements.

### Related

- **Phase 119 Plan 04** (HEARTBEAT_OK suppression) — directly unblocked by this. Today the `e634b7b` agent-workspace commit has no automated path to clawdy; the operator-runbook section in `119-PHASE-SUMMARY.md` "Outstanding operator actions, Item A" describes the one-off manual sync that would become automatic.
- **`feedback_silent_path_bifurcation`** — exact pattern this mitigates. Dev/prod prompt-corpus drift is silent today; deploy-time sync makes drift impossible.
- **Phase 100** (admin-clawdy + GSD-via-Discord) — admin-clawdy lives at `/tmp/admin-clawdy` in dev but `/opt/clawcode-projects/sandbox` on prod (per `gsd.projectDir`). The deploy stanza should handle agents whose dev-side workspace path differs from their prod-side path (or skip them if the local path doesn't exist).
- **CLAUDE.md "Deploy" section** — when this lands, that section should be updated to reflect that prompt-corpus changes propagate via `deploy-clawdy.sh` automatically (today it implies daemon-binary only).

### Reporter

Jas, 2026-05-14 (surfaced during Phase 119 Plan 04 closeout — operator's "can we just deploy it with the next deploy?" question revealed the gap).
