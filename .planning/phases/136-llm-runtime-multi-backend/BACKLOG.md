# Backlog: LLM runtime multi-backend + Claude Code interactive fallback

## 999.62 — Decouple ClawCode from the Anthropic Agent SDK subscription pool

**Trigger:** Anthropic's 2026-05-14 official announcement (r/ClaudeAI, u/ClaudeOfficial — "A new monthly Agent SDK credit for Claude plans"). Starting **2026-06-15**, programmatic usage (Claude Agent SDK, `claude -p`, Claude Code GitHub Actions, third-party apps built on the Agent SDK) is permanently split off from the interactive subscription rate-limit pool and capped at a flat monthly credit:

| Plan | Monthly Agent SDK credit |
|---|---|
| Pro | $20 |
| Max 5x | $100 |
| **Max 20x** | **$200** |
| Team Premium | $100 |
| Enterprise Premium | $200 |

After the credit depletes, Agent SDK requests either bill at standard API rates (if the operator enables extra-usage) or **pause until the credit refreshes**. Source: <https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan>.

### ClawCode's exposure

Confirmed live on clawdy via `ps aux` 2026-05-15:

```
/opt/clawcode/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude --output-format stream-json ...
```

Every spawned agent process runs the **Claude Agent SDK** binary. ClawCode is squarely inside the policy scope — from June 15, none of its daemon traffic will draw from the interactive Mac subscription pool, regardless of which account is authenticated.

**Operational impact at current footprint:**

- 7 agents running 24/7 (Admin Clawdy, fin-acquisition, finmentum-content-creator, fin-research, general, projects, research) per 2026-05-15 `clawcode status`
- Heartbeats at 50 min cadence, dream passes, advisor consults (Phase 117), cron-driven tasks (daily-standup, birthday/holiday workflows, schwab sync, etc.)
- fin-acquisition session is live with Ramy during business hours
- Realistic burn rate at Anthropic API rates: **$200 Max 20x credit will deplete in days, not weeks**

Without a workaround, ClawCode becomes unaffordable to run on a subscription basis on 2026-06-15. The user explicitly wants to avoid being forced onto pay-as-you-go API-rate billing.

### Two research paths (operator-directed, 2026-05-15)

The operator asked for research on **two specific workaround angles**:

1. **Leverage the interactive Claude Code pool by driving the real Claude Code CLI binary** (not the Agent SDK npm package) on a host that owns a Max subscription. Subscription rate limits remain on the interactive side.
2. **Multi-provider abstraction** — make ClawCode work with OpenAI Codex, OpenRouter, Gemini, DeepSeek, or other model providers so ClawCode is no longer single-vendor.

### Research synthesis (2026-05-15)

**Path A — Driving real Claude Code CLI interactively (NOT the Agent SDK)**

