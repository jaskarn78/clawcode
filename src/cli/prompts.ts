/**
 * Phase 999.14 — MCP-10 Wave 0 declaration shim for the confirmation prompt
 * helper extracted per coding-style ("prompt logic gets extracted into a
 * tiny helper so tests can mock just that helper rather than wrestling
 * with raw stdin").
 *
 * Wave 1 Task 3 replaces the body with a real readline-based prompt.
 * Tests mock this module directly, so the stub never runs in tests.
 */

/**
 * Prompt the operator with a yes/no question. Returns true on "y"/"yes"
 * (case-insensitive), false otherwise. Wave 1 implements with
 * node:readline/promises.
 */
export async function confirmPrompt(_message: string): Promise<boolean> {
  throw new Error(
    "confirmPrompt: not implemented in Wave 0 — Wave 1 lands the GREEN code",
  );
}
