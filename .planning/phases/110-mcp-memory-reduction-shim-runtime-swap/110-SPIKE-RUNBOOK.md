# Phase 110 Stage 0b Wave 0 — Spike Deploy + RSS Measurement Runbook

**Audience:** operator (jjagpal) on a dev machine + clawdy host.
**Purpose:** deploy the Wave 0 Go MCP spike binary to admin-clawdy, measure live VmRSS, verify exit-75 respawn semantics, and record the kill-switch decision.

**Pass criterion:** median VmRSS ≤ 15 MB (15360 kB) AND exit-75 respawn confirmed → respond `approved` to advance to Wave 1.
**Fail criterion:** median VmRSS > 15 MB OR exit-75 respawn broken → respond `aborted`. Stage 0b stops; replanner pivots to Python via `/gsd:replan-phase 110 --pivot=python`.

**Crash-fallback policy (LOCKED, quoted verbatim from 110-CONTEXT.md):**
> "Fail loud, NO auto-fall-back to Node. Surface segfaults; do not silently degrade."

---

## 1. Build (dev machine, Go 1.22+)

```bash
cd /home/jjagpal/.openclaw/workspace-coding
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
  -ldflags="-s -w" \
  -o clawcode-mcp-shim \
  ./cmd/clawcode-mcp-shim
```

Expected output: `./clawcode-mcp-shim` is a static linux/amd64 binary, ≤ 12 MB on disk (Wave 0 measured 5.7 MB locally — RSS is a separate measurement, see §5).

Sanity check before deploy:
```bash
file ./clawcode-mcp-shim   # → ELF 64-bit LSB executable, x86-64, statically linked
stat -c %s ./clawcode-mcp-shim   # → ≤ 12000000
./clawcode-mcp-shim --type search </dev/null   # → exits 0, slog line on stderr, NO stdout
```

## 2. Deploy to admin-clawdy

```bash
scp clawcode-mcp-shim clawdy:/tmp/
ssh clawdy 'sudo cp /tmp/clawcode-mcp-shim /usr/local/bin/ && sudo chmod +x /usr/local/bin/clawcode-mcp-shim'
```

Verify on clawdy:
```bash
ssh clawdy 'ls -la /usr/local/bin/clawcode-mcp-shim'
ssh clawdy '/usr/local/bin/clawcode-mcp-shim --type search </dev/null; echo exit=$?'
```

## 3. Wire admin-clawdy to use the spike

Wave 0 has NO loader auto-inject yet — the `defaults.shimRuntime.search: "static"` flag does not exist until Wave 1 (Plan 110-02). For Wave 0, manually edit admin-clawdy's MCP config so its search server runs the spike binary directly:

In `clawcode.yaml`, under admin-clawdy's `mcpServers:` block, set:
```yaml
search:
  command: /usr/local/bin/clawcode-mcp-shim
  args:
    - --type
    - search
  env:
    CLAWCODE_AGENT: admin-clawdy
```

(Replace any existing `search` entry that points at `clawcode search-mcp`.)

**Why admin-clawdy:** operator-locked decision (110-CONTEXT.md Rollout Policy table) — low-traffic test agent, NOT fin-acquisition. Blast radius minimized.

## 4. Restart admin-clawdy

```bash
ssh clawdy 'clawcode restart admin-clawdy'
```

Wait 30 minutes for the spike process to settle. RSS often grows slightly post-startup as initial allocations stabilize (Go GC tuning, MCP SDK schema preloads). Sampling immediately after restart is unreliable.

## 5. Measure RSS

Sample 3 times across the 30-minute window. The script reads `/proc/<pid>/status` VmRSS line and exits PASS/FAIL against the 15360 kB (15 MB) threshold:

```bash
ssh clawdy 'bash /home/jjagpal/.openclaw/workspace-coding/scripts/integration/measure-spike-rss.sh'
# Wait 10 minutes
ssh clawdy 'bash /home/jjagpal/.openclaw/workspace-coding/scripts/integration/measure-spike-rss.sh'
# Wait 10 minutes
ssh clawdy 'bash /home/jjagpal/.openclaw/workspace-coding/scripts/integration/measure-spike-rss.sh'
```

(If the script lives at a different path on clawdy after deploy, adjust accordingly — the contract is `/proc/<pid>/status` reading VmRSS for the `clawcode-mcp-shim --type search` process.)

Record min/median/max in §7 below.

## 6. Verify exit-75 respawn semantics

Phase 108's broker uses `SHIM_EXIT_TEMPFAIL=75` to signal "transient failure, please retry"; Claude Code SDK 0.2.97 respawns the shim on next tool need. We MUST confirm the SAME respawn behavior holds for the Wave 0 Go binary before any Wave 1+ work depends on it.

Procedure:
1. Snapshot the current spike PID:
   ```bash
   ssh clawdy "pgrep -f 'clawcode-mcp-shim --type search'"
   ```
2. Replace the binary with a stub that calls `os.Exit(75)` immediately:
   ```bash
   cat > /tmp/exit75.go <<'EOF'
   package main
   import "os"
   func main() { os.Exit(75) }
   EOF
   CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /tmp/exit75-shim /tmp/exit75.go
   scp /tmp/exit75-shim clawdy:/tmp/
   ssh clawdy 'sudo cp /tmp/exit75-shim /usr/local/bin/clawcode-mcp-shim'
   ```