- **Distinction from the ban:** Anthropic's 2026-01-09 enforcement and ongoing policy explicitly target **header-spoofing** by third-party harnesses (OpenClaw, OpenCode, etc.) — tools that fake the Claude Code client identity. Driving the **real** `claude` binary on infrastructure the account-owner controls is a different surface: the binary makes its own requests, with its own auth, its own headers. There is nothing for Anthropic's detection to flag as spoofing because nothing is being spoofed. (Sources: <https://paddo.dev/blog/anthropic-walled-garden-crackdown/>, <https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access/>)
- **Known pattern in the wild:** tmux + Claude Code is publicly documented and used (Hwee-Boon Yar blog <https://hboon.com/using-tmux-with-claude-code/>, mcpmarket tmux Claude Code skill, Hermes Agent's claude-code skill, Eric Buess's Anthropic-supported demo). ClawCode already has a backlogged "tmux remote control skill" as 999.50 — there is local prior art.
- **`claude -p` is OUT.** Per the 2026-05-14 Anthropic post, `claude -p` (non-interactive print mode) is explicitly inside the Agent SDK credit bucket. The faster headless mode is unavailable on the subscription pool. **Must use interactive TUI.** This is the hard constraint that shapes the latency floor.
- **Latency analysis (revised 2026-05-15):** Naive tmux + capture-pane is 2–5× slower than the Agent SDK's stream-json. After optimization (see Wave 4.5 below) the realistic floor is **1.2–1.6× slower**. The fundamental gap is Claude Code's TUI rendering for humans vs. Agent SDK's stream-json rendering for programs.

| Path | Per-turn latency vs current Agent SDK |
|---|---|
| Current Agent SDK (stream-json) | 1.0× baseline |
| Naive tmux + capture-pane | 2.0×–5.0× |
| **Optimized direct-PTY + persistent REPL + structural detection** | **1.2×–1.6×** |
| Hard floor (Claude Code's own UI render cycle) | ~1.15× |

- **Optimization levers** (detailed in Wave 4.5):
  - Drop tmux entirely; use direct PTY via `node-pty` (~150–400ms/turn savings)
  - Persistent REPL session per agent — one long-lived `claude` subprocess, reused across turns (~500–2000ms savings, binary boot is the biggest single cost)
  - Structural-cue end-of-turn detection vs stability polling (~200–800ms savings)
  - Disable TUI chrome (`--no-color` etc.) where supported (~50–100ms savings)
  - Incremental byte streaming vs full pane re-scrape (~50–150ms savings)
- **Critical unknown — concurrent-session cap per account.** Anthropic almost certainly enforces per-account concurrent-Claude-Code-session limits. With 7 ClawCode agents = 7 concurrent interactive sessions on a single Max 20x. The cap is not publicly documented. Could be silent rate-limiting at high concurrency, could be visible "too many concurrent sessions" errors. **This is the load-bearing unknown — needs an empirical probe before this path is viable as the primary backend.** Probe scope: spawn N concurrent `claude` sessions against one Max 20x account, document at which N degradation appears and what failure mode (errors / silent slowdown / throttling). See Wave 4.5.
- **Residual risk:** "ordinary individual use" language in Anthropic's TOS leaves a door open for future enforcement on volume / concurrent-session detection. Account-owner-driven automation of the real binary is **not** explicitly banned today, but is one policy tightening away from being so. Treat as a defensible fallback, not a foundation.

**Path B — Multi-provider abstraction**

- **Mature ecosystem already exists.** `claude-code-router` (<https://github.com/musistudio/claude-code-router>), `claude-code-proxy` + LiteLLM, OpenRouter's first-party Claude-Code adapter (<https://openrouter.ai/docs/guides/coding-agents/claude-code-integration>). The pattern of routing Anthropic-format requests to OpenAI/Gemini/DeepSeek/Codex backends is no longer novel.
- **Closest peer to ClawCode's agent shape:** **OpenAI Codex CLI** (Apache 2.0, 67k+ GitHub stars, designed for the same local-CLI-loop-plus-cloud-async pattern as Claude Code). Codex CLI is roughly half the cost of Claude Sonnet at comparable quality on SWE-bench Pro and leads on Terminal-Bench 2.0. (Sources: <https://northflank.com/blog/claude-code-vs-openai-codex>, <https://codersera.com/blog/claude-code-vs-openai-codex-2026/>)
- **Tool-use parity is the main quality risk.** OpenRouter and LiteLLM both support core Anthropic Messages API translation, but `cache_control` write tokens, fine-grained tool streaming, and non-Anthropic tool-calling reliability are the documented rough edges. Local models via Ollama have the weakest tool-call reliability. (Source: <https://medium.com/@fengliplatform/claude-code-using-litellm-to-access-openrouter-models-bd5ee95a1e55>)
- **Phase 117 advisor pattern is the proven template in this codebase.** The `AdvisorService` seam at `src/advisor/` with `native`, `fork`, and (scaffold) `portable-fork` backends, plus the per-agent config-flippable rollback path (`agent.advisor.backend: native|fork`), is the exact architectural pattern that should be replicated for the primary agent runtime. We have validated this seam in production.

**Path C (rejected) — Browser automation against claude.ai**

- Latency catastrophically worse than tmux (DOM round-trip per turn)
- Cloudflare + Anthropic bot-detection at the web edge
- Same TOS-gray surface as tmux but with worse engineering ROI and worse fragility
- **Not pursued.** Cross off the list.

**Path D (rejected) — Header spoofing**

- Anthropic publicly stated they detect and ban tools that "spoof the Claude Code harness"
- Account-ban risk on the operator's primary Max subscription
- **Not pursued. Do not propose this approach again.**

### Recommended architecture

**Replicate the Phase 117 advisor-backend pattern for the primary runtime.**

```
src/llm-runtime/
  llm-runtime-service.ts          // seam + interface
  backends/
    anthropic-agent-sdk.ts        // current default (Agent SDK credit)
    anthropic-api-key.ts          // pay-as-you-go API rates
    openai-codex.ts               // Codex CLI / OpenAI API
    openrouter.ts                 // unified OpenRouter passthrough
    claude-code-tmux.ts           // drive real Claude Code CLI via tmux
```

**Config knobs** (mirror Phase 117 cascade pattern — per-field per-agent override over `defaults.llmRuntime`):

```yaml
defaults:
  llmRuntime:
    backend: anthropic-agent-sdk   # current default
    failover:                       # auto-switch when budget hits threshold
      enabled: true
      thresholdPct: 95              # of monthly credit
      fallbackBackend: anthropic-api-key
agents:
  - name: fin-acquisition
    llmRuntime:
      backend: claude-code-tmux     # this agent stays on interactive pool
      tmuxHost: clawdy              # or mac-mini for true Mac subscription pool
  - name: research
    llmRuntime:
      backend: openai-codex         # cheap research workload off the Anthropic credit entirely
```

**Tool-use schema translator** at the seam — Anthropic Messages API ↔ OpenAI function-calling ↔ Gemini function-calling. Reuse claude-code-proxy's translation rules where possible.

**Cost + credit telemetry** — daemon polls Anthropic billing API (or local approximation from token counts × current rates) and surfaces `credit_remaining_pct` + `projected_runout_date` in `clawcode status` and the dashboard. Discord alert at 75% / 90% / 99%.

**Pre-flight readiness checks** — `clawcode preflight` (Phase 109) gains a "Agent SDK credit status" check that gates daemon boot if credit is depleted and no failover backend is configured.

### Wave plan (proposed)

| Wave | Scope | Why this order |
|---|---|---|
| 1 | LlmRuntimeService seam + AnthropicAgentSdk backend extraction (no behavior change) | Mirrors Phase 117's "scaffold first, no behavior change" approach |
| 2 | AnthropicApiKey backend + per-agent backend selection in clawcode.yaml | Cheapest path to the safety valve — operator can flip an agent to direct API billing today |
| 3 | Credit telemetry + threshold alerts + failover | Operational visibility before deeper engineering |
| 4 | ClaudeCodeInteractive backend (drives real binary, persistent REPL, structural-cue parsing) | The "use the interactive pool" play — depends on the seam being clean AND Wave 4.5 probe passing |
| **4.5** | **Concurrent-session probe + tmux optimization spike** | **Load-bearing — gates whether Wave 4 is even viable.** See detail below. |
| 5 | OpenAiCodex backend + tool-use schema translator | The "decouple from Anthropic" play; tool-use parity is the long pole |
| 6 | OpenRouter passthrough backend | Convenience layer — single gateway to all other models |

Waves 1–3 are the **hard deadline** track (must land before 2026-06-15 for ClawCode to keep running affordably). Wave 4.5 is the **gate** that determines whether Wave 4 ships at all. Waves 4–6 are the **strategic** track (defensive against future Anthropic terms changes).

#### Wave 4.5 — Concurrent-session probe + tmux optimization spike (load-bearing)

**Why this exists as a standalone wave.** Wave 4 (ClaudeCodeInteractive backend) has two load-bearing unknowns that must resolve before architecture commits:

1. **What is Anthropic's concurrent-Claude-Code-session cap per account?** Undocumented. If the cap is below ClawCode's 7-agent footprint, Wave 4 can't carry production load regardless of how fast each session is.
2. **What is the realistic optimized-tmux latency floor in our environment?** The 1.2–1.6× estimate is based on the optimization stack (direct PTY, persistent REPL, structural detection) but needs empirical confirmation on the clawdy host with the real Claude Code binary.

**Probe scope:**

- Spawn N concurrent `claude` interactive sessions against one Max 20x account where N ∈ {1, 3, 5, 7, 10}. Each session sustains a tight loop of trivial prompts (~30s cadence) for 10 minutes. Document at which N degradation appears and what failure mode surfaces (HTTP errors, silent throttling, session-evict, account-flag).
- Compare per-turn latency on the same prompt set across three configurations: (a) current Agent SDK, (b) naive tmux + capture-pane, (c) optimized direct-PTY + persistent REPL + structural-cue parsing.
- Document tooling choice (`node-pty` vs `pexpect` vs raw `child_process` with pty) and structural cues used for end-of-turn detection (prompt prefix bytes, ANSI marker sequences, etc.).

**Probe deliverable:** A `.planning/phases/999.62-.../PROBE-RESULTS.md` documenting:
- Concurrent-session cap (the N where things break)
- Latency floor on optimized path (target 1.2–1.6×, fail-criterion >2.5×)
- Failure modes observed at the cap (which informs retry/backoff logic)
- Go/no-go recommendation for Wave 4

**If probe fails** (cap < 7 sessions OR latency > 2.5×): Wave 4 deprecated. ClaudeCodeInteractive backend not shipped. Operators rely on Anthropic API key + multi-provider as the only paths. Wave 5 (OpenAiCodex) becomes the primary strategic deliverable.

**If probe passes:** Wave 4 ships with the optimized stack, and operators get a real subscription-pool backend for the agents that fit under the cap.

### Non-goals

- **No header spoofing.** Not now, not ever. Path D is permanently off the table.
- **No browser automation against claude.ai.** Path C is permanently off the table.
- **Not a Claude Code rewrite.** ClawCode keeps its daemon architecture, Discord routing, per-agent SQLite memory, Phase 117 advisor pattern, etc. This phase is a runtime backend swap, not a re-platforming.
- **Not multi-account credit stacking.** TOS-gray, ban risk on the operator's primary subscription.

### Acceptance criteria

- LlmRuntimeService seam compiles + passes the existing test suite with `anthropic-agent-sdk` as the default backend (zero behavior change for current deploy).
- Per-agent `llmRuntime.backend` override in `clawcode.yaml` hot-reloads via the existing ConfigWatcher path.
- A single agent (e.g., `research`) can be flipped from `anthropic-agent-sdk` to `anthropic-api-key` via config-edit-and-reload, verified by inspecting outbound auth on the next turn.
- `clawcode status` shows `agent-sdk-credit: $123.45 / $200.00 (61.7%, projected runout 2026-06-22)` for the daemon's authenticated account.
- Failover triggers when credit hits 95% — verified by integration test that simulates depletion.
- `clawcode preflight` blocks boot if credit is depleted and no failover backend is configured for any `autoStart: true` agent.

### Cross-references

- Phase 117 — Claude Code advisor pattern multi-backend scaffold (architectural template)
- Phase 100 — vault-scoped 1Password / per-agent mcpEnvOverrides (auth abstraction precedent)
- Phase 109 — preflight gating + broker observability
- 999.50 — tmux remote control skill (related prior art for tmux-driven workflows)
- 999.53 — mcp-broker hot-reload for token rotation (same operator pain class: rotation without daemon bounce)
- 999.54 — allowed-tools-sdk-passthrough (currently executing; partial relevance to runtime seam)

### Source citations

- Anthropic official post (2026-05-14, r/ClaudeAI u/ClaudeOfficial): "A new monthly Agent SDK credit for Claude plans" — operator screenshot 2026-05-15
- Claude Help Center: <https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan>
- The Register, 2026-02-20: <https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access/>
- VentureBeat: "Anthropic reinstates OpenClaw and third-party agent usage on Claude subscriptions — with a catch"
- DevToolPicks: "Anthropic Splits Claude Subscriptions" 2026-06-15 details
- paddo.dev: "Anthropic's Walled Garden: The Claude Code Crackdown"
- Northflank: "Claude Code vs OpenAI Codex" 2026 benchmarks
- Codersera: "Claude Code vs OpenAI Codex (May 2026): The Honest Engineering-Team Comparison"
- OpenRouter Claude Code integration: <https://openrouter.ai/docs/guides/coding-agents/claude-code-integration>
- claude-code-router GitHub: <https://github.com/musistudio/claude-code-router>
- Hwee-Boon Yar: <https://hboon.com/using-tmux-with-claude-code/>
