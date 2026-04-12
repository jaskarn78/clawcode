import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { parseDocument, type Document } from "yaml";
import { expandHome } from "../config/defaults.js";

const AGENT_NAME_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;
const VALID_MODELS = new Set(["sonnet", "opus", "haiku"]);

export type AgentCreateSpec = {
  readonly name: string;
  readonly soul: string;
  readonly model?: string;
  readonly channelId: string;
};

export type AgentCreateDeps = {
  readonly configPath: string;
  readonly agentsBasePath: string;
};

export type AgentCreateResult = {
  readonly name: string;
  readonly channelId: string;
  readonly workspace: string;
  readonly model: string;
};

/**
 * Validate a proposed agent name. Throws on invalid input.
 * Accepts lowercase letters, digits, and hyphens; must start with a letter;
 * length 2-32 to fit Discord channel name + config constraints.
 */
export function validateAgentName(name: string): void {
  if (!AGENT_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid agent name '${name}'. Must be lowercase, 2-32 chars, start with a letter, contain only letters/digits/hyphens.`,
    );
  }
}

/**
 * Provision a new agent:
 *  1. Validate input
 *  2. Append to the YAML config (preserving existing structure/comments)
 *  3. Scaffold the agent workspace + SOUL.md
 *
 * Does NOT create the Discord channel -- that must happen before this is called
 * and the channelId passed in. This keeps the provisioner pure-FS and testable.
 *
 * The caller is responsible for rollback if the returned promise rejects.
 */
export async function provisionAgent(
  spec: AgentCreateSpec,
  deps: AgentCreateDeps,
): Promise<AgentCreateResult> {
  validateAgentName(spec.name);

  if (spec.model && !VALID_MODELS.has(spec.model)) {
    throw new Error(
      `Invalid model '${spec.model}'. Must be one of: sonnet, opus, haiku.`,
    );
  }

  if (!spec.soul.trim()) {
    throw new Error("soul is required and cannot be empty");
  }

  const model = spec.model ?? "sonnet";
  const workspace = join(expandHome(deps.agentsBasePath), spec.name);

  await appendAgentToConfig(deps.configPath, {
    name: spec.name,
    channelId: spec.channelId,
    model,
  });

  await scaffoldWorkspace(workspace, spec.soul);

  return {
    name: spec.name,
    channelId: spec.channelId,
    workspace,
    model,
  };
}

type YamlAppendSpec = {
  readonly name: string;
  readonly channelId: string;
  readonly model: string;
};

/**
 * Append a new agent entry to the YAML config's `agents:` sequence.
 * Uses the yaml Document API so comments and existing structure are preserved.
 *
 * Throws if:
 *  - config file cannot be read
 *  - `agents` is missing or not a sequence
 *  - an agent with the same name already exists
 */
async function appendAgentToConfig(
  configPath: string,
  entry: YamlAppendSpec,
): Promise<void> {
  const expanded = expandHome(configPath);
  const raw = await readFile(expanded, "utf-8");
  const doc: Document = parseDocument(raw);

  const agents = doc.get("agents");
  if (!agents || typeof (agents as { items?: unknown[] }).items === "undefined") {
    throw new Error(
      `config ${configPath} does not have an 'agents:' sequence`,
    );
  }

  const existing = doc.toJS()?.agents ?? [];
  if (Array.isArray(existing) && existing.some((a: { name?: string }) => a?.name === entry.name)) {
    throw new Error(`agent '${entry.name}' already exists in ${configPath}`);
  }

  const agentNode = doc.createNode({
    name: entry.name,
    channels: [entry.channelId],
    model: entry.model,
  });

  (agents as { add: (value: unknown) => void }).add(agentNode);

  await writeFile(expanded, String(doc), "utf-8");
}

/**
 * Create the agent workspace directory and write SOUL.md.
 * If the workspace already exists, reuse it (idempotent) but do not overwrite
 * a pre-existing SOUL.md -- that's the user's data.
 */
async function scaffoldWorkspace(workspace: string, soul: string): Promise<void> {
  await mkdir(workspace, { recursive: true });

  const soulPath = join(workspace, "SOUL.md");
  if (!existsSync(soulPath)) {
    const content = soul.endsWith("\n") ? soul : soul + "\n";
    await writeFile(soulPath, content, "utf-8");
  }

  await mkdir(dirname(join(workspace, "memory", "memories.db")), { recursive: true });
}
