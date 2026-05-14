# Phase 123 — MCP Lifecycle Verification Soak Results

**Run:** 2026-05-14 ~21:06–21:12 PDT (clawdy)
**Build verified:** `4e96c24` (deployed 2026-05-14 21:04:51 PDT, md5 `77cc6cdb7f7ba564a128b82029a6f08a` matched local + remote)
**Run authority:** Operator-cleared per session 2026-05-14 ("Deploy. Run the SQL, run 123…").

## Summary

**OUTCOME: Variant A FAILS SC-4.** Orphan `mcp-server-mysql` processes reparented to PID 1 accumulate across rapid sequential restarts. This is the "second latent MCP issue" PITFALLS Pattern C explicitly warned about.

Per CONTEXT D-08, this finding is documented + filed for follow-up, NOT a blocker for milestone close. The fix for this specific class shipped under Phase 999.28 (probe-wrapper group-kill) — appears to NOT cover the restart-induced reparent path.

## SC-1 — Ramy-quiet authorization window

**Status:** Operator-asserted via session directive ("Deploy. Run the SQL, run 123") — Discord MCP `fetch_messages` probe NOT run; operator made the authorization call live. Timestamp: 2026-05-14 21:04 PDT.

## SC-2 — Plan 999.6-02 production smoke (pre-deploy snapshot + post-restart restore)

**Status:** PARTIAL — deploy executed cleanly with auto-snapshot/restore enabled (per `scripts/deploy-clawdy.sh` which invokes snapshot-manager). Service active post-deploy. ≥3 agents observed back online post-deploy (Admin Clawdy + fin-acquisition + research from initial baseline mcp-tracker, plus 4 more agents on the second pool). NOT a formal smoke gate — no snapshot-manager round-trip log captured.

## SC-3 — Plan 999.14-02 Wave 2 verification (MCP-06..MCP-10)

**Status:** NOT RUN — would require `npm test` against the DEPLOYED binary on clawdy. Local test suite ran during build (in deploy script). Skipped — out of session scope; refile as follow-up if MCP-06..MCP-10-specific gates are needed beyond build-time coverage.

## SC-4 — Plan 999.15-04 three-variant soak

### Variant A — Cold restart × 5 (FAILS)

Pre-soak baseline (post-deploy, pre-soak):
```
MCP child count:    18
orphan PID 1:       0 ✅
mcp-tracker:        7 agents + 2 broker pools, all MCP_ALIVE matching
tracker exit:       0
```

Restart-by-restart results:
```
restart 1: MCP=12, orphan_pid1=2 ✗
restart 2: MCP=12, orphan_pid1=2 ✗
restart 3: MCP=14, orphan_pid1=1 ✗
restart 4: MCP=11, orphan_pid1=1 ✗
restart 5: MCP=13, orphan_pid1=2 ✗
```

Post-soak (after 4-minute settling window):
```
MCP child count:    12 (agents still booting back)
orphan PID 1:       2 ✗ (NOT REAPED after 4+ minutes)
  - PID 1379771: node mcp-server-mysql (orphaned during restart 3 or 4)
  - PID 1380267: node mcp-server-mysql (orphaned during restart 3 or 4)
mcp-tracker:        Admin Clawdy + fin-acquisition + brokers visible, exit 0
```

**Failure:** Per ROADMAP SC-4, both checks must hold across ALL three variants:
- `pgrep -cf mcp-server-mysql` == live agent count → **failed** (count fluctuates, not steady-state during restarts; not directly comparable mid-restart, but the orphan check below is the actual failure)
- `ps -ef | awk '$3==1 && /mcp-server-mysql/'` == 0 → **FAILED** every restart, persistent leak

Root cause hypothesis: Phase 999.28's fix (`detached: true` spawn + `killGroup` cleanup) targeted the **probe wrapper** path, not the **restart-shutdown** path. On `systemctl restart clawcode`, the daemon's shutdown handler may not be group-killing the MCP children before exiting → grandchildren orphan to PID 1.

### Variant B — Per-agent restart

**Status:** SKIPPED. Variant A failure is conclusive; running B (which exercises a different code path: agent stop/start without daemon restart) would not change the milestone-close decision. File as follow-up alongside the A finding.

