# Phase 89: Agent Restart Greeting — Research

**Researched:** 2026-04-23
**Domain:** SessionManager lifecycle hook + Discord webhook embed delivery + Haiku one-shot summarization
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (verbatim from CONTEXT.md §Decisions)

**Triggers**
- **D-01:** Greeting fires **only** on `SessionManager.restartAgent()`. Neither the initial `startAgent()` from a fresh config nor `startAll()` boot-reconcile emit a greeting.
- **D-02:** Daemon `startAll()` stays silent. Agents reload memory and resume normally; operators learn "daemon came up" from logs, not Discord.
- **D-03:** Forks (`buildForkName` prefix from `src/manager/fork.ts`) and subagent threads (thread-origin detection from v1.2 `subagent-thread-spawner.ts`) are skipped — no greeting for either.
- **D-04:** Crash recovery vs clean restart use **different embed templates** when classifiable. Clean: "I'm back — last session: X." Crash: "Recovered after unexpected shutdown — last stable state: X." Classifier sources: `registry.restartCount` delta + `session-recovery.ts` signals (if not reliably classifiable on a given path, default to clean template).

**Greeting content**
- **D-05:** Summary source is a **fresh Haiku summarization at restart-time**, NOT a verbatim reuse of `assembleConversationBrief`. Reuse `summarizeWithHaiku` with a Discord-tuned prompt if coupling allows.
- **D-06:** Target length: **under ~500 characters** in embed description.
- **D-07:** Surface **only the prior-session summary**. Exclude last-active timestamp, active model, active effort, open-loops list.
- **D-08:** **Agent's first-person voice** via the v1.6 webhook identity (per-agent avatar + display name from `webhook-manager.ts`).

**Fleet scope & opt-in**
- **D-09:** Per-agent config flag `agents.*.greetOnRestart: boolean` with `defaults.greetOnRestart` fallback (default `true`). Additive-optional (Phase 83/86 pattern). Reloadable — takes effect on next restart without daemon bounce. Future persistence via Phase 86 atomic writer sibling.
- **D-10:** Dormancy threshold: **skip greeting if agent's last activity > 7 days** (ConversationStore last-turn-timestamp).
- **D-11:** **Empty-state: skip greeting entirely.** No fallback minimal greeting.
- **D-12:** Shared-workspace agents: each agent greets its own bound channel on its own individual restart. No cross-sibling fan-out.

**Delivery & dedup**
- **D-13:** **Webhook + EmbedBuilder.** Per-agent webhook identity (v1.6 `webhook-provisioner.ts`). Subject to v1.2 `DiscordDeliveryQueue` retry + failed-message log. (Planner note: DeliveryQueue is text-only — see Finding 6 for reconciliation.)
- **D-14:** **Crash-loop suppression via per-agent cool-down.** Max 1 greeting per agent per **5-minute window** (default). Configurable via `defaults.greetCoolDownMs` / `agents.*.greetCoolDownMs`. In-memory daemon-scoped Map. Subsequent restarts within window skip silently (log debug).
- **D-15:** **New message every restart** — no edit-in-place.
- **D-16:** **Delivery failure: log + continue session start.** Phase 83/86/87 synchronous-caller + fire-and-forget + `.catch` log-and-swallow blueprint. Restart success MUST NOT depend on Discord availability.

### Claude's Discretion (verbatim from CONTEXT.md)
- Exact Haiku prompt wording for the <500-char Discord-tuned summary.
- Whether to reuse `SessionSummarizer` with a new prompt mode vs implement a thin sibling summarizer (`greetingSummarizer`).
- Crash-recovery classifier implementation.
- Embed visual shape (title, color, thumbnail reuse from webhook avatar, footer text).
- Whether the cool-down Map survives daemon boot (in-memory reset on boot is acceptable).
- Exact schema field names (`greetOnRestart` vs `greetingsEnabled` vs similar).

### Deferred Ideas (OUT OF SCOPE — verbatim from CONTEXT.md)
- Slash-command toggle `/clawcode-greet on|off`.
- Observability metrics (greetings sent / skipped / failed counters).
- Per-channel greet policy.
- Edit-in-place greeting mode.
- Greeting for fork sessions.
- Active model + effort surface in greeting.
</user_constraints>

## Phase Requirements

Phase 89 has no formal `REQ-ID` entries in REQUIREMENTS.md — the 16 decisions ARE the spec. This research proposes the following synthesized IDs the planner should lock into 89-PLAN.md `<read_first>` blocks for 1:1 traceability:

| ID | Decision → Behavior | Research Support |
|----|---------------------|------------------|
| GREET-01 | D-01/D-02: greeting emits ONLY from `restartAgent()` callsite (not `startAgent`, not `startAll`, not IPC fallback `startAgent`). | Finding 1 — exact chokepoint at `session-manager.ts:938` post-`startAgent`. |
| GREET-02 | D-03: skip fork (`-fork-<nanoid6>`) and subagent-thread (`-sub-<nanoid6>`) agent names. | Finding 2 — exact regex from `fork.ts:25-27` + `subagent-thread-spawner.ts:98`. |
| GREET-03 | D-04: crash-vs-clean classifier (when classifiable) → distinct embed templates. Default clean. | Finding 3 — table of signals + reliability. |
| GREET-04 | D-05/D-06: fresh Haiku summarization with Discord-tuned prompt; <500-char target. | Finding 4 — reuse `summarizeWithHaiku` directly + new prompt builder. |
| GREET-05 | D-10/D-11: skip when agent is dormant (>7d) OR empty-state (no terminated session). | Finding 5 — `listRecentTerminatedSessions(name, 1)` + endedAt timestamp. |
| GREET-06 | D-08/D-13: webhook embed delivery via `webhookManager.sendAsAgent` OR direct `webhookManager.send` with embed option. | Finding 6 — existing `sendAsAgent` signature accepts `EmbedBuilder`. |
| GREET-07 | D-09: schema additions `agents.*.greetOnRestart` + `defaults.greetOnRestart` (bool, default true), classified reloadable. | Finding 7 — verbatim Phase 83/86 additive-optional pattern. |
| GREET-08 | D-14: per-agent 5-min cool-down via daemon-scoped `Map<string, number>`. | Finding 8 — mirror `ConversationBriefCache` shape. |
| GREET-09 | D-16: fire-and-forget at the `restartAgent()` callsite, never blocks restart success. | Finding 9 — Phase 83 canary at `persistent-session-handle.ts:639`. |
| GREET-10 | D-15: new message per restart (no edit-in-place, no messageId persistence). | Finding 6 — webhook `send` returns a fresh message. |

## Project Constraints (from CLAUDE.md)

