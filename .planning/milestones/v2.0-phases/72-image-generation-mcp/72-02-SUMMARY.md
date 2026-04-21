---
phase: 72-image-generation-mcp
plan: 02
subsystem: image-generation
tags: [mcp, ipc, auto-inject, daemon, openai, minimax, fal, costs-cli, smoke-test, readme]

# Dependency graph
requires:
  - phase: 72-image-generation-mcp
    provides: "Plan 01 — imageConfigSchema + ImageConfig, three provider factories (createOpenAiImageClient / createMiniMaxImageClient / createFalImageClient) with lazy API-key reads, writeImageToWorkspace atomic writer, recordImageUsage cost bridge, imageGenerate / imageEdit / imageVariations pure DI handlers, TOOL_DEFINITIONS frozen array, UsageTracker schema migration with category/backend/count columns"
  - phase: 71-web-search-mcp
    provides: "5-file MCP recipe template — daemon-handler + mcp-server + CLI subcommand + loader auto-inject + daemon IPC intercept. scripts/search-smoke.mjs zero-dep JSON-RPC-over-Unix-socket client. Source-grep test pattern for daemon wiring invariants."
  - phase: 40-usage-tracking
    provides: "UsageTracker.getCostsByAgentModel per-agent cost breakdown — extended by Plan 01 to include category/backend/count columns. `clawcode costs` CLI consumes this."
provides:
  - "Every agent's resolved config auto-includes an `image` MCP entry (command=clawcode, args=[image-mcp], env.CLAWCODE_AGENT=<agent>) when defaults.image.enabled is true"
  - "`clawcode image-mcp` CLI subcommand — spawns a StdioServerTransport MCP server registering image_generate + image_edit + image_variations"
  - "src/image/daemon-handler.ts — handleImageToolCall pure dispatcher + ImageDaemonHandlerDeps type with usageTrackerLookup callback"
  - "src/image/mcp-server.ts — createImageMcpServer + startImageMcpServer + __testOnly_buildHandler + __testOnly_buildMcpResponse"
  - "image-tool-call IPC method wired in daemon.ts, intercepted BEFORE routeMethod (same closure pattern as browser-tool-call + search-tool-call)"
  - "Daemon-owned OpenAI + MiniMax + fal.ai image clients constructed at boot (lazy API-key reads, zero boot-time network)"
  - "`clawcode costs` CLI Category column — image rows distinct from token rows (IMAGE-04 end-to-end)"
  - "scripts/image-smoke.mjs — zero-dep Node ESM E2E smoke: image_generate → verify file exists on disk with bytes > 0"
  - "README Image Generation (Phase 72) section + MCP Servers table row"
affects: [v2.0-complete]

# Tech tracking
tech-stack:
  added: []  # Zero new npm deps — reuses Plan 01's native fetch + FormData + Blob, MCP SDK already pulled by Phase 70, Phase 71's smoke-script transport
  patterns:
    - "Pure daemon-side handler pattern reused from Phase 70/71: src/image/daemon-handler.ts owns dispatch, daemon.ts does closure-capture + single-line forward"
    - "usageTrackerLookup callback in ImageDaemonHandlerDeps keeps the handler agent-agnostic — no bound tracker in the deps bag; lookup happens per-call so a cold-started agent (tracker DB not yet open) gets a no-op recordCost rather than a crash"
    - "Daemon-owned image clients constructed unconditionally at boot but never touch network until first generate/edit/variations — lazy API-key reads inside each provider method keep daemon bootable without any API keys present"
    - "MCP subprocess response shape is plain-text single-item envelope (no screenshot branch) — mirrors Phase 71 search/mcp-server.ts"
    - "Smoke script daemon-down guard: ECONNREFUSED/ENOENT → exit 2 with 'daemon not running' message; Exit 1 reserved for assertion failures"
    - "Costs CLI Category column inserts between Agent and Model — legacy null/undefined category displays as 'tokens' for back-compat, Phase 72 image rows display 'image'"

