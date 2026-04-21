# Phase 70: Browser Automation MCP — Research

**Researched:** 2026-04-18
**Domain:** Headless browser automation via Playwright + MCP tool surface
**Confidence:** HIGH (core Playwright mechanics, version pins, pitfalls) / MEDIUM (multi-agent memory footprint estimate, systemd lifecycle corners)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Stack & Engine**
- Playwright — NOT raw CDP. `playwright-core` (no bundled browser) + Chromium installed via `npx playwright install chromium --with-deps`.
- Version pin: `playwright@^1.50.0` (verify latest stable at install).
- Launch mode: `chromium.launchPersistentContext(profileDir, {...})` — NOT `chromium.launch() + context`. Persistent context for BROWSER-06 cookie/session survival.
- Headless: `headless: "new"`. Override via config for debugging.

**Server Architecture**
- New MCP server module at `src/browser/` — follows auto-injected pattern of `src/mcp/server.ts`.
- Auto-injected — registered alongside `clawcode` and `1password` in MCP server injection. Opt-out via `mcpServers: []`.
- NOT a separate process — runs as in-daemon MCP server via `@modelcontextprotocol/sdk` stdio transport. Chromium subprocess is managed internally by Playwright.

**Singleton + Per-Agent Profiles**
- One Chromium process per daemon — shared browser instance with per-agent `BrowserContext`. Profile dir per agent via `launchPersistentContext`.
- Warm at daemon boot — parallels v1.7 embedder (Phase 56). `src/browser/manager.ts` exposes `warmBrowser()`.
- Profile dir: `${agentWorkspace}/browser/` (e.g. `~/.clawcode/agents/clawdy/browser/`).
- Lifecycle: boot → `warmBrowser()` → per-agent contexts lazy on first tool call → shutdown tears down contexts + closes browser.

**Tool Surface** (exact schemas locked in CONTEXT.md)
- `browser_navigate(url, waitUntil?, timeoutMs?)` → `{ url, title, status }`
- `browser_screenshot(fullPage?, savePath?)` → `{ path, width, height, bytes }` + inline base64 if < 500KB
- `browser_click(selector, timeoutMs?)` → `{ clicked, selector, newUrl? }`
- `browser_fill(selector, value, timeoutMs?)` → `{ filled, selector }`
- `browser_extract(mode: "selector"|"readability", selector?)` → `{ text, html?, metadata? }`
- `browser_wait_for(selector?, url?, timeoutMs?)` → `{ matched, elapsedMs }`
- Error shape: `{ error: { type, message, selector?, timeout? } }`.

**Readability**: `@mozilla/readability` + `jsdom`. Selector mode uses `locator.textContent()`/`innerHTML()`.
**Vision (BROWSER-02)**: disk save + inline base64 under 500KB. PNG. `fullPage: true` captures beyond viewport.
**Health probe**: boot-time `about:blank` launch + close. Per-agent first-tool-call probe. Hard-fail on boot probe.
**Config**: new `defaults.browser` block (enabled, headless, warmOnBoot, navigationTimeoutMs, actionTimeoutMs, viewport, userAgent, maxScreenshotInlineBytes).

### Claude's Discretion

- Exact `browser_extract` metadata fields (byline, publishedTime presence-dependent).
- Per-agent context creation timing (lazy-on-first-call is CONTEXT.md intent — confirmed).
- Error `type` taxonomy exact strings (CONTEXT.md lists `timeout`, `element_not_found`; expand as needed).
- ConcurrencyGate integration for serializing per-agent browser operations (CONTEXT.md marks "optional").
- Screenshot PNG compression level / viewport rendering tweaks.
- Test fixture layout for integration suite.

### Deferred Ideas (OUT OF SCOPE)

- JavaScript evaluation (`page.evaluate`) — high-risk, dedicated phase with sandboxing later.
- Multi-tab / tab management — v2.x.
- File downloads — v2.x.
- PDF capture — v2.x.
- Multi-browser (Firefox, WebKit) — Chromium only for v2.0.
- Frame/iframe navigation — v2.x.
- Authenticated-site session sharing across agents (violates workspace isolation).
- Record/replay mode — v2.x.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BROWSER-01 | `browser_navigate(url)` returns page-loaded signal + URL/title | Playwright `page.goto(url, { waitUntil })` returns `Response`; read `page.url()` + `page.title()` post-navigation. `waitUntil: "load"` as default per §Architecture. |
| BROWSER-02 | `browser_screenshot` saved to workspace + Claude-vision-ingestable | Playwright `page.screenshot({ fullPage, path, type: "png" })`. MCP image content: `{ type: "image", data: base64, mimeType: "image/png" }`. 500KB inline threshold keeps under API 5MB cap while avoiding conversation-history bloat (see Pitfall 7). |
| BROWSER-03 | `browser_click` / `browser_fill` + observe resulting page state | Playwright `locator.click()` / `locator.fill()` auto-wait for actionable. Capture `page.url()` after click to detect navigation (BROWSER-03 "observe resulting page state"). Use `getByRole()` / `getByTestId()` / CSS mix — selectors caller-supplied, tool is pass-through. |
| BROWSER-04 | `browser_extract` — selector or Readability "main content" mode | `@mozilla/readability@0.6.0` + `jsdom@29.0.2`. Parse `page.content()` (full rendered HTML) through readability. Selector mode: `locator.textContent()` / `innerHTML()`. |
| BROWSER-05 | `browser_wait_for` — selector / URL / timeout with clear failure | Playwright `locator.waitFor({ state: "visible", timeout })` + `page.waitForURL(regex, { timeout })`. TimeoutError → structured `{ error: { type: "timeout" } }` return (no throw). |
| BROWSER-06 | Per-agent persistent profile + daemon-boot warm singleton + health probe | `chromium.launchPersistentContext(userDataDir, options)` handles cookie/localStorage/IndexedDB survival automatically. Boot-time `about:blank` probe catches missing system libs + sandbox failures. ⚠ See Open Question #1 — "shared singleton" architecture is impossible; plan must resolve. |

</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **TypeScript strict, ESM-only, `.js` import extensions** (project uses `"type": "module"`).
- **Immutability**: never mutate — return new objects. Freeze config/result shapes. See `coding-style.md`.
- **Small files**: 200-400 lines typical, 800 max. Split `browser/manager.ts`, `browser/tools/*.ts` (one file per tool), `browser/readability.ts`, `browser/server.ts`.
- **Input validation at boundaries**: all MCP tool args validated via Zod (mirrors `src/mcp/server.ts` pattern).
- **Error handling**: no silent swallowing; structured `{ error: {...} }` returns per CONTEXT.md; log detailed errors via `pino`.
- **No secrets in code**: no API keys in browser module (profile dirs contain cookies — workspace already gitignored).
- **Security rules**: user inputs (selectors, URLs) pass through to Playwright which handles sanitization — no shell injection risk. Still, log at info level which URLs/selectors are touched for audit.
- **GSD workflow**: all edits via GSD commands. This research is step 0.

