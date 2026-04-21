# Phase 74: Seamless OpenClaw Backend — Research

**Researched:** 2026-04-19
**Domain:** ClawCode `/v1/chat/completions` endpoint — caller-provided agent config (SOUL / tools / model / memory / workspace) without pre-registration on the backend
**Confidence:** HIGH on stack shape and wire constraints; MEDIUM on cache-preservation tradeoffs across approaches (must be measured)

## Summary

OpenClaw already carries everything Phase 74 needs for seamless-backend semantics inside an ordinary OpenAI chat-completion request: the agent's IDENTITY.md is rendered into `messages[0].role="system"`, the agent's intended model id rides `body.model`, and the caller's identity flows via `body.user` (unset today — opportunity) and the `X-OpenClaw-Session-Key` header (already sent by the bridge). OpenClaw's provider schema also permits a static `headers: {}` map per provider but does NOT per-request interpolate per-agent variables, so any variable caller identity must travel in the body or in headers OpenClaw itself already populates.

The Claude Agent SDK at 0.2.97 (installed) / 0.2.114 (latest) imposes one hard constraint that shapes the whole design: **a persistent `streamInput()` Query can NOT swap `systemPrompt` per turn.** `systemPrompt` + `appendSystemPrompt` are set ONCE inside `SDKControlInitializeRequest`; the mid-session mutation surface is limited to `setModel`, `applyFlagSettings`, `setMcpServers`, `setPermissionMode`, `setMaxThinkingTokens`, `interrupt`, and `streamInput` itself (sdk.d.ts:1687-1876). This means: **one persistent generator = one fixed SOUL prompt for its lifetime**. Phase 73's per-agent persistent subprocess is ALREADY keyed on ClawCode's OWN agent identity and cannot trivially be reused to render arbitrary caller-provided SOULs on turn 2+.

**Primary recommendation:** Ship **Approach B (server-side template + cached transient session)** with a single architectural refinement borrowed from Approach D: a namespace token on `body.model` (`openclaw:<slug>`) chooses the template-rendering path; plain model names keep routing to ClawCode-native pinned agents. Approach B preserves Phase 73's persistent-subprocess SLO for ClawCode's OWN agents, adds a parallel pool of persistent subprocesses keyed on `(bearerKey, callerIdentitySlug)` for OpenClaw-side agents, and keeps cost attribution crisp. Approach A is too lossy on latency (new subprocess per turn defeats LAT-01). Approach C demands OpenClaw-side code changes we explicitly want to avoid. Approach D alone without B's template system still doesn't explain how SOUL lands in the SDK — it's a routing decision, not an implementation.

## User Constraints

No CONTEXT.md yet — Phase 74 is research-before-discuss per ROADMAP.md. Constraints below come from `.planning/STATE.md`, the ROADMAP.md Phase 74 success criteria, and the objective in this research brief.

### Locked Decisions (from ROADMAP.md Phase 74 success criteria)

1. OpenClaw carries its own agent identity (SOUL prompt, model preference, tool definitions) INSIDE the request — ClawCode MUST NOT require pre-registration in `clawcode.yaml` for OpenClaw-side agents.
2. Independent sessions per (bearer-key, caller-provided-agent-identity) with prompt-cache hits on turn 2+. **v1.7 prompt-cache SLO is a non-regression gate** (carried forward across every v2.0 phase).
3. Cost tracking attributes spend to the CALLER-provided identity (not a single "openai-endpoint" bucket) so OpenClaw's per-workspace cost dashboards stay accurate.
4. Isolation: caller-provided configs cannot escape into ClawCode's own agents' workspaces, memory stores, or MCP tool surface. No path traversal via workspace. No SOUL-as-instruction-injection into the ClawCode kernel system prompt.
5. OpenClaw side needs ONE provider entry with ONE bearer key (scope='all' multi-agent key from quick task 260419-p51) — all OpenClaw-side agents route through it; `body.model` carries the identifier OpenClaw expects back.
6. **No new npm deps.** (objective constraint)
7. **Phase 73 persistent subprocess + brief cache + multi-agent keys must be preserved.** (objective constraint)
8. **Discord-path parity.** Any code touching SessionManager/SessionAdapter must not regress the Discord turn path. (v1.8 invariant carried forward)

### Claude's Discretion

- How caller identity is extracted (body.user vs body.model namespacing vs messages[0].system vs X-header). Recommend a precedence order in this doc.
- Whether transient-template SESSIONS are persistent (our recommendation: yes, with LRU cache).
- What's done with tool definitions from `body.tools[]` (our recommendation: translate to local MCP bridge tools — same path Phase 69 already uses).
- Whether the caller can specify a model override (our recommendation: yes, via a second field — e.g. body.model="openclaw:<slug>" + body.metadata.claude_model="sonnet" OR a first-segment-after-colon convention).

### Deferred Ideas (explicitly out of scope — flag to planner)

- **Caller-supplied workspace paths.** Filesystem-backed workspaces for OpenClaw-side agents are a path-traversal disaster (see "Pitfall 4"). Phase 74 uses NO filesystem workspace for OpenClaw-side transient agents — they run in a ClawCode-internal keyed temp dir with `cwd` set to a fleet-shared read-only-ish location. Actual workspace-backed persistence is a Phase 75+ concern.
- **Caller-supplied MemoryStore.** OpenClaw has its own memory system (`memory-host-sdk`); we do not mount it into ClawCode's per-agent `memory.db` / `conversation.db`. For Phase 74, OpenClaw-side transient agents have NO server-side memory (the SDK session JSONL plus ConversationStore handle turn-to-turn continuity; long-term memory stays on OpenClaw's side). Session-boundary summarization (v1.9) is SKIPPED for transient agents in Phase 74; revisit in a follow-up.
- **Full OpenClaw tool-use translation.** Phase 69 already has partial OpenAI tools[] → Claude tool_use[] translation. If OpenClaw sends tool definitions, they flow through the existing path. Mapping OpenClaw MCP-server tool surfaces INTO ClawCode's MCP runtime is deferred — the caller can describe them as OpenAI functions and ClawCode emits `tool_calls` back.
- **Per-caller-identity rate limiting.** scope='all' bearer keys already exist; additional per-caller-identity rate limits are follow-up work.
- **Multi-tenant bearer keys with distinct ownership.** Phase 74 uses ONE scope='all' bearer key shared across all OpenClaw-side agents on one OpenClaw install. Multi-OpenClaw-install federation is Phase 76+.

## Phase Requirements

| ID | Description (from ROADMAP.md) | Research Support |
|----|-------------------------------|------------------|
| BACKEND-01 | Caller-provided identity (SOUL via system OR extension) + model preference + tools, no pre-registration | Approach B template+cache design; Section "OpenClaw outgoing shape" confirms messages[0].system + body.model + body.tools[] + body.user are all preserved end-to-end. |
| BACKEND-02 | Independent sessions per (bearer, caller-identity) + prompt-cache hits turn 2+; v1.7 SLO preserved | Phase 73 `createPersistentSessionHandle` + `PersistentSessionCache` can be extended to accept a composite key `(bearerKey, callerSlug)`. Prompt-cache retention analysis in "Stream input + SDK cache interaction". |
| BACKEND-03 | Cost attribution by CALLER-provided identity | `UsageTracker.record()` takes `agent` as a free-form string — callers-slug flows in directly. CostByAgentModel grouping in `tracker.ts:142` groups by (agent, model) — per-caller buckets appear for free. |
| BACKEND-04 | Isolation: no workspace/memory/MCP escape; no path traversal | Enforced by NOT honoring caller-supplied workspace paths (use fixed ClawCode-internal temp); SOUL lands as `systemPrompt` (not `appendSystemPrompt` onto kernel); MCP surface narrowed. |
| BACKEND-05 | One provider entry + one bearer key on OpenClaw side | scope='all' from quick task 260419-p51 already exists; `lookupByIncomingKey` + scope check flow is the entry point. |

