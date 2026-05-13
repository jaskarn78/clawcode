# Backlog Consolidated — 999.x triage

Generated 2026-05-13. Source: `.planning/phases/999.*`, `ROADMAP.md`, `STATE.md`, recent git log.

---

## 1. Likely-already-done (no VERIFICATION.md but evidence says shipped)

- **999.7 — context-audit telemetry pipeline restoration** — SHIPPED 2026-05-11 per `ROADMAP.md:1185` ("Phase 999.7: ...SHIPPED 2026-05-11"); closed via quick task `260511-mfn` (commit `dc0e1ad`), `STATE.md:563`. Two non-blocking follow-ups captured: (B) Phase 115-08 producer regression — split-latency columns NULL; (C) `clawcode tool-latency-audit` CLI returns `Invalid Request`. Dir is empty — safe to remove or convert to a stub pointer.
- **999.16 — dream pass JSON output enforcement** — REPLACED by Phase 107 (`ROADMAP.md:1473`). Empty dir, no action.
- **999.17 — vec_memories orphan cleanup on memory delete** — REPLACED by Phase 107 (`ROADMAP.md:1475`). Empty dir, no action.
- **999.18 — subagent relay reliability** — PARTIAL ship (`ROADMAP.md:1477`); dominant fix landed via quick `260501-nfe` commit `6ddde6b`. `RELAY-SKIPPED-FINDINGS.md:7` shows the 2026-05-03 timer sweep found 0 events in 14-day window. Residual edge-cases pending real failure data; effectively closeable absent reports.
- **999.21 — `/get-shit-done` consolidation** — SHIPPED 2026-05-01, quick `260501-jld` (`ROADMAP.md:1034`, `STATE.md:558`). Empty dir.
- **999.22 — soul guard / mutate-verify directive** — SHIPPED 2026-05-01, quick `260501-k5s` commit `67a1f03` (`ROADMAP.md:1035`, `STATE.md:559`). Empty dir.
- **999.23 — daemon SIGHUP handler** — SHIPPED 2026-05-01 (`ROADMAP.md:1570`). Empty dir.
- **999.24 — sudoers expansion** — SHIPPED 2026-05-01, quick `260501-j7x` commit `c3dc129` (`ROADMAP.md:1594`, `STATE.md:557`). Empty dir.
- **999.25 (CONTEXT.md "subagent relay on work-completion")** — RENUMBERED to 999.30 and SHIPPED 2026-05-04, commits `81975aa` + `12f4ac1`, PR #9 (`STATE.md:58`, `ROADMAP.md:1817`). Dir has stale CONTEXT.md that should be archived or pointed at 999.30 outcome.
- **999.38 — dashboard SLO recalibration per-model** — SUPERSEDED-BY-116 per `999.38-PHASE.md:1-11`; folded into Phase 116 dashboard redesign as feature F02.
- **999.39 — memory consolidation OAuth fix** — SHIPPED 2026-05-07 commit `13603c7` per `999.39-PHASE.md:7-10`. Header self-tags `status: SHIPPED 2026-05-07`.
- **999.40 (original "MCP tool-response cache")** — SUPERSEDED-BY-115 sub-scope 15 per `ROADMAP.md:888,1926`. NOTE: the current `999.40-skills-discord-commands/BACKLOG.md` is a DIFFERENT topic (operator reused the number for `/clawcode-skills-create|install`) — see Section 3.
- **999.9 — shared 1Password MCP by service-account scope** — SHIPPED via Phase 100 follow-up. Live config at `clawcode.example.yaml:227-237` describes the exact "vault-scoped 1Password access" pattern 999.9 specified; `mcpEnvOverrides.1password.OP_SERVICE_ACCOUNT_TOKEN: op://clawdbot/.../credential` wired on `fin-playground` (236), `fin-research` (252), `fin-tax` (268), and others. Supporting code in `src/marketplace/op-rewrite.ts`, `src/manager/secrets-resolver.ts`, `src/manager/__tests__/op-env-resolver.test.ts`. Empty dir — safe to remove.

---

## 2. Merge groups

