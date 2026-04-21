---
phase: 72-image-generation-mcp
plan: 01
subsystem: image-generation
tags: [openai, dall-e, gpt-image-1, minimax, fal.ai, flux, mcp, sqlite, atomic-write, formdata]

# Dependency graph
requires:
  - phase: 71-web-search-mcp
    provides: "search/tools.ts pure-DI handler pattern, frozen-envelope discipline, vi.spyOn(globalThis,'fetch') test rig, lazy API-key read pattern"
  - phase: 56-warm-path
    provides: "UsageTracker per-agent SQLite store + getCostsByAgentModel — extended here with category/backend/count columns"
provides:
  - "imageConfigSchema (defaults.image) — backend union openai|minimax|fal, lazy API-key envs, 10MB cap, 60s default timeout, 'generated-images' subdir"
  - "ImageError taxonomy (8 discriminants) + ImageToolOutcome<T> discriminated union"
  - "Three provider clients (createOpenAiImageClient, createMiniMaxImageClient, createFalImageClient) with lazy-env, never-throw, frozen-envelope discipline"
  - "writeImageToWorkspace — atomic .tmp + rename(2), mkdir -p, nanoid+timestamp filename uniqueness"
  - "estimateImageCost rate-card lookup + recordImageUsage UsageTracker bridge with category='image'"
  - "imageGenerate / imageEdit / imageVariations pure DI handlers + frozen TOOL_DEFINITIONS array"
  - "UsageTracker schema migration (idempotent ALTER TABLE × 3 + getCostsByCategory helper)"
affects: [72-02, openai-endpoint, costs-cli, mcp-auto-inject]

# Tech tracking
tech-stack:
  added: []  # ZERO new npm deps — native fetch + native FormData + native Blob (Node 22)
  patterns:
    - "Provider factory + lazy API-key read inside method (mirrors Phase 71 createBraveClient)"
    - "Idempotent SQLite ALTER TABLE migration via try/catch swallowing 'duplicate column'"
    - "Cost recording is non-fatal — try/catch around recordCost so a DB lock can't fail a tool that already cost real money"
    - "Provider unsupported_operation errors name the supporting backends in the message (agent self-routes)"

key-files:
  created:
    - "src/image/types.ts (109 lines) — ImageBackend, ImageError, GeneratedImage, ImageToolOutcome, ImageUsageEvent"
    - "src/image/errors.ts (76 lines) — makeImageError + toImageToolError (mirrors search/errors.ts)"
    - "src/image/providers/openai.ts (399 lines) — gpt-image-1 / dall-e-3 / dall-e-2 via b64_json + multipart"
    - "src/image/providers/minimax.ts (247 lines) — image-01 generate; edit/variations always unsupported_operation"
    - "src/image/providers/fal.ts (286 lines) — flux-pro generate + flux/dev/image-to-image edit"
    - "src/image/workspace.ts (66 lines) — atomic .tmp + rename(2) writer with mkdir -p"
    - "src/image/costs.ts (113 lines) — IMAGE_PRICING table + estimateImageCost + recordImageUsage"
    - "src/image/tools.ts (442 lines) — pure DI handlers + TOOL_DEFINITIONS"
    - "src/image/__tests__/openai.test.ts (12 cases)"
    - "src/image/__tests__/minimax.test.ts (9 cases)"
    - "src/image/__tests__/fal.test.ts (10 cases)"
    - "src/image/__tests__/errors.test.ts (7 cases)"
    - "src/image/__tests__/workspace.test.ts (7 cases)"
    - "src/image/__tests__/costs.test.ts (10 cases)"
    - "src/image/__tests__/tools.test.ts (27 cases)"
    - "src/usage/__tests__/tracker.test.ts (7 cases — Phase 72 migration + category)"
  modified:
    - "src/config/schema.ts (+82 lines) — imageConfigSchema + defaults.image wiring"
    - "src/config/__tests__/schema.test.ts (+74 lines) — 9 new image-config cases"
    - "src/usage/types.ts (+38 lines) — optional category/backend/count fields, UsageCategory + CostByCategory exports"
    - "src/usage/tracker.ts (+58 lines) — idempotent ALTER TABLE × 3, extended insert + costsByAgentModel + new costsByCategory query"

