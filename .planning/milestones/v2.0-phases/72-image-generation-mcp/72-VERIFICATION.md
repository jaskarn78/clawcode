---
phase: 72-image-generation-mcp
verified: 2026-04-18T00:00:00Z
status: human_needed
score: 10/11 must-haves verified (1 awaits live-daemon UAT)
re_verification: false
human_verification:
  - test: "Live daemon E2E — run scripts/image-smoke.mjs clawdy 'a cat in a tophat' against a running daemon with OPENAI_API_KEY present, confirm exit 0 + PNG written to <agent-workspace>/generated-images/<ts>-<id>.png + bytes > 0"
    expected: "SMOKE PASS — image written to <path> (N bytes, cost 4¢); exit 0"
    why_human: "Requires running daemon + real OPENAI_API_KEY spend — cannot verify programmatically without network + dollars. All static wiring verified."
  - test: "IMAGE-03 Discord delivery — ask Clawdy in Discord 'generate a cat in a tophat and post it', confirm Clawdy calls image_generate then send_attachment with the returned path, and the image appears as a Discord attachment"
    expected: "Image arrives in the Discord channel as an attachment; send_attachment returns ok"
    why_human: "Composition test — requires live Discord, live agent reasoning, and a real image-generation call. Static verification confirms image_generate returns a workspace path AND send_attachment is registered in src/mcp/server.ts and unchanged — the composition surface is intact."
  - test: "IMAGE-04 CLI breakdown — after at least one successful image_generate and one successful token turn, run `clawcode costs --period today` and confirm the output shows a Category column with separate 'tokens' and 'image' rows, and image rows show composite model like 'openai:gpt-image-1'"
    expected: "Table with Agent | Category | Model | Tokens In | Tokens Out | Cost (USD); image rows category='image', model='openai:gpt-image-1', tokens_in=0, tokens_out=0, cost>$0"
    why_human: "Requires live DB with real image + token rows. Static verification confirms formatCostsTable shape, tracker schema migration, and recordImageUsage stamps category='image' — all wiring is correct."
---

# Phase 72: Image Generation MCP Verification Report

**Phase Goal:** Every agent can generate and edit images via MiniMax, OpenAI Images, or fal.ai backends (per-agent config selectable), persist output to its workspace, deliver to Discord through the existing `send_attachment` pipeline, and surface image-generation spend in `clawcode costs` alongside token spend.

