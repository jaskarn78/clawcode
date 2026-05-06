# Phase 110 Plan 07 — Browser Shim Wave 5 Rollout Log

> **Status:** scaffolded 2026-05-06 (Task 1). Phase 1 (admin-clawdy canary) and Phase 2 (full-fleet) gates are operator-driven and recorded in this file as they execute.
>
> **Plan:** [.planning/phases/110-mcp-memory-reduction-shim-runtime-swap/110-07-PLAN.md](110-07-PLAN.md)
> **Wave 2 deploy artifact:** [.planning/phases/110-mcp-memory-reduction-shim-runtime-swap/110-04-SUMMARY.md](110-04-SUMMARY.md)
> **Validation reference:** [.planning/phases/110-mcp-memory-reduction-shim-runtime-swap/110-VALIDATION.md](110-VALIDATION.md) §Manual-Only Verifications row 2 (24-48h dashboard watch)
> **Rollout policy reference:** [.planning/phases/110-mcp-memory-reduction-shim-runtime-swap/110-CONTEXT.md](110-CONTEXT.md) §Rollout Policy (LOCKED 2026-05-05)
>
> **Crash-fallback policy (LOCKED, verbatim):** *"Fail loud, NO auto-fall-back to Node. Surface segfaults; do not silently degrade."* Operator manual rollback only.
>
> **🟥 RED tier — session state OUT of scope:** Browser SESSION STATE (Playwright/Chrome lifecycle) is RED tier and stays daemon-side. This rollout migrates ONLY the IPC translator shim. If session state regresses (lost browser context, broken cookies, missing pages), it's a bug in the migration — rollback immediately. Session state changes are OUT of scope for any shim work; this is the highest-risk shim type because Pitfall §2 (16 MB IPC buffer) most likely surfaces here via `browser_screenshot` payloads.

---

## 1. Deploy Prerequisites Checklist

All six MUST be GREEN on clawdy before flipping `admin-clawdy.shimRuntime.browser`. **Prereq 0 (NEW for browser)** — image rollout (Plan 110-06) MUST be GREEN before browser starts; browser inherits the same fleet-wide deploy artifact (binary + IPC plumbing) and is the LAST shim type in Stage 0b.

| #   | Prerequisite                                                                           | Verify command (run on clawdy)                                                                                            | Expected                                       | Status |
| --- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------ |
| 0   | Plan 110-06 (image rollout) GREEN — fleet stable on Go image shim ≥ 24h                | `cat .planning/phases/110-mcp-memory-reduction-shim-runtime-swap/110-06-ROLLOUT-LOG.md \| grep -E 'fleet-green'`         | one or more `fleet-green` decisions logged    | [ ]    |
| 1   | Daemon serves `list-mcp-tools` IPC method (Plan 110-01)                                | `clawcode ipc call list-mcp-tools '{"shimType":"browser"}' \| jq '.tools \| length'`                                       | integer ≥ 1                                    | [ ]    |
| 2   | Schema enum widened to include `static` (Plan 110-02)                                  | `clawcode config show \| grep -E 'shimRuntime\|static'`                                                                   | shows `static` as a valid value                | [ ]    |
| 3   | Loader resolves `shimRuntime.browser: static` to the static command (Plan 110-02)       | Add a *fake* test agent override `shimRuntime.browser: static` in scratch yaml; `clawcode show-mcp <fake-agent>`           | command line = `/usr/local/bin/clawcode-mcp-shim --type browser` | [ ]    |
| 4   | Binary at `/usr/local/bin/clawcode-mcp-shim` exists, executable, ≤ 12 MB (Plan 110-03) | `ls -l /usr/local/bin/clawcode-mcp-shim && file /usr/local/bin/clawcode-mcp-shim && stat -c%s /usr/local/bin/clawcode-mcp-shim` | ELF 64-bit static, exec bit, size ≤ 12,582,912 | [ ]    |
| 5   | Fleet-stats classifier recognizes binary basename → `runtime: "static"` (Plan 110-02)  | Spawn fake static shim under any agent, `curl localhost:<dashboard-port>/api/fleet-stats \| jq '.mcpFleet[] \| select(.runtime == "static")'` | non-empty result                               | [ ]    |

> **Gate:** if ANY box is unchecked, do NOT proceed to Phase 1. File a blocker against the upstream plan (110-01/-02/-03/-04) instead.

---

## 2. Phase 1 — admin-clawdy Canary Flip (Task 2 checkpoint)

### 2.1 Pre-flip baseline

Capture admin-clawdy's currently-running Node search shim so the post-flip RSS reduction is unambiguous.

```bash
# On clawdy
PRE_PID=$(pgrep -af 'clawcode browser-mcp' | grep -i admin-clawdy | awk '{print $1}')
PRE_RSS=$(awk '/^VmRSS:/ {print $2}' /proc/$PRE_PID/status)
date -u +"%Y-%m-%dT%H:%M:%SZ"; echo "PRE PID=$PRE_PID VmRSS_kB=$PRE_RSS"
```

