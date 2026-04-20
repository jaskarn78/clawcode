/**
 * Phase 78 Plan 02 Task 2 — CLI wiring tests for --model-map flag on
 * `migrate openclaw plan` and `migrate openclaw apply` subcommands.
 *
 * Focus: the parse/thread contract between commander options and the
 * runPlanAction / runApplyAction handlers. Plan 03 will use the parsed
 * map inside the writer; here we only assert the flag parses, propagates,
 * and fails fast on malformed input.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import * as migrateModule from "../commands/migrate-openclaw.js";

describe("migrate openclaw --model-map flag", () => {
  let program: Command;
  let planSpy: ReturnType<typeof vi.spyOn>;
  let applySpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride(); // prevent commander from calling process.exit on parse errors
    migrateModule.registerMigrateOpenclawCommand(program);

    planSpy = vi
      .spyOn(migrateModule, "runPlanAction")
      .mockResolvedValue(0);
    applySpy = vi
      .spyOn(migrateModule, "runApplyAction")
      .mockResolvedValue(0);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`process.exit(${code ?? 0})`);
      }) as never);
    errorSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("plan --model-map 'foo=sonnet' threads { foo: 'sonnet' } into runPlanAction", async () => {
    await program.parseAsync(
      ["node", "clawcode", "migrate", "openclaw", "plan", "--model-map", "foo=sonnet"],
    );
    expect(planSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        modelMap: { foo: "sonnet" },
      }),
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
    expect(applySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        modelMap: { a: "1", b: "2" },
      }),
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
    // planSpy should NOT have been called (fail-fast BEFORE handler runs)
    expect(planSpy).not.toHaveBeenCalled();
    // stderr should have received the literal 'invalid --model-map syntax'
    const allStderrArgs = errorSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(allStderrArgs).toContain("invalid --model-map syntax");
  });

  it("plan without --model-map threads empty modelMap {} into runPlanAction", async () => {
    await program.parseAsync(
      ["node", "clawcode", "migrate", "openclaw", "plan"],
    );
    expect(planSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        modelMap: {},
      }),
    );
  });
});
