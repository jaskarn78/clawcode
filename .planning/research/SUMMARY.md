# v2.9 Reliability & Routing — Research Synthesis

**Milestone:** v2.9 Reliability & Routing
**Researched:** 2026-05-13
**Confidence:** HIGH (all findings backed by source code + incident citations)

---

## Headline Findings

1. **Zero new dependencies.** All six work-streams land entirely in the existing stack; discord.js bump to 14.26.4 is optional and should wait until after MG-A ships.
2. **v2.9 is pure patch-surface work.** Every fix lands inside an existing module; one new file (`daemon-research-ipc.ts`) is the only addition — it mirrors an existing blueprint.
3. **MG-A's root cause is a frozen webhook registry.** `WebhookManager.hasWebhook()` reads a `ReadonlyMap` populated at construction; stale entries cause `post_to_agent` to silently drop to the 60s inbox-heartbeat path. The fix pattern is the OAuth-singleton fix already shipped in `bcc26d9`.
4. **Silent path bifurcation is the #1 cross-cutting risk.** It has bitten the project 3× in 2026. Every MG-A/MG-D fix that operates via absence (NULL columns, dropped messages, missing logs) requires a wiring sentinel before the change is considered done.
5. **NULL must never equal breach.** Three active dashboard bugs trace to the same root: NULL percentiles or NULL tool-names rendering as failure state rather than "no data."

---

## Stack Verdict

No new runtime packages. All v2.9 features have a clear home in already-shipped code: `discord.js@14.26.2` owns A2A delivery and webhook heal; `better-sqlite3` + `trace_spans` cover all MG-D data fixes; `src/discord/subagent-thread-spawner.ts` owns both MG-B fixes and 999.19's routing correction; `wrapMarkdownTablesInCodeFence` at `src/discord/markdown-table-wrap.ts` already exists and only needs to be wired universally (transport-boundary approach). The only version action recommended is deferring the discord.js 14.26.4 bump until MG-A is observably green — bumping during live webhook investigation muddies attribution.

---

## Per-Merge-Group Synthesis

### MG-A · A2A + Subagent-Relay Delivery Reliability (999.44, 999.45, 999.48)

- **Root cause:** `daemon-post-to-agent-ipc.ts:193-198` — `hasWebhook(to) === false` branch hits `inboxOnlyResponse` with no bot-direct fallback, unlike `daemon-ask-agent-ipc.ts:262-299` which has the 999.12 IPC-02 bot-direct block. Secondary: `WebhookManager.hasWebhook` reads a frozen `ReadonlyMap` that never reconciles against Discord's live state (ARCHITECTURE.md §MG-A).
- **Patch surface:** `daemon-post-to-agent-ipc.ts` (port bot-direct block); `daemon.ts:8492-8520` (thread `botDirectSenderRef.current`); `webhook-manager.ts` (identity-cache invalidation on 401/404); `bridge.ts` (icon-swap hook, 999.45); `projects` agent cron skill (999.48 — agent-side only, no daemon code).
- **Key pitfall:** The cached-singleton pattern. `WebhookManager` may return `hasWebhook === true` for a webhook Discord deleted hours ago; the fix must also invalidate on error, not just re-check at construction. Also: 999.45 icon fix is only operator-visible once 999.44 delivers live — must sequence.
- **Complexity:** M (999.44), S (999.45), S (999.48)

### MG-B · Subagent UX Completion Gate + Chunk-Boundary (999.36-02, 999.36-03)