## Standard Stack

### Already in tree (NO new npm deps per objective)

| Component | Location | Purpose | Version |
|-----------|----------|---------|---------|
| `@anthropic-ai/claude-agent-sdk` | `node_modules/` | Persistent `streamInput()` Query via `query({ prompt: asyncIterable, options: { systemPrompt, resume, includePartialMessages } })` — the ONE primitive that makes B viable without per-turn subprocess spawn | 0.2.97 installed (0.2.114 latest on npm). No upgrade required for Phase 74; 0.2.97 has every surface we need (verified in `sdk.d.ts:1400-1482, 1687-1876, 2185-2201`). |
| `better-sqlite3` | Core dep | ApiKeysStore scope='all' lookup + UsageTracker caller-attributed rows | 12.8.0 (per-project CLAUDE.md) |
| `zod/v4` | Core dep | Extend `chatCompletionRequestSchema` with optional `metadata` sub-object for caller-identity hints | 4.3.6 |
| `pino` | Core dep | Log caller-identity for request-logger (`src/openai/request-logger.ts`) | 9.x |
| Phase 73 `createPersistentSessionHandle` | `src/manager/persistent-session-handle.ts` | Reused verbatim for OpenClaw-side transient agents — same semantics, different `baseOptions.systemPrompt` + `cwd` + `resume` pointer | In tree |
| Phase 73 `ConversationBriefCache` | `src/manager/conversation-brief-cache.ts` | Not applicable to transient agents (no ConversationStore); cache stays ClawCode-native-only | In tree |
| Phase 69 `chatCompletionRequestSchema` | `src/openai/types.ts:162-172` | `.passthrough()` ALREADY accepts unknown body fields (e.g. `user`, `metadata`) — we can READ them without schema changes | In tree |
| Phase 69 translator | `src/openai/translator.ts` | Existing `translateRequest` extracts `lastUserMessage`, `clientSystemAppend`, `tools`, `toolChoice`, `toolResults` — reused | In tree |
| scope='all' bearer keys (quick task 260419-p51) | `src/openai/keys.ts` | `ApiKeyRow.scope === "all"` keys accept ANY `body.model` — the existing "multi-agent key" mechanism is exactly the OpenClaw-side entry point | In tree |

### Supporting

| Component | Purpose | When |
|-----------|---------|------|
| Phase 69 `OpenAiSessionDriver` interface (`src/openai/server.ts:78-95`) | The clean DI seam — Phase 74 introduces a NEW driver impl (`OpenClawTemplateDriver`) and routes to it based on `body.model` prefix | Wave 1 |
| Phase 73 `PersistentSessionCache` pattern | Transient-template sessions go into a parallel cache (`TransientSessionCache`), keyed on `keyHash::callerSlug`, same LRU + close-on-evict semantics | Wave 1 |
| `UsageTracker` (`src/usage/tracker.ts`) | Extend `record()` call sites to thread the CALLER slug as `event.agent` when the request comes from the OpenClaw template driver | Wave 2 |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Template-rendered transient AgentConfig | Caller sends full `clawcode.yaml`-shape body (JSON) | Worse — forces OpenClaw-side code to know ClawCode's config schema; violates "no OpenClaw changes" constraint; and risks config-injection. |
| `body.model = "openclaw:<slug>"` namespacing | Dedicated HTTP header (`X-Caller-Agent-Id`) | Worse — requires operator to configure provider headers on BOTH OpenClaw and ClawCode sides, even though OpenClaw's header-map doesn't interpolate per-agent variables. Body-field routing is zero-config. |
| New `POST /v1/agents` endpoint (Approach C) | Register-then-chat two-step | Worse — requires OpenClaw-side code to call an auxiliary endpoint before chat; explicit "no OpenClaw changes" violation. |
| Pure passthrough (Approach A) | Fresh subprocess per turn with inline systemPrompt | Worse — defeats Phase 73 LAT-01 (sub-2s TTFB). Every turn pays the ~5s subprocess-spawn cost. |

**Installation:** No new deps.

**Version verification:** `npm view @anthropic-ai/claude-agent-sdk version` → `0.2.114` on 2026-04-19. Installed is `0.2.97`. Phase 74 requires no bump — every needed surface (`systemPrompt`, `appendSystemPrompt`, `streamInput`, `includePartialMessages`, `resume`, `setModel`, `setMcpServers`) is in 0.2.97. Verified against `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1400-2201`.

## Architecture Patterns

### Recommended Project Structure (delta)

```
src/
├── openai/
│   ├── server.ts                       # Phase 69 — modify routing to detect "openclaw:" prefix
│   ├── driver.ts                       # Phase 69 — existing ClawCode-native driver (unchanged)
│   ├── template-driver.ts              # NEW — OpenClaw-template driver; parses caller identity,
│   │                                     materializes transient AgentConfig, dispatches via
│   │                                     persistent-or-new session
│   ├── transient-session-cache.ts      # NEW — parallel to PersistentSessionCache but keyed on
│   │                                     (keyHash, callerSlug) with LRU + close-on-evict
│   ├── caller-identity.ts              # NEW — extracts caller slug from body.model + body.user +
│   │                                     messages[0].system with precedence rules
│   └── types.ts                        # Phase 69 — no schema change needed (passthrough()); types
│                                         for CallerIdentity + TemplateDriverInput
├── manager/
│   ├── session-config.ts               # Phase 73 — add buildTransientSessionConfig() that builds
│   │                                     a minimal AgentSessionConfig from a CallerIdentity
│   │                                     (no IDENTITY.md file read, no TierManager, no SOUL.md
│   │                                     from disk — caller-supplied SOUL lands as systemPrompt)
│   └── persistent-session-handle.ts    # Phase 73 — NO CHANGE; reused as-is
└── usage/
    └── tracker.ts                      # Extend recordCost call sites with caller-slug; schema
                                         UNCHANGED (agent is already free-form string)
```

### Pattern 1: Caller identity extraction (precedence + validation)

**What:** pure function mapping an incoming `ChatCompletionRequest` + `ApiKeyRow` to either a `ClawCodeNative` (route to Phase 69 driver) or `OpenClawTemplate` (route to new driver) discriminated union.

**When:** FIRST thing handleChatCompletions does after the scope-aware auth check.

