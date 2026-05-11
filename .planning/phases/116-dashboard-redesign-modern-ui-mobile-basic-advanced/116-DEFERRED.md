# Phase 116 — Deferred items

Items intentionally NOT shipped in Phase 116, captured here for backlog promotion if/when demand surfaces.

---

## F19 — Swim-lane timeline (fleet concurrent activity)

**Original spec:** Tier 3 polish — canvas-rendered horizontal timeline with one lane per agent, events as colored blocks. Shows IPC timing correlations across agents. Pattern from disler/claude-code-hooks-multi-agent-observability.

**Original estimate:** 6-8h

**Deferred:** 2026-05-11 (operator decision during plan-mode review)

**Rationale:**
- **Value-cost trade-off:** Value rated ★★★ (medium), cost rated H (high). Below the Tier 3 polish bar.
- **Functional overlap with F12:** F12 trace waterfall (shipped in Plan 116-04) already provides per-turn timing visibility for each agent. F19's incremental value is multi-agent CORRELATION (e.g., "when admin-clawdy fired send_to_agent → fin-research, did fin-research's first_token start within X ms?"). That's a useful operator question, but the demand for it isn't established.
- **Implementation cost:** Canvas-rendered 14-lane timeline with smooth scrolling + zoom + hover is a non-trivial frontend component. Recharts doesn't fit; needs custom canvas or a library like `d3-timeline`. Adds bundle weight + new test surface.

**Promotion criteria:**
Promote out of deferred-state if any of the following surface:

1. **Operator-reported demand:** During Phase 116 soak period, operator asks for cross-agent activity correlation more than 2× → promote.
2. **F12 reveals gap:** During Phase 116 operation, F12's per-turn waterfall surfaces "I can't see how this turn correlates with what other agents were doing" feedback → promote.
3. **Cross-agent IPC bugs:** A subagent-IPC bug class (like Phase 999.18 + 999.36 patterns) needs cross-agent timing correlation to diagnose → promote.

**If promoted:** Open a new phase (e.g., `999.NN-dashboard-swim-lane-timeline`). Treat as a 1-plan phase, ~6-8h. Inherits all of Phase 116's design tokens, shadcn components, and SSE/Query foundation.

**Pre-existing primitives the future phase could reuse:**
- `trace_spans` table (already populated by Phase 115)
- F11 detail drawer + F12 trace waterfall code paths
- SSE `agent-status` event (per-agent activity beats)
- Phase 88 cross-agent IPC infrastructure

---

## F14 — In-UI MEMORY.md / SOUL.md / IDENTITY.md editor

**Original spec:** Tier 2 — edit-in-place editor for Tier 1 memory files (per agent in F11 right column).

**Phase 116 ships:** Read-only previews only (in Plan 116-04 T04).

**Deferred:** 2026-05-11 (operator decision during plan-mode review)

**Rationale:**
- Operator overwriting a Tier 1 memory file mid-turn while the agent is reading from it is a high-risk surface (no file-locking exists today).
- The CLI `clawcode memory edit <agent> <file>` flow + atomic temp+rename already exists and is the safer path.
- F14 read-only previews surface the content in the UI; that's the high-value "see what's in memory" experience. The edit affordance is a smaller incremental value.

**Promotion criteria:**
Promote when in-UI memory editing demand exceeds the current CLI flow:

1. **Operator workflow friction:** During Phase 116 soak, operator asks for in-UI edit more than 2× → promote.
2. **Memory edit volume increases:** If `clawcode memory edit` invocations exceed 10/day across fleet (audit log), in-UI workflow likely saves meaningful time.

**If promoted:** Single small follow-up phase (~3-4h). Required: file-locking + atomic write + post-save SSE event to invalidate agent's cached preload + operator-confirm modal before save.

---

## Approval-driven governance UI (Mission Control pattern)

**Original consideration:** Some surveyed projects (Mission Control) implement governance UI where operator approves agent actions before they happen.

