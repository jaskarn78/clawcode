
## Discord Setup

Discord bot token is stored in 1Password. Channel IDs are hardcoded per-agent.
Activation rules live in clawcode.yaml under agents[].channels.

## Project: ClawCode

Multi-agent orchestration on Claude Code. 5 phases planned, 25 requirements.
Post-v1.2 follow-up: add skill + system prompt so agents auto-use IPC.

## Server Topology

clawdy host, /opt/clawcode install, systemd service, EnvironmentFile PATH gotcha.
