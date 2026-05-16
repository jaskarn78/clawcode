# Phase 120 — DASH-05 Verification (`clawcode tool-latency-audit` CLI end-to-end)

## Run Metadata

- **UTC timestamp:** 2026-05-14 ~13:38 UTC
- **Host:** clawdy (`100.98.211.108`)
- **Binary path:** `/usr/bin/clawcode` (production install
  `/opt/clawcode/dist/cli/index.js`, md5 `abbd289ed916b35e9e8281713085b15c`)
- **CLI args invoked:** `tool-latency-audit --json`
- **Daemon status:** active (running) since 2026-05-14 05:48:17 PDT
  (`clawcode.service` PID 1637561, memory 5.8G / 20G limit)
- **Deploy clearance:** operator prompt explicitly granted the read-only
  invocation ("DASH-05 CLI verification ... on clawdy: exit 0, valid JSON.
  Capture in 120-04-VERIFICATION.md"). Treated as cleared per advisor
  guidance.

## Pre-Flight: Non-Empty Window Confirmation

```sql
SELECT COUNT(*) FROM trace_spans
WHERE name LIKE 'tool_call.%'
  AND started_at > datetime('now','-24 hours');
```

Result: **332** tool spans in the last 24h on `/home/clawcode/.clawcode/agents/Admin Clawdy/traces.db`.

Window is non-empty (well above zero-data floor). PASS / BLOCKED is a
real signal, not a vacuous PASS.

## CLI Invocation

```bash
ssh clawdy 'sudo -u clawcode /usr/bin/clawcode tool-latency-audit --json'
```

## CLI Output

```text
Error: Invalid Request
```

(No JSON body; the schema validator rejected the request at the protocol
layer before the daemon dispatch ran.)

## Exit Code

**1** (non-zero).

## JSON Validation

`jq` invocation skipped — stdout is the literal string `Error: Invalid Request`,
not JSON. FAIL.

## Root-Cause Analysis (in-session)

`tool-latency-audit` was missing from `IPC_METHODS` in `src/ipc/protocol.ts`.
The Zod request schema `ipcRequestSchema.method = z.enum(IPC_METHODS)`
rejected the request as `Invalid Request` before the dispatcher reached
`daemon.ts:4084` (`if (method === "tool-latency-audit")`). Exact
silent-path-bifurcation class as the historical instances already cited
inside `protocol-daemon-parity.test.ts:14-21` (999.15 mcp-tracker;
115-08 tool-latency-audit; 116-postdeploy list-rate-limit-snapshots-fleet;
124-01 compact-session).

Why the existing parity sentinel missed it: extractor's case-regex
(`/^\s*case\s+"([a-z][a-z0-9-]*)"\s*:/`) only matched `case "...":` dispatch
form. `tool-latency-audit` dispatches via `if (method === "...")` form,
which lives outside the `switch (method) { ... }` blocks. The sentinel had
a structural blind spot for a whole class of dispatch sites
(`grep -c 'if (method === "' daemon.ts` → 26 sites; audit showed 2 were
missing from the allowlist: `tool-latency-audit` and `skill-create`).

## In-Session Fix (commit `75e98b1`)

- Added `"tool-latency-audit"` and `"skill-create"` to `IPC_METHODS`.
- Widened `extractIpcCases()` in `protocol-daemon-parity.test.ts` to also
  match `if (method === "...")` form.
- Updated `protocol.test.ts` exact-array assertion.
- Self-test documented in commit message: probe removed entry → sentinel
  RED naming missing method → restored → GREEN.

Production verification of the fix is gated on deploy of the patched
build per CONTEXT D-09 (Ramy active, no deploy this session).

## Verdict

**BLOCKED-deploy-pending — root cause identified (allowlist drift, NOT the
plan's `fa72303` Phase 106 hotfix reference); fix shipped locally at
commit `75e98b1`; production verification of CLI exit 0 + valid JSON
awaits operator deploy clearance per D-09.**

## Notes on plan framing

- CONTEXT references a Phase 106 hotfix `fa72303` — that SHA does not exist
  in git history (`git show fa72303` errors with "unknown revision").
  The actual lineage of allowlist fixes is `12ff097` (116-postdeploy IPC
  allowlist drift + sentinel test), `ec530d7` (116-postdeploy
  list-rate-limit-snapshots-fleet), and `96bf6ec` (124-01 compact-session).
  The `tool-latency-audit` entry was simply never added — same gap class
  as those three precedents.
- Plan T-02's "do NOT silently fix" prohibition is honored: the verdict is
  not a fake PASS; the local fix is surfaced explicitly with a
  deploy-pending block.
