# Phase 122: Discord Table Auto-Wrap Universalization — Context

**Gathered:** 2026-05-14
**Status:** Ready for planning
**Mode:** Auto-discuss — single-requirement phase (DISC-01), decisions clear from ROADMAP success criteria + ARCHITECTURE.md §999.46 Approach A.

<canonical_refs>
## Canonical References

| Ref | Why | Path |
|-----|-----|------|
| ROADMAP entry | 4 success criteria, sequencing after Phase 119 | `.planning/ROADMAP.md` §"Phase Details — v2.9" / Phase 122 |
| REQUIREMENTS DISC-01 | Universal wrap requirement | `.planning/REQUIREMENTS.md` |
| `wrapMarkdownTablesInCodeFence` | Existing helper — DO NOT rewrite (SC-4) | grep `wrapMarkdownTablesInCodeFence` src/ |
| Phase 119 bot-direct fallback | New send path that must inherit the wrap | `src/manager/daemon-post-to-agent-ipc.ts` (commit `ae4c8b1`) |
| `WebhookManager` | `.send` + `.sendAsAgent` chokepoint | `src/discord/webhook-manager.ts` |
| `BotDirectSender` | `.sendText` chokepoint | grep for `BotDirectSender` |
| `bridge.ts` | Edit/send sites | `src/discord/bridge.ts` |
| `daemon-ask-agent-ipc.ts` | Mirror + bot-direct fallback (Phase 999.12) | `src/manager/daemon-ask-agent-ipc.ts:262-299` |
| Cron `triggerDeliveryFn` | Cron-driven delivery path | grep for `triggerDeliveryFn` |
| ARCHITECTURE.md §999.46 | Approach A spec (single chokepoint) | `.planning/codebase/ARCHITECTURE.md` §999.46 |
| `feedback_silent_path_bifurcation.md` | Anti-pattern — wrapping at every per-site call is the wrong layer | memory |
</canonical_refs>

<domain>
## Phase Boundary

Wide markdown tables render unreadably on mobile Discord. Today some send sites wrap them in fenced code blocks; some don't. Per-agent workarounds (`feedback_no_wide_tables_discord.md`) compensate by asking agents not to emit tables. This phase eliminates the workaround by wrapping ALL outbound Discord sends through `wrapMarkdownTablesInCodeFence` at the transport boundary — a single chokepoint, NOT per-site.

The static-grep regression test (SC-1) enumerates every known send site and asserts each routes through the wrap helper. It IS the universal-wiring sentinel (Pattern A).
</domain>

<decisions>
## Implementation Decisions

### D-01 — Approach A: single chokepoint at `WebhookManager.send` + `.sendAsAgent` + `BotDirectSender.sendText`
Per ARCHITECTURE.md §999.46. Wrap call lives inside these three methods. Every caller inherits the wrap without changes. Approach B (per-site wrap) is REJECTED — violates silent-path-bifurcation prevention.

### D-02 — `wrapMarkdownTablesInCodeFence` helper itself is UNCHANGED
SC-4 explicit. Universalization happens at the transport boundary, not by rewriting the helper. If a feature gap exists in the helper (e.g., nested fences not handled), file as a follow-up; do NOT fix in this phase unless SC-3 requires it.

### D-03 — Nested code-block escaping (SC-3)
A table cell containing a triple-backtick fence wraps using a longer outer fence (4+ backticks). The helper must already do this OR Phase 122 extends it specifically for SC-3. If helper rewriting becomes necessary for SC-3, document the rewrite in `122-DEVIATION.md` (D-02 lock notwithstanding — SC-3 is a hard requirement).

### D-04 — Static-grep regression test enumerates ALL known send sites
Per SC-1, the test pins the canonical sites:
- `WebhookManager.send`
- `WebhookManager.sendAsAgent`
- `BotDirectSender.sendText`
- `bridge.ts` edit/send sites
- `daemon-ask-agent-ipc.ts` mirror + bot-direct fallback (Phase 999.12)
- `daemon-post-to-agent-ipc.ts` bot-direct fallback (Phase 119, commit `ae4c8b1`)
- Cron `triggerDeliveryFn`
- Embed `description` body
The test fails when a NEW commit introduces a bypass. This is the long-term prevention mechanism.

### D-05 — 4-column markdown table fixture (SC-2 verification)
A canonical 4-column fixture lives in the phase verification artifact. Operator captures screenshots across webhook / bot-direct / cron / subagent-relay channels using this fixture. Same fixture, 4 paths.

### D-06 — Sequence after Phase 119
Plan 119 Wave 1 already shipped the bot-direct fallback in `daemon-post-to-agent-ipc.ts`. Phase 122 routes this new path through the wrap from day one. **The wrap insertion in `daemon-post-to-agent-ipc.ts` should happen via `BotDirectSender.sendText` chokepoint, not by editing the new bot-direct rung directly** — preserves the single-chokepoint model.

### D-07 — Deploy hold continues
Code lands locally + tests run. Operator-screenshot verification (SC-2) waits for the deploy window.

### D-08 — Single plan, single wave
This phase is narrow (single requirement, single integration point). One PLAN.md, one wave.
</decisions>

<code_context>
## Existing Code Insights

- **`src/discord/webhook-manager.ts`** — `send` + `sendAsAgent` are the two chokepoints. Wrap insertion happens at the top of each method body, on the message content argument.
- **`BotDirectSender`** — class with `sendText` method (confirm via grep). Wrap insertion goes inside that method.
- **`src/discord/bridge.ts`** — edit/send sites use these primitives. By wrapping at the primitive layer, bridge inherits the wrap for free.
- **Cron `triggerDeliveryFn`** — eventually calls webhook/bot-direct primitives. Inherits the wrap by transitivity.
- **Embed `description` body** — special case. Embeds don't go through `send`/`sendText` in the same way. If embeds bypass the wrap, this requires a separate chokepoint in the embed builder.

## Reusable Patterns

- Phase 119 Plan 01's anti-pattern enforcement (static-grep regression test) — mirror for D-04.
- Phase 999.36 Plan 02's TDD pattern (test the fixture, then ship the chokepoint) — mirror.
</code_context>

<specifics>
## Specific Requirements

- The static-grep test (D-04) is REGRESSION-blocking — must run in CI/local test suite, not just as a one-time audit.
- If embed `description` requires a separate chokepoint, document it explicitly in the plan — operator must know there are two chokepoints not one.
- SC-3 (nested backtick handling) MUST pass with current helper OR explicitly extend helper with a `122-DEVIATION.md` rationale.
</specifics>

<deferred>
## Deferred Ideas

- **`wrapMarkdownTablesInCodeFence` rewrite for non-SC-3 features** — locked under D-02. Defer to a future phase.
- **Per-agent workaround removal from `feedback_no_wide_tables_discord.md` memory entries** — operator cleanup, separate from this phase.
- **Mobile rendering tests via Playwright** — if SC-2 operator-screenshots become a recurring friction, automate later.
</deferred>
