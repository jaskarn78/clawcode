/**
 * Phase 115 Plan 09 T01 — `clawcode perf-comparison` CLI.
 *
 * Operator-facing receipt for the phase-115 closeout. Reads the four
 * perf-comparisons artifacts from
 * `.planning/phases/115-memory-context-prompt-cache-redesign/perf-comparisons/`
 * and prints a single-screen summary:
 *
 *   - Sub-scope 6-B gate decision (SHIP / DEFER / PENDING-OPERATOR)
 *   - Pre-115 anchor numbers (the 2026-05-07 fin-acquisition incident)
 *   - Post-115 measured numbers (placeholder until operator runs the
 *     post-115 benchmark; see post-115-comparison.md)
 *   - Headline target / status per metric
 *
 * Threshold per CONTEXT D-12: <30% non-fin-acq tool_use_rate → SHIP 6-B;
 * ≥30% → DEFER. fin-acquisition is excluded from the gate (Ramy-paced,
 * tool-heavy by nature).
 *
 * Pinned by static-grep regression (acceptance criterion):
 *   - "30%"  / "0.30" — threshold provenance
 *   - "SHIP" / "DEFER" — gate-decision tokens
 *   - "fin-acquisition" — D-12 exclusion rationale
 *
 * No IPC dependency — this is a pure file-read + render. Works even when
 * the daemon isn't running, which is the right shape for a closeout
 * receipt that historians read months later.
 */

import { Command } from "commander";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { cliError, cliLog, dim, green, red, yellow } from "../output.js";

/**
 * Threshold for sub-scope 6-B gate per CONTEXT D-12. Mirrors
 * `SUB_SCOPE_6B_THRESHOLD = 0.3` in
 * `src/cli/commands/tool-latency-audit.ts` — kept here so the
 * perf-comparison CLI can render the same number without a cross-file
 * import that would pull the whole tool-latency-audit module in.
 */
export const PERF_COMPARISON_6B_THRESHOLD = 0.3;

/**
 * Default location of the four perf-comparisons artifacts. The CLI accepts
 * a `--phase-dir` override for users running from a non-repo cwd.
 */
const DEFAULT_PHASE_DIR =
  ".planning/phases/115-memory-context-prompt-cache-redesign/perf-comparisons";

interface PerfComparisonReports {
  readonly baseline: string | null;
  readonly waveCheckpoint: string | null;
  readonly subScope6BDecision: string | null;
  readonly post115: string | null;
}

/**
 * Read all four artifact files from the phase directory. Returns null for
 * any file that does not exist — this is the phase 115 partial-completion
 * shape (e.g., post-115-comparison.md may have placeholder numbers if the
 * operator hasn't run the post-115 bench yet).
 *
 * @param phaseDir Absolute or repo-relative path to perf-comparisons dir.
 */
export async function readPerfComparisonReports(
  phaseDir: string,
): Promise<PerfComparisonReports> {
  async function readOptional(file: string): Promise<string | null> {
    try {
      return await fs.readFile(join(phaseDir, file), "utf8");
    } catch (err: unknown) {
      if ((err as { code?: string }).code === "ENOENT") return null;
      throw err;
    }
  }
  return {
    baseline: await readOptional("baseline-pre-115.md"),
    waveCheckpoint: await readOptional("wave-2-checkpoint.md"),
    subScope6BDecision: await readOptional("sub-scope-6b-decision.md"),
    post115: await readOptional("post-115-comparison.md"),
  };
}

/**
 * Extract the SHIP/DEFER/PENDING-OPERATOR token from sub-scope-6b-decision.md.
 * Returns null when the file is absent OR when no token is found (defensive
 * — the closeout plan T01 always writes one of the three).
 */
