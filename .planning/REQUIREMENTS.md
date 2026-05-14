# Requirements: ClawCode v2.9 Reliability & Routing

**Milestone goal:** Close the operator-pain gaps in cross-agent message delivery, post-Phase-116 dashboard observability, subagent UX, and MCP lifecycle verification — formally retiring the v2.8 backlog as it consolidates into v2.9.

**Defined:** 2026-05-13
**Source:** `.planning/research/SUMMARY.md` + `.planning/BACKLOG-CONSOLIDATED.md`
**Categories:** 5 (A2A, DASH, SUB, DISC, MCP) — 15 requirements

---

## v2.9 Active Requirements

### A2A · Agent-to-Agent + Subagent-Relay Delivery Reliability

- [ ] **A2A-01** — System delivers `post_to_agent` messages live via Discord webhook; the inbox-heartbeat fallback path is used only when both webhook AND bot-direct delivery have failed, and any fallback emits a structured log line with `{agent, channel, reason}`. *(merges 999.44)*
- [ ] **A2A-02** — `WebhookManager` invalidates a cached webhook entry on HTTP 401/404 from Discord and re-provisions the webhook via bot before declaring delivery failed. *(merges 999.44 cached-singleton root cause)*
- [x] **A2A-03** — Discord queue-state icon transitions atomically through `⏳` (queued) → `👍` (SDK call started) → `✅`/`❌` (terminal); states are mutually exclusive and debounced. *(merges 999.45)* — **Code closed Phase 119 Plan 03 (commits `670931e`, `afcab56`); per-channel mutex + 200ms debounce + sticky terminal states. SC-3 operator-visual screenshot remains deploy-gated.**
- [ ] **A2A-04** — The `projects` agent's cron-poll emits no output to user-facing channels when nothing requires operator attention; the `HEARTBEAT_OK` no-op is suppressed at the agent's skill layer. *(merges 999.48 — agent-side fix, not daemon)*

### DASH · Dashboard Backend Observability Cleanup (post-Phase-116)

