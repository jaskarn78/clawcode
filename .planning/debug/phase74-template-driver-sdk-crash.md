---
status: awaiting_human_verify
trigger: "Phase 74 OpenClawTemplateDriver: POST /v1/chat/completions with model openclaw:phase74-smoke:sonnet returns 500 driver_error. Native pinned agents via same persistent-handle primitive work fine."
created: 2026-04-19T23:50:00Z
updated: 2026-04-20T01:10:00Z
---

## Current Focus

hypothesis: RESOLVED — see Resolution block.
test: Tests green (317/317 in src/openai; whole-suite pass/fail counts unchanged vs master); tsc unchanged (29/29).
expecting: Live smoke via orchestrator deploy path.
next_action: Commit fix. Await orchestrator smoke confirmation.

## Symptoms

expected:
  - Template-driver path materializes a persistent Claude SDK session keyed on (bearer, slug, sha256(SOUL), tier), streams a response, emits 200.
  - End-to-end TTFB should be comparable to Phase 73's sub-2s native path since both use the same persistent-handle primitive.

actual:
  - POST /v1/chat/completions with model="openclaw:<slug>:<tier>" returns HTTP 500, body {"error":{"message":"Driver failed to produce a response","type":"server_error","code":"driver_error"}}.
  - Pre-hotfixes: fails in ~40ms. Post-hotfixes (env+ensureCwd+settingSources): ~1.5s — subprocess actually starts and runs briefly, then crashes.
  - Native pinned agents (fin-test, admin-clawdy, test-agent) via SAME persistent-handle primitive work perfectly at 1.7s TTFB.

errors:
  - Journal: `Agent error: error_during_execution` at iterateUntilResult (sdk). SDK's way of saying the Claude CLI subprocess emitted a result event with is_error:true, subtype:"error_during_execution".
  - Earlier (pre-env-fix): "Claude Code executable not found at .../cli.js. Is options.pathToClaudeCodeExecutable set?"

reproduction:
  1. Bearer key ck_all_gm1v7NflLYO_1t5evdte8D8M_9q5SNND (scope=all).
  2. POST http://100.98.211.108:3101/v1/chat/completions with model "openclaw:phase74-smoke:sonnet", system+user messages.
  3. Expect 500, driver_error.

started: Phase 74 initial deployment on clawdy ~2026-04-19 23:58 UTC.

## Eliminated

- hypothesis: (a) systemPrompt raw string rejected by SDK
  evidence: SDK sdk.d.ts:1460 explicitly types `systemPrompt?: string | { type: 'preset'; ...}`. Raw string is valid. Docs (1437-1440) give `systemPrompt: 'You are a helpful coding assistant.'` as a valid "Custom prompt" example. Rule out.
  timestamp: 2026-04-19T23:55:00Z
- hypothesis: (c) Permission flag conflict (both permissionMode + allowDangerouslySkipPermissions)
  evidence: Not a likely cause of error_during_execution mid-run. allowDangerouslySkipPermissions is the legacy flag; permissionMode:"bypassPermissions" is the modern replacement. Having both is redundant but not fatal. The native path sets only permissionMode and works. Low probability of being the cause.
  timestamp: 2026-04-19T23:55:00Z
- hypothesis: (d) Transient cwd side-effects from clawcode-config root
  evidence: CLAWCODE_TRANSIENT_CWD is .clawcode/manager/transient, which is NOT under a project with conflicting .clawcode settings. The Claude CLI loads settings from the nearest enclosing project directory upward. ensureCwd is already creating it. Even if settings loaded from ~/.clawcode/manager/ that's an empty directory tree. Not a likely root cause.
  timestamp: 2026-04-19T23:55:00Z

## Evidence

- timestamp: 2026-04-19T23:50:00Z
  checked: symptom block timeline
  found: 3 hotfixes applied (env spread, ensureCwd mkdirSync, settingSources=["project"]). Failure mode progressed from "CLI not found" → "error_during_execution" after ~1.5s.
  implication: Env + path + settingSources issues are resolved; remaining crash is INSIDE the CLI subprocess. The subprocess is starting, not finding missing files, and running briefly before asking itself to die.

