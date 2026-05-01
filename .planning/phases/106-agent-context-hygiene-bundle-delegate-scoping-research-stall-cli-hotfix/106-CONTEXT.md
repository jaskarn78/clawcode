# Phase 106: Agent context hygiene bundle — delegate scoping + research stall + CLI hot-fix — Context

**Gathered:** 2026-05-01
**Status:** Ready for planning
**Mode:** Auto-generated (overnight autonomous run; bundles three loose ends from 2026-04-30 session)

<domain>
## Phase Boundary

Three small infrastructure / agent-prompt-rendering fixes bundled into one ship. All emerged 2026-04-30; none individually big enough for own phase. Same touch points (system-prompt assembly, daemon MCP lifecycle, IPC dispatch) — bundle is cheaper than 3 separate deploys.

### Pillar A — Delegate map should NOT inherit into spawned subagent system prompts (DSCOPE-01..04)

**Symptom (verified 2026-04-30 ~15:13 PT):** After 999.13 deploy with `delegates: { research: fin-research }` on fin-acquisition, when fin-acq spawned a fin-research subagent thread, fin-research-as-spawned-subagent emitted "I'll spawn a focused research agent to handle this" — tried to recursively call itself. SDK recursion guard blocked the actual spawn; agent stalled instead of pivoting.

**Root cause (hypothesis):** `subagentThreadSpawner.ts` (or equivalent) inherits the parent agent's full system prompt into the spawned subagent. So fin-research-as-spawned-subagent saw fin-acq's `delegates` directive ("research → fin-research") and tried to apply it. The directive is INTENDED for the primary (orchestrator) agent's session, NOT for the spawned subagent's session.

**Fix:** Gate the `delegates` directive rendering by an `isSubagent` (or similar — `spawnContext`, `agentRole`) flag. When assembling the system prompt for a spawned subagent, the delegate block is omitted entirely. Primary agents still see the directive normally.

**Touch points (planner confirms via grep):**
- `src/manager/context-assembler.ts` — `delegatesBlock` injection from 999.13 Plan 01. Needs a context flag.
- `src/discord/subagent-thread-spawner.ts` (or wherever subagent prompt is built). Needs to pass `isSubagent: true` when calling the prompt assembler.
- `src/manager/session-config.ts` — primary-agent prompt assembly. Continues to pass `isSubagent: false` (or default).
- `src/config/loader.ts` — `renderDelegatesBlock` already exists. Add the gate inside, OR move the gate to the caller.

**Decision deferred to plan:** EITHER renderDelegatesBlock returns empty for subagents (add `isSubagent` param) OR the caller skips calling renderDelegatesBlock when assembling subagent prompts. The latter is cleaner — keeps the renderer pure.

**Yaml fan-out restored after the fix lands:** same 8 channel-bound agents that were in the original 999.13 yaml fan-out:
- finmentum group → `delegates: { research: fin-research }`: fin-acquisition, fin-tax, fin-playground, finmentum-content-creator
- non-finmentum group → `delegates: { research: research }`: test-agent, personal, general, projects
- Admin Clawdy: omit (bespoke SOUL contract overlaps)
- research / fin-research themselves: omit (specialists, no delegates of their own)

### Pillar B — Research agent boot stall (STALL-01..02)

**Symptom (verified 2026-04-30 22:09:24 PT after 999.12 deploy):** Snapshot listed 6 agents to auto-start. 4 reached `warm-path ready` within 2-4 min. **2 — `research` and `fin-research` — never reached warm-path-ready.** They:
- Registered schedules at 22:09:18 ✓
- Started memory-scanner at 22:09:23 ✓
- Then... silence. No `warm-path ready` log, no error, no crash report.

**Yaml is correct** (autoStart=true, model=opus, effort=high — all set 2026-04-30 in quick-260430-po4). Yaml unchanged since.

**Root cause hypotheses (planner / researcher prioritizes):**
1. **MCP cold-start hang:** research has 5 MCPs (`brave-search`, `playwright`, `browserless`, `fal-ai`, `google-workspace`). One of them might be hanging during boot — e.g. playwright trying to download a browser, browserless waiting for an HTTP service, fal-ai contacting an API that's slow. fin-research has even more (`1password`, `finnhub`, `finmentum-db`, `brave-search`, `playwright`, `google-workspace`, `fal-ai`, `browserless`, `finmentum-content`). MORE MCPs = more chance of one hanging.
2. **SDK respawn loop:** the agent's `claude` subprocess might have spawned, errored, respawned — the warm-path machinery races and never settles. Phase 999.15 reconciler catches stale claudePid but only if the agent has been registered with the tracker, which doesn't happen until first warm-path-ready.
3. **MCP env env-var resolver:** if any `op://` reference in the env-block fails (1Password rate limit / token rotation), agent.start might silently hang. fin-research has `1password` MCP with op:// refs.
4. **Heartbeat warmup-probe interlock:** Phase 999.12's HB-02 active-turn skip might interact badly with boot phase. Unlikely but worth checking.