**Verified:** 2026-04-18
**Status:** human_needed (10/11 truths fully verified via static + test-suite evidence; 1 awaits live-daemon UAT)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `image_generate(prompt, backend?)` writes a PNG to `<agent-workspace>/generated-images/<ts>-<id>.png` and returns absolute path + cost | VERIFIED | `src/image/tools.ts:164` `deps.writeImage(...)`; `src/image/workspace.ts` atomic `.tmp + rename(2)`; 94 image tests pass including G4 (happy path); line-counts substantive (workspace 69, tools 589) |
| 2 | `image_edit(imagePath, prompt, backend?)` returns a new workspace path or `unsupported_operation` naming supporting backends | VERIFIED | `src/image/tools.ts:380` + `providers/minimax.ts:147` hard-coded unsupported_operation with message "Backends with edit support: openai, fal."; E1-E6 tests green |
| 3 | `image_variations(imagePath, n?, backend?)` returns N paths or `unsupported_operation` | VERIFIED | `src/image/tools.ts:485`; MiniMax + fal return unsupported with OpenAI-routing message; V1-V4 green |
| 4 | Each provider factory does NOT read API keys at construction — keys read inside generate/edit/variations on each call | VERIFIED | `grep process.env src/image/providers/` only matches default `env = process.env` parameter; O1/M1/F1 tests assert spy on process.env not triggered at construction |
| 5 | Every agent's resolved config auto-includes an `image` MCP entry when `defaults.image.enabled=true` | VERIFIED | `src/config/loader.ts:134` `resolvedMcpMap.set("image", { command: "clawcode", args: ["image-mcp"], env: { CLAWCODE_AGENT: agent.name } })`; L1-L4 loader tests green; auto-inject order clawcode→1password→browser→search→image confirmed |
| 6 | Daemon constructs all 3 image provider clients at boot, intercepts `image-tool-call` BEFORE `routeMethod` | VERIFIED | `src/manager/daemon.ts:1072-1076` constructs 3 clients; `:1149` image-tool-call case BEFORE `:1160` routeMethod; 5 daemon-warmup-probe source-grep tests (G1-G5) green |
| 7 | `clawcode image-mcp` CLI subcommand starts a stdio MCP server registering image_generate + image_edit + image_variations | VERIFIED | `src/cli/commands/image-mcp.ts` registers subcommand; `src/cli/index.ts:155` invokes `registerImageMcpCommand(program)`; `src/image/mcp-server.ts:183` registers TOOL_DEFINITIONS via `server.tool.bind(server)` |
| 8 | Image cost recorded in UsageTracker with `category='image'`, composite model `${backend}:${model}` | VERIFIED | `src/image/costs.ts:103-121` `recordImageUsage` writes `category: "image"`; `src/usage/tracker.ts:191-193` idempotent ALTER TABLE adds category/backend/count; 7 tracker tests green |
| 9 | `clawcode costs` CLI displays Category column, image rows distinct from token rows | VERIFIED | `src/cli/commands/costs.ts:25` header includes "Category"; `:29` `r.category ?? "tokens"` back-compat; 5 CT tests green |
| 10 | Zero new npm deps — all backends use native fetch + FormData + Blob | VERIFIED | `git diff --stat HEAD~7 HEAD -- package.json package-lock.json` returns empty; no `form-data/node-fetch/axios/got` imports in `src/image/` |
| 11 | IMAGE-03 Discord delivery via existing send_attachment (no new delivery surface) | AWAITS UAT | `src/mcp/server.ts:54,561-563` send_attachment untouched; `image_generate` returns absolute workspace path; composition pattern — but end-to-end UAT (agent actually calls send_attachment with the returned path) needs human verification with a live Discord agent |

**Score:** 10/11 truths verified; 1 routed to human verification.

### Required Artifacts (Level 1-4)

