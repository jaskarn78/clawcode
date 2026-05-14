# Backlog: mcp-broker hot-reload for OP_SERVICE_ACCOUNT_TOKEN rotation

## 999.53 — mcp-broker should hot-reload `OP_SERVICE_ACCOUNT_TOKEN` overrides without requiring a full daemon restart

Today, rotating a 1Password service-account token requires editing `clawcode.yaml` AND restarting the daemon. The ConfigWatcher hot-reload path picks up the new value into the config layer and the SecretsResolver cache resolves the new `op://` URI, but the mcp-broker's sticky per-agent token pin won't pick up the change — by explicit design (Phase 108 "Out of scope"). Restart is the only way to actually apply the rotation to running 1Password MCP children.

This was Yagni in Phase 108. The 2026-05-14 Finmentum-Service token rotation surfaced the operator cost: a full daemon restart kicks all 14 agents' sessions, not just the 5 with the changed token — and per `feedback_ramy_active_no_deploy`, that disrupts whichever agent has a live operator/client thread at the moment. The rotation-without-restart use case has now appeared at least once; Yagni's expired.

### Where the limitation lives

- **Sticky token-pin warning:** `src/manager/daemon.ts:7720-7744` — walks the diff for any `agents.*.mcpEnvOverrides.1password.OP_SERVICE_ACCOUNT_TOKEN` change, emits an operator-visible `mcp-broker: hot-reload of OP_SERVICE_ACCOUNT_TOKEN is NOT supported` error per affected agent, and the broker keeps its old pin.
- **Phase 108 CONTEXT scope note:** `.planning/phases/108-shared-1password-mcp-pooling/108-CONTEXT.md` §"Out of scope":
  > **Hot-reload of token mappings.** If `OP_SERVICE_ACCOUNT_TOKEN` env mapping changes, daemon restart required. Yagni for now.
- **Phase 108 Pitfall 2 reference** (cited in the daemon comment at line 7720): "The broker pins each agent → tokenHash on first connect; a yaml edit that changes a token literal mid-flight is caught at the broker's sticky-pin check and rejected per-connection."

### Operator cost (the case for unscoping)

Concrete incident: 2026-05-14 ~12:14 PT Finmentum-Service token rotation.

- 5 agent configs had literal token values. Edited all 5 to `op://clawdbot/Finmentum-Service-Token-1PW/credential` URIs.
- ConfigWatcher detected, audit-trailed, and resolved the new URI into the SecretsResolver cache. `secrets-resolver: resolved + cached` log line confirms.
- mcp-broker emitted 5 `hot-reload NOT supported` errors, kept the old token-pins.
- Net state: 5 agents' 1Password MCP children still using the OLD token in-memory; new URI sitting in cache awaiting next broker startup.
- Operator now has to schedule a daemon restart inside the OLD token's remaining-hours validity window. Restart kicks all 14 agents (including the 9 not affected by the rotation). If Ramy's `#fin-acquisition` thread is active, the restart disrupts a live client conversation; if it isn't, the operator still has to babysit the restart and verify post-boot.
- If Yagni had held longer, the next rotation operator would face the same constraint.

The same incident shape recurs for any 1Password service-account credential rotation — the secret-management best practice (rotate frequently, on schedule, after staff changes) collides with the daemon-restart cost.

### Desired behavior

When `agents.*.mcpEnvOverrides.1password.OP_SERVICE_ACCOUNT_TOKEN` changes via ConfigWatcher hot-reload:

