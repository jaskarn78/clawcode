# Architecture Research — v2.9 Reliability & Routing

**Milestone:** v2.9 Reliability & Routing (ClawCode)
**Researched:** 2026-05-13
**Confidence:** HIGH (all paths verified via Read on the actual source files; line numbers are post-`git status:clean` at master `0185a62`)

## Summary

v2.9 is a **patch-surface milestone**, not a new-subsystem milestone. Every fix lands inside an existing module; only one new module may be added (the `daemon-research-ipc.ts` for 999.20, mirroring the `daemon-post-to-agent-ipc.ts` blueprint).

Five integration surfaces:

1. **A2A delivery (`daemon-post-to-agent-ipc.ts` + `daemon-ask-agent-ipc.ts`)** — asymmetric implementations: `ask-agent` got the 999.12 IPC-02 bot-direct fallback; `post-to-agent` did not. This is the root cause of 999.44.
2. **Discord outbound formatter (`bridge.ts` + `webhook-manager.ts`)** — `wrapMarkdownTablesInCodeFence` is already wired in **2 of ~7** outbound paths. 999.46 closes the silent-path bifurcation by pushing the wrap down to the transport boundary.
3. **Subagent thread spawner (`subagent-thread-spawner.ts`)** — owns both the chunk-boundary off-by-3 (MG-B / 999.36-03), the delegated-thread channel-binding (999.19), and the premature-completion seam (MG-B / 999.36-02). All three live in the same 982-line file.
4. **Trace/SLO surface (`trace-store.ts` + `daemon.ts` augmentToolsWithSlo + `BenchmarksView.tsx`)** — the per-tool rollup has no cold-start guard parity with the headline path; null-percentile red styling is a frontend issue. Together they are the 999.49 root cause.
5. **MCP lifecycle (`process-tracker.ts`, `orphan-reaper.ts`, `reconciler.ts`, `proc-scan.ts`)** — already shipped end-to-end; MG-C is a soak/verify-only wave gated on operator-approved restart window.

Build-order recommendation: **MG-A → 999.45 → MG-D → MG-B+999.19 (same file, sequence) → 999.46 → MG-C → 999.20**.

## Per-MG Architecture

### MG-A · A2A + Subagent-Relay Delivery Reliability

**Members:** 999.44 (post_to_agent no-webhook), 999.45 (queue icon coherence), 999.48 (heartbeat-leak — **agent-side fix, not daemon**).

#### Files & Symbols

| File:line | Symbol | Current behavior | Patch action | New/Modified |
|---|---|---|---|---|
| `src/manager/daemon-post-to-agent-ipc.ts:193-198` | `handlePostToAgentIpc` → `hasWebhook(to)===false` branch | Logs `reason: "no-webhook"` and returns inbox-only via `inboxOnlyResponse` — **no bot-direct attempt** | Port the bot-direct fallback block from `daemon-ask-agent-ipc.ts:262-299` between the `hasWebhook` check and `inboxOnlyResponse`. Add `botDirectSender?` + extend `agentChannels` to `PostToAgentDeps` (mirror `AskAgentDeps:104-111`) | Modified |
| `src/manager/daemon.ts:8492-8520` | `case "post-to-agent"` deps construction | Wires `runningAgents, configs, agentChannels, webhookManager, writeInbox, log` only — no `botDirectSender` | Mirror `case "ask-agent"` block at `daemon.ts:8424-8431` to thread `botDirectSenderRef.current` through | Modified |
| `src/manager/daemon-ask-agent-ipc.ts:262-299` | `handleAskAgentIpc` mirror response bot-direct | **Reference implementation** — works in production per 999.12 Plan 02 deploy | (no change) | (reference) |
| `src/manager/daemon.ts:2958-3006` | `triggerDeliveryFn` (cron/trigger delivery) | Already has webhook→bot-direct fallback (correct shape) | (no change) | (reference) |
| `src/discord/webhook-manager.ts` | `hasWebhook` / `sendAsAgent` | Returns `false` when registry entry absent. Question: does it auto-reprovision on stale-webhook errors? | **Investigate per 999.44 hypothesis** — capture one live `no-webhook` event; webhook may exist in registry but be deleted on Discord side (50001/10003). Cross-check 999.14 `classifyDiscordCleanupError` at `src/discord/thread-cleanup.ts` for the prune-on-error shape that **should** apply to webhooks too | Modified (if hypothesis holds) |
| `src/discord/bridge.ts` (handleMessage, react path) | Hourglass `⏳` reaction at QUEUE_FULL | Single emoji per state — no "picked-up" transition | 999.45: add a SDK-call-started hook (turn dispatcher → bridge) that swaps reaction `⏳ → \U0001F44D`; on `turn.end("success")` swap to existing reply / on `turn.end("error")` to `❌` | Modified |
| `projects` agent's monitor loop (agent-side) | Cron-poll posts `HEARTBEAT_OK` to user channel | Wrong sink | 999.48: agent rewrites its own skill — null-action when nothing to report. **No daemon code change.** | (agent config) |

#### Patch point (the bug)

