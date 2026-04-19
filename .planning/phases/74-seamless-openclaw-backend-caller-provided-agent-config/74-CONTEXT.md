# Phase 74: Seamless OpenClaw Backend — Context

**Gathered:** 2026-04-19
**Status:** Ready for planning
**Mode:** Auto-decided (user authorized optimal defaults)

<domain>
## Phase Boundary

OpenClaw adds ClawCode as an OpenAI-compatible provider in `~/.openclaw/openclaw.json`. OpenClaw's workspace-scoped agents (their own SOUL / tools / model preference / memory / workspace dir) hit ClawCode's `/v1/chat/completions` via namespaced model ids — `openclaw:<slug>:<tier>` where tier ∈ {sonnet, opus, haiku}. ClawCode materializes a transient persistent-session per (bearer, caller-slug, SOUL-hash, tier), preserving Phase 73's sub-2s TTFB SLO.

</domain>

<decisions>
## Implementation Decisions (all locked — user authorized optimal defaults)

### Approach
**D — Hybrid (Approach B + namespaced model id).** Plain `model:` names (e.g. `fin-test`, `admin-clawdy`) route to pinned/native agents as today. `model:` values prefixed with `openclaw:` route to the new transient-template code path.

### Wire format
Request: `{ "model": "openclaw:<slug>:<tier>", "messages": [{"role":"system","content":"<SOUL body>"}, ...] }`
- `<slug>` — OpenClaw's own agent identifier (free-form, alphanumeric + hyphen)
- `<tier>` — one of `sonnet`, `opus`, `haiku`. Omit → default `sonnet`. So `openclaw:researcher` ≡ `openclaw:researcher:sonnet`; `openclaw:researcher:opus` forces Opus.

