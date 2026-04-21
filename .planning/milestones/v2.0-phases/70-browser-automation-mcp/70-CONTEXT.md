# Phase 70: Browser Automation MCP - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning
**Mode:** Auto (--auto) — decisions locked in milestone scoping, auto-confirmed

<domain>
## Phase Boundary

Deliver a new auto-injected MCP server that gives every agent the ability to drive a real headless Chromium via Playwright. Six core tools: `browser_navigate`, `browser_screenshot`, `browser_click`, `browser_fill`, `browser_extract`, `browser_wait_for`. Per-agent persistent profile dir under `<agent-workspace>/browser/` so cookies/sessions survive daemon restarts. Resident singleton warmed at daemon boot (parallel to v1.7 embedder pattern), with hard-fail health probe before agents are marked `running`.

Satisfies: **BROWSER-01, BROWSER-02, BROWSER-03, BROWSER-04, BROWSER-05, BROWSER-06**.

</domain>

<decisions>
## Implementation Decisions

### Stack & Engine

- **Playwright** — not raw CDP. `playwright-core` (no bundled browser) + `chromium` installed via `npx playwright install chromium --with-deps`. Playwright gives cross-browser API but we only target Chromium for v2.0.
- **Version pin:** `playwright@^1.50.0` (verify latest stable at install). Engine downloaded to `~/.cache/ms-playwright/` on first install.
- **Launch mode:** `chromium.launchPersistentContext(profileDir, {...})` — NOT `chromium.launch() + context`. Persistent context gives us the cookie/session survival requirement BROWSER-06 mandates without extra state-management code.
- **Headless:** `headless: "new"` (Playwright's recommended mode). Document override via config for debugging.

### Server Architecture (LOCKED per research)

- **Process model parallels existing `clawcode` MCP server:** a new `clawcode browser-mcp` CLI subcommand (Claude SDK spawns one per agent session). Each subprocess speaks stdio MCP back to the SDK and IPCs to the daemon for all actual browser work.
- **Daemon owns the singleton `BrowserManager`** — the shared Chromium process + all per-agent `BrowserContext`s live in the daemon. MCP subprocess is a thin translator: receives tool call via stdio → IPC to daemon → returns result via stdio.
- **Auto-injected** — add `browser` alongside `clawcode` and `1password` in `src/config/loader.ts` auto-inject block. Opt-out via `mcpServers: []`.
- **Why not in-daemon MCP?** The existing `clawcode` MCP is ALSO a subprocess — it's a `clawcode mcp` CLI command with stdio transport that talks back to the daemon via IPC. Phase 70 follows the same model for consistency.

### Singleton + Per-Agent Profiles (LOCKED per research)

- **Architecture:** ONE shared `chromium.launch()` browser process + per-agent `browser.newContext({ storageState })` with `indexedDB: true`. This is **Option 2** from 70-RESEARCH.md — `launchPersistentContext` cannot share a browser, so using `storageState` is the only way to get cross-restart cookie + localStorage + IndexedDB survival without spawning N Chromium processes. The tradeoff is `sessionStorage` is NOT persisted (sessionStorage is ephemeral by definition per web spec — no real loss).
- **State save cadence:** debounced 5s after any storage mutation + immediate save on daemon shutdown + immediate save on context close. State file at `${agentWorkspace}/browser/state.json` written atomically (temp-rename).
- **Warm at daemon boot** — pattern parallels v1.7 embedder (Phase 56). `src/browser/manager.ts` exposes `warmBrowser(): Promise<void>` called during daemon startup. Agents wait on the ready signal before `status: 'running'`.
- **Profile dir location:** `${agentWorkspace}/browser/` (e.g., `~/.clawcode/agents/clawdy/browser/`). `state.json` is written by `context.storageState({ path })` on save cadence above. Per-agent `downloads/` and `screenshots/` subdirs for ephemeral artifacts.
- **Lifecycle:** daemon boot → `warmBrowser()` launches shared Chromium + probe → per-agent contexts created lazily on first tool call (hydrated from `state.json` if exists) → daemon shutdown saves all contexts' `storageState`, closes contexts, closes browser with graceful timeout.

### Launch Options (LOCKED per research pitfalls)

- `args: ["--no-sandbox", "--disable-dev-shm-usage"]` — `--no-sandbox` because the `clawcode` systemd user is low-privilege (chromium sandbox requires root or setuid, neither of which we want); `--disable-dev-shm-usage` prevents `/dev/shm` exhaustion.
- `headless: "new"` (current Playwright flag; review if deprecated).
- `--only-shell` chromium install (not Chrome-for-Testing) to avoid the 20GB+ RSS bug per Playwright issue #38489.
- `executablePath`: let Playwright resolve from `~/.cache/ms-playwright/` (already installed on dev box).

### Tool Surface

Each tool is a standard MCP tool registered in the browser MCP server. Arguments/returns:

| Tool | Args | Returns |
|---|---|---|
| `browser_navigate` | `url: string, waitUntil?: "load"\|"domcontentloaded"\|"networkidle"` (default `"load"`), `timeoutMs?: number` (default 30000) | `{ url, title, status }` |
| `browser_screenshot` | `fullPage?: boolean` (default false), `savePath?: string` (default `<workspace>/screenshots/<timestamp>.png`) | `{ path, width, height, bytes }` + inline base64 if < 500KB for vision |
| `browser_click` | `selector: string, timeoutMs?: number` (default 10000) | `{ clicked: true, selector, newUrl? }` |
| `browser_fill` | `selector: string, value: string, timeoutMs?: number` | `{ filled: true, selector }` |
| `browser_extract` | `mode: "selector"\|"readability"`, `selector?: string` (required if mode=selector) | `{ text, html?, metadata? }` |
| `browser_wait_for` | `selector?: string, url?: string (regex), timeoutMs?: number` (default 10000) | `{ matched: true/false, elapsedMs }` |

**Error shape:** all tools return structured errors with `{ error: { type, message, selector?, timeout? } }` rather than throwing. Playwright timeouts become `type: "timeout"`, missing selectors become `type: "element_not_found"`.

### Readability Extraction

- Use `@mozilla/readability` + `jsdom` for article-mode extraction (mode=`"readability"`). Standard library choice for clean article text.
- Selector mode uses `locator.textContent()` + `locator.innerHTML()` directly.
- Extract metadata: `title`, `byline`, `publishedTime` (from meta tags) when available.

### Vision Integration (BROWSER-02)

- Screenshots are saved to disk AND returned inline as base64 if under 500KB (Claude vision size-friendly limit).
- For larger screenshots: return `path` only; agent uses `Read` tool on the path to ingest via vision in a follow-up turn.
- PNG format. `fullPage: true` captures beyond the viewport.

### Health Probe

- Daemon startup probe: launch Chromium, open `about:blank`, close context. If fails, daemon boot fails with clear error (Playwright not installed, missing system libs, etc.).
- Per-agent probe on first tool call: open a fresh context for the agent, load `about:blank`, close context. Cached probe result = "this agent's browser profile is sane."

### Config

New optional section under `defaults:` and overridable per-agent:

```yaml
browser:
  enabled: true                          # default: true (auto-inject MCP server)
  headless: "new"                        # default: "new" (chromium)
  warmOnBoot: true                       # default: true (block status:running until warm)
  navigationTimeoutMs: 30000             # default: 30s
  actionTimeoutMs: 10000                 # default: 10s (click/fill/wait)
  viewport:
    width: 1280                          # default: 1280
    height: 720                          # default: 720
  userAgent: null                        # default: null (Playwright default)
  maxScreenshotInlineBytes: 524288       # default: 512KB (inline base64 threshold)
```

### Non-Goals (carried from REQUIREMENTS.md out-of-scope)

- Download handlers (v2.x+)
- Multi-tab / tab management (v2.x+)
- PDF capture (v2.x+)
- File upload via browser (v2.x+)
- Cross-browser (firefox, webkit) — Chromium only for v2.0
- JavaScript evaluation (`page.evaluate`) — deferred, high-risk surface
- Frame/iframe navigation — deferred

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src/mcp/server.ts`** — reference auto-injected MCP server. Follow the same pattern: McpServer registration, tool definitions with Zod schemas, stdio transport.
- **Daemon MCP auto-injection** in `src/manager/daemon.ts` — look for `clawcode` and `1password` injection points; add `browser` alongside.
- **Embedder singleton pattern** in `src/memory/embeddings.ts` — model loaded once at daemon boot, resident across all agents. Apply same pattern to Playwright.
- **Workspace path resolution** via `resolvedAgent.workspace` — already handles `~/.clawcode/agents/<name>/` expansion.
- **ConcurrencyGate** (v1.7 Phase 55) — optional; browser operations within a single agent might benefit from serialization to prevent Chromium thrash.

### Established Patterns
- **Warm-path gate** (v1.7 Phase 56) — daemon waits for warm-path checks (SQLite, embedder) before marking `status: 'running'`. Browser warm-up joins this list.
- **Per-agent config overrides** via `ResolvedAgentConfig.browser?.*` — optional block; absence = use `defaults.browser`.
- **Auto-inject config** — follows the same "in-tree MCP server" pattern as `clawcode` and `1password`. No external npm-packaged MCP server.

### Integration Points
- **Daemon boot:** `startDaemon()` → add `warmBrowser()` call in step N (parallel to embedder warmup).
- **Agent MCP injection:** wherever `src/mcp/server.ts` is injected per-agent, add `src/browser/server.ts` alongside.
- **Config schema:** add `browserConfigSchema` to `src/config/schema.ts`.
- **Shutdown hook:** daemon shutdown must close browser contexts then the browser itself.

</code_context>

<specifics>
## Specific Ideas

- **Playwright install size** is ~300MB for Chromium. Document this clearly in README — users should expect first-run install delay.
- **Memory footprint** — one Chromium per daemon. Measure at scale (14 agents active) — if RSS exceeds reasonable budget, revisit per-agent Chromium processes in v2.1. Include a "resident memory at boot" note in the phase summary.
- **Smoke test** — headline E2E: Clawdy navigates to `https://example.com`, screenshots it, extracts body text, returns a description. Can run via the v1.9 OpenAI endpoint (just shipped in Phase 69) rather than round-tripping through Discord.
- **System deps** — Playwright needs system libraries (`libnss3`, `libatk1.0-0`, etc.) on Linux. Document in install script.

</specifics>

<deferred>
## Deferred Ideas

- JavaScript evaluation (`page.evaluate`) — high-risk, defer to a dedicated phase with sandboxing
- Multi-tab / tab management — v2.x
- File downloads — v2.x
- PDF capture — v2.x
- Multi-browser (Firefox, WebKit) — v2.x
- Frame/iframe navigation — v2.x
- Authenticated-site session sharing across agents — would violate workspace isolation
- Record/replay mode — v2.x

</deferred>
