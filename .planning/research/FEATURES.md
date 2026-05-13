# Feature Research — v2.9 Reliability & Routing

**Domain:** Multi-agent Discord orchestration — reliability hardening + UX cleanup of existing subsystems
**Researched:** 2026-05-13
**Confidence:** HIGH (per-item BACKLOG specs are concrete; pre-written 999.36-02/-03 plans exist; ROADMAP specs for 999.19/.20 are detailed)

---

## Summary

v2.9 is not greenfield. Every item below targets an **existing**, **already-deployed** subsystem with a confirmed defect or operator-visible papercut. Work splits cleanly into five active categories — three merge groups (MG-A, MG-B, MG-D) plus three standalone items (999.46, 999.19, 999.20). MG-C (MCP lifecycle soak) is operator-restart-window-gated and lives outside daily feature work, so it is mentioned but not expanded here.

Two cross-cutting facts shape the table-stakes set:

1. **Discord webhook tokens never expire on a timer** — they invalidate only on **delete+recreate**, **token regeneration**, **bot permission loss** (`MANAGE_WEBHOOKS`), or **channel deletion**. MG-A's "webhook expired" hypothesis is really "webhook was rotated/deleted and our registry is stale." The auto-heal pattern is **re-register-on-404 retry**, not a TTL refresh. (Interaction tokens expire at 15 min — but `post_to_agent` does not use interaction tokens.)
2. **Discord renders zero markdown table syntax.** Code-block-with-padded-columns is the only universally-rendering approach (desktop + mobile). Operator explicitly asked for this pattern in 999.46. ASCII-art / image-render / embed alternatives have real tradeoffs called out in anti-features.

---

## Feature Landscape

### Category 1 — MG-A · A2A + Subagent-Relay Delivery Reliability

Headline operator pain. Three items, one root subsystem (Discord webhook delivery + correct destination channel).

#### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `post_to_agent` returns live-delivery confirmation in steady state | Operator sees agents talk in real time, not via 30-60s heartbeat poll | M | Today broker silently falls through to `no-webhook` inbox-heartbeat. Acceptance: live delivery is default; `no-webhook` is logged, rare anomaly. |
| Webhook auto-heal on 404 / `Unknown Webhook` / 401 | Discord deletes & rotations happen; daemon should re-register and retry without operator | M | Canonical pattern: try send → 404/401 → re-create webhook via bot (needs `MANAGE_WEBHOOKS`) → update registry → retry once → record. |
| `no-webhook` fallback telemetry counter per channel per hour | Operator can spot sustained leak before users notice | S | Pino structured log with `agent`, `channel`, `reason` tags. Dashboard SSE already exists — add fallback-count tile. |
| Queue-state icon disambiguation: 🕓 → 👍 → ✅ / ❌ | Operator must distinguish "queue stuck" (broken webhook) from "model thinking" (normal latency) | S | Icon transition needs runtime hook fired on SDK call start OR first stream-json event. Cheap once hook lands. Webhook PATCH path same as streaming edits. |
| Cron-poll `HEARTBEAT_OK` ack stops leaking into user channel | Operator's `?` getting a `HEARTBEAT_OK` reply destroys trust in the agent | S | Per 999.48 the fix lives in the *agent's own* cron-poll skill (agent owns its monitor loop), not in the daemon. Either silent-no-op when nothing-to-report, or route to admin observability channel. |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Daemon-level webhook health-check tick (every N min, HEAD on registered webhooks) | Proactively detect rotation before next outbound send fails | M | Discord rate-limit-friendly but adds writes to registry. Worth it only if reactive auto-heal proves insufficient. |
| Adaptive heartbeat-poll cadence (tighten when webhook unhealthy, relax when healthy) | Faster recovery when fallback is the only working path | M | Current cadence is fixed regardless of health. Tunable knob avoids both "always slow" and "always hammering." |
| Crash-mid-processing landing on ❌ (not stuck at 👍) | Operator sees actual failure state, not zombie thumbs-up | S | Edge case explicit in 999.45 BACKLOG. |