export function extractSubScope6BDecision(
  text: string | null,
): "SHIP" | "DEFER" | "PENDING-OPERATOR" | null {
  if (text === null) return null;
  // Search the Decision: section first; fall back to the whole document.
  // PENDING-OPERATOR is checked before SHIP/DEFER so "PENDING-OPERATOR" wins
  // when both tokens appear (the de-facto-DEFER case writes both).
  if (/PENDING-OPERATOR/.test(text)) return "PENDING-OPERATOR";
  // Look for **DEFER** or `DEFER` in a Decision section first; if absent,
  // accept any DEFER token. Same for SHIP.
  const decisionMatch = text.match(
    /##\s*Decision[\s\S]*?(?=##|$)/i,
  );
  const haystack = decisionMatch ? decisionMatch[0] : text;
  if (/\bDEFER\b/.test(haystack)) return "DEFER";
  if (/\bSHIP\b/.test(haystack)) return "SHIP";
  return null;
}

/**
 * Color the gate decision token. SHIP green, DEFER yellow,
 * PENDING-OPERATOR red. Plain text outside a TTY (handled by `output.ts`
 * via NO_COLOR + isTTY checks).
 */
function colorDecision(
  decision: "SHIP" | "DEFER" | "PENDING-OPERATOR" | null,
): string {
  if (decision === null) return red("(no-decision-file)");
  if (decision === "SHIP") return green(decision);
  if (decision === "DEFER") return yellow(decision);
  return red(decision);
}

/**
 * Render the human-readable summary block. Matches the layout used by
 * `clawcode tool-latency-audit` so the two CLIs read together as a
 * coherent operator surface.
 */
export function renderPerfComparison(reports: PerfComparisonReports): string {
  const lines: string[] = [];
  lines.push("Phase 115 perf comparison · closeout receipt");
  lines.push("");

  const decision = extractSubScope6BDecision(reports.subScope6BDecision);
  lines.push(`Sub-scope 6-B gate (CONTEXT D-12, ${(PERF_COMPARISON_6B_THRESHOLD * 100).toFixed(0)}% threshold):`);
  lines.push(`  decision: ${colorDecision(decision)}`);
  lines.push(`  excludes: fin-acquisition (Ramy-paced, tool-heavy by nature)`);
  lines.push(
    `  threshold: ${PERF_COMPARISON_6B_THRESHOLD} (= 0.30 = 30%; knob, not constant)`,
  );
  lines.push("");

  // Headline targets per ROADMAP lines 879-885 + baseline-pre-115.md.
  // These numbers are static in the baseline (incident anchor); post-115
  // numbers come from post-115-comparison.md once operator-run.
  lines.push("Pre-115 anchor (2026-05-07 fin-acquisition incident):");
  lines.push(`  ${dim("first_token_p50_ms")}        5,200`);
  lines.push(`  ${dim("end_to_end_p95_ms")}         288,713`);
  lines.push(`  ${dim("mysql_query_p50_ms")}        120,659`);
  lines.push(`  ${dim("stable_prefix_chars")}       32,989  (the wedge)`);
  lines.push(
    `  ${dim("prompt_cache_hit_rate")}     92.8% Ramy / <30% idle (bimodal)`,
  );
  lines.push("");

  lines.push("Phase 115 perf targets:");
  lines.push(`  ${dim("first_token_p50_ms")}        ≤ 2,000`);
  lines.push(`  ${dim("end_to_end_p95_ms")}         ≤ 30,000`);
  lines.push(`  ${dim("mysql_query_p50_ms")}        ≤ 5,000`);
  lines.push(
    `  ${dim("stable_prefix_tokens_p95")}  ≤ 8,000 hard / ≤ 10,000 fleet p95 / ≤ 12,000 fin-acq`,
  );
  lines.push(
    `  ${dim("prompt_cache_hit_rate")}     ≥ 70% across <5min cadence agents`,
  );
  lines.push(
    `  ${dim("tool_cache_hit_rate")}       ≥ 40% on repetitive-read agents`,
  );
  lines.push("");

  lines.push("Post-115 measured numbers:");
  if (reports.post115 === null) {
    lines.push(
      "  " +
        red(
          "post-115-comparison.md not found — has the closeout plan run yet?",
        ),
    );
  } else {
    // Defensive scan: if every cell is `(measured)` or `_PENDING_`, the
    // operator hasn't run the post-115 bench yet. Tell the operator that
    // explicitly so they don't mistake the placeholder for a real number.
    const placeholder =
      /\(measured\)/.test(reports.post115) ||
      /_PENDING_/.test(reports.post115) ||
      /\(operator-run\)/.test(reports.post115);
    if (placeholder) {
      lines.push(
        "  " +
          yellow(
            "post-115-comparison.md exists but contains placeholder numbers.",
          ),
      );
      lines.push(
        "  " +
          dim("Operator runs `scripts/bench/115-perf.ts` to populate."),
      );
    } else {
      lines.push("  " + green("post-115-comparison.md has measured data."));
      lines.push(
        "  " +
          dim(
            "Read the table in that file for the headline metrics + per-agent rows.",
          ),
      );
    }
  }
  lines.push("");

  lines.push("Files (under .planning/phases/115-*/perf-comparisons/):");
  lines.push(
    `  ${reports.baseline === null ? red("MISSING") : green("present")}  baseline-pre-115.md     (locked from incident)`,
  );
  lines.push(
    `  ${reports.waveCheckpoint === null ? red("MISSING") : green("present")}  wave-2-checkpoint.md    (mid-phase + 6-B gate skeleton)`,
  );
  lines.push(
    `  ${reports.subScope6BDecision === null ? red("MISSING") : green("present")}  sub-scope-6b-decision.md (closeout T01)`,
  );
  lines.push(
    `  ${reports.post115 === null ? red("MISSING") : green("present")}  post-115-comparison.md   (closeout T05)`,
  );
  lines.push("");
  lines.push(
    dim(
      "See `clawcode tool-latency-audit --json --window-hours 24` for live measurement.",
    ),
  );

  return lines.join("\n");
}

