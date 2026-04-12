---
status: awaiting_human_verify
trigger: "Running clawcode CLI commands produces 'Invalid API key' error"
created: 2026-04-10T00:00:00Z
updated: 2026-04-10T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED - Stale ANTHROPIC_API_KEY in ~/.bashrc overrides OAuth subscription auth
test: Found sk-ant-oat01-... key exported in ~/.bashrc; SDK inherits process.env by default
expecting: Removing or unsetting the key will fix the error
next_action: Apply fix to SdkSessionAdapter to strip ANTHROPIC_API_KEY from env

## Symptoms

expected: clawcode commands use the Claude Code subscription auth (inherited from parent session or Agent SDK default auth)
actual: "Invalid API key - Fix external API key" error when running clawcode
errors: "Invalid API key - Fix external API key"
reproduction: Run clawcode CLI commands (e.g., `clawcode run test-agent`)
started: After building and npm-linking the CLI via tsup

## Eliminated

## Evidence

- timestamp: 2026-04-10T00:01
  checked: ~/.bashrc for ANTHROPIC_API_KEY
  found: export ANTHROPIC_API_KEY="sk-ant-oat01-..." — an OAuth token exported in bashrc
  implication: All child processes inherit this potentially stale/expired key

- timestamp: 2026-04-10T00:02
  checked: SdkSessionAdapter env handling
  found: No env option passed to SDK query() — defaults to process.env which includes ANTHROPIC_API_KEY
  implication: Claude CLI subprocess sees the env var and uses it instead of OAuth subscription auth

- timestamp: 2026-04-10T00:03
  checked: SDK query() without ANTHROPIC_API_KEY (direct test)
  found: Works fine — returns result successfully with OAuth auth
  implication: Confirms the issue is the stale ANTHROPIC_API_KEY overriding valid auth

- timestamp: 2026-04-10T00:04
  checked: clawcode.yaml MCP server config
  found: anthropic MCP server has ANTHROPIC_API_KEY: '${ANTHROPIC_API_KEY}' — env var template that resolves to the stale key
  implication: Both the main CLI and MCP servers are affected by the stale key

## Resolution

root_cause: Stale/expired ANTHROPIC_API_KEY (sk-ant-oat01-...) exported in ~/.bashrc is inherited by the SDK-spawned Claude CLI subprocess. Claude Code sees this env var and uses it as the API key instead of the user's valid OAuth subscription auth. When the key is invalid, it shows "Invalid API key - Fix external API key".
fix: Two-part fix: (1) Strip ANTHROPIC_API_KEY from the env passed to SDK query() in SdkSessionAdapter so it always uses OAuth subscription auth. (2) User should remove the stale export from ~/.bashrc.
verification: Self-verified — ran `clawcode run test-agent` with ANTHROPIC_API_KEY=sk-ant-oat01-INVALID in env. Agent started successfully (session created, Discord connected). All 772 tests pass. TypeScript compiles clean.
files_changed: [src/manager/session-adapter.ts]