**STALL-01 — Investigation:** before writing code, instrument and reproduce. SSH to clawdy, run:
```bash
ssh clawdy 'sudo -u clawcode bash -lc "node /opt/clawcode/dist/cli/index.js start research"'
sleep 60
# capture journalctl + ps tree + MCP children list during the start
```

If the issue reproduces deterministically: identify the hung MCP server. Fix or document.

**STALL-02 — Warmup-timeout telemetry:** REGARDLESS of root cause, the silent-stall-during-boot is unacceptable. Add a warmup-timeout check: if `agent.start()` hasn't reached `warm-path ready` within 60s, log:
```json
{
  "level": 50,
  "agent": "research",
  "elapsedMs": 60000,
  "lastStep": "memory-scanner-watching" | "mcp-load-pending" | ...,
  "mcpServersConfigured": ["brave-search", "playwright", ...],
  "mcpServersLoaded": [...],
  "mcpServersPending": [...],
  "msg": "agent warmup-timeout — boot stalled, no warm-path-ready"
}
```

Operator can grep this on next stall and immediately see which MCP didn't load. This converts silent failure → loud failure.

### Pillar C — `clawcode mcp-tracker` CLI hot-fix (TRACK-CLI-01)

**Symptom (verified 2026-04-30 17:06 PT after 999.15 deploy):** `clawcode mcp-tracker` returns:
```
Error: Invalid Request
```

**Root cause (hypothesis):** Mismatch between IPC handler registration (`daemon.ts` `routeMethod` dispatch) and CLI client request shape. Likely:
- Method name typo: CLI sends `mcp-tracker-snapshot` but daemon registered `mcpTrackerSnapshot` (or some hyphen/camelCase drift)
- OR zod schema validation rejecting empty params object
- OR missing case branch in routeMethod

**Fix path (planner confirms):**
1. Find IPC method name registered in `daemon.ts:5285+` dispatch
2. Find CLI request method in `src/cli/commands/mcp-tracker.ts`
3. Match them up
4. Test end-to-end with daemon running

Probably a 1-character or 1-line fix. Tests for the CLI passed in 999.15-03 because they mocked IPC; the production wiring has a string-mismatch.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices at Claude's discretion — three small fixes, scope locked. Use established conventions:

- **Phase 999.13 substrate** — `renderDelegatesBlock` and `delegatesBlock` injection in `context-assembler.ts` already exist. DSCOPE extends them.
- **Phase 999.6 telemetry pattern** — `level: 50` warn logs with structured fields for operator-grep.
- **Phase 999.15 IPC pattern** — `sendIpcRequest(SOCKET_PATH, "method-name", params)` shape. Easy to verify end-to-end.

### Determinism preferences

**DSCOPE:**
- Subagent prompt assembly path: identify it AND inject the `isSubagent` flag at exactly one place. NO duplicate "skip delegates" guards in multiple files.
- Tests assert byte-identical primary-agent prompt (regression lock from 999.13 Plan 01).
- Tests assert byte-identical subagent prompt across "config has delegates" vs "config does NOT have delegates" cases (the directive is invisible to subagents either way).

**STALL:**
- INVESTIGATION FIRST: don't assume MCP cold-start is the cause. Reproduce on clawdy with controlled steps. If reproduce fails (research starts cleanly), the issue may have been a one-off transient. STALL-02 telemetry still ships regardless to catch future stalls.
- Telemetry log line is structured (parseable). Operator should be able to `journalctl ... | grep "warmup-timeout" | jq .mcpServersPending` and immediately know which MCP hung.

**TRACK-CLI:**
- Match daemon and CLI sides verbatim. Use string constants if both sides reference a method name, share via a common types module.

**ALL pillars:**
- Tiny diffs. DSCOPE ~15 lines. STALL telemetry ~30 lines. CLI fix ~5 lines.
- All existing tests stay green.
- No new npm deps.
- Deploy gate: ALL CHANNELS silent ≥30 min on non-bot `messageCreate` events. Check via:
  ```bash
  ssh clawdy 'journalctl -u clawcode --since "31 min ago" --no-pager | grep "messageCreate" | grep "\"bot\":false" | wc -l'
  ```
  If 0 → deploy. If >0 → hold and re-check in 5 min loop.

### Non-negotiables

- **Subagent prompts MUST NOT contain the `delegates` directive when the parent agent has it set.** Test pinned.
- **Yaml fan-out only after DSCOPE GREEN.** Don't restore the delegate map until the recursion bug is impossible.
- **STALL-02 telemetry logs at level 50 (error/warn, not info).** Operators must see it.
- **Deploy ONLY when channels are silent ≥30 min.** Not negotiable. If still active at end of overnight window, hold and report state at wake-up.
- **No new npm deps.**
- **Tests stay green** (Phase 999.6, 999.12, 999.14, 999.15 + the rest).