`handlePostToAgentIpc` and `handleAskAgentIpc` ship asymmetric webhook-failure semantics. The 999.12 IPC-02 fallback (bot-direct send via `BotDirectSender.sendText`) was added only to `ask-agent`. `post-to-agent` lands in `inboxOnlyResponse` whenever `webhookManager.hasWebhook(to)` returns false. Inbox heartbeat reconciler sweeps eventually, but the user-visible "live A2A" path is broken.

The MCP wrapper `src/mcp/server.ts:postToAgentHandler` reads `reason` and renders friendly text — so the operator's "no-webhook" message is the correctly-shaped output for a structurally broken path.

#### Build order constraint inside MG-A

999.45 depends on 999.44 being fixed first — the icon change requires the message to actually flow through Discord, not into a dead-end queue. 999.48 is independent (agent-side).

### MG-D · Dashboard Backend Observability Cleanup

**Members:** 999.49 (empty tool-rollup rows + null-percentile red styling), 999.7-B (split-latency producer regression), 999.7-C (`clawcode tool-latency-audit` Invalid Request).

#### Files & Symbols

| File:line | Symbol | Current behavior | Patch action | New/Modified |
|---|---|---|---|---|
| `src/performance/trace-store.ts:966-992` | `perToolPercentiles` prepared statement | SQL: `WHERE name LIKE 'tool_call.%'`, `SUBSTR(name, 11) AS tool_name`, `GROUP BY tool_name` — empty `tool_name` only possible if a span exists literally as `"tool_call."` | Add `AND LENGTH(s.name) > 11` guard; or add `HAVING tool_name != ''` (defensive). Run diagnostic SQL on prod DB first to confirm root cause vs SQL-binding drift (BACKLOG hypothesis 1) | Modified |
| `src/manager/session-adapter.ts:1697-1703` + `src/manager/persistent-session-handle.ts:670-676` | tool_use → `tool_call.${block.name}` span emission | Both guard `block.id && block.name` — should not emit `"tool_call."`. Empty rows suggest a third emit site or schema-migration drift | Investigation step. Run `sqlite3 ... "SELECT name, COUNT(*) FROM trace_spans WHERE name LIKE 'tool_call.%' AND LENGTH(name) <= 11 GROUP BY name;"` on prod | (investigation) |
| `src/manager/daemon.ts:414-438` | `augmentToolsWithSlo` | Applies `evaluateSloStatus` to per-tool rows. **No cold-start guard** unlike `evaluateFirstTokenHeadline` at line 483-525 which gates on `COLD_START_MIN_TURNS=5` | Add same cold-start guard for per-tool rows. For null percentiles `evaluateSloStatus` already returns `"no_data"` (slos.ts:118), so red styling must be a **frontend** bug | Modified |
| `src/dashboard/client/src/components/BenchmarksView.tsx:295-301` | `colorClass` resolver for percentile cells | Falls through to `text-danger` (breach-red) when `slo_status === "breach"` — but also when percentile is null + slo_status is no_data per BACKLOG hypothesis 3 | Treat null percentile values as `text-fg-3` (neutral) regardless of `slo_status`. Independent of data-layer fix; can ship parallel | Modified |
| `src/cli/commands/tool-latency-audit.ts:162-200` | `clawcode tool-latency-audit` CLI | Returns `Invalid Request` post-deploy per STATE.md:706. Already hotfixed in Phase 106 TRACK-CLI-01 (commit `fa72303`) | **Verify** the hotfix is sufficient via clawdy smoke; capture exact param shape on failure | (verification) |
| `src/manager/daemon.ts:3949` (`case "tool-latency-audit"`) + `src/performance/trace-collector.ts` split-latency emit block | sub-scope 17(a/b/c) split-latency columns | NULL in production per 999.7-B follow-up. Producer regression somewhere between Phase 115-08 ship and now | Trace produce-path. `trace-collector.ts:649` "fold one tool_call.<name> span's pure-execution" block. Find regression via `git log -S "tool_use_emitted_to_first_text_chunk"` or similar telemetry column names | Modified |

#### Patch points (the bugs)

- **Empty tool rows:** Need SQL diagnostic on prod DB. If empty `tool_name` spans literally exist → find emitter. If 19 rows reflect SQL-binding drift on `"Admin Clawdy"` agent-name-with-space → fix parameter binding.
- **Red-styled null percentiles:** Frontend-only fix in `BenchmarksView.tsx`. Data layer correctly returns `slo_status: "no_data"`.
- **Split-latency NULL columns:** Producer regression — code path that should emit `tool_use_emitted_to_first_text_chunk` / `tool_result_arrived_to_next_assistant` / `tool_roundtrip_ms` (per trace-store.ts:790-835) has stopped firing.
- **CLI Invalid Request:** Already hotfixed per Phase 106 — needs operator-runnable re-verification only.

### MG-B · Subagent UX Completion + Chunk-Boundary

**Members:** 999.36-02 (premature-completion gate), 999.36-03 (chunk-boundary off-by-3).

#### Files & Symbols

