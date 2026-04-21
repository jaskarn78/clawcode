/**
 * Phase 78 CONF-04 — atomic YAML writer for clawcode.yaml. Uses the
 * `yaml` package's Document AST (already a dep via src/config/loader.ts)
 * to preserve comments + key ordering across a round-trip.
 *
 * Write pipeline:
 *   1. parseDocument(existingText) — preserves EVERY comment and key order
 *      attached to existing nodes.
 *   2. Insert new agent nodes into `agents:` seq (append-only — no reorder).
 *   3. Pre-write secret scan via Phase 77 scanSecrets on the NEW nodes
 *      only (existing content is operator-curated, not under migrator scope).
 *   4. Serialize via doc.toString({ lineWidth: 0 }) — disables line wrapping
 *      so long op:// URLs don't get mid-string-broken.
 *   5. Atomic write: tmpPath = `.clawcode.yaml.<pid>.<ts>.tmp` in same dir,
 *      then fs.rename to dest. Rename is atomic on the same filesystem, so
 *      chokidar watchers see exactly 1 change event.
 *   6. On success: compute sha256 of written bytes, return for ledger
 *      witness.
 *   7. On failure at any step after tmp write: unlink tmp before re-throw.
 *
 * DO NOT:
 *   - Use writeFile to the dest directly — chokidar race + half-written state.
 *   - Use rename across filesystems — atomicity lost. Tmp MUST be in same dir.
 *   - Reorder top-level keys — operator key order is load-bearing UX.
 *   - Walk the ENTIRE existing doc for secrets — Phase 77 already validated
 *     the operator's existing file on previous load. Scan only the new
 *     agent subtree to avoid false positives on long op:// values.
 *   - Add new npm deps — parseDocument is in the yaml package (v2+, already
 *     in package.json via loader.ts usage).
 */
import { existsSync } from "node:fs";
import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { parseDocument, YAMLSeq, YAMLMap } from "yaml";
import type { MappedAgentNode, MapAgentWarning } from "./config-mapper.js";
import { scanSecrets } from "./guards.js";
import type { PlanReport, AgentPlan } from "./diff-builder.js";
import { modelSchema } from "../config/schema.js";

/**
 * Mutable fs-dispatch holder — the ESM-safe pattern used by
 * migrateOpenclawHandlers in the CLI layer. Tests monkey-patch properties
 * to intercept writeFile/rename/unlink without vi.spyOn against frozen
 * node:fs/promises exports. Exported for test visibility only; production
 * code must never mutate this.
 */
export const writerFs: {
  readFile: typeof readFile;
  writeFile: typeof writeFile;
  rename: typeof rename;
  unlink: typeof unlink;
} = { readFile, writeFile, rename, unlink };

export type WriteClawcodeYamlArgs = {
  readonly existingConfigPath: string;
  readonly agentsToInsert: readonly MappedAgentNode[];
  readonly modelMapWarnings: readonly MapAgentWarning[];
  /** DI for test determinism — defaults to ISO 'now'. */
  readonly ts?: () => string;
  /** DI for test determinism — defaults to process.pid. */
  readonly pid?: number;
};

export type WriteClawcodeYamlResult =
  | {
      readonly outcome: "written";
      readonly destPath: string;
      readonly targetSha256: string;
    }
  | {
      readonly outcome: "refused";
      readonly reason: string;
      readonly step: "secret" | "unmappable-model" | "file-not-found";
    };

