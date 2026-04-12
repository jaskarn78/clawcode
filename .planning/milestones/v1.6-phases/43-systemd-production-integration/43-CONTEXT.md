# Phase 43: Systemd production integration - Context

**Gathered:** 2026-04-11
**Status:** Ready for planning
**Mode:** Infrastructure phase — discuss skipped

<domain>
## Phase Boundary

Fix the systemd unit file so the clawcode service starts reliably in production with correct ExecStart, PATH, and env var loading.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase. Fix systemd unit template in scripts/install.sh to use /usr/bin/node, correct sub-command, and include PATH.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- scripts/install.sh contains install_service() with heredoc for systemd unit
- src/cli/commands/start-all.ts provides the foreground entry point

### Established Patterns
- CLI entry: `node dist/cli/index.js start-all --foreground --config <path>`
- daemon.ts reads OP_SERVICE_ACCOUNT_TOKEN from /etc/clawcode/env
- EnvironmentFile=-/etc/clawcode/env for optional secret loading

### Integration Points
- systemd ExecStart → /usr/bin/node dist/cli/index.js start-all --foreground
- Environment PATH needed for op CLI resolution

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
