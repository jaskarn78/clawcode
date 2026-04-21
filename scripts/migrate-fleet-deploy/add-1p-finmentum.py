#!/usr/bin/env python3
"""Add top-level `1password` mcpServers entry (Finmentum token) + reference it from fin-* agents."""
import re
from pathlib import Path

YAML_PATH = Path("/etc/clawcode/clawcode.yaml")
content = YAML_PATH.read_text()

# 1. Top-level entry — uses Finmentum service token
ONEP_BLOCK = """  1password:
    name: 1password
    command: npx
    args:
      - -y
      - "@1password/mcp-server@latest"
    env:
      OP_SERVICE_ACCOUNT_TOKEN: op://clawdbot/Service Account Auth Token: Finmentum-Service/credential
"""

if "  1password:" not in content:
    content = content.replace("\nagents:", f"\n{ONEP_BLOCK}\nagents:")
    print("Added 1password top-level entry (Finmentum token)")
else:
    print("1password top-level already present — skipping")

# 2. Add 1password to fin-* agents' mcpServers
FIN_AGENTS = ["fin-acquisition", "fin-playground", "fin-research", "fin-tax", "finmentum-content-creator"]
for a in FIN_AGENTS:
    # Match the agent block
    pat = re.compile(rf"(  - name: {re.escape(a)}\n(?:    [^\n]*\n)+?)(?=  - name: |\Z)", re.MULTILINE)
    m = pat.search(content)
    if not m:
        print(f"  {a}: NOT FOUND")
        continue
    block = m.group(1)
    if "      - 1password\n" in block:
        print(f"  {a}: already has 1password")
        continue
    # Insert 1password at top of mcpServers list (so it's prominent)
    new_block = re.sub(
        r"(    mcpServers:\n)",
        r"\1      - 1password\n",
        block,
        count=1,
    )
    content = content[:m.start()] + new_block + content[m.end():]
    print(f"  {a}: added 1password to mcpServers")

YAML_PATH.write_text(content)
print("\n✓ yaml updated")
