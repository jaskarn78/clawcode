# Phase 119: A2A Delivery Reliability — Context

**Gathered:** 2026-05-14
**Status:** Ready for planning
**Mode:** Auto-discuss (--auto) — gray-area decisions auto-selected to recommended defaults; downstream agents may surface counter-evidence during research and replan if needed.
**Source:** ROADMAP entry (`.planning/ROADMAP.md` §"Phase Details — v2.9" / Phase 119), REQUIREMENTS.md (A2A-01..04), Phase 999.12 IPC-02 (`src/manager/daemon-ask-agent-ipc.ts:262-299`) as the canonical bot-direct fallback shape, Phase 116 dashboard surface for the new counter, Phase 999.44/999.45/999.48 backlog items as the merge sources.

<canonical_refs>
## Canonical References (MANDATORY)

| Ref | Why | Path |
|-----|-----|------|
| ROADMAP entry | Phase boundary, success criteria, dependency notes | `.planning/ROADMAP.md` §"Phase Details — v2.9" / Phase 119 |
| REQUIREMENTS A2A-01..04 | Requirement traceability + scope merges (999.44/45/48) | `.planning/REQUIREMENTS.md` §"A2A · Cross-Agent Delivery" |
| Phase 999.12 IPC-02 reference | Canonical bot-direct fallback shape — mirror this | `src/manager/daemon-ask-agent-ipc.ts:262-299` |
| `daemon-post-to-agent-ipc.ts` | Phase 119 primary target (the path missing the fallback) | `src/manager/daemon-post-to-agent-ipc.ts` |
| `WebhookManager` | Cache invalidation target for A2A-02 | `src/discord/webhook-manager.ts` |
| Phase 116 dashboard surface | Counter exposure target for `no_webhook_fallbacks_total` | `.planning/phases/116-dashboard-redesign-modern-ui-mobile-first-basic-advanced-modes-in-ui-config-editor-conversations-view-task-assignment-folds-99938/` |
| Backlog item — 999.45 (queue-state icon) | Source spec for A2A-03 icon transitions | `.planning/phases/999.45-hourglass-to-thumbs-up-when-prompt-leaves-queue/` |
| `feedback_silent_path_bifurcation.md` | Anti-pattern — production must execute the new fallback path | `/home/jjagpal/.claude/projects/-home-jjagpal--openclaw-workspace-coding/memory/feedback_silent_path_bifurcation.md` |
</canonical_refs>

<domain>
## Phase Boundary

Four A2A correctness/reliability gaps surfaced during v2.8 operation. All four sit on the live cross-agent delivery pipeline (daemon-side `post_to_agent` IPC + `WebhookManager` + Discord queue-state UI), plus one agent-skill-side cleanup. Bundled because they share the dispatch surface, share a single deploy, and share an integration test cycle.

### A2A-01 — `post_to_agent` lacks the bot-direct fallback that `ask_agent` got
Today `daemon-post-to-agent-ipc.ts` delivers via webhook only; when there's no webhook, it falls through to the inbox-heartbeat path (canonical fallback). The intermediate **bot-direct** rung — already wired into `daemon-ask-agent-ipc.ts:262-299` per Phase 999.12 IPC-02 — is missing on the `post_to_agent` side. Result: messages that should land live in 1-2s get punted to the heartbeat sweep (up to 60s+). The synthetic admin→admin boot probe currently returns `{ok: true, reason: "no-webhook"}` instead of `{delivered: true}` — exact pattern from `feedback_silent_path_bifurcation` memory.

### A2A-02 — `WebhookManager` doesn't recover from 401/404
The webhook cache is treat-it-as-singleton: once a webhook entry is cached, the manager keeps using it across the agent's lifetime. When Discord returns 401 (revoked) or 404 (deleted from server), the manager surfaces the failure but does not invalidate + re-provision in the same delivery attempt. Operators have to restart the daemon to recover. Root cause referenced in 999.44 backlog — the cache invalidation hook never wired in.

### A2A-03 — Queue-state icon races
Today the icon ⏳ (queued) on a turn does not transition predictably. Operators see ⏳ stuck or two emojis layered. Spec: ⏳ → 👍 (SDK call started) → ✅ (delivered) or ❌ (terminal failure), atomic transitions, debounced, mutually exclusive. 999.45 backlog has the source spec.

### A2A-04 — `projects` agent leaks `HEARTBEAT_OK` to user-facing channels
The `projects` agent's cron-poll emits `HEARTBEAT_OK` no-op messages into the operator's channel. REQUIREMENTS explicitly forbids a daemon-side string-match filter (wrong layer); the fix lives in the agent's own cron skill. Agent-side change, not daemon.
</domain>