export async function writeClawcodeYaml(
  args: WriteClawcodeYamlArgs,
): Promise<WriteClawcodeYamlResult> {
  const ts = args.ts ?? (() => new Date().toISOString());
  const pid = args.pid ?? process.pid;

  // --- Gate 1: unmappable-model ------------------------------------
  // Phase 78 CONF-03: apply refuses to land a YAML that points at an
  // unmappable model id. --model-map override resolves this by supplying
  // a mapping upstream (mapAgent emits no warning when the override hits).
  const unmappable = args.modelMapWarnings.find(
    (w) => w.kind === "unmappable-model",
  );
  if (unmappable !== undefined) {
    const id = "id" in unmappable ? unmappable.id : "(unknown)";
    return {
      outcome: "refused",
      reason: `unmappable model ${id} — pass --model-map override`,
      step: "unmappable-model",
    };
  }

  // --- Gate 2: existing-file presence ------------------------------
  // The migrator requires a baseline clawcode.yaml — operators curate the
  // top-level mcpServers/defaults/discord blocks before migrating. Creating
  // a file from scratch is out of scope for Phase 78.
  if (!existsSync(args.existingConfigPath)) {
    return {
      outcome: "refused",
      reason: `clawcode.yaml not found at ${args.existingConfigPath} — baseline required`,
      step: "file-not-found",
    };
  }

  // --- Read + parse (Document AST preserves comments + order) ------
  const existingText = await writerFs.readFile(
    args.existingConfigPath,
    "utf8",
  );
  const doc = parseDocument(existingText, { prettyErrors: true });

  // --- Gate 3: pre-write secret scan on NEW nodes only -------------
  // Scan only the OPERATOR-INPUT-ISH fields of each node: name / model /
  // channels[] / mcpServers[]. Path fields (workspace / memoryPath /
  // soulFile / identityFile) are absolute paths BUILT by mapAgent from
  // diff-builder's targetBasePath — they can't carry secrets (they're
  // path.join'd from the caller-injected agents root + slug). Including
  // them here would trip the Phase 77 high-entropy detector on
  // long absolute paths that include uppercase filename components
  // (SOUL.md / IDENTITY.md push a path into the 3-classes + length>=30 +
  // entropy>=4.0 bucket), a false-positive documented in STATE.md as a
  // "Phase 78+ concern". Known-secret prefix checks (sk- / MT-) still
  // run on every scalar we DO pass through — e.g., a rogue API key
  // inside channels[] is caught unchanged.
  const scanShim = args.agentsToInsert.map((n) => ({
    name: n.name,
    model: n.model,
    channels: n.channels,
    mcpServers: n.mcpServers,
  }));
  const shim: PlanReport = {
    agents: scanShim as unknown as readonly AgentPlan[],
    warnings: [],
    sourcePath: "",
    targetRoot: "",
    generatedAt: ts(),
    planHash: "",
  };
  const secret = scanSecrets({
    ts,
    report: shim,
    source_hash: "phase78-write",
  });
  if (!secret.pass) {
    return {
      outcome: "refused",
      reason: secret.message,
      step: "secret",
    };
  }

  // --- Insert agents ----------------------------------------------
  const contents = doc.contents;
  if (!(contents instanceof YAMLMap)) {
    throw new Error(
      `clawcode.yaml top-level is not a map: ${args.existingConfigPath}`,
    );
  }
  // YAMLMap.Parsed is typed with ParsedNode generics from the yaml package,
  // which don't accept our plain-string keys or freshly-constructed YAMLSeq
  // children. Cast once to a permissive shape — the yaml lib accepts any
  // key/value at runtime, and Document.createNode normalizes the insertion.
  const rootMap = contents as unknown as YAMLMap<unknown, unknown>;
  let agentsSeq = rootMap.get("agents") as unknown;
  if (!(agentsSeq instanceof YAMLSeq)) {
    const newSeq = new YAMLSeq();
    rootMap.set("agents", newSeq);
    agentsSeq = newSeq;
  }
  for (const agent of args.agentsToInsert) {
    // Build a YAML map for the new agent. doc.createNode round-trips
    // through the schema so our TS object lands as an ordered YAMLMap.
    // Omit undefined fields (memoryPath is absent on dedicated agents).
    const raw: Record<string, unknown> = {
      name: agent.name,
      workspace: agent.workspace,
      soulFile: agent.soulFile,
      identityFile: agent.identityFile,
      model: agent.model,
      channels: [...agent.channels],
      mcpServers: [...agent.mcpServers],
    };
    if (agent.memoryPath !== undefined) raw.memoryPath = agent.memoryPath;
    (agentsSeq as YAMLSeq).add(doc.createNode(raw));
  }

  // --- Serialize with no line-wrap (long op:// URLs must stay intact) --
  const newText = doc.toString({ lineWidth: 0 });

  // --- Atomic temp+rename ----------------------------------------
  const destDir = dirname(args.existingConfigPath);
  const tmpPath = join(
    destDir,
    `.clawcode.yaml.${pid}.${Date.now()}.tmp`,
  );
  await writerFs.writeFile(tmpPath, newText, "utf8");
  try {
    await writerFs.rename(tmpPath, args.existingConfigPath);
  } catch (err) {
    try {
      await writerFs.unlink(tmpPath);
    } catch {
      // already gone or never created — best-effort cleanup
    }
    throw err;
  }

  const targetSha256 = createHash("sha256")
    .update(newText, "utf8")
    .digest("hex");
  return {
    outcome: "written",
    destPath: args.existingConfigPath,
    targetSha256,
  };
}