#### Anti-Features

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|--------------|---------------|-----------------|-------------|
| TTL-based webhook rotation in the daemon | "Refresh tokens before they expire" | Discord webhook tokens **do not expire on a timer** — rotating eagerly creates the 404s we're trying to avoid | Re-register lazily on 404/401, not eagerly on a clock |
| Typing-indicator firing on thumbs-up | Visual "agent is working" feedback | Conflates queue-state (👍 = picked up) with model-think state (typing) — re-creates the exact ambiguity 999.45 is fixing | Keep typing indicator for active model-call streaming only; thumbs-up is the pre-stream state marker |
| Synchronous A2A RPC retry-with-backoff in the broker | "Just retry until it works" | Blocks calling agent's turn; cascades latency through fleet | Async inbox is already the failure-mode contract — fix is to make the live path actually live, not to retry the slow path |
| Posting `HEARTBEAT_OK` to a status thread "for visibility" | "I want to see the cron is alive" | Operator wanted **silent** monitoring (Option A established in-session per 999.48); status thread re-creates noise elsewhere | Truly silent → log to local file/state. If proof-of-life is needed, post to admin-clawdy observability channel at 30min+ cadence, never user channel |
| Tool-call-retry oscillating the emoji | "Show every state transition" | Visual flicker; user can't tell what state means | Debounce / latch — 👍 once set stays until terminal state |

---

### Category 2 — MG-B · Subagent UX Completion + Chunk-Boundary

Two pre-written plans (999.36-02 and 999.36-03) targeting `src/discord/subagent-thread-spawner.ts`. Sequenced — 03 `depends_on` 02 because they touch overlapping code.

#### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `subagent_complete` fires only after stream-end AND delivery-confirmed | Operator's "Phase 2 complete" summary must reflect work that actually delivered | M | 999.36-02: `streamFullyDrained && deliveryConfirmed` AND-clause. New `lastDeliveryAt` JSON field on `ThreadBinding` (D-16 SQL-forbidden; JSON registry allowed, matching `completedAt` precedent). |
| Quiescence-sweep emits `subagent_idle_warning`, not premature `subagent_complete` | Operator sees stuck thread without false-completion side-effects | S | Same plan. In-memory dedupe Map keyed by threadId; one warning per quiescence cycle per binding. |
| `autoArchive=true` waits for delivery confirmation before archiving | Don't bury a thread whose final chunks never arrived | S | Defense-in-depth — reads registry once more before `archiveThread`. |
| Chunk-boundary delivers every byte (no off-by-3 seam at chars 1997-1999) | Subagent output must not silently lose 3 bytes per overflow boundary | S | 999.36-03: `EDITOR_TRUNCATE_INDEX = 1997` module constant; overflow cursor starts at 1997 not 2000. Two call sites (`postInitialMessage` + `relayCompletionToParent`). |
| One-time startup migration for pre-Phase-999.36 thread bindings | Existing bindings without `lastDeliveryAt` must not hang the new gate forever | S | `migrateBindingsForPhase999_36(...)`: backfill `lastDeliveryAt = lastActivity` for bindings with no `completedAt`. Idempotent. Marked `// REMOVE AFTER 999.36+1 milestone closes`. |
| Session-end backstop stamps `lastDeliveryAt` | Crash mid-stream still notifies operator | S | `daemon.ts:7329-7350` session-end callback stamps before calling `relayCompletionToParent` — preserves "session ended → relay fires" behavior. |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Diff-against-expected reconstruction test (4500-char fixture) | Catches *any* future seam regression — byte-for-byte completeness check | S | Pre-specified in 999.36-03 Task 1. Load-bearing `expect(reconstructed).toBe(expected)` assertion. |
| 2003-char off-by-3 detection fixture | Pins the specific bug class — exact boundary where the seam manifests | S | Pre-fix fails. Post-fix passes. Cheap regression insurance. |
| Post-deploy `seamGapBytes: 0` log verification | Production confirmation channel — operator reads prod logs to confirm fix took | S | Plan 00 diagnostic logs already present; just need the post-fix values to flip to 0. |