<decisions>
## Implementation Decisions

### D-01 — Mirror Phase 999.12 IPC-02 bot-direct fallback shape verbatim (A2A-01)
The reference implementation at `daemon-ask-agent-ipc.ts:262-299` is the canonical pattern: optional `BotDirectSender` injected by daemon, called when webhook lookup returns nothing, returns `{delivered: true, messageId, via: "bot-direct"}` on success and falls through to inbox on failure. Phase 119 ports this verbatim into `daemon-post-to-agent-ipc.ts` — same dependency-injection shape, same return contract, same logging. **No new abstraction.** Direct copy of the pattern is faster, lower-risk, and matches the operator's mental model.

### D-02 — Boot-time wiring sentinel: synthetic admin→admin probe at daemon ready
Per success-criterion 1, a synthetic `post_to_agent` (admin→admin) fires at daemon boot completion and asserts `{delivered: true}`. If the assertion fails, daemon logs `[A2A-01-sentinel] FAIL` and emits a structured warning via `feedback_silent_path_bifurcation`-style log line. Production deploy verification reads this log line — not journalctl-grep-for-success, but pre-committed log keyword. Lives in `src/manager/daemon.ts` next to the existing daemon-ready notifier.

### D-03 — `WebhookManager` 401/404 → invalidate-then-reprovision in one attempt (A2A-02)
On HTTP 401 or 404 from Discord during a `send`/`sendAsAgent` call: delete the cached entry, call the bot to provision a fresh webhook for that channel, retry the send ONCE with the new webhook. If the retry also fails, surface failure normally (do not retry again — bounded). Implementation: hook into the existing send-error branch in `webhook-manager.ts`, gate on `error.code === 401 || error.code === 404`. Unit test: mock Discord to return 401 once then 200; assert `webhookCache.get(channelId)` returns the NEW webhook ID, not the original cached value.

### D-04 — Queue-state icon: enum-typed state machine with per-channel mutex (A2A-03)
States: `QUEUED` (⏳), `IN_FLIGHT` (👍), `DELIVERED` (✅), `FAILED` (❌). Single per-channel mutex (lives in `bridge.ts` or new `queue-state-icon.ts` helper) guards transitions. Each state transition removes the prior reaction emoji and adds the new one in one atomic call; on Discord rate-limit response, the helper retries with backoff (≤3 attempts). 999.45 has the source spec — follow it. The debounce is 200ms (Discord rate-limit safe).

