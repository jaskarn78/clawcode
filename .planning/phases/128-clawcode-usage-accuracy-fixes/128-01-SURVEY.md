# Phase 128 Plan 01 — T-01 SDK Pull-Source Survey

**Date:** 2026-05-15
**Question:** Does `@anthropic-ai/claude-agent-sdk` expose a pull-style method for current rate-limit / usage state, so the Phase 128 refresh poller can fetch fresh utilization on demand?

**Decision:** **NO pull-source exists.** Fall back to a synthetic-probe path. Open question for the operator (carried into T-06).

---

## Evidence

SDK file inspected: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`.

### Rate-limit surface (lines 3260-3283)

The SDK exposes rate-limit information ONLY via the push event:

```ts
export declare type SDKRateLimitEvent = {
    type: 'rate_limit_event';
    rate_limit_info: SDKRateLimitInfo;
    uuid: UUID;
    session_id: string;
};

export declare type SDKRateLimitInfo = {
    status: 'allowed' | 'allowed_warning' | 'rejected';
    resetsAt?: number;
    rateLimitType?: 'five_hour' | 'seven_day' | 'seven_day_opus' | 'seven_day_sonnet' | 'overage';
    utilization?: number;
    surpassedThreshold?: number;
    overageStatus?: ...;
    overageResetsAt?: number;
    isUsingOverage?: boolean;
    overageDisabledReason?: ...;
};
```

The event is consumed at `src/manager/persistent-session-handle.ts:1056-1076` — it arrives interleaved with assistant / result / stream_event messages on the per-agent `Query` async iterator. It is NOT a method the SDK exposes for pull.

### `Query` interface control methods (lines 2023-2249)

Exhaustive list of pull-style methods on the SDK's `Query` interface:

- `interrupt()`
- `setPermissionMode(mode)`
- `setModel(model?)`
- `setMaxThinkingTokens(n)` (deprecated)
- `applyFlagSettings(settings)`
- `initializationResult()` — returns supported commands/models/account/output-style
- `supportedCommands()` / `supportedModels()` / `supportedAgents()`
- `mcpServerStatus()`
- `getContextUsage()` — context-window breakdown only (NOT rate-limit)
- `readFile(path, opts)`
- `reloadPlugins()`
- `accountInfo()` — email/org/subscription only (NOT rate-limit)
- `rewindFiles(...)` / `seedReadState(...)`
- `reconnectMcpServer` / `toggleMcpServer` / `setMcpServers`
- `streamInput(...)` / `stopTask(...)` / `backgroundTasks(...)` / `close()`

**None of these returns subscription rate-limit / utilization data.** `accountInfo()` and `getContextUsage()` are the closest semantic matches but cover different telemetry (account identity / per-turn context bucket).

### Standalone exports

Searched `getRateLimit`, `fetchRateLimit`, `currentUsage`, `queryUsage`, `getUsage`, `OAuthMax` across `sdk.d.ts` — zero hits beyond the type definitions above. There is no top-level function for rate-limit polling.

### `WarmQuery` interface (lines 5745-5756)

Pre-warm helper exposes only `query(prompt)` and `close()`. No telemetry surface.

---

## Conclusion on D-02 preferred path

**Preferred path (D-02 line 67): ABSENT.** The SDK is purely push-driven via `rate_limit_event`. To refresh a snapshot on demand the daemon MUST trigger a fresh API call that the SDK will instrument and emit an event for.

### Fallback: synthetic-probe path (D-02 line 68)

The only mechanism that produces a fresh `rate_limit_event` is issuing a real `messages.create` call on the underlying transport. Triggers an event on every API response (per Phase 103 OBS-04 documentation in `rate-limit-tracker.ts:5-11`).

Implementation surface for the probe:
- The SDK exposes API calls via `query({ prompt, options })` returning a `Query` async iterator (line 2252).
- A probe would spawn a one-shot `query()` with a minimum prompt, drain the iterator until it sees a `rate_limit_event` (or the iterator terminates), then close.
- Cost: one Anthropic API request per agent per poll cycle. With 8 agents @ 5-minute interval: 8 × 288 polls/day = **~2304 API calls/day** just for refresh.
- **Self-pollution:** the probe ITSELF consumes against the rate limit it is measuring. For the 7-day weekly limit (the bug being fixed), a constant probe stream contributes to weekly utilization.
- This would be the codebase's **first poll-based telemetry source** (CONTEXT.md line 122 — "current implementation is purely push-driven").

### Honest assessment

The probe is the only path to the preferred outcome but it is meaningfully more expensive and operationally novel than the plan implied. The plan called it "hacky"; it is in fact:

1. **Costly:** ~2300+ API requests/day of pure overhead.
2. **Reflexive:** the measurement instrument consumes the measured resource.
3. **Brittle:** requires spawning a fresh `query()` outside the existing per-agent SDK session — a code path that doesn't exist today. The session manager only spawns one `Query` per agent and threads turns through it.
4. **Unclear semantics:** the probe's `rate_limit_event` will fire only if the SDK decides to emit one. Empirical: events fire at threshold crossings (0.5 / 0.8 / 0.9) + on the response — but the rate at which the SDK emits steady-state utilization (not just threshold-crossings) on every response is undocumented and would need to be verified before shipping.

---

## Go/No-Go on D-02 preferred path

**GO on the survey itself (T-01 done).**

**NO-GO on shipping the synthetic-probe automatically in T-06.** Per the orchestrator's hard rule "verify-before-fix on telemetry bugs" and the `feedback_silent_path_bifurcation` memory, shipping ~2300+ API calls/day on a path that's never run in production is exactly the kind of "added telemetry without verifying the path is hot" that the memory warns against.

### Recommended Plan 128-01 adjustment

Two viable resolutions, both kept inside Phase 128:

**Option A — Ship the scaffold, defer the probe (RECOMMENDED).**

- T-02..T-05 still ship: schema field, `UsageRefreshPoller` class with injected `fetchCurrentUsage`, tests, `deriveUtilization` precedence fix.
- T-06 daemon wiring passes `fetchCurrentUsage: async () => null` (the documented no-signal path in the poller body, line 132 of the PLAN pseudocode).
- T-07 staleness UI ships — operators see "stale (Nm)" labels when the snapshot ages past 2× interval, validating that the staleness predicate works end-to-end. Without a fresh-source feeding the tracker, EVERY snapshot will eventually go stale post-deploy — which is the correct operator-visible signal that the refresh path is not yet implemented.
- Add a follow-up tracked under `## Deferred` in SUMMARY.md: "Phase 128b — wire synthetic-probe path OR lobby Anthropic for a pull-side rate-limit API." That follow-up is a behavior change the operator should approve explicitly (cost / self-pollution acknowledgment).

