# Deferred Items — Phase 82

## Pre-existing test failures (out of scope for Phase 82)

The following 10 test failures existed on master BEFORE Phase 82 work began.
They are unrelated to pilot-selector, cutover, report-writer, or fs-guard
allowlist changes. Documented here for future cleanup but not addressed in
Phase 82-01 (scope boundary).

### src/manager/__tests__/bootstrap-integration.test.ts (2 failing)
- buildSessionConfig with bootstrapStatus complete returns normal prompt
- buildSessionConfig with bootstrapStatus undefined returns normal prompt (backward compat)

### src/manager/__tests__/daemon-openai.test.ts (7 failing)
- startOpenAiEndpoint > boot: startOpenAiServer is called with port + host from config
- startOpenAiEndpoint > CLAWCODE_OPENAI_PORT env overrides config port
- startOpenAiEndpoint > CLAWCODE_OPENAI_PORT non-integer falls back to config port
- startOpenAiEndpoint > CLAWCODE_OPENAI_HOST env overrides config host
- startOpenAiEndpoint > shutdown: server.close runs before apiKeysStore.close
- startOpenAiEndpoint > shutdown: server.close throwing does not prevent apiKeysStore.close
- startOpenAiEndpoint > handle.apiKeysStore is exposed for IPC/CLI reuse

### src/manager/__tests__/session-manager.test.ts (1 failing)
- configDeps wiring — Phase 67 gap-closure > configDeps passes conversationStores and memoryStores

Verified via `git stash` + test re-run prior to Phase 82 changes: all 10
fail on the untouched master baseline. Phase 82 Wave 1 adds 52 new tests
and passes ALL existing migration tests (235 → 287 migration-suite green).
