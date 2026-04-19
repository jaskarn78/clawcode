# Phase 71: Web Search MCP - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning
**Mode:** Auto (--auto) — decisions locked in milestone scoping, auto-confirmed

<domain>
## Phase Boundary

Deliver an auto-injected MCP server that gives every agent live web search + clean article fetching. Two tools:

- `web_search(query, numResults?)` — searches Brave (primary) or Exa (optional, per-agent config) and returns a ranked list with title, URL, snippet, published date when available.
- `web_fetch_url(url)` — fetches a URL and returns clean readable text (Mozilla Readability style) with metadata (title, author, publish date when extractable).

Duplicate calls within a single turn are cached via the v1.7 intra-turn idempotent tool-cache (whitelist addition). Auto-inject alongside `clawcode`, `1password`, `browser`.

Satisfies: **SEARCH-01, SEARCH-02, SEARCH-03**.

</domain>

<decisions>
## Implementation Decisions

### Backends

- **Brave Search** (primary) — `https://api.search.brave.com/res/v1/web/search`, authenticated via `X-Subscription-Token: <BRAVE_API_KEY>`. Already configured in `clawcode.yaml` as `BRAVE_API_KEY` env var.
- **Exa** (optional, selectable per-agent) — `https://api.exa.ai/search`, authenticated via `x-api-key: <EXA_API_KEY>`. Optional; agents opt in via config.
- Default backend is Brave. Agents override via `defaults.search.backend: "exa"` or per-agent `search.backend`.
- **NO provider-specific wrapper packages** — direct HTTP fetch via node:fetch (Node 22 native). Small and auditable.

### Module Structure

- New `src/search/` directory — small and focused per CLAUDE.md style guide.
- `src/search/providers/brave.ts` — Brave API client
- `src/search/providers/exa.ts` — Exa API client
- `src/search/readability.ts` — reuse `@mozilla/readability` + `jsdom` already installed by Phase 70 (no new deps needed!)
- `src/search/tools.ts` — pure tool handlers using injected provider + fetcher
- `src/search/mcp-server.ts` — stdio MCP subprocess mirroring Phase 70's pattern
- `src/cli/commands/search-mcp.ts` — new `clawcode search-mcp` CLI subcommand

### Tool Surface

| Tool | Args | Returns |
|---|---|---|
| `web_search` | `query: string, numResults?: number (default 10, max 20)` | `{ results: [{ title, url, snippet, publishedDate? }], total, provider }` |
| `web_fetch_url` | `url: string, mode?: "readability"\|"raw" (default "readability"), maxBytes?: number (default 1MB)` | `{ url, title, byline?, publishedDate?, text, html?, wordCount }` |

**Error shape:** `{ error: { type: "network"|"rate_limit"|"invalid_url"|"size_limit"|"extraction_failed", message, details? } }` — never throws.

### Intra-Turn Caching (SEARCH-03)

- Add `web_search` and `web_fetch_url` to the v1.7 Turn-scoped idempotent tool cache whitelist (`src/performance/tool-cache.ts`).
- Cache key = deterministic hash of tool name + normalized args JSON.
- Cache hit within a single Turn returns the prior result; cross-turn calls always hit the network fresh.
- The `cached: true` flag in trace spans already indicates cache hits per v1.7 pattern.

### URL Fetching

- Use node:fetch with 30s timeout, follow up to 5 redirects.
- User-Agent: `ClawCode/<version> (+https://github.com/jaskarn78/clawcode)` — identifies traffic as ClawCode-originated.
- Max response size 1MB (configurable). If exceeded → return `size_limit` error.
- Respect robots.txt? No — agents should respect ToS themselves; blanket robots.txt enforcement too aggressive for an assistant tool. Document clearly in README.

### Readability Extraction

- Reuse Phase 70's `src/browser/readability.ts` module — hoist to `src/shared/readability.ts` if needed or import directly. Zero new deps.
- Mode `"readability"`: Readability + jsdom → clean article text, title, byline, published date.
- Mode `"raw"`: return raw HTML + computed `text` via `JSDOM.innerText` (simpler, for non-article pages like docs).

### Config Schema

New optional section:

```yaml
search:
  enabled: true                       # default: true (auto-inject MCP server)
  backend: "brave"                    # default: "brave" | "exa"
  brave:
    apiKeyEnv: "BRAVE_API_KEY"        # default env var name
    safeSearch: "moderate"            # default: "moderate" | "off" | "strict"
    country: "us"                     # default ISO 3166 code
  exa:
    apiKeyEnv: "EXA_API_KEY"
    useAutoprompt: false              # default: false (deterministic queries)
  maxResults: 20                      # default: 20 (hard cap)
  timeoutMs: 10000                    # default: 10s
  fetch:
    timeoutMs: 30000                  # default: 30s
    maxBytes: 1048576                 # default: 1 MB
    userAgentSuffix: null             # default: auto from package.json
```

### Non-Goals (carried from REQUIREMENTS.md out-of-scope)

- Image / news / video search modes (Brave's sub-APIs) — text search only for v2.0
- Custom search engines (Google CSE, SerpAPI, etc.) — v2.x
- Semantic/vector search over indexed content — v2.x
- Local cache beyond intra-turn (no persistent search index) — v2.x

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Phase 70's `src/browser/readability.ts`** + `jsdom` — reuse verbatim or hoist to `src/shared/` if used by multiple MCPs.
- **Phase 70's `src/browser/mcp-server.ts`** — template for MCP stdio subprocess.
- **`src/performance/tool-cache.ts`** — v1.7 intra-turn idempotent cache. Just add the new tool names to the whitelist.
- **`src/config/loader.ts`** — auto-inject pattern (clawcode + 1password + browser from Phase 70).
- **1Password integration** — if `BRAVE_API_KEY` or `EXA_API_KEY` are `op://...` refs, they're already resolved at daemon boot; no new secret handling.

### Established Patterns
- **Auto-inject** — add `search` to the block in `src/config/loader.ts`.
- **Subprocess MCP** — mirror `clawcode browser-mcp` / `clawcode mcp` patterns.
- **Fetch with timeout** — use `AbortController` + `setTimeout`, same pattern as v1.8 MCP client health checks.

### Integration Points
- **Daemon boot:** no new warm-path check needed — HTTP clients are lazy; no persistent resources like Chromium.
- **Tool-cache whitelist:** `src/performance/tool-cache.ts` → add `"web_search"` and `"web_fetch_url"`.
- **Auto-inject:** `src/config/loader.ts` adds `search` entry alongside existing auto-injected MCPs.

</code_context>

<specifics>
## Specific Ideas

- **Brave API docs:** https://api.search.brave.com/app/documentation/web-search/get-started
- **Exa API docs:** https://docs.exa.ai/reference/search
- **Headline smoke test:** Clawdy searches "anthropic claude api" → fetches the first result → describes the page. Run via Phase 69's OpenAI endpoint.
- **Zero new npm deps** — use `@mozilla/readability` + `jsdom` already installed by Phase 70. Saves install time and keeps the lockfile clean.

</specifics>

<deferred>
## Deferred Ideas

- Image/news/video search — v2.x
- Additional backends (Google CSE, SerpAPI, DuckDuckGo) — v2.x
- Cross-turn persistent search cache (e.g., 1h) — v2.x
- Rate limiting per agent — v2.1+ (part of multi-user foundations)
- Citation/quote attribution into memory — v2.1+

</deferred>