| Artifact | Expected | Exists | Substantive | Wired | Data Flows | Status |
|----------|----------|--------|-------------|-------|------------|--------|
| `src/image/types.ts` | ImageError taxonomy, ImageBackend union, ImageToolOutcome<T> | yes (110 lines) | yes | imported by tools/providers/handler/mcp-server | N/A (types) | VERIFIED |
| `src/image/errors.ts` | makeImageError + toImageToolError frozen factories | yes (70 lines) | yes | imported + tested | N/A (logic) | VERIFIED |
| `src/image/providers/openai.ts` | createOpenAiImageClient (generate/edit/variations) with b64_json | yes (430 lines) | yes | imported by daemon.ts:124 + tests | lazy env read; fetch to /v1/images/*; 12 tests | VERIFIED |
| `src/image/providers/minimax.ts` | createMiniMaxImageClient (generate only; edit/variations unsupported) | yes (301 lines) | yes | imported by daemon.ts:125 + tests | hosted-URL fetch with auth; 9 tests | VERIFIED |
| `src/image/providers/fal.ts` | createFalImageClient (generate + edit; variations unsupported) | yes (359 lines) | yes | imported by daemon.ts:126 + tests | `Key <token>` auth distinct from Bearer; 10 tests | VERIFIED |
| `src/image/workspace.ts` | writeImageToWorkspace atomic .tmp + rename(2) | yes (69 lines) | yes | imported by daemon-handler + tools | mkdir -p + writeFile(tmp) + rename; 7 tests | VERIFIED |
| `src/image/costs.ts` | IMAGE_PRICING + estimateImageCost + recordImageUsage | yes (121 lines) | yes | imported by daemon-handler + tools | calls tracker.record with category='image'; 10 tests | VERIFIED |
| `src/image/tools.ts` | imageGenerate/imageEdit/imageVariations pure DI handlers + TOOL_DEFINITIONS | yes (589 lines) | yes | imported by daemon-handler + mcp-server | dispatches providers[backend] + writeImage + recordCost; 27 tests | VERIFIED |
| `src/image/daemon-handler.ts` | handleImageToolCall pure dispatcher + ImageDaemonHandlerDeps | yes (202 lines) | yes | imported by daemon.ts:123 | usageTrackerLookup callback; 10 D tests | VERIFIED |
| `src/image/mcp-server.ts` | createImageMcpServer + startImageMcpServer + __testOnly exports | yes (202 lines) | yes | imported by image-mcp CLI via dynamic import | 11 M/MR tests | VERIFIED |
| `src/cli/commands/image-mcp.ts` | registerImageMcpCommand Commander subcommand | yes (32 lines) | yes | invoked by cli/index.ts:155 | dynamic-import startImageMcpServer | VERIFIED |
| `src/config/schema.ts` | imageConfigSchema under defaults.image with locked union | modified (~82 lines added, schema.ts:539-610,720) | yes | parsed by loader.ts | defaults.image resolves to full config | VERIFIED |
| `src/ipc/types.ts` | IpcImageToolCallParams + IpcImageToolCallResult | modified (~38 lines added at :92-114) | yes | imported by daemon.ts + handler | typed IPC boundary | VERIFIED |
| `src/ipc/protocol.ts` | 'image-tool-call' appended to IPC_METHODS tuple | modified (:100) | yes | enforced by protocol test | method registration | VERIFIED |
| `src/config/loader.ts` | image auto-inject block (after search, ~:134) | modified (:125-141) | yes | executed per-agent in resolveAgentConfig | 5 resolvedMcpMap.set calls in order clawcode→1password→browser→search→image | VERIFIED |
| `src/manager/daemon.ts` | provider clients at :1072-1076; IPC intercept at :1149-1159 | modified (imports :123-128; step 9e; IPC handler) | yes | BEFORE routeMethod; 5 source-grep tests | closes over imageCfg + imageProviders + usageTrackerLookup | VERIFIED |
| `src/usage/tracker.ts` | idempotent ALTER TABLE × 3 (category/backend/count) + getCostsByCategory | modified (:191-193, :200-212, :156-178) | yes | record() persists category; SELECT includes category | tracker.test.ts 7 cases | VERIFIED |
| `src/cli/commands/costs.ts` | formatCostsTable with Category column between Agent and Model | modified (:25-33) | yes | renders from tracker rows | back-compat null/undefined → 'tokens'; 5 CT tests | VERIFIED |
| `scripts/image-smoke.mjs` | zero-dep Node ESM E2E smoke | yes (211 lines, executable, #!/usr/bin/env node) | yes | inline JSON-RPC client | `node --check` SYNTAX OK; daemon-down exit 2 verified | VERIFIED |
| `README.md` | Image Generation (Phase 72) section + MCP Servers table row | modified (:231, :570+) | yes | user-facing docs | full tool reference + backend matrix + cost snippet | VERIFIED |

**Artifacts Summary:** 20/20 artifacts pass all applicable verification levels.

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `src/config/loader.ts:resolveAgentConfig` | auto-injected `image` MCP entry | `resolvedMcpMap.set("image", {command, args, env})` | WIRED | loader.ts:134-139 |
| `src/cli/index.ts` | `registerImageMcpCommand` | `registerImageMcpCommand(program)` | WIRED | cli/index.ts:28 import + :155 invocation |
| `src/cli/commands/image-mcp.ts` | `src/image/mcp-server.ts:startImageMcpServer` | dynamic import on .action() | WIRED | image-mcp.ts:28 `const { startImageMcpServer } = await import("../../image/mcp-server.js")` |
| `src/image/mcp-server.ts` buildHandler | daemon via `sendIpcRequest(SOCKET, 'image-tool-call', ...)` | IPC roundtrip | WIRED | mcp-server.ts buildHandler; 9 M tests mock sendIpc |
| `src/manager/daemon.ts` handler | `src/image/daemon-handler.ts:handleImageToolCall` | intercepted BEFORE routeMethod; closure captures imageCfg, providers, usageTrackerLookup | WIRED | daemon.ts:1149-1159 |
| `src/image/daemon-handler.ts` | `imageGenerate` / `imageEdit` / `imageVariations` | switch on toolName → pure handler with ImageToolDeps | WIRED | daemon-handler.ts dispatches; D3-D5 tests pin each branch |
| `src/image/tools.ts:imageGenerate` | `src/image/providers/{openai,minimax,fal}.ts` | `deps.providers[backend].generate(args)` | WIRED | tools.ts:258,380,485 |
| `src/image/tools.ts:imageGenerate` | `src/image/workspace.ts:writeImageToWorkspace` | `deps.writeImage(workspace, subdir, bytes, ext)` | WIRED | tools.ts:164 |
| `src/image/tools.ts:imageGenerate` | `src/image/costs.ts:recordImageUsage` | `deps.recordCost(event)` → `recordImageUsage(tracker, event)` in daemon-handler | WIRED | tools.ts:203 |
| `src/image/costs.ts:recordImageUsage` | `src/usage/tracker.ts:UsageTracker.record` | `tracker.record({category: 'image', ...})` | WIRED | costs.ts:107-120 with category: "image" literal |
| `src/config/schema.ts:defaultsSchema` | `src/config/schema.ts:imageConfigSchema` | `image: imageConfigSchema` | WIRED | schema.ts:720 |
| `src/cli/commands/costs.ts` | `UsageTracker.getCostsByAgentModel` → Category column | daemon IPC 'costs' → tracker rows include category → formatCostsTable reads `r.category ?? "tokens"` | WIRED | tracker.ts:243 SELECT category; costs.ts:29 |

**Key Links Summary:** 12/12 links wired.

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `src/image/tools.ts:imageGenerate` | `images[]` | `provider.generate()` returns bytes; `writeImage()` persists to disk and returns path; `recordCost()` commits to SQLite | yes — bytes flow from provider response → atomic .tmp+rename → absolute path → cost row | FLOWING |
| `src/image/daemon-handler.ts` | `toolDeps.recordCost` | closure over `deps.usageTrackerLookup(agent)` — no-op when undefined, calls `recordImageUsage(tracker, event)` when present | yes — D9/D10 tests pin both branches; no static stub | FLOWING |
| `src/cli/commands/costs.ts:formatCostsTable` | `rows` | daemon IPC 'costs' → `tracker.getCostsByAgentModel` → SELECT agent, model, category, SUM(tokens_in/out/cost_usd) | yes — rows.category flows from SELECT to the rendered Category column | FLOWING |
| `src/manager/daemon.ts` step 9e | `imageProviders` | `createOpenAiImageClient(imageCfg)` + 2 siblings at boot; each returned provider is a factory-closed `{generate, edit, variations}` with lazy env reads | yes — factories are zero-cost; real network calls happen inside provider methods on first invocation | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Image tests pass (8 files, 94 tests) | `npx vitest run src/image` | `Test Files 8 passed (8) / Tests 94 passed (94)` in 3.74s | PASS |
| Phase 72 wiring tests pass (7 files, 207 tests) | `npx vitest run src/ipc/__tests__/image-tool-call.test.ts src/ipc/__tests__/protocol.test.ts src/config/__tests__/loader.test.ts src/manager/__tests__/daemon-warmup-probe.test.ts src/cli/commands/costs.test.ts src/usage/__tests__/tracker.test.ts src/config/__tests__/schema.test.ts` | `Test Files 7 passed (7) / Tests 207 passed (207)` in 4.88s | PASS |
| Smoke script syntax | `node --check scripts/image-smoke.mjs` | SYNTAX_OK | PASS |
| Smoke script daemon-down branch | `CLAWCODE_SOCKET_PATH=/tmp/nonexistent.sock timeout 5 node scripts/image-smoke.mjs` | `daemon not running — start with \`clawcode start-all\` first` + exit 2 | PASS |
| Phase 72 commits present | `git log --oneline` | 7 commits: 9633e15, c813953, 157d9af, 60adf55, 11c57a3, d03c7eb, 0ee1f67 | PASS |
| Non-regression: no changes to Discord/TurnDispatcher/SLO/package.json | `git diff --stat HEAD~7 HEAD -- package.json package-lock.json src/discord/ src/manager/turn-dispatcher.ts src/manager/session-adapter.ts src/mcp/server.ts src/mcp/tool-cache.ts src/performance/` | empty diff (zero changes) | PASS |
| Live image_generate → PNG on disk → Discord attachment | Requires live daemon + OPENAI_API_KEY | N/A | SKIP (routed to human verification) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| IMAGE-01 | 72-01, 72-02 | Agent can call `image_generate` with prompt + optional params, select backend per-agent, receive workspace-persisted path | SATISFIED | Plan 01 tools.ts:imageGenerate + workspace.ts + providers/openai.ts (+minimax/fal); Plan 02 daemon-handler + mcp-server + auto-inject + smoke; 94 image tests + 10 D tests + 11 M tests pass; live E2E routed to human UAT |
| IMAGE-02 | 72-01, 72-02 | Agent can call `image_edit` and receive a new image; backends without edit support return `unsupported_operation` naming supporting backends | SATISFIED | providers/minimax.ts edit() returns frozen `unsupported_operation` with message "Backends with edit support: openai, fal."; providers/fal.ts edit() uses flux/dev/image-to-image; E1-E6 + M3 tests green |
| IMAGE-03 | 72-02 | Agent delivers generated image to Discord by calling existing `send_attachment` with the workspace path — no new delivery surface | SATISFIED (composition) + NEEDS HUMAN (E2E) | `src/mcp/server.ts:54,561-563` send_attachment untouched (git diff confirms); `image_generate` returns absolute path; auto-inject puts both `image` and `clawcode` (send_attachment) in every agent's tool set; live Discord UAT routed to human |
| IMAGE-04 | 72-01, 72-02 | Operator can budget/observe per-agent image spend in `clawcode costs` with new cost category alongside tokens | SATISFIED | tracker.ts category column + ALTER TABLE x3 idempotent migration; recordImageUsage stamps category='image' + composite model; costs.ts formatCostsTable Category column; 5 CT tests + 5 tracker tests pin the shape; live DB check routed to human UAT |

**Requirements Coverage:** 4/4 satisfied via static + automated-test evidence; live E2E for IMAGE-01/03/04 routed to human UAT (standard deploy-gate step per 72-02-SUMMARY).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No TODO/FIXME/PLACEHOLDER in src/image/ | N/A | None |
| src/image/providers/ | — | No `throw` inside provider methods (never-throw discipline) | N/A | Confirmed clean |
| src/image/tools.ts | — | No `throw` inside handler bodies | N/A | Confirmed clean |

**Anti-patterns:** None found.

### Human Verification Required

#### 1. Live daemon E2E smoke

**Test:** Start daemon (`clawcode start-all`) with `OPENAI_API_KEY` set in env, then run:
```
node scripts/image-smoke.mjs clawdy "a cat in a tophat"
```
**Expected:** Exit 0 with `SMOKE PASS — image written to /<agent-workspace>/generated-images/<ts>-<id>.png (<bytes> bytes, cost 4¢)`; the PNG file exists on disk with bytes > 0.
**Why human:** Requires live daemon + real OPENAI_API_KEY + real ~4¢ spend. All static wiring verified (imports, IPC method, auto-inject, daemon client construction, interceptor order, provider lazy-env, atomic writer).

#### 2. IMAGE-03 Discord delivery (composition)

**Test:** Ask Clawdy in Discord: "generate a cat in a tophat and post it here". Observe Clawdy's tool calls.
**Expected:** Clawdy calls `image_generate("a cat in a tophat")` → receives `{images: [{path, ...}]}` → calls `send_attachment(channel, path)` → image appears as a Discord attachment in the channel.
**Why human:** Requires live Discord bot, live agent reasoning about composition, and a real image call. Static verification confirms `send_attachment` is still registered in `src/mcp/server.ts` (git diff confirms untouched) and that `image_generate` returns an absolute workspace path compatible with `send_attachment`.

#### 3. IMAGE-04 CLI cost breakdown (live DB)

**Test:** After at least one successful `image_generate` call and at least one successful token-generating turn, run:
```
clawcode costs --period today
```
**Expected:** Table shows `Agent | Category | Model | Tokens In | Tokens Out | Cost (USD)`; image rows show `category='image'`, `model='openai:gpt-image-1'` (or whichever backend was used), `tokens_in=0`, `tokens_out=0`, and a non-zero cost in cents.
**Why human:** Requires real DB with both token and image rows. Static verification confirms `formatCostsTable` renders the Category column (costs.ts:25-33), the DB schema has the category column (tracker.ts:191-193), and `recordImageUsage` stamps `category: "image"` (costs.ts:117). All pieces wired.

### Gaps Summary

No blocking gaps. All 11 observable truths map to concrete verified artifacts. 3 items routed to human UAT per standard deploy-gate practice (summary lists them explicitly in "Deploy-Gate Follow-Up"). Static verification + 301 passing targeted tests + non-regression diff + smoke script daemon-down branch all pass.

---

**Artifacts proven by static verification (Level 1-4):**

- 8 source files in `src/image/` (types, errors, workspace, costs, tools, daemon-handler, mcp-server, providers/{openai,minimax,fal}) — all substantive (69-589 lines), all imported + exported correctly
- 8 test files in `src/image/__tests__/` covering 94 tests — all green
- 4 wiring tests (ipc/image-tool-call 10 cases, image/mcp-server 11 cases, daemon-warmup-probe 5 G-cases, costs 5 CT-cases) — all green
- `src/cli/commands/image-mcp.ts` (CLI subcommand, 32 lines) + registered in `src/cli/index.ts`
- `src/config/loader.ts` auto-inject block, order: clawcode → 1password → browser → search → image
- `src/manager/daemon.ts` step 9e (clients at boot) + IPC intercept BEFORE routeMethod
- `src/cli/commands/costs.ts` Category column between Agent and Model
- `src/usage/tracker.ts` idempotent ALTER TABLE × 3 + getCostsByCategory
- `src/ipc/protocol.ts` IPC_METHODS + `src/ipc/types.ts` IpcImageToolCallParams/Result
- `scripts/image-smoke.mjs` zero-dep Node ESM E2E smoke (syntax OK, daemon-down exit 2 verified)
- `README.md` Image Generation (Phase 72) section + MCP Servers table row

**Non-regression evidence:**

- `git diff --stat HEAD~7 HEAD -- package.json package-lock.json src/discord/ src/manager/turn-dispatcher.ts src/manager/session-adapter.ts src/mcp/server.ts src/mcp/tool-cache.ts src/performance/` → **empty** (zero changes)
- Zero new npm deps (native fetch + FormData + Blob)
- `send_attachment` in `src/mcp/server.ts:54,561-563` **unchanged** — IMAGE-03 composition is intact
- v1.7 SLO surface (src/performance/, src/mcp/tool-cache.ts, IDEMPOTENT_TOOL_DEFAULTS) untouched — image tools intentionally NOT added to idempotent whitelist (same prompt yields different images)

---

_Verified: 2026-04-18_
_Verifier: Claude (gsd-verifier)_
