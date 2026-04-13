# Benchmarks

Phase 51 regression gate. See `.planning/phases/51-slos-regression-gate/`.

## Files

| File | Purpose | Change via |
|------|---------|------------|
| `prompts.yaml` | Fixed bench prompt set | Normal PR review |
| `thresholds.yaml` | Per-segment regression tolerance | Normal PR review (policy change) |
| `baseline.json` | Canonical latency baseline | `clawcode bench --update-baseline` (operator action) |
| `reports/<run_id>.json` | Historical bench runs | Auto-written by `clawcode bench` — NOT tracked in git |

## Running Locally

```bash
# Run the full suite, print a diff against the current baseline:
clawcode bench

# CI-mode: exit 1 if any tracked p95 regresses past threshold:
clawcode bench --check-regression

# Promote the current run to baseline (interactive confirmation, prints commit hint):
clawcode bench --update-baseline
```

## CI

See `.github/workflows/bench.yml`. The job builds the CLI, runs
`clawcode bench --check-regression`, and fails the build on regression.
The baseline is read from this directory as committed to git at the
time of the PR.

The workflow WARNS-and-passes (exit 0) when either:
- `baseline.json` does not yet exist (initial rollout — establish via
  `clawcode bench --update-baseline`)
- `ANTHROPIC_API_KEY` secret is not set (fork PRs without secrets)

This permissive behavior is intentional for the initial rollout. Once a
baseline is committed and the secret is wired, the gate becomes strict.

## Updating the Baseline

1. Run `clawcode bench --update-baseline` locally.
2. Review the printed diff — if any regressions look wrong, investigate
   first (a regression you didn't cause is a real bug worth finding).
3. Confirm the update at the prompt (`y`).
4. Run the printed `git add ... && git commit ...` command.
5. Open a PR — the diff in `baseline.json` is reviewable line-by-line.

## Schema Sources of Truth

- Prompts: `src/benchmarks/prompts.ts` (`loadPrompts`)
- Thresholds: `src/benchmarks/thresholds.ts` (`loadThresholds`, `evaluateRegression`)
- Baseline: `src/benchmarks/baseline.ts` (`readBaseline`, `writeBaseline`)
- SLO targets: `src/performance/slos.ts` (`DEFAULT_SLOS`)
