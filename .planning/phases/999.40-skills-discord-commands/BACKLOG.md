# Backlog: /clawcode-skills-create + /clawcode-skills-install

## 999.40-A — /clawcode-skills-create

Interactive Discord skill creator that routes to Claude Code's native skill authoring flow.

### Goal
Let the operator create a new Claude Code skill from within Discord — describe what the skill should do, get an interactive back-and-forth to refine it, and have it saved to the agent's skills path immediately.

### Design
- Command: `/clawcode-skills-create name:<slug> description:<text>`
- Opens a ModalBuilder with fields: name, description, trigger conditions, example usage
- On submit: sends a structured prompt to the bound agent asking it to scaffold the skill (using Claude's own skill-writing conventions — SKILL.md format, trigger conditions, etc.)
- Streams output back via Discord edit-updates
- On completion: agent writes the skill to `{skillsPath}/{name}.md`, sym-links it if needed
- Final reply shows the skill content + install path + "Test it with /{name}" prompt

### Key decisions needed
- Which agent writes the skill? Bound agent (so it knows the persona) vs. Admin Clawdy (central coordinator)
- How to handle skill validation (trigger syntax, YAML front-matter)
- Whether to use a ModalBuilder for the multi-field input or a multi-step message flow

---

## 999.40-B — /clawcode-skills-install

Install a skill from ClawHub or other public repos directly from Discord.

### Goal
Allow one-click skill installation from known registries. `/clawcode-skills-install` should show available skills, let the operator pick one, and install + activate it immediately — no manual file manipulation.

### Design
- Command: `/clawcode-skills-install skill:<name> [agent:<name>]`
- Uses the existing marketplace-install IPC infrastructure (already wired via `/clawcode-skills-browse`)
- Extends beyond `/clawcode-skills-browse` by:
  1. Supporting direct name-based install without browsing first (power-user flow)
  2. Supporting external repos beyond ClawHub (GitHub URLs, raw file URLs)
  3. Verifying skill health after install (parse the SKILL.md, validate trigger syntax)
  4. Optionally restarting the agent to pick up the new skill
- Success reply: shows skill summary + activated trigger + which agent it was installed for
- Error paths: invalid URL, auth required (ClawHub token), name collision

### External repo support
- `skill:<github-org>/<repo>/<skill-name>` — pulls from GitHub
- `skill:<https://raw.githubusercontent.com/...>` — direct URL
- ClawHub registry names (existing) — no change

### Requires
- Extending `marketplace-install` IPC or adding `skill-install-url` IPC
- URL fetch + SKILL.md validation in daemon
- Optional: post-install agent restart IPC