## Summary

Phase 70 adds a browser-automation MCP surface to every agent via Playwright-over-stdio, mirroring the `src/mcp/server.ts` auto-injection pattern. Six tools (`browser_navigate|screenshot|click|fill|extract|wait_for`) wrap a resident Chromium warmed at daemon boot. The architecture is straightforward Playwright except for **one load-bearing finding that invalidates a CONTEXT.md assumption**: Playwright's `launchPersistentContext` cannot share a browser process across multiple `userDataDir` values. Every persistent context IS a separate browser process. The "one Chromium, 14 per-agent contexts" diagram in CONTEXT.md is not implementable as written.

Three resolution paths exist — pick one in planning, do NOT silently let this slide into code:

1. **One Chromium per agent, launched lazily** (true per-agent isolation + cookies survive restart — highest RAM cost, ~200–400MB per agent baseline; with 14 agents, 2.8–5.6GB RSS floor at full utilization).
2. **One shared Chromium (via `chromium.launch()`) + per-agent `browser.newContext({ storageState: <agent-dir>/state.json })`** — cheap memory, but cookies/localStorage saved via `context.storageState({ path })` explicitly on each change. Loses IndexedDB `sessionStorage` persistence. Lightest option.
3. **Hybrid — resident singleton Chromium + non-persistent per-agent contexts at boot, load/save `storageState` per-agent on demand** — best of both, but explicit save/load code to write.

Recommendation: **Option 2 (`storageState`)**. Matches BROWSER-06 ("cookies and sessions survive daemon restarts") at a fraction of the memory budget, aligns with the already-chosen "one Chromium singleton" invariant, and matches the v1.7 embedder-singleton spirit. IndexedDB is now captured by `storageState` as of Playwright ≥1.51 (opt-in via `indexedDB: true`) — covers the common auth-token and OAuth state cases. Document the `sessionStorage` gap in the phase summary.

**Primary recommendation:** Resolve Open Question #1 via Option 2 (shared `launch()` + per-agent `newContext({ storageState })`), pin `playwright-core@1.59.1` + install Chromium via `npx playwright install chromium --only-shell`, ship on Node 22 LTS, and gate `status: running` on the same warm-path check pattern used for the embedder.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `playwright-core` | 1.59.1 | Browser automation API | Same API as `playwright` package minus bundled browsers. Installing browsers selectively saves ~700MB vs. full `playwright` (which auto-downloads Firefox + WebKit we don't use). |
| `@playwright/browser-chromium` | 1.59.1 | Postinstall Chromium download | Tied to `playwright-core` version exactly — avoid `npx playwright install` ordering issues in systemd/CI. Auto-downloads only Chromium on `npm install`. |
| `@modelcontextprotocol/sdk` | (existing) | MCP server transport | Already a dep via `src/mcp/server.ts`. Use `McpServer` + `StdioServerTransport`. |
| `@mozilla/readability` | 0.6.0 | Article-mode extraction | De-facto standard (Firefox Reader Mode internals). 388K weekly downloads. Stable (last release ~1 year — not abandonment, just mature). |
| `jsdom` | 29.0.2 | DOM for readability in Node | Required dependency of `@mozilla/readability` in Node (readability needs a `Document`). Don't try to substitute `cheerio` — readability expects real DOM APIs. |
| `zod` | ^4.3.6 (existing) | Tool-arg validation | Already used across codebase; mirror `src/mcp/server.ts` schemas. |