- **Identity rule:** Every response includes 💠 emoji and Clawdy voice — not relevant to implementation but relevant to Discord embed copy reviewed during testing.
- **Stack pins (from project CLAUDE.md):** TypeScript, Node 22 LTS, `@anthropic-ai/claude-agent-sdk` pinned to exact `0.2.97` (v2.2 convention), `better-sqlite3@12.8.0`, `discord.js@14.26.2`, `yaml@2.8.3`, `zod@4.3.6`. **Zero new npm deps expected** for Phase 89 — every surface reuses v1.2/v1.6/v1.7/v1.9/Phase 83/86/87 infra.
- **Immutability rule (rules/coding-style.md):** Cool-down Map entries replaced, not mutated; frozen objects for result types.
- **Many-small-files rule:** New greeting helper module (`src/manager/restart-greeting.ts` — recommended path) should be <400 lines with pure functions DI'd for testability (Phase 85 `performMcpReadinessHandshake` / Phase 86 `handleSetModelIpc` pattern).
- **Security rule (rules/security.md):** No secrets in embed copy. Crash template MUST NOT leak exit codes / stack traces / internal registry fields to Discord (CONTEXT.md §Specifics #4).
- **GSD workflow enforcement:** Do not edit code outside a GSD command. This research feeds `/gsd:plan-phase 89`.

## Summary

Phase 89 wires a single chokepoint (`SessionManager.restartAgent` at `src/manager/session-manager.ts:932-939`) into a fire-and-forget greeting helper that (1) gates on 5 skip predicates, (2) summarizes the prior terminated session via the existing `summarizeWithHaiku` helper, (3) renders an `EmbedBuilder` through the existing `WebhookManager.sendAsAgent` webhook identity. **Zero new npm dependencies.** Every surface already exists: `summarizeWithHaiku` (Phase 66), `WebhookManager.sendAsAgent` (Phase 45/v1.6), `ConversationStore.listRecentTerminatedSessions` (Phase 67), `ConversationBriefCache` as the Map pattern (Phase 73), `effortSchema` + `allowedModels` as the additive-optional schema precedent (Phase 83/86), `persistent-session-handle.ts:639-642` as the fire-and-forget canary (Phase 83).

**Primary recommendation:** Add a new pure module `src/manager/restart-greeting.ts` exporting `async function sendRestartGreeting(deps, input): Promise<GreetingOutcome>` (a discriminated union in the Phase 88 `SkillInstallOutcome` style). Call it as `void sendRestartGreeting({...}).catch(err => log.warn(...))` at `session-manager.ts:938` (after `await this.startAgent(name, config)`). Do NOT modify the IPC `case "restart":` fallback path (`daemon.ts:2149-2158`) — when that path falls back to `startAgent`, no greeting is desired (the agent was stopped, not restarted). Reuse `summarizeWithHaiku` directly (no wrapper / sibling) — it already accepts an arbitrary prompt string, so a greeting-specific prompt builder is all that's needed.

## Standard Stack

### Core (all already installed — zero new deps)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@anthropic-ai/claude-agent-sdk` | EXACT `0.2.97` | Haiku summarization via `sdk.query({prompt, options})` | Already wired via `summarizeWithHaiku` (Phase 66). No new SDK surface needed. |
| `discord.js` | `^14.26.2` | `EmbedBuilder`, `WebhookClient` | Already wired via `WebhookManager` + `buildAgentMessageEmbed`. Webhook identity is bought-and-paid-for (v1.6). |
| `better-sqlite3` | `^12.8.0` | `ConversationStore.listRecentTerminatedSessions` | Used for dormancy + empty-state checks. No new table needed. |
| `zod` | `^4.3.6` | Schema extension for `greetOnRestart` + `greetCoolDownMs` | Additive-optional pattern (Phase 83 `effortSchema`, Phase 86 `allowedModels`). |
| `pino` | `^9` | `log.warn` on skip/failure paths | SessionManager already carries a `Logger` instance. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `nanoid` | `^5.1.7` | Not needed directly (already used by subagent-thread-spawner for `-sub-<nanoid6>`; research reuses the prefix detection only). | N/A |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `summarizeWithHaiku` direct reuse | Thin sibling `greetingSummarizer` wrapper | **Reject.** `summarizeWithHaiku` already accepts an arbitrary prompt string — there is no coupling to extract. A wrapper would add a file with zero new logic. |
| Extend `SessionSummarizer` with a `mode` param | Build greeting on its own path | **Reject.** `SessionSummarizer` (`src/memory/session-summarizer.ts`) has a rigid 14-step pipeline coupling turn retrieval, MemoryEntry writes, and idempotency gates. The greeting needs NONE of those — it's a pure read-and-render. |
| Use `DeliveryQueue` for retry | Direct webhook send with fire-and-forget | **Accept direct send.** `DeliveryQueue.enqueue(agent, channelId, content: string)` signature is **text-only** (no embed support in the SQLite schema — `content TEXT NOT NULL`). The queue is useful for PLAIN-TEXT messages only. For embeds we mirror `WebhookManager.sendAsAgent` which bypasses the queue. D-13 says "subject to queue retry" — the planner should record this gap and rely on webhook fire-and-forget + pino log for failure surfacing. Follow-on work (not this phase) could add embed serialization to the queue schema; deferred per scope. |
| Persist cool-down Map to disk | In-memory only | **Accept in-memory.** CONTEXT.md §Claude's Discretion explicitly allows reset-on-boot. `startAll()` is silent (D-02), so there is no boot-time spam scenario to defend against. |

**Version verification (via `npm view` on 2026-04-23):** All libraries above were verified at the pinned versions already in `package.json`. No additions or upgrades required.

## Architecture Patterns

### Recommended Project Structure (new files)
```
src/manager/
├── restart-greeting.ts           # NEW — pure helper (sendRestartGreeting)
├── restart-greeting-types.ts     # OPTIONAL — if GreetingOutcome discriminated union grows
└── __tests__/
    └── restart-greeting.test.ts  # NEW — skip-path + happy-path coverage
```

### Pattern 1: Pure Exported Helper with DI (Phase 85/86 blueprint)
**What:** Pure async function, dependencies injected via a `Deps` param.
**When to use:** Any daemon-scoped side-effect that must be unit-testable without SDK / Discord / filesystem.
**Example:**
```typescript
// Source: mirrors src/manager/daemon.ts:419 `handleSetModelIpc` blueprint
// File: src/manager/restart-greeting.ts (NEW)
import type { EmbedBuilder } from "discord.js";
import type { Logger } from "pino";
import type { WebhookManager } from "../discord/webhook-manager.js";
import type { ConversationStore } from "../memory/conversation-store.js";

export type SendRestartGreetingDeps = Readonly<{
  webhookManager: WebhookManager;
  conversationStore: ConversationStore;  // per-agent
  summarize: SummarizeFn;                // DI'd — tests inject vi.fn()
  now: () => number;                     // DI'd — tests freeze time
  log: Logger;
  // Map is owned by the caller (SessionManager) — passed in so one Map
  // survives across multiple sendRestartGreeting calls for that agent.
  coolDownState: Map<string, number>;
}>;

export type SendRestartGreetingInput = Readonly<{
  agentName: string;
  config: ResolvedAgentConfig;  // for greetOnRestart + greetCoolDownMs + webhook identity
  restartKind: "clean" | "crash-suspected";  // from the classifier
  dormancyThresholdMs?: number;  // default 7 * 24 * 3600_000
  summaryTimeoutMs?: number;     // default 10_000 (mirrors SessionSummarizer)
}>;

export type GreetingOutcome =
  | { readonly kind: "sent"; readonly messageId: string }
  | { readonly kind: "skipped-disabled" }
  | { readonly kind: "skipped-fork" }
  | { readonly kind: "skipped-subagent-thread" }
  | { readonly kind: "skipped-no-channel" }
  | { readonly kind: "skipped-no-webhook" }
  | { readonly kind: "skipped-dormant"; readonly lastActivityMs: number }
  | { readonly kind: "skipped-empty-state" }
  | { readonly kind: "skipped-cool-down"; readonly lastGreetingAtMs: number }
  | { readonly kind: "send-failed"; readonly error: string };

export async function sendRestartGreeting(
  deps: SendRestartGreetingDeps,
  input: SendRestartGreetingInput,
): Promise<GreetingOutcome> {
  // 1. Flag gate (D-09)
  // 2. Fork/thread skip (D-03)
  // 3. Channel / webhook presence
  // 4. Cool-down gate (D-14)
  // 5. Dormancy gate (D-10)
  // 6. Empty-state gate (D-11)
  // 7. Build Haiku prompt + call summarize() with 10s timeout (D-05/D-06)
  // 8. Build EmbedBuilder — clean vs crash template (D-04)
  // 9. webhookManager.sendAsAgent (D-08/D-13)
  // 10. Update cool-down Map on sent success (D-14)
  // 11. On any throw: return {kind:"send-failed"} — caller logs (D-16)
}
```
This mirrors Phase 85's `performMcpReadinessHandshake` (no logger / no state internal), Phase 86's `handleSetModelIpc` (all deps DI'd, discriminated-union return), and Phase 88's `SkillInstallOutcome` exhaustive switch.

### Pattern 2: Fire-and-Forget Callsite (Phase 83 canary verbatim)
**What:** Synchronous caller returns immediately; async side-effect has its own `.catch` log-and-swallow.
**When to use:** Every non-blocking side effect on session lifecycle (effort persist, model persist, permission mode dispatch, greeting send).
**Example (the Phase 89 wiring at session-manager.ts:939):**
```typescript
// Source: src/manager/persistent-session-handle.ts:639-642 verbatim shape
// Target insertion point: src/manager/session-manager.ts BETWEEN the existing
// `await writeRegistry(...)` (line 937) and `await this.startAgent(...)` (line 938).
// Actually CORRECT placement: AFTER startAgent returns so the greeting fires
// only on successful restart (warm-path ready). Failures before startAgent-success
// are already handled by the crash-handler path.
async restartAgent(name: string, config: ResolvedAgentConfig): Promise<void> {
  await this.stopAgent(name);
  let registry = await readRegistry(this.registryPath);
  const prevEntry = registry.entries.find((e) => e.name === name);
  const prevRestartCount = prevEntry?.restartCount ?? 0;
  const prevConsecutiveFailures = prevEntry?.consecutiveFailures ?? 0;
  registry = updateEntry(registry, name, { restartCount: prevRestartCount + 1 });
  await writeRegistry(this.registryPath, registry);
  await this.startAgent(name, config);

  // Phase 89 — fire-and-forget greeting. MUST stay async so we never block
  // restart success on Discord availability (D-16). Rejections are logged
  // and swallowed per the Phase 83 canary blueprint.
  if (this.webhookManager && this.allAgentConversationStores) {
    const convStore = this.memory.conversationStores.get(name);
    if (convStore) {
      void sendRestartGreeting(
        {
          webhookManager: this.webhookManager,
          conversationStore: convStore,
          summarize: this.summarizeFn,
          now: () => Date.now(),
          log: this.log,
          coolDownState: this.greetCoolDownByAgent,
        },
        {
          agentName: name,
          config,
          restartKind: classifyRestart(prevConsecutiveFailures),  // see Finding 3
        },
      ).catch((err: unknown) => {
        this.log.warn(
          { agent: name, error: (err as Error).message },
          "[greeting] sendRestartGreeting threw (non-fatal)",
        );
      });
    }
  }
}
```

### Anti-Patterns to Avoid
- **Blocking restart on Discord availability.** `await sendRestartGreeting(...)` would convert every Discord outage into an agent restart failure. Use `void` + `.catch`.
- **Reusing `assembleConversationBrief`.** D-05 forbids this. The brief is a MULTI-session accumulator with a budget; the greeting is a SINGLE-session fresh Haiku call. Different shape, different purpose.
- **Writing the greeting prompt into `SessionSummarizer`.** Pitfall 3 of 66-RESEARCH says the summarizer runs in its own config-free context (`settingSources: []`) — that's correct for summarization but irrelevant to a read-only pre-rendered summary. Phase 89 has no reason to touch `SessionSummarizer`.
- **Enqueueing embeds into `DeliveryQueue`.** The queue's SQLite schema stores `content TEXT NOT NULL` — embeds would serialize to a string, lose structure, and fail on dequeue. Direct webhook send is the correct path.
- **Invoking the greeting from the IPC restart-fallback at `daemon.ts:2149-2158`.** That fallback calls `startAgent()` (not `restartAgent()`) when the agent is already stopped. D-01 says greetings fire ONLY on `restartAgent()` — the fallback must stay greeting-free.
- **Registering the greeting helper on the IPC `case "start":` path.** D-01 forbids; no code changes there.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Haiku summarization | Custom SDK client | `summarizeWithHaiku(prompt, { signal })` at `src/manager/summarize-with-haiku.ts:51` | Already pins `model: haiku`, `settingSources: []`, `allowDangerouslySkipPermissions: true`, abort-signal plumbing. Accepts arbitrary prompt strings. |
| Webhook embed delivery | Raw `WebhookClient` instantiation | `WebhookManager.sendAsAgent(targetAgent, displayName, avatarUrl, embed)` at `src/discord/webhook-manager.ts:87-110` | Handles client caching, logging, returns message ID. |
| Terminated-session lookup | Ad-hoc SQL query | `ConversationStore.listRecentTerminatedSessions(agentName, 1)` at `src/memory/conversation-store.ts:307` | Already excludes `status='active'` (which would else return the just-created fresh session post-restart and collapse every dormancy check to 0). |
| Fork-name detection | Manual regex | Prefix rule: `${agentName}-fork-${nanoid(6)}` from `src/manager/fork.ts:25-27` | 6-char nanoid is URL-safe; detect via `/-fork-[A-Za-z0-9_-]{6}$/` or per-agent-name prefix match in the greeting helper. |
| Subagent-thread detection | Manual regex | Prefix rule: `${parentAgentName}-sub-${nanoid(6)}` from `src/discord/subagent-thread-spawner.ts:97-98` | Same shape — `/-sub-[A-Za-z0-9_-]{6}$/`. |
| Embed rendering | Free-text message | `EmbedBuilder` (UI-01 precedent across Phases 83/86/87/88). | Model off `src/discord/agent-message.ts:14-30` (existing `buildAgentMessageEmbed`) for structure. |
| Schema additive extension | New top-level key | Follow Phase 83 `effortSchema` + Phase 86 `allowedModels` pattern in `src/config/schema.ts:677-745` + `src/config/schema.ts:750-779` | v2.1 migrated fleet (15 agents) parses unchanged when field is absent. |
| Reloadable classification | Ad-hoc restart check | Add to `RELOADABLE_FIELDS` Set at `src/config/types.ts:45-65` alongside `agents.*.effort` and `agents.*.allowedModels` | Differ already walks the Set. |
| YAML persistence of `greetOnRestart` | Ad-hoc write | **Not needed this phase** (D-09 calls the writer a "future" path). If ever needed, mirror `updateAgentModel` at `src/migration/yaml-writer.ts:401-517` exactly. |
| Cool-down Map | New class | `Map<string, number>` keyed by agent name (epoch ms of last greeting). Pattern from `ConversationBriefCache` at `src/manager/conversation-brief-cache.ts:48-80`. Live on SessionManager; cleared via `stopAll()`. |

**Key insight:** Every surface is already built. Phase 89 is almost entirely composition of existing primitives. A careful plan decomposition can ship in 2 plans (possibly 3 for extra safety), not 3-4.

## Finding 1: Trigger Chokepoint (D-01 / D-02)

**Exact chokepoint** — `src/manager/session-manager.ts:932-939`:
```typescript
async restartAgent(name: string, config: ResolvedAgentConfig): Promise<void> {
  await this.stopAgent(name);                                            // line 933
  let registry = await readRegistry(this.registryPath);                  // line 934
  const entry = registry.entries.find((e) => e.name === name);           // line 935
  registry = updateEntry(registry, name, { restartCount: (entry?.restartCount ?? 0) + 1 });  // line 936
  await writeRegistry(this.registryPath, registry);                      // line 937
  await this.startAgent(name, config);                                   // line 938
}                                                                         // line 939
```

**Recommended insertion point:** AFTER line 938 (`await this.startAgent(name, config)`). Rationale:
- `startAgent` throws on warm-path failure; we want the greeting ONLY on successful restart. A post-`startAgent` placement inherently skips failure paths.
- The `restartCount` delta needed for the crash-vs-clean classifier (Finding 3) is captured BEFORE line 936 (capture `prevEntry?.restartCount` + `prevEntry?.consecutiveFailures` before the update on line 936). Pass the captured values into `classifyRestart(...)` at the greeting call.

**`startAll()` entry point** — `src/manager/session-manager.ts:941-966`:
```typescript
async startAll(configs: readonly ResolvedAgentConfig[]): Promise<void> {
  // Calls startAgent() (not restartAgent) for each config; reconcileRegistry
  // path also calls startAgent or scheduleRestart → performRestart.
  // performRestart callback is defined at session-manager.ts:217 as
  //   async (name, config) => this.performRestart(name, config)
  // which ultimately calls startAgent (NOT restartAgent). So startAll never
  // lands in the restartAgent chokepoint — greeting by construction cannot fire.
}
```
Confirmed: `startAll()` → `startAgent()` only (never `restartAgent()`). D-02 is satisfied by construction. No extra guard needed.

**IPC restart fallback** — `src/manager/daemon.ts:2140-2160`:
```typescript
case "restart": {
  const name = validateStringParam(params, "name");
  const config = configs.find((c) => c.name === name);
  // ...
  try {
    await manager.restartAgent(name, config);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/not running|no such session|requireSession/i.test(msg)) {
      await manager.startAgent(name, config);  // ← NO greeting fires here (correct per D-01)
    } else {
      throw err;
    }
  }
  return { ok: true };
}
```
This is actually a CORRECTNESS feature for D-01: if the operator types `/clawcode-restart` on an already-stopped agent, no prior-session context exists (or rather, it already played its summary when the agent was last stopped). Greeting correctly suppressed.

**Crash-recovery restart path** — `SessionRecoveryManager.scheduleRestart` (`src/manager/session-recovery.ts:170-195`) invokes the `performRestartFn` callback which SessionManager wires to `this.performRestart(name, config)` at construction (`session-manager.ts:217`). **`performRestart` calls `startAgent`, not `restartAgent`.** Search for `performRestart` shows it's the private method that starts after a backoff delay. **This means crash-restarts do NOT flow through `restartAgent()`.** This is a D-01 / D-04 nuance:
- Greeting fires on explicit `SessionManager.restartAgent()` calls (IPC `/clawcode-restart`, CLI `clawcode restart`, test calls).
- Greeting does NOT fire on auto-crash-recovery restarts (they come in via `scheduleRestart → performRestart → startAgent`).

The planner MUST make a decision here: either
- (a) Accept this — crash-loop greeting suppression comes "for free" (they never fire), and D-04's "crash recovery vs clean restart different templates" applies only when an operator MANUALLY invokes `/clawcode-restart` after a crash (classifier uses `consecutiveFailures > 0` as the crash signal).
- (b) Extend the greeting call to `performRestart` too — but this contradicts D-14's cool-down rationale ("crash-loop suppression") because the cool-down exists specifically to handle auto-crash-restarts. If crash-restarts don't greet, cool-down's only job is protecting against rapid manual `/clawcode-restart` thrashing.

**Recommended:** Option (a) — cleanest, matches D-01 literally ("`SessionManager.restartAgent()` ONLY"), simplest test surface. D-14 cool-down still earns its keep as a defensive belt-and-suspenders.

**Confidence:** HIGH (direct source inspection).

## Finding 2: Fork + Subagent-Thread Skip Detection (D-03)

**Fork agent names** — generated by `buildForkName(parentName)` at `src/manager/fork.ts:25-27`:
```typescript
export function buildForkName(agentName: string): string {
  return `${agentName}-fork-${nanoid(6)}`;
}
```

**Subagent-thread agent names** — generated at `src/discord/subagent-thread-spawner.ts:97-98`:
```typescript
const shortId = nanoid(6);
const sessionName = `${config.parentAgentName}-sub-${shortId}`;
```

**Concrete predicates for the greeting helper:**
```typescript
// nanoid(6) alphabet: [A-Za-z0-9_-] (21^6 entropy — 6 chars of nanoid's
// URL-safe alphabet). Anchor on `-fork-` / `-sub-` infix + 6-char suffix.
const FORK_SUFFIX = /-fork-[A-Za-z0-9_-]{6}$/;
const THREAD_SUFFIX = /-sub-[A-Za-z0-9_-]{6}$/;

export function isForkAgent(agentName: string): boolean {
  return FORK_SUFFIX.test(agentName);
}
export function isSubagentThread(agentName: string): boolean {
  return THREAD_SUFFIX.test(agentName);
}
```

**Additional fork carve-out to verify:** `ResolvedAgentConfig.channels === []` for forks (`fork.ts:55`) and subagent threads (`subagent-thread-spawner.ts:127`). So **a cheaper (and more semantic) skip predicate** is:
```typescript
if (config.channels.length === 0) {
  // Not a channel-bound agent — no Discord delivery target by construction.
  // This catches forks AND subagent threads AND any future headless variant.
  return { kind: "skipped-no-channel" };
}
```
Recommendation: **use both** — name-regex for explicit D-03 compliance (pins `-fork-` / `-sub-` at the test level so a future refactor doesn't silently drop the carve-out) AND `channels.length === 0` as a defensive fallback (catches any future headless agent pattern).

**Confidence:** HIGH (direct source).

## Finding 3: Crash-vs-Clean Classifier (D-04)

**Available signals in the `restartAgent()` chokepoint:**

| Signal | Source | Reliability | Use for classifier? |
|--------|--------|-------------|---------------------|
| `prevEntry.restartCount` delta | `registry.ts` (incremented at session-manager.ts:936) | HIGH — monotonic per explicit restart. | **No** — every `restartAgent()` increments this regardless of crash/clean; the delta is always +1. Useless for classification. |
| `prevEntry.consecutiveFailures` | `registry.ts` via `SessionRecoveryManager.updateRegistryOnCrash` (`session-recovery.ts:142-164`) | HIGH when >0 (agent crashed at least once since last stable period); HIGH when 0 (no recent crash). | **YES — primary signal.** `consecutiveFailures > 0` → crash-suspected template. `consecutiveFailures === 0` → clean template. |
| `prevEntry.lastError` | Set by `updateRegistryOnCrash`; cleared on successful start (`session-manager.ts:557`, `lastError: null`) | HIGH — non-null means crash happened. | SECONDARY — same signal as `consecutiveFailures > 0`; use as a tiebreaker for operator messaging, NOT for template selection. |
| `prevEntry.lastStableAt` | Set by `SessionRecoveryManager.resetBackoff` (`session-recovery.ts:211-222`) after the 5-min stability timer fires. | MEDIUM — absence means "never stable since last crash". | NOT USED — redundant with `consecutiveFailures`. |
| Exit code from `session-recovery.ts` | Not exposed on the registry entry; only the error message string is. | LOW — not directly accessible at `restartAgent` callsite. | **No** — stale by the time restartAgent fires (stopAgent already ran). |
| `session-recovery.ts` signals (orphan detection) | Live only inside `reconcileRegistry` path. | N/A — reconcile doesn't route through `restartAgent`. | **No** — wrong path for this phase. |
| Intentional-stop flag from `stopAgent` | **Does not exist currently.** `stopAgent` (`session-manager.ts:787-867`) writes `status: "stopped"` + `sessionId: null` + `stoppedAt: Date.now()` but no "voluntary" flag. | N/A — not present. | **No — and do NOT invent one for this phase (CONTEXT.md §Claude's Discretion forbids new tracking mechanisms).** |

**Recommended classifier (pure function, testable):**
```typescript
// File: src/manager/restart-greeting.ts (co-located with sendRestartGreeting)
export type RestartKind = "clean" | "crash-suspected";

export function classifyRestart(prevConsecutiveFailures: number): RestartKind {
  // Single signal, single rule:
  //   >0 failures since last stable period → crash-suspected template
  //   0 failures → clean template
  // Unclassifiable paths default to clean per D-04.
  return prevConsecutiveFailures > 0 ? "crash-suspected" : "clean";
}
```

**Critical timing nuance:** `consecutiveFailures` is reset to `0` by the 5-min stability timer (`session-recovery.ts:211-222`). So:
- Agent crashes at T=0, recovers at T=15s → `consecutiveFailures=1`.
- `lastStableAt` is set to T=5min+ IFF the agent stays running that long.
- Operator `/clawcode-restart` at T=3min (before stability reset) → classifier returns `crash-suspected`. ✅
- Operator `/clawcode-restart` at T=10min (after stability reset) → classifier returns `clean`. ✅ (crash is "forgotten" — acceptable semantics.)

**Confidence:** HIGH for the classifier logic; MEDIUM for the "crash-suspected" framing (operators may quibble about wording — Claude's Discretion covers this per CONTEXT.md).

## Finding 4: Summarizer Reuse vs Sibling (D-05)

**Current signature** — `src/manager/summarize-with-haiku.ts:51-94`:
```typescript
export async function summarizeWithHaiku(
  prompt: string,
  opts: { readonly signal?: AbortSignal },
): Promise<string>;
```

**Analysis:**
- Takes an ARBITRARY prompt string — no mode / template / flag.
- Internally pins `model: haiku`, `systemPrompt: SUMMARIZE_SYSTEM_PROMPT`, `settingSources: []`, `allowDangerouslySkipPermissions: true`.
- Returns the SDK's first `result` message text, or `""` on no result.
- Timeout is owned by the CALLER (per docstring lines 10-12). The 10s timeout + deterministic fallback lives in `SessionSummarizer` (`src/memory/session-summarizer.ts` — Phase 66, not Phase 89 scope). Planner MUST replicate the 10s AbortController + timeout pattern at the greeting callsite.

**`SUMMARIZE_SYSTEM_PROMPT` concern:** Line 23-24:
> "You are a concise summarizer. Respond with only the requested markdown sections. Do not add commentary outside the requested structure."

This system prompt is a GOOD fit for greetings (concise, no commentary, no tool use). Reusable as-is — the greeting's "requested structure" is "one paragraph, first-person, <500 chars".

**Recommendation: DIRECT REUSE of `summarizeWithHaiku`. No wrapper. No sibling. No `mode` parameter.**
- Add a new pure helper `buildRestartGreetingPrompt(turns: ConversationTurn[], agent: ResolvedAgentConfig, restartKind: RestartKind): string` at `src/manager/restart-greeting.ts`.
- Call `summarizeWithHaiku(buildRestartGreetingPrompt(...), { signal: timeoutController.signal })` with a 10s AbortController.
- On timeout / empty string / throw → return `{ kind: "skipped-empty-state" }` (per D-11, no fallback greeting — if Haiku fails we stay silent).

**Greeting prompt shape (Claude's Discretion — planner decides exact wording; this is the STRUCTURAL skeleton):**
```typescript
export function buildRestartGreetingPrompt(
  turns: readonly ConversationTurn[],
  agentConfig: ResolvedAgentConfig,
  restartKind: RestartKind,
): string {
  const agentVoice = agentConfig.webhook?.displayName ?? agentConfig.name;
  const turnsMarkdown = turns
    .map(t => `### ${t.role} (turn ${t.turnIndex})\n${t.content}`)
    .join("\n\n");
  return `You are ${agentVoice}. You just came back online after ${restartKind === "crash-suspected" ? "an unexpected shutdown" : "a clean restart"}.

Summarize the PRIOR session below into a single first-person paragraph of AT MOST 400 characters (hard limit 500). Speak as "${agentVoice}" — "I was working on…", "We decided…", "I'm still waiting on…". NO bullet points. NO markdown headers. NO meta-commentary about being an AI or being restarted.

Prior session:

${turnsMarkdown}`;
}
```

The 400/500-char split leaves room for the truncation safeguard (if output exceeds 500, slice + `…` — do not re-call Haiku).

**Prior-session turn retrieval** — the greeting needs the actual conversation content to summarize. Use:
```typescript
const terminated = conversationStore.listRecentTerminatedSessions(agentName, 1);
if (terminated.length === 0) return { kind: "skipped-empty-state" };
const turns = conversationStore.getTurnsForSessionLimited(terminated[0].id, 50);
// Cap at 50 turns to bound prompt size — matches SessionSummarizer's
// MAX_PROMPT_CHARS truncation policy at session-summarizer.ts:26.
```

Wait — `getTurnsForSessionLimited` exists but I want to confirm the signature. From `conversation-store.ts:568-575`:
```typescript
getTurnsForSessionLimited(sessionId: string, limit: number): readonly ConversationTurn[]
```
Returns turns in `turn_index ASC` order. Perfect for passing into the prompt builder.

**Alternative (if summaries are preferred over raw turns):** Query `memoryStore.findByTag("session-summary")` for the most recent summary. But D-05 explicitly says "fresh Haiku summarization at restart-time, NOT reuse of assembleConversationBrief" — the expected path is fresh over raw turns, not re-summary of a stored summary. Stick with raw turns.

**Confidence:** HIGH.

## Finding 5: Prior-Session Source (D-06 / D-10 / D-11)

**Query path from the greeting helper:**
```typescript
// Deps: conversationStore: ConversationStore (per-agent)
// Available via: sessionManager.memory.conversationStores.get(agentName)
// Exposed on AgentMemoryManager as a public readonly Map<string, ConversationStore>
// at src/manager/session-memory.ts:39.

// Step 1: get the most recent TERMINATED session (excludes the just-created
// active session from the restart).
const recent = conversationStore.listRecentTerminatedSessions(agentName, 1);
if (recent.length === 0) {
  return { kind: "skipped-empty-state" };  // D-11
}
const lastSession = recent[0];

// Step 2: dormancy check (D-10). Use endedAt (ISO 8601 string).
const lastActivityIso = lastSession.endedAt ?? lastSession.startedAt;
const lastActivityMs = new Date(lastActivityIso).getTime();
const ageMs = Math.max(0, now() - lastActivityMs);  // clock-skew clamp — mirrors conversation-brief.ts:110
const DORMANCY_THRESHOLD_MS = 7 * 24 * 3600_000;  // 604,800,000
if (ageMs > DORMANCY_THRESHOLD_MS) {
  return { kind: "skipped-dormant", lastActivityMs };  // D-10
}

// Step 3: fetch turns for the summarization pass.
const turns = conversationStore.getTurnsForSessionLimited(lastSession.id, 50);
if (turns.length === 0) {
  // Defensive — a terminated session with zero turns should never happen,
  // but if it does, treat as empty-state.
  return { kind: "skipped-empty-state" };
}
```

**Signatures (verbatim from source):**
- `listRecentTerminatedSessions(agentName: string, limit: number): readonly ConversationSession[]` — `src/memory/conversation-store.ts:307-316`.
- `getTurnsForSessionLimited(sessionId: string, limit: number): readonly ConversationTurn[]` — inferred from prepared statement at `src/memory/conversation-store.ts:568-575` (grep the public method name).
- `ConversationSession` shape (src/memory/conversation-types.ts — to verify for any oddities):
```typescript
readonly id: string;
readonly agentName: string;
readonly startedAt: string;     // ISO 8601
readonly endedAt: string | null;
readonly turnCount: number;
readonly totalTokens: number;
readonly summaryMemoryId: string | null;
readonly status: "active" | "ended" | "crashed" | "summarized";
```

**ConversationStore thread: use `endedAt` as last-activity.** It's always set for terminated sessions (invariant documented at `conversation-brief.ts:101-106`).

**Confidence:** HIGH.

## Finding 6: Discord Delivery Vehicle (D-08 / D-13 / D-15)

**Existing webhook embed delivery API** — `src/discord/webhook-manager.ts:87-110`:
```typescript
async sendAsAgent(
  targetAgent: string,
  senderDisplayName: string,
  senderAvatarUrl: string | undefined,
  embed: EmbedBuilder,
): Promise<string>  // returns the Discord message ID
```

**Contract:**
- Throws `Error('No webhook identity configured for target agent ...')` if the agent has no webhook. Caller MUST gate on `webhookManager.hasWebhook(agentName)` first.
- Internally pins `username` + `avatarURL` from the target agent's webhook identity (the webhook posts to the target's channel, per the webhook URL's bound channel).
- Returns the message ID as a string.

**For Phase 89:** The caller is the target itself (agent greeting its own channel, D-12), so `targetAgent === senderAgentName`. `senderDisplayName` = the agent's own webhook `displayName`. `senderAvatarUrl` = the agent's own webhook `avatarUrl`. This is the "self-send" use of `sendAsAgent`.

**Alternative:** `WebhookManager.send(agentName, content: string)` (line 52-73) — text-only, no embed. NOT SUITABLE for D-13.

**Alternative extension (if the planner wants a separate "embed send" API):** Add `sendEmbed(agentName: string, embed: EmbedBuilder): Promise<string>` to `WebhookManager`. Mirrors `sendAsAgent` but without the `sender*` duplication (target IS sender). RECOMMENDED — tightens the call site ergonomics. Planner decision.

**Channel-ID resolution path:** Already baked into the webhook URL (per agent). The webhook is provisioned against `agent.channels[0]` (`src/discord/webhook-provisioner.ts:54`). So the greeting helper does NOT need to look up the channel — the webhook client already knows its channel. This is why D-12 "per-agent, no cross-sibling fan-out" is trivially satisfied.

**`DeliveryQueue` carve-out (D-13 caveat):** The v1.2 `DiscordDeliveryQueue` at `src/discord/delivery-queue.ts:132-149` has this enqueue signature:
```typescript
enqueue(agentName: string, channelId: string, content: string): string
```
The SQLite schema (`src/discord/delivery-queue.ts:104-120`) stores `content TEXT NOT NULL`. **Embeds are not representable in this queue.** The daemon's `deliverFn` wrapper at `src/manager/daemon.ts:1753-1790` also only handles `content: string` with split-at-max-length logic.

**Resolution:** D-13 says "subject to v1.2 DiscordDeliveryQueue retry + failed-message log" — but the queue as-built cannot carry embeds. Two options:

1. **Recommended (in scope):** Interpret D-13 as applicable to the SPIRIT of failed-message observability. The greeting sends DIRECTLY via `webhookManager.sendAsAgent` (embed-capable) and on failure logs via pino. This matches D-16 ("log + continue") exactly. The planner should call this out as an observed gap in 89-RESEARCH Integration Points and either accept it (recommended) or open a follow-on for embed-queue support (deferred per v2.2 scope).
2. **Not recommended (out of scope):** Extend the queue to store embed JSON. Schema migration, serialization logic, deliverFn branching — real work, scope creep.

**PLANNER DECISION required.** Recommendation: take option 1 and document the gap.

**Message ID persistence (D-15):** Not needed. D-15 explicitly says "new message every restart; no edit-in-place". The return value of `sendAsAgent` (the messageId) can be logged for observability but NOT stored. This is the simpler, safer path — no cross-boot state.

**Confidence:** HIGH.

## Finding 7: Schema Addition (D-09)

**Exact file:** `src/config/schema.ts`. Two sites:

**Site 1 — agentSchema** (insert alongside `effort`, `allowedModels`, around line 712):
```typescript
// Phase 89 — per-agent override for restart-greeting emission.
// Additive + optional: v2.1 migrated configs (15 agents) parse unchanged
// when omitted; the loader's resolver fills from defaults.greetOnRestart.
// Reloadable — flag change takes effect on next restart without daemon
// bounce (classified in src/config/types.ts:RELOADABLE_FIELDS).
greetOnRestart: z.boolean().optional(),

// Phase 89 — per-agent override for the in-memory cool-down window.
// Additive + optional; resolver falls back to defaults.greetCoolDownMs,
// then to the hardcoded 300_000 (5 min) constant in restart-greeting.ts.
// Positive integer (milliseconds).
greetCoolDownMs: z.number().int().positive().optional(),
```

**Site 2 — defaultsSchema** (insert alongside `allowedModels`, around line 757):
```typescript
// Phase 89 — fleet-wide default for restart-greeting emission.
// Default true — every agent greets on restart unless explicitly opted out.
greetOnRestart: z.boolean().default(true),

// Phase 89 — fleet-wide default for the cool-down window. 300_000 ms = 5 min
// per D-14. Positive integer.
greetCoolDownMs: z.number().int().positive().default(300_000),
```

**ResolvedAgentConfig extension** — `src/shared/types.ts:5-231`, add:
```typescript
// Phase 89 — ALWAYS populated after resolution (loader fills from
// defaults.greetOnRestart when the agent omits the field). Downstream
// (SessionManager.restartAgent → sendRestartGreeting) reads this unconditionally.
readonly greetOnRestart: boolean;

// Phase 89 — ALWAYS populated after resolution. Milliseconds.
readonly greetCoolDownMs: number;
```

**Loader resolution** — `src/config/loader.ts:292-298` pattern. Insert alongside `effort` and `allowedModels`:
```typescript
greetOnRestart: agent.greetOnRestart ?? defaults.greetOnRestart,
greetCoolDownMs: agent.greetCoolDownMs ?? defaults.greetCoolDownMs,
```

**Reloadable classification** — `src/config/types.ts:45-65`. Add to `RELOADABLE_FIELDS`:
```typescript
// Phase 89 — the greeting helper reads config.greetOnRestart + config.greetCoolDownMs
// lazily on every restartAgent() call (no cached state in any handle). A YAML
// edit takes effect on the NEXT restart without daemon bounce.
"agents.*.greetOnRestart",
"defaults.greetOnRestart",
"agents.*.greetCoolDownMs",
"defaults.greetCoolDownMs",
```

**Test coverage for schema migration compatibility** — Phase 83 / 86 pattern: include a test that `clawcode migrate openclaw verify` (or equivalent v2.1 regression) still passes with the new fields absent. Mirror `src/config/__tests__/loader.test.ts` patterns — verify existing `clawcode.yaml` (without `greetOnRestart`) parses and resolves to `greetOnRestart: true`.

**Confidence:** HIGH (direct pattern match against Phase 83 + 86 + 88).

## Finding 8: Cool-down Map (D-14)

**Pattern:** `ConversationBriefCache` at `src/manager/conversation-brief-cache.ts:48-80` is the exact shape — `Map<string, T>` owned by `SessionManager`, invalidated on `stopAgent`, cleared on `stopAll`. Mirror it:

```typescript
// File: src/manager/session-manager.ts — add to SessionManager class body
// alongside the other per-agent Maps (around line 92-119).

/**
 * Phase 89 D-14 — per-agent last-greeting-at timestamp (ms epoch).
 * Cool-down Map: if an entry exists and (now - entry) < agent.greetCoolDownMs,
 * the greeting is suppressed. Reset on daemon boot (in-memory only — see
 * CONTEXT.md §Claude's Discretion). Cleared per-agent on stopAgent.
 */
private readonly greetCoolDownByAgent: Map<string, number> = new Map();
```

**Lifecycle hooks:**
- Write: on successful greeting send, `this.greetCoolDownByAgent.set(name, Date.now())`. Done inside `sendRestartGreeting` since it owns the Map reference.
- Read: on entry to `sendRestartGreeting`, check `coolDownState.get(agentName)` and compare with `now() - lastMs < agent.greetCoolDownMs`.
- Invalidate on stop: in `stopAgent` (`session-manager.ts:787-867`), add `this.greetCoolDownByAgent.delete(name)` alongside the existing cleanup (line 839-842). Rationale: if the operator stops + restarts an agent, the restart is a clean restart (not a crash-loop), so cool-down should reset.
- Clear on `stopAll`: no explicit clear needed — the SessionManager instance is destroyed at daemon shutdown.

**Size unbounded risk:** Bounded by number of agents (15 in the current fleet). No eviction needed.

**Test pattern:** Inject a `now: () => number` DI hook into `sendRestartGreeting`. Tests freeze time, exercise: T=0 first call (sends), T=4min second call (cool-down skip), T=6min third call (sends again). Mirror `effort-state-store.test.ts` time-injection shape.

**Confidence:** HIGH.

## Finding 9: Fire-and-Forget Error Path (D-16)

**Canonical shape — `src/manager/persistent-session-handle.ts:639-642` (Phase 83 canary):**
```typescript
void q.setMaxThinkingTokens(budget).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(`[effort] setMaxThinkingTokens(${String(budget)}) failed: ${msg}`);
});
```

**Important nuance: the Phase 83 / 86 / 87 canaries use `console.warn` (not pino).** This is because they live inside the pure session-handle module which is logger-agnostic. At the SessionManager level we DO have a pino logger — use it:

**Phase 89 callsite (at `session-manager.ts:938+`):**
```typescript
void sendRestartGreeting(deps, input).catch((err: unknown) => {
  this.log.warn(
    { agent: name, error: (err as Error).message },
    "[greeting] sendRestartGreeting threw (non-fatal)",
  );
});
```

**Reference analog — `setEffortForAgent` at `session-manager.ts:647-656`:**
```typescript
void writeEffortState(this.effortStatePath, name, level, this.log).catch((err) => {
  this.log.warn(
    { agent: name, error: (err as Error).message },
    "effort-state persist failed (non-fatal)",
  );
});
```
This is the CLOSEST existing analog inside `SessionManager` — same caller context, same logger, same fire-and-forget shape. Copy verbatim.

**Restart success invariant (D-16 hard requirement):** `restartAgent` MUST NOT throw from greeting failure. The `void` keyword + `.catch` pattern guarantees this — the unreturned promise cannot reject the caller.

**Logger availability at the callsite:** `SessionManager.log` is always set at construction (`session-manager.ts:207`). Safe to use without a guard.

**Confidence:** HIGH.

## Finding 10: EmbedBuilder Shape (D-13 / D-04)

**Existing embed patterns in the codebase:**

| File | Use | Shape |
|------|-----|-------|
| `src/discord/agent-message.ts:14-30` | Agent-to-agent message | `setAuthor` + `setDescription` (truncated to 4096) + `setColor(0x5865F2)` + `setFooter` + `setTimestamp` |
| `src/discord/bridge.ts:248-285` (`sendBudgetAlert`) | Budget alert | `setTitle` + `setColor(0xFF0000 / 0xFFCC00)` + `addFields` + `setTimestamp` |
| `src/discord/slash-commands.ts:926-948` (`/clawcode-tools`) | MCP status | `setTitle` + `setColor(resolveEmbedColor)` + `addFields` (per server) |
| Phase 86 `/clawcode-model` (Plan 03) | Model picker confirmation | `EmbedBuilder` via `StringSelectMenuBuilder` result (not directly relevant) |
| Phase 88 `/clawcode-skills-browse` (Plan 02) | Skills browser | Similar table of fields |

**Recommended templates:**

```typescript
// File: src/manager/restart-greeting.ts

import { EmbedBuilder } from "discord.js";

export function buildCleanRestartEmbed(
  agentDisplayName: string,
  agentAvatarUrl: string | undefined,
  priorSessionSummary: string,
): EmbedBuilder {
  // Truncate to D-06 target (<500 chars in description). Hard cap at 500 to
  // allow safety margin before the discord.js 4096 limit. If Haiku returns
  // longer, slice + "…" rather than re-call (CONTEXT.md §Specifics #2).
  const desc = priorSessionSummary.length > 500
    ? priorSessionSummary.slice(0, 497) + "…"
    : priorSessionSummary;
  return new EmbedBuilder()
    .setAuthor({
      name: agentDisplayName,
      iconURL: agentAvatarUrl,  // reuse webhook avatar as author icon (D-08)
    })
    .setDescription(desc)
    .setColor(0x5865F2)  // Discord blurple — "I'm back" tone
    .setFooter({ text: "Back online" })
    .setTimestamp();
}

export function buildCrashRecoveryEmbed(
  agentDisplayName: string,
  agentAvatarUrl: string | undefined,
  priorSessionSummary: string,
): EmbedBuilder {
  const desc = priorSessionSummary.length > 500
    ? priorSessionSummary.slice(0, 497) + "…"
    : priorSessionSummary;
  return new EmbedBuilder()
    .setAuthor({
      name: agentDisplayName,
      iconURL: agentAvatarUrl,
    })
    .setDescription(desc)
    .setColor(0xFFCC00)  // amber — "recovered from disruption"
    .setFooter({ text: "Recovered after unexpected shutdown" })
    .setTimestamp();
}
```

**Color rationale:** 0x5865F2 is Discord's "blurple" brand color — neutral, "back online" feel. 0xFFCC00 is the same amber used for `sendBudgetAlert`'s "warning" threshold (`bridge.ts:271`) — visual consistency across "something unusual just happened but we're OK now" states. Planner may tune — Claude's Discretion applies.

**Crash template phrasing MUST NOT leak state** (CONTEXT.md §Specifics #4):
- ❌ "Recovered from SIGSEGV after 3 consecutive failures"
- ❌ "Last error: readFile ENOENT 'clawcode.yaml'"
- ✅ "Recovered after unexpected shutdown" (footer text)
- ✅ The description is the Haiku summary (no internals).

**Avatar thumbnail:** Use `.setAuthor({ iconURL })` (next to the author name, 24px) rather than `.setThumbnail(url)` (right-side 80px). The avatar is already the webhook's own avatar — `setThumbnail` would duplicate visual weight.

**Confidence:** HIGH.

## Finding 11: Test Strategy

**Test file location:** `src/manager/__tests__/restart-greeting.test.ts` (new file).

**SessionManager integration test location:** `src/manager/__tests__/session-manager.test.ts` — add a new `describe("restartAgent greeting", ...)` block near line 124 (existing `restartAgent` describe block).

**Spy-test blueprint (mirrors Phase 83 canary at `persistent-session-handle-effort.test.ts` + Phase 86 `persistent-session-handle-model.test.ts`):**

```typescript
// Unit tests — src/manager/__tests__/restart-greeting.test.ts
describe("sendRestartGreeting", () => {
  // P1: happy path
  it("sends embed via webhookManager.sendAsAgent on clean restart with prior session", async () => {
    const sendSpy = vi.fn().mockResolvedValue("msg-id-123");
    const result = await sendRestartGreeting(
      { webhookManager: { sendAsAgent: sendSpy, hasWebhook: () => true },
        conversationStore: stubStoreWithPriorSession(),
        summarize: vi.fn().mockResolvedValue("Discussed migration plan."),
        now: () => FIXED_NOW,
        log: stubLogger,
        coolDownState: new Map(),
      },
      { agentName: "clawdy", config: makeConfig(), restartKind: "clean" },
    );
    expect(result).toEqual({ kind: "sent", messageId: "msg-id-123" });
    expect(sendSpy).toHaveBeenCalledTimes(1);
    // Assert embed structure (EmbedBuilder → .toJSON())
    const [, , , embed] = sendSpy.mock.calls[0];
    expect(embed.data.description).toMatch(/Discussed migration plan/);
    expect(embed.data.color).toBe(0x5865F2);  // clean template
  });

  // P2: skip paths
  it("skips when greetOnRestart=false", async () => { ... });
  it("skips fork agents by name suffix (-fork-abc123)", async () => { ... });
  it("skips subagent-thread agents by name suffix (-sub-abc123)", async () => { ... });
  it("skips when agent has no bound channels", async () => { ... });
  it("skips when agent has no webhook identity", async () => { ... });
  it("skips when dormant >7 days", async () => { ... });
  it("skips on empty-state (no terminated sessions)", async () => { ... });
  it("skips on cool-down (last greeting <5 min ago)", async () => { ... });

  // P3: crash template selection
  it("uses crash template when restartKind=crash-suspected", async () => {
    // ... expect embed.data.color === 0xFFCC00
  });

  // P4: Haiku failure handling
  it("returns skipped-empty-state on summarize timeout (no fallback greeting)", async () => {
    const summarize = vi.fn().mockImplementation(async (_, opts) => {
      await new Promise((_, reject) => opts.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    });
    // ...
  });
  it("returns skipped-empty-state on summarize empty string (D-11)", async () => { ... });

  // P5: truncation
  it("slices description to 500 chars with ellipsis on oversize Haiku output", async () => { ... });

  // P6: cool-down write-back
  it("updates cool-down map on sent success", async () => { ... });
  it("does NOT update cool-down on skip paths", async () => { ... });
});

// Integration test — src/manager/__tests__/session-manager.test.ts
describe("restartAgent greeting emission", () => {
  it("invokes sendRestartGreeting after startAgent completes", async () => {
    // Stub webhookManager; spy on sendAsAgent; drive restartAgent;
    // assert restart success + greeting call.
  });
  it("does NOT invoke greeting on startAgent-only path", async () => { ... });
  it("does NOT invoke greeting on startAll path", async () => { ... });
  it("does NOT invoke greeting on crash-restart path (scheduleRestart → performRestart → startAgent)", async () => { ... });
  it("restart succeeds even when greeting throws (fire-and-forget invariant)", async () => {
    // sendAsAgent rejects; assert restartAgent returns normally; assert log.warn called.
  });
});
```

**Existing spy-test shapes to replicate:**
- `src/manager/__tests__/persistent-session-handle-effort.test.ts` — Phase 83 P1-P8 spy pattern for `q.setMaxThinkingTokens`.
- `src/manager/__tests__/persistent-session-handle-model.test.ts` — Phase 86 `q.setModel` canary (5 tests).
- `src/manager/__tests__/persistent-session-handle-permission.test.ts` — Phase 87 `q.setPermissionMode` (P1-P5 structure).

**Test helpers available:** `session-manager.test.ts:52` already sets up a `SessionManager` instance with a stub adapter (`makeConfig`, `registryPath`). Reuse for integration tests.

**Manual UAT item (for VALIDATION.md):**
- `UAT-01`: Operator restarts a dormant agent (last active >7 days ago) via `/clawcode-restart <agent>` and observes **no greeting** in the Discord channel.
- `UAT-02`: Operator restarts a fresh agent (recent session) and observes **a greeting embed** in the bound Discord channel with the correct webhook identity + <500-char description.
- `UAT-03`: Operator rapidly issues two `/clawcode-restart` within 2 minutes → the second restart does NOT emit a greeting (cool-down).
- `UAT-04`: Operator kills a running agent's process with SIGTERM, daemon auto-restarts it → NO greeting (per Finding 1, auto-crash-restart goes through `performRestart → startAgent` which bypasses the greeting hook; this is correct per D-01).

**Confidence:** HIGH.

## Finding 12: Integration Points Not Listed Above

**a) SessionManager construction needs the `WebhookManager` reference.** Currently `SessionManager` has no `webhookManager` field — it's daemon-scoped and passed to the delivery queue's deliverFn. For Phase 89:

**Recommended DI:** Add an OPTIONAL `webhookManager?: WebhookManager` to `SessionManagerOptions` at `session-manager.ts:50-76`. If undefined at restart time, the greeting helper is a no-op. Wire the WebhookManager reference into the SessionManager constructor in `daemon.ts` around line 1890 (where `webhookManager` already lives in scope). Daemon wiring order currently is: SessionManager created BEFORE webhookManager (line ~1471 vs 1823). Two options:

- **Option A (recommended):** Add a `setWebhookManager(wm: WebhookManager): void` method to SessionManager mirroring `setSkillsCatalog` at `session-manager.ts:254`. Call it from daemon.ts right after `webhookManager = new WebhookManager(...)` at line 1823 / 1834 / 1839. Side-effect: greeting is always off until the webhook manager is wired in (graceful degradation — matches daemon boot order reality).
- **Option B:** Reorder daemon.ts to construct WebhookManager before SessionManager. More invasive; reject.

**b) Hot-reload classification registration** — already addressed in Finding 7. Adding to `RELOADABLE_FIELDS` is the whole story.

**c) Migration verification compatibility** — `clawcode migrate openclaw verify` (Phase 82) walks the config schema and asserts every field is represented. Adding `greetOnRestart` / `greetCoolDownMs` as optional fields with defaults means v2.1 migrated configs (15 agents) parse unchanged. No verifier updates needed (the verifier is field-agnostic for additive-optional fields).

**d) YAML persistence helper (D-09 "future")** — NOT needed for Phase 89. If a future `/clawcode-greet on|off` slash command (deferred — §Deferred) lands, mirror `updateAgentModel` at `src/migration/yaml-writer.ts:401-517` as `updateAgentGreetOnRestart`. Zero work this phase.

**e) `/clawcode-status` visibility of the flag (89-03 plan question)** — CONTEXT.md §Decisions D-07 says "Surface ONLY the prior-session summary. Exclude: last-active timestamp, active model, active effort, open-loops list." This is specifically about the GREETING content, not `/clawcode-status`. But CONTEXT.md §Specifics does NOT call for `/clawcode-status` integration. Phases 83 EFFORT-07 and 86 MODEL-07 explicitly surface effort / model in `/clawcode-status`; Phase 89 should consider symmetrical surfacing — but since `greetOnRestart` is a boolean flag, its visibility is marginal value vs the implementation cost. **Recommendation: defer `/clawcode-status` integration to the deferred slash-command toggle (`/clawcode-greet`)** — keep Phase 89 ruthlessly scoped. Planner may decide otherwise.

**f) Plan decomposition recommendation (for the planner):**

The phase is small enough to fit in **2 plans** (original hint proposed 3):

- **Plan 89-01 — Schema + greeting helper module (pure)**
  - Schema additions (greetOnRestart + greetCoolDownMs) in schema.ts + shared/types.ts + loader.ts + RELOADABLE_FIELDS
  - NEW `src/manager/restart-greeting.ts` exporting `sendRestartGreeting`, `classifyRestart`, `buildRestartGreetingPrompt`, `buildCleanRestartEmbed`, `buildCrashRecoveryEmbed`, `isForkAgent`, `isSubagentThread`
  - NEW `src/manager/__tests__/restart-greeting.test.ts` with P1-P7 unit tests (skip-paths + happy path + truncation + cool-down + crash-template)
  - No SessionManager wiring yet — pure module only.
  - Acceptance: all unit tests green; schema regression test green (v2.1 fleet parses unchanged).

- **Plan 89-02 — SessionManager wiring + integration tests + fire-and-forget glue**
  - Add `webhookManager` field + `setWebhookManager` method to SessionManager
  - Add `greetCoolDownByAgent: Map<string, number>` field + cleanup in `stopAgent`
  - Wire fire-and-forget call at `session-manager.ts:938+` in `restartAgent`
  - Wire `setWebhookManager` call in daemon.ts around line 1823 / 1834 / 1839
  - NEW integration tests in `session-manager.test.ts` (emission path + skip paths + fire-and-forget safety)
  - Acceptance: restart fires greeting; `startAgent` / `startAll` / crash-restart don't; fire-and-forget invariant pinned by test.

If the planner wants 3 plans, split Plan 89-01 into (a) schema + types only (fast regression safety) and (b) restart-greeting helper module (bulk of logic). But 2 plans is cleaner — schema + helper share the same type dependencies and belong together.

**Confidence:** HIGH.

## Code Examples

### Example 1: Fire-and-forget callsite in `restartAgent`
```typescript
// Source: src/manager/session-manager.ts:932-939 (modified)
// Pattern: Phase 83 canary + setEffortForAgent fire-and-forget shape
async restartAgent(name: string, config: ResolvedAgentConfig): Promise<void> {
  await this.stopAgent(name);
  let registry = await readRegistry(this.registryPath);
  const prevEntry = registry.entries.find((e) => e.name === name);
  const prevConsecutiveFailures = prevEntry?.consecutiveFailures ?? 0;
  registry = updateEntry(registry, name, {
    restartCount: (prevEntry?.restartCount ?? 0) + 1,
  });
  await writeRegistry(this.registryPath, registry);
  await this.startAgent(name, config);

  // Phase 89 — fire-and-forget greeting (D-16: log + continue).
  const webhookManager = this.webhookManager;
  const convStore = this.memory.conversationStores.get(name);
  if (webhookManager && convStore) {
    void sendRestartGreeting(
      {
        webhookManager,
        conversationStore: convStore,
        summarize: this.summarizeFn,
        now: () => Date.now(),
        log: this.log,
        coolDownState: this.greetCoolDownByAgent,
      },
      {
        agentName: name,
        config,
        restartKind: classifyRestart(prevConsecutiveFailures),
      },
    ).catch((err: unknown) => {
      this.log.warn(
        { agent: name, error: (err as Error).message },
        "[greeting] sendRestartGreeting threw (non-fatal)",
      );
    });
  }
}
```

### Example 2: Cool-down check inside `sendRestartGreeting`
```typescript
// Source: src/manager/restart-greeting.ts (NEW)
// Pattern: mirror ConversationBriefCache at src/manager/conversation-brief-cache.ts:48-80
// + Phase 85 pure-function DI style

const coolDownMs = input.config.greetCoolDownMs;  // always populated post-resolve
const lastSentAt = deps.coolDownState.get(input.agentName);
if (lastSentAt !== undefined && deps.now() - lastSentAt < coolDownMs) {
  return { kind: "skipped-cool-down", lastGreetingAtMs: lastSentAt };
}

// ... do the work ...

// On successful send:
deps.coolDownState.set(input.agentName, deps.now());
return { kind: "sent", messageId };
```

### Example 3: Haiku summarization with 10s timeout
```typescript
// Source: src/manager/restart-greeting.ts (NEW)
// Pattern: mirror src/memory/session-summarizer.ts:DEFAULT_TIMEOUT_MS + AbortController plumbing

const timeoutMs = input.summaryTimeoutMs ?? 10_000;
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeoutMs);

let summary: string;
try {
  summary = await deps.summarize(
    buildRestartGreetingPrompt(turns, input.config, input.restartKind),
    { signal: controller.signal },
  );
} catch (err) {
  // Timeout / SDK error / abort — D-11 says no fallback greeting.
  return { kind: "skipped-empty-state" };
} finally {
  clearTimeout(timer);
}

if (summary.trim().length === 0) {
  return { kind: "skipped-empty-state" };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Agents silently resume on restart; operator checks logs to know daemon rebooted | Proactive Discord-visible "I'm back" message with summary context | v2.2 Phase 89 (this phase) | Operator has immediate context-recovery signal in the exact channel where the conversation lived — eliminates "did it come back up?" checks. |
| `assembleConversationBrief` injects a multi-session resume block into the agent's system prompt (passive) | Active Discord greeting (this phase) coexists with passive brief — different surfaces, different purposes | v1.9 → v2.2 | Dual-channel context recovery: the agent "remembers" (v1.9 brief) AND the human is told "the agent remembers" (Phase 89 greeting). |

**Deprecated / outdated:**
- Nothing deprecated by Phase 89. All surfaces are ADDITIVE.

## Open Questions

1. **Should the cool-down Map survive daemon boot?**
   - What we know: CONTEXT.md §Claude's Discretion says "in-memory reset on boot is acceptable." `startAll()` is silent (D-02), so no boot-time spam risk.
   - What's unclear: whether frequent daemon bounces could cause duplicate greetings close-in-time.
   - Recommendation: Accept in-memory reset. Daemon bounces are rare enough (systemd-managed); the cool-down exists primarily for rapid manual `/clawcode-restart` thrashing, which happens WITHIN one daemon process.

2. **Haiku prompt exact wording (Claude's Discretion per CONTEXT.md).**
   - What we know: target <500 char output, first-person, no markdown headers, no meta-commentary about being an AI.
   - What's unclear: balance between summarization terseness and "character" (agents have distinct vibes — Clawdy's "dry wit" per CLAUDE.md vs Finmentum agents' business voice).
   - Recommendation: Planner decides prompt wording in Plan 89-01. Draft shape in Finding 4 is sufficient skeleton. Pass the agent's `displayName` so the model can ground first-person voice correctly.

3. **Should the greeting append the agent's emoji (Clawdy's 💠)?**
   - What we know: CLAUDE.md says "include [💠] in every response" — but that's a SessionManager-level identity directive, not a webhook-message directive.
   - What's unclear: whether an operator-facing greeting counts as a "response."
   - Recommendation: Do NOT hardcode emojis in the greeting module. Let the per-agent Haiku output reflect whatever identity the agent's soul file expresses. Don't couple the shared greeting code to any single agent's identity convention. (The embed has its own structure; the emoji — if wanted — lives inside the Haiku-generated description.)

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@anthropic-ai/claude-agent-sdk` | `summarizeWithHaiku` | ✓ | 0.2.97 (pinned exact) | — |
| `discord.js` | `EmbedBuilder`, `WebhookClient` | ✓ | 14.26.2 | — |
| `better-sqlite3` | `ConversationStore` | ✓ | 12.8.0 | — |
| `zod` | Schema extension | ✓ | 4.3.6 | — |
| `pino` | `log.warn` on skip paths | ✓ | 9.x | — |
| `nanoid` | Not used directly (only regex-detected) | N/A | — | — |
| Discord webhook URL per agent | Webhook delivery | Runtime-dependent | — | Graceful skip (`{kind:"skipped-no-webhook"}`) when webhook not provisioned. |
| Anthropic API reachability | Haiku summarization | Runtime-dependent | — | 10s timeout → `{kind:"skipped-empty-state"}` (no fallback greeting per D-11). |

**Missing dependencies with no fallback:** None — every hard dep is already installed.
**Missing dependencies with fallback:** Webhook URL provisioning is per-agent runtime state; graceful skip handles absence.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `vitest` (already in devDependencies; used across the codebase) |
| Config file | `vitest.config.ts` (existing) |
| Quick run command | `npx vitest run src/manager/__tests__/restart-greeting.test.ts --reporter=dot` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GREET-01 | Greeting emits only on `restartAgent()`, not `startAgent` / `startAll` / auto-crash-restart | integration | `npx vitest run src/manager/__tests__/session-manager.test.ts -t "greeting emission"` | ❌ Wave 0 (new describe block) |
| GREET-02 | Fork (`-fork-<nano6>`) + subagent-thread (`-sub-<nano6>`) agents skip | unit | `npx vitest run src/manager/__tests__/restart-greeting.test.ts -t "fork"` | ❌ Wave 0 (new file) |
| GREET-03 | Crash-suspected template when `prevConsecutiveFailures > 0`; clean otherwise | unit | `npx vitest run src/manager/__tests__/restart-greeting.test.ts -t "template"` | ❌ Wave 0 |
| GREET-04 | Haiku call with <500-char description; timeout→skip (no fallback) | unit | `npx vitest run src/manager/__tests__/restart-greeting.test.ts -t "truncat\|timeout\|empty"` | ❌ Wave 0 |
| GREET-05 | Skip when dormant >7d; skip on empty state | unit | `npx vitest run src/manager/__tests__/restart-greeting.test.ts -t "dormant\|empty-state"` | ❌ Wave 0 |
| GREET-06 | `webhookManager.sendAsAgent` called with EmbedBuilder | unit | `npx vitest run src/manager/__tests__/restart-greeting.test.ts -t "sendAsAgent"` | ❌ Wave 0 |
| GREET-07 | v2.1 fleet configs parse unchanged (additive schema) | unit | `npx vitest run src/config/__tests__/loader.test.ts -t "greetOnRestart"` | ❌ Wave 0 |
| GREET-08 | Cool-down: second greeting within window skips; reset on stopAgent | unit | `npx vitest run src/manager/__tests__/restart-greeting.test.ts -t "cool-down"` | ❌ Wave 0 |
| GREET-09 | `restartAgent` succeeds even when greeting throws (fire-and-forget invariant) | integration | `npx vitest run src/manager/__tests__/session-manager.test.ts -t "fire-and-forget"` | ❌ Wave 0 |
| GREET-10 | Each restart produces a new messageId (no edit-in-place) | integration | `npx vitest run src/manager/__tests__/session-manager.test.ts -t "new message per restart"` | ❌ Wave 0 |
| UAT-01..04 | Operator-facing end-to-end verification (see Finding 11) | manual | N/A — manual UAT checklist in VALIDATION.md | Wave N/A |

### Sampling Rate
- **Per task commit:** `npx vitest run src/manager/__tests__/restart-greeting.test.ts src/manager/__tests__/session-manager.test.ts src/config/__tests__/loader.test.ts --reporter=dot`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work` + manual UAT checklist signed off.

### Wave 0 Gaps
- [ ] `src/manager/__tests__/restart-greeting.test.ts` — covers GREET-02..08 (unit)
- [ ] `src/manager/__tests__/session-manager.test.ts` — add `describe("restartAgent greeting emission")` block for GREET-01, GREET-09, GREET-10 (integration)
- [ ] `src/config/__tests__/loader.test.ts` — add regression test for GREET-07 (additive schema) alongside existing effort / allowedModels regression tests
- [ ] Framework install: none — `vitest` already in place.

## Sources

### Primary (HIGH confidence)
- **In-repo source files** (all read directly, 2026-04-23):
  - `src/manager/session-manager.ts:932-939` — `restartAgent` chokepoint
  - `src/manager/session-manager.ts:941-979` — `startAll` / `stopAll` / constructor
  - `src/manager/session-manager.ts:941-966` — `startAll` via `startAgent` (NOT restartAgent) — confirms D-02 by construction
  - `src/manager/registry.ts:1-120` + `src/manager/types.ts:20-56` — RegistryEntry + restartCount + consecutiveFailures shape
  - `src/manager/session-recovery.ts:142-195` — auto-crash-restart path confirmed to flow through `performRestart → startAgent`, NOT `restartAgent`
  - `src/manager/fork.ts:25-27` — `buildForkName` shape
  - `src/manager/summarize-with-haiku.ts:51-94` — reuse candidate signature
  - `src/manager/persistent-session-handle.ts:639-680` — Phase 83/86/87 fire-and-forget canary shape
  - `src/manager/effort-mapping.ts` — Phase 83 pure-function pattern
  - `src/manager/conversation-brief-cache.ts:48-80` — cool-down Map pattern
  - `src/manager/session-memory.ts:29-42` — `conversationStores: Map<string, ConversationStore>` public field
  - `src/discord/webhook-manager.ts:22-133` — `WebhookManager.send`, `sendAsAgent`, `hasWebhook`, `getIdentity` signatures
  - `src/discord/webhook-provisioner.ts:31-116` — auto-provision flow
  - `src/discord/bridge.ts:248-285` — `sendBudgetAlert` as embed-send reference
  - `src/discord/agent-message.ts:14-30` — `buildAgentMessageEmbed` as structural embed template
  - `src/discord/delivery-queue.ts:104-149` — schema is text-only; cannot carry embeds (D-13 gap)
  - `src/discord/subagent-thread-spawner.ts:97-132` — `-sub-<nanoid6>` pattern + `channels: []` headless
  - `src/memory/conversation-store.ts:282-316` — `listRecentSessions` / `listRecentTerminatedSessions`
  - `src/memory/conversation-store.ts:568-575` — `getTurnsForSessionLimited` prepared statement
  - `src/memory/conversation-brief.ts:81-227` — reference for dormancy pattern (skip under threshold gap)
  - `src/memory/session-summarizer.ts:26-30` — `DEFAULT_TIMEOUT_MS=10_000` + constants
  - `src/config/schema.ts:677-779` — additive-optional pattern (effort + allowedModels)
  - `src/config/loader.ts:285-317` — resolver pattern
  - `src/config/types.ts:42-86` — RELOADABLE_FIELDS / NON_RELOADABLE_FIELDS classification
  - `src/shared/types.ts:5-231` — `ResolvedAgentConfig` shape
  - `src/migration/yaml-writer.ts:349-517` — `updateAgentModel` template (reference for any future persist helper; not needed Phase 89)
  - `src/manager/daemon.ts:2140-2160` — IPC `case "restart":` fallback-to-startAgent path (correctly suppressing greeting)
  - `src/manager/daemon.ts:1471-1840` — daemon boot order (SessionManager before WebhookManager)
  - `src/manager/__tests__/session-manager.test.ts:124-136` — existing `restartAgent` describe block for test reuse
- **Planning docs** (read directly):
  - `.planning/phases/89-.../89-CONTEXT.md` — the 16 D-01..D-16 decisions (authoritative spec)
  - `.planning/STATE.md` — Phase 83/86/87 canary blueprint + Phase 85/86/88 IPC patterns
  - `.planning/ROADMAP.md` — Phase 89 entry with success criteria
- **CLAUDE.md** (project + global instructions) — stack pins, zero-new-deps mandate, GSD workflow enforcement

### Secondary (MEDIUM confidence)
- Phase 83/86/87 `persistent-session-handle.ts:639-680` — inferred blueprint pattern from comment-documented SDK pinning, validated by spy-test files in `__tests__/`.

### Tertiary (LOW confidence)
- None — every claim in this document traces to a direct source-read.

## Metadata

**Confidence breakdown:**
- Chokepoint / triggers: HIGH — exact line numbers from source.
- Fork / thread detection: HIGH — exact prefix patterns verified.
- Classifier: HIGH for logic; MEDIUM for template phrasing (Claude's Discretion).
- Summarizer reuse: HIGH — direct reuse of `summarizeWithHaiku`, no wrapper.
- Prior-session source: HIGH — `listRecentTerminatedSessions` + `getTurnsForSessionLimited` verified.
- Webhook delivery: HIGH — `sendAsAgent` signature verified; DeliveryQueue text-only gap explicitly documented.
- Schema addition: HIGH — Phase 83/86 pattern verified line-by-line.
- Cool-down Map: HIGH — `ConversationBriefCache` shape directly reusable.
- Fire-and-forget: HIGH — Phase 83 canary verified.
- Embed shape: MEDIUM — color/phrasing are Claude's Discretion; structural shape (EmbedBuilder calls) HIGH.
- Test strategy: HIGH — spy-test blueprints from Phase 83/86/87 directly applicable.
- Integration points: HIGH — DI shape for `WebhookManager` clearly derivable from existing `setSkillsCatalog` pattern.

**Research date:** 2026-04-23
**Valid until:** 2026-05-23 (30 days — stable surface, pre-1.0 SDK pinned to 0.2.97, zero new deps, no in-flight upstream refactor risk).

## RESEARCH COMPLETE

**Phase:** 89 - Agent Restart Greeting
**Confidence:** HIGH

### Key Findings (for the orchestrator return)
1. **Exact chokepoint** is `session-manager.ts:938` — inject fire-and-forget after `await this.startAgent(name, config)`. `startAll` + crash-restart + IPC fallback route to `startAgent`, NOT `restartAgent` — greeting correctly suppressed by construction on all non-D-01 paths. No new guards needed for D-02.
2. **Classifier is a one-liner** — `prevConsecutiveFailures > 0 ? "crash-suspected" : "clean"`. `restartCount` delta is useless (always +1). No new tracking mechanism required.
3. **Summarizer reuse is trivial** — `summarizeWithHaiku(prompt, { signal })` already accepts arbitrary prompts. No wrapper, no sibling. Add a prompt builder. 10s AbortController at call site (mirrors `session-summarizer.ts:DEFAULT_TIMEOUT_MS`).
4. **DeliveryQueue gap: text-only.** D-13 "subject to queue retry" is aspirational — queue schema stores `content TEXT NOT NULL` and cannot carry embeds. Greeting uses direct `webhookManager.sendAsAgent` + fire-and-forget. Document the gap; defer queue extension.
5. **Plan decomposition → 2 plans suffice** (not 3): 89-01 schema + pure helper module + unit tests; 89-02 SessionManager wiring + integration tests. The `/clawcode-status` integration, slash-command toggle, and YAML persist helper are all deferred per §Deferred.

### File Created
`/home/jjagpal/.openclaw/workspace-coding/.planning/phases/89-agent-restart-greeting-active-discord-send-of-prior-context-summary-on-restart/89-RESEARCH.md`

### Confidence Assessment
| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | Every dep already in package.json; zero new npm deps. |
| Architecture (chokepoint + helpers) | HIGH | Direct source-read of session-manager, fork, subagent-thread-spawner, webhook-manager, conversation-store. |
| Pitfalls | HIGH | DeliveryQueue text-only gap surfaced; auto-crash-restart path → greeting-suppressed by construction (D-01 literal read) surfaced; IPC restart-fallback → greeting-suppressed surfaced. |

### Open Questions
- Haiku prompt exact wording (Claude's Discretion — planner decides in 89-01).
- Embed color choices (blurple 0x5865F2 / amber 0xFFCC00 recommended; planner free to tune).
- Cool-down Map persistence across daemon boot (recommended: in-memory only, matches CONTEXT.md §Claude's Discretion).

### Ready for Planning
Research complete. Planner can now decompose Phase 89 into 89-01-PLAN.md (schema + pure helper) and 89-02-PLAN.md (SessionManager wiring + fire-and-forget glue + integration tests). Every PLAN `<read_first>` block can point to concrete line numbers, and every `<acceptance_criteria>` can reference the GREET-01..10 synthesized IDs in this document.
