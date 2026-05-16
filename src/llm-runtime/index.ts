/**
 * Public surface of `src/llm-runtime/`.
 *
 * Call sites (daemon agent boot, session-adapter, persistent-
 * session-handle, openai template-driver bootstrap) import
 * everything runtime-related from this barrel — they MUST NOT
 * reach into individual module files. Tight seam, easier future
 * refactor.
 *
 * Phase 136 scope: types, factory, two backends (anthropic-agent-sdk
 * + portable-fork scaffold). Phase 137 adds `anthropic-api-key`;
 * Phase 138 wires credit telemetry; Phase 141+ add Codex / OpenRouter.
 *
 * **SDK-type re-exports** (`SdkModule`, `SdkQuery`, `SdkQueryOptions`)
 * are intentional: Phase 137+ may evolve those shapes for non-
 * Anthropic backends, and we want one place to swap the underlying
 * type aliases. Today they pass through verbatim from
 * `src/manager/sdk-types.ts`.
 */

export type {
  LlmRuntimeBackend,
  LlmRuntimeDeps,
  LlmRuntimeForkOptions,
  LlmRuntimeForkResult,
  LlmRuntimeSdkModule,
  LlmRuntimeService,
  // SDK-type pass-throughs (consumers should migrate imports from
  // `../manager/sdk-types.js` to this barrel over the next 1-2 phases).
  SdkModule,
  SdkQuery,
  SdkQueryOptions,
} from "./types.js";

export { createLlmRuntimeService } from "./llm-runtime-service.js";

// Free-function chokepoint for the Phase 136 → 137 migration ramp.
// Legacy call sites (session-adapter.ts:loadSdk, daemon.ts compaction
// triggers, openai/endpoint-bootstrap.ts) call this directly during
// Phase 136 T-04 so the patch surface is the 4 import lines only —
// not the surrounding wiring. Phase 137 threads `LlmRuntimeService`
// through DI for those sites and the free function is retired.
//
// Backends themselves are NOT re-exported — call sites that need an
// `LlmRuntimeService` get one from the factory + DI, never by
// constructing a backend class directly. The static-grep CI test
// (T-06) treats backend files as private to this package.
export { loadAnthropicAgentSdkModule } from "./backends/anthropic-agent-sdk.js";
