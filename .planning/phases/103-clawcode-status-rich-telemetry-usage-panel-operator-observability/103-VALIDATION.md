---
phase: 103
slug: clawcode-status-rich-telemetry-usage-panel-operator-observability
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-26
---

# Phase 103 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x (project-pinned, ESM-first) |
| **Config file** | none in repo root — vitest auto-discovers `*.test.ts` |
| **Quick run command** | `npx vitest run path/to/file.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~30 seconds for `src/usage src/discord src/manager`; full suite varies |

---

## Sampling Rate

- **After every task commit:** `npx vitest run <touched test file>` (typically <10s)
- **After every plan wave:** `npx vitest run src/usage src/discord src/manager` (~30s)
- **Before `/gsd:verify-work`:** Full suite must be green (`npx vitest run`)
- **Max feedback latency:** 30 seconds per-wave; <10s per task commit

---

## Per-Task Verification Map

| Req ID | Plan | Wave | Behavior | Test Type | Automated Command | File Exists | Status |
|--------|------|------|----------|-----------|-------------------|-------------|--------|
| OBS-01 | 103-01 | 1 | `buildStatusData` returns live values for the 8 already-available fields | unit | `npx vitest run src/discord/__tests__/status-render.test.ts` | ✅ extend | ⬜ pending |
| OBS-02 | 103-01 | 1 | `SessionManager.getCompactionCountForAgent` increments on `CompactionManager.compact()` resolve | unit | `npx vitest run src/manager/__tests__/compaction-counter.test.ts` | ❌ Wave 0 | ⬜ pending |
| OBS-03 | 103-01 | 1 | `renderStatus` does NOT include `Fast`, `Elevated`, `Harness` substrings | unit | `npx vitest run src/discord/__tests__/status-render.test.ts` | ✅ extend | ⬜ pending |
| OBS-04 | 103-02 | 2 | `RateLimitTracker.record(info)` updates in-memory + SQLite; `getLatest(type)` returns frozen snapshot; round-trip via constructor restore | unit | `npx vitest run src/usage/__tests__/rate-limit-tracker.test.ts` | ❌ Wave 0 | ⬜ pending |
| OBS-05 | 103-02 | 2 | A `rate_limit_event` SDK message in turn output causes the per-agent tracker to record the snapshot (canonical buildFakeSdk pattern) | unit (SDK-mock) | `npx vitest run src/manager/__tests__/rate-limit-event-capture.test.ts` | ❌ Wave 0 | ⬜ pending |
| OBS-06 | 103-03 | 3 | IPC `list-rate-limit-snapshots` returns `{agent, snapshots[]}` with shape pinned by zod | unit | `npx vitest run src/ipc/__tests__/protocol.test.ts` | ✅ extend | ⬜ pending |
| OBS-07 | 103-03 | 3 | `buildUsageEmbed` produces correct color per worst-status, correct field count, sentinel "no data" path | unit | `npx vitest run src/discord/__tests__/usage-embed.test.ts` | ❌ Wave 0 | ⬜ pending |
| OBS-08 | 103-03 | 3 | `renderStatus` appends 2 progress bars when snapshots present; emits nothing when absent | unit | `npx vitest run src/discord/__tests__/status-render.test.ts` | ✅ extend | ⬜ pending |
| OBS-meta | 103-03 | 3 | Slash-command registry size remains under 90 (Pitfall 6 closure) | static-grep / structural | `npx vitest run src/discord/__tests__/slash-types-cap.test.ts` | ✅ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/usage/__tests__/rate-limit-tracker.test.ts` — covers OBS-04 (in-memory record, persistence round-trip, frozen snapshot invariant)
- [ ] `src/manager/__tests__/rate-limit-event-capture.test.ts` — covers OBS-05 (SDK mock + iterateUntilResult capture, reuses `buildFakeSdk` from `src/manager/__tests__/persistent-session-cache.test.ts:32-100`)
- [ ] `src/manager/__tests__/compaction-counter.test.ts` — covers OBS-02 (counter mirror increment on compact() success)
- [ ] `src/discord/__tests__/usage-embed.test.ts` — covers OBS-07 (color triage, field rendering, no-data path)
- [ ] `src/discord/__tests__/slash-commands-usage.test.ts` — covers `/clawcode-usage` inline-handler dispatch + admin gate (if any)
- [ ] No framework install required — vitest is project-pinned

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live OAuth Max usage values display correctly under real session pressure | OBS-04, OBS-05, OBS-07 | Cannot mock real `rate_limit_event` payloads from production OAuth Max — only the SDK shape can be unit-tested. Final reset-time formatting and color thresholds need an eyeball check against the Claude app | After deploy: run `/clawcode-usage` in Discord against an active agent, compare 5h + 7-day bar values against Claude app's Settings → Usage panel within ±5% utilization. |
| `/clawcode-status` field-rendering parity (Discord-Embed visual layout) | OBS-01, OBS-03, OBS-08 | Embed line-wrap + monospace alignment depend on Discord client rendering quirks, not asserted via snapshot | After deploy: run `/clawcode-status` in Discord, confirm 8 newly-wired fields show non-`n/a` values, Fast/Elevated/Harness are gone, and 2 usage bars (if present) align with the rest of the embed |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency <30s per wave
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-26