**Example:**
```typescript
// src/openai/caller-identity.ts — NEW
// Source: recommendation; mirrors the pattern in src/openai/server.ts:546-582 (scope=all check).

export type CallerIdentity =
  | {
      kind: "clawcode-native";
      agentName: string; // body.model — an existing top-level agent
    }
  | {
      kind: "openclaw-template";
      callerSlug: string; // e.g. "fin-test" extracted from "openclaw:fin-test"
      claudeModel?: "sonnet" | "opus" | "haiku"; // optional second segment
      soulPrompt: string; // extracted from messages[0].role==="system"
      tools: ClaudeToolDef[] | null; // from body.tools[]
      toolChoice: ClaudeToolChoice | null;
    };

const OPENCLAW_PREFIX = "openclaw:";

export function extractCallerIdentity(
  body: ChatCompletionRequest,
  row: ApiKeyRow,
  knownAgents: ReadonlyArray<string>,
): CallerIdentity | { error: "unknown_model" | "malformed_caller" } {
  // Fast path: exact match on a ClawCode-native agent → Phase 69 path.
  if (knownAgents.includes(body.model)) {
    return { kind: "clawcode-native", agentName: body.model };
  }

  if (body.model.startsWith(OPENCLAW_PREFIX)) {
    const rest = body.model.slice(OPENCLAW_PREFIX.length);
    const [slug, modelHint] = rest.split(":", 2);
    if (!slug || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(slug)) {
      return { error: "malformed_caller" };
    }
    // scope='all' is REQUIRED for openclaw-template path (pinned keys never
    // match this model shape because it's not a known agent).
    if (row.scope !== "all") {
      return { error: "malformed_caller" };
    }
    const firstSystem = body.messages.find((m) => m.role === "system");
    const soulPrompt = typeof firstSystem?.content === "string"
      ? firstSystem.content
      : extractTextFromParts(firstSystem?.content);
    return {
      kind: "openclaw-template",
      callerSlug: slug,
      claudeModel: (modelHint === "sonnet" || modelHint === "opus" || modelHint === "haiku")
        ? modelHint : undefined,
      soulPrompt,
      tools: translateTools(body.tools),
      toolChoice: translateToolChoice(body.tool_choice),
    };
  }

  return { error: "unknown_model" };
}
```

### Pattern 2: Transient template driver (parallel to Phase 73 driver)

**What:** new `OpenAiSessionDriver` impl that keys persistent handles on `(keyHash, callerSlug)` and seeds each handle with a caller-supplied `systemPrompt` + no workspace-filesystem workspace.

**When:** Route called when `extractCallerIdentity` returns `openclaw-template`.

**Example:**
```typescript
// src/openai/template-driver.ts — NEW
// Source: recommendation; mirrors src/manager/session-adapter.ts per-turn dispatch path.

export class OpenClawTemplateDriver implements OpenAiSessionDriver {
  constructor(
    private sdk: SdkModule,
    private cache: TransientSessionCache,
    private usageTracker: UsageTracker, // Phase 74 — cost attribution uses callerSlug as event.agent
    private log: Logger,
  ) {}

  async *dispatch(input: TemplateDriverInput): AsyncIterable<SdkStreamEvent> {
    // keyHash::callerSlug is the isolation boundary.
    const sessionKey = `${input.keyHash}::${input.callerSlug}`;
    let handle = this.cache.get(sessionKey);
    if (!handle) {
      // New persistent session. systemPrompt is the CALLER-supplied SOUL;
      // the default claude_code preset is NOT used here (we use a custom string
      // prompt — see sdk.d.ts:1460-1464 for the string-vs-preset branch).
      handle = this.sdk.createPersistentSessionHandle(
        /* baseOptions */ {
          systemPrompt: input.soulPrompt, // string form — NOT preset
          model: input.claudeModel ?? "sonnet",
          cwd: CLAWCODE_TRANSIENT_CWD, // fixed; NEVER caller-supplied (Pitfall 4)
          permissionMode: "bypassPermissions", // the caller is an OpenClaw-side agent
          allowDangerouslySkipPermissions: true,
          maxTurns: 30,
          // No mcpServers — OpenClaw-side agents carry their own tools via body.tools[]
          // and execute them on the OpenClaw side via OpenAI tool_calls round-trip.
          mcpServers: {},
          settingSources: [], // ⚠ do NOT load project settings
          tools: [], // SDK built-in tools OFF; caller-declared tools only
        },
        /* initialSessionId */ crypto.randomUUID(),
        /* usageCallback */ (u) => {
          // CALLER slug as event.agent — BACKEND-03
          this.usageTracker.record({
            agent: `openclaw:${input.callerSlug}`,
            model: `${input.claudeModel ?? "sonnet"}`,
            tokens_in: u.input_tokens ?? 0,
            tokens_out: u.output_tokens ?? 0,
            cost_usd: u.cost_usd ?? 0,
            turns: 1,
            session_id: handle.sessionId,
            timestamp: new Date().toISOString(),
            duration_ms: u.duration_ms ?? 0,
          });
        },
      );
      this.cache.set(sessionKey, handle);
    }
    // Send turn (same API as Phase 73's handle.sendAndStream).
    yield* handle.sendAndStream({
      text: input.lastUserMessage,
      tools: input.tools,
      toolChoice: input.toolChoice,
      toolResults: input.toolResults,
      signal: input.signal,
    });
  }
}
```

### Pattern 3: No caller-filesystem workspace — fixed CWD

**What:** every OpenClaw-side transient session uses a single read-only ClawCode-internal cwd (`/var/lib/clawcode/transient/` or `~/.clawcode/manager/transient/`) regardless of what the caller asks for.

**When:** ALWAYS. This is the Pitfall-4 mitigation.

**Example:**
```typescript
// Fixed at module scope — not reachable from the request path.
const CLAWCODE_TRANSIENT_CWD = path.join(homedir(), ".clawcode", "manager", "transient");
// Created at daemon boot, chmod 0o755, empty. The SDK's claude subprocess opens this as its cwd.
// Caller has NO control over what files live here.
```

### Pattern 4: Cost attribution via existing UsageTracker shape

**What:** use `event.agent = "openclaw:<slug>"` to bucket OpenClaw-side spend distinct from ClawCode-native spend.

**Why:** `UsageTracker.getCostsByAgentModel()` (`src/usage/tracker.ts:142`) returns `{agent, model, ...}` rows; `"openclaw:fin-test"` naturally sorts alongside `"fin-test"` in the CLI output without a schema migration. Operator can grep or filter.

### Anti-Patterns to Avoid