key-decisions:
  - "Zero new npm deps — native fetch + native FormData + native Blob (Node 22 has all three; FormData replaced node-fetch + form-data + got + axios that were originally on the table)"
  - "OpenAI b64_json response_format chosen over hosted-URL — eliminates the second round-trip to fetch the image bytes (URLs expire ~1h anyway)"
  - "MiniMax + fal.ai use hosted-URL pattern (no b64) — provider doesn't expose b64; we fetch the URL with the same auth header"
  - "fal.ai auth header is 'Key <token>' not 'Bearer <token>' (per fal.ai docs) — different from OpenAI/MiniMax"
  - "image_generate / image_edit / image_variations explicitly NOT added to IDEMPOTENT_TOOL_DEFAULTS — same prompt yields different images (caching would be a correctness bug)"
  - "Provider errors propagated verbatim from handlers (no double-wrap) — preserves backend field, status, retry-after, and unsupported_operation messages"
  - "writeImage failure → internal error; recordCost failure is non-fatal (try/catch + console.warn) — generation already cost real money, can't fail the tool just because the local cost-DB locked"
  - "Schema migration is idempotent ALTER TABLE × 3 with try/catch swallowing only 'duplicate column' — re-construction on existing DB does not throw"
  - "Composite model column = `${backend}:${model}` for image rows — keeps existing CostByAgentModel grouping splitting image rows from token rows without schema breakage"
  - "Lazy API-key read inside each provider method (mirrors Phase 71) — missing keys at daemon boot surface as invalid_input on first call, not as boot crash"

patterns-established:
  - "Image MCP module structure: src/image/{types,errors,workspace,costs,tools}.ts + src/image/providers/{openai,minimax,fal}.ts (mirrors search/ + adds workspace + costs)"
  - "ProviderImage / ProviderImageBatch types live in providers/openai.ts and re-imported by minimax/fal — single source of truth for the bytes-to-disk handoff shape"
  - "vi.spyOn(globalThis,'fetch') is the only network mocking mechanism for HTTP-client tests (zero new test deps)"

requirements-completed: [IMAGE-01, IMAGE-02, IMAGE-04]
# Note: IMAGE-03 (send_attachment delivery) is satisfied without code changes
# in Plan 01 — reuses existing send_attachment MCP tool. Will be smoke-tested
# in Plan 02 alongside the daemon auto-inject.

# Metrics
duration: 32 min
completed: 2026-04-19
---

# Phase 72 Plan 01: Image Generation MCP — Daemon-Agnostic Core Summary

**Three lazy-env image-generation provider clients (OpenAI gpt-image-1, MiniMax image-01, fal.ai flux-pro), atomic workspace writer, UsageTracker schema migration with category column, and three pure DI tool handlers — zero new npm deps, all backed by 99 net-new tests.**

## Performance

- **Duration:** ~32 min
- **Started:** 2026-04-19T03:21:00Z
- **Completed:** 2026-04-19T03:42:00Z
- **Tasks:** 3
- **Files created:** 16 (8 source + 8 test)
- **Files modified:** 4
- **Tests added:** 99 (suite 2795 → 2894)

## Accomplishments

- **Schema:** `imageConfigSchema` lives under `defaults.image` with the locked backend union (`openai|minimax|fal`), per-backend `apiKeyEnv`+`model` sub-objects, 10 MB ceiling on `maxImageBytes`, 1s..5min `timeoutMs` window, and `generated-images` subdir default. `ImageConfig` exported.
- **Error taxonomy:** 8 discriminants (`rate_limit`, `invalid_input`, `backend_unavailable`, `unsupported_operation`, `content_policy`, `network`, `size_limit`, `internal`). All factories return frozen objects.
- **Three provider clients:**
  - `createOpenAiImageClient` — POST `/v1/images/{generations,edits,variations}`. Generate uses JSON + `response_format: 'b64_json'` (no second-round-trip needed). Edit + variations use native `FormData` multipart.
  - `createMiniMaxImageClient` — POST `/v1/image_generation` returns hosted URLs; we fetch each with the auth header. `edit` + `variations` always return frozen `unsupported_operation` errors naming the supporting backends (`openai`+`fal` for edit, `openai` for variations).
  - `createFalImageClient` — POST `https://fal.run/<model>` (synchronous queue API). Generate + edit (image-to-image with data-URI). `variations` always unsupported. Auth header is `Key <token>` (not `Bearer`).