#### Anti-Features

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|--------------|---------------|-----------------|-------------|
| Removing the `"..."` truncate marker in editor's visible message | "Just send the bytes — no marker needed" | Operator-friendly UX cue that more text follows; mobile users especially benefit from explicit "continued in next message" signal | Keep marker visible; fix overflow start cursor instead |
| Fence-aware chunking (code-fence open/close detection) | "Tables/code blocks should stay contained per message" | Adds complexity, defers byte-correctness fix, was already broken pre-fix anyway | Defer to a future phase if operator requests; current scope is byte-correctness only |
| Persistent (across daemon restart) idle-warning dedupe Map | "Don't re-emit warnings after restart" | A daemon restart is naturally a "fresh look" — emitting after restart is correct operator-visibility behavior | In-memory Map; resets on restart by design (called out as open question in 999.36-02 output) |
| New SQL column for `lastDeliveryAt` | "Schema columns are more first-class" | CONTEXT D-16 explicitly forbids new SQL columns | JSON registry field on `ThreadBinding` (matches `completedAt` precedent from 999.25) |
| autoArchive timeout / retry mechanism | "What if archive hangs?" | Out of scope for the gate plan; mixes concerns | If guard fails, log warn + leave thread open; operator manually archives |

---

### Category 3 — MG-D · Dashboard Backend Observability Cleanup (post-Phase-116)

Three items on the `trace_spans` / `tool_latency` data layer. Highly visible — operator just opened Benchmarks tab post-redesign and "none of the benchmarks seem to work." Diagnostic SQL pre-prescribed.

#### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Tool rollup table renders actual tool names (not blank rows) | Per-agent tool latency is useless if `Tool` column is empty | M | Hypotheses ranked in 999.49: (1) `Admin Clawdy` space-in-name SQL/IPC parameter handling, (2) trace_spans missing `name` field for some span types, (3) genuine no-data → should show empty-state, not 19 null rows. |
| `slo_status === 'breach'` only when there's a real percentile to compare | Red `—` on null percentiles is misleading | S | Independent UI bug in `BenchmarksView.tsx:295-301`. Null percentiles → `text-fg-3` neutral, not `text-danger`. |
| Cross-agent comparison chart renders bars when ≥1 agent has data | Empty chart with axis labels = broken UI | S | Falls out of fixing the rollup data shape. |
| Split-latency producer regression repaired (columns no longer NULL) | 999.7 follow-up B — Phase 115-08 producer broke columns | M | Shared root with 999.49 — same `trace_spans` table. May be same fix. |
| `clawcode tool-latency-audit` CLI returns valid output (not `Invalid Request`) | 999.7 follow-up C — CLI must work | S | Possibly same root as dashboard issue; verify together. |
| Empty-state UI when no spans recorded in window | "No tool spans recorded for this agent in window" beats 19 null rows | S | Frontend addition in `ToolRollupSection`. |
| Repro path documented (which agent + window) | Future regression detection | S | Pre-specified in 999.49 acceptance criteria. |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Diagnostic SQL captured in `999.49-BACKLOG.md:40` reused as runtime health-check | Self-healing dashboard | M | Optional — start with static fix; promote to live health-check only if regression class recurs. |
| Test coverage for empty-tool-name groupings | Pin the regression class | S | `src/performance/__tests__/trace-store-*` notes lack this coverage today. |

#### Anti-Features

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|--------------|---------------|-----------------|-------------|
| Recomputing percentiles client-side from raw spans | "Trust the data, not the rollup" | Browser becomes query engine; moves load to wrong tier; same null bug deferred | Fix SQL/IPC layer producing the empties |
| Defaulting null `slo_status` to `'pass'` for visual cleanliness | "Stop the red noise" | False signal — operator might miss real breach | Default to `'unknown'` / `text-fg-3` neutral — explicit "no data" not implicit "fine" |
| Filtering out blank-tool-name rows in the API | "Just hide broken rows" | Hides symptom; root cause persists; future legitimate-blank-name spans silently disappear | Fix at source — populate `name` correctly or `GROUP BY` differently |
| Adding new dashboard panels in v2.9 | "While we're in there" | Scope creep — v2.9 is reliability, not feature expansion | Keep panel surface unchanged; fix only the broken renders |

---

### Category 4 — Standalone: 999.46 · Discord Markdown Table Auto-Transform

Single-place hook in the daemon's Discord output formatter. Obsoletes per-agent `feedback_no_wide_tables_discord.md` workarounds. Operator flagged 5×+; high perceived value for small implementation.

#### Industry Pattern Research

Five patterns exist for rendering tabular content on mobile Discord. Recommendation is unambiguous given operator preference + Discord's rendering reality (Discord supports ~60% of CommonMark; tables are NOT in that subset).