| File:line | Symbol | Current behavior | Patch action | New/Modified |
|---|---|---|---|---|
| `src/discord/subagent-thread-spawner.ts:346-355` | Relay editor `editFn` truncate | `wrapped.length > 2000 ? wrapped.slice(0, 1997) + "..." : wrapped` — editor truncates content at 1997 chars + ellipsis | Capture the editor's actual cutoff index in state. Either truncate at exactly 2000 (no ellipsis on partial — caller's overflow loop will continue) and set overflow `cursor = 2000`, OR keep ellipsis and set `cursor = 1997` so the overflow loop picks up exactly where the editor left off | Modified |
| `src/discord/subagent-thread-spawner.ts:388-415` | Overflow loop `cursor = 2000` starting point | Drops bytes 1997-1999 (the seam) — **already self-diagnosed at lines 423-438**: `editorCutoffIndex: 1997, overflowStartCursor: 2000, seamGapBytes: 3` | Set `cursor` based on editor's actual cutoff. Mirror fix needed in the `postInitialMessage` overflow loop later in the file | Modified |
| `src/discord/subagent-thread-spawner.ts` ~700-900 | Premature completion gate (D-12 source distribution) | Subagent considered "done" before stream drains OR before delivery confirms. Plan 00 already shipped source-tagged diagnostics for the 5+ day prod observation | Identify the path that fires prematurely from prod diagnostics (D-12 source tag); gate completion on stream-end AND delivery-confirm rather than the earliest signal | Modified |
| `src/discord/subagent-typing-loop.ts` | Typing-indicator loop | Stops on completion signal — paired with the completion gate above | Verify the gate change doesn't leave the typing loop dangling on the new (delayed) signal | Modified (verification) |

#### Patch point (the bug)

Two distinct seams in the same file:
1. **Off-by-3:** Editor truncates string at 1997 (1997 chars + 3 chars of `...`), overflow loop reads from cursor=2000. Bytes 1997-1999 are written nowhere. The existing diag log at line 423-438 is *literally named* `seamGapBytes: 2000 - 1997 = 3`.
2. **Premature completion:** Subagent's "done" event fires before all chunks have been posted, causing the typing loop to stop and the parent agent's relay to read partial content.

#### Build order

Plan 03 has `depends_on: 999.36-02`. Ship 02 first (gate the event), then 03 (fix the byte-seam). Both edit the same file; sequence them to avoid merge churn.

### MG-C · MCP Lifecycle Verification Soak

**Members:** 999.6-02, 999.14-02, 999.15-04, mcp-tracker CLI follow-up.

#### Files & Symbols

| File:line | Symbol | Current behavior | Patch action | New/Modified |
|---|---|---|---|---|
| `src/mcp/process-tracker.ts:122-330` | `McpProcessTracker` class | Shipped end-to-end; confirmed working in 999.12 Plan 02 deploy 2026-04-30 ("Zero MCP orphans post-restart") | **No code change.** Soak-and-verify only | (no change) |
| `src/mcp/proc-scan.ts:55-400` | `/proc` walk + `discoverClaudeSubprocessPid`, `discoverAgentMcpPids` | Shipped — single-shot per-agent PID discovery + 1s settle window | **No code change** | (no change) |
| `src/mcp/orphan-reaper.ts:87-185` | `reapOrphans` + `startOrphanReaper` | 60s reaper interval, boot-time scan, `onTickAfter` sweep wiring all live | **No code change** | (no change) |
| `src/mcp/reconciler.ts` | `Reconciler` per-tick self-healing | Shipped (Plan 02) | **No code change** | (no change) |
| `src/manager/mcp-tracker-snapshot.ts:1-95` | `buildMcpTrackerSnapshot` pure builder | Shipped Plan 03 | **No code change** | (no change) |
| `src/cli/commands/mcp-tracker.ts:1-272` | `clawcode mcp-tracker` CLI | Shipped Plan 03 | Verify hotfix `fa72303` (TRACK-CLI-01 Phase 106) closes "Invalid Request" | (verification) |
| `src/manager/snapshot-manager.ts` | Pre-deploy snapshot + restore | Confirmed working end-to-end via 999.12 Plan 02 — 6 agents auto-restored | **No code change** | (no change) |

#### Patch point

**Zero new code.** MG-C is the four pre-written Wave-2/4 plans executed sequentially in one operator-approved restart window. Bundle:
1. `systemctl restart clawcode` 5× in succession.
2. Per restart: `ssh clawdy 'pgrep -cf mcp-server-mysql'` matches live agent count; `ps -ef | awk "\$3==1 && /mcp-server-mysql/"` count is 0.
3. Operator runs `clawcode mcp-tracker` (verify exit codes 0/1/2/3 against live state) + `clawcode threads prune --stale-after 24h`.
4. Verify `grep "prune-after-discord-error" daemon.log`.

### 999.46 · Discord Table Auto-Transform

**Member:** standalone item.

#### Files & Symbols