/**
 * Register the `perf-comparison` top-level command. Wired in
 * `src/cli/index.ts` next to `tool-latency-audit`.
 */
export function registerPerfComparisonCommand(program: Command): void {
  program
    .command("perf-comparison")
    .description(
      "Phase 115 closeout — print the four perf-comparisons artifacts + sub-scope 6-B gate decision (SHIP/DEFER/PENDING-OPERATOR; 30% threshold; fin-acquisition excluded per D-12).",
    )
    .option(
      "--phase-dir <dir>",
      "perf-comparisons directory",
      DEFAULT_PHASE_DIR,
    )
    .option("--json", "Emit JSON instead of human-readable summary")
    .action(
      async (opts: { phaseDir?: string; json?: boolean }) => {
        try {
          const phaseDir = opts.phaseDir ?? DEFAULT_PHASE_DIR;
          const reports = await readPerfComparisonReports(phaseDir);
          const decision = extractSubScope6BDecision(
            reports.subScope6BDecision,
          );
          if (opts.json) {
            cliLog(
              JSON.stringify(
                {
                  computed_at: new Date().toISOString(),
                  phase_dir: phaseDir,
                  sub_scope_6b: {
                    decision,
                    threshold: PERF_COMPARISON_6B_THRESHOLD,
                    excludes_agent: "fin-acquisition",
                  },
                  files: {
                    baseline: reports.baseline !== null,
                    wave_2_checkpoint: reports.waveCheckpoint !== null,
                    sub_scope_6b_decision:
                      reports.subScope6BDecision !== null,
                    post_115: reports.post115 !== null,
                  },
                },
                null,
                2,
              ),
            );
          } else {
            cliLog(renderPerfComparison(reports));
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          cliError(`perf-comparison failed: ${msg}`);
          process.exit(1);
        }
      },
    );
}
