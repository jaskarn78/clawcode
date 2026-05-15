# Backlog: Manifest-driven Plugin SDK with Capability Contracts

## 999.58 — Promote MCP servers and skills to a discoverable, type-checked plugin surface (modeled on OpenClaw's `plugin-sdk`)

ClawCode today exposes its tool surface implicitly: agents pick up MCP servers and skills via `clawcode.yaml` config drift and per-agent `mcpEnable` lists. There's no contract describing what a tool/skill *is*, what capabilities it asserts, what runtime injection it expects, or how it should be discovered. OpenClaw solved this with `openclaw/plugin-sdk/*` — manifest metadata, injected runtime helpers, documented `api.ts` / `runtime-api.ts` barrels, and a typed capability vocabulary that the gateway uses to validate plugins at load time.

Lifting that pattern would let us:
- Replace freeform skill discovery with a manifest the daemon can validate before loading
- Enforce capability declarations (does this skill need network? filesystem? specific MCP servers?) and reject mismatches at startup, not at runtime
- Generate per-agent tool inventories from contract metadata instead of grepping configs
- Open a path to a public ClawHub-style registry where third-party plugins declare contracts and the daemon refuses to load anything that violates them

### Why / Symptoms
- New agent provisioning today requires manual `clawcode.yaml` editing + cross-reference against `~/clawd/docs/` to know which MCPs and skills are even available
- No way to assert "this agent should NOT have `image_edit`" at the *type* layer — only by omitting from the enable list, which silently passes if the source is misnamed
- Operator-observed (2026-05-14, capability comparison vs OpenClaw): "ClawCode's plugin discipline is implicit, not contractual"

### Acceptance criteria
- Every skill in `~/.clawcode/agents/*/skills*/` carries a `SKILL.md` manifest with: name, description, capabilities array, required-tools array, required-mcp array, owner agent (or `*` for fleet-wide)
- Daemon refuses to load a skill whose manifest declares an MCP server not enabled for the calling agent — surfaces a clear error, not a silent skip
- `clawcode doctor` (see [[999.NN-doctor-command]] if filed) reports any agent whose skill set declares capabilities the agent doesn't have
- MCP servers gain a parallel `mcp-manifest.json` with the same capability vocabulary
- `plugin-sdk` package exposes `defineSkill` / `defineMCPTool` helpers that produce manifest-conformant exports — same DX as OpenClaw's
- Docs page enumerating the capability vocabulary (filesystem, network, llm-call, discord-post, cross-agent-delegate, …) with examples per capability

### Implementation notes / Suggested investigation
- Read OpenClaw source at `openclaw/plugin-sdk/src/` (manifest schema), `openclaw/gateway/src/plugins/loader.ts` (load-time validation), and the public capability vocab in `docs.openclaw.ai`
- Start with skills (lower blast radius than MCP) — back-fill manifests for existing `Admin Clawdy/skills/`, validate the schema with one agent before fleet rollout
- Co-design with [[999.NN-doctor-command]]: the `doctor` checker should consume the same manifest format
- Open question: how to handle skills that legitimately *escalate* capability mid-run (e.g., a skill that calls `delegate_task`) — manifest declares the upper-bound, runtime enforces

### Related
- Comparison report: `Admin Clawdy/research/agent-runtime-comparison-2026-05-14.md` (§"Steal from OpenClaw" #2)
- [[999.50-tmux-remote-control-skill]] — example of an ad-hoc skill that would benefit from a typed manifest
- OpenClaw source: `openclaw/plugin-sdk/*` (MIT-licensed reference)

**Reporter:** Jas, 2026-05-14 19:52 PT