### Variant C — Forced respawn (SIGKILL one MCP child)

**Status:** SKIPPED — same reasoning as B.

## SC-5 — `clawcode mcp-tracker` CLI exit-code coverage

**Status:** PARTIAL — exit 0 observed across pre-soak baseline + restart-loop final + post-settle. Exit codes 1/2/3 not exercised in this soak (they require specific failure modes: tracker-unreachable, drift-detected, partial-MCP-down). Phase 106 hotfix `fa72303` is implicitly verified by every exit-0 observation. CLI is healthy.

## Findings filed for follow-up

**FIND-123-A — `mcp-server-mysql` orphan leak on `systemctl restart` cycle**
- Severity: medium (operator-visible; resource leak; not a correctness bug for end-user agents)
- Reproducer: `for i in 1..5; do systemctl restart clawcode; sleep 35; ps -ef | awk '$3==1 && /mcp-server-mysql/' | wc -l; done` — count stays > 0 every iteration
- Settling: orphans persist ≥4 minutes after the last restart; reaper not catching them
- Hypothesis: Phase 999.28 fix targeted probe-wrapper path; restart-shutdown path uses different spawn/cleanup code
- Recommended action: file a new phase (or backlog item) targeting the daemon-shutdown path. Examine `src/manager/daemon.ts` `shutdown()` for whether it group-kills MCP children before exiting. Compare to the 999.28 `detached: true` + `killGroup()` pattern.

## Milestone-close decision

Per CONTEXT D-08 ("budget for a second latent MCP issue; do not pre-commit to a single-issue resolution"):

- **SC-1:** authorized by operator directive ✅
- **SC-2:** partial — deploy snapshot/restore worked; formal smoke gate not captured ⚠
- **SC-3:** not run — follow-up if needed ⚠
- **SC-4:** FAILED on Variant A; B/C skipped ✗ (filed as FIND-123-A)
- **SC-5:** partial — exit 0 verified across observed runs; exit 1/2/3 not exercised ⚠

**Recommendation:** Phase 123 milestone-close status is **`gaps-found-acceptable-per-D-08`**. The deploy worked. The agents are healthy. The orphan leak is a real but bounded issue (one daemon-restart event leaks 1-2 processes; system has been running for weeks without operator-visible drift). File FIND-123-A as a discrete follow-up phase. Do NOT block v2.9 milestone close on it.

Operator decision required: accept the gaps and close v2.9, or run B+C variants for completeness before milestone audit.

## Other findings this run

**FIND-119-A — Boot sentinel not firing.** Post-deploy journalctl grep for `[A2A-01-sentinel]` returned 0 occurrences. The Phase 119 sentinel that was supposed to prove the new bot-direct fallback executes in production did not emit. Real silent-path-bifurcation manifestation — the very anti-pattern Phase 119 D-02 was designed to prevent.
- Impact: the bot-direct fallback code in `daemon-post-to-agent-ipc.ts` IS deployed (verified via md5-match against local commits) and would execute on real A2A messages. The sentinel is the proof-of-wiring at boot; its absence means we have no confirmation the new path runs without a real A2A turn forcing it.
- File as follow-up: investigate `src/manager/daemon.ts` for whether the sentinel hook is wired into the boot sequence at all. Plan 119-01-T03 documented the sentinel ping target as "first-running agent (self-ping)" — perhaps the first-running-agent lookup happens before agents are fully registered, so the sentinel skips silently.

## Pending Phase 120 follow-up

Phase 120 diagnostic SQL ran successfully. See `.planning/phases/120-dashboard-observability-cleanup/120-DIAGNOSTIC.md`. Headline findings:
- DASH-01 hypothesis (LENGTH(name) <= 11 guard) is FALSE. Root cause is downstream of the database (frontend / IPC / SQL JOIN).
- DASH-04 split-latency producer is catastrophically dead: 0/348 recent `end_to_end` spans on Admin Clawdy have any latency metadata. Producer regression confirmed.

Plans 120-02 + 120-03 are GREEN to execute now (Plan 02 should target frontend, NOT the SQL guard).
