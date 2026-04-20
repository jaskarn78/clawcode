/**
 * Phase 77 pre-flight guards. Four pure / near-pure helpers that each return
 * a GuardResult — the apply-preflight orchestrator (apply-preflight.ts) runs
 * them in order and decides how to surface the outcome.
 *
 * Guard execution order (fail-fast sequential, enforced in the orchestrator):
 *   1. checkDaemonRunning     — fastest fail; refuse if systemd says `active`
 *   2. assertReadOnlySource   — helper invoked from the fs-write interceptor
 *   3. scanSecrets            — walks the proposed PlanReport for secret-shaped strings
 *   4. detectChannelCollisions — intersects OpenClaw bindings vs existing clawcode.yaml
 *
 * DO NOT:
 *   - Add side-effects (writeFile, mkdir, db writes) — guards are read-side-only.
 *     Ledger writes happen in the orchestrator.
 *   - Reorder or alter the literal error-message constants — DAEMON_REFUSE_MESSAGE
 *     and SECRET_REFUSE_MESSAGE are pinned by phase success criteria 1 & 2.
 *   - Mutate any input — everything is readonly by convention.
 *   - Log to console — callers decide what to render.
 *   - Hardcode paths — every path is injected; tests use tmpdir fixtures.
 *   - Introduce execa — zero new npm deps. Default `execaRunner` DI wraps
 *     `node:child_process.execFile`, which is already shipped with Node.
 */
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { resolve, sep } from "node:path";
import { loadConfig } from "../config/loader.js";
import { ConfigFileNotFoundError } from "../shared/errors.js";
import type { LedgerRow } from "./ledger.js";
import type { OpenclawSourceInventory } from "./openclaw-config-reader.js";
import type { PlanReport } from "./diff-builder.js";

// ---- Literal strings (EXACT copy — success criteria #1, #2) ---------
// These strings are load-bearing for phase acceptance. Every char counts —
// including the non-ASCII em-dash in SECRET_REFUSE_MESSAGE. Any drift breaks
// the verification grep at 77-02-PLAN.md line 870-872.
export const DAEMON_REFUSE_MESSAGE =
  "OpenClaw daemon is running. Run 'systemctl --user stop openclaw-gateway' first, then re-run the migration.";
export const SECRET_REFUSE_MESSAGE =
  "refused to write raw secret-shaped value to clawcode.yaml — use op:// reference or whitelist the value";
export const SYSTEMD_FALLBACK_MESSAGE =
  "daemon check requires systemd (Linux). Skipping — pass --force-no-daemon-check to override on non-systemd hosts.";

// ---- Regexes (from 77-CONTEXT; executor MUST NOT alter) -------------
const SK_PREFIX = /^sk-[A-Za-z0-9_\-]{20,}$/;
const DISCORD_PREFIX = /^MT[A-Za-z0-9._\-]{20,}/;
const OP_REF = /^op:\/\//;
const NUMERIC_ONLY = /^[0-9]+$/;
const SHORT_IDENT = /^[a-z0-9\-]+$/;
const SHORT_IDENT_MAX = 40;
const HIGH_ENTROPY_MIN_LEN = 30;
const HIGH_ENTROPY_MIN_CLASSES = 3;
const HIGH_ENTROPY_MIN_BITS = 4.0;
// Phase 78 Plan 03 additive whitelists — closes the STATE.md Phase 78+ concern:
// "Static /tmp/cc-agents path... trips scanSecrets high-entropy threshold on
//  targetBasePath (real production concern for Phase 78+)". Both patterns
// run AFTER hasSecretPrefix (sk-/MT-) so a literal secret embedded inside a
// path-like or model-id-like string would still refuse.
// Absolute filesystem path: starts with `/` or `~/` (POSIX — Windows paths
// are NFR since ClawCode is Linux-only per stack notes).
const ABSOLUTE_PATH_PREFIX = /^(?:\/|~\/)/;
// OpenClaw model id: `<provider>/<name>` where both sides are lowercase
// alphanumeric-with-hyphens/dots (e.g. "anthropic-api/claude-sonnet-4-6",
// "minimax/abab6.5"). Capped at 80 chars — real ids are < 50.
const MODEL_ID_SHAPE = /^[a-z0-9][a-z0-9.\-]*\/[a-z0-9][a-z0-9.\-]*$/;
const MODEL_ID_MAX = 80;

