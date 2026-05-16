---
status: SUPERSEDED-BY-116 (folded into Phase 116 dashboard redesign as feature F02)
superseded_at: 2026-05-08
superseded_by: Phase 116
---

# Phase 999.38 — SUPERSEDED-BY-116

**Status:** Folded into Phase 116 (Dashboard redesign) as feature F02 on 2026-05-08.

Per-model SLO recalibration logic ships in Phase 116's scaffolding wave (`slos.ts` per-model threshold config + `clawcode.yaml` schema extension) and surfaces visually in F03 agent tile grid + F07 tool latency split panel + F11 three-panel inspector. The "every opus tile shows red" frustration that 999.38 was scoped to address standalone is fully absorbed.

Phase 116 unlocked by Phase 115's `tool_execution_ms` vs `tool_roundtrip_ms` split metric, which made meaningful per-model SLOs computable for the first time.

---

## Original 999.38 capture (2026-05-06) — preserved for audit trail

phase: 999.38
title: Dashboard SLO recalibration — per-model latency targets
status: BACKLOG
priority: P2 (UX/observability — not breaking work, but every opus agent shows red)
captured_from: operator report 2026-05-06 07:15 PT
captured_by: admin-clawdy
target_milestone: TBD
---

# Phase 999.38 — Dashboard SLO recalibration

## Symptom

Operator reports: "Why is everything showing as slow in the dashboard for
my agents?" Including fin-acquisition (sonnet) — not just opus agents.

Screenshot from Admin Clawdy dashboard tile (opus, 1d 13h uptime, 11
restarts) shows nearly every tool tagged `[SLOW]`:

```
first_token         p50 14,982 ms   SLO 2,000 ms p50
end_to_end          p50 38,379 ms   SLO 6,000 ms p95
tool_call           p50 65,289 ms   SLO 1,500 ms p95
Read [SLOW]         p50 83,433 ms
Edit [SLOW]         p50 83,596 ms
Grep [SLOW]         p50 93,881 ms
Bash [SLOW]         p50 47,039 ms
WebFetch [SLOW]     p50 170,800 ms
mcp__playwright__browser_navigate p50 170,532 ms
mcp__1password__vault_list        p50 264,635 ms
```

Cache hit rate 87% (healthy). Context 0%. Pipeline is fine.

## Diagnosis

Two distinct issues:

### 1. SLO targets are model-class blind (the dominant cause)

Current SLO bands look calibrated for sonnet/haiku response times but
**every agent on the fleet uses the same thresholds regardless of model**.
- `first_token p50 SLO = 2,000ms` is reasonable for haiku, tight for
  sonnet, **physically impossible for opus** (5–15s is the natural
  range for opus first-token latency).
- `tool_call SLO = 1,500ms p95` measures *time-to-first-tool-call* which
  includes model thinking. Opus thinks longer = always over budget.

Result: the dashboard reports a problem that isn't a problem for ~50% of
the fleet. Operators learn to ignore the [SLOW] tags, which means real
slow signals (see #2) get drowned out.

### 2. There ARE genuinely slow tool calls hidden in the noise

These are real problems:
- `mcp__playwright__browser_navigate` p50 170s — cold playwright boot
  every spawn
- `mcp__1password__vault_list` p50 264s — cold 1P MCP boot, network
  round-trip to 1P
- `mcp__1password__item_lookup` p50 29s — same cold-start pattern
- `WebFetch` p50 170s — varies by target

These warrant investigation but get lost when every tool has [SLOW]
flag.

## Fix proposal

**Phase A — per-model SLO map.**
Define SLO bands per model class:

```yaml
slos:
  haiku:
    first_token_p50_ms: 1000
    end_to_end_p95_ms: 4000
    tool_call_p95_ms: 1500
  sonnet:
    first_token_p50_ms: 3000
    end_to_end_p95_ms: 8000
    tool_call_p95_ms: 4000
  opus:
    first_token_p50_ms: 8000      # opus is fundamentally slower
    end_to_end_p95_ms: 30000
    tool_call_p95_ms: 12000
```

Dashboard reads agent's configured model, looks up the right band.

**Phase B — separate model-thinking from tool-execution timing.**
`tool_call` SLO conflates two things:
1. Time spent in the model deciding to call the tool
2. Time spent actually executing the tool

Split into:
- `tool_decision_ms` (time from prior chunk to tool_use event) — model-
  bound, lives under model SLO
- `tool_execution_ms` (time from tool_use to tool_result) — tool-bound,
  lives under tool SLO

Cold-start of MCP servers is its own category and should be excluded
from p50 (counted as boot, not steady-state).

**Phase C — stuck-tool detection.**
A tool whose p95/p50 ratio is normal but whose absolute p50 is high
(playwright_navigate, 1password_vault_list) needs its own "cold start
suspected" indicator, not a [SLOW] tag that implies a problem to fix.

## Investigation tasks

1. Locate dashboard SLO config. Likely a single map in
   `src/dashboard/...` or shared with daemon telemetry config.
2. Read agent → model resolution path. Confirm the dashboard already
   knows each agent's configured model (it should — see the
   `warm 2321ms` hint in the Admin Clawdy tile).
3. Validate empirically: pull p50 first_token over a 7-day window for a
   haiku agent + a sonnet agent + an opus agent. Use those as the new
   baseline + 10–20% headroom for the SLO target.
4. Add a `cold_start: true` annotation when a tool call is the first
   invocation of an MCP server in this session.

## Blast radius

Pure observability config change. No agent runtime impact, no daemon
restart needed for the SLO map (hot-reloadable via the existing
ConfigWatcher path used in 98ff1bc).

## Success criteria

- Healthy opus agents show green SLO indicators when behaving normally
- Genuine slow signals (cold MCP boot, real long-running tools) still
  surface but with appropriate annotation, not blanket [SLOW]
- Operator can trust the dashboard tags as actionable signals again

## Sibling work

- Quick task `260501-i3r` (relay-skipped diagnostic) — same observability
  surface, different concern
- 999.36 (subagent UX trio) — distinct but operators experience them
  together as "things look slow / wrong"