### MG-A — Agent-to-agent + subagent-relay delivery reliability
**Members:** 999.44, 999.45, 999.48, (999.18-residual), (999.25-stale-dir)

Synthesis: A single subsystem class — Discord webhook delivery and message-routing semantics for cross-agent / cron / subagent traffic. 999.44 is the headline (`post_to_agent` falls back to `no-webhook` inbox-heartbeat path, breaking live A2A). 999.45 is the user-visible symptom of the same area (operator can't distinguish "queue stuck" from "model thinking" while a webhook is broken). 999.48 is the routing-discipline cousin (`projects` agent's cron-poll `HEARTBEAT_OK` leaks into operator channel — wrong sink, but same "what channel does this message belong on" question). 999.18 residual edge cases (relay-skipped reasons) belong in the same diagnostic pass. The stale 999.25 dir is now-obsolete copy of the work-completion fix that became 999.30.

Rationale: shared subsystem (`src/discord/*-spawner.ts`, `daemon-ask-agent-ipc.ts`, webhook registry), shared root-cause family (webhook health + correct destination channel), and 999.45's "thumbs-up icon" is only meaningful once 999.44's queue actually drains live.

### MG-B — Subagent UX completion + chunk-boundary (999.36 residual)
**Members:** 999.36-02-PLAN.md (sub-bug D premature completion gate), 999.36-03-PLAN.md (sub-bug B chunk-boundary off-by-3)

Synthesis: Plans 00 + 01 of 999.36 shipped (typing indicator + share-file routing); Plans 02 and 03 are PLANNED-not-executed per `ROADMAP.md:1914-1915`. Both touch `src/discord/subagent-thread-spawner.ts`. Plan 02 closes the premature-completion event (subagent considered done before stream drains / delivery confirms). Plan 03 fixes the editor-truncate-vs-overflow-start seam dropping bytes 1997-1999. Same file, same wave family — should ship together to avoid two restarts.

Rationale: same file, sequenced waves already wired (`depends_on: 999.36-02` for 03), and Plan 03 risks re-touching code Plan 02 is editing.

### MG-C — MCP lifecycle hardening residual + tracker soak
**Members:** 999.14-02-PLAN.md (unexecuted), 999.15-04-PLAN.md (unexecuted), 999.15 mcp-tracker CLI hotfix follow-up

Synthesis: Both Wave 2/4 plans are "deploy gate + soak verification" plans for already-landed code. 999.14 Plan 02 covers MCP-06/07/08/09/10 verification; 999.15 Plan 04 is the clawdy cold-restart soak proving TRACK-07. These are pure verification waves blocked on operator-approved restart windows (per `feedback_no_auto_deploy`). `STATE.md:706` notes a post-deploy mcp-tracker CLI "Invalid Request" bug already hotfixed in Phase 106 — verify the soak covers it.

Rationale: same operator-approval gate, same restart window, contiguous subsystem. One deploy → both soaks.

### MG-D — Dashboard backend/observability cleanup (post-116)
**Members:** 999.49 (benchmarks empty tool rollup), 999.7 follow-ups B+C (split-latency producer regression, tool-latency-audit CLI Invalid Request)

Synthesis: 999.49 surfaced 2026-05-13: per-agent tool rollup shows 19 rows with blank `tool` field, null percentiles styled as breach-red. Same Benchmarks tab also reveals the 999.7 follow-up B regression (split-latency columns NULL) and follow-up C (`clawcode tool-latency-audit` CLI Invalid Request — possibly same root cause). All three are post-Phase-116 dashboard data-shape problems on the trace_spans / tool_latency surface.

Rationale: same data layer (`src/performance/trace-store.ts`), same dashboard panel, and 999.49's hypothesis #3 ("slo_status defaults to breach when percentiles are null") overlaps with the SLO classification already touched in Phase 116/999.38.

### MG-E — Get-shit-done extraction + skills marketplace surface
**Members:** 999.35 (extract GSD as standalone package), 999.40-current (/clawcode-skills-create + /clawcode-skills-install)