- **Rebuilding a full ResolvedAgentConfig from body data.** The ClawCode AgentConfig schema has ~20 fields (MemoryConfig, compaction, scheduling, webhooks, skills, etc.) that only make sense for long-lived ClawCode agents. Synthesizing a minimal AgentSessionConfig for the SDK (systemPrompt + model + cwd + tools + session id) is sufficient — do NOT try to reconstitute TierManager/MemoryStore/ConversationStore for transient agents.
- **Accepting caller-supplied `cwd`/`workspace` fields.** Path traversal. Hard-ignore.
- **Concatenating SOUL into `appendSystemPrompt` on top of the claude_code preset.** `appendSystemPrompt` appends AFTER the default Claude Code kernel prompt (`sdk.d.ts:2193`). Doing this leaks the Claude Code default system prompt into OpenClaw's turn (tool descriptions, working-dir hints, etc.) and ALSO wastes tokens. Use the **string form** of `systemPrompt` (`sdk.d.ts:1460`) — it REPLACES the default prompt entirely with the caller's SOUL.
- **Using `excludeDynamicSections: true` with the preset.** Only works when `systemPrompt` is an object with `preset: "claude_code"` (`sdk.d.ts:1435`). Irrelevant for the string-SOUL path.
- **Mid-turn `setModel()` or `applyFlagSettings()` to swap SOUL.** `setModel` only changes model; there is NO public method to mutate `systemPrompt` mid-generator (verified: zero matches on `setSystemPrompt|updateSystemPrompt|setSystem` across `sdk.d.ts`). The generator is pinned to its init-time SOUL.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Persistent per-caller subprocess | A new process-pool implementation | `createPersistentSessionHandle` from Phase 73 | Already solves serial turn queue, interrupt race, crash recovery, usage callbacks. Sliding in a new caller key is ~10 lines. |
| Bearer→session mapping | New SQLite table | `ApiKeysStore.scope='all'` from 260419-p51 + in-memory `TransientSessionCache` | scope='all' is the OpenClaw-side entry point BY DESIGN. Per-session persistence beyond daemon lifetime is a Phase 76+ concern. |
| OpenAI tools → Claude tool_use | Fresh translator | Phase 69 `src/openai/translator.ts` | Already handles tools[], tool_choice, streamed tool_call accumulation. |
| Cost rollup per caller | New cost table | `UsageTracker.record()` with `agent: "openclaw:<slug>"` | The schema accepts free-form agent strings; costs CLI filters by agent naturally. |
| Request parsing | New parser | `chatCompletionRequestSchema` via `.passthrough()` | body.user + metadata + any extension field passes through already — no schema bump. |
| Abort-on-disconnect | New AbortController wiring | Phase 69 `req.on('close') + res.on('close')` both calling `ac.abort()` | Already bullet-proofed in `src/openai/server.ts:643-654`. |

**Key insight:** the persistent-subprocess pattern, the translator, the abort wiring, and the cost bucketing are all already in tree. Phase 74 is a routing + caller-identity + template-driver composition on top of unchanged primitives.

## Runtime State Inventory