| Pattern | How It Works | Pros | Cons | Verdict |
|---------|--------------|------|------|---------|
| **Code-block with padded columns** (RECOMMENDED) | Wrap table in triple-backtick fence; pad cells to max column width per column | Monospace alignment preserved desktop + mobile; matches existing tree-structure pattern in codebase; round-trip-safe | Bold/links inside cells degrade to raw md text; horizontal-scroll on mobile for wide tables | **Default transform.** Operator explicitly asked for this. |
| **ASCII-art table** (box-drawing chars `┌─┬─┐`) | Render with unicode box characters | Looks prettier than backtick code block on desktop | Wider per cell; mobile rendering inconsistent; harder to round-trip; same anti-mobile result as raw md | Anti-feature — added complexity for marginal aesthetic gain |
| **Image render (PNG via headless browser)** | Render markdown table → image, attach as file | Looks perfect everywhere | Slow (headless browser per response); breaks streaming/edit cycles; non-searchable; accessibility regression; attachment quota | Anti-feature — heavy infra for solved problem |
| **Discord embed `addField()`** | Use embed's structured field-pair UI | Native Discord component | Adds visual chrome; mixes poorly with surrounding prose; breaks streaming edits | Explicitly called out as not-recommended in 999.46 BACKLOG |
| **Upload as `.md` attachment** | For very wide tables (>2000 chars), upload | Handles message-length cap; preserves true markdown | Operator has to click; loses scannability | Fallback for exceptionally wide tables only |

**Recommended detection rule:** contiguous block of `| ... |` lines with a separator row (`| --- | --- |`). Wrap only when the table block is **complete** (separator row seen + at least one data row). Don't half-wrap during streaming.

#### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Detect markdown table block in agent output | Auto-transform requires reliable detection | S | Separator-row anchored regex. Helper `markdown-table-wrap.ts` appears to exist (referenced in 999.36-03 plan). |
| Wrap in fenced code block when destination is Discord | Code-block monospace is universally-rendering option | S | Single-place hook in daemon output formatter between LLM stream-json and webhook POST. |
| Pad columns to equal width based on max cell content | Monospace alignment requires uniform column widths | S | Naive `printf`-style padding; measure max width per column from raw cell content. |
| Preserve raw markdown table when destination is NOT Discord | File writes / GFM-rendering clients should get original | S | Output-formatter is destination-aware; existing pattern. |
| No half-wrap during streaming | Don't wrap a table whose separator row hasn't arrived yet | M | Streaming/edit cycle handling; complete-table-only gate. |
| Per-agent `feedback_no_wide_tables_discord.md` workarounds become obsolete | Stated acceptance criterion in 999.46 BACKLOG | S | Removal of workaround files is part of acceptance, not a separate task. |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| 2-column key/value fallback to bullets (`• **Key** — value`) | Prettier than code-block for short K/V tables | S | Optional polish; operator said "code-block also works." |
| `.md` attachment fallback for very wide tables (>message limit) | Preserves content that would otherwise truncate | M | Trigger when wrapped table would exceed 2000 chars. |

#### Anti-Features

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|--------------|---------------|-----------------|-------------|
| Rendering bold/italics/links inside cells | "Preserve formatting" | Backtick code block disables markdown inside; trying to keep it would mean abandoning the alignment fix | Accept degradation to plain text inside cells — operator confirmed acceptable tradeoff |
| Per-agent table-disable flag | "Some agents shouldn't use tables" | Re-creates the per-agent feedback-file problem 999.46 is fixing | Single global daemon-level hook; agents emit markdown freely |
| Discord embed `addField()` for all tables | "Native Discord component" | Adds chrome, breaks streaming, mixes poorly with prose | Code-block-with-padding |
| Auto-image-render every table | "Make it look perfect" | Slow, breaks streaming, accessibility regression | Code-block-with-padding |

---

### Category 5 — Standalone: 999.19 · Subagent Delegate-Channel Routing + Memory Consolidation

Three coordinated changes to make `delegateTo` (Phase 999.3) a real research-fanout primitive. Plus a `-via-` naming-pattern leak fix across 6 filter sites.

#### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Delegated threads spawn on **delegate's** channel, not parent's | Today every `delegateTo: research` thread lands on `#admin-clawdy`; should land on `#research` | S | One-line fix in `subagent-thread-spawner.ts:350` — `sourceConfig.channels[0]` instead of `parentConfig.channels[0]` when delegating. |
| `autoArchive: true` default for delegate path | Stops `Admin Clawdy-via-research-*` sessions leaking into `/clawcode-fleet` indefinitely | S | Flip default when `delegateTo` is set. Non-delegate `-sub-` spawns keep current behavior. |
| Memory consolidation into delegate's SQLite memory store | Institutional memory survives — research agent surfaces past delegated work via hybrid-RRF retrieval | M | Direct DB write (not message dispatch) — delegate's session may not be running. Use delegate's embedder for the vector. Summary record: task + key findings + thread URL. |
| `-via-` naming pattern recognized in 6 filter sites | Phase 999.3's `${parent}-via-${delegate}-${shortId}` session names must be treated like `-sub-` everywhere | M | Sites: `THREAD_SUFFIX_RE` (restart-greeting.ts:199), prune Rule 2 (registry.ts:413), 5 hardcoded `-sub-/-thread-` filters in openai/server.ts:376, openai/endpoint-bootstrap.ts:285, daemon.ts:2736/4142/5932, cli/commands/threads.ts:103, capability-manifest.ts:184. |
| Cross-channel completion relay still posts to parent's main channel | Operator visibility — they delegated, they need to know it finished | S | `relayCompletionToParent` already reads parent's channel correctly. Keeps working unchanged. |
| Discord's native thread panel as discovery surface | No custom log-thread needed — `#research` channel naturally lists delegated work | S | Falls out of routing change. Zero implementation. |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Memory entry includes original thread URL | Operator (or agent) can jump from memory hit back to deep-dive thread | S | Already in consolidation summary spec. |
| Embedder reuse across delegate sessions | Consolidation avoids re-warming embedder if delegate is running | S | Existing resident-singleton pattern from v1.7 warm-path. |

#### Anti-Features

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|--------------|---------------|-----------------|-------------|
| Keep delegate sessions running for "memory continuity" | "Don't lose context between delegations" | Re-creates the `Admin Clawdy-via-research-*` leak; sessions accumulate forever | Memory consolidation IS the continuity mechanism — direct DB write before autoArchive |
| Custom log thread for "all delegated work" | "Centralized view of research fanout" | Discord's native thread panel already does this; custom thread adds maintenance | Use `#research` channel's thread panel |
| Sync message dispatch to delegate agent for consolidation | "Reuse the message bus" | Delegate session may not be running; introduces availability dependency | Direct DB write; call delegate's embedder for the vector |
| Shared global memory across delegate + parent | "Research is collective knowledge" | Violates per-agent workspace isolation (PROJECT.md Out of Scope) | Per-agent memory with explicit consolidation into delegate's store |
| Generalized "delegate to any agent" UI | "Why limit to research agents?" | Operator scope is research; expanding to all agents = unbounded fleet leakage | Constrain delegate picker to research-capable agents in v2.9 |

---

### Category 6 — Standalone: 999.20 · `/research` and `/research-search` Slash Commands

Builds on 999.19's spawn + consolidation foundation. **Hard dependency** — ROADMAP line 1534: "must be in place first; otherwise these commands would re-create the leak/scatter problems."

#### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `/research <topic> [agent:research\|fin-research]` slash command | One-shot deep-dive spawn without manual delegate setup | S | Calls delegated-spawn path with `delegateTo` set. Ephemeral thread URL response to operator. |
| Parallel research threads | Multiple `/research` invocations spawn parallel threads on chosen channel | S | Falls out of using existing spawn path — each invocation is independent. |
| `/research-search <query> [agent:research\|fin-research]` slash command | Surface past research semantically without scrolling Discord history | M | IPC into chosen agent's memory store. Reuse hybrid-RRF retrieval (Phase 90 MEM-03 substrate exists). Top 5 hits with original deep-dive thread links. |
| Agent picker constrained to research-capable agents | Prevent accidental delegation to non-research agents | S | Schema-level allowlist (`research`, `fin-research`). |
| Ephemeral response (only operator sees thread URL) | Don't spam the operator's channel with system-generated links | S | Standard Discord slash-command ephemeral flag. |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Semantic + full-text hybrid retrieval | Better recall than either alone | S | RRF substrate already exists — just plumbing the slash command through. |
| Thread-URL links in search results | One-click jump from memory hit to deep-dive thread | S | Memory entries already include URL (per 999.19). |

