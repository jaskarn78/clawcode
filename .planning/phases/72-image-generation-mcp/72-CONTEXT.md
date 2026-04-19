# Phase 72: Image Generation MCP - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning
**Mode:** Auto (--auto) — decisions locked in milestone scoping

<domain>
## Phase Boundary

Deliver an auto-injected MCP server that gives every agent image generation + editing via three selectable backends:

- **MiniMax** — `MINIMAX_API_KEY` already configured
- **OpenAI Images** — `OPENAI_API_KEY` already configured
- **fal.ai** — already in `clawcode.yaml` mcpServers block

Three tools: `image_generate`, `image_edit`, `image_variations`. Output saved to workspace, deliverable to Discord via existing `send_attachment`. Spend recorded in `clawcode costs` as a new category.

Satisfies: **IMAGE-01, IMAGE-02, IMAGE-03, IMAGE-04**.

</domain>

<decisions>
## Implementation Decisions

### Backends & Selection

- **Default backend:** `openai` (most stable + widely supported). Overridable via `defaults.image.backend` or per-agent `image.backend`.
- **Backend union:** `"openai" | "minimax" | "fal"`.
- **Backends selectable per-tool too** — agents can call `image_generate(prompt, backend: "fal")` to override the default for a single call.
- **Pure HTTP clients** — no SDK packages. node:fetch for all three. Small footprint.

### Module Structure

- New `src/image/` directory.
- `src/image/providers/openai.ts` — OpenAI DALL-E / gpt-image-1 client
- `src/image/providers/minimax.ts` — MiniMax image client
- `src/image/providers/fal.ts` — fal.ai client
- `src/image/tools.ts` — pure `image_generate`, `image_edit`, `image_variations` handlers
- `src/image/workspace.ts` — workspace file writer (saves to `<agent-workspace>/generated-images/<timestamp>-<id>.png`)
- `src/image/costs.ts` — per-backend cost estimation (adds to existing `clawcode costs` category)
- `src/image/mcp-server.ts` — stdio MCP subprocess
- `src/cli/commands/image-mcp.ts` — `clawcode image-mcp` CLI subcommand
- `src/image/daemon-handler.ts` — handle `image-tool-call` IPC method in daemon (same pattern as browser/search)

### Tool Surface

| Tool | Args | Returns |
|---|---|---|
| `image_generate` | `prompt: string, size?: "256x256"\|"512x512"\|"1024x1024"\|"1024x1792"\|"1792x1024", style?: string, backend?: string, model?: string, n?: number (1-4, default 1)` | `{ images: [{ path, url?, size, backend, model, prompt, cost }] }` |
| `image_edit` | `imagePath: string, prompt: string, backend?: string, maskPath?: string` | `{ images: [...], cost }` (only backends with edit support) |
| `image_variations` | `imagePath: string, n?: number, backend?: string` | `{ images: [...], cost }` (only backends that support it) |

### Error Shape

`{ error: { type: "rate_limit" | "invalid_input" | "backend_unavailable" | "unsupported_operation" | "content_policy" | "network" | "size_limit", message, backend? } }` — never throws.

If a backend doesn't support a requested operation (e.g., MiniMax no variations), return `unsupported_operation` with a helpful message naming which backends DO support it.

### Cost Tracking (IMAGE-04)

- Image generation cost recorded per-call in existing cost infrastructure (`src/usage/tracker.ts` or similar).
- New cost row fields: `backend`, `model`, `count`, `cost_cents`, `timestamp`, `turn_id`.
- `clawcode costs` CLI extended to break down spend by category: tokens + images.
- Cost estimation is best-effort per backend (use published price lists; record actual billed amount if backend returns it).

### Discord Delivery (IMAGE-03)

- `image_generate` returns workspace paths.
- Agent uses existing `send_attachment` MCP tool with those paths to deliver.
- NO new Discord delivery surface.

### Config

```yaml
image:
  enabled: true                      # default: true
  backend: "openai"                  # default, per-agent overridable
  openai:
    apiKeyEnv: "OPENAI_API_KEY"
    model: "gpt-image-1"             # default; alternative "dall-e-3", "dall-e-2"
  minimax:
    apiKeyEnv: "MINIMAX_API_KEY"
    model: "image-01"
  fal:
    apiKeyEnv: "FAL_API_KEY"
    model: "fal-ai/flux-pro"
  maxImageBytes: 10485760            # 10MB hard cap
  timeoutMs: 60000                   # 60s for generation
  workspaceSubdir: "generated-images" # default subdir in agent workspace
```

### Non-Goals

- Video generation (v2.x)
- Audio/TTS (out of scope, v1.9)
- Stable Diffusion direct (v2.x)
- Midjourney (requires Discord proxy, defer)
- Image upscaling as separate tool (backends handle natively)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Phase 70-03 pattern** — complete 5-file recipe for a new MCP server: daemon-handler + mcp-server + CLI subcommand + loader auto-inject + daemon IPC intercept. Copy this pattern.
- **Phase 71 was minimal deviation from 70** — 2 plans total (providers+tools, MCP+wiring). Image phase should match this.
- **`src/usage/`** — existing cost/token tracking infrastructure. Extend for image spend.
- **Existing `send_attachment` MCP tool** in `src/mcp/server.ts` — no changes needed.
- **1Password integration** — `op://` refs already resolved for API keys.

### Established Patterns
- **Auto-inject order:** `clawcode → 1password → browser → search → image`.
- **Idempotent cache whitelist:** `image_generate` is NOT idempotent (different images for same prompt). Skip cache whitelist for image tools.
- **IPC handler:** `image-tool-call` method intercepted in daemon before `routeMethod`.

</code_context>

<specifics>
## Specific Ideas

- **OpenAI DALL-E 3 / gpt-image-1** is the flagship for v2.0. Cheapest decent model.
- **fal.ai flux-pro** is great for high-quality.
- **MiniMax** is fastest/cheapest.
- **Headline smoke test:** Clawdy generates an image of "a cat in a tophat", receives a workspace path, delivers to Discord via send_attachment. Run via OpenAI endpoint from Phase 69.

</specifics>

<deferred>
## Deferred Ideas

- Video generation (v2.x)
- Image-to-video (v2.x)
- Advanced editing: inpainting with precise masks (v2.x)
- Batch generation workflow (v2.x)
- Image recognition (already handled by Claude vision — not needed as separate tool)

</deferred>
