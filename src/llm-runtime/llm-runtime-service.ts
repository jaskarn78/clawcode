/**
 * `createLlmRuntimeService` — factory that returns the configured
 * backend per agent.
 *
 * Phase 136 ships ONE backend (`anthropic-agent-sdk`, current
 * behaviour). The factory dispatches on `config.llmRuntime.backend`;
 * Phase 137 widens the switch to add `anthropic-api-key`, Phase 138+
 * add the rest.
 *
 * **Construction-site invariant** (per CONTEXT.md D-03a +
 * `feedback_silent_path_bifurcation`): exactly ONE call to
 * `createLlmRuntimeService` per agent per session in the daemon.
 * The resulting `LlmRuntimeService` is threaded into every
 * downstream consumer (`session-adapter`, `persistent-session-
 * handle`, compaction triggers, template driver) via dependency
 * injection. There must be NO direct
 * `await import("@anthropic-ai/claude-agent-sdk")` outside
 * `src/llm-runtime/backends/anthropic-agent-sdk.ts` — enforced by
 * the static-grep CI test (T-06).
 *
 * **Telemetry** (D-07): one `phase136-llm-runtime` structured log
 * line per agent at factory time. Operators grep
 * `journalctl -u clawcode -g phase136-llm-runtime` to confirm
 * migration coverage across the fleet.
 *
 * See:
 *   - `./types.ts` — interface + backend enum + deps shape
 *   - `./backends/anthropic-agent-sdk.ts` — the ONLY runtime
 *     `@anthropic-ai/claude-agent-sdk` import site
 *   - `./backends/portable-fork.ts` — Phase 14X scaffold; throws on
 *     load; not selectable in Zod enum
 *   - `.planning/phases/136-llm-runtime-multi-backend/136-01-PLAN.md`
 *     T-02 spec
 *   - `src/advisor/registry.ts` — Phase 117 template for backend
 *     resolution (this file is the LlmRuntime parallel)
 */

import type { ResolvedAgentConfig } from "../shared/types.js";
import type { LlmRuntimeDeps, LlmRuntimeService } from "./types.js";
import { AnthropicAgentSdkBackend } from "./backends/anthropic-agent-sdk.js";

/**
 * Construct an `LlmRuntimeService` for the given agent.
 *
 * Phase 136 dispatches on `config.llmRuntime.backend`. The default
 * (set by the Zod resolver in `src/config/loader.ts`) is
 * `"anthropic-agent-sdk"` so agents without an `llmRuntime` block
 * in clawcode.yaml continue to use the current production behaviour
 * with zero change.
 *
 * Emits one structured log line at construction (key
 * `phase136-llm-runtime`) so operators can audit migration coverage
 * via journalctl. The log goes through `deps.logger` when supplied
 * (production path — the daemon's pino logger); when omitted (unit
 * tests), falls back to `console.info` to keep the telemetry path
 * single-source.
 *
 * @param config Resolved per-agent config (post-defaults merge).
 *               Must carry `config.llmRuntime.backend`.
 * @param deps   Constructor-injected dependencies. Optional logger
 *               is the only field today; Phase 137 widens.
 * @returns      An `LlmRuntimeService` for this agent's session
 *               lifetime. Cached at backend level for ESM module
 *               reuse (Node's dynamic-import cache is shared per
 *               process anyway).
 */
export function createLlmRuntimeService(
  config: ResolvedAgentConfig,
  deps: LlmRuntimeDeps = {},
): LlmRuntimeService {
  // Default to the Phase 136 baseline backend when the resolver
  // (T-05 in `src/config/loader.ts`) hasn't populated the field
  // yet. After Phase 136 fully lands, the loader ALWAYS sets this
  // — the `?? { backend: "anthropic-agent-sdk" }` is back-compat
  // for unit-test ResolvedAgentConfig factories that don't go
  // through the resolver.
  const backend = config.llmRuntime?.backend ?? "anthropic-agent-sdk";
  const telemetry = {
    agent: config.name,
    backend,
    model: config.model,
  };
  if (deps.logger) {
    deps.logger.info(telemetry, "phase136-llm-runtime");
  } else {
    // eslint-disable-next-line no-console
    console.info("phase136-llm-runtime", JSON.stringify(telemetry));
  }

  switch (backend) {
    case "anthropic-agent-sdk":
      return new AnthropicAgentSdkBackend(config, deps);
    default: {
      // The Zod enum should prevent us from reaching this branch,
      // but TypeScript's exhaustiveness check is paranoia-cheap.
      const unreachable: never = backend;
      throw new Error(
        `Unknown llmRuntime.backend: ${String(unreachable)} (agent=${config.name})`,
      );
    }
  }
}