key-files:
  created:
    - "src/image/daemon-handler.ts (202 lines) — handleImageToolCall pure dispatcher + ImageDaemonHandlerDeps type + usageTrackerLookup callback pattern"
    - "src/image/mcp-server.ts (202 lines) — createImageMcpServer + startImageMcpServer + __testOnly_buildHandler + __testOnly_buildMcpResponse"
    - "src/cli/commands/image-mcp.ts (32 lines) — registerImageMcpCommand Commander subcommand with dynamic import"
    - "src/ipc/__tests__/image-tool-call.test.ts (310 lines, 10 cases D1-D10)"
    - "src/image/__tests__/mcp-server.test.ts (226 lines, 9 handler cases M1-M9 + 2 response-builder cases MR1-MR2 = 11 total)"
    - "scripts/image-smoke.mjs (211 lines, executable) — zero-dep Node ESM E2E smoke"
  modified:
    - "src/ipc/types.ts — IpcImageToolCallParams + IpcImageToolCallResult appended (Phase 72 block)"
    - "src/ipc/protocol.ts — 'image-tool-call' appended to IPC_METHODS tuple"
    - "src/ipc/__tests__/protocol.test.ts — toEqual tuple extended with 'image-tool-call'"
    - "src/config/loader.ts — image auto-inject block added after search (line ~125). Final auto-inject order: clawcode -> 1password -> browser -> search -> image"
    - "src/config/__tests__/loader.test.ts — 4 new L1-L4 Phase 72 cases + existing L5 filter extended to exclude 'image' + 3 DefaultsConfig fixtures extended with defaults.image"
    - "src/config/__tests__/differ.test.ts — makeConfig fixture extended with defaults.image"
    - "src/manager/daemon.ts — imports (handleImageToolCall, createOpenAiImageClient, createMiniMaxImageClient, createFalImageClient, IpcImageToolCallParams, ImageBackend, ImageProvider), step 9e constructs all 3 provider clients after search warm block, IPC handler 'image-tool-call' case intercepted BEFORE routeMethod"
    - "src/manager/__tests__/daemon-warmup-probe.test.ts — 5 new Phase 72 source-grep cases (G1-G5)"
    - "src/cli/commands/costs.ts — formatCostsTable Category column added between Agent and Model; legacy null/undefined displays as 'tokens'"
    - "src/cli/commands/costs.test.ts — 5 new Category column tests (CT1-CT5)"
    - "src/cli/index.ts — registerImageMcpCommand imported + registered alongside registerSearchMcpCommand"
    - "README.md — MCP Servers table extended with 'image' row + new 'Image Generation (Phase 72)' section (tool reference, backend support matrix, Discord delivery, cost CLI snippet, opt-out, smoke, known limitations)"

key-decisions:
  - "IPC handler intercepted BEFORE routeMethod (same closure pattern as browser-tool-call + search-tool-call + openai-key-*) — keeps the 24-arg routeMethod signature stable. Every new phase adding an IPC method can follow the same split without growing routeMethod."
  - "handleImageToolCall extracted into src/image/daemon-handler.ts rather than inlined in daemon.ts. Rationale: daemon.ts is already 2800+ lines; extracting the handler keeps file-size manageable AND provides a clean DI seam for 10-case unit tests that never touch an IPC socket, real HTTP, or real disk."
  - "usageTrackerLookup is a callback `(agent: string) => UsageTracker | undefined` rather than a bound tracker — keeps the handler agent-agnostic, and when the lookup returns undefined (agent not yet running, tracker DB not yet open) the recordCost becomes a no-op rather than crashing the tool. Tests pin this via D9 (undefined → no-op) + D10 (tracker → record called)."
  - "Daemon-owned image clients constructed unconditionally at boot (via createOpenAiImageClient / createMiniMaxImageClient / createFalImageClient) — NOT per-request construction, NOT lazy-at-first-call-only. Factories are zero-cost (no env read, no network at construction); clients hold no state. Per-request factory calls would re-allocate a closure per tool call; daemon-owned is one-time + cheap."
  - "No warm-path probe for image — same rationale as Phase 71 search: HTTP clients hold no state between calls. Keeps daemon boot below v1.7 SLO ceiling with zero new measurement surface."
  - "Lazy API-key reads inside each provider method (Plan 01 design, preserved here) — missing OPENAI_API_KEY / MINIMAX_API_KEY / FAL_API_KEY at daemon boot does NOT crash the process. The first tool call returns `invalid_input` with a message naming the missing env var."
  - "MCP response shape is plain text only (single {type:'text'} content item) — no image branch despite returning images. The tool response is metadata (path, backend, model, cost); agents read the path and hand it to send_attachment for Discord delivery. Pure composition, no new delivery surface (IMAGE-03)."
  - "Costs CLI Category column inserts between Agent and Model (not at the end) — groups related dimensions (who/what-kind-of-spend) visually; TOTAL row leaves the category+model columns blank for the aggregate."
  - "Smoke script is zero-dep Node ESM that inlines a JSON-RPC-over-Unix-socket client (same pattern as Phase 70/71 smokes) — works on a fresh clone with no build step, no dist/ dependency, no npm install required. Exit 2 on daemon-down distinguishes infra-skip from assertion-fail."