1. **Resolve the new value** via SecretsResolver (already happens).
2. **Update the broker's per-agent token pin** in place — replace the cached `tokenHash` for the affected agent name(s).
3. **Re-issue the broker's existing pooled 1Password MCP child connection** if one exists, OR mark the slot stale so the next tool call provisions a fresh child with the new token.
4. **Emit an `info` log line** confirming the rotation took effect (`mcp-broker: rotated OP_SERVICE_ACCOUNT_TOKEN for agent <name>` — replaces today's `error` warning).
5. **Bounded re-issue cost:** if step 3 evicts an in-flight tool call, that call retries once with the new pin (existing pRetry pattern in SecretsResolver, mirror it here).

### Non-goals

- **Don't generalize to all MCPs.** Phase 108 explicitly scoped to 1password-mcp; this item stays inside that scope.
- **Don't add a separate "rotate token" CLI command.** The IPC surface is fine — `ConfigWatcher` is the source of truth; operators edit yaml and the broker picks up.
- **Don't try to support changes to `mcpServers[*].env.OP_SERVICE_ACCOUNT_TOKEN`** (the global daemon-side env — line 163 in production yaml, `${OP_SERVICE_ACCOUNT_TOKEN}` shell-var pattern). That's the daemon's own `op read` auth (ClawdBot token) and is sourced from systemd EnvironmentFile, not the ConfigWatcher path. Separate concern.

### Acceptance criteria

- Edit one agent's `mcpEnvOverrides.1password.OP_SERVICE_ACCOUNT_TOKEN` value (literal or `op://`) in `clawcode.yaml`.
- ConfigWatcher fires.
- Within one cron-tick equivalent (~1s), the affected agent's 1Password MCP child is either re-issued with the new token, or marked-stale so the next tool call gets the new token.
- The other 13+ agents see zero disruption — no broker reconnect, no session interruption, no tool-call interrupt.
- An operator-runnable verification: trigger any 1Password tool call from the affected agent post-rotation and confirm the call uses the new token (e.g., a `get_secret` call that succeeds with new-token-permissioned scope but would fail under old-token permissions).
- Boot-time + hot-reload-time paths share one code path for token-pin establishment (currently the boot path pins inside the broker constructor; hot-reload would need to invoke the same primitive).

### Implementation sketch

- New broker method `rotateAgentToken(agent: string, newTokenValue: string): Promise<void>` next to the existing pin-on-connect logic.
- ConfigReloader (`src/manager/config-reloader.ts`) inspects diff entries matching `agents.*.mcpEnvOverrides.1password.OP_SERVICE_ACCOUNT_TOKEN`, resolves the new value through SecretsResolver, then invokes `broker.rotateAgentToken(agent, value)`.
- The `mcp-broker: hot-reload NOT supported` error at `daemon.ts:7741` becomes an `info` log on the success path; the diff-walker (`daemon.ts:7720-7744`) shifts from "warn the operator" to "invoke the rotation primitive."
- Broker's internal connection pool: if a child is in the idle pool, drop it (next call provisions fresh). If a child is mid-call, let the current call complete on the old token, then drop the pin after that call settles (avoids interrupting in-flight tool use).

### Sequencing

- Single-plan phase (~3-4 tasks: rotate-primitive, ConfigReloader wiring, hot-reload-warn → hot-reload-success log shift, vitest coverage on the pool eviction path).
- No dependencies; can land standalone.
- Wave 1 of whichever vNext milestone takes it.

### Related

- **Phase 108** (shared 1password mcp pooling) — original architecture; "out of scope" decision lives there. This item unscopes that decision based on the operator-cost evidence above.
- **`feedback_ramy_active_no_deploy`** — the user-memory pattern that makes daemon restarts expensive. Hot-reload-token-rotation directly mitigates this cost class for credential rotations.
- **`feedback_silent_path_bifurcation`** — production verification pattern. The acceptance-criteria test (post-rotation tool call) is the exact "verify production actually executes the new path" check that memory warns about.
- **Phase 119 Plan 04** (HEARTBEAT_OK suppression) — set the recent precedent for documenting agent-side prompt-corpus contract changes with cross-workspace traceability; same artifact pattern (BACKLOG.md before phase, then PLAN+SUMMARY+VERIFICATION when scheduled).

### Reporter

Jas, 2026-05-14 (surfaced after the Finmentum-Service token rotation forced a daemon restart even though only 5 of 14 agents were affected).