// ---- Public types ---------------------------------------------------

/**
 * Standard result shape returned by every guard. `pass:false` means "refuse
 * the migration" — the orchestrator appends `ledgerRow` and short-circuits.
 * `reportBody` is optional multiline text for collision/secret diagnostics
 * that operators need to read verbatim (aligned-column tables, key paths).
 */
export type GuardResult = {
  readonly pass: boolean;
  readonly message: string;
  readonly ledgerRow: LedgerRow;
  readonly reportBody?: string;
};

/**
 * Thrown by assertReadOnlySource when a write target resolves under
 * `~/.openclaw/`. Carries the resolved path so the fs-interceptor (Plan 03)
 * can record it in a ledger witness row before bubbling to the CLI.
 */
export class ReadOnlySourceError extends Error {
  readonly attemptedPath: string;
  constructor(attemptedPath: string) {
    super(`migrator refused write under ~/.openclaw/: ${attemptedPath}`);
    this.name = "ReadOnlySourceError";
    this.attemptedPath = attemptedPath;
  }
}

// ---- Guard 1: daemon --------------------------------------------------

/**
 * Default runner around `node:child_process.execFile`. Wrapped in a promise
 * that resolves with stdout + exitCode, matching the execa-ish shape the
 * guards expect. We catch `err.stdout` on non-zero exits (systemctl exits
 * non-zero for inactive/failed, but still prints the status word to stdout)
 * so the guard reads the status regardless of exit code.
 *
 * `reject` only fires when systemctl itself can't be invoked (ENOENT, EACCES)
 * — that path is the non-systemd fallback arm below.
 */
const defaultRunner = (
  cmd: string,
  args: string[],
): Promise<{ stdout: string; exitCode: number | null }> =>
  new Promise((resolvePromise, rejectPromise) => {
    execFile(cmd, args, (err, stdout) => {
      if (err && (err as NodeJS.ErrnoException).code === "ENOENT") {
        rejectPromise(err);
        return;
      }
      if (err && typeof (err as unknown as { code?: number }).code === "number") {
        // Non-zero exit — resolve with the stdout we got (is-active prints
        // "inactive"/"failed" on exit code 3).
        resolvePromise({
          stdout: String(stdout ?? ""),
          exitCode: (err as unknown as { code: number }).code,
        });
        return;
      }
      if (err) {
        rejectPromise(err);
        return;
      }
      resolvePromise({ stdout: String(stdout ?? ""), exitCode: 0 });
    });
  });