| File:line | Symbol | Current behavior | Patch action | New/Modified |
|---|---|---|---|---|
| `src/discord/markdown-table-wrap.ts:41` | `wrapMarkdownTablesInCodeFence(content)` | Already implemented. Pure function. Wraps `\| header \| ...\n\| --- \|` blocks in ```` ```text ```` fences. Idempotent on already-fenced content | **No change to the helper** | (no change) |
| `src/discord/bridge.ts:736` | `streamAndPostResponse` editFn — WIRED | Wraps on streaming edits | (no change) | (reference) |
| `src/discord/subagent-thread-spawner.ts:347` + `:389` | Subagent relay editor + overflow chunks — WIRED | Wraps before send | (no change) | (reference) |
| `src/discord/bridge.ts:908` | `messageRef.current.edit(response)` post-advisor-footer — **NOT WIRED** | Sends `response` (post advisor-footer mutation) without wrapping. Silent-path bifurcation. | Wrap before edit/send — or push wrap into `webhookManager.send` (preferred — transport-boundary chokepoint) | Modified |
| `src/discord/bridge.ts:1268` | `sendDirect` → `webhookManager.send(resolvedAgent, response)` — **NOT WIRED** | Sends raw response | Wrap inside `webhookManager.send` (single chokepoint approach) | Modified |
| `src/discord/bridge.ts:1280` `:1287` | `channel.send(response)` / split-chunk channel.send — **NOT WIRED** | Sends raw chunks | Wrap before send (or inside transport-boundary helper) | Modified |
| `src/manager/daemon.ts:2989,2999` | `triggerDeliveryFn` webhook/bot-direct send — **NOT WIRED** | Cron/scheduler delivery sends raw text | Wrap before send (or inside transport-boundary helper) | Modified |
| `src/manager/daemon-ask-agent-ipc.ts:210,244,286` | A2A mirror + bot-direct fallback sendAsAgent / sendText — **NOT WIRED** | Mirrors sent raw | Wrap before send (or inside transport-boundary helper) | Modified |
| `src/discord/webhook-manager.ts` | `WebhookManager.send` / `sendAsAgent` | Public surface for all webhook posts | **Push the wrap here.** Single chokepoint at the transport boundary — every webhook post inherits. Embed `description` body wrapping (for `buildAgentMessageEmbed`) needs special handling because embeds render their description differently than channel-content | Modified (preferred approach) |

#### Patch point (the bug)

**`formatDiscordMessage` (bridge.ts:1306) is NOT the right hook** — it formats INBOUND user messages (renders `<channel>` tags + attachment metadata for the agent to read). Outbound formatting is scattered across at least 7 send-sites; only 2 currently wrap markdown tables.

**Two architectural options:**

| Approach | Pro | Con |
|---|---|---|
| **A. Single chokepoint at transport boundary** (wrap inside `WebhookManager.send` + `sendAsAgent`, and `BotDirectSender.sendText`) | Truly single hook; every outbound path inherits | Embed `description` body wrapping is different (need to wrap the embed.description string, not the message content). Requires careful inspection of `buildAgentMessageEmbed` |
| **B. Wrap at every send-site** | Simpler — each site explicitly opts in | Violates the harness's silent-path-bifurcation memory; new send-sites will silently miss the wrap |

**Recommendation: Approach A** with a transport-side helper that:
1. Wraps `content` parameter in `WebhookManager.send(name, content)`.
2. Wraps `embed.description` if `embed` is provided to `sendAsAgent` (mutates a copy of the embed builder).
3. Wraps `text` parameter in `BotDirectSender.sendText(channelId, text)`.

This obsoletes per-agent `feedback_no_wide_tables_discord.md` workarounds and pre-emptively fixes future send-paths.

### 999.19 · Delegate-Channel Routing

**Member:** standalone (blocks 999.20).

#### Files & Symbols

| File:line | Symbol | Current behavior | Patch action | New/Modified |
|---|---|---|---|---|
| `src/discord/subagent-thread-spawner.ts:502` | `const channelId = parentConfig.channels[0]` | **Always uses parent's channel** even when `delegateTo` is set. Thread gets created on the parent's primary channel | When `normalizedDelegateTo` is set, prefer `delegateConfig.channels[0]` with fallback to `parentConfig.channels[0]` | Modified |
| `src/discord/subagent-thread-spawner.ts:642-649` | `binding: ThreadBinding` write | `parentChannelId: channelId` (now correctly = delegate's channel if delegated) | (inherits the line-502 fix — no change needed once 502 fixes) | Modified (transitive) |
| `src/discord/subagent-thread-spawner.ts:315,329,366` | Relay path reads `binding.parentChannelId` | Already routes via binding — correct downstream once binding stores delegate channel | (no change) | (reference) |
| `src/discord/subagent-thread-spawner.ts:645` | `agentName: config.parentAgentName` | Binding tags the parent agent — any filter that says "this binding belongs to parent X" will accidentally bucket delegated subagents | **Add `delegateAgentName?: string`** to `ThreadBinding` schema so filters can distinguish parent vs delegate ownership. Required for 999.20 memory consolidation | Modified |
| `src/discord/thread-types.ts` (binding shape) | `ThreadBinding` interface | Has `threadId, parentChannelId, agentName, sessionName, createdAt, lastActivity` | Add optional `delegateAgentName?: string` (back-compat — pre-v2.9 bindings parse cleanly) | Modified |
| `src/discord/subagent-thread-spawner.ts:533` | `-via-` infix session-name pattern | `${parent}-via-${delegate}-${shortId}` | Per BACKLOG-CONSOLIDATED.md:70: "fix the `-via-` naming-pattern leak across 5+ filter sites" — audit `grep -rn "via-" src/` for filters that may include/exclude on this pattern | Modified (audit) |
| `src/manager/__tests__/clawcode-share-file-shared-workspace.test.ts` | Existing regression test pinning fin-acquisition leak class | Pinned via `FIN_ACQ_THREAD` / `CONTENT_CREATOR_CHANNEL` | Add a parallel test for delegate-channel routing: delegated subagent's thread is on delegate's channel, not parent's | Modified |
| `src/manager/daemon.ts` (memory consolidation cron) | Memory consolidation handler | Writes consolidated memory to parent's `memoryPath` | Per ROADMAP.md:1497-1516 spec: consolidate INTO delegate's SQLite, not parent's. **Requires `binding.delegateAgentName` from above** | Modified |
| `src/discord/subagent-thread-spawner.ts` defaults | `autoArchive` default | Currently relies on `autoArchiveDuration: 1440` Discord-side | Per 999.19 spec: confirm `autoArchive: true` for delegate path; verify Discord-side auto-archive interacts cleanly | Modified |

#### Patch point (the bug)

A delegated subagent currently creates a Discord thread on the **parent's** channel (line 502), even though the subagent operates with the **delegate's** identity (model, soul, skills per D-INH-01..03 from Phase 999.3). Result: a delegate's work gets posted into the parent's primary channel, polluting the parent's operator-facing surface with delegate-identity messages.

The smallest change is a one-line conditional at line 502:
```typescript
const channelId =
  (delegateConfig?.channels?.[0]) ?? parentConfig.channels[0];