#### Anti-Features

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|--------------|---------------|-----------------|-------------|
| `/research-list` to enumerate all past research | "Catalog of all deep-dives" | Discord's native thread panel on `#research` IS the list; redundant surface | Operator opens `#research` channel for chronological view; uses `/research-search` for semantic |
| Auto-spawn research on inferred topic detection | "AI-driven research suggestions" | Spawns work operator didn't ask for; cost + noise | Explicit `/research` invocation only |
| Cross-agent memory federation in search results | "Search ALL research, not just one agent's" | Violates workspace isolation; mixes domain contexts (research vs fin-research) | Agent picker is mandatory; one agent's memory per query |
| `/research-archive` to bulk-archive old threads | "Discord clutter" | Discord auto-archives by inactivity; 999.19's autoArchive handles per-thread | Trust the platform + 999.19's per-thread autoArchive |

---

## Dependency Graph

```
┌─────────────────────────────────────────────────────────────────┐
│  MG-A · A2A + Relay Reliability                                 │
│  999.44 (webhook auto-heal) ────► unblocks ───► 999.45 (icon)   │
│  999.48 (cron-poll routing) ──── parallel ──────────────────    │
│  (different subsystem from MG-D, MG-B, 999.46, 999.19/.20)      │
└─────────────────────────────────────────────────────────────────┘
                       │ parallel
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  MG-D · Dashboard Cleanup                                       │
│  (999.49 + 999.7-followups B/C)                                 │
│  Three items share trace_spans / tool_latency root —            │
│  likely a single fix; verify together                           │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  MG-B · Subagent UX (SEQUENTIAL)                                │
│  999.36-02 (completion gate) ────► 999.36-03 (chunk boundary)   │
│  Same file (subagent-thread-spawner.ts);                        │
│  -03 has explicit depends_on: ["999.36-00", "999.36-02"]        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  999.46 · Table auto-transform (independent)                    │
│  Single-place hook; no shared files with anything else          │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  999.19 (delegate-channel routing + consolidation)              │
│         │  HARD GATE                                            │
│         ▼                                                       │
│  999.20 (/research + /research-search slash commands)           │
│  Per ROADMAP: "must be in place first; otherwise these commands │
│   would re-create the leak/scatter problems 999.19 fixes"       │
└─────────────────────────────────────────────────────────────────┘
```

### Dependency Notes

- **MG-A and MG-D can ship in parallel** — different subsystems (Discord broker vs trace_spans data layer), no shared files, no shared root cause. Both are highest-perceived-pain so should be in the same milestone wave.
- **999.44 unblocks 999.45's visibility** — the 👍 icon update is delivered via the same webhook PATCH path 999.44 is fixing. The icon improvement is real either way, but is only operator-visible once webhooks deliver reliably. Ship 999.44 first, 999.45 immediately after (or together in the same plan wave).
- **999.48 is parallel to 999.44/45** — same "what channel does this message belong on" family, but the fix lives in the projects agent's own cron-poll skill, not in the daemon. Operator-driven fix request to the agent itself; doesn't block daemon work.
- **999.36-03 depends_on 999.36-02** — explicit in plan frontmatter. -02 changes the relay gate (adds `lastDeliveryAt`); -03 changes the overflow cursor calc. Both touch `subagent-thread-spawner.ts` overlapping regions. Sequential, not parallel.
- **999.20 truly gates on 999.19** — slash commands invoke the delegated-spawn path; without 999.19's routing + consolidation, every `/research` invocation re-creates exactly the leak 999.19 is fixing. Confirmed in ROADMAP line 1534.
- **999.46 is fully independent** — single-place hook in output formatter; no shared files with anything else in v2.9. Can ship alongside or between any wave.
- **MG-B is independent of MG-A and MG-D** — different files, different subsystems. Could ship any wave; recommended after MG-A because operator's compound-failure scenario (D's premature relay + B's truncation) is most visible alongside A's broken delivery.

---

## Anti-Features (Cross-Cutting Recap)

For the requirements-definer — these should explicitly NOT become requirements:

1. **Typing-indicator firing on queue-thumbs-up state** — conflates queue-state with model-think state, re-creating 999.45's exact ambiguity. (MG-A)
2. **TTL-based webhook rotation** — Discord webhook tokens don't expire on a timer; rotating eagerly causes the 404s we're trying to avoid. (MG-A)
3. **Synchronous A2A RPC retry-with-backoff in the broker** — blocks calling agent's turn, cascades latency. (MG-A)
4. **Posting `HEARTBEAT_OK` to a status thread "for visibility"** — operator wanted silent monitoring; status thread just relocates the noise. (MG-A)
5. **Tool-call retries oscillating the queue-state emoji** — debounce/latch instead. (MG-A)
6. **Removing the `"..."` truncate marker in editor's visible message** — operator-friendly UX cue; fix is overflow-cursor alignment, not marker removal. (MG-B)
7. **Fence-aware chunking** — out of scope for v2.9; defer if operator requests. (MG-B)
8. **Persistent (across daemon restart) idle-warning dedupe Map** — daemon restart is a fresh look. (MG-B)
9. **New SQL column for `lastDeliveryAt`** — CONTEXT D-16 forbids; JSON registry field is the precedent. (MG-B)
10. **autoArchive timeout / retry mechanism** — mixes concerns; leave thread open on guard failure. (MG-B)
11. **Recomputing percentiles client-side from raw spans** — moves load to browser; same null bug deferred. (MG-D)
12. **Defaulting null `slo_status` to `'pass'`** — false signal; default to `'unknown'` / neutral. (MG-D)
13. **Filtering out blank-tool-name rows in the API** — hides symptom, root cause persists. (MG-D)
14. **Adding new dashboard panels in v2.9** — scope creep; v2.9 is reliability not feature expansion. (MG-D)
15. **ASCII-art box-drawing tables** — wider, inconsistent mobile rendering, harder round-trip. (999.46)
16. **Image-render markdown tables via headless browser** — heavy infra, breaks streaming, accessibility regression. (999.46)
17. **Discord embed `addField()` for all tables** — visual chrome, breaks streaming edits. (999.46)
18. **Per-agent table-disable flag** — re-creates the per-agent feedback-file problem. (999.46)
19. **Bold/italics/links rendered inside table cells** — incompatible with backtick code-block alignment. (999.46)
20. **Keeping delegate sessions running for "memory continuity"** — re-creates session-leak; consolidation IS continuity. (999.19)
21. **Custom log thread for "all delegated work"** — Discord's native thread panel already does this. (999.19)
22. **Sync message dispatch to delegate agent for consolidation** — delegate may not be running. (999.19)
23. **Shared global memory across delegate + parent** — violates workspace isolation. (999.19)
24. **Generalized "delegate to any agent" UI** — unbounded fleet leakage; constrain to research-capable agents. (999.19)
25. **`/research-list` to enumerate all past research** — redundant with Discord's native thread panel. (999.20)
26. **Auto-spawn research on inferred topic detection** — spawns work operator didn't ask for. (999.20)
27. **Cross-agent memory federation in search results** — violates workspace isolation. (999.20)
28. **`/research-archive` to bulk-archive old threads** — Discord auto-archives by inactivity + 999.19's per-thread autoArchive. (999.20)

---

## Implementation-Cost / Operator-Value Matrix

| Feature category | Operator value | Implementation cost | Priority |
|------------------|----------------|---------------------|----------|
| MG-A · A2A reliability (999.44) | **VERY HIGH** (recurring pain, 5×+ flagged) | MEDIUM (webhook re-register + telemetry + retry loop) | P1 |
| MG-A · Icon disambiguation (999.45) | MEDIUM (UX clarity) | LOW (icon swap + runtime hook) | P1 (rides with 999.44) |
| MG-A · Heartbeat-leak fix (999.48) | MEDIUM (trust + signal-to-noise) | LOW (agent-owned skill change) | P1 |
| MG-D · Benchmarks dashboard (999.49) | **HIGH** (just-deployed, "none of the benchmarks work") | LOW-MEDIUM (diagnostic SQL pre-prescribed) | P1 |
| MG-D · 999.7 follow-ups B/C | MEDIUM (shared root with 999.49) | LOW (likely same fix) | P1 (rides with 999.49) |
| MG-B · Completion gate (999.36-02) | HIGH (compound-failure prevention) | MEDIUM (pre-written plan, 4 est. hours, 7 tasks) | P1 |
| MG-B · Chunk-boundary (999.36-03) | HIGH (silent data loss prevention) | LOW (pre-written plan, 3 est. hours, 4 tasks) | P1 (after -02) |
| 999.46 · Table auto-transform | MEDIUM-HIGH (operator-facing daily) | LOW (single-place hook) | P1 (highest value-to-cost ratio) |
| 999.19 · Delegate routing | MEDIUM (research workflow foundation) | MEDIUM (3-prong change + 6 filter sites) | P2 |
| 999.20 · `/research` slash commands | MEDIUM (research workflow UX) | LOW-MEDIUM (rides 999.19 substrate) | P2 (gated on 999.19) |