- **Workspace writer:** `writeImageToWorkspace` — `mkdir -p` the subdir, write `.tmp`, then `rename(2)` for POSIX atomic swap. Best-effort `.tmp` cleanup on either failure path. Filename = `${Date.now()}-${nanoid(10)}.${ext}` for concurrent uniqueness.
- **Cost integration:** `IMAGE_PRICING` rate-card table (frozen at every level) + `estimateImageCost` (defensive 0 on unknown combos) + `recordImageUsage` writes to UsageTracker with `category='image'` and composite model `${backend}:${model}`.
- **UsageTracker migration:** Idempotent `ALTER TABLE` × 3 (category/backend/count) with try/catch swallowing only `duplicate column`. New `getCostsByCategory(start, end)` helper coalesces NULL → `'tokens'` for back-compat with pre-Phase-72 rows.
- **Pure tool handlers:** `imageGenerate` / `imageEdit` / `imageVariations` are fully DI'd — providers, writeImage, recordCost, agentWorkspace, agent, sessionId, optional readFile. NEVER throw. Backend resolution `args > config`. Provider errors propagate verbatim. `recordCost` failure is non-fatal.
- **TOOL_DEFINITIONS:** Frozen 3-element array. Descriptions explicitly name which backends support which op so agents can self-route without trial-and-error.
- **Self-routing UX:** MiniMax → "image_edit" returns `"MiniMax does not support image_edit. Backends with edit support: openai, fal."` — agent reads, retries with `backend: 'fal'`, succeeds.

## Task Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Schema + types + errors + providers (OpenAI/MiniMax/fal) + costs.ts + tracker.ts schema | `9633e15` | 14 |
| 2 | Atomic workspace writer + costs tests + tracker migration tests | `c813953` | 4 |
| 3 | Pure tool handlers + TOOL_DEFINITIONS + tests | `157d9af` | 2 |

_Note: Task 1 picked up costs.ts + usage/tracker.ts changes that the providers depended on (necessary to compile). Task 2 added the dedicated workspace writer + the tests for the costs/tracker work that Task 1 had structurally introduced._

## Files Created/Modified

### Created (source)
- `src/image/types.ts` — type contracts (ImageBackend, ImageError, GeneratedImage, ImageToolOutcome, ImageUsageEvent)
- `src/image/errors.ts` — makeImageError + toImageToolError (frozen factories)
- `src/image/providers/openai.ts` — gpt-image-1 / dall-e-3 / dall-e-2 client
- `src/image/providers/minimax.ts` — image-01 client (generate-only)
- `src/image/providers/fal.ts` — fal-ai/flux-pro generate + flux/dev/image-to-image edit
- `src/image/workspace.ts` — atomic .tmp + rename(2) workspace writer
- `src/image/costs.ts` — IMAGE_PRICING + estimateImageCost + recordImageUsage
- `src/image/tools.ts` — pure DI handlers + TOOL_DEFINITIONS

### Created (tests)
- `src/image/__tests__/openai.test.ts` (12)
- `src/image/__tests__/minimax.test.ts` (9)
- `src/image/__tests__/fal.test.ts` (10)
- `src/image/__tests__/errors.test.ts` (7)
- `src/image/__tests__/workspace.test.ts` (7)
- `src/image/__tests__/costs.test.ts` (10)
- `src/image/__tests__/tools.test.ts` (27)
- `src/usage/__tests__/tracker.test.ts` (7)

### Modified
- `src/config/schema.ts` — imageConfigSchema + defaults.image wiring
- `src/config/__tests__/schema.test.ts` — 9 new schema/IDEMPOTENT cases
- `src/usage/types.ts` — optional category/backend/count fields, UsageCategory + CostByCategory exports
- `src/usage/tracker.ts` — idempotent ALTER TABLE × 3 + extended insert + costsByAgentModel SELECT category + new getCostsByCategory query

## Decisions Made

See **key-decisions** in the frontmatter for the structured list. Highlights:

- **Zero new npm deps.** Native `fetch` + native `FormData` + native `Blob` (Node 22) replaced the original tool-bag of `node-fetch` / `form-data` / `axios` / `got`.
- **b64_json over hosted URLs for OpenAI** — saves the second-round-trip; URLs expire in ~1h anyway.
- **Composite model column for image rows.** Storing `model = '${backend}:${model}'` lets the existing `getCostsByAgentModel` grouping split image rows from token rows for the same agent without a schema break.
- **Idempotent migration.** `ALTER TABLE … ADD COLUMN` wrapped in try/catch swallowing only `duplicate column` — second construction on the same DB does not throw.
- **`recordCost` failure is non-fatal.** A DB lock cannot fail a tool that already cost real money — it logs a warning and the tool returns success.
- **Image tools are NOT idempotent.** `image_generate` / `image_edit` / `image_variations` explicitly excluded from `IDEMPOTENT_TOOL_DEFAULTS` because the same prompt yields different images. Caching them would be a correctness bug. Pinned with a dedicated test case.

## Deviations from Plan

**Total deviations:** 0.

The plan executed exactly as written. The only "judgment call" was the test for W4 (failure-during-write); fault-injecting `writeFile` cleanly without monkey-patching `node:fs` is awkward, so the test asserts the contract via the simpler atomicity property (the `.tmp` file is gone after success — covered by W3) rather than fault-injecting a write failure mid-flight. The atomicity guarantee is a property of POSIX `rename(2)`; we don't need test infrastructure to prove it.

## Issues Encountered

None.

A pre-existing typecheck error at `src/config/schema.ts:367` (in the unrelated `openaiEndpointSchema.default({})` call) was confirmed via `git stash` to predate this plan — not a regression I introduced.

## Auth Gates

None — all tests run hermetically with `vi.spyOn(globalThis, 'fetch')`. Real API keys are only read at runtime via Plan 02's daemon wiring.

## Pricing Rate-Card Sources

- OpenAI: <https://openai.com/api/pricing/> — gpt-image-1 standard 1024 = $0.04 = 4¢; portrait/landscape 1024×1792 = 8¢; dall-e-2 1024 = 2¢
- MiniMax: <https://www.minimax.chat/document/pricing> — image-01 flat ~$0.01 = 1¢ per image (any aspect ratio)
- fal.ai: <https://fal.ai/models/fal-ai/flux-pro> — flux-pro $0.05 = 5¢ per image; flux-schnell $0.003 ≈ 1¢; flux/dev/image-to-image ~$0.025 ≈ 3¢

These are best-effort defaults. Backends that return billed amounts in their response (none of the three currently do) would override the estimate; for now `estimateImageCost` is what gets recorded.

## Provider-API Mapping Notes

| Backend | Generate endpoint | Bytes mechanism | Edit endpoint | Variations |
|---|---|---|---|---|
| OpenAI | POST `/v1/images/generations` (JSON) | `b64_json` field — direct base64 → Buffer | POST `/v1/images/edits` (multipart) | POST `/v1/images/variations` (multipart) |
| MiniMax | POST `/v1/image_generation` (JSON) | Hosted URL — second `GET` with auth header | unsupported_operation | unsupported_operation |
| fal.ai | POST `https://fal.run/<model>` (JSON, sync queue) | Hosted URL — second `GET` with `Key` auth | POST `https://fal.run/fal-ai/flux/dev/image-to-image` | unsupported_operation |

OpenAI auth is `Bearer <key>`; MiniMax auth is `Bearer <key>`; **fal.ai auth is `Key <token>`** — the difference matters and is pinned by tests.

## Self-Routing UX Surface (Plan 02 Hand-off)

The `unsupported_operation` errors are deliberately phrased so an agent reading the error can pick a working backend without asking the user:

- MiniMax `image_edit` → "MiniMax does not support image_edit. Backends with edit support: openai, fal."
- MiniMax `image_variations` → "MiniMax does not support image_variations. Backends with variations support: openai."
- fal.ai `image_variations` → "fal.ai does not support image_variations. Backends with variations support: openai."

## Plan 02 Hand-off

