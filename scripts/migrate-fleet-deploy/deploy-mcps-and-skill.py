#!/usr/bin/env python3
"""Edit clawcode.yaml: add polygon-api top-level, add MCPs + skills to migrated agents."""
import re
import sys
from pathlib import Path

YAML_PATH = Path("/etc/clawcode/clawcode.yaml")
content = YAML_PATH.read_text()

# --- 1. Add polygon-api top-level mcpServers entry if missing ---
POLYGON_BLOCK = """  polygon-api:
    name: polygon-api
    command: mcporter
    args:
      - serve
      - npx
      - -y
      - "@polygon-io/mcp@latest"
    env:
      POLYGON_API_KEY: op://clawdbot/Polygon API/api-key
"""

if "  polygon-api:" not in content:
    # Insert before `agents:` section
    content = content.replace("\nagents:", f"\n{POLYGON_BLOCK}\nagents:")
    print("Added polygon-api top-level entry")
else:
    print("polygon-api already in mcpServers")

# --- 2. Add MCPs + new-reel skill to each fin* agent, plus MCPs-only to non-fin migrated ---
FIN_MCPS = [
    "finnhub", "finmentum-db", "brave-search", "playwright",
    "google-workspace", "fal-ai", "browserless", "finmentum-content", "polygon-api",
]
# All migrated agents get the productivity MCPs (subset of fin list without fin-specific ones)
GENERAL_MCPS = [
    "brave-search", "playwright", "browserless", "google-workspace", "fal-ai",
]

FIN_AGENTS = {"fin-acquisition", "fin-playground", "fin-research", "fin-tax", "finmentum-content-creator"}
GENERAL_AGENTS = {"personal", "general", "projects", "research"}

def rewrite_agent_block(content, agent_name, new_mcps, extra_skills=None):
    """Replace the mcpServers: [] under an agent block with the new MCP list. Optionally add skills."""
    # Match the agent block from `  - name: <name>` up to next `  - name:` or end
    agent_pattern = re.compile(
        rf"(  - name: {re.escape(agent_name)}\n(?:    [^\n]*\n)+?)(?=  - name: |\Z)",
        re.MULTILINE,
    )
    m = agent_pattern.search(content)
    if not m:
        print(f"  {agent_name}: NOT FOUND")
        return content
    block = m.group(1)
    # Replace mcpServers: [] or empty mcpServers block
    mcp_lines = "    mcpServers:\n" + "\n".join(f"      - {s}" for s in new_mcps) + "\n"
    if "mcpServers: []" in block:
        block = block.replace("    mcpServers: []\n", mcp_lines)
    elif "    mcpServers:\n      -" in block:
        # Already has MCPs — replace the whole mcpServers section
        block = re.sub(
            r"    mcpServers:\n(?:      - [^\n]*\n)+",
            mcp_lines,
            block,
        )
    else:
        # Insert mcpServers before channels: or at end
        if "    channels:" in block:
            block = block.replace("    channels:", mcp_lines + "    channels:")
        else:
            block = block.rstrip() + "\n" + mcp_lines
    # Add skills if requested
    if extra_skills:
        skills_lines = "    skills:\n" + "\n".join(f"      - {s}" for s in extra_skills) + "\n"
        if "    skills: []" in block:
            block = block.replace("    skills: []\n", skills_lines)
        elif "    skills:\n      -" in block:
            # Merge — for each new skill, add if not present
            for s in extra_skills:
                if f"      - {s}\n" not in block:
                    block = re.sub(
                        r"(    skills:\n(?:      - [^\n]*\n)*)",
                        rf"\1      - {s}\n",
                        block,
                        count=1,
                    )
        else:
            # No skills field yet — add after channels or mcpServers
            if "    channels:" in block:
                block = block.replace("    mcpServers:\n", skills_lines + "    mcpServers:\n", 1)
            else:
                block = block.rstrip() + "\n" + skills_lines
    return content[:m.start()] + block + content[m.end():]

for a in FIN_AGENTS:
    skills = ["new-reel"] if a == "finmentum-content-creator" else None
    content = rewrite_agent_block(content, a, FIN_MCPS, skills)
    print(f"  {a}: MCPs set (9){' + new-reel skill' if skills else ''}")

for a in GENERAL_AGENTS:
    content = rewrite_agent_block(content, a, GENERAL_MCPS)
    print(f"  {a}: MCPs set (5)")

YAML_PATH.write_text(content)
print("\n✓ clawcode.yaml updated")