### Supporting (already in project)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pino` | ^9 | Structured logging | Log browser operations at `info`/`debug` — every navigation, every tool call. |
| `nanoid` | ^5 | Screenshot filename IDs | `<timestamp>-<nanoid>.png` to avoid collisions when two tools fire same-millisecond. |
| `date-fns` | ^4 | Timestamp in screenshot path | Format `savePath` default as ISO-date directory tree (`screenshots/2026-04-18/...`). |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `playwright-core` + `@playwright/browser-chromium` | `playwright` | Pulls Firefox + WebKit binaries (~1.2GB total). We only use Chromium. Waste. |
| `playwright-core` + `@playwright/browser-chromium` | `playwright-chromium` (legacy package) | Deprecated in favor of `@playwright/browser-*` packages; older ecosystem. |
| `@mozilla/readability` | `@postlight/mercury-parser` | Unmaintained (2.2.1 last release; 4.7K weekly downloads vs. readability's 388K). |
| `@mozilla/readability` | `html-to-text` | Different job — strips HTML to plain text, not an article extractor. Doesn't identify main content. |
| `jsdom` | `linkedom` | Faster, lighter, but readability uses niche DOM APIs (`getBoundingClientRect`, etc.) that linkedom stubs incompletely. Stick with jsdom. |
| `chromium` channel (Chrome for Testing) | `chromium-headless-shell` (Playwright default) | `headless-shell` is 2-3x lighter, no X11/D-Bus deps, fits a server-side-only workload. Chrome for Testing can hit 20GB+ RSS per worker (documented bug #38489). **Use `--only-shell` on install and do NOT set `channel: "chrome"`.** |
| `chromium.launchPersistentContext(userDataDir)` per agent | `chromium.launch()` + `newContext({ storageState })` per agent | **Architectural blocker — see Open Question #1.** `launchPersistentContext` is one-browser-per-call. Storage-state path trades sessionStorage persistence for shared-singleton feasibility. |

**Installation:**
```bash
# Dependencies
npm install playwright-core@1.59.1 @playwright/browser-chromium@1.59.1 @mozilla/readability@0.6.0 jsdom@29.0.2

# Browser binary (runs postinstall of @playwright/browser-chromium OR explicit):
npx playwright install chromium --only-shell      # no sudo needed; downloads chromium-headless-shell
# On first setup only (once, needs sudo):
sudo npx playwright install-deps chromium          # system libs: libnss3, libatk1.0-0, libdrm2, libgbm1, libxkbcommon0, libxcomposite1, libxdamage1, libxrandr2, libxss1, libasound2
```

**Version verification (2026-04-18, via `npm view`):**

| Package | Current stable | Publish date |
|---------|----------------|--------------|
| `playwright-core` | 1.59.1 | 2026-04-03 (≈ 2 weeks ago) |
| `playwright` | 1.59.1 | same |
| `@playwright/browser-chromium` | 1.59.1 | same |
| `@mozilla/readability` | 0.6.0 | ≈ 1 year ago (stable mature library) |
| `jsdom` | 29.0.2 | 2026-04-09 (≈ 9 days ago) |

**Environment verification (target machine: local box):**

- Node 22.22.0 — ✅ supported
- `/dev/shm` → 8.1GB free — ✅ plenty for Chromium (avoid `--disable-dev-shm-usage`; only needed in Docker)
- `libnss3`, `libatk-1.0-0`, `libgbm`, `libdrm` all present in `/lib/x86_64-linux-gnu/` — ✅ install-deps already satisfied
- Playwright cache at `~/.cache/ms-playwright/chromium-1208` + `chromium_headless_shell-1208` — ✅ previously downloaded (but pin to 1.59.1's bundled version at install; delete stale 1208 if Playwright bumps revision)
- Running user: `jjagpal` (uid 1000), not root — ✅ sandbox will work without `--no-sandbox`

## Architecture Patterns

### Recommended Module Structure

```
src/browser/
├── manager.ts          # BrowserManager: warm() / getContext(agent) / close()
├── server.ts           # createBrowserMcpServer(deps) — mirrors src/mcp/server.ts
├── tools/
│   ├── navigate.ts     # one tool = one file (CLAUDE.md small-files rule)
│   ├── screenshot.ts
│   ├── click.ts
│   ├── fill.ts
│   ├── extract.ts
│   └── wait-for.ts
├── readability.ts      # parseArticle(html, url) → { text, byline?, ... }
├── health.ts           # probeBrowser(browser) → Promise<void> (throws on fail)
├── errors.ts           # BrowserError, TimeoutError, SelectorNotFoundError
├── storage-state.ts    # loadAgentState(agent) / saveAgentState(agent, state)
├── types.ts            # BrowserToolResult, AgentContextHandle
└── __tests__/
    ├── manager.test.ts
    ├── tools.integration.test.ts    # real Chromium + local fixture
    ├── readability.test.ts
    └── fixtures/
        ├── article.html
        ├── form.html
        └── spa.html
```

### Pattern 1: Lazy-per-agent Context with Singleton Browser (resolving Open Q #1 via Option 2)

**What:** One `Browser` instance lives in the daemon; on first browser-tool call for agent X, `BrowserManager.getContext("clawdy")` creates (or reuses a cached) `BrowserContext` with `storageState` loaded from `<workspace>/browser/state.json` (if exists). On context close (e.g. agent unload, daemon shutdown), `context.storageState({ path })` writes back.

**When to use:** Always, for this phase. Replaces the `launchPersistentContext(userDataDir)` plan that doesn't fit the "one Chromium, many agents" invariant.

**Example:**
```typescript
// Source: https://playwright.dev/docs/api/class-browsercontext#browser-context-storage-state
import { chromium, type Browser, type BrowserContext } from "playwright-core";
import { mkdir, access } from "node:fs/promises";
import { join } from "node:path";

export class BrowserManager {
  private browser: Browser | null = null;
  private readonly contexts = new Map<string, BrowserContext>();

  async warm(): Promise<void> {
    if (this.browser) return;
    this.browser = await chromium.launch({
      headless: true,
      args: [
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        // NOTE: do NOT add --no-sandbox unless running as root.
      ],
    });
    // Health probe — hard fail if sandbox/libs broken.
    const probeCtx = await this.browser.newContext();
    const probePage = await probeCtx.newPage();
    await probePage.goto("about:blank", { timeout: 5_000 });
    await probeCtx.close();
  }

  async getContext(agent: string, workspace: string): Promise<BrowserContext> {
    const cached = this.contexts.get(agent);
    if (cached) return cached;
    if (!this.browser) throw new BrowserError("browser not warmed");

    const stateDir = join(workspace, "browser");
    await mkdir(stateDir, { recursive: true });
    const statePath = join(stateDir, "state.json");

    const storageState = await this.readStateIfExists(statePath);
    const ctx = await this.browser.newContext({
      storageState,             // undefined on first run; loaded JSON on restart
      viewport: { width: 1280, height: 720 },
    });

    // Auto-persist on close.
    ctx.on("close", () => { /* no-op; save triggered explicitly below */ });

    this.contexts.set(agent, ctx);
    return ctx;
  }

  async saveAgentState(agent: string, workspace: string): Promise<void> {
    const ctx = this.contexts.get(agent);
    if (!ctx) return;
    const statePath = join(workspace, "browser", "state.json");
    await ctx.storageState({ path: statePath, indexedDB: true });
  }

  async close(): Promise<void> {
    for (const [, ctx] of this.contexts) {
      try { await ctx.close(); } catch { /* log + ignore */ }
    }
    this.contexts.clear();
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  private async readStateIfExists(path: string) {
    try { await access(path); return path; } catch { return undefined; }
  }
}
```

### Pattern 2: Health Probe (BROWSER-06)

**What:** Boot probe = launch + `about:blank` + close. First-agent-use probe = same, per-context. Both throw structured errors.

**Why `about:blank` is sufficient:** It exercises the full Playwright→CDP→Chromium IPC path without network. Sandbox failure, missing libs (`libnss3` missing → launch fails; `libgbm` missing → renderer crash), and broken profile dirs all surface.

**What it does NOT catch:** DNS/proxy misconfiguration (network test would — defer to a later monitoring phase), GPU-specific bugs (not relevant headless), font rendering issues (not relevant for screenshots-as-data).

### Pattern 3: MCP Tool Handler Shape (mirror `src/mcp/server.ts`)

```typescript
// Source: existing src/mcp/server.ts:229-262
server.tool(
  "browser_navigate",
  "Open a URL in your browser and wait for the page to load.",
  {
    url: z.string().url().describe("URL to navigate to"),
    waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).default("load"),
    timeoutMs: z.number().int().positive().default(30_000),
    agent: z.string().describe("Your agent name"),
  },
  async ({ url, waitUntil, timeoutMs, agent }) => {
    try {
      const ctx = await manager.getContext(agent, resolveWorkspace(agent));
      const page = await ctx.newPage();
      const response = await page.goto(url, { waitUntil, timeout: timeoutMs });
      const result = {
        url: page.url(),
        title: await page.title(),
        status: response?.status() ?? 0,
      };
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (err) {
      return structuredError(err, { url });
    }
  },
);
```

### Pattern 4: Screenshot Return (BROWSER-02)

- `type: "image"` content item with `data: <base64>` + `mimeType: "image/png"` — standard MCP SDK image content (see MCP spec 2025-11-25 Tools section).
- Threshold check: if `screenshot.length > maxScreenshotInlineBytes` (default 524288 = 512KB), return `type: "text"` with `path` only and mention Read tool.
- Always save to disk: disk path is authoritative; inline base64 is a convenience.
- Accumulation warning: each inline screenshot is replayed on every turn in Claude's conversation history. 10+ inline screenshots in a turn chain hit the 5MB-per-image / 20MB-per-request API cap (see Pitfall 7).

### Anti-Patterns to Avoid

- **❌ `launchPersistentContext` with shared browser** — impossible. See Open Q #1.
- **❌ `waitUntil: "networkidle"` as default** — Playwright docs explicitly discourage for pages with live polling/analytics; hangs on SPAs. Default `"load"` per CONTEXT.md is correct.
- **❌ `--no-sandbox` launch arg** — only needed when running as root. Our daemon runs as a user (`clawcode` per `reference_clawcode_server`), so sandbox works. Adding `--no-sandbox` unnecessarily is a security regression.
- **❌ CSS-class selectors in examples/docs** — brittle. Show `getByRole()` / `getByTestId()` / `getByText()` in tool descriptions to steer agents.
- **❌ Unbounded screenshot accumulation** — enforce `maxScreenshotInlineBytes` AND log when agent requests >5 screenshots in a single turn (soft warning, not block).
- **❌ `page.evaluate` or `page.addScriptTag`** — deferred. If agents need DOM inspection, they use `browser_extract` with selectors. No JS-eval surface on this phase.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Article extraction from HTML | Custom paragraph-finder + heuristics | `@mozilla/readability` | Powers Firefox Reader Mode; handles ads, nav, sidebars, syndication scripts. You will lose weeks reinventing this. |
| DOM in Node for readability | Regex HTML parser / `cheerio` | `jsdom` | Readability calls `Node.compareDocumentPosition`, `getBoundingClientRect`, etc. Cheerio doesn't implement these. |
| Cookie/localStorage persistence | Custom JSON serializer | `context.storageState({ path, indexedDB: true })` | Playwright already handles domain/path/httpOnly/sameSite correctly. Rolling your own serializer is a security bug factory. |
| Browser process lifecycle | `child_process.spawn("chromium", ...)` + CDP yourself | Playwright `chromium.launch()` | Playwright auto-retries launch, manages CDP websocket, handles renderer-crash recovery, cleans up zombie processes on SIGTERM. |
| Screenshot encoding | Buffer-to-base64 ad-hoc everywhere | Single `encodeScreenshot(buffer, threshold)` util in `src/browser/screenshot.ts` | DRY; one place to enforce inline threshold + image content envelope. |
| Retry/wait logic | `while(...){ await sleep(100) }` | Playwright `locator.waitFor()` / `page.waitForURL(regex)` / auto-wait | Playwright retries with smart backoff, integrates with page lifecycle, respects timeouts. |
| URL parsing/validation | Regex | `z.string().url()` (zod) + `new URL(...)` | Catches file://, javascript:, and other foot-guns at tool-arg layer. |

**Key insight:** Browser automation has ~15 years of "looks easy, is nightmarishly stateful" written into every corner of it. Playwright wraps nearly all of that. The browser MCP phase is mostly thin wrappers — anywhere you feel tempted to write >20 lines of low-level browser logic, stop and check what Playwright already does.

## Runtime State Inventory

> Phase 70 is net-new feature, not a rename/refactor. Section retained briefly for runtime state that DOES exist.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Per-agent `<workspace>/browser/state.json` (Playwright storageState JSON — cookies, localStorage, IndexedDB). Created on first write; read on context creation. | Code-edit only. Handle missing file (`ENOENT`) as "first run". |
| Live service config | None — browser is self-contained; no remote service registrations. | None. |
| OS-registered state | `~/.cache/ms-playwright/chromium-*` (Playwright browser cache, ~180MB for headless-shell). Shared across Node installs. | Document in install docs. `npx playwright install chromium --only-shell` populates it. |
| Secrets / env vars | `DEBUG=pw:*` env for Playwright tracing (opt-in). No secrets — browser does not hold API keys. Agent workspace `.env` files unchanged. | None. |
| Build artifacts / installed packages | `node_modules/@playwright/browser-chromium` + `node_modules/playwright-core` (both ~200MB combined incl. browser). `node_modules/@mozilla/readability` (~50KB). `node_modules/jsdom` (~3MB). | Standard `npm install`. If bumping Playwright version later, stale browser in `~/.cache/ms-playwright/chromium-<rev>/` should be pruned — Playwright's internal rev pin changes. |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js ≥22 | All phase code | ✅ | 22.22.0 | — |
| npm ≥10 | Install | ✅ | 10.9.4 | — |
| Chromium system libs (libnss3, libatk, libgbm, libdrm) | Headless Chromium | ✅ | Present in `/lib/x86_64-linux-gnu/` | `sudo npx playwright install-deps chromium` |
| `/dev/shm` ≥ 64MB free | Chromium shared memory | ✅ (8.1GB free) | tmpfs | `--disable-dev-shm-usage` (only if < 64MB; Docker deployments) |
| Non-root user | Chromium sandbox | ✅ (uid 1000) | `jjagpal` / `clawcode` on target | `--no-sandbox` (last resort; security regression) |
| Playwright browser binary | `chromium.launch()` | ✅ (cached, but pin to 1.59.1 bundled rev) | `~/.cache/ms-playwright/chromium_headless_shell-1208` | `npx playwright install chromium --only-shell` |
| Network egress (for `playwright install`) | First-time browser download | Assumed ✅ | — | Pre-download binary + bundle OR `PLAYWRIGHT_BROWSERS_PATH` env. |
| 300–500MB disk | Chromium install | ✅ | — | — |
| ~400–800MB RSS headroom per agent | Runtime RAM (per-agent contexts share one browser) | Measure in Plan 01 | — | — (must verify) |

**Missing dependencies with no fallback:** None on target machine.

**Missing dependencies with fallback:**
- Fresh Ubuntu/Debian install without `playwright install-deps` run — first-time setup needs sudo. Document in README + bootstrap script.

## Common Pitfalls

### Pitfall 1: `launchPersistentContext` cannot share a browser
**What goes wrong:** You code against the CONTEXT.md "one Chromium, N persistent contexts" model; on the 2nd call, Playwright launches a 2nd Chromium process (because `launchPersistentContext` IS the launch call — it cannot reuse an existing `Browser`). You now have N Chromium processes, not 1.
**Why it happens:** Playwright's API: *"browsers do not allow launching multiple instances with the same User Data Directory"*, and `launchPersistentContext` "launches browser … and returns the only context."
**How to avoid:** Use `chromium.launch()` + `browser.newContext({ storageState: <file> })` instead. See Open Question #1 for the 3 resolution paths.
**Warning signs:** `ps aux | grep chromium` shows N+ processes after N agent warm-ups; RSS grows linearly in agent count (400MB × 14 = 5.6GB).

### Pitfall 2: Running as root in a container triggers sandbox failure
**What goes wrong:** Deploy in Docker / root systemd — Chromium refuses to launch: `"Running as root without --no-sandbox is not supported"`. Adding `--no-sandbox` disables all security boundaries.
**Why it happens:** Chromium's user-namespace sandbox requires an unprivileged UID.
**How to avoid:** Daemon already runs as `clawcode` user (per `reference_clawcode_server.md`). Verify the systemd unit has `User=clawcode`. If containerizing later, `USER` directive in Dockerfile + `runuser` in entrypoint.
**Warning signs:** Boot probe fails with `Failed to launch the browser process! spawn ... ENOENT` or `/usr/bin/chromium: error while loading shared libraries`.

### Pitfall 3: `networkidle` default hangs on SPAs with live updates
**What goes wrong:** Agent calls `browser_navigate("https://linear.app/...", waitUntil: "networkidle")` and hits the 30s timeout because Linear polls for updates constantly.
**Why it happens:** `networkidle` waits for zero in-flight requests for 500ms. Polling/analytics breaks this.
**How to avoid:** Default is `"load"` per CONTEXT.md — keep it. Document in tool description that agents should choose `"domcontentloaded"` for SPAs and avoid `"networkidle"` except for static content.
**Warning signs:** Recurring 30s timeouts on popular SaaS URLs. Trace should show 10s+ wasted in `waitForLoadState("networkidle")`.

### Pitfall 4: Selectors brittle to DOM churn
**What goes wrong:** Agent uses `.css("div.btn-primary.mt-4")` → works once, fails next week when Tailwind class changes.
**Why it happens:** CSS classes are implementation details.
**How to avoid:** Tool descriptions should prefer `getByRole()`, `getByText()`, `getByTestId()`, and CSS only as fallback. Playwright locator is the caller's string — the tool just passes through — but the *description* shapes agent behavior.
**Warning signs:** `element_not_found` errors clustered on specific sites.

### Pitfall 5: Orphan Chromium on daemon crash / SIGKILL
**What goes wrong:** Daemon is `kill -9`ed; Chromium children stay alive, holding CPU + RAM + WebSocket ports, never cleaning `<workspace>/browser/`.
**Why it happens:** Playwright cleans up on SIGTERM/SIGINT but not SIGKILL. Child reparents to PID 1.
**How to avoid:**
- Wire `SIGTERM` and `SIGINT` in daemon to `BrowserManager.close()` with a 5s timeout.
- systemd unit: `KillMode=control-group` (default) + `TimeoutStopSec=10s` — ensures systemd sends SIGKILL to the cgroup after 10s, sweeping orphaned Chromium.
- On startup, check for stale `SingletonLock` files in each agent's profile dir (if Option 1 chosen) — if present and unreadable, delete.
**Warning signs:** `ps --ppid 1 | grep chromium` has entries after daemon restart.

### Pitfall 6: Install-deps requires sudo on first Linux setup
**What goes wrong:** User runs `npm install` → Playwright postinstall fails with "missing system libraries" because `install-deps` needs root.
**Why it happens:** `apt-get install libnss3 libatk...` requires root.
**How to avoid:**
- First-install script in repo (`scripts/bootstrap-browser.sh`) prints a clear message: "one-time: `sudo npx playwright install-deps chromium`".
- Runtime check in `warmBrowser()` catches the launch failure and prints the exact command.
- `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` during `npm install` in CI where libs may be absent; then run the install command explicitly in a "setup" step.
**Warning signs:** First `warm()` on a fresh VM throws `Error: Host system is missing dependencies to run browsers. Please install them with the following command: ... install-deps`.

### Pitfall 7: Inline-base64 screenshots accumulate in conversation history
**What goes wrong:** Agent takes 10 inline screenshots in a single turn. Each is ≤500KB, so per-call is fine, but conversation history re-sends all of them on every subsequent turn → 5+ MB of screenshots replayed every user message → 20MB request cap hit in ~4 turns.
**Why it happens:** Claude Code issue #43056 documents this: inline image blocks persist in session history.
**How to avoid:**
- Default threshold 512KB is correct.
- Log a soft warning when an agent takes >3 inline screenshots in one turn; suggest `fullPage: false` or `savePath` + file-reference flow.
- In tool description for `browser_screenshot`, guide the agent: "For repeated screenshots in one task, rely on the returned `path` — Claude can Read them on demand."
**Warning signs:** `Request too large (max 20MB)` errors later in long sessions.

### Pitfall 8: Persistent context lock collision on restart
**What goes wrong:** Daemon crashes, new daemon starts, calls `launchPersistentContext(dir)` — Chromium fails because prior `SingletonLock` / `SingletonSocket` files in the userDataDir are stale.
**Why it happens:** Chromium uses profile lock files for single-instance enforcement.
**How to avoid:** Option 2 (`storageState`) sidesteps this entirely — no userDataDir means no lock files. If Option 1 is picked, the warm path must check and clean stale lock files on startup (older than 1 minute = assume stale; delete).
**Warning signs:** `SingletonLock: File exists` error in Chromium stderr on warm().

### Pitfall 9: First-time Chromium install behind a proxy
**What goes wrong:** `npx playwright install chromium` fails on corporate networks because Playwright binary CDN isn't reachable.
**Why it happens:** Default download from playwright CDN.
**How to avoid:** Document env vars: `HTTPS_PROXY`, `PLAYWRIGHT_DOWNLOAD_HOST`, or `PLAYWRIGHT_BROWSERS_PATH=0` (bundle binary at package level).
**Warning signs:** Boot fails on install step with socket timeout.

### Pitfall 10: `storageState` write-during-close race
**What goes wrong:** Daemon shutdown: `context.close()` races with a final `context.storageState({ path })` call → partial JSON written to `state.json` → next boot fails to parse it.
**Why it happens:** Playwright close path is async; if save is fired inside `on("close")`, the context is already disposed.
**How to avoid:** Save state BEFORE close. Save order on shutdown: (1) stop accepting new tool calls, (2) for each agent: `saveAgentState(agent)`, (3) `close()` all contexts, (4) `browser.close()`. Atomic write: write to `state.json.tmp`, rename. Skip parse errors silently on next boot (treat as first-run).
**Warning signs:** Zero-byte `state.json` after ungraceful shutdown.

## Code Examples

### Boot warm + probe

```typescript
// Source: playwright-core 1.59 + project pattern (src/memory/embedder.ts:67-80)
import { chromium, type Browser } from "playwright-core";
import { logger } from "../shared/logger.js";

export class BrowserManager {
  private browser: Browser | null = null;
  private warmPromise: Promise<void> | null = null;

  async warm(): Promise<void> {
    if (this.browser) return;
    if (this.warmPromise) return this.warmPromise;
    this.warmPromise = this.doWarm();
    try { return await this.warmPromise; }
    catch { this.warmPromise = null; throw; }
  }

  private async doWarm(): Promise<void> {
    const t0 = performance.now();
    this.browser = await chromium.launch({ headless: true });
    // Probe: hard fail on libs / sandbox / crash.
    const ctx = await this.browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.goto("about:blank", { timeout: 5_000 });
    } finally {
      await ctx.close();
    }
    logger.info({ durationMs: performance.now() - t0 }, "browser warm+probe ok");
  }
}
```

### Navigate + read result (BROWSER-01)

```typescript
// Source: https://playwright.dev/docs/api/class-page#page-goto
import type { BrowserContext } from "playwright-core";

export async function doNavigate(ctx: BrowserContext, args: {
  url: string; waitUntil: "load"|"domcontentloaded"|"networkidle"; timeoutMs: number;
}) {
  const page = await ctx.newPage();
  try {
    const response = await page.goto(args.url, {
      waitUntil: args.waitUntil,
      timeout: args.timeoutMs,
    });
    return Object.freeze({
      url: page.url(),
      title: await page.title(),
      status: response?.status() ?? 0,
    });
  } finally {
    await page.close();
  }
}
```

### Readability extraction (BROWSER-04)

```typescript
// Source: https://github.com/mozilla/readability#usage + @mozilla/readability 0.6.0 README
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

export function parseArticle(html: string, baseUrl: string): {
  text: string; title: string | null; byline: string | null; html: string;
} | null {
  const dom = new JSDOM(html, { url: baseUrl });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  if (!article) return null;
  return Object.freeze({
    text: article.textContent ?? "",
    title: article.title ?? null,
    byline: article.byline ?? null,
    html: article.content ?? "",
  });
}
```

### Screenshot with inline-threshold envelope (BROWSER-02)

```typescript
// Source: MCP spec 2025-11-25 Tools Image content + https://playwright.dev/docs/api/class-page#page-screenshot
import type { BrowserContext } from "playwright-core";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const MAX_INLINE_BYTES = 524_288; // 512KB default

export async function doScreenshot(ctx: BrowserContext, args: {
  fullPage: boolean; savePath: string;
}) {
  const page = ctx.pages()[0] ?? await ctx.newPage();
  const buf = await page.screenshot({ fullPage: args.fullPage, type: "png" });
  await mkdir(dirname(args.savePath), { recursive: true });
  await writeFile(args.savePath, buf);

  const meta = { path: args.savePath, bytes: buf.length, width: 0, height: 0 };
  // Size info via page.viewportSize() if !fullPage; else via image decode (defer; use 0 for v2.0).

  if (buf.length <= MAX_INLINE_BYTES) {
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(meta) },
        { type: "image" as const, data: buf.toString("base64"), mimeType: "image/png" },
      ],
    };
  }
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ ...meta, note: "Screenshot too large to inline; use Read tool on the path." }) }],
  };
}
```

### storageState load/save

```typescript
// Source: https://playwright.dev/docs/auth#reuse-signed-in-state
import { access, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function stateFilePath(workspace: string): Promise<string> {
  return join(workspace, "browser", "state.json");
}

export async function loadState(path: string): Promise<string | undefined> {
  try { await access(path); return path; } catch { return undefined; }
}

export async function saveState(ctx: import("playwright-core").BrowserContext, path: string) {
  const tmp = `${path}.tmp`;
  await ctx.storageState({ path: tmp, indexedDB: true });
  await rename(tmp, path);   // atomic on same filesystem
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `playwright` package for Chromium-only deploys | `playwright-core` + `@playwright/browser-chromium` | 1.36+ (2023) made `@playwright/browser-*` packages stable | Smaller install (~300MB vs ~1.2GB), faster CI |
| Headful Chromium in CI | `chromium-headless-shell` | 1.49 (2024) — new lightweight shell | 40% less RSS vs. Chrome for Testing; new-headless-mode renders identically |
| Custom CDP scripts | Playwright API | n/a | CDP direct use is now a niche for edge cases; Playwright covers 99% |
| `@xenova/transformers` (you'd use for embeddings) | `@huggingface/transformers` | already adopted in project | — (not browser phase; noted for consistency) |
| `page.waitForLoadState("networkidle")` | web assertions (`expect(locator).toBeVisible()`) | 1.40+ official discouragement | Our tool surface doesn't include web-assertions; agents explicitly wait via `browser_wait_for`. Default `load` waitUntil is the sane pick. |
| CSS selectors | Role selectors (`getByRole`) | 1.27+ | Cross-site robustness. Shape our tool descriptions to prefer role/text/testid. |
| `storageState` without IndexedDB | `storageState({ indexedDB: true })` | 1.51+ | Captures more session data; closes a gap vs. persistent context. |

**Deprecated / outdated:**
- `playwright-chromium` package — legacy, use `playwright-core` + `@playwright/browser-chromium`.
- `@postlight/mercury-parser` — abandoned; use `@mozilla/readability`.
- `sqlite-vss` (mentioned for awareness) — not relevant here; use `sqlite-vec` in other phases.

## Open Questions

### 1. **Singleton browser + N `launchPersistentContext` calls is architecturally impossible — pick a resolution path**

- **What we know:** CONTEXT.md locks "one Chromium per daemon — shared browser instance with per-agent `BrowserContext` via `launchPersistentContext`." Playwright docs: *"browsers do not allow launching multiple instances with the same User Data Directory"* AND `launchPersistentContext` itself launches a new browser process (does not reuse an existing `Browser`). These two constraints cannot both be true simultaneously.
- **What's unclear:** Which resolution path the user picked implicitly — CONTEXT.md is internally contradictory.
- **Recommendation:**
  - **Option 2 (recommended):** `chromium.launch()` + per-agent `newContext({ storageState: <workspace>/browser/state.json })`. Lowest memory, matches "one Chromium" invariant. Lose `sessionStorage` persistence (acceptable — ephemeral by definition), keep cookies / localStorage / IndexedDB. Re-word BROWSER-06 in the plan as "cookies + localStorage + IndexedDB survive restart."
  - **Option 1 (fallback):** One Chromium per agent via `launchPersistentContext`. True persistent profile including sessionStorage. ~14× memory cost; maps cleanly to BROWSER-06 "persistent profile dir" phrasing.
  - **Option 3 (hybrid, most work):** `launch()` + `newContext()` + manual save/load of a custom state bundle. Not worth the code — Playwright's `storageState({ indexedDB: true })` already does this.
- **Planner action:** Insert Plan 00 task "resolve shared-browser architecture" → pick Option 2 unless user overrides → update CONTEXT.md post-hoc to reflect the actual implementation.

### 2. **Memory footprint for 14 concurrent per-agent contexts — measurement, not assumption**

- **What we know:** Chromium RSS varies 150MB–400MB baseline per context. Headless-shell is ~40% lighter than Chrome-for-Testing. With Option 2 (shared browser), per-agent context cost is ~50–150MB in our usage (mostly renderer when a page is open). With Option 1 (per-agent process), add ~300MB baseline per agent.
- **What's unclear:** Real-world RSS with 14 active contexts + modest page complexity. STATE.md blockers explicitly call this out: *"Playwright warm-singleton memory footprint unknown."*
- **Recommendation:**
  - Add explicit measurement task in Plan 01: warm + 14 concurrent `about:blank` contexts + 14 real-page loads (`https://example.com`), record RSS via `process.memoryUsage()` + `ps -o rss -p <chromium-pid>`.
  - Include dashboard metric: browser-manager RSS reported to existing dashboard. Reuse v1.8 trace store if possible.
  - Define budget: if total browser subsystem > 3GB RSS with 14 agents active, revisit Option 1 / deferred per-agent Chromium plan.

### 3. **Does the browser MCP server run in-daemon or subprocess?**

- **What we know:** CONTEXT.md says "runs as in-daemon MCP server." But the existing `clawcode` MCP server ACTUALLY runs as a child process spawned by the Claude SDK per agent, invoking `clawcode mcp` (CLI subcommand) which starts a `StdioServerTransport` and talks back to the daemon via `SOCKET_PATH` IPC (`src/ipc/client.ts`). That is the "auto-injected" pattern to mirror.
- **What's unclear:** Whether CONTEXT.md author meant "same pattern as clawcode — mcp server in the clawcode binary, spawned per agent" (most likely) OR "literally inside the daemon process, shared transport" (impossible per-agent with stdio).
- **Recommendation:** Follow the `clawcode mcp` subcommand pattern: new `clawcode browser-mcp` CLI subcommand in `src/cli/commands/browser-mcp.ts` → calls `startBrowserMcpServer()` → `StdioServerTransport` → tool handlers that call `sendIpcRequest(SOCKET_PATH, "browser-*", ...)` to delegate to the singleton Chromium living in the daemon. Register in `src/config/loader.ts` alongside `clawcode` auto-inject:
  ```typescript
  if (!resolvedMcpMap.has("browser")) {
    resolvedMcpMap.set("browser", {
      name: "browser", command: "clawcode", args: ["browser-mcp"], env: {},
    });
  }
  ```
  This keeps the singleton semantics: the daemon owns Chromium; per-agent MCP servers are thin IPC clients.

### 4. **When to save `storageState`?**

- **What we know:** Needs to happen before daemon shutdown AND periodically if daemon runs long.
- **What's unclear:** Per-tool-call? Per-turn? Debounced?
- **Recommendation:** Debounced save (5-second debounce) on context events (`page.on("framenavigated")`, `context.on("page")`). Plus explicit save on daemon `SIGTERM`/`SIGINT`. Plus save on explicit agent unload (if agents are dynamically unloaded). Don't save per-tool-call — IO amplification.

### 5. **`browser_extract` metadata fields: what to include?**

- **What we know:** CONTEXT.md says "Extract metadata: title, byline, publishedTime (from meta tags) when available."
- **What's unclear:** Readability returns `title`, `byline`, `siteName`, `publishedTime` (if `<meta property="article:published_time">` present), `lang`, `excerpt`. Include all? Just the named 3?
- **Recommendation:** Return the superset (Readability's full parse result minus `content` when `html` not requested). No downside for agents — they ignore unused fields.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.x (already in project, `npm test`) |
| Config file | Uses repo root config (see `package.json` `"test": "vitest run"`; pattern-match existing `src/**/__tests__/*.test.ts`) |
| Quick run command | `npx vitest run src/browser/__tests__/<specific>.test.ts` |
| Full suite command | `npm test` |
| Typecheck | `npm run typecheck` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BROWSER-01 | `browser_navigate` returns URL/title/status on success | integration (real Chromium + `file://` fixture) | `npx vitest run src/browser/__tests__/tools.integration.test.ts -t "browser_navigate"` | ❌ Wave 0 |
| BROWSER-01 | `browser_navigate` returns structured `{error:{type:"timeout"}}` on bad URL | integration | `npx vitest run ... -t "browser_navigate.*timeout"` | ❌ Wave 0 |
| BROWSER-02 | Screenshot saved to disk + inline base64 under threshold | integration | `npx vitest run ... -t "browser_screenshot.*inline"` | ❌ Wave 0 |
| BROWSER-02 | Screenshot larger than threshold returns path-only | unit (mock `page.screenshot` return buffer) | `npx vitest run src/browser/__tests__/screenshot.test.ts` | ❌ Wave 0 |
| BROWSER-03 | `browser_click` + `browser_fill` modify page state | integration (form fixture) | `npx vitest run ... -t "browser_click\\|browser_fill"` | ❌ Wave 0 |
| BROWSER-04 | `browser_extract` selector mode returns text/html | unit + integration | `npx vitest run ... -t "browser_extract.*selector"` | ❌ Wave 0 |
| BROWSER-04 | `browser_extract` readability mode returns title/byline/text | unit (offline HTML fixture) | `npx vitest run src/browser/__tests__/readability.test.ts` | ❌ Wave 0 |
| BROWSER-05 | `browser_wait_for` selector visible path | integration (SPA fixture with `setTimeout` insert) | `npx vitest run ... -t "browser_wait_for.*selector"` | ❌ Wave 0 |
| BROWSER-05 | `browser_wait_for` URL regex + timeout path | integration | `npx vitest run ... -t "browser_wait_for.*timeout"` | ❌ Wave 0 |
| BROWSER-06 | Persistent profile: cookies survive manager.close() + re-warm() | integration | `npx vitest run src/browser/__tests__/persistence.test.ts` | ❌ Wave 0 |
| BROWSER-06 | Boot health probe hard-fails daemon on missing libs (simulated via invalid executablePath) | unit (mock `chromium.launch`) | `npx vitest run src/browser/__tests__/manager.test.ts -t "health probe"` | ❌ Wave 0 |
| BROWSER-06 | Warm-path integration with daemon's `runWarmPathCheck` | integration (daemon-warmup-probe.test.ts extension) | `npx vitest run src/manager/__tests__/daemon-warmup-probe.test.ts` | ✅ (file exists; extend it) |

### Sampling Rate

- **Per task commit (cheap gate):** `npx vitest run src/browser/__tests__/readability.test.ts src/browser/__tests__/screenshot.test.ts` — unit-only, fast (<5s). These cover mocked paths.
- **Per wave merge:** `npx vitest run src/browser/` — includes integration tests with real Chromium. Budget: ~60–120s (browser launch dominates).
- **Phase gate:** `npm test` (full 1237+ test suite) + manual `clawcode browser-mcp` E2E smoke against `https://example.com` via the OpenAI endpoint (per Phase 69) — per CONTEXT.md specifics section.

### Smoke Test (manual / scripted E2E)

Per CONTEXT.md: Clawdy navigates to `example.com`, screenshots, extracts body text, returns a description. Via the v1.9 OpenAI endpoint (Phase 69):

```bash
# Assumes daemon running with browser MCP auto-injected
curl -sS http://localhost:PORT/v1/chat/completions \
  -H "Authorization: Bearer $CLAWDY_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "clawdy",
    "messages": [
      {"role": "user", "content": "Use browser_navigate on https://example.com, then browser_screenshot, then browser_extract with mode=readability. Describe the page in one sentence."}
    ]
  }' | jq .
```

Pass criteria: `status:200`, `response.choices[0].message.content` mentions "Example Domain" or similar, no `tool_calls` error blocks.

### Wave 0 Gaps

- [ ] `src/browser/__tests__/manager.test.ts` — unit, mocks chromium.launch; covers warm path, probe, close, re-warm idempotence.
- [ ] `src/browser/__tests__/readability.test.ts` — unit, HTML fixtures → readability assertions.
- [ ] `src/browser/__tests__/screenshot.test.ts` — unit, buffer → envelope logic + inline threshold.
- [ ] `src/browser/__tests__/tools.integration.test.ts` — real chromium + local `file://` fixtures (form.html, article.html, spa.html).
- [ ] `src/browser/__tests__/persistence.test.ts` — integration, verifies storageState round-trip.
- [ ] `src/browser/__tests__/fixtures/article.html` — semantic HTML5 article for readability.
- [ ] `src/browser/__tests__/fixtures/form.html` — simple form with input+button for click/fill.
- [ ] `src/browser/__tests__/fixtures/spa.html` — delayed-DOM-insert page for wait_for.
- [ ] Extend `src/manager/__tests__/daemon-warmup-probe.test.ts` — add browser warm-path assertion (existing file).
- [ ] Vitest config tweak: integration tests may need longer `testTimeout` (60s default is fine for browser launch; verify).
- [ ] CI gate: ensure `playwright install chromium --only-shell` runs in the test job.

## Sources

### Primary (HIGH confidence — official docs / direct verification)

- [playwright-core npm page](https://www.npmjs.com/package/playwright-core) — v1.59.1, confirmed via `npm view` 2026-04-18
- [Playwright BrowserType docs](https://playwright.dev/docs/api/class-browsertype) — `launchPersistentContext` single-context-per-browser constraint (direct WebFetch)
- [Playwright browser-contexts docs](https://playwright.dev/docs/browser-contexts) — Multiple BrowserContexts per Browser semantics (direct WebFetch)
- [Playwright storageState API](https://playwright.dev/docs/api/class-browsercontext#browser-context-storage-state) — cookies/localStorage/IndexedDB capture (direct WebFetch)
- [Playwright Browsers docs](https://playwright.dev/docs/browsers) — `--only-shell`, `chromium-headless-shell`
- [Playwright locators docs](https://playwright.dev/docs/locators) — getByRole best practices
- [Playwright docker docs](https://playwright.dev/docs/docker) — non-root user requirement
- [@mozilla/readability npm](https://www.npmjs.com/package/@mozilla/readability) — v0.6.0 confirmed
- [jsdom npm](https://www.npmjs.com/package/jsdom) — v29.0.2 confirmed
- [MCP spec 2025-11-25 Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) — image content type format
- `src/mcp/server.ts` — in-tree reference pattern for MCP server
- `src/memory/embedder.ts` — in-tree reference pattern for warm() singleton
- `src/config/loader.ts:71-79` — in-tree `clawcode` auto-injection pattern
- `src/manager/warm-path-check.ts` — in-tree warm-path gate pattern

### Secondary (MEDIUM confidence — WebSearch cross-verified)

- [BrowserStack: persistent context guide](https://www.browserstack.com/guide/playwright-persistent-context) — persistent context semantics confirmed
- [Playwright GitHub #14862](https://github.com/microsoft/playwright/issues/14862) — `playwright-chromium` package legacy
- [Markaicode: MCP memory leak guide 2025](https://markaicode.com/playwright-mcp-memory-leak-fixes-2025/) — multi-browser CI RSS benchmarks
- [Playwright GitHub #12299](https://github.com/microsoft/playwright/issues/12299) — SIGTERM shutdown behavior
- [Claude Code issue #43056](https://github.com/anthropics/claude-code/issues/43056) — inline image accumulation in conversation history
- [Datawookie: browser footprint 2025](https://datawookie.dev/blog/2025-06-06-playwright-browser-footprint/) — WebKit/Chromium/Firefox RSS comparison
- [BrowserStack: waitforloadstate 2026](https://www.browserstack.com/guide/playwright-waitforloadstate) — networkidle discouragement
- [Playwright GitHub #12227](https://github.com/microsoft/playwright/issues/12227) — install-deps sudo alternatives
- [BrowserStack: selectors 2026](https://www.browserstack.com/guide/playwright-selectors-best-practices) — role/testid/text selector priority

### Tertiary (LOW confidence — flagged for validation)

- Per-agent memory footprint estimate of 50–150MB per context under Option 2 — inferred, not benchmarked. **Plan 01 measurement task required.**
- `chromium-headless-shell` 40% lighter than Chrome-for-Testing — stated in multiple blog posts but no single Playwright-blessed benchmark. Treat as "lighter" without specific number.
- `storageState({ indexedDB: true })` availability from Playwright 1.51 — confirmed by release notes grep but not directly verified. **Plan 01 must confirm against 1.59.1.**

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — versions verified via `npm view`, packages in use across wider ecosystem, in-project patterns already parallel (embedder singleton).
- Architecture: HIGH-conditional — IF Open Question #1 resolved per recommendation (Option 2 `storageState`). HIGH on mechanics; MEDIUM on the gap between CONTEXT.md wording and implementable reality.
- MCP integration: HIGH — existing `clawcode` MCP pattern is directly reusable; `src/mcp/server.ts` + `src/config/loader.ts` show the auto-inject mechanics.
- Pitfalls: HIGH — pulled from Playwright issue tracker, community guides 2025-26, in-tree knowledge (CLAUDE.md, STATE.md blockers). Pitfall 1 (launchPersistentContext sharing) is the load-bearing one and is verified against official docs.
- Validation architecture: HIGH — Vitest already in project, integration test pattern established (see `src/manager/__tests__/daemon-warmup-probe.test.ts`).
- Memory footprint forecasting: MEDIUM — rough band, needs Plan 01 measurement. STATE.md already flags this.

**Research date:** 2026-04-18
**Valid until:** 2026-05-18 (Playwright releases every ~3 weeks; browser binary revisions bump frequently. Re-verify versions before Plan 01 implementation.)
