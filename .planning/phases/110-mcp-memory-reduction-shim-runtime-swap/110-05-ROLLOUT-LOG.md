# Phase 110 Plan 05 — Search Shim Wave 3 Rollout Log

> **Status:** scaffolded 2026-05-06 (Task 1). Phase 1 (admin-clawdy canary) and Phase 2 (full-fleet) gates are operator-driven and recorded in this file as they execute.
>
> **Plan:** [.planning/phases/110-mcp-memory-reduction-shim-runtime-swap/110-05-PLAN.md](110-05-PLAN.md)
> **Wave 2 deploy artifact:** [.planning/phases/110-mcp-memory-reduction-shim-runtime-swap/110-04-SUMMARY.md](110-04-SUMMARY.md)
> **Validation reference:** [.planning/phases/110-mcp-memory-reduction-shim-runtime-swap/110-VALIDATION.md](110-VALIDATION.md) §Manual-Only Verifications row 2 (24-48h dashboard watch)
> **Rollout policy reference:** [.planning/phases/110-mcp-memory-reduction-shim-runtime-swap/110-CONTEXT.md](110-CONTEXT.md) §Rollout Policy (LOCKED 2026-05-05)
>
> **Crash-fallback policy (LOCKED, verbatim):** *"Fail loud, NO auto-fall-back to Node. Surface segfaults; do not silently degrade."* Operator manual rollback only.

---

## 1. Deploy Prerequisites Checklist

All five MUST be GREEN on clawdy before flipping `admin-clawdy.shimRuntime.search`.

| #   | Prerequisite                                                                           | Verify command (run on clawdy)                                                                                            | Expected                                       | Status |
| --- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------ |
| 1   | Daemon serves `list-mcp-tools` IPC method (Plan 110-01)                                | `clawcode ipc call list-mcp-tools '{"shimType":"search"}' \| jq '.tools \| length'`                                       | integer ≥ 1                                    | [ ]    |
| 2   | Schema enum widened to include `static` (Plan 110-02)                                  | `clawcode config show \| grep -E 'shimRuntime\|static'`                                                                   | shows `static` as a valid value                | [ ]    |
| 3   | Loader resolves `shimRuntime.search: static` to the static command (Plan 110-02)       | Add a *fake* test agent override `shimRuntime.search: static` in scratch yaml; `clawcode show-mcp <fake-agent>`           | command line = `/usr/local/bin/clawcode-mcp-shim --type search` | [ ]    |
| 4   | Binary at `/usr/local/bin/clawcode-mcp-shim` exists, executable, ≤ 12 MB (Plan 110-03) | `ls -l /usr/local/bin/clawcode-mcp-shim && file /usr/local/bin/clawcode-mcp-shim && stat -c%s /usr/local/bin/clawcode-mcp-shim` | ELF 64-bit static, exec bit, size ≤ 12,582,912 | [ ]    |
| 5   | Fleet-stats classifier recognizes binary basename → `runtime: "static"` (Plan 110-02)  | Spawn fake static shim under any agent, `curl localhost:<dashboard-port>/api/fleet-stats \| jq '.mcpFleet[] \| select(.runtime == "static")'` | non-empty result                               | [ ]    |

> **Gate:** if ANY box is unchecked, do NOT proceed to Phase 1. File a blocker against the upstream plan (110-01/-02/-03/-04) instead.

---

## 2. Phase 1 — admin-clawdy Canary Flip (Task 2 checkpoint)

### 2.1 Pre-flip baseline

Capture admin-clawdy's currently-running Node search shim so the post-flip RSS reduction is unambiguous.

```bash
# On clawdy
PRE_PID=$(pgrep -af 'clawcode search-mcp' | grep -i admin-clawdy | awk '{print $1}')
PRE_RSS=$(awk '/^VmRSS:/ {print $2}' /proc/$PRE_PID/status)
date -u +"%Y-%m-%dT%H:%M:%SZ"; echo "PRE PID=$PRE_PID VmRSS_kB=$PRE_RSS"
```