```
But this is **incomplete** — the binding's `agentName` still records the parent, so 999.20 memory consolidation (`/research` slash command writes into the delegate's SQLite) cannot find the delegate from the binding alone. Add `delegateAgentName` to `ThreadBinding`.

### 999.20 · `/research` + `/research-search` Slash Commands

**Member:** depends on 999.19 landing first.

#### Files & Symbols

| File:line | Symbol | Current behavior | Patch action | New/Modified |
|---|---|---|---|---|
| `src/discord/slash-commands.ts` | Slash-command registration | Per-agent slash commands registered via SDK initializationResult | Register `/research` and `/research-search` as control-plane commands (not prompt-channel) | Modified |
| `src/manager/native-cc-commands.ts` | Native SDK control-plane dispatch | Maps slash commands to IPC methods | Add `research` + `research-search` IPC methods | Modified |
| `src/manager/daemon.ts` (new case in `routeMethod`) | New IPC handlers | (does not exist) | Add `case "research":` and `case "research-search":` — spawn a delegated subagent (per 999.19) for `/research`, scoped semantic search of delegate's memory for `/research-search` | Modified |
| `src/manager/daemon-research-ipc.ts` | Pure-DI handler | (does not exist) | New module mirroring `daemon-post-to-agent-ipc.ts` blueprint — testable without daemon spin-up | **New** |
| `src/manager/memory-lookup-handler.ts` | Existing memory_lookup MCP tool | Already supports scope filtering (v1.9 FTS5 + BM25) | Add a scope parameter for delegate-name-scoped lookup | Modified |

#### Patch point

Standard slash-command + IPC handler addition pattern (mirrors `/clawcode-effort`, `/clawcode-model` from v2.2 Phase 86/87 — exact reference: `src/manager/native-cc-commands.ts` + handler functions like `handleSetModelIpc`). Wait for 999.19 to land so delegate routing semantics are settled before wiring the consumer.

## Data Flow Diagrams

### A2A Delivery End-to-End (post_to_agent IPC)

```
Sender agent (MCP tool call)
   │
   │  mcp__clawcode__post_to_agent { from, to, message }
   │
   ▼
src/mcp/server.ts :: postToAgentHandler
   │
   │  IPC call to daemon socket: method="post-to-agent"
   │
   ▼
src/manager/daemon.ts :: routeMethod case "post-to-agent" (line 8471-8521)
   │
   │  Reads: configs, runningAgents, routingTableRef.current.agentToChannels,
   │         webhookManager. Constructs writeInbox closure.
   │  Dynamic import of handlePostToAgentIpc.
   │
   ▼
