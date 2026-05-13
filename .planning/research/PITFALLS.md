# v2.9 Reliability & Routing — Pitfalls

**Milestone:** v2.9 Reliability & Routing
**Domain:** Multi-agent Discord-routed daemon (ClawCode)
**Researched:** 2026-05-13
**Posture:** Opinionated — each pitfall comes with a phase mapping and a concrete prevention lever (probe, test type, rollback). Generic "handle errors" advice is omitted by design.

The whole milestone *is* a pitfall-closure pass — every entry below cites a production incident, a commit hash, or a load-bearing file:line. Confidence is HIGH unless flagged otherwise (LOW where prevention has not yet been validated in production).

---

## Summary

The v2.9 risk surface clusters into six subsystems plus two cross-cutting failure patterns:

| Subsystem | Top pitfall | Primary phase threatened |
|-----------|-------------|--------------------------|
| Discord webhook delivery | Cached-singleton webhook map never reconciles against Discord reality | MG-A (999.44) |
| MCP lifecycle | Tracker drift vs `/proc` reality; reaper race during boot orphan scan | MG-C (999.14, 999.15) |
| Stream chunking | Editor-truncate vs overflow-start off-by-N; same pattern hides in *other* split helpers | MG-B (999.36-03) |
| Dashboard data | NULL percentiles default to `breach` styling; producer regressions invisible | MG-D (999.49, 999.7 follow-ups) |
| Delegate routing | "Primary channel" vs "thread parent channel" semantics drift across heartbeat / memory / webhook resolution | 999.19, 999.20, 999.48 |
| Deploy constraints | Ramy-active + 30-90s mid-restart message drop; many v2.9 fixes need an operator-coordinated window | MG-C entire, hot-fixes |
| **CROSS-CUTTING: Silent Path Bifurcation** | Code that "looks right" but production never executes it | MG-A primary, every IPC/telemetry/handler change |
| **CROSS-CUTTING: NULL-as-zero / NULL-as-breach** | Empty data renders as failure state | MG-D primary, any future SLO panel |

---

## Critical: Silent Path Bifurcation (dedicated subsection)

**This is the #1 risk for MG-A and every IPC/telemetry/handler change in v2.9.** Per `feedback_silent_path_bifurcation.md`, this pattern has bitten the project at least 3× in 2026:

1. **Phase 115-08 producer regression (2026-05-11)** — `tool_execution_ms` / `tool_roundtrip_ms` producer call sites added to `session-adapter.ts:iterateWithTracing` (the *test-only* path). Production uses `persistent-session-handle.ts:iterateUntilResult`. Columns silently NULL across the fleet for 3 days post-deploy.
2. **`post_to_agent` silent drops (2026-05-11)** — fire-and-forget returns a queue id that *looks* task-shaped but `task_status` returns "not found" because they're different systems. Messages between agents silently disappear; no error, no log to operator.
3. **Hot-fix wrong-cause loop (commit `ca387d9` revert 2026-05-08)** — typing rate-limit tracker hotfix landed on a code path that wasn't the actual rate-limit-firing site (Cloudflare bucket downgrade was the real cause).

**Why this codebase is uniquely vulnerable:** parallel implementations of the same logical operation are everywhere — multiple session-handle variants, multiple delivery systems (`post_to_agent` vs `delegate_task` vs `ask_agent` vs inbox-heartbeat vs webhook-direct), multiple cron entry points, multiple chunk-boundary writers (subagent-thread-spawner vs webhook-manager `splitMessage`).

**The detection invariant:** *if your code's effect is observable only by absence (NULL columns, dropped messages, missing logs), then a wiring sentinel is mandatory.* Visible-success-by-default features don't need this — you'd notice immediately if production didn't render them.

### Concrete v2.9 high-risk sites