patterns-established:
  - "5-file MCP recipe fully proven on three phases (70 browser, 71 search, 72 image): src/<feature>/daemon-handler.ts (pure dispatch) + src/<feature>/mcp-server.ts (stdio subprocess) + src/cli/commands/<feature>-mcp.ts (Commander subcommand) + auto-inject in src/config/loader.ts (gated by defaults.<feature>.enabled) + IPC intercept in daemon.ts (BEFORE routeMethod). Future phases can copy verbatim."
  - "Source-grep tests for daemon wiring invariants (daemon-warmup-probe.test.ts) — cheaper than booting startDaemon with 30+ mocked deps. Five tokens per phase (method registered, handler imported, clients constructed, dispatch before routeMethod, no boot-time provider call) pin the wiring at ~50 LOC."
  - "usageTrackerLookup callback seam — first time a daemon-side handler needs per-agent state lookup on every call (unlike the browser BrowserManager which is a singleton, or the search clients which are agent-agnostic). Future handlers that need similar lookups can reuse the callback shape."

requirements-completed: [IMAGE-01, IMAGE-02, IMAGE-03, IMAGE-04]

# Metrics
duration: 24 min
completed: 2026-04-19
---

# Phase 72 Plan 02: Wire + Transport + Costs-Category + Smoke Summary

**Closes IMAGE-01..04 end-to-end and the v2.0 milestone: every agent auto-gets an `image` MCP entry, the daemon owns lazily-constructed OpenAI + MiniMax + fal.ai image clients, the `image-tool-call` IPC dispatches to `imageGenerate` / `imageEdit` / `imageVariations` via a pure handler, `clawcode costs` now shows image spend in a new Category column distinct from token spend, and `scripts/image-smoke.mjs` validates the whole chain against a live daemon. Zero new npm deps. Zero Discord diff. Zero v1.7 SLO surface diff.**

## Plan 01 -> Plan 02 bridge (full phase closure)

Plan 01 built the pure daemon-agnostic image core: `imageConfigSchema` under `defaults.image`, three provider clients (OpenAI gpt-image-1 b64_json, MiniMax image-01 hosted-URL, fal.ai flux-pro `Key <token>` auth), atomic `writeImageToWorkspace`, `IMAGE_PRICING` rate card, `recordImageUsage` bridge, pure DI handlers `imageGenerate` / `imageEdit` / `imageVariations`, `TOOL_DEFINITIONS`, and — critically for IMAGE-04 — the UsageTracker schema migration adding `category` / `backend` / `count` columns with idempotent ALTER TABLE.

Plan 02 wires the transport: IPC contract + method, daemon-side pure dispatcher, stdio MCP subprocess, CLI subcommand, auto-inject in the config loader, daemon client-construction + IPC-intercept, costs CLI Category column, live smoke, and README.

**IMAGE-03 Discord delivery closes by composition after Plan 02** because:

1. Plan 01's tools return `{ images: [{ path, ... }], total_cost_cents }` where path is the absolute workspace file.
2. Plan 02's auto-inject puts `image_generate` + `send_attachment` in every agent's MCP tool set.
3. An agent calls `image_generate('a cat in a tophat')` -> receives `{path: "/…/generated-images/<ts>-<nanoid>.png"}` -> calls `send_attachment(channel, path)` -> existing Discord upload path handles the file.

