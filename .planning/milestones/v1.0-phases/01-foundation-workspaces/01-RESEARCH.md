# Phase 1: Foundation & Workspaces - Research

**Researched:** 2026-04-08
**Domain:** YAML config parsing, CLI scaffolding, filesystem workspace creation, TypeScript project setup
**Confidence:** HIGH

## Summary

Phase 1 is a greenfield TypeScript project that delivers three things: (1) a YAML config schema and validator for defining agents, (2) a CLI command (`clawcode init`) that reads the config and creates isolated workspace directories, and (3) default identity files (SOUL.md, IDENTITY.md) populated into each workspace. There is no AI, no SDK, no Discord -- this is pure deterministic TypeScript code that reads config and creates directories/files.

The standard stack is well-established and low-risk: `yaml` for parsing, `zod` for validation, `commander` for the CLI entry point. All are mature, TypeScript-first libraries with high download counts and active maintenance. The project structure follows the architecture research recommendation with `src/config/` and `src/agent/` modules established in this phase.

**Primary recommendation:** Use `yaml` (v2.8.3) for YAML parsing, `zod` (v4.3.6) for schema validation, and `commander` (v14.0.3) for the CLI framework. Keep the Phase 1 scope tight -- config + workspaces + identity files only.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Single YAML config file (`clawcode.yaml`) at project root defining all agents
- **D-02:** Each agent entry has: name, workspace (path), channels (array of Discord channel IDs), model (sonnet/opus/haiku), skills (array), soul (inline or path), identity (inline or path)
- **D-03:** Top-level config includes: version, defaults (shared model, shared skills), agents array
- **D-04:** Agent-level fields override defaults (e.g., agent specifies model: opus overrides default model: sonnet)
- **D-05:** Each agent workspace is a directory under a configurable base path (default: `~/.clawcode/agents/`)
- **D-06:** Workspace contains: SOUL.md, IDENTITY.md, memory/ directory, skills/ directory
- **D-07:** Workspaces are fully isolated -- no shared files, no symlinks between agent dirs
- **D-08:** Ship with sensible default SOUL.md and IDENTITY.md templates
- **D-09:** Config YAML can override identity via inline content or file path reference
- **D-10:** Default SOUL.md establishes baseline behavioral philosophy; default IDENTITY.md uses agent name for identity
- **D-11:** TypeScript CLI entry point -- `clawcode init` reads config, validates, creates workspaces, populates identity files
- **D-12:** `clawcode init` is idempotent -- running it again updates/creates missing workspaces without destroying existing ones
- **D-13:** CLI validates config schema before creating anything -- fail fast with clear error messages

