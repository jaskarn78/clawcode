---
phase: 119-a2a-delivery-reliability
plan: 02
title: D-05 no_webhook_fallbacks_total counter + dashboard exposure
subsystem: manager+dashboard
tags: [observability, dashboard, A2A, fleet-stats]
requires:
  - Phase 119-01 bot-direct fallback rung (counter site 1 lives inside it)
  - Phase 109 /api/fleet-stats endpoint (counter exposure)
  - Phase 999.38 SLO-breach styling (text-danger token)
provides:
  - "incrementNoWebhookFallback(agent, channel) — single helper, two sites"
  - "snapshotNoWebhookFallbacks() — JSON-safe Record snapshot"
  - "FleetStatsData.noWebhookFallbacksTotal — Readonly<Record<string, number>>"
  - "BenchmarksView no-webhook-fallbacks tile — 15min rolling delta + SLO styling"
affects: [src/manager/fleet-stats.ts, src/manager/daemon-post-to-agent-ipc.ts, src/dashboard/types.ts, src/dashboard/client/src/components/BenchmarksView.tsx]
decisions:
  - "Counter typed as Record<string, number> (not Map) — JSON-safe at the IPC boundary without a Map→Record adapter."
  - "Two call sites pinned by Sentinel B static-grep test — no third or fourth site can land silently."
  - "no-target-channels skip path does NOT increment — channelId would be empty; counter is per-channel by spec."
metrics:
  duration_minutes: 12
  completed: 2026-05-14
key-decisions:
  - "Sentinel B regression guard — grep daemon-post-to-agent-ipc.ts for exactly 2 incrementNoWebhookFallback call sites"
---

# Phase 119 Plan 02: D-05 no_webhook_fallbacks_total counter + dashboard tile Summary

JSON-safe Prometheus-style counter for no-webhook fallback dispatches, surfaced on the BenchmarksView dashboard tile with Phase 999.38 SLO-breach styling so non-zero values are alerted rather than silently absorbed.

## Files Modified

- `src/manager/fleet-stats.ts` — counter helpers (increment, snapshot, reset), buildFleetStats embeds snapshot on every return path.
- `src/manager/__tests__/fleet-stats.test.ts` — 5 new vitest cases (increment-same-key, increment-distinct-keys, shallow-copy invariant, zero-state, FleetStatsData embedding).
- `src/dashboard/types.ts` — `FleetStatsData.noWebhookFallbacksTotal: Readonly<Record<string, number>>` added.
- `src/manager/daemon-post-to-agent-ipc.ts` — two `incrementNoWebhookFallback` call sites (bot-direct success branch + inboxOnlyResponse helper). `inboxOnlyResponse` signature extended with optional `channelId`; threaded through the two callers that can resolve one.
- `src/manager/__tests__/post-to-agent-ipc.test.ts` — 6 new behavioral cases + Sentinel B static-grep guard.
- `src/dashboard/client/src/components/BenchmarksView.tsx` — new `NoWebhookFallbacksTile` component mounted at the top of BenchmarksView; reads `useFleetStats().noWebhookFallbacksTotal`, renders "since deploy: N" badge + 15-min rolling delta + per-pair breakdown + SLO-breach (`text-danger`) styling when delta > 0.

## Commits

- `e147b92` — feat(119-02-T01): counter helpers + FleetStatsData shape
- `954e3a6` — feat(119-02-T02): wire two call sites + Sentinel B
- `42af77b` — feat(119-02-T03): expose via /api/fleet-stats + dashboard tile

## Counter Signature

```typescript
// src/manager/fleet-stats.ts
export function incrementNoWebhookFallback(agent: string, channel: string): void;
export function snapshotNoWebhookFallbacks(): Record<string, number>;
export function _resetNoWebhookFallbacks(): void; // test-only

// src/dashboard/types.ts
export type FleetStatsData = {
  // ...
  readonly noWebhookFallbacksTotal?: Readonly<Record<string, number>>;
};
```

## Verification (Pre-merge gates)

- `npx vitest run src/manager/__tests__/fleet-stats.test.ts src/manager/__tests__/post-to-agent-ipc.test.ts` — 46/46 green.
- `npx tsc --noEmit` — clean.
- `grep -c "incrementNoWebhookFallback(" src/manager/daemon-post-to-agent-ipc.ts` — **2** (matches plan requirement).
- `grep -c "noWebhookFallbacksTotal" src/dashboard/client/src/components/BenchmarksView.tsx` — **3** (≥ 1 as required).

## Deviations from Plan

### Rule 3 — Plan path mismatch (dashboard tile)

- **Found during:** Task 3 setup.
- **Issue:** Plan specified `src/ui/dashboard/BenchmarksView.tsx`; actual path is `src/dashboard/client/src/components/BenchmarksView.tsx` (Phase 116 dashboard client lives under `src/dashboard/client/`, not `src/ui/dashboard/`).
- **Fix:** Used the actual path. No code-shape change; tile component + integration identical to spec.
- **Commit:** `42af77b`.

No other deviations — Plan 02 executed as written.

## Open Items (post-deploy, operator-driven)

- **SC-5 dashboard screenshot at T+15min.** Per `<operator_notes>` in the plan, the 15-minute window starts at deploy. Operator captures a dashboard screenshot showing counter === 0 (or > 0 with SLO-breach styling) and attaches to the phase verification artifact. **Deploy gated — DO NOT deploy without explicit operator confirmation.**

## Self-Check: PASSED

- `src/manager/fleet-stats.ts` — FOUND (modified)
- `src/dashboard/types.ts` — FOUND (modified)
- `src/manager/daemon-post-to-agent-ipc.ts` — FOUND (modified)
- `src/dashboard/client/src/components/BenchmarksView.tsx` — FOUND (modified)
- Commits `e147b92`, `954e3a6`, `42af77b` — FOUND in `git log`.