src/manager/daemon-post-to-agent-ipc.ts :: handlePostToAgentIpc
   │
   ├─ Step 1: configs.find(c => c.name === to)
   │           │ NOT FOUND ───────► throw ManagerError("Target agent 'X' not found")
   │           │                    (the only fail-loud path)
   │           ▼ FOUND
   │
   ├─ Step 2: writeInbox({from, to, content: message})
   │           ── writes nanoid-id JSON to <target.memoryPath>/inbox/<id>.json
   │           │ FAILED ──► throw ManagerError("Inbox write failed for 'X': ...")
   │           ▼ OK → messageId
   │
   ├─ Step 3: targetChannels = agentChannels.get(to)
   │           │ EMPTY ──► log {reason: "no-target-channels"} → inboxOnlyResponse → return
   │           ▼ NON-EMPTY
   │
   ├─ Step 4: webhookManager.hasWebhook(to)
   │           │ FALSE ──► log {reason: "no-webhook"} → inboxOnlyResponse → return
   │           │           ★★★ 999.44 PATCH POINT — currently no bot-direct fallback ★★★
   │           │           ★ Port the `daemon-ask-agent-ipc.ts:262-299` block here ★
   │           ▼ TRUE
   │
   ├─ Step 5: buildAgentMessageEmbed(from, senderDisplayName, message)
   │           webhookManager.sendAsAgent(to, senderDisplayName, senderAvatarUrl, embed)
   │           │ THROWS ──► log {reason: "webhook-send-failed"} → inboxOnlyResponse → return
   │           ▼ OK
   │
   └─ Return {ok: true, delivered: true, messageId}

   Fallback path (target not running, inbox-only):
   ────────────────────────────────────────────────
   inboxOnlyResponse checks runningAgents.includes(to):
     │ FALSE ──► logs {reason: "target-not-running", primaryReason: <orig>}
     │           Heartbeat reconciler at next sweep (default 60s per HB-01)
     │           reads <memoryPath>/inbox/ → if target dead, no dispatch.
     │           If target alive, src/heartbeat/checks/inbox.ts dispatches a turn.
     ▼
   Returns {ok: true, delivered: false, messageId, reason}
   → MCP wrapper at src/mcp/server.ts:postToAgentHandler renders:
     "Message written to <to>'s inbox (reason: <reason>). Webhook delivery
      failed, they will receive it on their next inbox-heartbeat sweep."
```

**Symmetric `ask-agent` shape** (correct reference at `daemon-ask-agent-ipc.ts`):

```
Step 4 (no-webhook + mirror=true):
   ▼
   deps.botDirectSender.sendText(channelId, truncated)
   ── channelId from agentChannels.get(to)?.[0] ?? configs.find(c=>c.name===to)?.channels?.[0]
   ── plain text (no embed), 2000-char truncate + ellipsis
   ── best-effort, never aborts the ask
```

### MCP Child-Process Lifecycle

```
                          BOOT (systemctl restart clawcode)
                                       │
                                       ▼
src/manager/daemon.ts:~1576-1632  preResolveAll secrets
                                       │
                                       ▼
new McpProcessTracker(...)  ◄────── construct singleton
                                       │
                                       ▼
src/mcp/orphan-reaper.ts reapOrphans({reason: "boot-scan"})
   │
   │  /proc walk for PPID=1 processes matching mcp cmdline regexes
   │  ── kill any orphans BEFORE manager.startAll
   │  ── handles "previous daemon SIGKILL'd leaving orphan MCPs"
   │
   ▼
manager.startAll() — for each agent:
   │
   ▼
SessionManager.startAgent(name, config)
   │
   ├─ spawns claude CLI subprocess via Claude Agent SDK
   │
   ├─ awaits MCP_SPAWN_SETTLE_MS (1s) — npm-wrapper grandchildren settle
   │
   ├─ src/mcp/proc-scan.ts discoverClaudeSubprocessPid(daemonPid)
   │   ── walks /proc for the most-recent-started `claude` child
   │   ── filtered: ppid === daemonPid, cmdline matches "claude"
   │
   ├─ src/mcp/proc-scan.ts discoverAgentMcpPids(claudePid, patterns)
   │   ── enumerates MCP grandchildren of the claude PID
   │   ── patterns from buildMcpCommandRegexes(config.mcpServers)
   │
   └─ tracker.register(name, claudePid, mcpPids)
       │
       │  enrichment side-effect: per-PID `/proc/{pid}/cmdline` cache write
       │  (async, best-effort — race-safe via Map writes)
       ▼
       Tracker singleton state:
       Map<agentName, { claudePid, mcpPids, registeredAt, cmdlines }>

                                       │
                                       ▼
                          STEADY STATE (every 60s tick)
                                       │
                                       ▼
src/mcp/reconciler.ts Reconciler.tick()
   │
   │  For each registered agent (snapshot names BEFORE iterating):
   │   ├─ isPidAlive(claudePid)?
   │   │   │ NO ──► unregister(name) — reason="claude-gone"
   │   │   ▼ YES
   │   ├─ For each mcpPid:
   │   │   ├─ isPidAlive(mcpPid)?
   │   │   │   │ NO ──► replaceMcpPids drops dead ones
   │   │   │   ▼ YES (no-op)
   │   └─ Polled discovery: re-walk /proc for current MCP children
   │       ── catches MCP respawns the tracker missed
   │
   ▼
src/mcp/orphan-reaper.ts reapOrphans({reason: "tick"})
   │
   │  Walks /proc for ppid=1 MCP processes; AGE >= 5s
   │  ── for each: kill -9 (orphans are dead-parent processes)
   │
   │  onTickAfter callback fires AFTER reap:
   │   └─ src/discord/stale-binding-sweep.ts sweepStaleBindings
   │       ── prunes thread bindings idle > defaults.threadIdleArchiveAfter

                                       │
                                       ▼
                                  CRASH PATH
                                       │
                                       ▼
SessionManager.onError(name) — SDK emitted crash event
   │
   ▼