### Claude's Discretion
- Config validation library choice (zod, ajv, etc.)
- YAML parsing library choice
- CLI framework choice (commander, yargs, etc.)
- Exact default SOUL.md and IDENTITY.md content (should be good general-purpose defaults inspired by OpenClaw's patterns)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MGMT-01 | Central YAML config file defining all agents, their workspaces, channels, models, and skills | Zod schema for config validation, yaml library for parsing, config loader module |
| WKSP-01 | Each agent gets its own isolated workspace directory on creation | Workspace creation module using Node.js fs/promises, idempotent mkdir |
| WKSP-02 | Each agent workspace contains a SOUL.md file defining behavioral philosophy | Default SOUL.md template, config override support (inline or path) |
| WKSP-03 | Each agent workspace contains an IDENTITY.md file defining name, avatar, and tone | Default IDENTITY.md template with agent name interpolation, config override support |
| WKSP-04 | Agent workspaces are isolated -- no cross-contamination of state or memory between agents | Each workspace is a separate directory tree, no symlinks, no shared paths |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Immutability:** Always create new objects, never mutate existing ones
- **File size:** 200-400 lines typical, 800 max. Many small files over few large files
- **Error handling:** Handle errors explicitly at every level, user-friendly messages in CLI
- **Input validation:** Validate all user input (config file) before processing, fail fast
- **Functions:** Small (<50 lines), no deep nesting (>4 levels)
- **Security:** No hardcoded secrets, validate inputs, parameterized queries
- **Git:** Meaningful commit messages using type prefixes (feat, fix, refactor, etc.)

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| yaml | 2.8.3 | YAML parsing | Full YAML 1.2 spec support, zero dependencies, built-in TypeScript types (requires TS 5.9+), modern API with document model. More feature-complete than js-yaml for anchors, custom types, and round-trip editing. |
| zod | 4.3.6 | Config schema validation | The TypeScript standard for runtime validation. Excellent error messages, composable schemas, TypeScript type inference from schemas. Already chosen in STACK.md research. |
| commander | 14.0.3 | CLI framework | Minimal, zero-dependency, hierarchical subcommands, excellent TypeScript support. Clean declarative syntax ideal for `clawcode init` and future subcommands (start, stop, status). 35M+ weekly downloads. |
| typescript | 6.0.2 | Language | Type safety for config schemas and workspace operations. Already available on-box. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pino | 9.x | Structured logging | Log config validation results, workspace creation operations, and errors. JSON output for machine parsing. |

### Development

| Tool | Version | Purpose |
|------|---------|---------|
| tsx | 4.21.0 | Run TypeScript directly during development |
| vitest | 4.1.3 | Unit and integration testing |
| tsup | 8.5.1 | Zero-config TypeScript bundler for CLI distribution |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| yaml | js-yaml | js-yaml is 3-5x faster for simple parsing, but lacks YAML 1.2 spec compliance, custom type support, and round-trip editing. yaml's richer API is worth the modest performance cost for config files (parsed once at startup). |
| commander | yargs | yargs has richer validation/middleware but adds complexity. commander's clean subcommand syntax matches `clawcode init/start/stop` pattern perfectly. Less API surface to learn. |
| zod | ajv | ajv is faster for JSON Schema validation but zod provides TypeScript type inference from schemas, eliminating the need for separate type definitions. Zod error messages are also more user-friendly for CLI output. |

**Installation:**
```bash
npm install yaml zod commander pino
npm install -D typescript tsx vitest tsup @types/node
```

## Architecture Patterns

### Recommended Project Structure (Phase 1 scope)

```
src/
├── cli/                    # CLI entry points
│   └── index.ts            # commander setup, clawcode command
├── config/                 # Configuration management
│   ├── schema.ts           # Zod schema for clawcode.yaml
│   ├── loader.ts           # YAML file reading + validation
│   └── defaults.ts         # Default values and templates
├── agent/                  # Agent infrastructure (Phase 1: workspace only)
│   └── workspace.ts        # Workspace directory creation + identity file writing
├── shared/                 # Shared utilities
│   ├── types.ts            # Shared type definitions
│   ├── errors.ts           # Error types and handling
│   └── logger.ts           # Pino logger setup
├── templates/              # Default identity file templates
│   ├── SOUL.md             # Default SOUL.md content
│   └── IDENTITY.md         # Default IDENTITY.md template (with {{name}} placeholder)
└── index.ts                # Main export (for programmatic use)
```

### Pattern 1: Zod Schema as Single Source of Truth

**What:** Define the config structure as a Zod schema. TypeScript types are inferred from the schema. Validation and type definitions live in one place.

**When to use:** Always. This eliminates type drift between validation and usage.

**Example:**
```typescript
// src/config/schema.ts
import { z } from "zod/v4";

const modelSchema = z.enum(["sonnet", "opus", "haiku"]);

const agentSchema = z.object({
  name: z.string().min(1),
  workspace: z.string().optional(), // defaults to ~/.clawcode/agents/{name}
  channels: z.array(z.string()).default([]),
  model: modelSchema.optional(), // inherits from defaults
  skills: z.array(z.string()).default([]),
  soul: z.string().optional(),   // inline content OR file path
  identity: z.string().optional(), // inline content OR file path
});

const defaultsSchema = z.object({
  model: modelSchema.default("sonnet"),
  skills: z.array(z.string()).default([]),
  basePath: z.string().default("~/.clawcode/agents"),
});

const configSchema = z.object({
  version: z.literal(1),
  defaults: defaultsSchema.default({}),
  agents: z.array(agentSchema).min(1),
});

type Config = z.infer<typeof configSchema>;
type AgentConfig = z.infer<typeof agentSchema>;
```

### Pattern 2: Idempotent Workspace Creation

**What:** The workspace creation function checks for existing directories and files before creating them. Existing content is preserved unless explicitly being updated from config changes.

**When to use:** For `clawcode init` -- must be safe to run repeatedly.

**Example:**
```typescript
// src/agent/workspace.ts
import { mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function createWorkspace(
  basePath: string,
  agent: ResolvedAgentConfig,
): Promise<WorkspaceResult> {
  const workspacePath = agent.workspace ?? join(basePath, agent.name);
  const dirs = [workspacePath, join(workspacePath, "memory"), join(workspacePath, "skills")];

  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
  }

  // Write identity files -- overwrite if config provides them, create defaults if missing
  const soulPath = join(workspacePath, "SOUL.md");
  const identityPath = join(workspacePath, "IDENTITY.md");

  if (agent.soul) {
    await writeFile(soulPath, await resolveContent(agent.soul));
  } else if (!(await fileExists(soulPath))) {
    await writeFile(soulPath, getDefaultSoul());
  }

  if (agent.identity) {
    await writeFile(identityPath, await resolveContent(agent.identity));
  } else if (!(await fileExists(identityPath))) {
    await writeFile(identityPath, getDefaultIdentity(agent.name));
  }

  return { path: workspacePath, created: true };
}
```

### Pattern 3: Config Defaults Merging

**What:** Agent-level config overrides top-level defaults. Merge happens after parsing, before workspace creation.

**When to use:** When resolving effective config per agent.

**Example:**
```typescript
// src/config/loader.ts
function resolveAgentConfig(
  agent: AgentConfig,
  defaults: DefaultsConfig,
): ResolvedAgentConfig {
  return {
    ...agent,
    model: agent.model ?? defaults.model,
    skills: agent.skills.length > 0 ? agent.skills : defaults.skills,
    workspace: agent.workspace ?? join(expandHome(defaults.basePath), agent.name),
  };
}
```

### Pattern 4: Content Resolution (Inline vs Path)

**What:** The `soul` and `identity` fields in config can be either inline markdown content or a file path. Resolve at load time.

**When to use:** When processing soul/identity overrides from config.

**Example:**
```typescript
async function resolveContent(value: string): Promise<string> {
  // If it looks like a file path (starts with / or ./ or ~/) and exists, read it
  if (/^[.~\/]/.test(value)) {
    const expanded = expandHome(value);
    if (await fileExists(expanded)) {
      return readFile(expanded, "utf-8");
    }
  }
  // Otherwise treat as inline content
  return value;
}
```

### Anti-Patterns to Avoid

- **Shared state between workspaces:** Never create symlinks, shared directories, or references between agent workspaces. Each workspace is fully self-contained.
- **Mutating config objects:** Always create new objects when merging defaults with agent config. Never modify the parsed config in place.
- **Silent failures on workspace creation:** If mkdir or writeFile fails, throw with a clear message including the path and reason. Never swallow filesystem errors.
- **Hard-coding paths:** Use the config's basePath, never hard-code `~/.clawcode/agents`. Expand `~` to the actual home directory at runtime.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML parsing | Custom parser | `yaml` package | YAML spec is deceptively complex (anchors, multi-line strings, type coercion). Even js-yaml doesn't fully implement YAML 1.2. |
| Schema validation | Custom if/else chains | `zod` | Edge cases in validation (nested objects, arrays, optional vs default, error aggregation) are endless. Zod handles them all and gives TypeScript types for free. |
| CLI argument parsing | Manual process.argv parsing | `commander` | Subcommands, help generation, version flags, option parsing -- solved problems. |
| Home directory expansion | Manual `$HOME` lookup | `os.homedir()` or `path.resolve()` | Cross-platform home dir resolution has edge cases (WSL, root user, etc.). |
| File path resolution | Custom path joining | `node:path` join/resolve | Forward/backward slash handling, relative path resolution, .. traversal -- all handled. |

**Key insight:** Phase 1 is entirely filesystem operations and config parsing. These are well-solved domains with mature libraries. The only custom code is the glue logic connecting them.

## Common Pitfalls

### Pitfall 1: YAML Type Coercion Surprises

**What goes wrong:** YAML auto-coerces values like `on`, `off`, `yes`, `no` to booleans, and bare numbers to integers. A Discord channel ID like `1234567890` becomes a number, losing precision for IDs > Number.MAX_SAFE_INTEGER.
**Why it happens:** YAML 1.1 spec (what js-yaml defaults to) has aggressive type coercion. Even YAML 1.2 coerces unquoted numbers.
**How to avoid:** Define channel IDs as strings in the Zod schema. Document that channel IDs must be quoted in YAML: `channels: ["1234567890123456"]`. Consider using the `yaml` library's `intAsBigInt` option or enforcing string type in schema.
**Warning signs:** Tests passing with small test IDs but failing with real Discord snowflake IDs (18+ digits).

### Pitfall 2: Tilde Expansion in Paths

**What goes wrong:** `~/.clawcode/agents` is passed directly to `fs.mkdir` without expanding `~`, creating a literal directory named `~` in the current working directory.
**Why it happens:** Node.js `fs` module does NOT expand `~`. That's a shell feature.
**How to avoid:** Write an explicit `expandHome()` utility that replaces leading `~` with `os.homedir()`. Apply it to all paths from config before any filesystem operation.
**Warning signs:** Directories appearing in the project root instead of the home directory.

### Pitfall 3: Non-Idempotent File Overwrites

**What goes wrong:** Running `clawcode init` a second time overwrites a SOUL.md that the user manually edited.
**Why it happens:** The init command doesn't distinguish between "file exists from previous init with defaults" and "file exists because user customized it."
**How to avoid:** Decision D-12 requires idempotency. Strategy: only overwrite identity files if the config explicitly provides soul/identity values. If using defaults, only create files that don't exist yet. If config provides values, always overwrite (config is the source of truth).
**Warning signs:** Users complaining that their edits disappear after re-running init.

### Pitfall 4: Missing Error Context in Validation

**What goes wrong:** Zod validation error says "Expected string, received number" with no indication of which agent or which field failed.
**Why it happens:** Raw Zod errors reference JSON paths like `.agents[2].channels[0]` which are hard to read.
**How to avoid:** Format Zod errors with agent name context. Use `z.issue` customization or post-process `ZodError.issues` to add human-readable context like "Agent 'researcher': channels[0] must be a string, got number."
**Warning signs:** Users unable to fix config errors because the error message doesn't tell them where to look.

### Pitfall 5: ESM/CJS Module Confusion

**What goes wrong:** Importing `yaml` or `commander` fails with `ERR_REQUIRE_ESM` or `Cannot use import statement outside a module`.
**Why it happens:** `execa` (v6+), `commander` (v12+), and other modern packages are ESM-only. The project must be ESM.
**How to avoid:** Set `"type": "module"` in package.json from day one. Use `"module": "ESNext"` and `"moduleResolution": "bundler"` or `"NodeNext"` in tsconfig.json. Never use `require()`.
**Warning signs:** Import errors at runtime that don't appear during type-checking.

## Code Examples

### Example clawcode.yaml Config File

```yaml
# clawcode.yaml
version: 1

defaults:
  model: sonnet
  skills: []
  basePath: "~/.clawcode/agents"

agents:
  - name: researcher
    channels: ["1234567890123456"]
    model: opus
    skills:
      - market-research
      - search-first

  - name: writer
    channels: ["1234567890123457", "1234567890123458"]
    skills:
      - article-writing
      - content-engine

  - name: coder
    channels: ["1234567890123459"]
    model: sonnet
    soul: "./custom-souls/coder-soul.md"
    identity: |
      # IDENTITY.md - Who Am I?

      - **Name:** CodeBot
      - **Vibe:** Precise, methodical, test-driven
```

### Default SOUL.md Template (Inspired by OpenClaw)

```markdown
# SOUL.md - Who You Are

## Core Principles

**Be genuinely helpful.** Skip filler phrases. Actions over words.

**Have opinions.** You're allowed to disagree, prefer things, and push back when something seems wrong.

**Be resourceful.** Try to figure it out before asking. Read files, check context, search for answers.

**Earn trust through competence.** Be careful with external actions. Be bold with internal ones.

## Boundaries

- Private information stays private
- When in doubt, ask before acting externally
- Never send half-baked responses

## Continuity

Each session starts fresh. Your workspace files are your memory. Read them. Update them.
```

### Default IDENTITY.md Template

```markdown
# IDENTITY.md - Who Am I?

- **Name:** {{name}}
- **Role:** AI assistant
- **Vibe:** Competent, direct, helpful without being performative
```

### CLI Entry Point Structure

```typescript
// src/cli/index.ts
import { Command } from "commander";
import { loadConfig } from "../config/loader.js";
import { createWorkspaces } from "../agent/workspace.js";

const program = new Command()
  .name("clawcode")
  .description("Multi-agent orchestration for Claude Code")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize agent workspaces from config")
  .option("-c, --config <path>", "Path to config file", "clawcode.yaml")
  .option("--dry-run", "Show what would be created without creating it")
  .action(async (options) => {
    const config = await loadConfig(options.config);
    const results = await createWorkspaces(config, { dryRun: options.dryRun });
    for (const result of results) {
      console.log(`${result.created ? "Created" : "Exists"}: ${result.path}`);
    }
  });

program.parse();
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| js-yaml (YAML 1.1) | yaml (YAML 1.2) | yaml v2.0 (2022) | Correct boolean/null handling, better TypeScript types |
| zod 3.x | zod 4.x | 2025 | Better performance, tree-shaking, simpler API |
| commander 11.x | commander 14.x | 2025 | ESM-only, improved TypeScript declarations |
| CommonJS modules | ESM-only | Node 22 LTS default | Must use "type": "module" in package.json |

## Open Questions

1. **Soul/Identity content resolution heuristic**
   - What we know: Config value can be inline markdown or a file path reference
   - What's unclear: Best heuristic to distinguish inline content from file paths. Current proposal: check if value starts with `/`, `./`, `~/` and file exists. Edge case: what if inline content starts with `/`?
   - Recommendation: Use an explicit prefix convention (e.g., `file:./path.md`) OR require paths to use a dedicated `soul_file` field separate from `soul`. Simplest: if it contains a newline, it's inline; if it looks like a path and exists on disk, it's a file; otherwise treat as inline.

2. **Package binary name**
   - What we know: CLI should be invoked as `clawcode init`
   - What's unclear: Whether to register as `clawcode` in package.json bin field now, or use `npx tsx src/cli/index.ts` during development
   - Recommendation: Add `"bin": { "clawcode": "./dist/cli/index.js" }` in package.json for production. Use `tsx src/cli/index.ts` for development via npm script.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | Yes | 22.22.0 | -- |
| npm | Package management | Yes | 10.9.4 | -- |
| TypeScript | Language (dev) | Available via npm | 6.0.2 (registry) | -- |
| git | Version control | Yes (workspace is under git-like planning) | -- | -- |

**Missing dependencies with no fallback:** None -- all required tools are available.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.1.3 |
| Config file | none -- see Wave 0 |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MGMT-01 | Config YAML parsed and validated against schema | unit | `npx vitest run src/config/__tests__/schema.test.ts` | No -- Wave 0 |
| MGMT-01 | Invalid config produces clear error messages | unit | `npx vitest run src/config/__tests__/loader.test.ts` | No -- Wave 0 |
| MGMT-01 | Agent defaults merge correctly with agent overrides | unit | `npx vitest run src/config/__tests__/loader.test.ts` | No -- Wave 0 |
| WKSP-01 | Workspace directories created for each agent | integration | `npx vitest run src/agent/__tests__/workspace.test.ts` | No -- Wave 0 |
| WKSP-02 | SOUL.md created with default content when not specified | integration | `npx vitest run src/agent/__tests__/workspace.test.ts` | No -- Wave 0 |
| WKSP-02 | SOUL.md created with config-provided content (inline or path) | integration | `npx vitest run src/agent/__tests__/workspace.test.ts` | No -- Wave 0 |
| WKSP-03 | IDENTITY.md created with agent name interpolated | integration | `npx vitest run src/agent/__tests__/workspace.test.ts` | No -- Wave 0 |
| WKSP-03 | IDENTITY.md created with config-provided content | integration | `npx vitest run src/agent/__tests__/workspace.test.ts` | No -- Wave 0 |
| WKSP-04 | Workspaces have no shared files or symlinks | integration | `npx vitest run src/agent/__tests__/workspace.test.ts` | No -- Wave 0 |
| D-12 | Idempotent init -- re-running does not destroy existing workspaces | integration | `npx vitest run src/agent/__tests__/workspace.test.ts` | No -- Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `vitest.config.ts` -- vitest configuration
- [ ] `tsconfig.json` -- TypeScript configuration (ESM, strict, NodeNext)
- [ ] `package.json` -- project manifest with type: module, scripts, dependencies
- [ ] `src/config/__tests__/schema.test.ts` -- config schema validation tests
- [ ] `src/config/__tests__/loader.test.ts` -- config loading and defaults merging tests
- [ ] `src/agent/__tests__/workspace.test.ts` -- workspace creation and idempotency tests

## Sources

### Primary (HIGH confidence)
- npm registry -- all versions verified via `npm view` on 2026-04-08: yaml@2.8.3, zod@4.3.6, commander@14.0.3, vitest@4.1.3, tsx@4.21.0, tsup@8.5.1, typescript@6.0.2
- Node.js 22.22.0 -- verified installed on target system
- `.planning/research/STACK.md` -- technology stack decisions (zod, pino, Node.js 22 LTS)
- `.planning/research/ARCHITECTURE.md` -- project structure, manager pattern, workspace isolation
- OpenClaw reference implementation (`~/.openclaw/workspace-general/SOUL.md`, `IDENTITY.md`) -- identity file format

### Secondary (MEDIUM confidence)
- [yaml npm package](https://www.npmjs.com/package/yaml) -- YAML 1.2 parser, TypeScript support
- [commander vs yargs comparison](https://www.pkgpulse.com/blog/how-to-build-cli-nodejs-commander-yargs-oclif) -- CLI framework comparison
- [yaml vs js-yaml comparison](https://npm-compare.com/js-yaml,yaml,yamljs) -- YAML library comparison

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries verified via npm registry, well-established ecosystem choices
- Architecture: HIGH -- follows architecture research recommendations, standard TypeScript project patterns
- Pitfalls: HIGH -- YAML type coercion and tilde expansion are well-documented gotchas; idempotency concerns derived from decision D-12

**Research date:** 2026-04-08
**Valid until:** 2026-05-08 (stable domain, 30-day validity)
