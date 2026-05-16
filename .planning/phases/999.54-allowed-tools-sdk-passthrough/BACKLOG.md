# Backlog: allowedTools / preloadedTools yaml passthrough to Claude Agent SDK

## 999.54 — Per-agent preloaded-tool whitelist in clawcode.yaml, threaded to the SDK alongside disallowedTools

Every ClawCode agent today runs with the SDK's default tool-deferral behavior: any tool not in the SDK's built-in preload set must be fetched via a `ToolSearch` round-trip before it can be called. That round-trip costs one full model turn per first-use-per-session — measurable latency on hot-path workflows where the same tool fires repeatedly.

clawcode.yaml has no per-agent knob to bias this. The only tool-granularity lever currently threaded through to the SDK is `disallowedTools` (see `/opt/clawcode/dist/cli/index.js:4630` and `:4719`, spread-conditional, omitted when empty). There's no sibling `allowedTools` / `preloadedTools`.

### Symptoms / Why

- **2026-05-14, this session:** Admin Clawdy paid the ToolSearch round-trip 3+ times in a single conversation just to call `spawn_subagent_thread` and `post_to_agent` — both repeat-use cross-agent comms tools for an admin-role agent.
- **fin-acquisition (per heartbeat behavior):** spawns subagents continuously at >50% context. Every spawn pays the round-trip if the session is fresh.
- **projects:** delegates to research repeatedly via `delegate_task` / `ask_agent` — same pattern.
- **Tool preload audit (2026-05-14, Admin Clawdy session):** identified clear hot-path tool sets per agent (spawn_subagent_thread, post_to_agent, password_read, mysql_query, log_client_interaction, generate_image, drive_upload_file, etc.) — all currently deferred. Audit recommendations are advisory until this knob exists.

### Acceptance criteria

- New optional yaml field `allowedTools` (or `preloadedTools` — pick one and document) accepted in `agents.<name>.*` stanzas. Array of tool names: `mcp__server__tool` form for MCP tools, base name (`Bash`, `Read`) for built-ins.
- Field validates at config load (rejects unknown server prefixes; warns on unknown tool names rather than crashing).
- Value flows from yaml → `AgentSessionConfig` → Claude Agent SDK init, mirroring the existing `disallowedTools` spread-conditional pattern at `dist/cli/index.js:4630`, `:4719`, `:13873`, `:14326`.
- Tools listed appear in the agent's main tool surface from session start, not in the deferred catalog.
- Backwards compatible: missing field = current behavior (SDK-default deferral).
- ConfigWatcher hot-reload picks up changes without daemon restart (consistent with how `mcpServers` reloads).
- Optional: fleet-level default block (`fleet.allowedTools`) merged with per-agent overrides.

### Implementation notes / Suggested investigation

- Code touchpoints in `/opt/clawcode/dist/cli/index.js` (also their source-side equivalents under `/opt/clawcode/src/`):
  - **4620–4630:** `disallowedTools` spread-conditional — clone the pattern, add `allowedTools` sibling.
  - **4719:** second passthrough site — same treatment.
  - **13860–13879:** SDK option assembly — wire the new field through.
  - **14326:** third passthrough — likely the subagent-spawn path. Worth checking whether subagents inherit parent's preload or get their own.
- Yaml schema:
  - Find where `mcpEnvOverrides` is declared (lines 1044–1053 per recent op-resolver investigation) — add `allowedTools` as a sibling under the same agent-config shape.
- Default behavior question: when an agent declares `allowedTools: [...]`, should that be **additive** to SDK's built-in preload set, or **replace** it? Recommend additive — replacing is a footgun.
- `ConfigWatcher` diff path: lines 59428–59470 (from recent op-resolver investigation). Confirm `allowedTools` is included in the diff fields it watches.
- Once landed, re-run the tool preload audit (2026-05-14) with traces.db sampling to evidence-rank candidates; first-pass recommended preload sets are documented there.

### Related

- **Tool preload audit, 2026-05-14** — full per-agent recommendations + hot-path tool lists. Lives in Admin Clawdy session transcript (not persisted to file yet).
- **999.49 benchmarks-tab-tool-rollup-empty-rows** — if that rollup gets fixed, it'll give per-agent tool-invocation frequency data to inform preload defaults.
- **999.53 mcp-broker-hot-reload-token-rotation** — adjacent (also concerns hot-reload-friendly agent config).
- `/opt/clawcode/dist/cli/index.js:4630` — the disallowedTools passthrough this should mirror.

### Reporter

Admin Clawdy on behalf of Jas, 2026-05-14 12:55 PT