- **Root cause:** Two seams in `subagent-thread-spawner.ts`. (1) Off-by-3: editor truncates at `slice(0, 1997) + "..."`, overflow loop reads from `cursor = 2000` — bytes 1997-1999 written nowhere (self-documented at line 423-438 as `seamGapBytes: 3`). (2) Premature completion: "done" event fires at the first definition of subagent-finished, not the last (delivery confirmed).
- **Patch surface:** `subagent-thread-spawner.ts:346-355` (EDITOR_TRUNCATE_INDEX = 1997 constant), `:388-415` (overflow cursor start), `~700-900` (completion gate → `streamFullyDrained && deliveryConfirmed`); `subagent-typing-loop.ts` (verify gate change doesn't leave typing loop dangling).
- **Key pitfall:** Plan 03 (`depends_on: 999.36-02`) must ship after 02. Also: audit `webhook-manager.ts:68 splitMessage` and any other splitter for the same off-by-3 seam — Plan 03 does not touch them.
- **Complexity:** M (999.36-02), S (999.36-03)

### MG-C · MCP Lifecycle Verification Soak (999.6, 999.14, 999.15)

- **Root cause:** No code issue — pre-written Wave-2/4 plans are unexecuted. Blocked on operator-approved restart window.
- **Patch surface:** None. Execute `999.6-02-PLAN.md`, `999.14-02-PLAN.md`, `999.15-04-PLAN.md` sequentially. Verify `clawcode mcp-tracker` CLI hotfix `fa72303` covers the Invalid Request.
- **Key pitfall:** Ramy-active rule — every restart drops 30-90s of messages. Run only with Discord-MCP-verified quiet window (not journalctl). Run ALL THREE soak variants (cold restart, per-agent restart, forced respawn) — not just cold.
- **Complexity:** S (pure verification — 3 existing plans)

### MG-D · Dashboard Backend Observability Cleanup (999.49, 999.7-B, 999.7-C)

- **Root cause:** Two independent bugs sharing the same table. (1) `trace_spans` has rows with `name = "tool_call."` (no tool name suffix) → SQL groups them as empty string, producing 19 null-tool-name rows. May also be `"Admin Clawdy"` space-in-name SQL parameter binding drift. (2) `BenchmarksView.tsx:295-301` colorClass resolver hits `text-danger` for null percentiles — NULL → breach instead of NULL → unknown/neutral. (3) Split-latency producer regression: Phase 115-08 may have moved the writer to `session-adapter.ts:iterateWithTracing` (test path) rather than `persistent-session-handle.ts:iterateUntilResult` (production path).
- **Patch surface:** `trace-store.ts:966-992` (`perToolPercentiles` SQL — add `AND LENGTH(s.name) > 11` guard); `BenchmarksView.tsx:295-301` (null percentile → `text-fg-3` neutral); `daemon.ts:414-438` (`augmentToolsWithSlo` cold-start guard parity); `trace-collector.ts:649` (split-latency producer path); `tool-latency-audit.ts` (verify hotfix).
- **Key pitfall:** Run diagnostic SQL from `999.49-BACKLOG.md:40` FIRST to confirm which root cause applies before patching. Verify split-latency producer is in the production path, not the test path.
- **Complexity:** M (999.49 backend), S (null-percentile color — independent frontend), M (999.7-B producer regression), S (999.7-C CLI verify)

### 999.46 · Discord Markdown Table Auto-Transform

- **Root cause:** `wrapMarkdownTablesInCodeFence` exists at `src/discord/markdown-table-wrap.ts` and is wired in only 2 of ~7 outbound Discord paths. Partial deployment = silent bifurcation. Operator flagged 5×+ in 2 weeks.
- **Patch surface:** `webhook-manager.ts` `WebhookManager.send`/`sendAsAgent` + `BotDirectSender.sendText` (transport-boundary approach — inherits everywhere). Also: `bridge.ts:908`, `:1268`, `:1280/:1287`; `daemon.ts:2989,2999`; `daemon-ask-agent-ipc.ts:210,244,286`.
- **Key pitfall:** Use Approach A (single chokepoint at transport boundary), not per-site. New send-sites silently miss the wrap under Approach B. Embed `description` body needs special handling.
- **Complexity:** S-M (hook is small; making it truly universal requires auditing all outbound paths)

### 999.19 · Subagent Delegate-Channel Routing + Memory Consolidation

- **Root cause:** `subagent-thread-spawner.ts:502` — `const channelId = parentConfig.channels[0]` always uses parent's channel, ignoring `delegateTo`. Delegate work lands in parent's channel, polluting parent's surface. Plus `-via-` naming-pattern leak across 5+ filter sites.
- **Patch surface:** `subagent-thread-spawner.ts:502` (one-line conditional); `thread-types.ts` + `thread-registry.ts` (add `delegateAgentName?: string` to `ThreadBinding`); `daemon.ts` (memory consolidation into delegate's SQLite, not parent's); 5+ grep-located `-via-` filter sites.
- **Key pitfall:** The one-line channel fix is incomplete without `delegateAgentName` on the binding — 999.20 memory consolidation cannot find the delegate from the binding alone. D-16 constraint forbids new SQL columns; use JSON registry field (matches `completedAt` precedent).
- **Complexity:** M (3-prong change + filter-site audit)

### 999.20 · `/research` + `/research-search` Slash Commands

- **Root cause:** Not a bug — new capability. Blocked on 999.19 binding-schema and delegate-channel routing landing first.
- **Patch surface:** `slash-commands.ts`, `native-cc-commands.ts`, `daemon.ts` (new IPC cases); new `daemon-research-ipc.ts` module (mirrors `daemon-post-to-agent-ipc.ts` blueprint); `memory-lookup-handler.ts` (scoped lookup).
- **Key pitfall:** Hard gate on 999.19. Without delegate-channel routing, every `/research` invocation re-creates exactly the session-leak 999.19 fixes.
- **Complexity:** S-M (standard slash-command + IPC handler pattern; one new module)

---

## Dependency Graph

```
MG-A 999.44 (webhook heal) ──────────────────────► 999.45 (icon)
     │
     │ (bot-direct path must exist before table wrap
     │  inherits it)
     ▼
999.46 (table wrap universal) ── sequence AFTER 999.44

999.48 (heartbeat routing) ── agent-side, fully parallel

MG-D (trace_spans + BenchmarksView) ── parallel to MG-A/B

MG-B 999.36-02 (completion gate) ──────────► 999.36-03 (chunk seam)
     (same file; 03 depends_on 02)

999.19 (delegate routing) ─────────────────► 999.20 (/research cmds)
     (hard gate; ROADMAP:1534)

MG-C (soak) ── restart-window-gated; independent of all code changes
```

---

## Build Order Recommendation

ARCHITECTURE.md's 8-wave proposal validated with one clarification (Wave 4 sequences 999.19 before MG-B to avoid merge churn on the same file):

| Wave | Items | Rationale |
|------|-------|-----------|
| **1** | MG-A 999.44 | Highest operator pain; single-file delta; enables Waves 2 and 5 |
| **2** | 999.45 (icon) | Requires 999.44 deployed + observably-green ≥24h first |
| **3** | MG-D (999.49 + 999.7-B/C) | Highest perceived value; diagnostic SQL pre-prescribed; frontend null-fix ships parallel to backend |
| **4** | 999.19 → MG-B 999.36-02 → MG-B 999.36-03 | All three in `subagent-thread-spawner.ts`; sequence within wave to avoid merge churn |
| **5** | 999.46 (table auto-wrap) | After MG-A so new bot-direct fallback path inherits the wrap from day one |
| **6** | MG-C verification soak | Operator restart window; Ramy-quiet required (Discord MCP check, not journalctl) |
| **7** | 999.48 (heartbeat routing) | Agent-side skill rewrite; operator-driven; fully parallel |
| **8** | 999.20 (/research commands) | Blocked on 999.19 (Wave 4); new module blueprint available |

---

## Cross-Cutting Patterns

Three patterns from PITFALLS.md recur across all merge groups and must drive shared prevention strategy:

### Pattern A: Silent Path Bifurcation

Production never executes the path that was tested. Caused 3 incidents in 2026 (Phase 115-08 producer regression, `post_to_agent` silent drops, hotfix `ca387d9` revert). High-risk v2.9 sites: `post_to_agent` fallback fix (must land in production path), 999.46 table wrap (must reach every outbound path), MG-D SQL changes (confirm canonical producer before patching).

**Prevention lever:** For every fix that works via absence (NULL columns, dropped messages, missing logs), add a wiring sentinel — a synthetic turn or message at daemon boot that asserts the new code fires. Static grep pinning the production entrypoint to the new code is minimum bar.

### Pattern B: NULL-as-Breach

NULL inputs consistently misclassify as failure state rather than "no data." Manifests in MG-D (NULL percentiles → `text-danger`), 999.49 empty tool rows (19 null-name rows appear as broken data), and any future SLO panel.

**Prevention lever:** Backend returns `slo_status: null` for NULL percentile inputs; frontend maps `null` to `text-fg-3` (neutral) never `text-danger`. Apply to all current percentile renderers; enforce on any future SLO panel.

### Pattern C: Latent Bugs Surface in Pairs During Incidents

When production is degraded and a recovery action is taken, it hits unusual code paths and exposes a second latent bug. Documented twice in 2026. Not preventable, but the response pattern is: when MG-A's first fix ships, expect a second surface failure within hours; when MG-C's restart window runs, budget for two MCP issues, not one.

---

## Open Questions Before Planning

1. **Capture a live `no-webhook` event** (MG-A 999.44): 3 competing hypotheses with different patch shapes. Run synthetic `post_to_agent`; capture full broker trace + webhook registry state. Must precede coding.
2. **Run MG-D diagnostic SQL on prod DB** (999.49): `SELECT name, COUNT(*) FROM trace_spans WHERE name LIKE 'tool_call.%' AND LENGTH(name) <= 11 GROUP BY name;` — distinguishes emitter bug from IPC space-in-name binding drift.
3. **Audit all `splitMessage` callers** (MG-B 999.36-03): `webhook-manager.ts:68 splitMessage` is NOT touched by Plan 03. Grep `src/discord/` + `src/manager/` for `splitMessage`, `slice(0, 1997`, `slice(0, 2000`, `cursor = 2000`, `MAX_MESSAGE_LENGTH`.
4. **Confirm operator-approved restart window** (MG-C): requires Ramy-quiet verified via Discord MCP plugin (not journalctl). Overnight autonomous only if all channels silent ≥30 min.
5. **Confirm 999.19/20 scope** (999.19/20): BACKLOG-CONSOLIDATED.md flags "product decision pending." Treat as P2 until operator confirms in-scope.

---

## Requirements Hint

Suggested REQ-ID categories and concrete candidates for the requirements-definition step:

**A2A-XX (MG-A delivery)**
- `A2A-01`: System delivers `post_to_agent` messages live via Discord webhook; inbox-heartbeat fallback is used only when bot-direct also fails, and both failures are logged with `{agent, channel, reason}`.
- `A2A-02`: `WebhookManager` invalidates a cached webhook entry on HTTP 401/404 and re-provisions via bot before declaring delivery failed.
- `A2A-03`: Queue-state icon transitions from `⏳` (queued) to `👍` (SDK call started) to `✅`/`❌` (terminal); states are mutually exclusive and debounced.
- `A2A-04`: `projects` agent's cron-poll emits no output to user-facing channels when nothing requires operator attention.

**DASH-XX (MG-D dashboard)**
- `DASH-01`: Tool rollup table renders actual tool names for all agents including agents with spaces in their display name; zero blank-name rows when span data exists.
- `DASH-02`: Null percentile cells render with neutral `text-fg-3` styling and a "—" label, never `text-danger` breach-red.
- `DASH-03`: Tool rollup table shows an explicit empty-state message ("No tool spans recorded in window") when zero spans exist, not a row of nulls.
- `DASH-04`: Split-latency columns (`prep_latency_ms`, `tool_latency_ms`, `model_latency_ms`) are non-NULL in production for agents with active turns.
- `DASH-05`: `clawcode tool-latency-audit` CLI exits 0 with valid JSON output.

**SUB-XX (MG-B subagent UX)**
- `SUB-01`: `subagent_complete` event fires only after stream is fully drained AND final delivery is confirmed; premature completion does not occur.
- `SUB-02`: Subagent output is byte-complete across Discord message boundaries; no bytes lost at the 1997-2000 char seam.

**DISC-XX (999.46 table rendering)**
- `DISC-01`: Markdown tables in agent output are automatically wrapped in fenced code blocks before any Discord send path; applies to all outbound paths including webhook, bot-direct fallback, and cron delivery.

**RES-XX (999.19/20 research routing)**
- `RES-01`: Delegated subagent threads spawn on the delegate agent's Discord channel, not the parent's channel.
- `RES-02`: Completed delegated thread summaries are consolidated into the delegate agent's SQLite memory store.
- `RES-03`: `/research <topic>` slash command spawns a delegated subagent thread on the chosen research agent's channel and returns an ephemeral thread URL.
- `RES-04`: `/research-search <query>` returns the top 5 semantically-ranked past research summaries from the chosen agent's memory store, each including the original thread URL.

**MCP-XX (MG-C verification)**
- `MCP-01`: 999.6-02 production smoke gate executes and passes on clawdy (snapshot/restore round-trip with ≥3 agents).
- `MCP-02`: 999.14-02 Wave 2 verification (MCP-06/07/08/09/10) closes with full vitest green + tsc clean.
- `MCP-03`: 999.15-04 clawdy soak passes all three variants (cold restart, per-agent restart, forced respawn) without orphan leak or tracker drift.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All version numbers verified via `npm view` on 2026-05-13; zero new deps validated per-item |
| Features | HIGH | Pre-written plans exist for MG-B; BACKLOG specs are concrete for all others; Discord webhook lifecycle verified |
| Architecture | HIGH | Line-number-precise verification against commit `0185a62` (clean tree); asymmetric IPC handlers confirmed |
| Pitfalls | HIGH / MEDIUM | Pattern A/B/C backed by incident hashes; specific root causes for 999.44 and 999.49 need prod diagnostic |

**Overall:** HIGH

### Gaps

- **999.44 root cause**: 3 competing hypotheses; requires live `no-webhook` event capture before confident patch.
- **999.49 blank-tool-name root cause**: SQL diagnostic disambiguates; run on prod before writing the fix.
- **`splitMessage` sibling audit**: `webhook-manager.ts splitMessage` not covered by Plan 03; MEDIUM confidence it doesn't recur there.
- **999.19/20 scope confirmation**: treat as P2 until operator confirms in-scope.

---

## Sources

- `.planning/research/STACK.md` — dependency audit, version verification, "what NOT to add" rationale
- `.planning/research/FEATURES.md` — per-merge-group feature tables, dependency graph, anti-features list
- `.planning/research/ARCHITECTURE.md` — per-file patch surface, data-flow diagrams, build-order proposal
- `.planning/research/PITFALLS.md` — per-subsystem pitfalls with incident citations, cross-cutting patterns, prevention checklists

---
*Synthesized: 2026-05-13*
*Feeds: requirements definition + roadmap*