| Phase | Bifurcation risk | Why it's a trap |
|-------|------------------|-----------------|
| 999.44 (MG-A) | `WebhookManager.hasWebhook` is a ReadonlyMap check (`src/discord/webhook-manager.ts:24,36`) populated *once* at construction. Tests pass with mocks that return `true`. Production may return `true` for a webhook Discord deleted hours ago. | The fix path you're tempted to add (reconcile-on-401) must run on **every** delivery attempt, not just `post_to_agent` — `bridge.ts:917 sendDirect`, `daemon.ts:3544`, and `usage/daily-summary.ts:111` also reach webhook delivery (per Phase 100-fu evidence in `webhook-manager.ts:62-67` comments). |
| 999.45 (MG-A) | Hourglass→👍 icon transition needs a hook on "model call started." There are at least 4 places this could be observed: SDK driverIter first chunk, TurnDispatcher's pre-stream phase, first tool-call event, first stream-json line. Picking the wrong one → emoji flips when no work happened, or never flips when it did. | Wire the hook on the *single chokepoint* TurnDispatcher (per v1.8 decision in `PROJECT.md:77`). Any wiring downstream of TurnDispatcher risks bypass paths. |
| 999.36-02 (MG-B) | "Premature completion gate" — there are multiple definitions of "subagent done": SDK turn finished, last edit landed, overflow chunk send confirmed, relay-to-parent confirmed. Plan 02's gate must hook the **last** of these, not the first. | Plan 02 already names `delivery-not-confirmed` as the gate marker. Verify with grep that no earlier path emits `completed` before it. |
| MG-D (999.49) | Producer writes go to `trace_spans` from at least two call sites historically (cf. Phase 115-08 split-latency). If 999.49's "blank tool name" stems from one call site dropping the field, the fix must also pin which producer is canonical. | Run `grep -rn "INSERT INTO trace_spans\|trace_spans.*VALUES" src/` *before* writing the patch; assert the writer set you expected. |
| MG-C (999.14/15) | MCP tracker + reaper + reconciler each have their own view of "what's running." If your verification soak only exercises one entrypoint (boot orphan scan vs runtime reaper vs polled discovery), the others drift silently. | 999.15-04 Plan already prescribes cold restart + per-agent restart + forced respawn. Run all three, not just the cold restart. |
| 999.46 | The "table auto-wrap" hook needs to apply at *every* Discord exit. `webhook-manager.ts:67` already calls `wrapMarkdownTablesInCodeFence`. Verify `bridge.ts`, the Discord plugin's direct-send path, and any subagent stream paths converged — partial deployment was the entire reason this is recurring (operator flagged 5×+ in 2 weeks). | Single-source the wrap call: put it in `splitMessage` (or wherever the byte-stream-to-Discord crossing happens), not at every caller. Then grep for any direct `client.send` or `channel.send` that bypasses the wrapper. |

### Prevention checklist for every v2.9 plan

Before writing code that affects an existing path, the planner MUST do one of:

- **Run-time wiring sentinel**: a synthetic message/turn that traverses the production path and asserts the new code fires within N seconds of boot. Phase 115-08 testing should have included this.
- **Static-grep test**: pin that the production entrypoint (e.g., `daemon.ts` startup, `TurnDispatcher.dispatch`) eventually imports/instantiates the class containing your new code. Catches wrong-function deployments.
- **Pre-deploy synthetic verification**: run the bundle in a dev daemon, fire one synthetic turn through the actual production path (not the test fixture), grep prod logs for the new column / metric / log line.
- **IPC introspection**: when adding a message type, also register it in a "what schemas/methods do I accept" endpoint. Discoverable senders > hopeful registry duplication.

---

## Per-Subsystem Pitfalls

### 1. Discord Webhook Delivery (MG-A)

#### 1.1 The cached-identity bug pattern — load-bearing for 999.44

**What goes wrong:** `WebhookManager` ingests `identities: ReadonlyMap<string, WebhookIdentity>` at construction (`src/discord/webhook-manager.ts:24,29`). `hasWebhook()` (line 36) is a pure map lookup against this frozen reference. Discord-side state (webhook deleted via UI, rotated by external admin, channel permission revoked, channel deleted) never propagates back into the map. `post_to_agent` sees `hasWebhook(to) === true` and tries to deliver; webhook send fails with 404/401; or — worse — `hasWebhook` returns `true` and the actual `WebhookClient.send` silently swallows the error.

**Evidence:**
- `feedback_silent_path_bifurcation.md` example 2 (post_to_agent silent drops, 2026-05-11)
- 999.44 backlog hypothesis #1, #2, #4 all describe variations of this
- `2026-05-11-cached-singleton-with-rotating-credentials.md` is the same pattern class (Anthropic OAuth client cached past token rotation; commit `bcc26d9` fixed it)
- `webhook-manager.ts:62-67` comment trail confirms Phase 100-fu had to retroactively wrap **multiple** call sites that bypassed the manager — bridge.ts:917, daemon.ts:3544, usage/daily-summary.ts:111

**Prevention:**
- **Identity-cache invalidation on 401/404**: mirror the OAuth fix pattern. On webhook send failure with HTTP 401 / 404, drop the WebhookClient from `clients` Map AND mark the identity entry as stale; re-provision via `webhook-provisioner.ts` before reporting "no-webhook" to the caller.
- **Periodic webhook liveness probe**: heartbeat-driven HEAD/GET against each registered webhook URL once per hour; quarantine + reprovision on 404. (Daemon-only, no per-turn cost.)
- **Telemetry counter** per 999.44's acceptance criteria: `no_webhook_fallbacks_total{agent, channel}` exposed on the dashboard; alert if any channel sustains >0 over a 15-min window.
- **Wiring sentinel for the fix**: on daemon boot, send a synthetic test message agent-to-agent (e.g., admin→admin) and assert it returns `{ delivered: true }`, not `{ ok: true, reason: "no-webhook" }`.

