# Backlog: Discord voice channel support for ClawCode agents

## 999.56 — Native `/vc {join,leave,status}` slash commands + agent voice bridge, ported from upstream OpenClaw

Add native Discord voice channel support to ClawCode agents as a first-class feature. Reference implementation already exists in upstream `openclaw/openclaw` (`extensions/discord/src/voice/`, 24 files); spec sketch lives locally at `~/voice-channel-prompt.md` on the OC server. Goal: an agent can join a voice channel, listen, transcribe speech, generate a voice-optimized response, and speak it back — with the agent's full tool/MCP/skill catalog intact.

### Why / Symptoms

- Today: ClawCode agents are text-only. No voice surface despite Discord being the primary operator interface.
- Operator (Jas) noticed `/vc join|leave|status` showing in Discord's command picker but it routes to OpenClaw upstream, not us — the commands aren't wired in our daemon.
- Upstream OpenClaw treats voice as a peer to text channels (gateway-level): same allowlist/group-policy controls, same access-group system, dedicated subsystem. Their pattern is the reference.

### Architecture decision: STT-TTS pipeline as Phase 1 default (NOT OpenAI Realtime)

Comparison across the dimensions that matter for ClawCode's agent-with-tools pattern:

```
| Dimension          | Deepgram + ElevenLabs                                | OpenAI Realtime                                  |
|--------------------|------------------------------------------------------|--------------------------------------------------|
| Latency            | 1–3 sec end-to-end                                   | sub-300ms response start                         |
| Cost / min         | ~$0.005 STT + ~$0.30/1k chars TTS                    | ~$0.06 in + ~$0.24 out                           |
| Naturalness        | Robotic — no prosody intent, no interruption         | Native interruption, backchanneling, prosody     |
| Agent integration  | Full text in/out to actual agent (tools, MCPs, mem)  | Realtime model is front-end; only "substantive"  |
|                    |                                                      | requests delegated to text agent                 |
| Tool / MCP access  | Unrestricted                                         | Function-calling supported, limited surface     |
| Provider lock-in   | Swap STT or TTS independently                        | Locked to OpenAI                                 |
| Debuggability      | Easy — transcripts/audio at each hop                 | Harder — opaque streaming session                |
```

ClawCode agents need their full tool/MCP/skill catalog. The Realtime API's "handles small talk itself" pattern means losing agent identity and memory for casual turns — disqualifying for fleet use. STT-TTS preserves the agent contract (text in, text out) and is ~10–50× cheaper at sustained usage. Realtime can land as an *optional* mode in a later phase for specific agents that want low-latency conversation and don't need rich tools.

### Phases

