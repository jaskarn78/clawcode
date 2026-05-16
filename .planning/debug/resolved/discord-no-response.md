---
status: resolved
trigger: "test-agent not responding in Discord channel despite showing as running in clawcode status after restart"
created: 2026-04-09T00:00:00Z
updated: 2026-04-09T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED — DiscordBridge class exists in bridge.ts but is never instantiated in daemon.ts. The daemon comment says "no bridge needed" but the bridge IS needed to receive Discord events and forward them to agent sessions.
test: Searched for DiscordBridge instantiation across entire src/ — only found in test files
expecting: n/a — root cause confirmed
next_action: Instantiate DiscordBridge in daemon.ts startDaemon() function

## Symptoms

expected: test-agent should respond to messages sent in Discord channel 1491623782807244880
actual: No response. Agent shows as "running" in clawcode status with fresh uptime after restart, but messages in Discord get no reply.
errors: No explicit errors visible. Previous daemon had silently died (PID 24076 gone), leaving stale registry. New daemon started (PID 27352), agent restarted successfully.
reproduction: Send a message in Discord channel 1491623782807244880 — no reply comes back.
started: Unknown when it originally stopped. Daemon was restarted, agent was restarted with clawcode restart test-agent.

## Eliminated

## Evidence

- timestamp: 2026-04-09T00:01:00Z
  checked: daemon.ts lines 228-231
  found: Comment says "Discord routing handled natively by each agent's Claude Code session. No separate bridge needed." DiscordBridge is never instantiated.
  implication: No code connects Discord message events to agent sessions

- timestamp: 2026-04-09T00:02:00Z
  checked: bridge.ts — DiscordBridge class
  found: Fully implemented bridge exists. Connects to Discord via discord.js, listens for messageCreate events, routes to agents via sessionManager.forwardToAgent(). Has thread support, reaction support, attachment handling.
  implication: The bridge code is ready to use but was deliberately excluded from the daemon based on a wrong assumption

- timestamp: 2026-04-09T00:03:00Z
  checked: Grep for DiscordBridge instantiation in src/
  found: Only instantiated in test files (bridge-attachments.test.ts). Never in production code.
  implication: Confirms the bridge is dead code in production

- timestamp: 2026-04-09T00:04:00Z
  checked: session-adapter.ts — SdkSessionAdapter.createSession()
  found: Creates sessions with sdk.unstable_v2_createSession() passing model, cwd, systemPrompt, permissionMode. No Discord plugin inheritance mechanism visible.
  implication: SDK sessions don't automatically inherit MCP plugins from the parent process. The "inherited plugin" assumption in the comment was wrong.

## Resolution

root_cause: DiscordBridge is never instantiated in daemon.ts. The bridge class (bridge.ts) connects to Discord and forwards messages to agent sessions, but daemon.ts skips it with a comment saying agents handle Discord "natively via inherited MCP plugin." This assumption is wrong — SDK sessions don't inherit Discord MCP plugins. Without the bridge, Discord messages have no path to reach agent sessions.
fix: Instantiate DiscordBridge in daemon.ts startDaemon(). Moved botToken loading earlier (shared by bridge and slash commands). Bridge connects to Discord, listens for messages in bound channels, forwards to agent sessions via sessionManager.forwardToAgent(). Added bridge.stop() to shutdown handler. Added discordBridge to return type.
verification: Type-checks clean (no new errors in daemon.ts). Daemon unit tests pass. Needs human verification: restart daemon and send a message in the Discord channel.
files_changed: [src/manager/daemon.ts]

## Verified resolved (2026-05-07)

Triaged during /gsd-progress --forensic. Fix code confirmed present on master:
- DiscordBridge instantiation present at src/manager/daemon.ts:4627 (`discordBridge = new DiscordBridge({`)
- src/discord/bridge.ts on master with DiscordBridge class export
- Numerous follow-up bridge commits since the fix shipped: 925f799 (exit-143 message loss), 36ae72a (hot-reload routing), 54e4e02 (bot-direct fallback) — bridge has been continuously refined in production