// ---------------------------------------------------------------------------
// Phase 81 Plan 01 — removeAgentFromConfig.
//
// Mirror-image of writeClawcodeYaml. Removes one agent entry from the
// `agents:` seq (by name), preserves every other node + comment via the
// Document AST, and writes back via the same atomic temp+rename pattern.
//
// Contract:
//   - outcome: "removed" — agent was present and is now gone
//   - outcome: "not-found" — clawcode.yaml exists, file is valid, agent is
//       NOT in the seq; file bytes unchanged; no rename fires
//   - outcome: "file-not-found" — clawcode.yaml does not exist at path;
//       no side effects
//   - throws — rename failure (tmp unlinked, error re-thrown); yaml
//       top-level not a map (structural corruption — operator must fix)
//
// DO NOT:
//   - Re-run the Phase 78 secret scan — we are REMOVING nodes, not inserting
//     new operator-input-ish scalars. Existing nodes were already validated
//     when they landed via writeClawcodeYaml.
//   - Trigger the Phase 78 unmappable-model gate — same rationale.
//   - Reorder surviving agents — splice preserves order.
// ---------------------------------------------------------------------------

export type RemoveAgentFromConfigArgs = Readonly<{
  existingConfigPath: string;
  agentName: string;
  /** DI for test determinism — unused currently but mirrors writer shape. */
  ts?: () => string;
  /** DI for test determinism — defaults to process.pid. */
  pid?: number;
}>;

export type RemoveAgentFromConfigResult =
  | {
      readonly outcome: "removed";
      readonly destPath: string;
      readonly targetSha256: string;
    }
  | { readonly outcome: "not-found"; readonly reason: string }
  | { readonly outcome: "file-not-found"; readonly reason: string };

export async function removeAgentFromConfig(
  args: RemoveAgentFromConfigArgs,
): Promise<RemoveAgentFromConfigResult> {
  const pid = args.pid ?? process.pid;

  if (!existsSync(args.existingConfigPath)) {
    return {
      outcome: "file-not-found",
      reason: `clawcode.yaml not found at ${args.existingConfigPath}`,
    };
  }

  const existingText = await writerFs.readFile(
    args.existingConfigPath,
    "utf8",
  );
  const doc = parseDocument(existingText, { prettyErrors: true });
  const contents = doc.contents;
  if (!(contents instanceof YAMLMap)) {
    throw new Error(
      `clawcode.yaml top-level is not a map: ${args.existingConfigPath}`,
    );
  }
  const rootMap = contents as unknown as YAMLMap<unknown, unknown>;
  const agentsSeq = rootMap.get("agents") as unknown;
  if (!(agentsSeq instanceof YAMLSeq)) {
    return {
      outcome: "not-found",
      reason: `no agents seq in clawcode.yaml`,
    };
  }
  // Items is the YAMLSeq's internal ordered array. Splicing is safe because
  // parseDocument returned an owned Document instance — this is the ONLY
  // reference to the seq, so a positional splice removes exactly one agent
  // without aliasing surprises.
  const items = (agentsSeq as YAMLSeq).items as unknown as Array<unknown>;
  const idx = items.findIndex((it) => {
    if (it === null || typeof it !== "object") return false;
    const maybeMap = it as { get?: (k: string) => unknown };
    if (typeof maybeMap.get !== "function") return false;
    const name = maybeMap.get("name");
    return name === args.agentName;
  });
  if (idx < 0) {
    return {
      outcome: "not-found",
      reason: `agent '${args.agentName}' not in agents seq`,
    };
  }
  items.splice(idx, 1);

  const newText = doc.toString({ lineWidth: 0 });

  // Atomic temp+rename — identical pattern to writeClawcodeYaml. Same-dir
  // tmp preserves filesystem atomicity on rename.
  const destDir = dirname(args.existingConfigPath);
  const tmpPath = join(
    destDir,
    `.clawcode.yaml.${pid}.${Date.now()}.tmp`,
  );
  await writerFs.writeFile(tmpPath, newText, "utf8");
  try {
    await writerFs.rename(tmpPath, args.existingConfigPath);
  } catch (err) {
    try {
      await writerFs.unlink(tmpPath);
    } catch {
      // already gone or never created — best-effort cleanup
    }
    throw err;
  }

  const targetSha256 = createHash("sha256")
    .update(newText, "utf8")
    .digest("hex");
  return {
    outcome: "removed",
    destPath: args.existingConfigPath,
    targetSha256,
  };
}