**Phase 1 — STT-TTS pipeline (MVP, the minimum that's actually useful)**
- `/vc join|leave|status` slash commands registered in `src/discord/slash-commands.ts`
- Voice subsystem skeleton: `src/discord/voice/{command,manager,audio,capture-state,session,config,access}.ts`
- Audio: `@discordjs/voice` capture → `prism-media` Opus→PCM (linear16, 48kHz stereo)
- STT: Deepgram `nova-3` REST API
- Agent ingress: route transcript as a normal text turn through existing agent pipeline (so all tools/MCPs/skills work transparently)
- TTS: ElevenLabs, per-agent voice ID
- Per-agent yaml schema:
  ```yaml
  voice:
    channelId: "..."           # optional auto-join
    deepgramKey: "op://vault/item/field"
    elevenLabsKey: "op://vault/item/field"
    voiceId: "..."
  ```
- Speaker dedup state (avoid double-streaming per utterance)
- 30s fallback to Haiku direct API call if agent doesn't respond
- Access control: mirror existing text-channel allowlist + group policy

**Phase 2 — Realtime mode (optional, per-agent opt-in)**
- Add `voice.mode: stt-tts | realtime` switch
- OpenAI Realtime API integration (`gpt-realtime-2` / `gpt-5.5`, voice e.g. `cedar`)
- Hybrid pattern: realtime model as front-end, delegates `substantive` requests to the configured text agent (mirrors upstream)

**Phase 3 — Voice message attachments (waveform format)**
- Handle Discord's *other* voice surface: voice-message attachments (waveform preview)
- STT them on ingest, treat as normal text-channel input

**Phase 4 — Production polish**
- DAVE protocol decrypt-failure recovery + passthrough (upstream has `receive-recovery.ts`)
- Multi-speaker context tracking (`speaker-context.ts` upstream)
- `clawcode channels capabilities --channel discord --target channel:<id>` CLI for pre-flight permission inspection
- Reconnect on voice-state-update + timeout handling
- Voice-mode prompt assembly (force 2-3 sentence replies, no markdown — voice-friendly)

### Acceptance criteria

- An agent with `voice.channelId` configured auto-joins on startup. Verified by `/vc status`.
- Speaking in that channel triggers `Deepgram → agent text turn → ElevenLabs` round-trip, audible reply within ≤4 seconds for short utterances.
- Agent's tool catalog works mid-voice-turn (e.g., "what's TSLA's price" triggers `finnhub.stock_quote` and the reply is the actual quote).
- `/vc leave` disconnects cleanly; `/vc join channel:<id>` allows manual override.
- Access control: voice ingress respects the same per-account allowlist/group policy as text channels.
- 30s agent silence → Haiku fallback fires (no dead air).
- Discord intents/perms documented in agent README (Message Content + Server Members + Connect + Speak + Send Messages + Read Message History).
- 1Password refs resolve for `deepgramKey` / `elevenLabsKey` via the existing op-resolver (see 999.53 + recent op-resolver verification).

### Implementation notes / Suggested investigation

- **Reference code:** `openclaw/openclaw` GitHub repo, path `extensions/discord/src/voice/`. Read in order: `command.ts` → `manager.ts` → `ingress.ts` → `audio.ts` → `capture-state.ts` → `access.ts`. Skip `realtime.ts` / `receive-recovery.ts` / `speaker-context.ts` for Phase 1.
- **Local spec:** `~/voice-channel-prompt.md` on OC server (Jas's earlier sketch — useful for high-level intent but lighter than upstream).
- **Schema slot:** add `voice:` block to per-agent stanza in `clawcode.yaml`. Validate at config load. Make the entire block optional; missing = no voice for that agent.
- **op-resolver integration:** `deepgramKey` / `elevenLabsKey` should accept `op://...` refs and be pre-resolved at boot (verified resolver path exists per 2026-05-14 investigation — `SecretsResolver` class at `dist/cli/index.js:20340–20480`, `preResolveAll` at 55525–55720).
- **Slash command registration:** existing `slash-commands.ts` registration pattern (REST.put → guild commands) at lines per the slash-commands-register tests. Add `vc` as a `CommandWithSubcommands`.
- **Routing:** transcripts should reuse the existing agent ingress path so tool/MCP/skill behavior is automatic. Don't fork into a "voice-only" agent runtime — keep agents agnostic.
- **TTS prompt assembly:** add a voice-mode system-prompt suffix that asks for 2–3 sentence replies with no markdown, no code fences, no emoji. Long replies break the audio cadence.
- **Cost guardrails:** consider per-agent monthly voice-minutes cap in config to avoid Deepgram/ElevenLabs cost surprises.

### Related

- **`~/voice-channel-prompt.md`** — local feature sketch (OC server)
- **`openclaw/openclaw` `extensions/discord/src/voice/`** — reference implementation
- **999.53** — `mcp-broker-hot-reload-token-rotation` (adjacent: voice keys should hot-reload too)
- **999.54** — `allowed-tools-sdk-passthrough` (unrelated but voice-mode might want to bias tool preload toward "useful in conversation" tools)
- **op-resolver verification, 2026-05-14** — confirmed nested `op://` refs in per-agent env blocks resolve correctly; same machinery handles `voice.deepgramKey` / `elevenLabsKey`

### Reporter

Admin Clawdy on behalf of Jas, 2026-05-14 15:36 PT