### D-05 — `no_webhook_fallbacks_total{agent, channel}` counter (success-criterion 5)
New Prometheus-style counter exposed via the Phase 116 dashboard surface. Increments on every bot-direct fallback OR inbox fallback dispatch. Dashboard tile alerts when value > 0 over the 15-minute window post-deploy. Wiring: add to the existing fleet-stats endpoint (Phase 109's `/api/fleet-stats`); the dashboard already has the SLO threshold mechanism from Phase 999.38.

### D-06 — `HEARTBEAT_OK` filter at agent layer ONLY — no daemon code change for A2A-04
REQUIREMENTS explicitly forbids a daemon-side string-match filter. The fix is a single guard in the `projects` agent's cron skill (`projects` agent workspace under `~/.clawcode/agents/projects/skills/cron-poll/`): if the poll output equals literal `HEARTBEAT_OK` OR matches the agent's project-defined no-op pattern, do not invoke `post_to_agent`. Test: 24h soak window with the cron firing every 60s; expected count of channel messages = 0 when there's nothing operator-actionable.

### D-07 — Sequencing within phase (per ROADMAP sequencing note)
- Plan 999.44 (bot-direct fallback for `post_to_agent`) lands FIRST.
- Plan 999.45 (icon transitions) lands ≥24h AFTER 999.44 has been observably green in production.
- Plan 999.48 (`projects` agent cron skill) is fully parallel — lives in agent workspace, separate repo, separate deploy.
- A2A-02 (webhook cache invalidation) lands with 999.44 (same module, same wave).

### D-08 — Tests pin behaviors, not implementation
Each success criterion gets a test (or fixture-based verification artifact):
- SC-1 → boot probe assertion captured in daemon-startup log; verification artifact greps for `[A2A-01-sentinel] OK`.
- SC-2 → vitest `webhook-manager` test (mock Discord 401→200 sequence).
- SC-3 → manual observer test + screenshot in verification artifact (Discord side, can't unit-test reactions).
- SC-4 → 24h journalctl grep for `HEARTBEAT_OK` in operator's channel logs == 0.
- SC-5 → dashboard tile screenshot at 15min post-deploy; counter == 0.

### D-09 — Backwards compat: the existing `{ok, delivered, reason}` return shape stays
`daemon-post-to-agent-ipc.ts` already returns `{ok, delivered, reason}` (line 256). Adding the bot-direct fallback keeps the same return shape — `delivered: true` on bot-direct success, `delivered: false, reason: "..."` on full failure. No IPC contract change. Existing callers (heartbeat reconciler, etc.) keep working without modification.

### D-10 — No new abstractions for cross-cutting "delivery layer"
The temptation: build a `DeliveryStrategy` interface with three implementations (webhook, bot-direct, inbox). **Rejected.** Two reasons: (1) the three paths have different return contracts and different failure modes — forcing them into a single interface creates leaky abstractions; (2) inbox path is async (heartbeat-driven), not request-response — doesn't fit a strategy pattern. Keep the explicit if-chain in `daemon-post-to-agent-ipc.ts`. Mirror the shape of `daemon-ask-agent-ipc.ts` exactly. Future refactor can extract IF the third caller appears.
</decisions>

<code_context>
## Existing Code Insights

- **`src/manager/daemon-ask-agent-ipc.ts`** (357 lines) — Phase 999.12 IPC-02 fallback already wired here. Use as template. Key landmarks: line 49 (bound-channel-IDs prop), line 97 (optional `BotDirectSender` prop), line 107 (bound-channel lookup), line 158 (test-mode skip flag), line 259 (mirror-response bot-direct call), line 295 (best-effort log on bot-direct failure).
- **`src/manager/daemon-post-to-agent-ipc.ts`** (~280 lines) — Phase 119's primary target. Lines 25, 45, 49, 54, 129, 140 contain the existing return-shape and inbox-fallback path. Line 228 = success exit. Line 256 = skip/failure return. The new bot-direct rung inserts between webhook-attempted-and-skipped and inbox-write.
- **`src/discord/webhook-manager.ts`** — A2A-02 target. Cache structure + send/sendAsAgent are here. The current invalidation gap is in the send-error branch (no 401/404 handler).
- **`src/manager/daemon.ts`** — A2A-01 sentinel hook lives here, next to the daemon-ready notifier.
- **`src/discord/bridge.ts`** — queue-state icon target for A2A-03. Existing reaction-add flow is here; need to add the state-machine mutex.

## Reusable Patterns

- `BotDirectSender` interface in `daemon-ask-agent-ipc.ts` — reuse the type.
- Phase 109 `/api/fleet-stats` endpoint — reuse for D-05's counter exposure.
- Phase 999.38 dashboard SLO threshold infrastructure — reuse for D-05's alerting.
- `feedback_silent_path_bifurcation` log-line keyword pattern — reuse for D-02's sentinel.
</code_context>

<specifics>
## Specific Requirements

- The boot-time sentinel (D-02) is the single source of truth for "is the new fallback wired in production." Verification artifact greps for `[A2A-01-sentinel] OK`, not journalctl-pattern-matching success messages elsewhere.
- The `projects` agent fix (D-06) lives in `~/.clawcode/agents/projects/skills/cron-poll/`. Not in this repo. The phase still records the change in its verification artifact (commit SHA from the agent's workspace repo, if any) and the 24h soak result.
- All bot-direct sends MUST emit a structured log line `{agent, channel, reason}` per A2A-01 requirement — operator observability requirement, not optional.
- A2A-02's HTTP 401 vs 404 handling are functionally identical in this phase. Both invalidate + reprovision. If they need to diverge later (e.g., 401 might mean different rights than 404 = deleted), that's a future phase.
</specifics>

<deferred>
## Deferred Ideas

- **General "DeliveryStrategy" abstraction** — see D-10. If a fourth delivery path (e.g., HTTP push to a third-party service) ever surfaces, revisit. Not for v2.9.
- **Webhook health probe at boot** (separate from the A2A-01 sentinel) — proactively call each cached webhook with a no-op once at daemon ready, drop dead entries before the first real send. Adds startup latency; defer until operator pain signal exists.
- **Icon transition history retention** (A2A-03) — keep the last 10 transitions per channel for operator debugging. Nice-to-have, not in scope.
- **Per-agent fallback policy** — e.g., agent X prefers bot-direct, agent Y prefers webhook. Today the order is fixed (webhook → bot-direct → inbox); per-agent override is a config knob for later.
- **Daemon-side `HEARTBEAT_OK` filter** — REQUIREMENTS forbids this; reaffirmed here so the next person reading CONTEXT.md doesn't propose it.
</deferred>