export async function checkDaemonRunning(opts: {
  ts: () => string;
  agent: string;
  source_hash: string;
  execaRunner?: (cmd: string, args: string[]) => Promise<{ stdout: string; exitCode: number | null }>;
}): Promise<GuardResult> {
  const runner = opts.execaRunner ?? defaultRunner;
  let stdout = "";
  try {
    const result = await runner("systemctl", [
      "--user",
      "is-active",
      "openclaw-gateway.service",
    ]);
    stdout = (result.stdout ?? "").trim();
  } catch (err) {
    // systemctl not on PATH / ENOENT (non-Linux or non-systemd host).
    // Refuse with actionable fallback message so the operator knows the
    // escape hatch exists. No `--force-no-daemon-check` flag is wired
    // in this phase — Plan 03 exposes that if needed.
    return {
      pass: false,
      message: SYSTEMD_FALLBACK_MESSAGE,
      ledgerRow: {
        ts: opts.ts(),
        action: "apply",
        agent: opts.agent,
        status: "pending",
        source_hash: opts.source_hash,
        step: "pre-flight:daemon",
        outcome: "refuse",
        notes: `systemctl invocation failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }

  if (stdout === "active") {
    return {
      pass: false,
      message: DAEMON_REFUSE_MESSAGE,
      ledgerRow: {
        ts: opts.ts(),
        action: "apply",
        agent: opts.agent,
        status: "pending",
        source_hash: opts.source_hash,
        step: "pre-flight:daemon",
        outcome: "refuse",
        notes: "systemctl --user is-active openclaw-gateway.service == active",
      },
    };
  }

  return {
    pass: true,
    message: `daemon is ${stdout || "unknown"}`,
    ledgerRow: {
      ts: opts.ts(),
      action: "apply",
      agent: opts.agent,
      status: "pending",
      source_hash: opts.source_hash,
      step: "pre-flight:daemon",
      outcome: "allow",
      notes: `systemctl --user is-active openclaw-gateway.service == ${stdout || "unknown"}`,
    },
  };
}

// ---- Guard 2: read-only source (helper invoked from fs-write interceptor) ----

/**
 * Throws `ReadOnlySourceError` if `targetPath` resolves under `~/.openclaw/`.
 * Plan 03 wraps fs.writeFile / appendFile / mkdir with a call to this helper
 * — every write attempt into the source system bubbles a ReadOnlySourceError
 * through the CLI.
 *
 * Similar-prefix paths like `~/.openclaw-backup/foo` are NOT under the ban;
 * the check uses `startsWith(forbidden + sep)` and an exact-equality branch.
 */
export function assertReadOnlySource(targetPath: string): void {
  const resolved = resolve(targetPath);
  const forbidden = resolve(homedir(), ".openclaw");
  if (resolved === forbidden || resolved.startsWith(forbidden + sep)) {
    throw new ReadOnlySourceError(resolved);
  }
}

// ---- Guard 3: secret scan -------------------------------------------

/**
 * Standard Shannon entropy in bits/char. Pure helper exported for tests
 * to pin the canonical formula (`-Σ p_i * log2(p_i)` over unique char
 * frequencies). Returns 0 for empty / single-class strings.
 */
export function computeShannonEntropy(s: string): number {
  if (s.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const c of counts.values()) {
    const p = c / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

function characterClasses(s: string): number {
  let n = 0;
  if (/[a-z]/.test(s)) n++;
  if (/[A-Z]/.test(s)) n++;
  if (/[0-9]/.test(s)) n++;
  if (/[^A-Za-z0-9]/.test(s)) n++;
  return n;
}

/**
 * Whitelist — explicit "this is not a secret" shapes. Order matters: OP_REF
 * first (cheapest test), then numeric-only (channel IDs, Unix timestamps),
 * then the short-identifier regex (MCP server names, agent ids), then the
 * Phase 78 additions (absolute POSIX paths, OpenClaw model ids).
 *
 * CRITICAL: This runs AFTER hasSecretPrefix (sk-/MT-), so an API key that
 * happens to be embedded inside a path-shaped string would still refuse —
 * the prefix check short-circuits before whitelist evaluation.
 */
function isWhitelisted(s: string): boolean {
  if (s === "") return true;
  if (OP_REF.test(s)) return true;
  if (NUMERIC_ONLY.test(s)) return true;
  if (SHORT_IDENT.test(s) && s.length <= SHORT_IDENT_MAX) return true;
  // Phase 78 Plan 03 — absolute POSIX filesystem paths are migrator-
  // generated (diff-builder.getTargetBasePath + path.join) and never
  // contain secrets. Long paths with uppercase filename components
  // (SOUL.md / IDENTITY.md) push entropy over threshold, so an explicit
  // path whitelist is needed to use scanSecrets on MappedAgentNode data.
  if (ABSOLUTE_PATH_PREFIX.test(s)) return true;
  // Phase 78 Plan 03 — OpenClaw model ids (<provider>/<name>) are shipped
  // verbatim from openclaw.json; real values like
  // "anthropic-api/claude-sonnet-4-6" are multi-class + length>=30 +
  // entropy>=4.0. They are not secrets and must pass cleanly so the
  // migration pre-flight doesn't refuse every on-box agent.
  if (MODEL_ID_SHAPE.test(s) && s.length <= MODEL_ID_MAX) return true;
  return false;
}

/**
 * Explicit known-secret prefix detector — these must ALWAYS refuse, even if
 * the string would otherwise match a whitelist (e.g., `sk-...` satisfies
 * SHORT_IDENT since it's all lowercase + digits + hyphens).
 */
function hasSecretPrefix(s: string): boolean {
  if (SK_PREFIX.test(s)) return true;
  if (DISCORD_PREFIX.test(s)) return true;
  return false;
}

/**
 * High-entropy secret fallback. Only evaluated after whitelist — an op://
 * 1Password reference is long + multi-class + high-entropy but is the
 * canonical allowed shape for credentials and must pass.
 */
function isHighEntropySecret(s: string): boolean {
  return (
    s.length >= HIGH_ENTROPY_MIN_LEN &&
    characterClasses(s) >= HIGH_ENTROPY_MIN_CLASSES &&
    computeShannonEntropy(s) >= HIGH_ENTROPY_MIN_BITS
  );
}

/**
 * BFS walker over the PlanReport tree. First secret-shaped match wins
 * (fail-fast). Returns the key path (e.g., `agents[1].sourceModel`) so the
 * ledger row's `notes` field can point an operator directly at the offender.
 *
 * Whitelisted strings (empty, op://, numeric-only, short-ident) are skipped
 * silently — they are valid YAML values and must pass through unflagged.
 *
 * `undefined` / `null` / non-string primitives short-circuit; only strings,
 * arrays, and plain objects are walked. (The PlanReport shape has no Map /
 * Set / Date so this is safe.)
 */
function walkForSecrets(root: unknown): { path: string } | undefined {
  const queue: Array<{ value: unknown; path: string }> = [
    { value: root, path: "" },
  ];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const { value, path } = current;
    if (value === null || value === undefined) continue;
    if (typeof value === "string") {
      // Three-phase classification:
      //   1. Explicit known-secret prefixes (sk-/MT-) ALWAYS refuse — these
      //      tokens look superficially like SHORT_IDENT (all [a-z0-9-]) so
      //      a naive whitelist-first check would silently pass them.
      //   2. Whitelist (op://, numeric-only, SHORT_IDENT) passes silently —
      //      canonical non-secret shapes including 1Password refs which are
      //      long and high-entropy but the only permitted way to ship a
      //      credential reference in clawcode.yaml.
      //   3. High-entropy fallback catches anything left that looks random.
      if (hasSecretPrefix(value)) return { path: path || "(root)" };
      if (isWhitelisted(value)) continue;
      if (isHighEntropySecret(value)) return { path: path || "(root)" };
      continue;
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        queue.push({ value: value[i], path: `${path}[${i}]` });
      }
      continue;
    }
    if (typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        queue.push({ value: v, path: path ? `${path}.${k}` : k });
      }
    }
  }
  return undefined;
}

export function scanSecrets(opts: {
  ts: () => string;
  report: PlanReport;
  source_hash: string;
}): GuardResult {
  // Walk the `agents` slice only — generatedAt/planHash/sourcePath/targetRoot
  // are computed by trusted code, not operator-authored. Walking them would
  // produce false positives on opaque hash prefixes.
  const offender = walkForSecrets({ agents: opts.report.agents });
  if (offender !== undefined) {
    return {
      pass: false,
      message: SECRET_REFUSE_MESSAGE,
      ledgerRow: {
        ts: opts.ts(),
        action: "apply",
        agent: "ALL",
        status: "pending",
        source_hash: opts.source_hash,
        step: "pre-flight:secret",
        outcome: "refuse",
        notes: `secret-shaped at ${offender.path}`,
      },
    };
  }
  return {
    pass: true,
    message: "no secret-shaped values in proposed config",
    ledgerRow: {
      ts: opts.ts(),
      action: "apply",
      agent: "ALL",
      status: "pending",
      source_hash: opts.source_hash,
      step: "pre-flight:secret",
      outcome: "allow",
    },
  };
}

// ---- Guard 4: channel collision -------------------------------------

/**
 * Reads the user's current `clawcode.yaml`, extracts every channel-id across
 * every agent, and intersects with OpenClaw's channel-kind bindings. On any
 * collision, returns `pass: false` with an aligned-column report body the
 * CLI prints verbatim. Missing-file is tolerated (zero possible collisions).
 *
 * `filter` narrows the OpenClaw side to a single agent's bindings — matches
 * the `--only <agent>` CLI flag from 77-CONTEXT.
 */
export async function detectChannelCollisions(opts: {
  ts: () => string;
  inventory: OpenclawSourceInventory;
  existingConfigPath: string;
  source_hash: string;
  filter?: string;
}): Promise<GuardResult> {
  let existing: Awaited<ReturnType<typeof loadConfig>>;
  try {
    existing = await loadConfig(opts.existingConfigPath);
  } catch (err) {
    if (err instanceof ConfigFileNotFoundError) {
      return {
        pass: true,
        message: "no existing clawcode.yaml — zero collisions possible",
        ledgerRow: {
          ts: opts.ts(),
          action: "apply",
          agent: opts.filter ?? "ALL",
          status: "pending",
          source_hash: opts.source_hash,
          step: "pre-flight:channel",
          outcome: "allow",
          notes: `no existing clawcode.yaml at ${opts.existingConfigPath}`,
        },
      };
    }
    throw err;
  }

  // Flatten clawcode-side channels into (targetAgent, channelId) pairs.
  type ClawcodeChannel = { readonly targetAgent: string; readonly channelId: string };
  const clawChannels: ClawcodeChannel[] = [];
  for (const a of existing.agents) {
    for (const chId of a.channels ?? []) {
      clawChannels.push({ targetAgent: a.name, channelId: chId });
    }
  }

  // OpenClaw side — only channel-kind peers contribute; filter by --only if set.
  const openclawChannels: ReadonlyArray<{
    sourceAgent: string;
    channelId: string;
  }> = opts.inventory.bindings
    .filter((b) => b.match.peer.kind === "channel")
    .filter((b) => opts.filter === undefined || b.agentId === opts.filter)
    .map((b) => ({ sourceAgent: b.agentId, channelId: b.match.peer.id }));

  // Intersect on channelId. First matching clawcode entry wins per channel —
  // enough for operator action (they unbind the OpenClaw side once).
  type Collision = {
    readonly sourceAgent: string;
    readonly targetAgent: string;
    readonly channelId: string;
  };
  const clawById = new Map<string, ClawcodeChannel>();
  for (const c of clawChannels) clawById.set(c.channelId, c);
  const collisions: Collision[] = [];
  for (const src of openclawChannels) {
    const match = clawById.get(src.channelId);
    if (match) {
      collisions.push({
        sourceAgent: src.sourceAgent,
        targetAgent: match.targetAgent,
        channelId: src.channelId,
      });
    }
  }

  if (collisions.length === 0) {
    const msg = `0 collisions across ${openclawChannels.length} OpenClaw channels vs ${clawChannels.length} ClawCode channels`;
    return {
      pass: true,
      message: msg,
      ledgerRow: {
        ts: opts.ts(),
        action: "apply",
        agent: opts.filter ?? "ALL",
        status: "pending",
        source_hash: opts.source_hash,
        step: "pre-flight:channel",
        outcome: "allow",
        notes: msg,
      },
    };
  }

  // Aligned-column report. Widths include the header labels so the underline
  // matches even when every collision row is shorter than the header.
  const srcHeader = "Source agent (OpenClaw)";
  const tgtHeader = "Target agent (ClawCode)";
  const chHeader = "Channel ID";
  const srcW = Math.max(srcHeader.length, ...collisions.map((c) => c.sourceAgent.length));
  const tgtW = Math.max(tgtHeader.length, ...collisions.map((c) => c.targetAgent.length));
  const chW = Math.max(chHeader.length, ...collisions.map((c) => c.channelId.length));
  const header = [
    srcHeader.padEnd(srcW),
    tgtHeader.padEnd(tgtW),
    chHeader.padEnd(chW),
  ].join("  |  ");
  const separator = "-".repeat(header.length);
  const rows = collisions.map((c) =>
    [
      c.sourceAgent.padEnd(srcW),
      c.targetAgent.padEnd(tgtW),
      c.channelId.padEnd(chW),
    ].join("  |  "),
  );
  const footer =
    "Resolution: unbind the OpenClaw side — ClawCode is the migration target.";
  const reportBody = [header, separator, ...rows, "", footer].join("\n");

  return {
    pass: false,
    message: `${collisions.length} Discord channel collision(s) — see report below`,
    reportBody,
    ledgerRow: {
      ts: opts.ts(),
      action: "apply",
      agent: opts.filter ?? "ALL",
      status: "pending",
      source_hash: opts.source_hash,
      step: "pre-flight:channel",
      outcome: "refuse",
      notes: `${collisions.length} collisions: ${collisions.map((c) => c.channelId).join(", ")}`,
    },
  };
}
