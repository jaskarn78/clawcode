/**
 * Phase 78 Plan 02 Task 2 — CLI wiring tests for --model-map flag on
 * `migrate openclaw plan` and `migrate openclaw apply` subcommands.
 *
 * Focus: the parse/thread contract between commander options and the
 * runPlanAction / runApplyAction handlers. Plan 03 will use the parsed
 * map inside the writer; here we only assert the flag parses, propagates,
 * and fails fast on malformed input.
 *
 * ESM note: the CLI dispatches via a mutable `migrateOpenclawHandlers`
 * holder because named-import bindings are frozen in ESM — `vi.spyOn` on
 * the module namespace cannot rebind commander closures. Tests monkey-
 * patch the holder's properties instead.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import {
  registerMigrateOpenclawCommand,
  migrateOpenclawHandlers,
} from "../commands/migrate-openclaw.js";

describe("migrate openclaw --model-map flag", () => {
  let program: Command;
  let planMock: ReturnType<typeof vi.fn>;
  let applyMock: ReturnType<typeof vi.fn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let origPlan: typeof migrateOpenclawHandlers.runPlanAction;
  let origApply: typeof migrateOpenclawHandlers.runApplyAction;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerMigrateOpenclawCommand(program);

    origPlan = migrateOpenclawHandlers.runPlanAction;
    origApply = migrateOpenclawHandlers.runApplyAction;

    planMock = vi.fn().mockResolvedValue(0);
    applyMock = vi.fn().mockResolvedValue(0);
    migrateOpenclawHandlers.runPlanAction = planMock as never;
    migrateOpenclawHandlers.runApplyAction = applyMock as never;

    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`process.exit(${code ?? 0})`);
      }) as never);
    errorSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
  });

  afterEach(() => {
    migrateOpenclawHandlers.runPlanAction = origPlan;
    migrateOpenclawHandlers.runApplyAction = origApply;
    vi.restoreAllMocks();
  });

  it("plan --model-map 'foo=sonnet' threads { foo: 'sonnet' } into runPlanAction", async () => {
    await program.parseAsync(
      ["node", "clawcode", "migrate", "openclaw", "plan", "--model-map", "foo=sonnet"],
    );
    expect(planMock).toHaveBeenCalledWith(
      expect.objectContaining({ modelMap: { foo: "sonnet" } }),
    );
  });

  it("apply --model-map repeated aggregates multiple mappings", async () => {
    await program.parseAsync(
      [
        "node",
        "clawcode",
        "migrate",
        "openclaw",
        "apply",
        "--model-map",
        "a=1",
        "--model-map",
        "b=2",
      ],
    );
    expect(applyMock).toHaveBeenCalledWith(
      expect.objectContaining({ modelMap: { a: "1", b: "2" } }),
    );
  });

  it("plan --model-map 'invalid-no-equals' exits 1 with stderr containing 'invalid --model-map syntax' BEFORE calling runPlanAction", async () => {
    let caught: Error | undefined;
    try {
      await program.parseAsync(
        ["node", "clawcode", "migrate", "openclaw", "plan", "--model-map", "invalid-no-equals"],
      );
    } catch (err) {
      caught = err as Error;
    }
    expect(caught?.message).toMatch(/process\.exit\(1\)/);
    expect(planMock).not.toHaveBeenCalled();
    const allStderrArgs = errorSpy.mock.calls
      .map((c: readonly unknown[]) => String(c[0]))
      .join("");
    expect(allStderrArgs).toContain("invalid --model-map syntax");
  });

  it("plan without --model-map threads empty modelMap {} into runPlanAction", async () => {
    await program.parseAsync(
      ["node", "clawcode", "migrate", "openclaw", "plan"],
    );
    expect(planMock).toHaveBeenCalledWith(
      expect.objectContaining({ modelMap: {} }),
    );
  });

  // Keep exitSpy referenced so lint doesn't complain — it's used implicitly
  // via the throw-on-exit behavior above.
  it("exitSpy is installed (smoke)", () => {
    expect(exitSpy).toBeDefined();
  });
});