### Session-cache key
`(bearer_key_hash, caller_slug, sha256(SOUL), tier)`. Any change to any of the four respawns. TTL 30 min idle (vs Phase 73's 1h for native).

### Model tier mapping
- `sonnet` → `claude-sonnet-4-6` (current default)
- `opus` → `claude-opus-4-7`
- `haiku` → `claude-haiku-4-5-20251001`

### Security — `security.denyScopeAll` flag (opt-in per agent)
Per-agent boolean in `clawcode.yaml`. When `true`, a scope=all bearer key CANNOT target that agent. Default `false` (back-compat). Default `true` ONLY for `admin-clawdy` (admin privileges — scope=all key must not grant admin rights). `openclaw:*` caller-provided namespace is always exempt from pinned-agent flags (it's a different code path entirely — no admin surface).

### Authentication
`body.model` prefix is authoritative for routing. `body.user` (if present) is captured in trace/usage metadata for audit cross-check only — NOT used for auth.

### Cost attribution
UsageTracker `agent` field = `"openclaw:<slug>"` (without the tier suffix, since tier changes would fragment cost rows per-agent). Tier logged as a separate metadata field. `clawcode costs` output shows `openclaw:*` rows flat alongside native-agent rows. Section grouping deferred.

### Out of scope
- Namespace versioning (`openclaw:v1:...`) — YAGNI
- Additional JWT / per-turn auth beyond bearer
- `reasoning_effort` plumb-through (separate follow-up)
- `POST /v1/agents` registration endpoint (not needed — Approach C was rejected)
- Caller-supplied workspace dirs or memory paths — transient sessions have NO workspace (cwd = `/tmp/clawcode-transient` or similar), NO persistent memory. Memory belongs to OpenClaw's side.
- Caller-supplied tool MCP paths — transient sessions use ClawCode's default MCP surface (browser, search, image, clawcode) since those are workspace-agnostic. OpenClaw-declared tools in the request `tools[]` array are passed through as usual.

</decisions>

<code_context>
## Existing Code Insights

### Reusable primitives (from Phases 69 + 73 + quick tasks)
- `createPersistentSessionHandle` in `src/manager/persistent-session-handle.ts` — one SDK `streamInput()` generator per agent. Reusable verbatim for transient sessions (just point it at a caller-supplied SOUL + tier).
- `ApiKeysStore` with Phase 73 `scope=all` + per-caller lookup.
- `UsageTracker.event.agent` is free-form string — cost attribution cost-free via `agent: "openclaw:<slug>"`.
- `buildSessionConfig` in `src/manager/session-config.ts` — builds the session-init bundle for a persistent session. Need a parallel `buildTransientSessionConfig` that takes caller-supplied SOUL instead of a ResolvedAgentConfig.
- `OpenAiSessionDriver` + dispatch in `src/openai/driver.ts` + `src/openai/server.ts` — insertion point for the `openclaw:` prefix detection.

### SDK hard constraints
- `systemPrompt` / `appendSystemPrompt` are immutable per persistent query (verified in sdk.d.ts lines 1687-1876). Any SOUL change ⇒ respawn the generator. This is why the cache key includes `sha256(SOUL)`.

### Integration points
- `src/openai/server.ts` handleChatCompletions auth path: after bearer validation, detect `body.model.startsWith("openclaw:")` → branch to transient dispatch. Pinned-agent path unchanged.
- New module: `src/openai/transient-session-cache.ts` — LRU with TTL, value is the persistent handle + cleanup fn.
- Migration: `security.denyScopeAll` column on api_keys lookup is NOT needed — denyScopeAll is an agent-level flag in clawcode.yaml, so the check is in the auth path after resolving the agent, not in the key store.

</code_context>

<specifics>
## Specific Ideas

### OpenClaw provider config snippet (final form — for user's copy/paste)
```json
// In ~/.openclaw/openclaw.json → models.providers.clawcode
{
  "baseUrl": "http://100.98.211.108:3101/v1",
  "api": "openai-completions",
  "apiKey": "ck_all_...",
  "models": [
    { "id": "openclaw:finmentum-researcher:sonnet", "name": "Finmentum Researcher (Sonnet via ClawCode)", "contextWindow": 200000, "maxTokens": 8192 },
    { "id": "openclaw:finmentum-researcher:opus",   "name": "Finmentum Researcher (Opus via ClawCode)",   "contextWindow": 200000, "maxTokens": 8192 },
    { "id": "openclaw:generic-coder:sonnet",         "name": "Generic Coder (Sonnet)",                      "contextWindow": 200000, "maxTokens": 8192 }
  ]
}
```

Any `openclaw:<slug>:<tier>` id works — OpenClaw only needs model ids it's routing to. ClawCode accepts any `openclaw:*` shape at runtime — the models array in openclaw.json is just OpenClaw's selector catalog.

### Security: denyScopeAll wiring
`src/config/schema.ts` → `agentConfigSchema` gains `security: { denyScopeAll: boolean (default false) }`. `src/openai/server.ts` auth path:
```
if (scopeAll && targetAgent.security?.denyScopeAll) return 403 "agent_forbids_multi_agent_key"
```
`clawcode.yaml` for admin-clawdy adds:
```yaml
- name: admin-clawdy
  admin: true
  security:
    denyScopeAll: true
```

### Transient-session TTL reaper
30min idle timer per cache entry. On reap: `handle.close()`, UsageTracker emits a final "session closed" event for cost-tracking continuity. On daemon shutdown: graceful drain (Phase 73 Plan B — SessionManager.drain already covers pending summaries; extend to transient handles too).

</specifics>

<canonical_refs>
## Canonical References

- `.planning/phases/74-seamless-openclaw-backend-caller-provided-agent-config/74-RESEARCH.md` — full research with comparison table + wire-format sketch + OpenClaw config snippet
- `.planning/phases/73-openclaw-endpoint-latency/73-SUMMARY.md` (composite) — Phase 73 persistent-handle primitive we reuse
- `.planning/quick/260419-p51-multi-agent-bearer-keys-fork-escalation-/260419-p51-SUMMARY.md` — Phase 73 follow-up that shipped `scope=all` keys (the entry point)
- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (lines 1687-1876, 2185-2201) — SDK systemPrompt immutability constraint

</canonical_refs>

<deferred>
## Deferred Ideas

- `reasoning_effort` plumb-through (separate phase — OpenClaw already sends it, we'd just need translator + SDK wiring)
- `openclaw:*` rows section grouping in `clawcode costs` output
- Per-caller workspace dirs (requires explicit security audit + sandbox before admitting)
- Per-caller custom MCP servers (same — needs sandbox)
- Alternative auth (JWT/OAuth)
- Namespace versioning (`openclaw:v1:...`)
- `POST /v1/agents` dynamic-registration endpoint (Approach C — not needed since D covers it)

</deferred>