// ---------------------------------------------------------------------------
// Phase 86 Plan 02 MODEL-04 — updateAgentModel.
//
// Rewrites ONE agent's `model:` scalar in-place using the same
// parseDocument → mutate → atomic temp+rename pipeline as
// writeClawcodeYaml / removeAgentFromConfig. The daemon IPC set-model
// handler calls this AFTER the live SDK swap succeeds so the change
// survives a daemon restart.
//
// Contract:
//   outcome: "updated"        — agent found, model changed, file rewritten
//   outcome: "no-op"          — agent found, model already equals newModel, zero writes
//   outcome: "not-found"      — clawcode.yaml valid but agent missing from agents: seq
//   outcome: "file-not-found" — clawcode.yaml does not exist
//   outcome: "refused"        — newModel not in modelSchema enum (defense-in-depth)
//   throws                    — rename failure (tmp unlinked), structural YAML corruption
//
// DO NOT:
//   - Re-run the Phase 78 secret scan — we're rewriting ONE scalar, not
//     inserting new operator-input-ish fields. Secret scan scope stays
//     on net-new agent inserts per yaml-writer.ts policy.
//   - Re-run the unmappable-model gate — newModel is always a valid
//     modelSchema alias by this point (daemon validates; self-guard below
//     via modelSchema.safeParse as defense-in-depth).
//   - Trigger a chokidar reload side-effect — `agents.*.model` is
//     NON_RELOADABLE (types.ts); the live swap is owned by Plan 01's
//     SessionHandle.setModel, persistence is for the next boot only.
// ---------------------------------------------------------------------------

export type UpdateAgentModelArgs = Readonly<{
  existingConfigPath: string;
  agentName: string;
  /** Validated against modelSchema inside; string at boundary for caller ergonomics. */
  newModel: string;
  /** DI for test determinism — defaults to process.pid. */
  pid?: number;
}>;

export type UpdateAgentModelResult =
  | {
      readonly outcome: "updated";
      readonly destPath: string;
      readonly targetSha256: string;
    }
  | { readonly outcome: "no-op"; readonly reason: string }
  | { readonly outcome: "not-found"; readonly reason: string }
  | { readonly outcome: "file-not-found"; readonly reason: string }
  | {
      readonly outcome: "refused";
      readonly reason: string;
      readonly step: "invalid-model";
    };