**Confidence:** HIGH that the cached map is the silent-failure surface. MEDIUM on the root cause for 999.44 — could ALSO be webhook never registered post-restart (per backlog hypothesis #2), bot missing MANAGE_WEBHOOKS perm in a channel (Phase 90.1 history), or Cloudflare UA blocking (hypothesis #3). Capture one live event before patching.

**Phases threatened:** 999.44 directly. 999.45 (icon update rides the same PATCH endpoint — wait for 999.44).

#### 1.2 999.45 sequencing trap

**What goes wrong:** Planner ships the hourglass→👍 emoji update first because "it's a small UI change" and tests in dev pass. Production runs against broken webhooks (999.44 unfixed), so the PATCH-edit-to-flip-emoji also silently fails. Operator sees no visible improvement and concludes the fix didn't ship.

**Evidence:** 999.45 backlog "Edge cases" — "Webhook unavailable (cf. 999.44) — the icon update will also fail, so fixing 999.44 first makes this UI improvement actually visible."

**Prevention:**
- Hard-sequence: 999.44 MUST be observably-green in production (telemetry counter steady at 0) for at least 24h before 999.45 deploys.
- Add a UI-side fallback: if PATCH to update the emoji fails, log a `webhook-edit-failed` event and surface in `no_webhook_fallbacks_total`.

**Phase threatened:** 999.45.

#### 1.3 Cloudflare reputation tier — invisible 429s

**What goes wrong:** Application-layer rate-limit handlers cannot see Cloudflare's `shared`-scope bucket downgrade. Bot gets moved to the 5-token-bucket tier after burst patterns (e.g., 5 daemon restarts in one day during an outage cascade). Symptom: only `typing` endpoint affected, messaging works fine, retry logic at application layer has no effect.

**Evidence:** `2026-05-08-latent-bugs-surface-in-pairs-during-incidents.md` Addendum — commit `099c599` shipped a "fix" for this, was reverted in `ca387d9` because the real cause was Cloudflare's anomaly detection, not application over-firing.

**Prevention:**
- Before adding any "rate-limit aware" application-layer code, verify what the discord.js SDK already handles internally.
- If 429s appear, check `Retry-After` scope (`shared` vs `per_route`) and bucket size before assuming application code is the culprit.
- "Ship NOTHING and wait for Cloudflare to relax the bucket" is a legitimate operator response. Don't ship defensive code under wrong-diagnosis pretenses.

**Phase threatened:** Any v2.9 hotfix where 429s appear during deploy — esp. MG-A delivery work that may trigger bursts.

---

### 2. MCP Lifecycle (MG-C)

#### 2.1 Tracker drift from `/proc` reality

**What goes wrong:** McpProcessTracker singleton (Phase 999.14/15) holds an in-memory map of `{ agent, mcpServer, pid }`. /proc-walk PID discovery runs on boot. Between heartbeats, a child can die (OOM, crash, parent SIGKILL during deploy that didn't propagate cleanly) without the tracker hearing about it. Subsequent `mcp-tracker-snapshot` calls show stale PIDs that no longer exist; operator runs `clawcode mcp-tracker` and gets confusing output.

**Evidence:**
- 999.15-04 PLAN names TRACK-07 as the "cold restart soak" verification — exists precisely because of this risk
- Phase 106 already hotfixed `mcp-tracker` CLI "Invalid Request" (TRACK-CLI-01 commit `fa72303`) — confirming the visibility layer is also fragile
- 999.12-02 SUMMARY claims "zero MCP orphans post-restart" — but that's one observation, not a soak

**Prevention:**
- **Polled reconciler** (already designed in 999.15 Plan 02): on every poll cycle, `kill(pid, 0)` each tracked entry; if ESRCH, drop the entry AND log a reconciliation event.
- **Operator-runnable diff**: `clawcode mcp-tracker --diff-proc` that shows tracker-says-N, /proc-says-M, with set-difference both ways. Forces drift visibility.
- **Soak script** from 999.15-04 covers: cold restart, per-agent restart (one agent stop/start, others untouched), forced respawn (SIGKILL one MCP child, watch reaper + tracker reconcile). Run all three in MG-C, not just cold.

**Phase threatened:** 999.14 Plan 02, 999.15 Plan 04.

#### 2.2 Orphan reaper race during boot orphan scan

**What goes wrong:** Boot orphan scan reads /proc, finds processes parented by old PID 1 (post-systemd-restart), SIGTERMs them. But if an MCP child is *just* being respawned by the daemon's own startup, the reaper can SIGTERM the new child mid-handshake. Symptom: agent comes up with "MCP server X failed to initialize" in logs; operator confused because it worked yesterday.

**Evidence:** Phase 999.14 RESEARCH names the 60s reaper window; collision with startup spawn is the documented race surface.

**Prevention:**
- Add a "boot grace" flag: reaper skips processes younger than 30s OR with a parent PID matching the daemon's own.
- Tag freshly-spawned children with a `CLAWCODE_BORN_AT` env var on spawn; reaper inspects /proc/PID/environ before killing.

**Phase threatened:** 999.14 Plan 02.

#### 2.3 MCP `ask_advisor` tool gating gap (deferred, but lives here)

**What goes wrong:** Per CLAUDE.md "Architectural deferral — MCP `ask_advisor` tool gating" — the tool still appears in `tools/list` for native-backend agents because MCP server has no per-agent identity at startup (`src/mcp/server.ts:170`). User-visible correctness is preserved by IPC short-circuit, but a future planner might wire MCP-side gating without realizing the env-injection + IPC-probe pieces are missing.

**Prevention:**
- Document the deferral in MG-C's CONTEXT (point at `.planning/phases/117-.../117-07-SUMMARY.md`).
- If MG-C's verification soak touches the MCP server registration, ensure it doesn't regress the short-circuit.

**Phase threatened:** MG-C (touches MCP server lifecycle).

---

### 3. Stream Chunking — Discord 2000-char Boundary (MG-B)

#### 3.1 The off-by-3 seam — canonical fix pattern

**What goes wrong:** Editor renders `wrapped.slice(0, 1997) + "..."` (chars 0-1996 visible + 3 dots = 2000 chars displayed). Overflow loop then starts at `cursor = 2000`. Bytes 1997, 1998, 1999 of the source string are *replaced* by "..." in the visible message and *never sent* in any overflow chunk. They disappear.

**Evidence:**
- 999.36-03 PLAN identifies the exact bug site: `src/discord/subagent-thread-spawner.ts:756` (postInitialMessage) and `:386-388` (relayCompletionToParent)
- Operator-witnessed evidence: reelforge-build-v2 thread `1501361804012687504` — turn 2 starts `o-end in this session.` (should be `end-to-end`; leading `end-t` eaten)
- Admin Clawdy thread `1501302129782952126` — same pattern, different subagent

**Canonical fix pattern (per 999.36-03):**
```typescript
const EDITOR_TRUNCATE_INDEX = 1997;
// editor: slice(0, 1997) + "..." (UNCHANGED — operator sees the marker)
// overflow: let cursor = text.length > 2000 ? EDITOR_TRUNCATE_INDEX : 2000;
// every subsequent chunk: cursor += 2000 (UNCHANGED)
```
Bytes 1997-1999 are now the *leading* bytes of overflow chunk 1, recovered.

**Prevention:**
- Plan 03's Task 1 test is the load-bearing assertion: `expect(reconstructed).toBe(expected)` for a 2003-char input. Pre-fix it fails (missing 3 chars), post-fix it passes.
- Plan 00's `seamGapBytes` diagnostic field — post-fix this MUST log as `0` on production. Operator confirms via journal grep.

#### 3.2 The seam is in OTHER files too — silent bifurcation hazard

**What goes wrong:** Planner ships 999.36-03 fix in `subagent-thread-spawner.ts` and considers it closed. Meanwhile `webhook-manager.ts:68` runs its own `splitMessage(wrapped, MAX_MESSAGE_LENGTH)` for direct webhook sends. Has it been audited for the same boundary semantics? **No — 999.36-03 explicitly does NOT touch it.**

**Evidence:** `webhook-manager.ts:1-80` shows `splitMessage` is imported but the source isn't in 999.36-03's `files_modified`. Different code path → different bug.

**Prevention:**
- As part of MG-B verification, grep for every `splitMessage` / `.slice(0, 1997` / `.slice(0, 2000` / `cursor = 2000` / `MAX_MESSAGE_LENGTH` in `src/discord/` and `src/manager/`. Audit each for the same seam.
- Add a regression-test fixture (the 2003-char test in 999.36-03 Task 1) and reuse it against `splitMessage` and any other helper found.
- **Confidence:** MEDIUM — splitMessage in webhook-manager may or may not have the seam; depends on whether it does its own truncate-with-ellipsis or just slices. Audit before declaring MG-B done.

#### 3.3 wrapMarkdownTablesInCodeFence boundary interaction

**What goes wrong:** Wrap function inserts backticks at table boundaries → shifts char positions. If overflow cursor is computed on raw content but content went through wrap, positions misalign and the fix re-introduces the seam.

**Evidence:** 999.36-03 PLAN threat_model line 153 calls this out explicitly: "use the WRAPPED string's length, not the raw content length."

**Prevention:**
- Plan 03's fix uses `wrapped.length` and `text.length` consistently (both already wrapped). Don't optimize this away.
- Add a fixture that contains a markdown table straddling the 2000-char boundary; assert byte-for-byte completeness post-wrap.

**Phase threatened:** MG-B (999.36-02 + 999.36-03).

#### 3.4 Discord markdown table renderer differences (mobile vs desktop)

**What goes wrong:** Discord's renderer doesn't support GFM tables — pipes render literally. Desktop browsers + Discord desktop client get away with narrow tables by sheer screen width. Mobile collapses columns and content becomes unreadable. Operator flagged this 5×+ across 2 weeks (per 999.46 BACKLOG).

**Evidence:** 999.46 BACKLOG — operator screenshot 2026-05-13 of 4-column table from Admin Clawdy unreadable on mobile.

**Prevention:**
- Wrap every markdown table block in a fenced code block at the daemon's Discord output formatter — single hook point, pad columns to equal width based on content. Mobile gets horizontal-scroll, content is preserved.
- `wrapMarkdownTablesInCodeFence` already exists at `src/discord/markdown-table-wrap.ts` — verify every Discord exit calls it; the v2.9 fix is making it universal, not writing a new helper.
- Nested code-block escaping: if a table cell contains backticks or a fenced code block, the wrap must use a longer fence (4+ backticks) or escape the inner. Test with a fixture cell content containing ` ``` `.

**Phase threatened:** 999.46.

---

### 4. Dashboard Data Misclassification (MG-D)

#### 4.1 NULL percentile renders as `breach`-red

**What goes wrong:** `BenchmarksView.tsx:295-301` colorClass selector returns `text-danger` when `slo_status === 'breach'`. The data layer defaults `slo_status` to `'breach'` (or the React renderer applies the breach class) when the underlying percentile field is NULL. Operator sees a wall of red and concludes "all benchmarks broken" when actually it's "no data observed in window."

**Evidence:** 999.49 backlog hypothesis #3 — "slo_status defaults to 'breach' when percentiles are null." Cross-referenced against the visible symptom: 19 rows for Admin Clawdy with valid `count`, blank `tool`, NULL p50/p95/p99 styled as red em-dash.

**Prevention:**
- **Three-state classification, not two**: percentiles map to `{ healthy, warn, breach, unknown }`. NULL → `unknown` → neutral `text-fg-3` styling. Never `breach` for NULL.
- **Defense-in-depth at the data layer**: the IPC handler that backs `/api/agents/:name/tools` should return `slo_status: null` when percentiles are null, never `slo_status: 'breach'`. Frontend then has no choice but to render neutral.
- **Grep for siblings**: any other view rendering percentile data (cost dashboard, context-fill, latency histograms) likely has the same `slo_status` classification. Audit all of them.

**Confidence:** HIGH on the misclassification pattern. MEDIUM on whether the bug lives in the backend SQL (`COALESCE(slo_status, 'breach')` somewhere?) or the frontend renderer — diagnostic SQL from 999.49 backlog line 40 disambiguates.

**Phase threatened:** MG-D (999.49). Also any future Phase that adds SLO panels (999.38-style work).

#### 4.2 Schema-without-writer (Pattern A from learnings)

**What goes wrong:** Phase declares the schema, writes the reader, wires the dashboard renderer — but no producer code path ever writes the column. Columns silently NULL across the fleet. Bug invisible to tests because tests construct mock data with the field populated.

**Evidence:** `2026-05-08-latent-bugs-surface-in-pairs-during-incidents.md` Pattern A — Phase 115-08 producer regression (tier1_inject_chars, tier1_budget_pct, prompt_bloat_warnings_24h had schema + type + reader + dashboard but no writer). Caught only by post-deploy spot check.

**Prevention (from learnings doc, actionable for MG-D):**
- **Producer/writer coverage check**: for every new column / type field / schema addition, require a positive grep hit on the *writer* side. Plan-checker enhancement; runs during `/gsd-plan-phase --check`.
- For 999.7 follow-up B (split-latency columns NULL): verify the producer is in `persistent-session-handle.ts:iterateUntilResult` (production path), not just `session-adapter.ts:iterateWithTracing` (test path).

**Phase threatened:** MG-D entire (especially the split-latency producer regression in 999.7 follow-up B).

#### 4.3 The "Admin Clawdy" space-in-name parameter

**What goes wrong:** Agent display name contains a space. SQL parameter or URL path encoding splits on the space somewhere, returning rows that match `''` (empty) or wildcard, aggregating into 19 null-tool buckets.

**Evidence:** 999.49 backlog hypothesis #1 — "Space in agent display name."

**Prevention:**
- Diagnostic SQL from 999.49 backlog: directly query `trace_spans` for `agent = 'Admin Clawdy'` to see if rows actually have populated tool fields. If yes → IPC layer is mangling. If no → producer regression.
- Add a regression test with a space-bearing agent name across the IPC handler stack.

**Phase threatened:** 999.49.

---

### 5. Delegate-Channel Routing (999.19, 999.20, 999.48)

#### 5.1 "Primary channel" vs "thread parent channel" divergence

**What goes wrong:** Agents have a primary user-facing channel (where they take direct turns) and may also handle subagent-delegated threads under *other* agents' channels. The four resolvers that must agree on "which channel is mine right now" are:
1. Webhook resolution (which webhook to use to post)
2. Heartbeat target (where to land HEARTBEAT_OK / cron-poll output)
3. Memory consolidation scope (which agent's SQLite to write to)
4. Thread binding lookup (which thread's parent channel is this?)

Any disagreement → 999.48-class leaks (HEARTBEAT_OK posted to operator channel) or 999.19-class problems (delegate thread spawned under parent's channel, memory consolidated to wrong agent).

**Evidence:**
- 999.48 BACKLOG (today, 2026-05-13) — `projects` agent's cron-poll `HEARTBEAT_OK` leaks to operator channel
- 999.19 EMPTY DIR but ROADMAP:1497-1516 names "delegate-channel routing" as the fix
- 999.36 `DEFERRED-WORKSPACE-LOOKUPS.md` already catalogues 4 suspect + 6 cleared + 3 deferred workspace-keyed lookup sites — the routing taxonomy is partially mapped

**Prevention:**
- **Single resolver function**: `resolveAgentSink({ agentName, context }) → { channelId, webhookId, memoryScope }` — every consumer goes through this. Static-grep regression test rejects bypass paths.
- **Per-output routing audit**: for every Discord-bound output emit in the codebase, assert it derives its sink from the single resolver, not from a captured local variable that may be stale.
- For 999.48 specifically: the fix lives in the `projects` agent's cron skill (per BACKLOG line 46 — "the projects agent owns this"). DAEMON-side filtering of `HEARTBEAT_OK` strings would be the wrong layer.

**Confidence:** MEDIUM — the routing model is documented but the four-resolver claim is inferred from incident pattern, not from a code map. A pre-flight grep pass for "channelId" / "channels.get" / "primaryChannel" across `src/discord/` and `src/manager/` should validate before MG-A starts.

**Phase threatened:** 999.48, 999.19, 999.20 (research slash command must route to the *delegate's* memory, not the invoker's).

#### 5.2 `-via-` naming-pattern leak

**What goes wrong:** Per ROADMAP:1497-1516, the `-via-` substring leaks across "5+ filter sites" — i.e., the delegate session naming convention (`<delegate>-via-<parent>`) is used as a routing key in places it shouldn't be, causing routing bugs when the substring matches unintended targets.

**Prevention:**
- Replace string-substring routing with structured fields on the ThreadBinding record (delegate, parent, channelId, sessionId — discrete columns, not a concatenated key).
- Grep `src/` for `-via-` and `via-` — every match is a candidate bug site.

**Phase threatened:** 999.19.

---

### 6. Deploy / Restart Constraints

#### 6.1 Ramy-active mid-restart drop

**What goes wrong:** Per `feedback_ramy_active_no_deploy.md`, every `systemctl restart clawcode` drops 30-90s of inbound Discord messages even with Phase 999.6 snapshot/restore. Operator's client Ramy in `#fin-acquisition` may be reading without typing — `journalctl` check is insufficient; must use Discord MCP plugin to see live conversation state.

**Evidence:** Operator-corrected the mistake 2026-05-06 — journalctl-only check is wrong; check Discord directly via `mcp__plugin_discord_discord__fetch_messages`.

**Prevention:**
- Every MG-C verification soak requires an operator-approved restart window with Discord-MCP-verified Ramy-quiet state.
- The Phase 106 overnight rule (channels silent ≥30 min → autonomous deploy OK) is the ONLY exception. Daytime = explicit operator approval.
- "Emergency" override examples are narrow: production outage, agents in crash loop, security CVE. "Feature ready" is NOT an emergency.

**Phase threatened:** MG-C entire (cannot soak without restart). Any other v2.9 work that requires a daemon restart.

#### 6.2 Auto-deploy in subagent prompts

**What goes wrong:** Per `feedback_no_auto_deploy.md` (quick task `260429-ouw`), executor prompts that include deploy steps (`systemctl restart`, `clawcode stop-all`, `git pull` on prod) will be executed even after the operator says "don't deploy until I confirm." Authorization is one-shot, never general.

**Prevention:**
- v2.9 plans MUST NOT include deploy instructions in execute-phase tasks unless the operator says "deploy" / "ship it" in the SAME turn.
- After commit + push, surface: "Pushed `<hash>`. Ready to deploy when you give the go." Wait.

**Phase threatened:** Every v2.9 phase commit (procedural, not code-side).

#### 6.3 Cached singleton with rotating credentials — applies to OAuth, MCP env, more

**What goes wrong:** Module caches an authed client (Anthropic, MCP, webhook) as a process-wide singleton. Credential rotates out-of-process; cache holds the dead token; every call fails with 401 until daemon restart.

**Evidence:** `2026-05-11-cached-singleton-with-rotating-credentials.md` — commit `bcc26d9` fixed `haiku-direct.ts` after Discord 401 incident. Same pattern as 999.44's webhook map (Section 1.1).

**Prevention (the canonical fix shape, reusable across v2.9):**
1. **Token-identity cache**: read credential every call (it's cheap, page-cached); compare to cached identity; rebuild only when value differs.
2. **401-retry-once**: defense in depth for the rotation race.
3. **Tests pin the contract**: mock the credential reader returning different values across calls; assert client rebuilt on rotation, retried on 401.
4. **Audit siblings**: `grep -rn "new Anthropic(\|new WebhookClient(\|cachedClient\s*:" src/` — every match is a candidate.

**Phase threatened:** MG-A primary (webhook rotation = same shape as token rotation). Any future MCP env hot-reload work.

---

## Cross-Cutting Patterns

### Pattern A: Silent Path Bifurcation
See dedicated section above. **MG-A's #1 risk.**

### Pattern B: NULL-as-zero / NULL-as-breach
NULL columns and NULL percentiles consistently misclassify in three places already documented:
- Dashboard SLO classification (Section 4.1)
- "no tool spans recorded" rendered as 19 null rows instead of empty-state message (999.49)
- `slo_status` defaults applied where data is absent (999.7 follow-up B regression)

**Prevention:** Treat NULL as a first-class state in every classification: `{ healthy, warn, breach, unknown }`. Frontend never defaults `unknown` to `breach`. Backend never returns `breach` for NULL inputs.

### Pattern C: Latent bugs surface in pairs during incidents
Per `2026-05-08-latent-bugs-surface-in-pairs-during-incidents.md` — when production is degraded and operator does a recovery action, that recovery hits unusual code paths and exposes other latent bugs. Single-trigger events produce 2-3 bugs in close succession.

**Examples (already paid in 2026):**
- Discord outage + restart → revealed (1) bridge had zero startup retry logic, (2) `subagentThreadSpawner` TDZ error from late-declaration `const`
- Phase 115 deploy + post-deploy spot check → revealed 3 columns with schema+reader+dashboard but no writer

**Prevention for v2.9:**
- When MG-A's first fix lands, expect a second latent bug to surface within hours.
- When MG-C's restart window opens, expect TWO MCP issues to surface, not one.
- Operator instinct: "investigate before restarting" — restart is a hammer; ask "is this a state issue or a code issue?" first.

---

## Prevention Strategy Per Phase

| Phase | Risk class | Required prevention |
|-------|-----------|---------------------|
| **MG-A (999.44)** | Cached-singleton webhook map | (1) Capture one live `no-webhook` event with full broker trace + webhook registry state BEFORE patching. (2) Apply identity-cache invalidation pattern on 401/404. (3) Wiring sentinel on daemon boot: synthetic admin→admin message must return `{ delivered: true }`. (4) Telemetry counter `no_webhook_fallbacks_total` exposed on dashboard with alert. |
| **MG-A (999.45)** | Sequencing trap | Block on 999.44 being observably-green for ≥24h before deploying. |
| **MG-A (999.48)** | Routing layer error | Fix lives in `projects` agent's cron skill, NOT daemon-level filter. Verify single-resolver pattern for agent channel sink across heartbeat / webhook / memory. |
| **MG-B (999.36-02)** | Premature completion gate | Hook on `delivery-not-confirmed` (the last definition of "done"), not first. Grep for any earlier `completed` emit on the relay path. |
| **MG-B (999.36-03)** | Off-by-3 seam | Apply 999.36-03 PLAN as written. ALSO audit `webhook-manager.ts:68 splitMessage` and any other splitter for the same seam — Plan 03 does not touch them. Reuse the 2003-char fixture. |
| **MG-C (999.14 P02, 999.15 P04)** | MCP lifecycle | Run ALL THREE soak variants from 999.15 P04: cold restart, per-agent restart, forced respawn. Boot-grace flag on the reaper (skip processes <30s old with daemon-parent PID). Operator-runnable `mcp-tracker --diff-proc` shows tracker vs /proc drift. Restart window requires Discord-MCP-verified Ramy-quiet. |
| **MG-D (999.49)** | NULL misclassification | (1) Run diagnostic SQL from 999.49 backlog FIRST to localize bug to backend SQL vs IPC vs frontend. (2) Three-state classification — NULL → `unknown` → neutral styling, never `breach`. (3) Producer/writer audit for split-latency columns (999.7 follow-up B) — pin which call site is canonical. (4) Empty-state message when zero rows in window. |
| **MG-D (999.7 fu-B)** | Schema-without-writer | Verify split-latency producer in `persistent-session-handle.ts:iterateUntilResult` (prod path), not `session-adapter.ts:iterateWithTracing` (test path). Apply Pattern A check. |
| **MG-D (999.7 fu-C)** | CLI Invalid Request | Already hotfixed once in Phase 106 (`fa72303`). MG-D soak must cover the CLI path. |
| **999.46 Table auto-wrap** | Bypass paths | Single-source the wrap call: put in `splitMessage` or the byte-stream-to-Discord crossing, not at every caller. Static-grep regression test rejects direct `client.send` / `channel.send` that bypasses wrapper. |
| **999.19 Delegate routing** | Routing divergence | Single-resolver function for `{ channelId, webhookId, memoryScope }`. Replace `-via-` substring routing with structured ThreadBinding columns. |
| **999.20 /research commands** | Depends on 999.19 | Block on 999.19 landing first. Research memory consolidates to delegate's SQLite, not invoker's. |
| **All v2.9 deploys** | Ramy-active drop | Discord MCP plugin check (NOT journalctl) before every restart. Operator approval explicit. Streaming responses mid-flight die — accept the 30-90s impact. |

### Pitfalls requiring operator-approved restart to fully prevent

- **MG-C entire** (cannot soak without cold restart)
- **999.44 fix verification** (telemetry counter must land in a restarted daemon)
- **999.46 single-source wrap** (any code path change requires restart)
- **999.36-02/03** (subagent-thread-spawner is in-process — restart required)
- Any "wiring sentinel on daemon boot" pattern from Pattern A

Implication: v2.9 will need at least **2-3 operator-coordinated restart windows** to land cleanly. Plan deploys in Ramy-quiet windows (overnight per Phase 106 rule, or operator-approved daytime).

---

## Sources

- `feedback_silent_path_bifurcation.md` (memory, 2026-05-11) — Pattern A documented with 3 concrete incidents
- `feedback_no_auto_deploy.md` (memory, 2026-04-29)
- `feedback_ramy_active_no_deploy.md` (memory, 2026-05-06 refinement)
- `.planning/learnings/2026-05-08-latent-bugs-surface-in-pairs-during-incidents.md` — Pattern A (schema-without-writer) and TDZ pattern
- `.planning/learnings/2026-05-11-cached-singleton-with-rotating-credentials.md` — Section 1.1 / 6.3 root pattern
- `.planning/BACKLOG-CONSOLIDATED.md` — v2.9 merge groups and pending-verify triage
- `.planning/phases/999.36-.../999.36-03-PLAN.md` — Section 3.1 chunk-boundary canonical fix
- `.planning/phases/999.44/BACKLOG.md`, `999.45/BACKLOG.md`, `999.46/BACKLOG.md`, `999.48/BACKLOG.md`, `999.49/BACKLOG.md` — v2.9 reporter-supplied symptoms (all 2026-05-13)
- `.planning/phases/999.18-.../RELAY-SKIPPED-FINDINGS.md` — 0 events in 14-day window (relay diagnostic instrumentation deployed but no signal captured)
- `src/discord/webhook-manager.ts:24,29,36,67` — load-bearing cached-identity bug surface
- `src/manager/daemon-post-to-agent-ipc.ts:185-225` — fallback ladder for `no-webhook` / `webhook-send-failed`
- CLAUDE.md Phase 117 advisor pattern + Phase 110 shim-runtime — rollback levers (per-agent advisor backend flip, shimRuntime fallback)

**Confidence summary:**
- HIGH on Sections 1.1 (cached webhook map), 3.1 (off-by-3 seam), 4.1 (NULL→breach), 5.1 (delegate routing divergence), 6.1 (Ramy-quiet check) — all backed by code+incident citations.
- MEDIUM on Sections 2.2 (boot-grace race), 3.2 (other splitters share the seam), 4.3 (space-in-name) — pattern documented but specific root-cause not yet localized.
- LOW on Section 1.3 (Cloudflare reputation) — single incident, hard to validate the prevention rule until next outage.
