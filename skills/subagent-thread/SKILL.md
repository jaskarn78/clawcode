---
version: 1.0
---
Spawn subagent sessions in dedicated Discord threads for visible, isolated task execution.

## When to Use

Use this skill when you need to delegate a task to a subagent AND want the work to be visible in Discord. This creates a new Discord thread where the subagent operates independently.

Prefer this over the raw Agent tool when:
- The task should be visible to Discord channel members
- You want the subagent's conversation isolated in its own thread
- You need to share the thread URL with others

## How to Use

You have an MCP tool available: `spawn_subagent_thread`

Call it with:
- `agent`: Your agent name (required)
- `threadName`: A descriptive name for the thread (required)
- `model`: Optional model override ("sonnet", "opus", "haiku")
- `systemPrompt`: Optional custom instructions for the subagent

The tool returns:
- Thread URL (shareable Discord link)
- Session name (for tracking)
- Parent agent and channel info

## Alternatively via CLI

```bash
clawcode spawn-thread --agent <your-name> --name "Task description" [--model sonnet] [--prompt "Custom instructions"]
```

## Error Cases

- **No Discord client**: The daemon must be running with Discord bridge enabled
- **No bound channel**: Your agent must have at least one Discord channel configured
- **Max sessions reached**: Thread session limit per agent (default 3) -- wait for existing subagents to finish

## Cleanup

Subagent threads are automatically cleaned up when the subagent session ends. The Discord thread is preserved for history.