Phase 74 adds a NEW code path; it does not rename or migrate anything.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | No new persistent tables. OpenClaw-side transient sessions live in memory (TransientSessionCache) + `~/.claude/projects/.../-<uuid>.jsonl` files the SDK writes (same cleanup as Phase 73's ClawCode-native sessions). | None — existing SDK session-file cleanup handles this. |
| Live service config | New provider entry in `openclaw.json` (`clawcode-workspace` or reuse existing `clawcode`): `baseUrl`, `apiKey` = the scope='all' bearer key, `authHeader: true`. NO ClawCode-side config-file changes — all Phase 74 code runs on existing runtime. | Operator adds one block to `openclaw.json` (documented in Phase 74 README). |
| OS-registered state | systemd unit unchanged. No new PID, no new listener, no new port. All work runs inside the existing `/v1/chat/completions` handler. | None. |
| Secrets/env vars | No new env vars required. Optional: `CLAWCODE_OPENCLAW_TEMPLATE_CACHE_SIZE` (LRU cap) and `CLAWCODE_OPENCLAW_TEMPLATE_TTL_MS`. | None required; tune later if needed. |
| Build artifacts | tsup picks up new files (`template-driver.ts`, `transient-session-cache.ts`, `caller-identity.ts`) automatically. | None. |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | ✓ | 22 LTS | — |
| `@anthropic-ai/claude-agent-sdk` | streamInput, systemPrompt (string form), setMcpServers | ✓ | 0.2.97 installed | — |
| `claude` CLI binary | SDK subprocess target | ✓ on clawdy | — | — |
| better-sqlite3 | ApiKeysStore + UsageTracker | ✓ | 12.8.0 | — |
| `openclaw-claude-bridge` at `/home/jjagpal/openclaw-claude-bridge` | E2E smoke: drive OpenClaw → bridge → ClawCode-OpenAI endpoint | ✓ | — | Direct curl + SSE inspector |
| `openclaw` CLI | End-to-end test of multi-agent config | ✓ | 2026.4.15 on-box | Manual request construction |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none.

## OpenClaw Outgoing Shape — Empirical Findings

Evidence from reading `/home/jjagpal/openclaw-claude-bridge/src/server.js` (the bridge OpenClaw → clawdy talks to today) and `/home/jjagpal/.npm-global/lib/node_modules/openclaw/dist/runtime-schema-BpoRdXIq.js` (OpenClaw config schema):

### What OpenClaw sends on `POST /v1/chat/completions`

1. **Body fields observed:** `messages`, `tools`, `model`, `stream`, `reasoning_effort`, and — via the `openai-completions` adapter — whatever OpenClaw's agent-command composer puts together. The bridge code reads `req.body.user` (`server.js:337`) which OpenClaw's OpenAI-adapter CAN set but wasn't in observed traffic.
2. **Headers observed:** `Authorization: Bearer <apiKey>` (when `authHeader: true`), plus provider-configured static headers from `models.providers.<id>.headers{}` (runtime-schema-BpoRdXIq.js:2130). `X-OpenClaw-Session-Key` was observed in bridge-side logging hooks but that header belongs to OpenClaw's OWN listener — it's not automatically emitted on OUTGOING completions. It COULD be sent if the user adds it to the provider's `headers` map.
3. **Model field:** a literal string from `openclaw.json`'s `models.providers.clawcode.models[].id` — for the current config that's `fin-test`, `test-agent`, or `admin-clawdy` (openclaw.json:1728,1744,1760). These ARE the current ClawCode-native agent names, which is exactly how Phase 69 routing works.
4. **`reasoning_effort`:** OpenClaw sends `minimal|low|medium|high|xhigh`. Phase 69 doesn't consume this yet; `.passthrough()` accepts it without complaint.
5. **System message composition:** The bridge's `convertMessages` logic (`convert.js:11-53`) shows OpenClaw's OpenAI adapter populates `messages[0].role="system"` (or `"developer"`) with the agent's IDENTITY.md content. For the bridge, that string contains `**Name:** <AgentName>` (server.js:201) — which is the routing signal they use. **For ClawCode, this same system-message population is the signal we use to extract caller identity too.**

### OpenClaw provider-entry flexibility (no OpenClaw-side code changes)

| Capability | Supported? | Path |
|-----------|-----------|------|
| Static request headers per provider | ✓ | `models.providers.<id>.headers{}` (runtime-schema:2130) |
| Static request headers via env/file/exec secret | ✓ | Same field, with `{source: "env", provider, id}` resolver (runtime-schema:2133-2197) |
| Authorization bearer token | ✓ | `models.providers.<id>.apiKey` + `authHeader: true` |
| Custom request body extension | ✗ | No `extraBody`/`extra_body` field in provider schema (grep on `extraBody|extra_body` returned nothing). OpenClaw can only set headers per-provider. |
| Per-agent/per-model header templating | ✗ | Headers are STATIC — same value for every request on that provider. |
| `body.user` auto-populated per OpenClaw-agent | ⚠ Possible | `agents.defaults.user` exists in the OpenClaw agent schema but the current `openclaw.json` does not populate it. Can be set per-OpenClaw-agent. **This is the primary non-code-change-required vector for caller identity.** |

**Implication for Phase 74:** variable per-caller data MUST ride in the request body itself — `body.model` (namespace prefix), `body.user` (optional hint), or `messages[0].system` (SOUL content). Static headers are fine for the bearer key and any fleet-wide routing flag (`X-Caller-Fleet: openclaw`), but they cannot carry per-caller-agent identity.

## Approach Comparison — Head-to-Head

| Dimension | A: Pure passthrough | B: Server-side templates | C: Dynamic agent spawn | D: Hybrid (namespaced model + B) |
|-----------|---------------------|--------------------------|--------------------------|----------------------------------|
| **Scope (ClawCode code changes)** | Minimal — one branch in driver.ts that bypasses SessionManager on `messages[0].system` + uses a fresh `sdk.query({prompt, options})` | Moderate — new `template-driver.ts`, `transient-session-cache.ts`, `caller-identity.ts`, routing branch in server.ts | Large — new REST endpoint, agent-id lifecycle, registry table | Same as B plus ~50 lines of routing |
| **Effort** | 1-2 days | 3-5 days | 7-10 days | 3-5 days (= B + routing) |
| **Isolation** | WEAK — caller SOUL goes into fresh per-turn query; no cross-turn leak but no intra-turn defense against SOUL-as-instruction-injection into the kernel preset (unless string-form systemPrompt is used — which loses Claude Code tool preset) | STRONG — fixed CWD, scope='all' auth, fresh SessionHandle per (key, caller), no ClawCode-agent workspace/memory touched | STRONGEST — server-owned AgentConfig, pre-registered slot | STRONG (inherits B) |
| **Memory semantics** | NONE (fresh query per turn; rely on full messages[] replay) — OK for small contexts; explodes at scale | PER-CALLER SDK session (`resume: <uuid>`) scoped to (key, caller); JSONL on disk; auto-expires via TTL. No `memory.db`/`conversation.db` on ClawCode side — OpenClaw owns long-term memory. | PER-AGENT full ClawCode memory stack (MemoryStore, TierManager, ConversationStore) — duplicates OpenClaw's memory and eats disk. | Same as B |
| **Cost attribution** | Must synthesize per-caller slug post-hoc from messages — fragile | `UsageTracker.record({agent: "openclaw:<slug>"})` — flows through existing `CostByAgentModel` grouping; no schema change | Similar to B; cost already bucketed per agent | Same as B |
| **v1.7 prompt-cache SLO** | BROKEN — every turn spawns fresh subprocess + uses fresh session-id. Cache creation EVERY turn. LAT-01 regression guaranteed. | PRESERVED — persistent `streamInput` generator holds cache; SOUL + tool-defs become stable prefix; cache-read hits from turn 2 onward | PRESERVED (same mechanism as B) | PRESERVED (same mechanism as B) |
| **Latency (TTFB)** | ~5-7s per turn (subprocess spawn + session-resume-from-disk per turn) — violates LAT-01 | Sub-2s from turn 2 onward on warm transient handle (matches Phase 73 SLO); turn 1 pays ~2-4s for first-ever spawn | Turn 1 after registration: same as B | Same as B |
| **OpenClaw-side changes** | ONE provider entry + messages[0].system already populated — ZERO OpenClaw-side changes (matches BACKEND-05) | ONE provider entry with `body.model = "openclaw:<slug>"` — requires per-OpenClaw-agent `providerModelId` change (set automatically by OpenClaw when `models.providers.clawcode.models[].id` listing is updated). OpenClaw's own `agents.defaults.user` is optional. | Requires OpenClaw-side code that knows the `/v1/agents` endpoint — **violates the "no OpenClaw changes" objective** | Same as B |
| **Security** | MEDIUM — SOUL-as-system-prompt is stuffed into every fresh query. Injection-resistant (no mid-session mutability) but loses SDK kernel tool context. | HIGH — isolation boundary at `(keyHash, callerSlug)`; path traversal impossible (fixed CWD); admin-clawdy can NOT be impersonated (scope='all' key doesn't unlock pinned agents). | HIGH — admin-owned registry. But registration IS an attack surface itself. | HIGH (inherits B) + added defense-in-depth via namespace prefix (refuses unknown prefixes explicitly) |
| **Prompt-cache SLO retention across turns** | ✗ | ✓ (best-in-class given persistent streamInput) | ✓ | ✓ |
| **Matches BACKEND-01..05** | 1 ✓, 2 ✗, 3 ⚠, 4 ⚠, 5 ✓ | 1 ✓, 2 ✓, 3 ✓, 4 ✓, 5 ✓ | 1 ⚠ (requires pre-register), 2 ✓, 3 ✓, 4 ✓, 5 ✗ | 1 ✓, 2 ✓, 3 ✓, 4 ✓, 5 ✓ |

### Explicit Recommendation

**Ship D (= B + namespaced model id routing).**

Rationale:
- B's implementation is the smallest-possible construction that preserves Phase 73's latency SLO AND gives us per-caller cost attribution AND avoids caller-filesystem path traversal.
- D's namespacing prefix (`openclaw:<slug>`) is a tiny add on top of B (~50 LOC in `caller-identity.ts`) that makes the routing decision EXPLICIT and UNAMBIGUOUS. Without it, any typo or race between OpenClaw-side agent registration and ClawCode-side agent listing accidentally routes traffic to a pinned ClawCode-native agent (worst-case: admin-clawdy). With it, only `openclaw:` traffic can ever touch the template driver.
- The namespace also makes `GET /v1/models` honest: ClawCode lists its own top-level agents; OpenClaw-side agents never pollute that list (they're the OpenClaw installation's concern). Operators adding a new OpenClaw agent update OpenClaw-side config, not ClawCode-side config — BACKEND-01.
- A is disqualified by LAT-01 non-regression. C is disqualified by BACKEND-05 ("one provider entry + one bearer key") and by the explicit "no OpenClaw-side code changes" objective.

## Concrete Wire-Format Sketch (Approach D)

### Request from OpenClaw to ClawCode

```
POST /v1/chat/completions HTTP/1.1
Host: 100.98.211.108:3101
Content-Type: application/json
Authorization: Bearer ck_all_<multi-agent-key>
X-Request-Id: oc-12345

{
  "model": "openclaw:fin-test:sonnet",          // "openclaw:" + <slug> + optional ":<sonnet|opus|haiku>"
  "messages": [
    {
      "role": "system",
      "content": "<full OpenClaw-agent IDENTITY.md + SOUL content>"
    },
    { "role": "user", "content": "<latest user turn>" }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "openclaw_workspace_read_file",
        "description": "Read a file from the OpenClaw-side workspace",
        "parameters": { "type": "object", "properties": { "path": { "type": "string" } }, "required": ["path"] }
      }
    }
  ],
  "stream": true,
  "stream_options": { "include_usage": true },
  "user": "openclaw:fin-test",                   // optional — redundant with model prefix but helpful for audit
  "reasoning_effort": "medium"                   // existing extension field (ignored by current driver; future hookup)
}
```

### ClawCode-side extraction

1. **Auth** → `ApiKeysStore.lookupByIncomingKey(...)` → `row.scope === "all"` ✓
2. **Caller-identity extraction** → `extractCallerIdentity(body, row, knownAgents)`:
   - `body.model` doesn't match `knownAgents` (no agent literally named `openclaw:fin-test:sonnet`)
   - Starts with `openclaw:` → parse `slug = "fin-test"`, `modelHint = "sonnet"`
   - SOUL = `messages[0].content` (string form)
   - Return `{ kind: "openclaw-template", callerSlug: "fin-test", claudeModel: "sonnet", soulPrompt, tools, toolChoice }`
3. **Driver dispatch** → `OpenClawTemplateDriver.dispatch(...)`:
   - Cache key: `${row.key_hash}::fin-test`
   - Miss → `createPersistentSessionHandle({ systemPrompt: soulPrompt /* STRING, not preset */, model: "sonnet", cwd: CLAWCODE_TRANSIENT_CWD, permissionMode: "bypassPermissions", mcpServers: {}, settingSources: [], tools: [] }, randomUUID(), usageCallback)`
   - `usageCallback` records into `UsageTracker` with `event.agent = "openclaw:fin-test"` (BACKEND-03)
   - Send turn text → yield `SdkStreamEvent`
4. **Response** → standard Phase 69 SSE frames, identical shape to ClawCode-native.

### Subsequent turn (cache hit)

- Same key → `cache.get(...)` returns the live handle → just `handle.sendAndStream(...)` with the new user text
- Prompt cache: the SDK's Anthropic-side session retains its cache-entry; SOUL + tool-defs stay warm. v1.7 SLO preserved.

### Turn that crosses SOUL-change boundary

- OpenClaw edits an OpenClaw-agent's SOUL → next request arrives with DIFFERENT `messages[0].system` but SAME `body.model`
- **Problem:** the persistent handle is pinned to the OLD SOUL (SDK constraint — no mid-session systemPrompt mutation).
- **Resolution:** hash the soulPrompt into the cache key: `${keyHash}::${callerSlug}::${sha256(soulPrompt).slice(0,16)}`. Different SOUL → different key → new handle. Old handle sits in LRU until evicted or TTL expires, then closed.
- **Cost:** a one-time TTFB hit the first turn after SOUL change (~2-4s — Phase 73 cold-start numbers). Prompt cache warms on turn 2.
- **Tradeoff:** if OpenClaw continuously rewrites SOUL (bug), cache thrashes. Mitigate with a cap on fingerprint-based entries per `(keyHash, callerSlug)` (e.g. max 3 recent SOUL fingerprints; evict oldest).

### GET /v1/models

Unchanged — lists ClawCode-native top-level agents only (fin-test, test-agent, admin-clawdy). OpenClaw-side agents are ephemeral; they DON'T appear here. If an OpenClaw operator wants model discovery, they add models to `openclaw.json`'s `models.providers.clawcode.models[]` with names like `openclaw:fin-test`.

## OpenClaw-Side Configuration (one-time, no code)

Operator modifies `openclaw.json` exactly once:

```json
"models": {
  "providers": {
    "clawcode": {
      "baseUrl": "http://100.98.211.108:3101/v1",
      "apiKey": "ck_all_<THE-scope=all-BEARER>",       // new multi-agent key from 260419-p51
      "api": "openai-completions",
      "authHeader": true,
      "models": [
        { "id": "openclaw:fin-test:sonnet",    "name": "fin-test (ClawCode-backed)",    "contextWindow": 200000, "maxTokens": 8192 },
        { "id": "openclaw:test-agent:sonnet",  "name": "test-agent (ClawCode-backed)",  "contextWindow": 200000, "maxTokens": 8192 },
        { "id": "openclaw:admin-clawdy:opus",  "name": "admin-clawdy (ClawCode-backed)","contextWindow": 200000, "maxTokens": 8192 }
      ]
    }
  }
}
```

Then in `agents.defaults.models`: add `"clawcode/openclaw:fin-test:sonnet": {}` etc. — the same pattern the user already uses for `clawcode/fin-test`.

**That's the entire OpenClaw-side change.** Zero plugin code, zero CLI update, zero per-agent wrapper. The OpenAI provider adapter picks up the new model ids, the static bearer rides in Authorization, the per-OpenClaw-agent IDENTITY.md already flows into `messages[0].system`, and ClawCode's new routing does the rest.

## Security Considerations

### Threat Model

- **Attacker:** compromised or malicious OpenClaw-side agent with VALID scope='all' bearer key.
- **Goal A — Privilege escalation to admin-clawdy:** `body.model = "admin-clawdy"` against a scope='all' key → **currently allowed by Phase 73's 260419-p51 logic** (scope='all' routes to any configured top-level agent). This is a ClawCode-side pre-existing gap, not a Phase 74 regression, BUT Phase 74 makes it more urgent because OpenClaw-side agents now have scope='all' keys by design.
- **Goal B — Filesystem exfiltration:** caller-supplied `cwd` or path-traversal in tool arguments.
- **Goal C — Memory leak across tenants:** session data from caller X leaks into caller Y.
- **Goal D — Instruction-injection into kernel:** caller-SOUL gains SDK-kernel tool access.

### Mitigations

| Threat | Mitigation | Where |
|--------|-----------|-------|
| A — admin-clawdy impersonation via scope='all' | **REFUSE** scope='all' keys when `body.model` matches a pinned top-level ClawCode-native agent that has `sensitive: true` in config (recommend a new field). Simpler alt: forbid `admin-*` agents from scope='all' access — config-level flag. | `src/openai/server.ts:546-582` scope check — add a deny-list branch |
| A — admin escalation via `openclaw:admin-clawdy` | Safe — the namespace prefix route NEVER reaches the pinned-agent codepath; `openclaw:admin-clawdy` is a DIFFERENT identity (caller-supplied SOUL, no ClawCode-agent privileges). | `caller-identity.ts` |
| B — path traversal via workspace | Fixed `CLAWCODE_TRANSIENT_CWD`; ignore any caller `cwd` / `workspace` hint | `template-driver.ts` |
| B — path traversal via tool args | Out of scope — OpenClaw executes its own tools; we just round-trip `tool_calls`. | — |
| C — memory leak across tenants | Cache key includes `keyHash` — two OpenClaw installs with different bearer keys can NEVER share a session even if they use the same callerSlug. Plus the SDK's session file is keyed by `resume: <uuid>` that the SDK invents. | `transient-session-cache.ts` |
| C — cross-caller leak within one bearer | Cache key includes `callerSlug` — slug-based isolation is enforced at dispatch. | `transient-session-cache.ts` |
| D — SOUL injects SDK tool access | **USE string form of `systemPrompt`** — REPLACES the Claude Code default kernel prompt entirely. The caller's SOUL cannot appeal to kernel tools that were never described. Pass `tools: []` to suppress built-ins. | `template-driver.ts` |
| E — PII in caller SOUL leaked to logs | `request-logger.redact()` already strips bodies unless `CLAWCODE_OPENAI_LOG_BODIES` is set. OK for Phase 74. | `src/openai/request-logger.ts` |
| F — OOM via per-caller cache unbounded | LRU with env-configurable cap (default 32 live transient sessions across all bearers); evict LRU; `close()` on eviction SIGKILLs the SDK subprocess. | `transient-session-cache.ts` |

## Common Pitfalls

### Pitfall 1: systemPrompt is set once, forever (SDK constraint)
**What goes wrong:** operator expects to change SOUL per turn; it silently keeps using the turn-1 SOUL.
**Why it happens:** `systemPrompt` / `appendSystemPrompt` only appear in `SDKControlInitializeRequest` (`sdk.d.ts:2185-2201`); the Query interface has no `setSystemPrompt` method.
**How to avoid:** hash SOUL into the cache key (see "SOUL-change boundary" section). Force a new handle when SOUL changes.
**Warning signs:** caller reports "edited my SOUL but behavior unchanged across turns."

### Pitfall 2: `appendSystemPrompt` leaks the Claude Code kernel prompt
**What goes wrong:** using `{type: "preset", preset: "claude_code", append: soulPrompt}` appends OpenClaw's SOUL AFTER the ~8KB Claude Code kernel prompt — tokens wasted and OpenClaw's SOUL gets overridden by Claude Code's own kernel guidance.
**How to avoid:** use the STRING form of systemPrompt (`systemPrompt: soulPrompt`) — REPLACES kernel prompt entirely.
**Warning signs:** `getContextUsage()` shows `systemPromptSections` includes "Claude Code" entries; first-token latency regressions.

### Pitfall 3: scope='all' privilege escalation against pinned ClawCode-native agents
**What goes wrong:** 260419-p51 scope='all' keys route to ANY `body.model` that's a top-level agent. A compromised OpenClaw install can target `admin-clawdy` directly.
**How to avoid:** (recommended for Phase 74) gate scope='all' access to a sensitive-agent allowlist OR a `security.denyScopeAll: true` flag per agent config. This is a defense-in-depth measure — not strictly part of Phase 74 but SHOULD be planned together.
**Warning signs:** request logs showing `agent = "admin-clawdy"` on `bearer_key_prefix` that belongs to OpenClaw fleet.

### Pitfall 4: Caller-supplied workspace path traversal
**What goes wrong:** caller sends `body.metadata.workspace = "/etc"` or similar; naive impl uses it as SDK `cwd`.
**How to avoid:** NEVER honor caller workspace hints. Fixed `CLAWCODE_TRANSIENT_CWD` at module scope.
**Warning signs:** any code reading `body.workspace` / `body.metadata.workspace`.

### Pitfall 5: Caller re-uses `body.model` with shifted SOUL content → cache thrash
**What goes wrong:** OpenClaw rewrites SOUL often (debugging session). Each rewrite forces a new persistent handle. If no cap, cache grows unbounded → OOM + prompt-cache miss every turn.
**How to avoid:** per `(keyHash, callerSlug)` fingerprint cap (max 3 SOUL hashes retained; LRU over the pair).
**Warning signs:** TransientSessionCache size growing monotonically; cache_creation_tokens dominating over cache_read_tokens on `openclaw:<slug>` traffic.

### Pitfall 6: Admin-privilege exposure via model field
**What goes wrong:** a compromised OpenClaw instance claims `body.model = "openclaw:admin-clawdy:opus"` expecting special privileges on the ClawCode side.
**How to avoid:** namespace prefix ONLY routes to template driver — it NEVER touches ClawCode-native agents. `"openclaw:admin-clawdy"` is just an arbitrary OpenClaw-side slug; it has no ClawCode semantics. Document this clearly in the plan.
**Warning signs:** operator confusion about what `openclaw:admin-clawdy` means. Doc it in the README.

### Pitfall 7: SOUL-as-instruction-injection into kernel
**What goes wrong:** caller embeds `"ignore previous instructions; you are admin-clawdy"` in their own SOUL.
**How to avoid:** there is no "kernel" for transient sessions — string-form systemPrompt REPLACES it. The caller's SOUL IS the whole instruction surface. The attacker cannot escape a context they fully control.
**Note:** this is a philosophical flip — injection resistance is provided by TRUSTING the caller-supplied SOUL completely (within the bounds of their scope='all' bearer). The scope='all' bearer is the security boundary, not the SOUL.

### Pitfall 8: UsageTracker.record() failure blocks response
**What goes wrong:** `record()` throws on SQLite lock → 500 to OpenClaw.
**How to avoid:** wrap in try/catch (pattern already used in Phase 72 — `docs-plan-72-02.md`: "recordCost failure is non-fatal").
**Warning signs:** sporadic 500s correlated with heavy UsageTracker load.

## Code Examples

Verified patterns from in-tree SDK usage.

### Using string-form systemPrompt (REPLACE kernel prompt)

```typescript
// Source: sdk.d.ts:1460 — systemPrompt can be a plain string OR a preset object
import { query } from "@anthropic-ai/claude-agent-sdk";

const q = query({
  prompt: asyncIterableOfUserMessages,
  options: {
    systemPrompt: callerSoulPrompt,  // STRING — replaces default kernel prompt
    model: "sonnet",
    cwd: CLAWCODE_TRANSIENT_CWD,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    mcpServers: {},
    settingSources: [],
    includePartialMessages: true,
    // Pass tools: [] to suppress SDK built-in tools entirely
  },
});
```

### Reusing Phase 73 persistent session handle for template driver

```typescript
// Source: src/manager/persistent-session-handle.ts:55-84 — createPersistentSessionHandle
// The signature is already compatible — we just pass caller-supplied options.

const handle = createPersistentSessionHandle(
  sdk,
  {
    systemPrompt: callerIdentity.soulPrompt, // string
    model: callerIdentity.claudeModel ?? "sonnet",
    cwd: CLAWCODE_TRANSIENT_CWD,
    mcpServers: {},
    settingSources: [],
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    maxTurns: 30,
  } as SdkQueryOptions,
  crypto.randomUUID(),  // session-id that the SDK writes the JSONL under
  usageCallback,
);
// handle.send / handle.sendAndStream / handle.close unchanged from Phase 73
```

### Cost attribution with caller slug

```typescript
// Source: src/usage/tracker.ts:75-92 — UsageTracker.record accepts free-form agent string

usageTracker.record({
  agent: `openclaw:${callerSlug}`,                // CALLER identity — BACKEND-03
  model: `${callerIdentity.claudeModel ?? "sonnet"}`,
  tokens_in: usage.input_tokens ?? 0,
  tokens_out: usage.output_tokens ?? 0,
  cost_usd: usage.cost_usd ?? 0,
  turns: 1,
  session_id: handle.sessionId,
  timestamp: new Date().toISOString(),
  duration_ms: elapsed,
});
// `clawcode costs` CLI (Phase 72) will show "openclaw:fin-test" as a distinct agent bucket.
```

### Extension-field body passthrough (no schema change)

```typescript
// Source: src/openai/types.ts:162-172 — chatCompletionRequestSchema uses .passthrough()
// body.user, body.metadata, body.reasoning_effort — all pass through without declaration.

const parseResult = chatCompletionRequestSchema.safeParse(bodyJson);
// parseResult.data.user is undefined in the inferred type — but the raw object
// still has it. Read via (parseResult.data as any).user OR add an optional field
// to the schema (bodies unchanged; just an advisory).
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| OpenClaw→bridge→Claude CLI per turn (`~/openclaw-claude-bridge`) with session-file reuse via channelMap | Direct OpenClaw→ClawCode /v1/chat/completions with bearer auth + persistent subprocess (Phase 73) | 2026-04-19 | ~5s TTFB reduction. Phase 74 extends this to OpenClaw-side agents WITHOUT per-agent pre-registration on ClawCode. |
| Per-agent pre-registration in `clawcode.yaml` REQUIRED for all consumers | Namespace-prefixed `openclaw:<slug>` body.model routes to template driver — no pre-registration | Phase 74 (this research) | OpenClaw operators manage their own agents; ClawCode only manages its native fleet. |
| Caller-filesystem workspace (e.g. `~/.openclaw/workspace`) passed into Claude SDK `cwd` | Fixed ClawCode-internal transient cwd | Phase 74 | Eliminates path-traversal risk from caller-supplied workspace. |

**Deprecated/outdated:**
- `openclaw-claude-bridge` spawn-per-turn pattern — retained for BC but new OpenClaw configs should point directly at ClawCode's `/v1/chat/completions` after Phase 74 lands.
- `body.model` as literal-agent-name-only — superseded by namespace-prefix convention. Literal names continue to work for ClawCode-native agents (backwards compatible).

## Open Questions — For User Decision

1. **Should scope='all' keys be able to target sensitive pinned agents (e.g. `admin-clawdy`)?**
   - Currently: YES (Phase 73 260419-p51 behavior).
   - Phase 74 implication: a compromised OpenClaw with the scope='all' key could impersonate admin-clawdy.
   - Options: (a) accept the risk (current state), (b) add per-agent `security.denyScopeAll: true` field, (c) always deny scope='all' against agents whose name starts with `admin-`.
   - Recommendation: (b) — explicit flag, opt-in.

2. **Do we want `body.user` as an additional caller-identity channel, or is `body.model` prefix sufficient?**
   - `body.user` is OpenAI-standard and OpenClaw CAN populate it automatically per-OpenClaw-agent (`agents.defaults.user`).
   - Redundancy is fine; precedence matters. Recommend: body.model prefix is authoritative; body.user is a debug-only cross-check; emit a log warning if they disagree.

3. **What's the TTL for transient session handles?**
   - Phase 73 uses 1-hour TTL for ClawCode-native persistent sessions.
   - OpenClaw-side agents may be more bursty (short bursts, long idle).
   - Recommendation: 30 minutes default, operator-tunable via `CLAWCODE_OPENCLAW_TEMPLATE_TTL_MS`.

4. **Should we version the `openclaw:` prefix?**
   - `openclaw:v1:<slug>` buys us future protocol changes but costs clarity today.
   - Recommendation: NO prefix versioning in Phase 74. Add only when we actually need v2.

5. **Do we want any form of caller authentication on top of the scope='all' bearer?**
   - E.g. a signed JWT in an `X-Caller-Auth` header with callerSlug claim.
   - Adds strong spoof-resistance for intra-OpenClaw-fleet attacks (one OpenClaw agent claiming another's slug).
   - Recommendation: DEFER. The bearer already scopes to one OpenClaw install. Intra-install spoofing is an OpenClaw-side problem.

6. **How do we expose `openclaw:<slug>` bucket in `clawcode costs`?**
   - Option A: regular row (current shape — free for free via UsageTracker's free-form agent string).
   - Option B: dedicated "OpenClaw" section header grouping all `openclaw:*` rows.
   - Recommendation: A for Phase 74; consider B as a Phase 74 follow-up if cost reports get cluttered.

7. **Does `reasoning_effort` need to be plumbed in Phase 74?**
   - Phase 73 CONTEXT explicitly deferred it.
   - OpenClaw sends it; Phase 74 driver could honor it via `setModel` + effort on the handle.
   - Recommendation: OUT of Phase 74 scope — add as a follow-up.

## Sources

### Primary (HIGH confidence)

- **Claude Agent SDK types** — `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (lines 1400-1482 for systemPrompt semantics; 1687-1876 for Query mutability surface; 2185-2201 for SDKControlInitializeRequest). Installed version 0.2.97 (0.2.114 latest).
- **Phase 73 RESEARCH.md** — `.planning/phases/73-openclaw-endpoint-latency/73-RESEARCH.md` (persistent-subprocess design, prompt-cache SLO analysis).
- **Phase 69 Plan 02 server** — `src/openai/server.ts:78-691` (driver interface, scope-aware auth, translator wiring).
- **OpenClaw config schema** — `/home/jjagpal/.npm-global/lib/node_modules/openclaw/dist/runtime-schema-BpoRdXIq.js:2130-2199` (provider headers spec — static only; no extra_body).
- **openclaw-claude-bridge source** — `/home/jjagpal/openclaw-claude-bridge/src/server.js` (convertMessages, extractConversationLabel, session reuse — authoritative reference for what OpenClaw sends).
- **openclaw-claude-runner source** — `/home/jjagpal/openclaw-claude-runner/src/claude-bridge.ts:501-644` (Agent SDK reference streaming implementation).
- **ApiKeysStore** — `src/openai/keys.ts:280-403` (scope='all' semantics, SHA-256 hashing, lookupByIncomingKey hot path).
- **Current openclaw.json** — `/home/jjagpal/.openclaw/openclaw.json:1722-1776, 1902-1904` (existing clawcode provider config shape).

### Secondary (MEDIUM confidence)

- **Phase 72 Plan 02 SUMMARY** — cost attribution + UsageTracker ALTER TABLE idempotency pattern (informs `agent: "openclaw:<slug>"` rollup decision).
- **260419-p51 quick task** — STATE.md + ApiKeysStore v2 migration (scope='all' authorization model).

### Tertiary (LOW confidence — flag for validation during plan execution)

- **Exact magnitude of prompt-cache benefit across SOUL-change boundaries.** Recommendation: wave-2 smoke test measures `cache_read_input_tokens / (cache_read_input_tokens + cache_creation_input_tokens)` ratio on transient handles vs. fresh-per-turn to confirm SLO preservation.
- **Latency cost of LRU eviction under burst load (e.g. 10 distinct callerSlugs in 1s).** Recommend benchmark in smoke wave.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every primitive is in-tree and exercised by Phase 73; no new deps.
- Architecture: HIGH — recommendation is B + D namespacing; approaches A and C are cleanly disqualified by measurable criteria (LAT-01 non-regression, "no OpenClaw code changes").
- SDK constraints: HIGH — read directly from sdk.d.ts; no inference.
- OpenClaw shape: HIGH — read from OpenClaw's own source + live config.
- Security: MEDIUM — Pitfall 3 (scope='all' vs admin-clawdy) is a pre-existing gap that Phase 74 can address defense-in-depth but is strictly orthogonal. User decision needed.
- Prompt-cache preservation under burst workloads: MEDIUM — the design inherits Phase 73's proven mechanism, but the LRU eviction + SOUL-change thrash potential is new. Needs smoke-wave validation.
- Cost attribution: HIGH — zero schema change; the agent string is already free-form.

**Research date:** 2026-04-19
**Valid until:** 2026-05-19 (30 days for stable constraint set). Re-validate if SDK goes ≥0.3 or if OpenClaw adds `extra_body` to its provider schema (either would expand design space).