</decisions>

<code_context>
## Existing Code Insights

Detailed exploration deferred to plan-phase RESEARCH.md. Anchors to verify:

### DSCOPE
- `src/manager/context-assembler.ts` — `delegatesBlock` injection from 999.13 Plan 01.
- `src/config/loader.ts` — `renderDelegatesBlock(delegates: Record<string,string>): string` ~line 670+.
- `src/manager/session-config.ts` — primary agent prompt assembly.
- `src/discord/subagent-thread-spawner.ts` — subagent prompt assembly (find via grep).

### STALL
- `src/manager/session-manager.ts` — `agent.start()` flow.
- `src/manager/session-adapter.ts` (or similar) — SDK call site.
- `src/manager/warm-path*.ts` — warm-path probe.
- Existing `level: 50` patterns: search `grep -nE "level..:50" src/manager/` for analogues.

### TRACK-CLI
- `src/manager/daemon.ts` IPC dispatch ~line 5285+ — find `mcp-tracker-snapshot` registration
- `src/cli/commands/mcp-tracker.ts` — find request method name
- `src/manager/mcp-tracker-snapshot.ts` (the IPC handler from 999.15-03)

### Reusable Patterns
- Phase 999.13 directive injection rail (`DEFAULT_SYSTEM_PROMPT_DIRECTIVES`)
- Phase 999.6 atomic write + telemetry log pattern
- Phase 999.15 reconciler diff-based logging

</code_context>

<specifics>
## Specific Ideas

### Today's empirical evidence

**DSCOPE bug trace (Discord screenshot from 2026-04-30 ~15:13 PT):**
- ClawdyV2: "Problem spotted. The fin-research agent's first message says: 'I'll spawn a focused research agent to handle this.'"
- Net: fin-research-as-subagent tried to spawn another subagent. Recursion guard blocked it. Agent stalled.

**STALL bug trace (2026-04-30 22:09 PT after 999.12 deploy):**
- 22:09:18 research/fin-research: schedules registered ✓
- 22:09:23 research/fin-research: memory-scanner watching ✓
- 22:11:41 fin-acquisition warm-path ready ✓
- 22:11:51 Admin Clawdy warm-path ready ✓
- 22:12:51 finmentum-content-creator warm-path ready ✓
- *No subsequent warm-path-ready events for research or fin-research*
- `clawcode status` ~22:11 PT: research = stopped, fin-research = stopped

**TRACK-CLI bug trace (2026-04-30 17:06 PT):**
```
$ clawcode mcp-tracker
Error: Invalid Request
```

### Deploy gate channel set

Channels to monitor for the all-channels-silent-30-min gate:
- `1481670479017414767` (fin-acquisition / #finmentum-client-acquisition) — Ramy's primary
- `1486348188763029648` (finmentum-content-creator) — operator's content workflow
- `1494117043367186474` (Admin Clawdy) — operator orchestration
- Other channels with active routing (TBD by daemon's bound channels list)

Gate criterion: `journalctl -u clawcode --since "31 min ago" --no-pager | grep "messageCreate" | grep '"bot":false' | wc -l` returns `0`.

### Verification commands (post-deploy on clawdy)

```bash
# 1. DSCOPE: spawn a fin-research subagent from fin-acquisition, verify NO recursion
# (operator-driven; can't fully automate without Ramy)

# 2. STALL: trigger a fresh research agent start, verify warm-path completes within 60s OR
# warmup-timeout telemetry fires
ssh clawdy 'sudo -u clawcode node /opt/clawcode/dist/cli/index.js stop research; sleep 5; sudo -u clawcode node /opt/clawcode/dist/cli/index.js start research'
sleep 70
ssh clawdy 'journalctl -u clawcode --since "2 min ago" --no-pager | grep -E "warm-path ready|warmup-timeout"'

# 3. TRACK-CLI: should now return formatted table
ssh clawdy 'sudo -u clawcode node /opt/clawcode/dist/cli/index.js mcp-tracker'
```

</specifics>

<deferred>
## Deferred Ideas

- **Discord bridge zombie-connection resilience** — separate phase
- **new-reel skill rebuild** — separate, multi-day, requires research
- **999.13 anti-recursion directive text** — rejected; the proper fix (DSCOPE) makes the directive invisible to subagents in the first place, no anti-recursion guard needed
- **MCP cold-start parallelization** — separate optimization; out of scope here. STALL pillar focuses on detection (telemetry), not optimization.
- **CLI subcommand renaming for clarity** (e.g. `mcp-tracker` → `mcp-pids`) — TRACK-CLI keeps the existing name; just fixes the bug.

</deferred>