| Field        | Value                |
| ------------ | -------------------- |
| Captured at  | _yyyy-mm-ddThh:mmZ_  |
| PRE PID      | _<node-pid>_         |
| PRE VmRSS    | _<kB>_ (~140-160 MB expected, Node baseline) |

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
pgrep -af 'clawcode browser-mcp' | grep -i admin-clawdy   # expect: nothing
pgrep -af 'clawcode-mcp-shim --type browser'              # expect: 1 PID under admin-clawdy claude proc
NEW_PID=$(pgrep -f 'clawcode-mcp-shim --type browser' | head -1)
awk '/^VmRSS:/ {print $2}' /proc/$NEW_PID/status         # expect: ≤ 15360 kB (15 MB)
```

Confirm the new PID **differs** from `PRE_PID`.

### 2.4 Smoke test from admin-clawdy

Trigger one `browser_screenshot` tool call from admin-clawdy (via Discord channel or direct CLI prompt). Confirm:

- Tool call returns results identically to before the flip
- No panic in `journalctl -u clawcode --since '5 minutes ago' | grep -E 'panic|TEMPFAIL|exit 75'`
- Claude proc for admin-clawdy did not respawn unexpectedly

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

| Field                         | Value (filled by operator) |
| ----------------------------- | -------------------------- |
| Flip time (UTC)               |                            |
| ConfigWatcher hot-reload OK?  | YES / NO                   |
| Daemon PID unchanged?         | YES / NO                   |
| New shim PID                  |                            |
| Highest VmRSS in 30-min window | _kB_                       |
| Smoke-test result             | PASS / FAIL                |
| journalctl errors (30 min)    | _count_                    |
| Decision                      | PROCEED to watch / ABORT   |

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

> Decision recorded by operator (UTC time + signal): __________________________

---

## 4. Phase 2 — Fleet Rollout (Task 3 checkpoint)

> **Gate:** Phase 2 only proceeds after Phase 1 GREEN signal.

### 4.1 Flip — global default + remove per-agent override

Edit `clawcode.yaml` on clawdy:

```yaml
defaults:
  shimRuntime:
    search: static    # was: node
agents:
  admin-clawdy:
    # shimRuntime override REMOVED — now picks up global default
```

Save. ConfigWatcher hot-reload triggers; daemon PID does NOT change. All 11 fleet agents' search MCP children cycle within ~5 minutes.

### 4.2 Verify all 11 agents flipped

```bash
sleep 300   # 5-minute stabilization window
pgrep -af 'clawcode browser-mcp' | wc -l                  # expect: 0 (zero Node search shims fleet-wide)
pgrep -af 'clawcode-mcp-shim --type browser' | wc -l      # expect: 11 (one per fleet agent)
```

### 4.3 Aggregate RSS measurement

```bash
ssh clawdy '/opt/clawcode/scripts/integration/measure-shim-rss.sh browser'
# (or run locally on clawdy if you're already there)
/home/jjagpal/.openclaw/workspace-coding/scripts/integration/measure-shim-rss.sh browser
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
| fin-acquisition   | `browser_screenshot`        |        |                   |
| _agent 2_         | `browser_screenshot`        |        |                   |
| _agent 3_         | `browser_screenshot`        |        |                   |

### 4.5 /api/fleet-stats — full fleet on static

```bash
curl -s "localhost:<dashboard-port>/api/fleet-stats" \
  | jq '.mcpFleet[] | select(.name == "browser") | {agent, runtime, rssBytes}'
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
- **No automatic fallback code path exists** — and Plan 110-07 inherits source-grep regression tests (`TestRegisterSourceContainsNoFallbackOrRetry`, `TestIntegrationNoSpikeArtifactsInSource`) to prevent future contributors from silently re-introducing one.
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
- RSS measurements at time of incident (use `scripts/integration/measure-shim-rss.sh browser`)
- /api/fleet-stats snapshot
- Operator notes: what triggered the rollback, smoke-test failures, dashboard anomalies
- Recommended next step: replan, redeploy, or pivot runtime (Python translator)

> **Do NOT auto-recover.** Leave the rollback in place until root-cause is documented. Stage 0b stops on `red-rollback` for the affected shim type until replanning unblocks it.

---

## 7. Decision Log

| UTC time            | Phase  | Operator | Signal           | Notes |
| ------------------- | ------ | -------- | ---------------- | ----- |
|                     | 1      |          | green / red      |       |
|                     | watch  |          | green-canary / red-rollback |  |
|                     | 2      |          | fleet-green / fleet-rollback |  |

---

*Scaffolded by Task 1 of Plan 110-07 on 2026-05-06. Phase 1 and Phase 2 sections are populated in real time as the operator drives the gates.*
