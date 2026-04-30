/**
 * Phase 999.10 — SEC-01 callsites assertion. Greps src/ for stray
 * `op read` execSync/spawn calls outside the two allowed homes:
 *   - src/config/loader.ts (defaultOpRefResolver — kept as back-compat)
 *   - src/manager/op-env-resolver.ts (defaultOpReadShellOut)
 *   - src/manager/secrets-resolver.ts (NEW — this phase)
 * Wave 2 plan 02 turns this green by rewriting the daemon.ts:3522
 * inline execSync block to route through SecretsResolver.
 */
import { describe, it } from "vitest";

describe("SEC-01 callsites — no stray op-read shell-outs", () => {
  it.todo("CALL-01: only allowed files contain `op read` shell-out");
});