tracker.killAgentGroup(name, 5000)  — SIGTERM-then-SIGKILL
   │  process.kill(-pid)  — process group (validated pid>1)
   │  idempotent — second call on dead PIDs is safe no-op
   ▼
unregister(name)  — drops from tracker map

                                       │
                                       ▼
                                STOP / SHUTDOWN
                                       │
                                       ▼
SessionManager.stopAgent(name) ─► tracker.killAgentGroup(name, 5000)

graceful daemon shutdown:
   │ clearInterval(reaperInterval)
   ▼
   tracker.killAll(5000)  — SIGTERM every tracked PID with grace
   ▼
   pid-file unlink

                                       │
                                       ▼
                            OPERATOR VISIBILITY
                                       │
                                       ▼
clawcode mcp-tracker [-a <agent>]  CLI
   │
   ▼
IPC call: method="mcp-tracker-snapshot" {agent?}
   │
   ▼
daemon.ts:5183-5230 closure-intercept BEFORE routeMethod
   │
   ▼
src/manager/mcp-tracker-snapshot.ts buildMcpTrackerSnapshot(tracker, agentFilter?)
   │
   ▼
{agents: [{agent, claudePid, claudeAlive, mcpPids, aliveCount, totalCount, cmdlines, registeredAt}]}
   │
   ▼