**Option B — Wire the probe AND require operator approval before shipping.**

- Full T-06 wiring with a `defaults.usageRefreshProbe.enabled: false` schema gate (off by default).
- Operator flips the gate post-deploy after reviewing cost.
- More code per plan but the wiring is testable end-to-end with a mocked transport. Tradeoff: more surface that's dead-on-arrival.

**Recommendation: Option A.** Rationale and *honest* scope:

- **Does NOT close the operator-reported bug.** The 89%-stale bug requires a *fresh source* feeding the tracker (CONTEXT.md line 30 — no event fires on downward drift). The `deriveUtilization` precedence fix (T-04) is *defensive cleanup* that only activates when a poll source IS wired; without it, the lower-bound fallback still fires and snapshots still sit at 89% until reset.
- **Does make the bug DIAGNOSABLE** via the staleness UI (T-07). Operators see `⚠️ stale (45m)` on a stuck snapshot instead of an unlabeled-and-misleading 89% bar, which is materially better than the status quo even though it does not close the bug.
- **Ships the scaffold** (schema knob, poller class, precedence fix, tests, staleness UI) so a follow-up phase can wire a probe (or a future SDK pull-source) with a one-line `fetchCurrentUsage` change instead of a full rebuild.
- Defers the **cost decision** (~2300 API calls/day) to an explicit operator-gated follow-up.

What Option A actually ships, plainly:

| Surface | Behavior post-deploy |
|---|---|
| `defaults.usageRefreshIntervalMs` schema field | Accepted by Zod, threaded into `ResolvedAgentConfig`, dead until a probe lands |
| `UsageRefreshPoller` class with `fetchCurrentUsage: async () => null` | Constructed per agent at boot, returns immediately every tick, no-op |
| `deriveUtilization` precedence fix | No-op without a poll source feeding it; defensive cleanup ready for the probe |
| `isStale` predicate + dashboard + Discord embed staleness labels | **Real and useful** — operator sees "⚠️ stale (45m)" on stuck snapshots |
| Tests pinning poller cadence + precedence + staleness | **Real and useful** — regression guard for the probe wiring later |

Bug closure → **Phase 128b** (probe wiring with operator-approved cost).

This **IS** a Rule 4 deviation from the PLAN's stated scope (which had T-06 wire the probe). Surface to the operator before proceeding.

---

## Cross-references

- Plan: `.planning/phases/128-clawcode-usage-accuracy-fixes/128-01-PLAN.md`
- Context: `.planning/phases/128-clawcode-usage-accuracy-fixes/128-CONTEXT.md`
- Bug source: `src/usage/rate-limit-tracker.ts:77-88` (deriveUtilization lower-bound fallback)
- Event consumer: `src/manager/persistent-session-handle.ts:1056-1076`
- Phase 999.4 partial-ship reference: `src/usage/rate-limit-tracker.ts:44-58, 64-88`
- Silent-path-bifurcation memory: `feedback_silent_path_bifurcation.md`
