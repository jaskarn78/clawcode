# Phase 85: MCP Tool Awareness & Reliability - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss)

<domain>
## Phase Boundary

Eliminate the phantom-error class where agents claim "1Password isn't logged in" / "MCP not configured" / "key expired" while every MCP server is actually healthy. Agents only report an MCP error when the server returned one.

**Requirements:** TOOL-01..07.

**User-reported symptom:** "They have often said 1Password isn't logged in, or the mcp isn't configured and needs to be started, or the search isn't working, or the key is expired when everything is valid and should be fully functional. No keys are expired and 1pw mcp should always be accessible, as well as any other tools at startup for all agents."

**Root cause (from research):** Weak MCP health-state visibility in system prompt + no proactive readiness gate. Agents parrot generic failure language instead of attempting the tool or reporting the actual error.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices at Claude's discretion. Use REQUIREMENTS.md TOOL-01..07, ARCHITECTURE.md (uses v1.3 MCP health-check + v1.7 two-block prompt), PITFALLS.md.

### Known constraints
- Zero new npm deps; reuse v1.3 MCP infra + v1.7 prompt assembly
- Independent of Phases 83/84/86/87 — no cross-feature dependency
- MCP tools list + descriptions in v1.7 **stable cached prefix** (eviction-proof through compaction)
- Startup readiness gate: daemon performs JSON-RPC `initialize` handshake; refuses `ready` until all mandatory servers respond (extend v1.6 warm-path)
- Auto-reconnect via v1.3 heartbeat
- System prompt includes "MCP tools pre-authenticated" statement + live tool-status table
- `/clawcode-tools` new Discord slash → live status/last-success/failure-count
- Agents must receive ACTUAL JSON-RPC errors (not generic "tool unavailable"), with explicit instruction to report error verbatim
- Regression test pins the prompt-builder rule ("report verbatim error, don't assume misconfigured")

</decisions>

<code_context>
## Existing Code Insights

From milestone research:
- `src/mcp/server.ts` (~1200 LOC) — MCP server orchestration (v1.3)
- `src/heartbeat/runner.ts` — v1.3 heartbeat (extend for reconnect)
- v1.7 two-block prompt assembly — stable prefix (cached) + mutable suffix
- `src/bootstrap/prompt-builder.ts` — system prompt assembly
- v1.6 warm-path readiness gate — extend for MCP readiness

</code_context>

<specifics>
## Specific Ideas

None beyond REQUIREMENTS.md.

</specifics>

<deferred>
## Deferred Ideas

- MCP tool call latency/success-rate per-tool telemetry (TOOL-F1) — deferred

</deferred>