export async function updateAgentModel(
  args: UpdateAgentModelArgs,
): Promise<UpdateAgentModelResult> {
  const pid = args.pid ?? process.pid;

  // --- Gate: defense-in-depth modelSchema validation ----------------
  // Daemon validates modelParam before calling into here, but a future
  // caller could slip through with an invalid alias. Self-guard keeps
  // the contract honest and the error path typed.
  const parsed = modelSchema.safeParse(args.newModel);
  if (!parsed.success) {
    return {
      outcome: "refused",
      reason: `Invalid model '${args.newModel}'. Must be one of: haiku, sonnet, opus`,
      step: "invalid-model",
    };
  }
  const validatedModel = parsed.data;

  // --- Gate: file presence ------------------------------------------
  if (!existsSync(args.existingConfigPath)) {
    return {
      outcome: "file-not-found",
      reason: `clawcode.yaml not found at ${args.existingConfigPath}`,
    };
  }

  // --- Read + parse (Document AST preserves comments + order) ------
  const existingText = await writerFs.readFile(
    args.existingConfigPath,
    "utf8",
  );
  const doc = parseDocument(existingText, { prettyErrors: true });
  const contents = doc.contents;
  if (!(contents instanceof YAMLMap)) {
    throw new Error(
      `clawcode.yaml top-level is not a map: ${args.existingConfigPath}`,
    );
  }
  const rootMap = contents as unknown as YAMLMap<unknown, unknown>;
  const agentsSeq = rootMap.get("agents") as unknown;
  if (!(agentsSeq instanceof YAMLSeq)) {
    return {
      outcome: "not-found",
      reason: `no agents seq in clawcode.yaml`,
    };
  }
  const items = (agentsSeq as YAMLSeq).items as unknown as Array<unknown>;
  const idx = items.findIndex((it) => {
    if (it === null || typeof it !== "object") return false;
    const maybeMap = it as { get?: (k: string) => unknown };
    if (typeof maybeMap.get !== "function") return false;
    const name = maybeMap.get("name");
    return name === args.agentName;
  });
  if (idx < 0) {
    return {
      outcome: "not-found",
      reason: `agent '${args.agentName}' not in agents seq`,
    };
  }

  const agentMap = items[idx] as {
    get?: (k: string) => unknown;
    set?: (k: string, v: unknown) => void;
  };
  if (
    typeof agentMap.get !== "function" ||
    typeof agentMap.set !== "function"
  ) {
    throw new Error(
      `agent '${args.agentName}' entry is not a map at agents[${idx}]`,
    );
  }

  // --- Idempotency: no-op when already at target model --------------
  const currentModel = agentMap.get("model");
  if (currentModel === validatedModel) {
    return {
      outcome: "no-op",
      reason: `agent '${args.agentName}' model already ${validatedModel}`,
    };
  }

  // --- Mutate ONE scalar (preserves all sibling fields + comments) --
  agentMap.set("model", validatedModel);

  // --- Serialize with no line-wrap ---------------------------------
  const newText = doc.toString({ lineWidth: 0 });

  // --- Atomic temp+rename — identical pattern to writeClawcodeYaml -
  const destDir = dirname(args.existingConfigPath);
  const tmpPath = join(
    destDir,
    `.clawcode.yaml.${pid}.${Date.now()}.tmp`,
  );
  await writerFs.writeFile(tmpPath, newText, "utf8");
  try {
    await writerFs.rename(tmpPath, args.existingConfigPath);
  } catch (err) {
    try {
      await writerFs.unlink(tmpPath);
    } catch {
      // best-effort — tmp may already be gone
    }
    throw err;
  }

  const targetSha256 = createHash("sha256")
    .update(newText, "utf8")
    .digest("hex");
  return {
    outcome: "updated",
    destPath: args.existingConfigPath,
    targetSha256,
  };
}

// ---------------------------------------------------------------------------
// Phase 88 Plan 01 Task 2 — updateAgentSkills.
//
// Atomic append/remove of a skill name on `agents[*].skills`. Mirrors the
// `updateAgentModel` structural template verbatim (parseDocument → find-
// by-name → YAMLSeq mutate → toString({lineWidth:0}) → tmp+rename →
// sha256 witness). The Phase 88 `installSingleSkill` consumer calls this
// AFTER the copier succeeds so the skill appears in the agent's
// `skills:` list on the next daemon boot. Non-rollback policy matches
// the Phase 86 MODEL-04 contract: copy is the irreversible downstream
// effect; YAML persist failure surfaces as persist_error to the caller.
//
// Contract (outcome matrix):
//   "updated"        — skill appended/removed; file rewritten
//   "no-op"          — idempotent (add on present, remove on absent)
//   "not-found"      — clawcode.yaml valid but agent missing from seq
//   "file-not-found" — clawcode.yaml does not exist
//   throws           — rename failure (tmp unlinked), structural YAML corruption
//
// DO NOT:
//   - Validate skillName against any catalog here — the caller (install-
//     single-skill.ts) owns catalog resolution. Writer treats skillName
//     as an opaque string (keeps cross-module coupling narrow).
//   - Re-run the secret scan — rewriting ONE string node (not inserting
//     operator-input YAML), same rationale as updateAgentModel.
// ---------------------------------------------------------------------------

export type UpdateAgentSkillsArgs = Readonly<{
  existingConfigPath: string;
  agentName: string;
  skillName: string;
  op: "add" | "remove";
  /** DI for test determinism — defaults to process.pid. */
  pid?: number;
}>;

export type UpdateAgentSkillsResult =
  | {
      readonly outcome: "updated";
      readonly destPath: string;
      readonly targetSha256: string;
    }
  | { readonly outcome: "no-op"; readonly reason: string }
  | { readonly outcome: "not-found"; readonly reason: string }
  | { readonly outcome: "file-not-found"; readonly reason: string };