Synthesis: Both are "make the skill/workflow surface portable" — 999.35 carves GSD out of the clawcode monorepo so its slash-command churn ships independently; 999.40 adds Discord-side create/install flows for arbitrary skills (ClawHub + GitHub URLs). 999.40-B explicitly extends the existing `marketplace-install` IPC. Together they define the v-next skill-distribution story.

Rationale: shared surface (skill files, install/discovery contract) and shared release cadence question. Decide the extraction shape (999.35) before adding install flows (999.40) so URLs/paths land right the first time.

---

## 3. Standalone open items

### Empty title-only signal dirs (no documents — title is the only data)

- **999.4 — clawcode usage accuracy fixes (resetsAt units, utilization derive)** — usage CLI/dashboard accuracy. EMPTY DIR — title-only signal.
- **999.5 — clawcode status finish-up fallbacks + no-source honest NA** — status CLI fallback honesty. EMPTY DIR — title-only signal.
- **999.19 — subagent cleanup + memory consolidation + delegate-channel routing** — EMPTY DIR; full spec lives at `ROADMAP.md:1497-1516`. Three-prong: spawn delegated threads on delegate's channel (not parent's), default `autoArchive: true` for delegate path, memory consolidation into delegate's SQLite. Plus fix the `-via-` naming-pattern leak across 5+ filter sites.
- **999.20 — `/research` and `/research-search` Discord slash commands** — EMPTY DIR; spec at `ROADMAP.md:1517-1534`. Depends on 999.19 landing first.

### Skills + Discord-UX (separate from MG-A)

- **999.46 — Discord table rendering auto-transform** — `BACKLOG.md:1`. Wrap markdown tables in code blocks at the daemon's Discord output formatter so monospace alignment survives mobile. Operator flagged 5×+. Single-place hook; obsoletes per-agent `feedback_no_wide_tables_discord.md` workarounds.

### Homelab / inventory

- **999.47 — Homelab inventory canonical source of truth** — `BACKLOG.md:1`. Build `/home/clawcode/homelab/{INVENTORY,NETWORK,ACCESS}.md` + cron-driven `refresh.sh` snapshot. Consolidates fragments scattered across MEMORY.md, 1Password, Tailscale UI, Unraid UI.

---

## 4. Pending-verify items

### 999.6 — Auto pre-deploy snapshot + restore running state
- Shipped scope (Plans 00+01): `snapshot-manager.ts` + daemon shutdown writer + boot reader + `defaults.preDeploySnapshotMaxAgeHours` zod field. Per `999.6-01-SUMMARY.md`.
- Unexecuted: `999.6-02-PLAN.md` — production smoke gate on clawdy.
- Confirmed working in production via 999.12 Plan 02 deploy 2026-04-30: "Phase 999.6 snapshot system worked end-to-end... 6 agents captured and auto-started" (`999.12-02-SUMMARY.md`).
- Verification: STRAIGHTFORWARD. Code is proven by 999.12's deploy. Plan 02 is just formal sign-off.

### 999.12 — Cross-agent IPC + heartbeat-inbox timeout
- Shipped (Plans 00+01+02, deployed 2026-04-30): IPC-02 bot-direct fallback (~73 LOC), HB-01 heartbeat timeout override (default 60s), HB-02 active-turn skip. Per `999.12-02-SUMMARY.md`.
- Deferred: Ramy-driven cross-agent dispatchTurn smoke tests "next operator-active session" — note: 999.44 (2026-05-13) reports A2A is still broken (no-webhook fallback recurring), suggesting IPC-02 didn't fully resolve the failure mode OR a regression has slipped in since 2026-04-30.
- Verification: RISKY. The 999.44 report is direct evidence of the failure mode this phase was supposed to fix. Verify before closing — likely needs the MG-A pass first.

