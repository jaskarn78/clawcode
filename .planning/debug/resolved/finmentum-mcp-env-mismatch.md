---
status: resolved
trigger: "finmentum-db MCP crashes with ENOTFOUND op://... — unresolved 1P secret-reference placeholders in process env, AND env var names don't match mcporter.json"
created: 2026-04-22T00:00:00Z
updated: 2026-04-22T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED — ClawCode never resolves op:// references for MCP server env vars. Only the Discord botToken resolver (daemon.ts:1713 via `execSync("op read ...")`) handles op://. For every MCP server, src/config/loader.ts `resolveEnvVars()` only expands `${VAR}` patterns, then session-adapter.ts `transformMcpServersForSdk()` passes `env: { ...s.env }` straight into the Claude Agent SDK, which spawns the MCP subprocess with that env verbatim. Any op:// literal in clawcode.yaml mcpServers[].env arrives at the child unchanged → the child's DNS stack gets "op://..." and ENOTFOUND.
test: VERIFIED via full read of loader.ts, health.ts, session-adapter.ts, and daemon.ts — no `op read`/`op run`/execSync for MCP env anywhere.
expecting: Fix is to resolve op:// refs during config resolution (resolveAgentConfig) or at spawn time (session-adapter/health). Resolving at config load keeps the hot path clean.
next_action: Implement op:// resolver and wire it through resolveEnvVars. Also investigate the env-name mismatch (MYSQL_PASS/MYSQL_DB/hostname in running process) — likely a stale process from before current yaml, or a different clawcode.yaml on clawdy server.

## Symptoms

expected:
  - finmentum agent's finmentum-db MCP server connects to MySQL on Unraid
  - MCP process env should contain resolved values (real hostname/user/pass)
  - Env var names in process must match mcporter.json declarations