**Priority key:**
- P1: Ship in v2.9 wave 1 (highest operator pain or highest value-to-cost)
- P2: Ship in v2.9 wave 2 — ROADMAP note: "Defer: 999.19+999.20 — need product decision on research-agent fleet shape"

---

## Discord Webhook Lifecycle Reference (MG-A Background)

Verified via Discord API docs issue trackers and community guides:

| Event | What Happens | API Signal |
|-------|--------------|------------|
| Webhook created | Token issued; **no TTL** | 200 + webhook object |
| Webhook deleted (manually or via Discord UI) | Token invalidated immediately | 404 `Unknown Webhook` on next use |
| Webhook token regenerated | Old token invalidated immediately | 401 `Unauthorized` on next use |
| Bot loses `MANAGE_WEBHOOKS` permission | Cannot create or update webhooks; existing webhooks still POSTable | 403 on management calls |
| Channel deleted | Webhook auto-deleted | 404 on next use |
| Cloudflare UA blocking | Some User-Agents (notably Python's `requests` default) get 1010 blocked | 403 / 1010 |

**Canonical auto-heal pattern for MG-A:**

```
try POST → success → done
try POST → 404 / 401 →
   re-create webhook via bot (needs MANAGE_WEBHOOKS)
   update registry with new ID + token
   retry POST once
   on success → log telemetry counter
   on second failure → fall through to inbox-heartbeat (existing path) + alert
```

Discord interaction tokens (15-min TTL) are a **different** lifecycle — they apply to slash-command response paths, not to `post_to_agent`'s outbound webhook sends. Don't conflate.

---

## Sources

- `.planning/PROJECT.md` — v2.9 milestone scope, Validated history, Out of Scope constraints
- `.planning/BACKLOG-CONSOLIDATED.md` — full triage (5 merge groups + 5 standalone + 5 pending-verify, from 33 candidate 999.x dirs)
- `.planning/phases/999.44-agent-to-agent-message-delivery-reliability/BACKLOG.md` — symptoms, hypotheses, acceptance criteria
- `.planning/phases/999.45-hourglass-to-thumbs-up-when-prompt-leaves-queue/BACKLOG.md` — icon states + runtime hook
- `.planning/phases/999.46-discord-table-rendering-auto-transform/BACKLOG.md` — code-block transform spec + alternatives discussion
- `.planning/phases/999.48-heartbeat-reply-leaks-to-user-channel/BACKLOG.md` — agent-owned cron-poll fix
- `.planning/phases/999.49-benchmarks-tab-tool-rollup-empty-rows/BACKLOG.md` — ranked hypotheses + diagnostic SQL
- `.planning/phases/999.36-.../999.36-02-PLAN.md` — completion gate, idle warning, autoArchive guard, one-time migration (7 tasks)
- `.planning/phases/999.36-.../999.36-03-PLAN.md` — chunk-boundary off-by-3 fix (4 tasks)
- `.planning/ROADMAP.md:1490-1534` — 999.19 + 999.20 detailed spec including the hard dependency
- [Discord API docs — Invalid Webhook Tokens (Issue #6851)](https://github.com/discord/discord-api-docs/issues/6851) — webhook lifecycle: delete+recreate, token regeneration, no TTL
- [Hooklistener — Discord Webhook Debugging Guide](https://www.hooklistener.com/guides/discord-webhook-debugging) — 404 vs 401 semantics + recovery patterns
- [Discord Markdown Guide (matthewzring gist)](https://gist.github.com/matthewzring/9f7bbfd102003963f9be7dbcf7d40e51) — code-block monospace pattern; Discord supports ~60% CommonMark, tables not in subset
- [Discord Feature Request: Advanced markdown (tables, lists)](https://support.discord.com/hc/en-us/community/posts/360040079832) — confirms native table rendering remains unsupported; code-block-with-padded-columns is standard workaround

---
*Feature research for: v2.9 Reliability & Routing — multi-agent Discord orchestration hardening*
*Researched: 2026-05-13*
