---
phase: quick
plan: 260409-wdc
type: execute
wave: 1
depends_on: []
files_modified:
  - clawcode.yaml
  - src/config/__tests__/loader.test.ts
autonomous: true
must_haves:
  truths:
    - "All 14 OpenClaw MCP servers are defined as shared top-level entries in clawcode.yaml"
    - "Config loads and validates without errors"
    - "Existing test-agent remains unchanged"
  artifacts:
    - path: "clawcode.yaml"
      provides: "14 shared MCP server definitions under mcpServers key"
      contains: "mcpServers"
    - path: "src/config/__tests__/loader.test.ts"
      provides: "Test that full config with all MCP servers loads correctly"
  key_links:
    - from: "clawcode.yaml"
      to: "src/config/schema.ts"
      via: "configSchema.mcpServers record validation"
      pattern: "mcpServers"
---

<objective>
Add all 14 deduplicated OpenClaw MCP servers as shared definitions in clawcode.yaml.

Purpose: Centralizes MCP server configuration so agents can reference servers by name. This is the prerequisite for per-agent MCP assignments when the full agent roster is defined.
Output: Updated clawcode.yaml with shared MCP server definitions, passing loader test.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@clawcode.yaml
@src/config/schema.ts
@src/config/loader.ts
@src/config/__tests__/loader.test.ts

<interfaces>
From src/config/schema.ts:
```typescript
export const mcpServerSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
});

// Top-level mcpServers is a Record<string, McpServerSchemaConfig>
// configSchema.mcpServers: z.record(z.string(), mcpServerSchema).default({})

// Per-agent mcpServers is an array of inline objects or string references
// agentSchema.mcpServers: z.array(z.union([mcpServerSchema, z.string()])).default([])
```

From src/config/loader.ts:
```typescript
export function resolveAgentConfig(
  agent: AgentConfig,
  defaults: DefaultsConfig,
  sharedMcpServers: Record<string, McpServerSchemaConfig> = {},
): ResolvedAgentConfig;

export function resolveAllAgents(config: Config): ResolvedAgentConfig[];
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add 14 shared MCP server definitions to clawcode.yaml</name>
  <files>clawcode.yaml</files>
  <action>
Add a top-level `mcpServers:` mapping between `defaults:` and `agents:` in clawcode.yaml. Each key is the server name, each value has `name`, `command`, `args` (if any), and `env` (if any).

The 14 servers to add (use op:// references for secrets, ${VAR} for env-sourced keys):

1. **finnhub** — command: `node`, args: ["/home/jjagpal/clawd/mcp-servers/finnhub/server.js"], env: FINNHUB_API_KEY=op://clawdbot/Finnhub/api-key
2. **finmentum-db** — command: `mcporter`, args: ["serve", "mysql"], env: MYSQL_HOST=op://clawdbot/MySQL DB - Unraid/host, MYSQL_PORT=3306, MYSQL_USER=op://clawdbot/MySQL DB - Unraid/username, MYSQL_PASSWORD=op://clawdbot/Finmentum DB/password, MYSQL_DATABASE=finmentum
3. **google-workspace** — command: `node`, args: ["/home/jjagpal/clawd/projects/google-workspace-mcp/dist/index.js"], no env
4. **homeassistant** — command: `python3`, args: ["/home/jjagpal/.openclaw/workspace-general/mcp-servers/homeassistant.py"], env: HA_URL=http://100.76.169.87:8123, HA_TOKEN=op://clawdbot/HA Access Token/Access Token
5. **strava** — command: `python3`, args: ["/home/jjagpal/.openclaw/workspace-general/mcp-servers/strava.py"], env: STRAVA_CLIENT_ID=op://clawdbot/Strava OAuth Tokens/client_id, STRAVA_CLIENT_SECRET=op://clawdbot/Strava OAuth Tokens/client_secret, STRAVA_ACCESS_TOKEN=op://clawdbot/Strava OAuth Tokens/access_token, STRAVA_REFRESH_TOKEN=op://clawdbot/Strava OAuth Tokens/refresh_token
6. **openai** — command: `python3`, args: ["/home/jjagpal/.openclaw/workspace-general/mcp-servers/openai_server.py"], env: OPENAI_API_KEY=${OPENAI_API_KEY}
7. **anthropic** — command: `python3`, args: ["/home/jjagpal/.openclaw/workspace-general/mcp-servers/anthropic_server.py"], env: ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
8. **brave-search** — command: `python3`, args: ["/home/jjagpal/.openclaw/workspace-general/mcp-servers/brave_search.py"], env: BRAVE_API_KEY=${BRAVE_API_KEY}
9. **elevenlabs** — command: `python3`, args: ["/home/jjagpal/.openclaw/workspace-general/mcp-servers/elevenlabs.py"], env: ELEVENLABS_API_KEY=${ELEVENLABS_API_KEY}
10. **ollama** — command: `python3`, args: ["/home/jjagpal/.openclaw/workspace-general/mcp-servers/ollama.py"], env: OLLAMA_URL=http://100.117.64.85:11434
11. **browserless** — command: `python3`, args: ["/home/jjagpal/.openclaw/workspace-general/mcp-servers/browserless.py"], env: BROWSERLESS_URL=http://100.117.64.85:3000
12. **chatterbox-tts** — command: `python3`, args: ["/home/jjagpal/.openclaw/workspace-general/mcp-servers/chatterbox_tts.py"], env: CHATTERBOX_URL=http://100.117.64.85:4123
13. **fal-ai** — command: `python3`, args: ["/home/jjagpal/.openclaw/workspace-general/mcp-servers/fal_ai.py"], env: FAL_API_KEY=op://clawdbot/fal.ai Admin API Credentials/credential
14. **finmentum-content** — command: `python3`, args: ["/home/jjagpal/.openclaw/workspace-general/mcp-servers/finmentum_content.py"], env: FINMENTUM_DB_PASSWORD=op://clawdbot/MySQL DB - Unraid/password, HEYGEN_API_KEY=op://clawdbot/HeyGen/api-key, PEXELS_API_KEY=op://clawdbot/Pexels/api-key, FINMENTUM_AVATAR_ID=op://clawdbot/HeyGen/avatar_id, FINMENTUM_VOICE_ID=op://clawdbot/HeyGen/voice_id, JAMENDO_CLIENT_ID=op://clawdbot/Jamendo/client_id

Keep the existing `test-agent` exactly as-is with no mcpServers. The env values with `op://` are 1Password references (resolved at runtime by op inject). The `${VAR}` values are sourced from the shell environment.

