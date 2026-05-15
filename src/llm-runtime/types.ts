/**
 * LlmRuntimeService types — provider-neutral interface for the primary
 * agent runtime (the LLM that drives every per-agent turn).
 *
 * Phase 136 introduces this seam at `src/llm-runtime/` mirroring the
 * Phase 117 `AdvisorService` pattern at `src/advisor/`. It exists for
 * one reason: Anthropic's 2026-05-14 announcement that programmatic
 * Agent SDK usage splits off from the interactive subscription pool
 * on 2026-06-15 at a flat $200/month cap. ClawCode runs 7 agents 24/7
 * — the cap will deplete in days, not weeks — so the runtime must be
 * pluggable BEFORE the cutover. Phase 136 ships the seam; Phase 137
 * adds the `anthropic-api-key` backend; Phase 138 adds credit
 * telemetry + automatic failover.
 *
 * **Design decision (locked in 136-01-SURVEY.md):** the seam exposes
 * an `SdkModule`-shaped surface, not a flattened service. The Claude
 * Agent SDK returns a `Query` object that carries per-conversation
 * state (`setModel`, `setMaxThinkingTokens`, `setPermissionMode`,
 * `interrupt`, `close`, `streamInput`, `mcpServerStatus`,
 * `setMcpServers`, `initializationResult`, `supportedCommands`) and
 * the existing call sites in `persistent-session-handle.ts` /
 * `session-adapter.ts` hold that Query reference for the entire
 * lifetime of a session. Flattening those mutators into a service
 * singleton would require rewriting both files (~4000 lines) and is
 * out of scope for the hard-deadline track. Phase 141 (Codex) and
 * Phase 142 (OpenRouter) implement the same surface; impedance
 * mismatch with non-Anthropic providers is solved at the adapter
 * layer inside each future backend, not at this seam.
 *
 * **Provider-neutral naming:** the canonical type for the runtime
 * "SDK shape" is `LlmRuntimeSdkModule` re-exported here as a thin
 * widening of `SdkModule` from `src/manager/sdk-types.ts`. The
 * widening adds `forkSession` (currently called on the imported SDK
 * at `src/manager/daemon.ts:3526` and `:10867` but never declared in
 * `SdkModule` — those sites cast through `unknown`). All other
 * runtime types (`SdkQuery`, `SdkQueryOptions`, `SdkStreamMessage`,
 * `SdkUserMessage`, `PermissionMode`, `SlashCommand`) are re-
 * exported from `src/manager/sdk-types.ts` via the barrel
 * (`./index.ts`) so consumers can migrate their imports to the seam
 * incrementally without per-call-site type refactors.
 *
 * See:
 *   - `.planning/phases/136-llm-runtime-multi-backend/136-CONTEXT.md`
 *     §`<decisions>` D-02 — interface shape locked
 *   - `.planning/phases/136-llm-runtime-multi-backend/136-01-PLAN.md`
 *     T-02 — package skeleton spec
 *   - `.planning/phases/136-llm-runtime-multi-backend/136-01-SURVEY.md`
 *     — every SDK call site enumerated; 4 runtime, 3 type-only
 *   - `src/advisor/types.ts` — the Phase 117 template
 *   - `src/manager/sdk-types.ts` — in-repo SDK type mirror (`SdkModule`,
 *     `SdkQuery`, etc.) that this seam widens; canonical for the
 *     existing fleet.
 */

import type {
  SdkModule,
  SdkQuery,
  SdkQueryOptions,
} from "../manager/sdk-types.js";

/**
 * Identifier for a registered LlmRuntime backend.
 *
 * Phase 136 ships ONLY `"anthropic-agent-sdk"` — the current
 * production runtime extracted verbatim. Phase 137 widens the enum
 * to add `"anthropic-api-key"` (pay-as-you-go safety valve). Future
 * phases add `"claude-code-interactive"` (probe-gated, Phase 140),
 * `"openai-codex"` (Phase 141), `"openrouter"` (Phase 142). The
 * Zod schema is the source of truth for what operators can actually
 * select; this type union is widened in lockstep when each phase
 * lands.
 */
export type LlmRuntimeBackend = "anthropic-agent-sdk";

/**
 * Fork-session options forwarded to the underlying runtime.
 *
 * Mirrors the shape callers pass at `src/manager/daemon.ts:3526`
 * + `:10867` today — a minimal, additive surface. Phase 117 +
 * Phase 124 both use this for advisor-fork / compaction-fork
 * primitives; the field set widens conservatively.
 *
 * Typed loosely (`unknown`) for runtime-specific fields so the
 * seam stays provider-neutral while preserving the call sites
 * verbatim. Each backend's `forkSession` implementation owns the
 * cast to its provider-native shape.
 */
export type LlmRuntimeForkOptions = Readonly<Record<string, unknown>>;

/**
 * Result of a successful `forkSession` call.
 *
 * The bundled Claude Agent SDK returns `{ sessionId: string }`;
 * future backends (`openai-codex`, `openrouter`) translate from
 * their provider-native shape into this normalised form.
 */
export type LlmRuntimeForkResult = Readonly<{
  sessionId: string;
}>;

