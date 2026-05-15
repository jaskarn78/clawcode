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

// Backends are NOT re-exported by default — call sites should
// receive an `LlmRuntimeService` reference via DI, not construct
// backends directly. The static-grep CI test (T-06) treats backend
// files as private to this package.