CLI renders table or verbose mode; exit codes 0/1/2/3
```

## Patch Surface Map (per-file roll-up)

| File | MG-A | MG-B | MG-C | MG-D | 999.46 | 999.19 | 999.20 |
|---|---|---|---|---|---|---|---|
| `src/manager/daemon-post-to-agent-ipc.ts` | ●● port bot-direct | | | | | | |
| `src/manager/daemon.ts` (`case "post-to-agent"`) | ●● thread deps | | | ● augmentToolsWithSlo cold-start | ● triggerDeliveryFn wrap | | ● new IPC cases |
| `src/manager/daemon-ask-agent-ipc.ts` | (reference) | | | | ● mirror wrap | | |
| `src/discord/bridge.ts` | ● icon transitions (999.45) | | | | ●● close wrap gaps | | |
| `src/discord/webhook-manager.ts` | ● probe stale-webhook auto-reprov (hypothesis) | | | | ●● single chokepoint wrap | | |
| `src/discord/subagent-thread-spawner.ts` | | ●● gate + chunk-boundary | | | (already wired) | ●● line 502 channel routing + binding shape | |
| `src/discord/thread-registry.ts` / thread-types.ts | | | | | | ● add delegateAgentName field | |
| `src/discord/subagent-typing-loop.ts` | | ● verify gate change | | | | | |
| `src/performance/trace-store.ts` | | | | ●● per-tool SQL guard | | | |
| `src/dashboard/client/src/components/BenchmarksView.tsx` | | | | ●● null-percentile color | | | |
| `src/performance/trace-collector.ts` | | | | ● split-latency regression | | | |
| `src/cli/commands/tool-latency-audit.ts` | | | | ● verify hotfix | | | |
| `src/mcp/*` (broker, tracker, reaper, reconciler, proc-scan) | | | (verify-only soak) | | | | |
| `src/discord/slash-commands.ts` + `src/manager/native-cc-commands.ts` | | | | | | | ● register /research |
| `src/manager/daemon-research-ipc.ts` | | | | | | | ●● **new** pure-DI handler |
| `src/manager/memory-lookup-handler.ts` | | | | | | | ● scoped lookup |

Legend: ● = touched, ●● = primary edit site.

## Build Order

| Wave | Item(s) | Rationale |
|---|---|---|
| **1** | MG-A 999.44 (post-to-agent bot-direct fallback) | Highest operator pain. Single-file delta in `daemon-post-to-agent-ipc.ts` + small deps wiring in `daemon.ts`. Pure-DI handler means unit tests can pin the contract without daemon spin-up. Re-validates the 999.12 deploy. |
| **2** | 999.45 (icon transitions) | Requires MG-A live so the icon transition is observable. Smaller. Add SDK-call-started hook → bridge reaction swap. |
| **3** | MG-D (999.49 + 999.7 follow-ups) | Highest perceived value post-Phase-116 (operator just opened Benchmarks tab and "none of the benchmarks work"). Diagnostic SQL already prescribed. Frontend null-percentile color fix is independent and can ship parallel. |
| **4** | 999.19 + MG-B (999.36 Plans 02 + 03) | **Same file (`subagent-thread-spawner.ts`).** Land 999.19 first (delegate channel routing — adds `delegateAgentName` to binding schema, line 502 conditional), then MG-B Plan 02 (premature completion gate), then MG-B Plan 03 (chunk-boundary). Three sequenced commits in one PR avoids merge churn. |
| **5** | 999.46 Discord table auto-transform | Transport-boundary chokepoint wrap (push into `WebhookManager.send`/`sendAsAgent` + `BotDirectSender.sendText`). Run AFTER MG-A so the post-to-agent bot-direct path also inherits the wrap when MG-A ports the fallback. |
| **6** | MG-C verification soak | Pure execution of pre-written Wave-2/4 plans. One operator-approved restart window closes 999.6, 999.14, 999.15 formally. Schedule when Ramy quiet ≥25 min per `feedback_ramy_active_no_deploy`. |
| **7** | 999.48 agent-side fix | Operator asks projects agent to rewrite its own monitor loop. No daemon code change. Can run parallel to any wave. |
| **8** | 999.20 `/research` + `/research-search` | Depends on 999.19 binding-schema and delegate-channel landing first. |

### Cross-MG conflict map

- **MG-A and 999.19 both touch channel routing** but at different layers — MG-A adds bot-direct fallback inside the IPC handler reading from `routingTable.agentToChannels`; 999.19 changes which channel a thread binding records. A2A resolves via routing table (not bindings), so they're orthogonal. Can ship parallel.
- **MG-B and 999.19 both touch `subagent-thread-spawner.ts`** — sequence in Wave 4 to avoid merge churn.
- **MG-A and 999.46 touch outbound delivery paths** — sequence 999.46 AFTER MG-A so the new bot-direct fallback path inherits the wrap from day one.
- **MG-D backend (SQL/SLO) and 999.49 frontend fix are independent** — frontend can ship anytime.

## New Components vs Modified Components (per MG)

| Merge group | New modules | Modified modules |
|---|---|---|
| MG-A | (none) | `daemon-post-to-agent-ipc.ts`, `daemon.ts`, `bridge.ts` (icon), `webhook-manager.ts` (if auto-reprov hypothesis) |
| MG-B | (none) | `subagent-thread-spawner.ts`, `subagent-typing-loop.ts` |
| MG-C | (none — verification only) | (none — verification only) |
| MG-D | possible: small SLO-classifier helper (cold-start guard for per-tool rows) | `trace-store.ts`, `daemon.ts` (`augmentToolsWithSlo`), `BenchmarksView.tsx`, `trace-collector.ts`, `tool-latency-audit.ts` (verify hotfix) |
| 999.46 | (none) | `webhook-manager.ts` (single chokepoint), `bridge.ts` (sendDirect, edit), `daemon.ts` (triggerDeliveryFn), `daemon-ask-agent-ipc.ts` (mirror) |
| 999.19 | (none) | `subagent-thread-spawner.ts`, `thread-registry.ts`, `thread-types.ts`, `daemon.ts` (memory consolidation handler) |
| 999.20 | `daemon-research-ipc.ts` (pure-DI module mirroring `daemon-post-to-agent-ipc.ts` blueprint) | `slash-commands.ts`, `native-cc-commands.ts`, `daemon.ts`, `memory-lookup-handler.ts` |

## Sources

Verified via Read on the working tree (commit `0185a62`):

- `src/manager/daemon-post-to-agent-ipc.ts:1-258` — asymmetric no-webhook path (999.44 root cause)
- `src/manager/daemon-ask-agent-ipc.ts:1-303` — bot-direct fallback reference shape
- `src/manager/daemon.ts:2958-3006` (`triggerDeliveryFn`), `:8361-8521` (ask/post IPC cases), `:5183-5230` (mcp-tracker-snapshot intercept), `:414-525` (SLO augmentation)
- `src/discord/bridge.ts:34, 736, 906-910, 1232-1289, 1306` — outbound paths + table-wrap call sites + INBOUND formatter
- `src/discord/markdown-table-wrap.ts:1-87` — existing wrapper (already idempotent)
- `src/discord/subagent-thread-spawner.ts:340-450, 460-660` — chunk-boundary seam, channel binding, delegate-aware config compose
- `src/performance/trace-store.ts:206, 390-442, 859-1000` — per-tool percentile SQL
- `src/performance/slos.ts:80-220` — `evaluateSloStatus`, `CACHE_HIT_RATE_SLO`
- `src/manager/session-adapter.ts:1697-1708`, `src/manager/persistent-session-handle.ts:670-676` — `tool_call.${block.name}` emit sites (guarded by `block.id && block.name`)
- `src/mcp/process-tracker.ts:42-330` — McpProcessTracker class surface
- `src/mcp/proc-scan.ts:55-400` — `/proc` walk helpers
- `src/mcp/orphan-reaper.ts:87-185` — `reapOrphans` + `startOrphanReaper`
- `src/mcp/reconciler.ts:1-90` — per-tick reconciler
- `src/manager/mcp-tracker-snapshot.ts` — `buildMcpTrackerSnapshot` pure builder
- `.planning/phases/999.12-.../999.12-02-SUMMARY.md` — 999.12 IPC-02 deploy outcome
- `.planning/phases/999.14-.../999.14-01-SUMMARY.md` — MCP lifecycle Wave 1 GREEN
- `.planning/phases/999.15-.../999.15-03-SUMMARY.md` — mcp-tracker IPC+CLI shipped
- `.planning/phases/999.36-.../999.36-01-SUMMARY.md` — share-file channel-routing fix + deferred items
- `.planning/phases/999.44-.../BACKLOG.md`, `999.45-.../BACKLOG.md`, `999.48-.../BACKLOG.md`, `999.49-.../BACKLOG.md` — operator-reported failure modes

---
*Architecture research for: ClawCode v2.9 Reliability & Routing*
*Researched: 2026-05-13*
