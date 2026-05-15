# Backlog: Expose ClawCode as an MCP Server

## 999.60 — Let external Claude Code / Cursor / other MCP-aware clients invoke `delegate_task` and `ask_agent` over MCP (modeled on Hermes Agent's MCP-server mode)

Hermes Agent can run as an MCP server: external agents/clients connect, see Hermes' toolbox (including its own delegation primitives), and route work through Hermes without using Hermes' native channels. Hermes becomes a tool *surface* others can consume, not just a standalone agent.

ClawCode today is consumable only via Discord (or the dashboard at :3100). That means external developer agents — a Claude Code session on Jas's laptop, a Cursor instance, an OpenClaw gateway, a future automation — cannot route a task to `fin-research` or `projects` without going through a Discord channel + waiting for the agent to react. Exposing `delegate_task` / `ask_agent` / `task_status` over MCP would close that gap.

Use cases:
- Local Claude Code session: "delegate this domain research to fin-research, return when done" — no Discord round-trip
- OpenClaw gateway: route a long-running task to ClawCode's typed delegation, get a result back via the gateway's normal channel
- CI/build pipelines: "ask the fleet for a code review of this PR before merge"
- Future Cursor/IDE integrations: tab-complete the fleet as part of the toolset

### Why / Symptoms
- Today, every cross-system task requires either a) a human bridging via Discord, or b) a custom HTTP shim per consumer
- ClawCode's typed `delegate_task(schema, payload)` contract is the single best inter-agent primitive in the fleet, but it's only reachable from inside the fleet
- Operator-observed (2026-05-14, capability comparison vs Hermes): "ClawCode could expose `delegate_task` / `ask_agent` over MCP so external Claude Code / Cursor sessions could route work into the fleet without going through Discord"

### Acceptance criteria
- ClawCode daemon optionally exposes an MCP server endpoint (configurable port, default off)
- Tools exposed: `delegate_task`, `ask_agent`, `task_status`, `task_complete` (and `list_agent_schemas` for discovery)
- Auth: the MCP server requires a token/header bound to a Discord user identity OR an `op://clawdbot/...` reference — no anonymous access
- Scoping: same `callerAllowed` enforcement as in-fleet delegation — an external caller's identity maps to a fleet-internal identity (e.g., `external:jas-laptop`) and is allowlisted per schema
- An external Claude Code session can configure ClawCode as an MCP server, see the agent list, and successfully invoke `delegate_task(schema='research.brief', payload={...})` returning the same shape as an in-fleet caller
- Documented in `~/clawd/docs/mcp-server-mode.md` with one working example (local Claude Code → ClawCode → fin-research → result)
- Rate limits + budget attribution: external callers share the same advisor / token budgets as their mapped internal identity (no free-tier bypass)

### Implementation notes / Suggested investigation
- Read Hermes Agent's MCP server mode: how does it handle multi-tenant auth? Does it support per-caller scoping or wide-open?
- ClawCode daemon already has `delegate_task` plumbing — MCP exposure is an *adapter*, not a re-implementation
- Reuse `list_agent_schemas` introspection for MCP `tools/list` response — this gives clients the same discovery story
- Open question: does the MCP `tools/call` shape map cleanly to `delegate_task(schema, payload)`? Probably yes (each schema = one tool) but verify
- Pair with [[999.58-manifest-driven-plugin-sdk]] — the same capability vocabulary should govern which schemas are exposed externally
- Auth via 1Password service-account tokens (already in use for the fleet) feels right; HTTP-Bearer with a token mapped to a fleet identity record

### Related
- Comparison report: `Admin Clawdy/research/agent-runtime-comparison-2026-05-14.md` (§"Steal from Hermes" #3)
- [[999.58-manifest-driven-plugin-sdk]] — provides the capability contract MCP exposure will enforce
- [[999.59-autonomous-skill-creation]] — would also benefit (external clients could propose skill drafts back to the fleet)
- Hermes Agent: `hermes-agent.nousresearch.com/docs` (MCP server mode section)
- ClawCode internal: `delegate_task` + `list_agent_schemas` MCP tools already document the contract shape

**Reporter:** Jas, 2026-05-14 19:52 PT