/**
 * Provider-neutral SDK-module surface returned by the seam.
 *
 * Widens `SdkModule` (`src/manager/sdk-types.ts:308`) with the
 * `forkSession` method that the daemon already calls. The widening
 * is back-compat: every consumer that holds an `SdkModule` reference
 * continues to compile; the daemon sites that cast through `unknown`
 * for `forkSession` can drop the cast once they import from this
 * seam.
 *
 * Phase 137+ backends (`AnthropicApiKeyBackend`,
 * `ClaudeCodeInteractiveBackend`, `OpenAiCodexBackend`,
 * `OpenRouterBackend`) implement this interface — `query()` returns
 * an `SdkQuery`-shaped async generator with the same mutator
 * methods the Claude Agent SDK exposes today. Non-Anthropic
 * providers stub no-op the mutators that don't translate (e.g.,
 * `setPermissionMode` on Codex) — pre-optimising the cross-provider
 * adaptation is out of scope for Phase 136.
 */
export interface LlmRuntimeSdkModule extends SdkModule {
  /**
   * Fork an existing session into a new session id, optionally with
   * options that the underlying provider supports (system prompt
   * override, model override, etc.). The daemon today calls this for
   * advisor-fork (Phase 117) and compaction-fork (Phase 124 /
   * Phase 125). Phase 141+ backends translate to/from this shape.
   *
   * Mirrors `@anthropic-ai/claude-agent-sdk` `forkSession(id, opts)`
   * — callers in `daemon.ts:3526` + `:10867` invoke this signature
   * today; the SDK exports it on the imported module but `SdkModule`
   * didn't declare it. Phase 136 corrects that.
   */
  forkSession(
    sessionId: string,
    options?: LlmRuntimeForkOptions,
  ): Promise<LlmRuntimeForkResult>;
}

/**
 * Provider-neutral entry point for the primary agent runtime.
 *
 * The service exposes a single method — `loadSdkModule()` — that
 * returns the runtime's `SdkModule`-compatible shape. Every current
 * consumer (`session-adapter.ts:loadSdk`, `daemon.ts` compaction
 * triggers, `openai/endpoint-bootstrap.ts` template driver) goes
 * through this entry point after Phase 136. Direct
 * `await import("@anthropic-ai/claude-agent-sdk")` calls are
 * forbidden outside `src/llm-runtime/backends/anthropic-agent-sdk.ts`
 * — enforced by the static-grep CI test added in T-06.
 *
 * Single-method surface (rather than `query` / `forkSession` / etc.
 * directly on the service) preserves the existing call-site shape:
 * consumers receive an `SdkModule` reference and continue calling
 * `sdk.query(...)` / `sdk.forkSession(...)` exactly as they do today.
 * Zero refactor on the consuming side. Phase 137 adds a second
 * backend behind the same `loadSdkModule()`; Phase 141+ implement
 * provider-native adaptation inside their own backends.
 */
export interface LlmRuntimeService {
  /**
   * Return the provider-neutral SDK-module shape for the current
   * backend. Cached at the backend level — calling this repeatedly
   * across an agent's lifetime returns the same module reference,
   * matching the `cachedSdk` behaviour at
   * `src/manager/session-adapter.ts:1407` today.
   *
   * Errors surface via the rejected promise; callers handle the
   * same error paths they handle today (e.g.,
   * `"Claude Agent SDK is not installed"` for the
   * `anthropic-agent-sdk` backend when the optional dependency is
   * missing).
   */
  loadSdkModule(): Promise<LlmRuntimeSdkModule>;
}

/**
 * Constructor-injected dependencies for backend implementations.
 *
 * Backends receive these at construction (factory call in
 * `daemon.ts`) so they're fully testable with mocks. Phase 136
 * ships an empty `deps` for `AnthropicAgentSdkBackend` — the
 * backend's behaviour is identical to the current `loadSdk()` and
 * needs no injected deps. Phase 137 (`AnthropicApiKeyBackend`)
 * extends this shape to inject the API-key resolver.
 *
 * The `logger` field is reserved for Phase 138 credit-telemetry
 * structured-log emission; included in the deps shape now so
 * Phase 137 doesn't need to refactor backend constructors.
 */
export interface LlmRuntimeDeps {
  /**
   * Optional structured logger. When supplied, backends emit
   * boot-time telemetry through it (Phase 136 ships the
   * `phase136-llm-runtime` log key at the factory level). Pino-
   * compatible shape; the daemon's `log` field is the typical
   * production injection.
   */
  readonly logger?: {
    info: (obj: unknown, msg?: string) => void;
    warn: (obj: unknown, msg?: string) => void;
  };
}

/**
 * Re-export the in-repo SDK types so consumers can migrate their
 * imports from `../manager/sdk-types.js` to `../llm-runtime/index.js`
 * incrementally. Phase 136 keeps the originals in place — the
 * re-export is the chokepoint for Phase 137+ to swap the underlying
 * type definitions if a future backend diverges from the SDK's
 * shape.
 */
export type { SdkModule, SdkQuery, SdkQueryOptions };