**Deferred indefinitely.** ClawCode is single-operator; approval-driven governance has no use case here. Captured for completeness, NOT for backlog promotion.

---

## Other deferred-indefinitely items (per CONTEXT and v2.8 ROADMAP)

These are listed here for cross-reference; they are NOT Phase 116 follow-up candidates:

- Multi-framework adapters (CrewAI / LangGraph) — ClawCode is Claude-only by design
- Session replay / time-travel debugging — high storage cost; cost/value unfavorable
- OpenTelemetry native instrumentation — overkill for tightly-coupled daemon
- i18n — single-operator, English-only
- Cloud-hosted dashboard mode — local-only by design
- Auth (Clerk / Google Sign-In) — local-only

---

## Phase 115-08 producer regression — deeper than cache (added 2026-05-11 from Plan 116-00 T01)

**Origin:** Plan 116-00 T01. Audit Finding B (file: `.planning/quick/260511-mfn-close-out-phase-999-7-item-2-run-tool-la/260511-mfn-AUDIT-FINDINGS.md`) hypothesized the `tool_execution_ms` / `tool_roundtrip_ms` / `parallel_tool_call_count` columns are NULL in production because of a stale esbuild cache that dropped the producer call sites from the build. The plan dispatched T01 to wipe the cache, rebuild, and re-verify.

**T01 verdict (2026-05-11):** Cache wipe DID NOT recover the producer call sites. After `rm -rf dist node_modules/.cache && npm run build`, the freshly-built `dist/cli/index.js` still contains 0 producer call sites and still has `function iterateUntilResult` (old name), not `iterateWithTracing`.

**Root cause (corrected):** The bundle is actually CORRECT — it faithfully reflects the source. There are two parallel session-handle implementations in source:

| File | Function | Producer call sites? | Live in prod? |
|------|----------|---------------------|---------------|
| `src/manager/session-adapter.ts:1336` | `async function iterateWithTracing` | ✓ yes (4 sites) | ✗ no — only invoked via `wrapSdkQuery` which `session-adapter.ts:914,1252` documents as "test-only" (`createTracedSessionHandle`) |
| `src/manager/persistent-session-handle.ts:333` | `async function iterateUntilResult` | ✗ no | ✓ yes — `daemon.ts:18,2287` constructs `SdkSessionAdapter`, which `template-driver.ts:55,121` and the production handle chain delegate to via `createPersistentSessionHandle` |

The Phase 115-08 producer methods (`addToolExecutionMs` / `addToolRoundtripMs` / `recordParallelToolCallCount`) were added to `session-adapter.ts:iterateWithTracing`, but production never executes that function — it executes `persistent-session-handle.ts:iterateUntilResult`, which has no producer call sites.

**Fix required (deferred out of Plan 116-00):** Port the Phase 115-08 producer call sites from `session-adapter.ts:iterateWithTracing` into `persistent-session-handle.ts:iterateUntilResult`. The call-site shapes (4 sites at session-adapter.ts:1403, 1419, 1465, 1476, 1607) need to be replicated against the analogous tool_use / tool_result / batch points in `iterateUntilResult`. Estimated ~1-2h surgical port + verification.

**Impact on Phase 116 plans:**

- Plan 116-00 proceeds without this fix. F02 backend (per-model SLO) is unaffected.
- Plan 116-02 F07 (tool latency split panel) MUST fall back to `trace_spans` table for its data source rather than the new `traces` columns. The plan's deviation handling already calls this out: "F07 ships against `trace_spans` — works today, no dependency on Finding B fix, but only shows `tool_call.<name>` durations, not the per-batch round-trip / split decomposition that 115-08 intended."
- Operator can promote this to a quick task (~260512-xxx style) any time after Plan 116-00 ships. Suggested priority: medium (F07 ships fine without it, but the full exec-vs-roundtrip split is the headline 115-08 surface).

**Promotion criteria:** Promote to a Phase 999-series quick task as soon as Plan 116-00 closes, so F07 in Plan 116-02 has the option of using the new columns by the time it ships.