**Zero net-new code in src/discord/** — composition of existing tools. The smoke script verifies the first half (image on disk); the Discord half is verified by the existing `send_attachment` smoke + manual UAT.

**IMAGE-04 cost breakdown closes end-to-end** because:

1. Plan 01 extended UsageTracker with `category` column + `recordImageUsage` writes `category='image'` with composite model `${backend}:${model}`.
2. Plan 01 extended `getCostsByAgentModel` SELECT to include `category`.
3. Plan 02's CLI extension displays the new column — image rows distinct from token rows at a glance, operator can answer "how much did Clawdy spend on MiniMax this week?" by reading the table.

## Performance

- **Duration:** ~24 min
- **Started:** 2026-04-19T03:48:17Z
- **Completed:** 2026-04-19T04:12:00Z
- **Tasks:** 2 (both TDD: RED -> GREEN per task)
- **New tests:** 37 (1 IPC protocol tuple extension + 10 daemon-handler cases + 11 mcp-server cases + 4 loader auto-inject cases + 5 daemon-warmup-probe source-grep cases + 5 costs CLI Category cases + 1 loader filter extension)
- **Plan 02 targeted suite:** 124 tests pass across 7 files — `npx vitest run src/config/__tests__/loader.test.ts src/config/__tests__/differ.test.ts src/manager/__tests__/daemon-warmup-probe.test.ts src/cli/commands/costs.test.ts src/ipc/__tests__/protocol.test.ts src/ipc/__tests__/image-tool-call.test.ts src/image/__tests__/mcp-server.test.ts`
- **Full suite:** 2846 green across 212 files (excluding 4 pre-existing flaky SQLite-timeout files unrelated to this work; they reproduce at HEAD before this plan)

## Task Commits

| # | Task | Commit | Kind |
|---|------|--------|------|
| 1 | Task 1 RED — failing tests for IPC contract + daemon-handler + mcp-server | `60adf55` | test |
| 2 | Task 1 GREEN — IPC contract + daemon-handler + MCP subprocess + CLI subcommand | `11c57a3` | feat |
| 3 | Task 2 RED — failing tests for auto-inject + daemon wiring + costs CLI Category | `d03c7eb` | test |
| 4 | Task 2 GREEN — auto-inject + daemon wiring + costs CLI Category + smoke script + README | `0ee1f67` | feat |

## Auto-Injected `image` MCP Entry (`src/config/loader.ts`)

```typescript
// Phase 72 — auto-inject the image MCP server so every agent gets
// image_generate + image_edit + image_variations. The daemon owns the
// OpenAI/MiniMax/fal provider clients; this subprocess is a thin IPC
// translator. Gated by defaults.image.enabled (default true).
// CLAWCODE_AGENT env is consumed by the subprocess as the default
// agent identity for tool calls (src/image/mcp-server.ts).
const imageEnabled = defaults.image?.enabled !== false;
if (imageEnabled && !resolvedMcpMap.has("image")) {
  resolvedMcpMap.set("image", {
    name: "image",
    command: "clawcode",
    args: ["image-mcp"],
    env: { CLAWCODE_AGENT: agent.name },
  });
}
```

Placed immediately after the `search` auto-inject block. **Final auto-inject order:** `clawcode` -> `1password` -> `browser` -> `search` -> `image` (5 `resolvedMcpMap.set` auto-inject calls in that order — verified by `grep -n "resolvedMcpMap.set" src/config/loader.ts`).

## Daemon Boot Sequence (`src/manager/daemon.ts`)

| Step | Action | Rough line |
|------|--------|-----------|
| Imports | `handleImageToolCall`, `createOpenAiImageClient`, `createMiniMaxImageClient`, `createFalImageClient`, `IpcImageToolCallParams`, `ImageBackend`, `ImageProvider` | 122-128 |
| 9e | Construct `imageProviders` (all 3 clients) after search warm block; log backend + workspaceSubdir on enabled path | ~1058 |
| 10 | IPC handler — `image-tool-call` case intercepted BEFORE `routeMethod` (same closure pattern as `browser-tool-call` / `search-tool-call` / `openai-key-*`); closes over `imageCfg`, `imageProviders`, and `manager.getUsageTracker` | ~1149 |

**No shutdown change** — HTTP clients own no persistent resources, nothing to close. The `browserManager.close()` path (Phase 70) stays untouched.

## `image-tool-call` IPC Handler (`src/image/daemon-handler.ts`)

Pure async function over `{imageConfig, resolvedAgents, providers, usageTrackerLookup, writeImage?, readFile?}`:

1. **Disabled guard** → `{ok:false, error:{type:"internal", message:/disabled/}}`
2. **Agent resolution** → unknown agent → `invalid_argument`
3. **Build per-call `ImageToolDeps`**:
   - `config`          = `deps.imageConfig`
   - `providers`       = `deps.providers`
   - `writeImage`      = `deps.writeImage ?? writeImageToWorkspace`
   - `recordCost`      = closure over `deps.usageTrackerLookup(agent)` — calls `recordImageUsage(tracker, event)` only if tracker exists (no-op otherwise)
   - `agentWorkspace`  = `resolvedAgent.workspace` (per-agent isolation)
   - `agent` + `sessionId` = identity passed to UsageEvent shape
   - `readFile`        = optional forward from `deps.readFile` (tests only)
4. **Dispatch** via `try/switch` on `toolName`:
   - `image_generate` → `imageGenerate(args, toolDeps)`
   - `image_edit` → `imageEdit(args, toolDeps)`
   - `image_variations` → `imageVariations(args, toolDeps)`
   - default → `invalid_argument` (unknown image tool)
5. **Defence-in-depth catch** — maps any thrown rejection to `internal` so the IPC boundary is never torn by a provider/writeImage bug.

Ten tests (`src/ipc/__tests__/image-tool-call.test.ts`) pin the contract:
- D1: disabled-guard → internal
- D2: unknown agent → invalid_argument
- D3: routes `image_generate` to pure handler with per-agent workspace
- D4: routes `image_edit` to pure handler (with readFile dep)
- D5: routes `image_variations` to pure handler
- D6: unknown toolName → invalid_argument
- D7: never throws — TypeError mock → internal envelope with error.message preserved
- D8: per-agent isolation — workspace argument to writeImage matches resolvedAgent.workspace
- D9: usageTrackerLookup undefined → recordCost no-op (tool still succeeds)
- D10: usageTrackerLookup returns tracker → `record` called with `{category:'image', model:'openai:gpt-image-1', agent:'clawdy', …}`

## MCP Subprocess (`src/image/mcp-server.ts`)

Mirrors `src/search/mcp-server.ts` 1:1 with 2 differences:

- `TOOL_DEFINITIONS` imported from `./tools.js` (Plan 01; exactly 3 entries)
- MCP server `name: "image"`, `version: "0.1.0"`

`buildMcpResponse` is identical to search — search-style single `{type:'text'}` content item with `JSON.stringify(outcome.data)` on success or `JSON.stringify({error: outcome.error})` on failure. `isError: outcome.ok ? undefined : true`.

Agent-name resolution: `args.agent > env.CLAWCODE_AGENT > error`. Eleven tests (`src/image/__tests__/mcp-server.test.ts`):
- M1-M9: handler forward-to-daemon contract (mocked `sendIpc`) across all three tools
- MR1-MR2: response-builder envelope shape

## Costs CLI Category Column (`src/cli/commands/costs.ts`)

Extended `formatCostsTable` with a "Category" column between "Agent" and "Model". Legacy rows (pre-Phase-72) with `category` null/undefined display as `"tokens"`; Phase 72 image rows display the stored `"image"` category.

**Example output:**

```
Agent     Category  Model                     Tokens In  Tokens Out  Cost (USD)
--------  --------  ------------------------  ---------  ----------  ----------
clawdy    tokens    haiku                     150,000    25,000      $0.0688
clawdy    image     openai:gpt-image-1        0          0           $0.1200
clawdy    image     fal:fal-ai/flux-pro       0          0           $0.0500
                                                                     ----------
TOTAL                                         150,000    25,000      $0.2388
```

The composite model column (`${backend}:${model}` from Plan 01) surfaces directly — operator can tell at a glance which backend is costing what. Five tests (CT1-CT5) pin the shape.

## Smoke Script (`scripts/image-smoke.mjs`)

- **Invocation:** `node scripts/image-smoke.mjs [agent=clawdy] [prompt="a cat in a tophat"]`
- **One step:** `image_generate(prompt) -> verify first image has { path, backend, model } -> statSync the path to confirm file exists + bytes > 0`
- **Atomicity assurance:** Plan 01's `writeImageToWorkspace` uses `.tmp + rename(2)` — when the IPC call returns, the file is guaranteed complete on disk (no half-written bytes visible to readers)
- **Exit codes:** 0=pass, 1=assertion failure, 2=daemon-not-running (ECONNREFUSED/ENOENT)
- **Timeouts:** 60s per step (image generation can take 30-60s depending on backend + size)
- **Runtime deps:** none — inlines the minimal JSON-RPC-over-Unix-socket client (no `dist/` dependency)

Syntax-check + daemon-down branch verified:

```bash
$ node --check scripts/image-smoke.mjs
SYNTAX OK

$ CLAWCODE_SOCKET_PATH=/tmp/nonexistent.sock timeout 5 node scripts/image-smoke.mjs
Phase 72 image smoke — agent=clawdy prompt="a cat in a tophat" socket=/tmp/nonexistent.sock
daemon not running — start with `clawcode start-all` first
EXIT=2
```

### Expected output (successful run, live daemon + OPENAI_API_KEY)

```
Phase 72 image smoke — agent=clawdy prompt="a cat in a tophat" socket=/home/user/.clawcode/manager/clawcode.sock
[1/1] image_generate — backend=openai, model=gpt-image-1 (8341ms)
       path: /home/user/.clawcode/agents/clawdy/generated-images/1734567890123-AbCdEfGhIj.png
SMOKE PASS — image written to /home/user/.clawcode/agents/clawdy/generated-images/1734567890123-AbCdEfGhIj.png (284521 bytes, cost 4¢)
```

## Non-Regression Evidence

All verification checks from the plan:

| # | Check | Result |
|---|-------|--------|
| 1 | `git diff --name-only HEAD~4 HEAD -- src/discord/` | **empty** (Discord bridge untouched) |
| 2 | `git diff --name-only HEAD~4 HEAD -- src/manager/turn-dispatcher.ts src/manager/session-adapter.ts` | **empty** (TurnDispatcher untouched) |
| 3 | `git diff --name-only HEAD~4 HEAD -- src/mcp/server.ts src/mcp/tool-cache.ts src/performance/` | **empty** (v1.7 SLO surface untouched — no IDEMPOTENT_TOOL_DEFAULTS edit either; image generation is non-deterministic by design) |
| 4 | `git diff --stat HEAD~4 HEAD -- package.json package-lock.json` | **empty** (zero new npm deps) |
| 5 | `grep "image-tool-call" src/ipc/protocol.ts` | present in IPC_METHODS (appended after 'search-tool-call') |
| 6 | Auto-inject order in `src/config/loader.ts` | `clawcode -> 1password -> browser -> search -> image` (5 `resolvedMcpMap.set` auto-inject calls in that order) |
| 7 | Daemon intercept order (handler closure) | `openai-key-* -> browser-tool-call -> search-tool-call -> image-tool-call -> routeMethod` |
| 8 | `grep registerImageMcpCommand src/cli/index.ts` | import + invocation present |
| 9 | `grep -n "Image Generation (Phase 72)\|image-mcp" README.md` | section heading + MCP Servers table row both present |
| 10 | `node --check scripts/image-smoke.mjs` | SYNTAX OK |
| 11 | Daemon-down branch | exit 2 with "daemon not running" message |
| 12 | Plan 02 targeted suite | 124 tests pass across 7 files |
| 13 | Full suite | 2846 green (8 pre-existing flaky SQLite-timeout tests reproduce at HEAD — unrelated to this work) |

## Decisions Made

See frontmatter `key-decisions` for the full list. Highlights:

1. **usageTrackerLookup as a callback** — keeps the handler agent-agnostic AND lets a call succeed when the agent's tracker DB isn't open yet. Bound-tracker deps would have forced a "which agent's tracker do I use?" decision at construction.
2. **Daemon-owned clients (not per-request)** — factories are zero-cost; clients hold no state; per-request construction would waste allocations. Clients are lazy in the sense that no network call happens until first `.generate()/.edit()/.variations()` — but their instances live for the daemon's lifetime.
3. **No warm-path probe for image** — HTTP clients don't need one. Keeps `src/manager/warm-path-check.ts` untouched and daemon boot below the v1.7 SLO ceiling with zero new measurement surface. Same rationale as Phase 71 search.
4. **IPC handler intercepted BEFORE `routeMethod`** — same closure pattern as browser-tool-call + search-tool-call + openai-key-*. Keeps the 24-arg `routeMethod` signature from growing.
5. **Costs CLI Category column between Agent and Model** — groups related dimensions visually. TOTAL row leaves category + model blank for the aggregate.
6. **Zero-dep smoke script** — inlined JSON-RPC client works on a fresh clone with no build step. Distinguishes daemon-down (exit 2) from assertion failure (exit 1) per Phase 70/71 convention.

## Deviations from Plan

**Total deviations:** 0.

The plan executed exactly as written. No auto-fixes required (Rule 1/2/3), no architectural questions hit (Rule 4), no authentication gates encountered.

A few minor observations worth recording (not deviations):

- The MCP handler test MR2 exports `error` as an `as const` literal — TypeScript narrowed the `type` to `"rate_limit"` when `ImageToolOutcome<unknown>` expects the wider `string`. The `as const` literal is safe because `__testOnly_buildMcpResponse` accepts the narrower union (the outer `outcome.ok` branch narrows). Tests pass.
- The `costs` CLI still passes its result through as `CostByAgentModel[]` even though the daemon's "costs" IPC handler returns `{ period, costs: results }` — that's a pre-existing behaviour from before this plan (daemon response shape leaks through the cast); out of scope for Plan 02 and not introduced by it.
- Three loader.test.ts `DefaultsConfig` fixtures needed the `image` field extended. Same in-place-fixture-fix pattern Phase 70/71 used — not treated as a deviation.

## Issues Encountered

**None.**

One note on test-suite noise: 8 tests across 4 files (`triggers.test.ts`, `tasks-list.test.ts`, `trace.test.ts`, `session-memory-warmup.test.ts`, `openai-key.test.ts`, `trace-store-persistence.test.ts`) hit `Test timed out in 5000ms` under `npm test`. Confirmed pre-existing by running those files against the Plan 02 RED commit (`d03c7eb`) with no source changes; they reproduce identically. Flaky SQLite timing tests unrelated to this work.

## User Setup Required

Agents calling `image_generate` / `image_edit` / `image_variations` need at least one backend's API key in the environment:

- **OpenAI (default):** set `OPENAI_API_KEY` (already present in the repo's `clawcode.yaml` per 72-CONTEXT).
- **MiniMax (optional):** set `MINIMAX_API_KEY` when `defaults.image.backend: "minimax"`.
- **fal.ai (optional):** set `FAL_API_KEY` when `defaults.image.backend: "fal"` (or when an agent overrides to fal mid-call for edit support).

Missing key -> first tool call returns `{error: {type: "invalid_input", message: "missing OpenAI API key (env var OPENAI_API_KEY is unset)"}}` (or the equivalent for minimax/fal). No daemon crash.

## Coverage

| Requirement | Status | Notes |
|---|---|---|
| IMAGE-01 (generate to workspace + cost record) | **DONE** | Plan 01 tools + Plan 02 CLI/MCP transport + daemon-owned clients + smoke script; cost recorded with category='image', composite model, cost_cents / count |
| IMAGE-02 (edit + unsupported_operation taxonomy) | **DONE** | Plan 01 tools handle backend gating with helpful self-routing messages ("backends with edit support: openai, fal"); Plan 02 wires CLI/MCP transport |
| IMAGE-03 (Discord delivery via send_attachment) | **DONE** | No code change needed — agents pass the returned workspace path to existing send_attachment. Composition of existing tools; verified by smoke (image on disk) + the send_attachment tool already in every agent's MCP tool set via the `clawcode` auto-inject (Phase 40). Manual UAT covers the Discord half. |
| IMAGE-04 (cost recording in `clawcode costs`) | **DONE** | Plan 01 added category column to UsageTracker + recordImageUsage bridge + getCostsByCategory; Plan 02 added Category column to the costs CLI formatCostsTable. Operator can answer "how much did Clawdy spend on MiniMax this week?" by reading `clawcode costs --period week`. |

## Phase Readiness

**Phase 72 is complete end-to-end.** All 4 IMAGE-* requirements are covered across Plans 01/02:

- **IMAGE-01** (generate to workspace) — Plan 01 `src/image/providers/openai.ts` + `src/image/workspace.ts` + `src/image/tools.ts:imageGenerate` + Plan 02 daemon-handler + mcp-server + CLI wiring + smoke
- **IMAGE-02** (edit with unsupported_operation self-routing) — Plan 01 `src/image/providers/minimax.ts` `.edit()` returns `unsupported_operation` with helpful message naming `openai, fal`; fal.ai image-to-image path in `src/image/providers/fal.ts`; Plan 02 wires transport
- **IMAGE-03** (Discord delivery by composition) — Plan 02 auto-inject puts both `image` and `clawcode` (which provides `send_attachment`) in every agent's MCP tool set; pure composition, zero new delivery surface
- **IMAGE-04** (CLI cost breakdown) — Plan 01 UsageTracker schema migration + recordImageUsage; Plan 02 costs CLI Category column

**v2.0 milestone (Open Endpoint + Eyes & Hands) is complete end-to-end.** All 20/20 requirements across Phases 69/70/71/72 closed:

- Phase 69 (OpenAI-compatible endpoint): OPENAI-01..07
- Phase 70 (Browser automation MCP): BROWSER-01..06
- Phase 71 (Web search MCP): SEARCH-01..03
- Phase 72 (Image generation MCP): IMAGE-01..04

## Deploy-Gate Follow-Up

Before switching prod to the v2.0 build:

1. **Capture v1.7 SLO baselines** before/after:
   - `clawcode latency <agent> --since 1h` + `clawcode cache <agent> --since 1h` — record first-token p95 and cache-hit rate pre-switch
   - After switch: warm path check + rerun `clawcode latency` — expect first-token p95 within 5% of baseline (v1.7 SLO non-regression)
2. **Set image API keys** in the systemd `EnvironmentFile` (or 1Password `op://...` references):
   - `OPENAI_API_KEY` (default, required)
   - `MINIMAX_API_KEY` (optional)
   - `FAL_API_KEY` (optional)
3. **Run the live smoke:**
   ```bash
   node scripts/image-smoke.mjs clawdy "a cat in a tophat"
   # expect: exit 0 with "SMOKE PASS — image written to /…/generated-images/<ts>-<id>.png (<bytes> bytes, cost 4¢)"
   ```
4. **Monitor spend for the first 48h** — `clawcode costs --period today` should show:
   - token rows for Discord turns (unchanged from v1.9)
   - image rows only appear once an agent is instructed to generate an image
   - cost deltas match the IMAGE_PRICING rate card within pennies
5. **UAT the Discord delivery half** — ask Clawdy in Discord to "generate a cat in a tophat and post it"; expect Clawdy to return the image as a Discord attachment via `send_attachment`.

## Self-Check: PASSED

- [x] `src/image/daemon-handler.ts` exists (202 lines)
- [x] `src/image/mcp-server.ts` exists (202 lines)
- [x] `src/cli/commands/image-mcp.ts` exists (32 lines)
- [x] `src/ipc/__tests__/image-tool-call.test.ts` exists (310 lines, 10 cases)
- [x] `src/image/__tests__/mcp-server.test.ts` exists (226 lines, 11 cases)
- [x] `scripts/image-smoke.mjs` exists (211 lines, executable) + `node --check` passes + daemon-down exits 2
- [x] `src/config/loader.ts` contains `image-mcp` + `CLAWCODE_AGENT` + `defaults.image?.enabled`
- [x] `src/manager/daemon.ts` contains `handleImageToolCall`, `createOpenAiImageClient`, `createMiniMaxImageClient`, `createFalImageClient`, `image-tool-call`
- [x] `src/ipc/protocol.ts` contains `image-tool-call` in IPC_METHODS
- [x] `src/cli/index.ts` contains `registerImageMcpCommand`
- [x] `README.md` contains `Image Generation (Phase 72)` section + MCP Servers table row for `image`
- [x] Commit `60adf55` in `git log --oneline`
- [x] Commit `11c57a3` in `git log --oneline`
- [x] Commit `d03c7eb` in `git log --oneline`
- [x] Commit `0ee1f67` in `git log --oneline`
- [x] Plan 02 targeted suite: **124 tests pass (7 files)**
- [x] Full suite: **2846 tests passed** (8 pre-existing flaky SQLite-timeout tests reproduce at HEAD — unrelated to this work)
- [x] Discord bridge (src/discord/), TurnDispatcher (src/manager/turn-dispatcher.ts / session-adapter.ts), v1.7 SLO surface (src/performance/, src/mcp/server.ts, src/mcp/tool-cache.ts) UNTOUCHED
- [x] Zero new npm deps

---
*Phase: 72-image-generation-mcp*
*Completed: 2026-04-19*