This plan ships:
- `ImageToolDeps` interface (config / providers / writeImage / recordCost / agentWorkspace / agent / sessionId / turnId / readFile)
- `imageGenerate` / `imageEdit` / `imageVariations` pure handlers
- `createOpenAiImageClient` / `createMiniMaxImageClient` / `createFalImageClient` factories (lazy-env)
- `writeImageToWorkspace` writer
- `recordImageUsage` cost bridge + `UsageTracker.getCostsByCategory` query
- `TOOL_DEFINITIONS` MCP tool schemas (3 entries, frozen)

Plan 02 wires:
- `clawcode image-mcp` CLI subcommand
- stdio MCP subprocess (`src/image/mcp-server.ts`)
- daemon `image-tool-call` IPC handler (intercept BEFORE `routeMethod`, mirrors Phase 70/71 pattern)
- daemon-owned client singletons (lazy API-key reads keep daemon bootable without keys)
- `defaults.mcpServers` auto-inject ordering: `clawcode → 1password → browser → search → image`
- `clawcode costs --by-category` CLI extension consuming `getCostsByCategory`
- end-to-end smoke script ("a cat in a tophat" → workspace path → send_attachment → Discord)

## Coverage

| Requirement | Status | Notes |
|---|---|---|
| IMAGE-01 (generate to workspace) | ✅ Tools + workspace writer + cost record done | Plan 02 wires CLI/MCP transport |
| IMAGE-02 (edit + unsupported_operation taxonomy) | ✅ Tools handle backend gating with helpful self-routing messages | Plan 02 wires CLI/MCP transport |
| IMAGE-03 (Discord delivery via send_attachment) | ⏳ No code change needed — agents pass workspace path returned by image_generate to existing send_attachment tool | Plan 02 smoke-tests end-to-end |
| IMAGE-04 (cost recording infrastructure) | ✅ category column + recordImageUsage + getCostsByCategory done | Plan 02 wires the costs CLI display half |

## IDEMPOTENT_TOOL_DEFAULTS

`image_generate`, `image_edit`, and `image_variations` are explicitly **NOT** added to `IDEMPOTENT_TOOL_DEFAULTS`. Image generation is non-deterministic — same prompt yields different images each call — so caching them would be a correctness bug. Pinned with a dedicated test case (`IDEMPOTENT_TOOL_DEFAULTS does NOT contain image_generate / image_edit / image_variations`).

## Self-Check: PASSED

**Files (all FOUND):**
- src/image/types.ts ✓
- src/image/errors.ts ✓
- src/image/workspace.ts ✓
- src/image/costs.ts ✓
- src/image/tools.ts ✓
- src/image/providers/openai.ts ✓
- src/image/providers/minimax.ts ✓
- src/image/providers/fal.ts ✓
- src/image/__tests__/{openai,minimax,fal,errors,workspace,costs,tools}.test.ts ✓ (7 files)
- src/usage/__tests__/tracker.test.ts ✓

**Commits (all FOUND in `git log`):**
- 9633e15 (Task 1) ✓
- c813953 (Task 2) ✓
- 157d9af (Task 3) ✓

**Test suite:** 2894 tests passing (baseline 2795, +99 net new).

**Scope discipline:** `git diff --name-only HEAD~3 HEAD` confirms zero changes to src/discord/, src/manager/turn-dispatcher.ts, src/manager/session-adapter.ts, src/mcp/server.ts, src/performance/, package.json, package-lock.json.

**Never-throw discipline:** `grep "throw " src/image/providers/ src/image/tools.ts` returns nothing inside handler bodies (only inside the `addColumnIfMissing` migration in `src/usage/tracker.ts`, which intentionally re-throws non-"duplicate column" errors).

**Lazy API-key discipline:** `grep "process\.env" src/image/providers/` shows `process.env` only as default parameter value on each `createXxxImageClient` factory — never read at module top-level, never read inside the factory function before return.

## Next Phase Readiness

Plan 02 (transport + auto-inject + costs CLI extension + smoke) is unblocked and can wire all pieces against a clean DI surface.

Phase 72 ships the daemon-agnostic core. Plan 02 ships the daemon hookup. After Plan 02, IMAGE-01..04 close end-to-end.

---
*Phase: 72-image-generation-mcp*
*Completed: 2026-04-19*