| Field        | Value                |
| ------------ | -------------------- |
| Captured at  | 2026-05-06 22:42 UTC |
| PRE PID      | (Admin Clawdy used mcp-broker pool; no per-agent Node search-mcp child observed) |
| PRE VmRSS    | Peer Node search-mcp baseline measured: 157,564 kB (153.9 MB) — sample from non-Admin agent |

### 2.2 Flip — per-agent override on admin-clawdy

Edit `clawcode.yaml` on clawdy, add a per-agent override (global default stays `node`):

```yaml
agents:
  admin-clawdy:
    shimRuntime:
      search: static
```

Save the file. ConfigWatcher detects the change and hot-reloads — daemon PID does NOT change. Verify both:

```bash
DAEMON_PID_BEFORE=$(pgrep -f 'clawcode' | head -1)
# (edit + save clawcode.yaml above)
sleep 6
DAEMON_PID_AFTER=$(pgrep -f 'clawcode' | head -1)
[ "$DAEMON_PID_BEFORE" = "$DAEMON_PID_AFTER" ] && echo "OK: daemon PID unchanged" || echo "FAIL: daemon restarted"
journalctl -u clawcode --since '1 minute ago' | grep -iE 'config reloaded|configwatcher'
```

### 2.3 Verify shim child cycle

Within ~30 seconds admin-clawdy's MCP children cycle. The old Node search shim should be gone; a new static shim spawns under the same claude proc.

```bash
pgrep -af 'clawcode search-mcp' | grep -i admin-clawdy   # expect: nothing
pgrep -af 'clawcode-mcp-shim --type search'              # expect: 1 PID under admin-clawdy claude proc
NEW_PID=$(pgrep -f 'clawcode-mcp-shim --type search' | head -1)
awk '/^VmRSS:/ {print $2}' /proc/$NEW_PID/status         # expect: ≤ 15360 kB (15 MB)
```

Confirm the new PID **differs** from `PRE_PID`.

### 2.4 Smoke test from admin-clawdy

Trigger one `web_search` tool call from admin-clawdy (via Discord channel or direct CLI prompt). Confirm:

- Tool call returns results identically to before the flip
- No panic in `journalctl -u clawcode --since '5 minutes ago' | grep -E 'panic|TEMPFAIL|exit 75'`
- Claude proc for admin-clawdy did not respawn unexpectedly

**Result (2026-05-06 ~23:00 UTC): PASS**
- Admin Clawdy returned `2026-05-06 https://www.calendardate.com/todays.htm` — real Brave search result
- Agent self-reported its proc tree showing Go shim PID 2195136 at 6,672 kB RSS vs Node image-mcp + browser-mcp at 147-150 MB
- 0 panics / TEMPFAIL / exit-75 in journalctl since flip
- Claude proc stable (no unexpected respawn)

### 2.5 Three RSS samples across 30 minutes

| Sample | UTC time             | New PID | VmRSS (kB) | VmRSS (MB) | Tool call success | journalctl error count (last 10 min) |
| ------ | -------------------- | ------- | ---------- | ---------- | ----------------- | ------------------------------------ |
| t+0    | _yyyy-mm-ddThh:mmZ_  |         |            |            |                   |                                      |
| t+15   | _yyyy-mm-ddThh:mmZ_  |         |            |            |                   |                                      |
| t+30   | _yyyy-mm-ddThh:mmZ_  |         |            |            |                   |                                      |

**Pass criteria:** all three VmRSS ≤ 15 MB AND all three tool calls succeed AND error count = 0.

### 2.6 /api/fleet-stats verification

```bash
curl -s "localhost:<dashboard-port>/api/fleet-stats" \
  | jq '.mcpFleet[] | select(.agent == "admin-clawdy" and .name == "search")'
```

Expected fields:
- `runtime: "static"`
- `rssBytes` corresponds to ≤ 15 MB

| Captured at | runtime | rssBytes | Pass? |
| ----------- | ------- | -------- | ----- |
|             |         |          |       |

### 2.7 Phase 1 outcome