- timestamp: 2026-04-19T23:55:00Z
  checked: template-driver.ts:215-220 vs session-adapter.ts:426-436
  found: TEMPLATE DRIVER passes `randomUUID()` as the 3rd arg to createPersistentSessionHandle. Native SdkSessionAdapter.createSession FIRST drains `sdk.query({prompt:"Session initialized.", options: stripHandleOnlyFields(baseOptions)})` (session-adapter.ts:426), reads `session_id` from the result message, THEN hands that SDK-created sessionId to createPersistentSessionHandle (:429-436).
  implication: The persistent handle's single long-lived query (persistent-session-handle.ts:69-84) always sets `resume: initialSessionId`. When initialSessionId is a real SDK-created session, the SDK loads its JSONL from disk. When it's a random UUID that has no disk presence, the SDK tries to resume a non-existent session → CLI subprocess emits result with `subtype: 'error_during_execution'`. This is hypothesis (b).

- timestamp: 2026-04-19T23:56:00Z
  checked: node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1310-1324
  found: SDK contract distinguishes `resume` ("Loads the conversation history from the specified session") from `sessionId` ("Use a specific session ID for the conversation instead of an auto-generated one. Must be a valid UUID. Cannot be used with `continue` or `resume` unless `forkSession` is also set"). `resume` REQUIRES an existing session. `sessionId` CREATES a new session with the specified UUID.
  implication: Two valid fixes: (A) drain an initial query in template driver (mirrors native path). (B) use `sessionId:` not `resume:` in persistent-session-handle. (B) requires modifying the shared primitive; (A) is localized to template-driver.ts. Choose (A) per "do not regress native path" constraint.

## Resolution

root_cause: |
  OpenClawTemplateDriver skipped the initial-drain bootstrap that establishes
  a real SDK session on disk. It passed `randomUUID()` as the initialSessionId
  to createPersistentSessionHandle, which immediately issued
  `sdk.query({..., resume: randomUUID()})`. Per SDK sdk.d.ts:1310-1312,
  `resume` REQUIRES an existing session — a fresh random UUID has no history,
  so the Claude CLI subprocess emits result with subtype:"error_during_execution"
  after ~1.5s of failing to load non-existent session JSONL. The native path
  (session-adapter.ts:422-436) always drains `sdk.query({prompt: "Session
  initialized.", options: baseOptions})` FIRST to get an SDK-minted session_id,
  then hands THAT to createPersistentSessionHandle — which is why native
  pinned agents work at 1.7s TTFB.

fix: |
  Mirror the native path in template-driver.ts. Convert the handle
  materialization path to async:
    1. Drain `sdk.query({prompt: "Session initialized.", options: baseOptions})`
       via a new helper `drainForSessionId` (throws if drain errors or yields
       no session_id — template driver has no prior session to fall back to,
       so a pending-timestamp id would just replicate the crash).
    2. Pass the SDK-minted sessionId to createPersistentSessionHandle.
  Updated tests to mock sdk.query() as an async generator yielding a result
  message with session_id. Native path (session-adapter.ts + persistent-
  session-handle.ts) UNTOUCHED — fix is localized to template-driver.ts and
  its unit tests.

verification: |
  - npx vitest run src/openai/ → 16 files, 317 tests, ALL PASS.
  - npx vitest run (full suite) → 3241 pass / 8 fail. The 8 failures all exist
    on master (verified via git stash). None are introduced by this fix.
  - npx tsc --noEmit → 29 errors (matches master baseline of 29).
  - Live smoke deferred to orchestrator (deploy+curl).

files_changed:
  - src/openai/template-driver.ts
  - src/openai/__tests__/template-driver.test.ts
  - src/openai/__tests__/template-driver-cost-attribution.test.ts