actual:
  - finmentum-db MCP crashes with ENOTFOUND op://clawdbot/MySQL DB - Unraid/hostname
  - Running process env has literal op:// reference strings
  - Env var names in process differ from env var names in /home/clawcode/.clawcode/agents/finmentum/config/mcporter.json (which uses hardcoded values, not op://)

errors:
  - ENOTFOUND op://clawdbot/MySQL DB - Unraid/hostname (DNS lookup on literal op:// string)

reproduction:
  - Start finmentum agent on clawdy server → finmentum-db MCP fails with ENOTFOUND

started: Unknown, but commit c1c4ac2 recently changed 1P auto-inject to @takescake/1password-mcp — worth checking.

## Eliminated

## Evidence

- timestamp: 2026-04-22 inv-1
  checked: Root clawcode.yaml mcpServers.finmentum-db
  found: Defines env with op:// refs — MYSQL_HOST=op://clawdbot/MySQL DB - Unraid/host, MYSQL_USER=op://...username, MYSQL_PASSWORD=op://clawdbot/Finmentum DB/password. Env var NAMES match MYSQL_HOST/MYSQL_USER/MYSQL_PASSWORD/MYSQL_DATABASE. command: `mcporter`, args: [serve, mysql].
  implication: This is the config shape the daemon sees. op:// values flow through unless resolved.

- timestamp: 2026-04-22 inv-2
  checked: /home/jjagpal/.clawcode/agents/finmentum/config/mcporter.json (local copy)
  found: Defines finmentum-db with DIFFERENT spawn (command: node, args: [/home/jjagpal/clawd/projects/finance-clawdy/mysql-mcp-server.js]) and HARDCODED values (MYSQL_HOST=100.117.234.17, MYSQL_PASSWORD=KME...). Env names match MYSQL_HOST/MYSQL_USER/MYSQL_PASSWORD/MYSQL_DATABASE.
  implication: mcporter.json is the `mcporter` tool's own config file (loaded from ./config/mcporter.json) — NOT read by ClawCode daemon. It's what `mcporter list`/`mcporter call` use locally, not what spawns the MCP under the daemon. So the running process's env is NOT coming from this file.

- timestamp: 2026-04-22 inv-3
  checked: src/config/loader.ts resolveEnvVars (lines 287-291)
  found: Only expands `\\${VAR_NAME}` patterns against process.env. No op:// handling.
  implication: op:// strings in clawcode.yaml env propagate through config resolution unchanged.

- timestamp: 2026-04-22 inv-4
  checked: src/config/loader.ts resolveAgentConfig (lines 155-168)
  found: Resolved mcpServers env is produced by `Object.fromEntries(Object.entries(s.env ?? {}).map(([k, v]) => [k, resolveEnvVars(v)]))`. resolveEnvVars only handles ${...}. No 1Password resolver called.
  implication: Agent config hands the SDK/spawn layer an env map with op:// literals intact.

- timestamp: 2026-04-22 inv-5
  checked: src/mcp/health.ts checkMcpServerHealth (line 75)
  found: `env: { ...process.env, ...server.env }` — passes server.env straight into `spawn()` for the readiness handshake. No op:// resolution.
  implication: Readiness handshake subprocess gets op:// literals in env. MySQL driver in child calls dns.lookup("op://...") → ENOTFOUND.

- timestamp: 2026-04-22 inv-6
  checked: src/manager/session-adapter.ts transformMcpServersForSdk (lines 605-614) and createSession (line 529) / resumeSession (line 569)
  found: `env: { ...s.env }` passed verbatim into SDK's `mcpServers` option which the SDK uses to spawn MCP children.
  implication: Same as above — op:// literals reach every MCP child spawned by the long-running session.

- timestamp: 2026-04-22 inv-7
  checked: Full codebase grep for `op read|op run|OnePassword|op://` in src/
  found: Only match for op:// resolution logic is src/manager/daemon.ts:1713-1715 which runs `execSync("op read \"<ref>\"")` — but ONLY for `config.discord.botToken`. Nowhere else.
  implication: ROOT CAUSE. 1Password auto-injection for env vars is not implemented for MCP servers. Only the Discord bot token is resolved. The "1password auto-inject" in commit c1c4ac2 refers to auto-injecting the 1Password MCP _server_ (so the agent can call 1P from inside a conversation), NOT auto-resolving op:// refs in other servers' env at spawn time.

- timestamp: 2026-04-22 inv-8
  checked: mcporter CLI package (v0.7.3) — which implements `mcporter serve` and variants
  found: No `serve` subcommand. `mcporter serve mysql` would fail with "Unknown MCP server 'serve'" locally. On clawdy server, the running process (PID 774502) appears to have a different command/args entirely — MYSQL_PASS/MYSQL_DB/hostname env names match NEITHER clawcode.yaml nor mcporter.json.
  implication: The running process env (MYSQL_PASS / MYSQL_DB / "hostname" field) suggests either (a) the clawdy server's clawcode.yaml has different names than this workspace's, OR (b) the process is stale from an older config. The env-NAME mismatch is a secondary concern — needs the clawdy yaml to confirm, but the op:// passthrough is the primary bug and blocks regardless.

- timestamp: 2026-04-22 inv-9
  checked: 1Password MCP auto-inject block in src/config/loader.ts (lines 89-98)
  found: Auto-injects the 1password MCP server with `env: { OP_SERVICE_ACCOUNT_TOKEN: process.env.OP_SERVICE_ACCOUNT_TOKEN }`. This MCP exposes 1P _tools_ to the agent (so the agent can ask 1P for secrets during conversation). It is NOT a pre-spawn resolver for other servers' op:// env refs.
  implication: The design as-shipped requires the agent to fetch secrets at runtime via the 1P MCP and pass them to tool calls itself — OR the operator to write literal secrets in yaml — OR a pre-spawn resolver to be added. Operators writing op:// refs in mcpServers[].env see the literal string passed to the child. That is the bug.

## Resolution

root_cause: |
  ClawCode resolves `op://` 1Password secret references for exactly ONE field (discord.botToken in src/manager/daemon.ts:1713) and nowhere else. For every MCP server, the config pipeline passes env values through `resolveEnvVars` (which only handles `${VAR}` patterns) and hands the result verbatim to the Claude Agent SDK, which spawns the MCP subprocess. Any `op://vault/item/field` value in clawcode.yaml's `mcpServers[].env` therefore reaches the child process as a literal string. The MySQL driver inside `mcporter serve mysql` (or the finmentum-db MCP, whichever is configured) then calls `dns.lookup("op://clawdbot/MySQL DB - Unraid/hostname")` and crashes with ENOTFOUND.

  Secondary: commit c1c4ac2 (recent) fixed the auto-inject of the 1Password _MCP server_ package name. That's orthogonal — it gives the agent runtime tools to query 1P during a conversation; it does NOT resolve op:// refs embedded in _other_ servers' spawn env. Those two responsibilities were conflated in the original design.

  The env-NAME mismatch on the running process (MYSQL_PASS/MYSQL_DB/hostname vs. clawcode.yaml's MYSQL_PASSWORD/MYSQL_DATABASE/host) is a separate issue — almost certainly a stale clawcode.yaml on the clawdy server (or a stale process from before yaml edits propagated). The env-name mismatch is out of scope for this root-cause fix but will be flagged in the handoff.

fix: |
  Added `OpRefResolver` type + `defaultOpRefResolver` in src/config/loader.ts that shells out to `op read "<ref>"` via `execSync` (mirrors the existing botToken pattern in daemon.ts). New `resolveMcpEnvValue` helper runs `${VAR}` interpolation first, then — if the result starts with `op://` and a resolver is provided — invokes the resolver and substitutes the secret. `resolveAgentConfig` + `resolveAllAgents` accept an optional `opRefResolver` parameter; when omitted, op:// values pass through unchanged (preserves existing test behavior).

  Three real runtime call sites now pass `defaultOpRefResolver`:
    1. src/manager/daemon.ts (boot-time resolveAllAgents)
    2. src/config/watcher.ts (hot-reload path, via new ConfigWatcherOptions.opRefResolver wired from daemon.ts)
    3. src/cli/commands/run.ts (single-agent CLI path that also spawns MCPs)

  Resolver failures throw a wrapped error naming the offending `mcpServers.<name>.env.<var>` entry, so operators see the root cause at daemon startup instead of an opaque ENOTFOUND at first tool use.

verification: |
  - Full config/loader test suite (58 tests, incl. 5 new op:// resolver tests) — PASS
  - Config watcher tests (8 tests) — PASS
  - Shared-workspace integration tests (6 tests) — PASS
  - MCP-related session tests (session-config-mcp, mcp-session, warm-path-mcp-gate — 19 tests total) — PASS
  - Typecheck: only pre-existing, unrelated errors remain; zero new errors in touched files (verified by diffing against baseline via git stash)

  New regression tests cover:
    - op:// passthrough when no resolver is provided (backward compat)
    - resolver is invoked for op:// values and substitutes them
    - ${VAR} interpolation runs BEFORE op:// resolution (indirect refs)
    - resolver failure is wrapped with server + var context
    - resolver is NOT invoked for plain / empty / non-op:// values (performance)

files_changed:
  - src/config/loader.ts
  - src/config/watcher.ts
  - src/manager/daemon.ts
  - src/cli/commands/run.ts
  - src/config/__tests__/loader.test.ts

## Verified resolved (2026-05-07)

Triaged during /gsd-progress --forensic. Fix code confirmed present on master:
- `OpRefResolver` / `defaultOpRefResolver` present in src/config/loader.ts and src/config/watcher.ts
- Superseded by Phase 108 (shared 1password-mcp via daemon-managed broker, SHIPPED 2026-05-01) which introduces the broker shim pattern as the production path. The op:// resolver remains as the fallback for direct env-var refs.