| Field                         | Value (recorded 2026-05-06 22:42 UTC) |
| ----------------------------- | -------------------------- |
| Flip time (UTC)               | 2026-05-06 22:41 UTC (yaml insert at line 776 — `shimRuntime: { search: static }` after Admin Clawdy.wakeOrder) |
| ConfigWatcher hot-reload OK?  | **PARTIAL** — ConfigWatcher detected the change ("config hot-reloaded {subsystems:[],agents:[]}") and emitted `"Config field 'agents.Admin Clawdy.shimRuntime' changed but requires daemon restart to take effect"`. Per-agent `clawcode restart "Admin Clawdy"` did NOT pick up the override (daemon's pre-computed shim command was cached). Required full systemctl restart. **NOTE: this contradicts the resume doc's claim that single-agent restart is sufficient — see "Operator finding" below.** |
| Daemon PID unchanged?         | NO — full systemctl restart required (PID 2157589 → 2193955). Phase 999.6 snapshot/restore preserved 4 of 5 main agents; personal stalled per Phase 999.33 boot-storm. |
| New shim PID                  | 2195136 (parent claude PID 2194602, agent=Admin Clawdy verified via `/proc/2195136/environ:CLAWCODE_AGENT`) |
| Highest VmRSS at flip + 1 min | **6,504 kB (6.4 MB)** — well under the 15,360 kB / 15 MB ceiling |
| Peer Node search-mcp baseline | 157,564 kB (153.9 MB) — sample from a non-Admin-Clawdy agent post-restart |
| Per-agent savings             | ~151 MB (96% reduction Go-vs-Node) |
| Cgroup memory peak            | 13.3 GB pre-restart → 7.3 GB post-restart (delta dominated by daemon-restart memory cleanup, not the canary) |
| Smoke-test result             | **CONFIRMED GREEN** — Admin Clawdy called `web_search` via Go shim (PID 2195136) and returned `2026-05-06 https://www.calendardate.com/todays.htm` with real Brave results. Agent self-reported proc tree confirming Go shim RSS 6,672 kB vs Node peers at 147-150 MB. Confirmed 2026-05-06 ~23:00 UTC via Discord. |
| journalctl errors             | 0 exit-75 / TEMPFAIL / panic-shim events since restart |
| Decision                      | **PROCEED to watch** (advance to §3 — 24-48h watch window) |

### 2.8 Operator finding — ConfigWatcher cannot hot-reload `shimRuntime`

**Live behavior contradicts plan documentation.** Phase 110-PLAN, 110-CONTEXT, and the morning's resume doc all imply that adding `shimRuntime.search: static` is a hot-reloadable change applied via `clawcode restart <agent>`. Live test 2026-05-06: ConfigWatcher LOGS the change (`"Config field 'agents.Admin Clawdy.shimRuntime' changed but requires daemon restart to take effect"`) but per-agent restart re-spawns the OLD shim command. Only `systemctl restart clawcode.service` actually picks up the new override.

Implication for fleet rollout (Phase 2 §4): the global default flip (`defaults.shimRuntime.search: static`) likely also requires a daemon restart, NOT just ConfigWatcher hot-reload. Plan to schedule the fleet rollout during a Phase 999.6 snapshot/restore-friendly window. Add this finding to a Phase 999.x backlog: "ConfigWatcher: support hot-reload for shimRuntime / mcpServers without full daemon restart."

---

## 3. 24-48h Watch Window

> **Why manual:** [110-VALIDATION.md](110-VALIDATION.md) §Manual-Only Verifications row 2 — production observability over real workload time cannot be unit-tested.

**Dashboard URL:** `http://localhost:<dashboard-port>/api/fleet-stats` (queried daily, captured into table below)

**Watch checklist (sample at minimum t+1h, t+12h, t+24h, t+48h):**

- [ ] admin-clawdy search shim VmRSS holding sub-15 MB
- [ ] No broker error spikes on `/api/fleet-stats` (`brokerErrorRate1m`)
- [ ] No claude-process drift — `pgrep claude | wc -l` matches expected fleet count
- [ ] Zero Go shim crashes — `journalctl -u clawcode --since '24 hours ago' | grep -E 'clawcode-mcp-shim.*panic|TEMPFAIL|exit 75'` returns empty
- [ ] Tool-call success rate from admin-clawdy: no regression vs pre-flip baseline

| t+ | UTC time | VmRSS (kB) | broker err/min | claude proc count | journalctl crash count | Notes |
| -- | -------- | ---------- | -------------- | ------------------ | ---------------------- | ----- |
| 1h |          |            |                |                    |                        |       |
| 12h |         |            |                |                    |                        |       |
| 24h |         |            |                |                    |                        |       |
| 48h |         |            |                |                    |                        |       |

### Operator decision (gate to Phase 2)

| Decision        | Resume signal      | What it means                                                                   |
| --------------- | ------------------ | ------------------------------------------------------------------------------- |
| **GREEN**       | `green-canary`     | All checks pass for 24-48h. Advance to Phase 2 (fleet rollout).                 |
| **RED**         | `red-rollback`     | ANY anomaly (crash, RSS spike, tool failure, FD leak). Execute §6 rollback now. |

> Decision recorded by operator (UTC time + signal): **ACCELERATED** — operator skipped 24-48h watch and expanded canary to 4 agents (general, projects, research + Admin Clawdy) on 2026-05-06 23:30 UTC. See §2.9 below.

### 2.9 Expanded canary — general + projects + research (2026-05-06 23:30 UTC)

Operator authorized acceleration: skip 24-48h single-agent watch; flip search+image+browser shimRuntime on `general`, `projects`, and `research` in the same restart window.

| Agent | search | image | browser | Warm-path-ready? |
|---|---|---|---|---|
| Admin Clawdy | ✅ static | ✅ static | ✅ static | ✅ 16:17:49 UTC |
| fin-acquisition | node | node | node | ✅ 16:18:02 UTC |
| research | ✅ static | ✅ static | ✅ static | ✅ 16:18:12 UTC |
| fin-research | node | node | node | ✅ 16:18:23 UTC |
| finmentum-content-creator | node | node | node | ✅ 16:18:43 UTC |
| general | ✅ static | ✅ static | ✅ static | ✅ 16:18:55 UTC |
| projects | ✅ static | ✅ static | ✅ static | ✅ 16:19:05 UTC |

Go shim process count: **12** (4 agents × 3 types). All PIDs confirmed; all RSS 6.5–7.0 MB. Zero exit-75 / TEMPFAIL / panic in journalctl.

Yaml backup: `/etc/clawcode/clawcode.yaml.bak-pre-fleet-shim-1778109394`

---

## 4. Phase 2 — Fleet Rollout (Task 3 checkpoint)

> **Gate:** Phase 2 now means flipping remaining agents (fin-acquisition, fin-research, finmentum-content-creator, fin-tax, fin-playground) — those not yet on Go shims.

### 4.1 Flip — remaining agents or global default

Either add per-agent shimRuntime overrides for the remaining agents, OR set global default and let per-agent overrides take precedence where shimRuntime is already set. Requires daemon restart per §2.8.

### 4.2 Verify remaining agents flipped

```bash
# After restart
pgrep -af 'clawcode-mcp-shim --type search' | wc -l   # expect: matches autoStart=true agent count
pgrep -af 'clawcode search-mcp' | wc -l                # expect: 0 (all Node search shims gone)
```

### 4.3 Aggregate RSS measurement

```bash
ssh clawdy '/opt/clawcode/scripts/integration/measure-shim-rss.sh search'
# (or run locally on clawdy if you're already there)
/home/jjagpal/.openclaw/workspace-coding/scripts/integration/measure-shim-rss.sh search
```

**Pass criterion:** total < 100 MB (vs ~1.0 GiB Node baseline).

| Field                  | Value           |
| ---------------------- | --------------- |
| Captured at (UTC)      |                 |
| Per-agent VmRSS table  | (paste output) |
| Total VmRSS (kB)       |                 |
| Total VmRSS (MB)       |                 |
| Baseline (~1.0 GiB)    | 1,073,741 kB    |
| Savings vs baseline    | _MB_            |

### 4.4 Smoke test 2-3 random agents (must include fin-acquisition)

> fin-acquisition is the operator's primary trading agent — its tool calls being clean is the operator-defined success signal.

| Agent             | Tool call attempted | Result | journalctl errors |
| ----------------- | ------------------- | ------ | ----------------- |
| fin-acquisition   | `web_search`        |        |                   |
| _agent 2_         | `web_search`        |        |                   |
| _agent 3_         | `web_search`        |        |                   |

### 4.5 /api/fleet-stats — full fleet on static

```bash
curl -s "localhost:<dashboard-port>/api/fleet-stats" \
  | jq '.mcpFleet[] | select(.name == "search") | {agent, runtime, rssBytes}'
```

Expected: ALL 11 entries show `runtime: "static"`. Aggregate matches §4.3 measurement.

### 4.6 Phase 2 outcome

| Field                           | Value                 |
| ------------------------------- | --------------------- |
| Flip time (UTC)                 |                       |
| 11 agents on static?            | YES / NO              |
| Aggregate VmRSS (MB)            |                       |
| Smoke-test results              | ALL PASS / FAIL list  |
| /api/fleet-stats `runtime` count | _<n>_/11 = static     |
| Decision                        | `fleet-green` / `fleet-rollback` |

---

## 5. Crash-Fallback Policy Reminder

> Verbatim from [110-CONTEXT.md](110-CONTEXT.md) Rollout Policy (LOCKED 2026-05-05):
>
> **"Fail loud, NO auto-fall-back to Node. Surface segfaults; do not silently degrade."**

Operationally:

- A Go shim crash (panic, segfault, TEMPFAIL) is surfaced via `journalctl -u clawcode` and the SDK respawn loop.
- If respawn flapping persists, the operator manually flips the affected agent (or fleet) back to `node` per §6.
- **No automatic fallback code path exists** — and Plan 110-04 ships source-grep regression tests (`TestRegisterSourceContainsNoFallbackOrRetry`, `TestIntegrationNoSpikeArtifactsInSource`) to prevent future contributors from silently re-introducing one.
- File a GitHub issue with: journalctl excerpts (last 5 min before crash), shim PID + signal, RSS at time of crash.

---

## 6. Rollback Procedure (LOCKED — manual only)

If Phase 1 → RED, Phase 2 → RED, or any post-rollout incident requires reverting search to Node:

### 6.1 Full rollback (revert global default)

```yaml
# clawcode.yaml
defaults:
  shimRuntime:
    search: node    # was: static
```

Save → ConfigWatcher reload → next MCP child spawn for each agent uses Node again. Daemon PID does NOT change.

### 6.2 Scoped rollback (single troubled agent)

If only one agent regresses (and the other 10 are healthy on `static`):

```yaml
# clawcode.yaml
agents:
  troubled-agent:
    shimRuntime:
      search: node    # per-agent override — fleet default stays static
```

### 6.3 Post-rollback artifacts

File an issue against this repo with:

- journalctl excerpts (look for `clawcode-mcp-shim.*panic`, `TEMPFAIL`, `exit 75`)
- RSS measurements at time of incident (use `scripts/integration/measure-shim-rss.sh search`)
- /api/fleet-stats snapshot
- Operator notes: what triggered the rollback, smoke-test failures, dashboard anomalies
- Recommended next step: replan, redeploy, or pivot runtime (Python translator)

> **Do NOT auto-recover.** Leave the rollback in place until root-cause is documented. Stage 0b stops on `red-rollback` for the affected shim type until replanning unblocks it.

---

## 7. Decision Log

| UTC time            | Phase  | Operator | Signal           | Notes |
| ------------------- | ------ | -------- | ---------------- | ----- |
| 2026-05-06 22:42 UTC | 1     | jjagpal  | green            | Admin Clawdy on Go shim PID 2195136 RSS 6.4 MB; daemon restart was required (vs hot-reload-only — see §2.8). 0 exit-75. Smoke test deferred to operator. |
|                     | watch  |          | green-canary / red-rollback |  |
|                     | 2      |          | fleet-green / fleet-rollback |  |

---

*Scaffolded by Task 1 of Plan 110-05 on 2026-05-06. Phase 1 and Phase 2 sections are populated in real time as the operator drives the gates.*
