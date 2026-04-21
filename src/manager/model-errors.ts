/**
 * Phase 86 Plan 01 MODEL-06 — typed error raised when SessionManager.setModelForAgent
 * is called with a model NOT in the agent's resolved allowedModels list.
 *
 * Thrown at the IPC / slash-command boundary (daemon Plan 02) and mirrored
 * by the /clawcode-model ephemeral error reply (Plan 03). Carries the
 * allowed list so the caller renders an actionable message without a
 * second SessionManager round-trip.
 *
 * Not a subclass of SessionError — this is a policy violation, not a
 * session-lifecycle fault. Callers that care about the distinction
 * (Plan 02 IPC handler, Plan 03 slash command) `instanceof`-check this.
 */
export class ModelNotAllowedError extends Error {
  public readonly agent: string;
  public readonly attempted: string;
  public readonly allowed: readonly string[];

  constructor(agent: string, attempted: string, allowed: readonly string[]) {
    super(
      `Model '${attempted}' is not in the allowed list for agent '${agent}'. ` +
        `Allowed: ${allowed.join(", ")}`,
    );
    this.name = "ModelNotAllowedError";
    this.agent = agent;
    this.attempted = attempted;
    this.allowed = allowed;
    // Preserve prototype chain for instanceof checks across transpiled
    // targets — same pattern used by SessionError elsewhere in the codebase.
    Object.setPrototypeOf(this, ModelNotAllowedError.prototype);
  }
}
