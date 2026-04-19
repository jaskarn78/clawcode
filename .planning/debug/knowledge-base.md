# GSD Debug Knowledge Base

Resolved debug sessions. Used by `gsd-debugger` to surface known-pattern hypotheses at the start of new investigations.

---

## clawdy-v2-stability — OpenAI endpoint not binding, zombie subagent registry entries, spurious restartCount
- **Date:** 2026-04-19
- **Error patterns:** OpenAI endpoint disabled via config, Memory store not found for agent, port 3101 not bound, restartCount, sub-agent, thread, reconcileRegistry, stopped, zod default, schema default
- **Root cause:** Three distinct issues. (1) Zod `.default({})` on outer field vs `.default(() => ({...full...}))` factory: when parent z.object parses input missing the field, it injects the literal default VALUE without running inner `.default()` validators → empty object → `enabled` is undefined → OpenAI endpoint short-circuits to NOOP_HANDLE and never binds port 3101. (2) fin-test restartCount=14 was not a crash loop — RegistryEntry.restartCount is lifetime-persisted and only SessionManager.restartAgent() increments it (explicit CLI/IPC restarts), NOT crash recovery; AgentRunner.restartCount is separate in-memory per-boot. (3) stopAgent marks status="stopped" but never removes entry; reconcileRegistry only pruned orphans (unknown parent) with no TTL reap → permanent gravestones that dashboard SSE iterated every 15s, each triggering "Memory store not found" log.error.
- **Fix:** (1) Change openaiEndpointSchema outer `.default({})` → `.default(() => ({ enabled: true, port: 3101, host: "0.0.0.0", maxRequestBodyBytes: 1048576, streamKeepaliveMs: 15000 }))` matching browser/search/image factory pattern. (2) No code change — informational counter. (3) Add `stoppedAt?: number | null` to RegistryEntry; set it in stopAgent; add TTL-based reap to reconcileRegistry (1h default via STOPPED_SUBAGENT_REAP_TTL_MS) with PrunedEntry reasons `stale-subagent` / `stale-thread`; filter dashboard SSE pollMemoryStats by status="running".
- **Files changed:** src/config/schema.ts, src/config/__tests__/schema.test.ts, src/manager/types.ts, src/manager/registry.ts, src/manager/session-manager.ts, src/manager/__tests__/registry.test.ts, src/dashboard/sse.ts
---