export async function updateAgentSkills(
  args: UpdateAgentSkillsArgs,
): Promise<UpdateAgentSkillsResult> {
  const pid = args.pid ?? process.pid;

  // --- Gate: file presence ------------------------------------------
  if (!existsSync(args.existingConfigPath)) {
    return {
      outcome: "file-not-found",
      reason: `clawcode.yaml not found at ${args.existingConfigPath}`,
    };
  }

  // --- Read + parse (Document AST preserves comments + order) ------
  const existingText = await writerFs.readFile(
    args.existingConfigPath,
    "utf8",
  );
  const doc = parseDocument(existingText, { prettyErrors: true });
  const contents = doc.contents;
  if (!(contents instanceof YAMLMap)) {
    throw new Error(
      `clawcode.yaml top-level is not a map: ${args.existingConfigPath}`,
    );
  }
  const rootMap = contents as unknown as YAMLMap<unknown, unknown>;
  const agentsSeq = rootMap.get("agents") as unknown;
  if (!(agentsSeq instanceof YAMLSeq)) {
    return {
      outcome: "not-found",
      reason: `no agents seq in clawcode.yaml`,
    };
  }
  const items = (agentsSeq as YAMLSeq).items as unknown as Array<unknown>;
  const idx = items.findIndex((it) => {
    if (it === null || typeof it !== "object") return false;
    const maybeMap = it as { get?: (k: string) => unknown };
    if (typeof maybeMap.get !== "function") return false;
    const name = maybeMap.get("name");
    return name === args.agentName;
  });
  if (idx < 0) {
    return {
      outcome: "not-found",
      reason: `agent '${args.agentName}' not in agents seq`,
    };
  }

  const agentMap = items[idx] as {
    get?: (k: string) => unknown;
    set?: (k: string, v: unknown) => void;
  };
  if (
    typeof agentMap.get !== "function" ||
    typeof agentMap.set !== "function"
  ) {
    throw new Error(
      `agent '${args.agentName}' entry is not a map at agents[${idx}]`,
    );
  }

  // --- Locate or initialize the agent's skills: seq ----------------
  let skillsSeq = agentMap.get("skills");
  if (!(skillsSeq instanceof YAMLSeq)) {
    // Either missing or a scalar (unusual — would fail configSchema, but
    // defensive). Initialize to an empty seq so the mutation below works.
    skillsSeq = new YAMLSeq();
    agentMap.set("skills", skillsSeq);
  }
  const seq = skillsSeq as YAMLSeq;

  // Snapshot the current skill names (extract scalar values from seq items).
  const seqItems = seq.items as unknown as Array<unknown>;
  const currentSkills = seqItems.map((node) => {
    // node may be a Scalar (has .value) or a bare string (older yaml stream shape).
    if (node !== null && typeof node === "object") {
      const maybe = node as { value?: unknown };
      if ("value" in maybe) return String(maybe.value);
    }
    return String(node);
  });

  // --- Idempotency gate ---------------------------------------------
  const alreadyPresent = currentSkills.includes(args.skillName);
  if (args.op === "add" && alreadyPresent) {
    return {
      outcome: "no-op",
      reason: `agent '${args.agentName}' skill '${args.skillName}' already present`,
    };
  }
  if (args.op === "remove" && !alreadyPresent) {
    return {
      outcome: "no-op",
      reason: `agent '${args.agentName}' skill '${args.skillName}' not in list`,
    };
  }

  // --- Mutate -------------------------------------------------------
  if (args.op === "add") {
    seq.add(args.skillName);
  } else {
    // remove: find and splice. Matches on the scalar value.
    const removeIdx = currentSkills.indexOf(args.skillName);
    if (removeIdx >= 0) {
      seqItems.splice(removeIdx, 1);
    }
  }

  // --- Serialize with no line-wrap ---------------------------------
  const newText = doc.toString({ lineWidth: 0 });

  // --- Atomic temp+rename ------------------------------------------
  const destDir = dirname(args.existingConfigPath);
  const tmpPath = join(
    destDir,
    `.clawcode.yaml.${pid}.${Date.now()}.tmp`,
  );
  await writerFs.writeFile(tmpPath, newText, "utf8");
  try {
    await writerFs.rename(tmpPath, args.existingConfigPath);
  } catch (err) {
    try {
      await writerFs.unlink(tmpPath);
    } catch {
      // best-effort — tmp may already be gone
    }
    throw err;
  }

  const targetSha256 = createHash("sha256")
    .update(newText, "utf8")
    .digest("hex");
  return {
    outcome: "updated",
    destPath: args.existingConfigPath,
    targetSha256,
  };
}