IMPORTANT: YAML strings containing `${}` must NOT be quoted with double quotes in YAML (YAML would try to interpret them). Use plain unquoted strings or single quotes for env values containing `${}`.
  </action>
  <verify>
    <automated>cd /home/jjagpal/.openclaw/workspace-coding && npx tsx -e "import { parse } from 'yaml'; import { readFileSync } from 'fs'; const y = parse(readFileSync('clawcode.yaml','utf-8')); const keys = Object.keys(y.mcpServers || {}); console.log('MCP server count:', keys.length); console.log('Servers:', keys.join(', ')); if (keys.length !== 14) process.exit(1);"</automated>
  </verify>
  <done>clawcode.yaml has 14 MCP server definitions under the top-level mcpServers key, existing test-agent is unchanged</done>
</task>

<task type="auto">
  <name>Task 2: Add loader test for full config with all shared MCP servers</name>
  <files>src/config/__tests__/loader.test.ts</files>
  <action>
Add a test to the existing loader.test.ts that:

1. Creates a temporary clawcode.yaml file containing the full config (version: 1, all 14 mcpServers entries, one test agent with no mcpServers, and one agent that references 2-3 shared servers by string name).
2. Calls `loadConfig()` on that file.
3. Asserts the config loads without error.
4. Asserts `config.mcpServers` has 14 entries.
5. Calls `resolveAllAgents(config)` and asserts the agent with string references has those servers resolved to full objects.
6. Asserts the test agent with no mcpServers has an empty array.

Place this test in the existing `describe("resolveAgentConfig")` block or create a new `describe("loadConfig - shared MCP servers")` block. Use the same tmpdir pattern already established in the file.

This validates the end-to-end flow: YAML -> parse -> schema validation -> agent resolution with shared MCP server lookups.
  </action>
  <verify>
    <automated>cd /home/jjagpal/.openclaw/workspace-coding && npx vitest run src/config/__tests__/loader.test.ts --reporter=verbose 2>&1 | tail -30</automated>
  </verify>
  <done>New test passes confirming 14 shared MCP servers load correctly and string references resolve to full objects via resolveAllAgents</done>
</task>

</tasks>

<verification>
- `npx vitest run src/config/__tests__/schema.test.ts` -- existing schema tests still pass
- `npx vitest run src/config/__tests__/loader.test.ts` -- new + existing loader tests pass
- YAML parse of clawcode.yaml succeeds with 14 mcpServers entries
</verification>

<success_criteria>
- clawcode.yaml contains all 14 OpenClaw MCP servers as shared definitions
- Existing test-agent config is unchanged
- All config tests pass (schema + loader)
- Config can be loaded and agents resolved without errors
</success_criteria>

<output>
After completion, create `.planning/quick/260409-wdc-configure-all-openclaw-mcp-servers-in-cl/260409-wdc-SUMMARY.md`
</output>