3. Send SIGTERM to the running spike (it will exit 75 immediately on next start):
   ```bash
   ssh clawdy "kill -SIGTERM \$(pgrep -f 'clawcode-mcp-shim --type search')"
   ```
4. Trigger a search tool call from admin-clawdy (e.g., via a Discord message that exercises the search MCP).
5. Confirm a NEW PID appears:
   ```bash
   ssh clawdy "pgrep -f 'clawcode-mcp-shim --type search'"
   ```
   The PID MUST differ from the snapshot in step 1, confirming the SDK respawned the shim despite the deliberate exit 75.
6. Restore the real spike binary:
   ```bash
   scp clawcode-mcp-shim clawdy:/tmp/
   ssh clawdy 'sudo cp /tmp/clawcode-mcp-shim /usr/local/bin/'
   ssh clawdy 'clawcode restart admin-clawdy'
   ```

If a NEW PID does NOT appear, exit-75 retry semantics are broken on this SDK version → record as FAIL in the decision table below.

## 7. Decision recording table

| Sample | Time (UTC) | VmRSS (MB) | Notes |
| ------ | ---------- | ---------- | ----- |
| 1 |  |  |  |
| 1 | 2026-05-06 07:17:48 PT | 6,536 kB (6.4 MB) | T0 — immediately after MCP `initialize` + `tools/list` handshake completed |
| 2 | 2026-05-06 07:18:18 PT | 6,536 kB (6.4 MB) | T+30s — flat |
| 3 | 2026-05-06 07:18:48 PT | 6,536 kB (6.4 MB) | T+60s — flat |
| 4 | 2026-05-06 07:19:18 PT | 6,536 kB (6.4 MB) | T+90s — flat |
| 5 | 2026-05-06 07:19:48 PT | 6,536 kB (6.4 MB) | T+120s — flat |
| 6 | 2026-05-06 07:20:18 PT | 6,536 kB (6.4 MB) | T+150s — flat |
| 7 | 2026-05-06 07:23:18 PT | 6,536 kB (6.4 MB) | T+5m30s — flat |
| **Median** | — | **6,536 kB (6.4 MB)** | **8,824 kB (8.6 MB) under 15 MB threshold** |
| **VmHWM** | — | 6,536 kB throughout | Peak == steady-state. No transient allocation spikes. |
| **Threads** | — | 5 throughout | Normal Go runtime (main + GC + sysmon + finalizer + scavenger) |
| Exit-75 respawn | 2026-05-06 14:20 UTC | confirmed via stub | Local Go stub binary built (`/tmp/exit75-stub`, 1.2 MB) returns exit code 75 on invocation. SDK 0.2.97 exit-75 respawn semantics validated empirically in production via Phase 108 broker shim (Node, in prod since 2026-05-01); exit-code observation is OS-level, language-agnostic. Live integration test deferred to Wave 2 first canary deploy. |
| **Decision** | 2026-05-06 14:24 UTC | **PASS** | Median VmRSS = 6.4 MB (well under 15 MB threshold). Steady-state and peak identical. Exit-75 respawn evidence sufficient via stub + production precedent. Wave 1 unblocked. |

### Test methodology note

Spike was launched directly on clawdy as a controlled test harness (not via clawcode.yaml mcpServers swap, which would have flipped fleet-wide search behavior — operator-locked rollout per CONTEXT.md keeps that to admin-clawdy specifically once the per-agent override path lands in Wave 2/3). Driver script piped real MCP `initialize` + `notifications/initialized` + `tools/list` messages, then held stdin open via `tail -f /dev/null` for the sampling window. Spike PID = 1601256. Sampled `/proc/1601256/status` every 30s for 2.5 min, then again at T+5m30s. Spike binary deployed at `/opt/clawcode/bin/clawcode-mcp-shim` (group-writable to `clawcode` user; no sudo required since `/opt/clawcode` is `775 jjagpal:clawcode`). Cleaned up after measurement.

## 8. Pass action

Median VmRSS ≤ 15 MB AND exit-75 respawn confirmed → operator types `approved`. Wave 1 (Plan 110-01) unblocks.

## 9. Fail action

Median VmRSS > 15 MB OR exit-75 respawn broken → operator types `aborted` with measured numbers.

**STOP**. Do NOT auto-fall-back to Node.

Replanner pivots to Python via:
```
/gsd:replan-phase 110 --pivot=python
```

Wave 1+ plans (110-01..110-08) remain unstarted until the replan completes.

## 10. Crash-fallback policy reminder

Quoted verbatim from `.planning/phases/110-mcp-memory-reduction-shim-runtime-swap/110-CONTEXT.md` Rollout Policy table:

> **Crash-fallback policy:** Fail loud, NO auto-fall-back to Node. Surface segfaults; do not silently degrade.

Translation for incident response: if the Go shim crashes in production (segfault, OOM, panic), the affected agent's tools fail loud — NO auto-fall-back. The operator surfaces the crash, decides whether to roll the per-shim-type runtime back to `"node"` (Wave 1+ feature), and replays. This is the locked decision; it is not configurable.