- [ ] **DASH-01** — Tool rollup table renders actual tool names for every agent (including agents with spaces in their display name); zero blank-tool-name rows when underlying span data exists. *(merges 999.49 root cause #1 + #2)*
- [ ] **DASH-02** — Null percentile cells render with neutral `text-fg-3` styling and a "—" label, never the `text-danger` breach-red used for true SLO breaches. *(merges 999.49 root cause #3 + NULL-as-breach pattern)*
- [ ] **DASH-03** — Tool rollup table shows an explicit empty-state message ("No tool spans recorded in window") when the agent has zero spans, instead of rendering a row of nulls. *(merges 999.49 UX)*
- [ ] **DASH-04** — Split-latency columns (`prep_latency_ms`, `tool_latency_ms`, `model_latency_ms`) are non-NULL in production for agents with active turns; the producer regression introduced after Phase 115-08 is restored. *(merges 999.7 follow-up B)*
- [ ] **DASH-05** — `clawcode tool-latency-audit` CLI exits 0 with valid JSON output (no Invalid Request error); the Phase 106 TRACK-CLI-01 hotfix (`fa72303`) is verified end-to-end. *(merges 999.7 follow-up C)*

### SUB · Subagent UX Completion + Chunk-Boundary

- [ ] **SUB-01** — `subagent_complete` event fires only after the stream has fully drained AND final delivery is confirmed; the premature-completion gate is enforced for both `dispatch_in_new_thread` and `dispatch_to_existing_thread` paths. *(merges 999.36-02)*
- [ ] **SUB-02** — Subagent output is byte-complete across Discord's 2000-char message boundary; the editor-truncate-vs-overflow-start off-by-3 seam (bytes 1997-1999 currently dropped) is eliminated and the fix covers all known `splitMessage` call sites. *(merges 999.36-03 + cross-callsite audit from PITFALLS.md §3.2)*

### DISC · Discord Output Rendering

- [ ] **DISC-01** — Markdown tables in agent output are automatically wrapped in fenced code blocks at the transport boundary so every outbound Discord path inherits the wrap; applies to webhook send, bot-direct fallback, cron delivery, and embed descriptions; passes the regression test that pins `wrapMarkdownTablesInCodeFence` to all known send sites via static grep. *(merges 999.46 + universalization fix from ARCHITECTURE.md §999.46)*

### MCP · Lifecycle Verification Soak

- [ ] **MCP-01** — Phase 999.6 Plan 02 production smoke gate executes and passes on clawdy (auto pre-deploy snapshot/restore round-trip with ≥3 agents restored cleanly). *(merges 999.6-02)*
- [ ] **MCP-02** — Phase 999.14 Plan 02 Wave 2 verification (MCP-06 through MCP-10) closes with full vitest suite green + tsc clean on the deployed binary. *(merges 999.14-02)*
- [ ] **MCP-03** — Phase 999.15 Plan 04 clawdy soak passes all three variants (cold restart, per-agent restart, forced respawn) with no orphan leak and no tracker drift vs `/proc` reality. *(merges 999.15-04)*

---

## Future Requirements (deferred from v2.9)

### RES · Subagent Delegate Routing + Research Slash Commands

Deferred to v3.0 per operator scope confirmation (2026-05-13). v2.9 keeps focus on reliability/cleanup; RES is the only genuinely-new capability in the candidate set, so deferring tightens the milestone shape.

- `RES-01` — Delegated subagent threads spawn on the delegate agent's Discord channel, not the parent's channel. *(999.19)*
- `RES-02` — Completed delegated thread summaries are consolidated into the delegate agent's SQLite memory store. *(999.19)*
- `RES-03` — `/research <topic>` slash command spawns a delegated subagent thread on the chosen research agent's channel and returns an ephemeral thread URL. *(999.20)*
- `RES-04` — `/research-search <query>` returns the top 5 semantically-ranked past research summaries from the chosen agent's memory store, each including the original thread URL. *(999.20)*

---

## Out of Scope (explicit exclusions for v2.9)

- **discord.js version bump (14.26.2 → 14.26.4)** — STACK.md verified the patch-bump changelogs are unrelated to MG-A's no-webhook fallback bug. Bumping during the same milestone that investigates webhook reliability muddies attribution; defer to a separate maintenance commit post-v2.9.
- **Replacing `wrapMarkdownTablesInCodeFence` with a markdown parser library** — STACK.md rejected `marked`/`markdown-it` additions; the existing pure-function helper is the canonical solution and only needs universal wiring.
- **Webhook auto-rotation on a schedule** — Discord webhook tokens have no TTL (FEATURES.md verification). The correct heal pattern is re-register-on-401/404 + retry-once, not time-based rotation.
- **Daemon-side `HEARTBEAT_OK` filter** — A2A-04's fix belongs in the `projects` agent's cron skill, not as a string-match filter in the daemon delivery layer. The latter would be the wrong pattern at the wrong layer.
- **New SQL columns for delegate routing** — D-16 constraint from prior 999.19 spec; JSON registry field on `ThreadBinding` is the right shape (matches existing `completedAt` precedent). But moot for v2.9 since RES is deferred.
- **Frontend-only dashboard polish beyond DASH-01..05** — visual-only tweaks to BenchmarksView/UsageDashboard that don't trace to the operator-flagged regressions stay out of scope to keep this milestone bounded.
- **/research and /research-search slash commands** — deferred to v3.0 (see Future Requirements).

---

## Traceability

*Each REQ-ID maps to exactly one phase. Filled 2026-05-13 by gsd-roadmapper.*

| REQ-ID | Phase | Status |
|--------|-------|--------|
| A2A-01 | Phase 119 | Active |
| A2A-02 | Phase 119 | Active |
| A2A-03 | Phase 119 | Code-complete (Plan 03; deploy-gated SC-3 screenshot pending) |
| A2A-04 | Phase 119 | Active |
| DASH-01 | Phase 120 | Active |
| DASH-02 | Phase 120 | Active |
| DASH-03 | Phase 120 | Active |
| DASH-04 | Phase 120 | Active |
| DASH-05 | Phase 120 | Active |
| SUB-01 | Phase 121 | Active |
| SUB-02 | Phase 121 | Active |
| DISC-01 | Phase 122 | Active |
| MCP-01 | Phase 123 | Active |
| MCP-02 | Phase 123 | Active |
| MCP-03 | Phase 123 | Active |