### 999.14 — MCP server child-process lifecycle hardening
- Shipped (Plans 00+01): McpProcessTracker singleton + /proc-walk PID discovery + SIGTERM-on-stop + 60s reaper + boot orphan scan + thread-cleanup real impl + `threads archive/prune` CLI. Per `999.14-01-SUMMARY.md`.
- Unexecuted: `999.14-02-PLAN.md` — Wave 2 covers MCP-06/07/08/09/10 verification ("Full vitest suite green + tsc clean").
- Operational confirmation: "Zero MCP orphans post-restart (orphan reaper from 999.14 working)" (`999.12-02-SUMMARY.md`).
- Verification: STRAIGHTFORWARD. Subsystem proven in production; Plan 02 is the formal verify wave.

### 999.15 — MCP PID tracking + reconciler + self-healing + operator visibility
- Shipped (Plans 00+01+02+03): tracker reshape + reconciler/polled discovery + IPC `mcp-tracker-snapshot` + `clawcode mcp-tracker` CLI + exit codes. Per `999.15-03-SUMMARY.md`.
- Unexecuted: `999.15-04-PLAN.md` — Wave 4 clawdy soak (TRACK-07, cold restart, per-agent restart, forced respawn).
- Open bug: mcp-tracker CLI "Invalid Request" — already hotfixed in Phase 106 TRACK-CLI-01 commit `fa72303` per `ROADMAP.md:1455`.
- Verification: STRAIGHTFORWARD modulo operator-approved restart window. Bundle with MG-C.

### 999.36 — Subagent UX trio (typing indicator, output truncation, cross-channel file leak)
- Shipped (Plans 00+01): typing indicator (TYPING_REFRESH_MS=8000) + share-file channel routing rebind to sessionName → thread binding + shared-workspace regression test. Per `999.36-00/01-SUMMARY.md`.
- Unexecuted: Plan 02 (sub-bug D premature completion gate), Plan 03 (sub-bug B chunk-boundary off-by-3). Both planned but waiting for production observation per `STATE.md:474`.
- Deferred items: `DEFERRED-WORKSPACE-LOOKUPS.md` catalogues 4 suspect + 6 cleared + 3 deferred workspace-keyed lookup sites; `deferred-items.md` lists 20 pre-existing slash-command count-drift test failures (out of scope, needs a separate small task).
- Verification: PARTIAL — the shipped half (Plans 00+01) is verify-ready. Plans 02+03 are the MG-B follow-on work.

---

## 5. Recommended next moves

1. **Cleanup pass (1-2h)** — Mark already-shipped items closed: remove or stub empty dirs for 999.7, 999.16, 999.17, 999.21, 999.22, 999.23, 999.24, 999.38, 999.39. Rename/archive 999.25 (the stale CONTEXT.md is for what became 999.30). Renumber `999.40-skills-discord-commands` to avoid collision with the SUPERSEDED tool-cache 999.40 in ROADMAP.

2. **MG-A: A2A + relay reliability deep dive** — Highest operator pain (999.44 reported 2026-05-13, recurring). Start with capturing one live `no-webhook` event with full broker trace + webhook registry state. Likely uncovers either webhook expiry/rotation, daemon-restart re-registration gap, or Cloudflare-style UA blocking. Fix unlocks 999.45 (thumbs-up icon) and 999.48 (heartbeat leak routing). Also re-validates the 999.12 deploy.

3. **Verify-and-close MCP phases (MG-C)** — One operator-approved restart window closes 999.6 / 999.14 / 999.15 formally. Pure execution of the four pre-written Wave-2/4 plans; soak script is in 999.15-04 already.

4. **999.49 + 999.7-followups (MG-D)** — Dashboard backend bugs are highly visible (operator just opened the Benchmarks tab post-redesign and "none of the benchmarks seem to work"). Diagnostic SQL is already prescribed in `999.49-BACKLOG.md:40`. Small, high-clarity, high-perceived-value fix.

5. **MG-B (999.36 Plans 02+03)** — Both plans are pre-written, autonomous-flagged (`autonomous: true`), and gated only on production observation that's now had 5+ days to accumulate. Promote when MG-A is in flight.

Defer: 999.4 / 999.5 (need spec capture before they're plan-able), 999.19+999.20 (need product decision on research-agent fleet shape), 999.47 (greenfield infra project — schedule when 24h+ of low-pain operator time exists), MG-E (no v-next milestone yet).
