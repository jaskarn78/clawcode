# Requirements: ClawCode v1.3

**Defined:** 2026-04-09
**Core Value:** Persistent, intelligent AI agents that each maintain their own identity, memory, and workspace -- communicating naturally through Discord channels without manual orchestration overhead.

## v1.3 Requirements

Requirements for v1.3 milestone. Each maps to roadmap phases.

### Subagent Thread Skill

- [ ] **SASK-01**: A ClawCode skill exists that wraps the spawn-subagent-thread IPC call into a natural agent-usable interface
- [ ] **SASK-02**: The skill accepts task description and optional model selection, returns the thread URL and subagent session name
- [ ] **SASK-03**: Agent system prompts include guidance to use the subagent thread skill instead of the raw Agent tool when Discord visibility is desired
- [ ] **SASK-04**: The skill handles errors gracefully (no Discord client, no bound channel) with clear messages

### MCP Client Consumption

- [ ] **MCPC-01**: clawcode.yaml supports per-agent MCP server definitions (name, command, args, env)
- [ ] **MCPC-02**: Daemon passes MCP server configs to agent sessions so Claude Code's native MCP support activates them
- [ ] **MCPC-03**: Agent system prompts list available MCP tools with descriptions for discoverability
- [ ] **MCPC-04**: MCP server health is checkable -- daemon can verify servers start and respond
- [ ] **MCPC-05**: CLI command `clawcode mcp-servers` lists configured MCP servers per agent with status
- [ ] **MCPC-06**: MCP server configs support shared definitions (define once, assign to multiple agents)

## Future Requirements

### Multi-Provider LLM
- **MLLM-01**: Support multiple LLM providers beyond Claude
- **MLLM-02**: Per-agent model provider configuration with fallback chains

### Browser Automation
- **BROW-01**: Chrome CDP integration for web scraping

## Out of Scope

| Feature | Reason |
|---------|--------|
| Building custom MCP servers | Users bring their own MCP servers; ClawCode just connects to them |
| MCP server marketplace/registry | Over-engineered for v1.3; config-based is sufficient |
| Multi-provider LLM | Claude Code only supports Claude family |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SASK-01 | Phase 31 | Pending |
| SASK-02 | Phase 31 | Pending |
| SASK-03 | Phase 31 | Pending |
| SASK-04 | Phase 31 | Pending |
| MCPC-01 | Phase 32 | Pending |
| MCPC-02 | Phase 32 | Pending |
| MCPC-03 | Phase 32 | Pending |
| MCPC-04 | Phase 32 | Pending |
| MCPC-05 | Phase 32 | Pending |
| MCPC-06 | Phase 32 | Pending |

**Coverage:**
- v1.3 requirements: 10 total
- Mapped to phases: 10
- Unmapped: 0

---
*Requirements defined: 2026-04-09*
*Last updated: 2026-04-09 after roadmap creation*
