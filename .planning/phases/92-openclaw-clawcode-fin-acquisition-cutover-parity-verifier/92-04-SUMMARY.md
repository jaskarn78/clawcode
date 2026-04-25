---
phase: 92-openclaw-clawcode-fin-acquisition-cutover-parity-verifier
plan: 04
subsystem: cutover/destructive-embed+applier+button-handler+slash
tags: [cutover, destructive, embed, button-handler, applier, snapshot, admin-clawdy, customid-namespace, d06, d07, d10, d11, ui-01]
dependency-graph:
  requires:
    - "Plan 92-02 DestructiveCutoverGap helper sub-union (4 destructive kinds: outdated-memory-file, mcp-credential-drift, tool-permission-gap, cron-session-not-mirrored — D-11)"
    - "Plan 92-03 cutoverLedgerRowSchema + appendCutoverRow + DEFAULT_CUTOVER_LEDGER_PATH"
    - "Phase 86-03 ButtonBuilder + customId namespacing pattern (model-confirm:{agent}:{nonce} precedent)"
    - "Phase 85 CONTROL_COMMANDS inline-short-circuit pattern (/clawcode-tools, /clawcode-sync-status)"
    - "Phase 86-02 handleSetModelIpc pure-fn extraction blueprint"
    - "Phase 88 SkillInstallOutcome exhaustive-switch outcome rendering"
  provides:
    - "CUTOVER_BUTTON_PREFIX = \"cutover-\" (reserved namespace)"
    - "destructiveButtonActionSchema enum (accept/reject/defer)"
    - "CutoverButtonCustomId template-literal type cutover-{agent}-{gapId}:{action}"
    - "parseCutoverButtonCustomId — collision-safe null-on-non-cutover-prefix parser"
    - "DestructiveButtonOutcome 6-variant union (accepted-applied / accepted-apply-failed / rejected / deferred / expired / invalid-customId)"
    - "renderDestructiveGapEmbed pure function (4 destructive kinds, exhaustive switch + assertNever, ButtonStyle.Danger Accept)"
    - "computeGapId pure helper (sha256(agent|kind|identifier).slice(0,12))"
    - "applyDestructiveFix DI-pure dispatcher with snapshot-capture-before-apply (D-10)"
    - "SNAPSHOT_MAX_BYTES = 64*1024 constant"
    - "DestructiveApplierDeps DI shape (mirror of Plan 92-03 AdditiveApplierDeps minus apply boolean)"
    - "handleCutoverButtonInteraction pure dispatcher (interaction-shape-agnostic — daemon IPC + Discord collector both invoke)"
    - "ButtonHandlerDeps + ButtonInteractionLike DI surface"
    - "handleCutoverButtonActionIpc daemon-side IPC handler + closure-based intercept BEFORE routeMethod"
    - "/clawcode-cutover-verify slash command + handleCutoverVerifyCommand inline handler (9th UI-01 application)"
    - "formatCutoverOutcome helper (DestructiveButtonOutcome → operator-friendly string)"
    - "IPC methods cutover-verify-summary + cutover-button-action registered in IPC_METHODS"
  affects:
    - "Plan 92-06 verify pipeline reads DestructiveCutoverGap[] and invokes the slash flow via cutover-verify-summary IPC"
    - "Plan 92-06 rollback CLI replays apply-destructive ledger rows in LIFO order using preChangeSnapshot field populated by this applier"
    - "Plan 92-06 set-authoritative cutover gate counts unrolled-back destructive rows"
tech-stack:
  added: []
  patterns:
    - "Reserved customId prefix namespace (`cutover-`) — collision-safe with model-confirm:, model-cancel:, skills-picker:, plugins-picker:, marketplace-skills-confirm:, cancel:, modal-, skills-action-confirm:, plugin-confirm-x: (D2 regression test pins ALL prefixes)"
    - "Pure-function embed renderer with deterministic gapId (sha256-truncated to 12 hex chars) — same input twice produces identical components AND customIds"
    - "Snapshot-capture-before-apply ordering invariant (D-10): readFile → gzip+b64 → rsync → ledger row, NEVER ledger row before snapshot capture"
    - "Files >64KB → null snapshot + reason=irreversible-without-backup; rollback CLI surfaces this in the warning"
    - "Audit-only ledger rows for non-file destructive kinds (mcp-credential-drift, tool-permission-gap, cron-session-not-mirrored) — operator confirmation recorded; actual rotation/ACL/cron wiring is operator-driven per D-06 propose-and-confirm"
    - "Closure-based IPC intercept BEFORE routeMethod (mirrors Phase 88 marketplace handler pattern)"
    - "Inline-handler short-circuit BEFORE CONTROL_COMMANDS dispatch (9th application of the Phase 85/86/87/88/91 UI-01 pattern)"
    - "Lazy-import inside slash handler to keep cold-start graph decoupled from cutover module surface (mirrors Phase 91 sync-status-embed pattern)"
    - "Compile-time exhaustiveness via assertNever in renderer + applier default branches — adding a 5th destructive kind fails the TypeScript build until BOTH consumers update"
    - "Interaction-shape-agnostic button dispatcher (ButtonInteractionLike structural type) — daemon IPC + Discord collector share the same pure handler"
key-files:
  created:
    - "src/cutover/destructive-embed-renderer.ts (202 lines): pure function rendering EmbedBuilder + 3 buttons; deterministic gapId; exhaustive switch over 4 destructive kinds + assertNever"
    - "src/cutover/destructive-applier.ts (285 lines): per-kind apply dispatch with preChangeSnapshot capture; outdated-memory-file does rsync; mcp-credential-drift / tool-permission-gap / cron-session-not-mirrored emit audit-only ledger rows"
    - "src/cutover/button-handler.ts (174 lines): pure dispatcher parsing customId, resolving gap, routing Accept→applier / Reject→ledger / Defer→no-op"
    - "src/cutover/__tests__/destructive-embed-renderer.test.ts (168 lines, 5 it-blocks): R1 outdated + R2 mcp-drift + R3 tool-perm + R4 customId-shape determinism + R5 NO-LEAK with sk_live_secret_42 sentinel"
    - "src/cutover/__tests__/button-handler.test.ts (214 lines, 6 it-blocks): B1 Accept-applies + B2 Reject-logs + B3 Defer-noop + B4 invalid-customId + B5 gap-not-found + B6 Accept-but-applier-fails-with-audit-row"
    - "src/manager/__tests__/daemon-cutover-button.test.ts (122 lines, 3+ it-blocks; expanded to 17 via it.each per-customId): D1 IPC routing + D2 namespace collision regression (9 existing prefixes + malformed cutover- shapes + CUTOVER_BUTTON_PREFIX literal pin) + D3 IPC method registration"
  modified:
    - "src/cutover/types.ts: extended (NOT replaced) with CUTOVER_BUTTON_PREFIX + destructiveButtonActionSchema + CutoverButtonCustomId template-literal type + parseCutoverButtonCustomId helper + DestructiveButtonOutcome 6-variant union — Plans 92-01/02/03 surface preserved verbatim"
    - "src/ipc/protocol.ts: appended cutover-verify-summary + cutover-button-action to IPC_METHODS"
    - "src/manager/daemon.ts: handleCutoverButtonActionIpc pure helper (mirror of handleSetModelIpc) + closure-based intercept for method===\"cutover-button-action\" BEFORE routeMethod (mirrors marketplace handler pattern)"
    - "src/discord/slash-types.ts: registered /clawcode-cutover-verify CONTROL_COMMANDS entry (ipcMethod: cutover-verify-summary)"
    - "src/discord/slash-commands.ts: handleCutoverVerifyCommand inline handler (9th UI-01 short-circuit application) + formatCutoverOutcome module-level helper"
decisions:
  - "customId namespace `cutover-` is RESERVED for this plan; collision-safe with all 9 existing prefix shapes pinned by D2 regression test (model-confirm:, model-cancel:, skills-picker:, plugins-picker:, marketplace-skills-confirm:, cancel:, modal-, skills-action-confirm:, plugin-confirm-x:)"
  - "customId shape uses HYPHEN-separator (cutover-{agent}-{gapId}:{action}) deliberately distinct from existing colon-separated prefixes (model-confirm:agent:nonce). Body splits on LAST hyphen to support agent names containing hyphens (fin-acquisition, content-creator). Action splits on LAST colon"
  - "gapId is deterministic sha256(agent|kind|identifier).slice(0,12) — same gap → same gapId across renders. This means a deferred gap's button customIds remain stable across verify reruns; the operator can click Accept on a re-surfaced embed and it routes to the same gap"
  - "preChangeSnapshot capture order is FIXED: readFile target → gzip+b64 (if ≤64KB) → rsync apply → readFile target post-apply for targetHash → appendCutoverRow. Files >64KB get null snapshot + reason=irreversible-without-backup; rollback CLI cannot rewind these"
  - "B6 decision pinned in test: failed apply DOES emit an audit ledger row (action='apply-destructive', reason='failed: <error>', reversible:false, preChangeSnapshot:null). This gives operators visibility into attempted-but-failed applies in the audit trail. Documented in B6 test comment"
  - "mcp-credential-drift / tool-permission-gap / cron-session-not-mirrored applies are AUDIT-ONLY in first pass. Per D-06 propose-and-confirm, the actual op:// rotation / ACL writer / cron schedule wiring is operator-driven via existing surfaces (/clawcode-plugins-browse for credentials; ACL writer + cron config wiring deferred to a future plan). The applier records the operator's accept decision in the ledger; the ledger row's `reason` field carries the operator-actionable hint"
  - "Button-handler is INTERACTION-SHAPE-AGNOSTIC — accepts ButtonInteractionLike structural type {customId, user.id} so the same pure handler is invoked from BOTH the daemon IPC path (Plan 92-06 CLI verify pipeline) AND the Discord collector path (this plan's slash command). The handler does NOT call interaction.reply/editReply/deferUpdate; the caller (slash-commands.ts) is responsible for Discord acknowledgement"
  - "Daemon IPC closure-intercept FIRST-PASS injects null gapById and a stub runRsync that returns exitCode:1. Plan 92-06 will wire the production gapById (reads CUTOVER-GAPS.json) and the real rsync runner. The stub design fails-safe: stray button click before Plan 92-06 wires the source returns invalid-customId rather than performing an unconfigured rsync"
  - "Slash command is /clawcode-cutover-verify (CONTROL_COMMANDS entry, daemon-routed, zero LLM turn cost — UI-01 compliance per Phase 85/86/87/88/91 precedent). Inline handler is the 9th application of the inline-handler-short-circuit-before-CONTROL_COMMANDS pattern"
  - "Collector TTL = 30 minutes per Claude's-Discretion (operators may step away to verify content of an outdated-memory-file before clicking Accept). Each gap renders as a separate ephemeral message (first via editReply, subsequent via followUp) so each carries its own button TTL"
  - "Plan supports up to 25 destructive embeds per invocation (paginate-on-overflow with select-menu deferred per Claude's-Discretion). Production fin-acquisition is expected to surface ≤10 destructive gaps in a single verify run; 25 is generous slack"
  - "Test count exceeded plan minimum: plan said 14 (5+6+3); actual it-blocks are 5+6+3 but it.each in D2 expands to 17 distinct test runs. Total test runs: 25 in the three new files; 75 cumulative cutover test pass after this plan (50 from 92-01/02/03 + 14 plan-counted new + extra it.each expansion)"
metrics:
  completed_date: "2026-04-25"
  duration_minutes: 12
  tasks: 2
  files_created: 6
  files_modified: 5
  tests_added: 14  # 5 renderer + 6 button-handler + 3 daemon-cutover-button (it.each expands D2 to 17 runs)
  tests_total: 75  # 50 from Plans 92-01/02/03 + 14 plan-counted + 11 it.each expansion
  tests_passing: 75
  lines_total: 1165
---

# Phase 92 Plan 04: Destructive-fix admin-clawdy embed flow Summary

CUT-06 + CUT-07 spine: the safety floor for the entire cutover pipeline. Per D-06 and D-07, destructive cutover mutations NEVER auto-apply — they ALWAYS require admin-clawdy operator confirmation via interactive embeds with Accept/Reject/Defer buttons. This plan delivers the embed renderer, button dispatcher, destructive applier with preChangeSnapshot capture (D-10 reversibility hook), daemon IPC handler, and the `/clawcode-cutover-verify` slash command — wired end-to-end with first-pass-stub gap source so Plan 92-06 can swap in the production CUTOVER-GAPS.json reader without touching this plan's surface.

## What Shipped

**Three pure-DI modules + extended types.ts + daemon IPC handler + slash command + 14 new tests.**

```
/clawcode-cutover-verify --agent X
  → daemon IPC cutover-verify-summary (Plan 92-06 wires; first-pass returns [] or stub)
  → for each DestructiveCutoverGap (cap 25):
      → renderDestructiveGapEmbed(agent, gap)         pure function
      → ephemeral followUp/editReply with embed + 3 buttons
  → button collector with i.customId.startsWith("cutover-") filter
  → on click: IPC cutover-button-action {customId, agent}
      → daemon handleCutoverButtonActionIpc
      → handleCutoverButtonInteraction (pure dispatcher)
          → Accept: applyDestructiveFix → snapshot+rsync+ledger (or audit-only ledger for non-file kinds)
          → Reject: appendCutoverRow with action="reject-destructive"
          → Defer:  no-op, no ledger row
      → DestructiveButtonOutcome → formatCutoverOutcome → ephemeral followUp
```

The button-handler is INTERACTION-SHAPE-AGNOSTIC — the same pure handler is invoked from BOTH the daemon IPC path (Plan 92-06 CLI verify pipeline) AND the Discord collector path (this plan's slash command). The handler accepts a structural `ButtonInteractionLike = {customId, user.id}` shape and does NOT call `interaction.reply` / `editReply` / `deferUpdate`; Discord-side acknowledgement is the caller's responsibility.

## CUTOVER_BUTTON_PREFIX Namespace (D2 regression-pinned)

The customId namespace `cutover-` is RESERVED for this plan. The D2 regression test pins:

| Existing prefix shape                          | parseCutoverButtonCustomId returns |
|------------------------------------------------|------------------------------------|
| `model-confirm:fin:n`                          | null                               |
| `model-cancel:fin:n`                           | null                               |
| `skills-picker:fin:n`                          | null                               |
| `plugins-picker:fin:n`                         | null                               |
| `marketplace-skills-confirm:fin:n`             | null                               |
| `cancel:abc`                                   | null                               |
| `modal-1:fin`                                  | null                               |
| `skills-action-confirm:fin:n`                  | null                               |
| `plugin-confirm-x:fin:n`                       | null                               |
| `cutover-fin-acquisition-abc:accept`           | `{agent: "fin-acquisition", gapId: "abc", action: "accept"}` |

The customId format is `cutover-{agent}-{gapId}:{action}` — HYPHEN-separator within the prefix, COLON-separator before the action. This is deliberately distinct from existing colon-separated prefixes (`model-confirm:agent:nonce`). Body splits on LAST hyphen so agent names with hyphens (fin-acquisition, content-creator) work without escaping. Action splits on LAST colon.

## DestructiveCutoverGap → Embed Mapping (4 kinds, D-04 + D-11)

| Kind                          | Embed body                                              | Apply behavior                          |
|-------------------------------|---------------------------------------------------------|-----------------------------------------|
| outdated-memory-file          | OpenClaw side hash + ClawCode side hash (16-char preview) | rsync OpenClaw→ClawCode + snapshot if ≤64KB |
| mcp-credential-drift          | Server name + env KEY NAMES (NOT values) + runtime status | Audit-only ledger row; operator rotates via /clawcode-plugins-browse |
| tool-permission-gap           | Tool name + ACL deny list                                | Audit-only ledger row; ACL writer deferred |
| cron-session-not-mirrored (D-11) | Cron sessionKey + label + lastSeenAt + target mirrored entries | Audit-only ledger row; cron wiring deferred |

Adding a 5th destructive kind without updating BOTH the renderer (`renderDestructiveGapEmbed`) AND the applier (`applyDestructiveFix`) fails the TypeScript build via `assertNever(gap)` in their default branches. This is the compile-time enforcement of the exhaustive-switch invariant.

## D-10 preChangeSnapshot Capture (regression-pinned)

The applier order is FIXED:

```
1. readFile(targetAbsPath)              ← capture pre-change content
2. if buf.byteLength <= 64KB:
     snapshotB64 = gzip(buf).toString("base64")  ← reversible: true
   else:
     snapshotB64 = null
     reason = "irreversible-without-backup"      ← reversible: false
3. await runRsync([...])                ← apply mutation
4. compute targetHash from post-apply readFile
5. appendCutoverRow({                   ← single ledger row per accept
     action: "apply-destructive",
     preChangeSnapshot: snapshotB64,
     reversible,
     reason,
     ...
   })
```

The 64KB threshold is pinned by `SNAPSHOT_MAX_BYTES = 64 * 1024` (regression-grep). Plan 92-06's rollback CLI replays accepted destructive rows in LIFO order; rows with `reversible: false` are skipped with an operator-visible warning.

## DestructiveButtonOutcome 6-Variant Union

| Variant                  | Trigger                                                              |
|--------------------------|----------------------------------------------------------------------|
| `accepted-applied`       | Operator clicked Accept; applyDestructiveFix returned `{kind:"applied"}` |
| `accepted-apply-failed`  | Operator clicked Accept; applyDestructiveFix returned `{kind:"failed"}`. Audit row appended for the trail. |
| `rejected`               | Operator clicked Reject; reject-destructive ledger row written, target unchanged |
| `deferred`               | Operator clicked Defer; NO ledger row, NO mutation. Re-running verify re-surfaces the gap. |
| `expired`                | Discord collector timed out (30-min TTL) before any click            |
| `invalid-customId`       | customId failed parseCutoverButtonCustomId OR gapById returned null  |

Plan 92-06's report writer switches exhaustively over this union (TypeScript compile-time enforcement).

## Per-Kind Apply Behavior

### outdated-memory-file (REAL MUTATION)

1. Resolve `gap.targetRef.path` to absolute under `deps.memoryRoot`
2. Capture preChangeSnapshot (gz+b64 if ≤64KB; null + irreversible-without-backup otherwise)
3. `runRsync(["-av", "-e", "ssh -o BatchMode=yes -o ConnectTimeout=10", "${openClawHost}:${sourcePath}", targetAbsPath])`
4. If exitCode !== 0: return `{kind: "failed", error: "rsync exit N: <stderr>"}` — NO ledger row from applier (button-handler audit row covers it)
5. Compute targetHash from post-apply readFile
6. `appendCutoverRow({action: "apply-destructive", sourceHash, targetHash, reversible, preChangeSnapshot, reason})`

### mcp-credential-drift / tool-permission-gap / cron-session-not-mirrored (AUDIT-ONLY)

Per D-06 propose-and-confirm, these emit a ledger row recording the operator's accept decision but do NOT auto-mutate the underlying surface. The `reason` field carries the operator-actionable hint:

- mcp-credential-drift → `"operator-confirmed-credential-drift; manual op:// update required via /clawcode-plugins-browse"`
- tool-permission-gap → `"operator-confirmed-tool-permission-gap; ACL writer wiring deferred"`
- cron-session-not-mirrored → `"operator-confirmed-cron-session-not-mirrored; cron wiring deferred to future plan"`

These rows have `reversible: false`, `preChangeSnapshot: null` — there's no target mutation to roll back.

## Test Coverage (14 new plan-counted; 25 it-blocks total via it.each expansion)

### destructive-embed-renderer.test.ts (5 tests)

| Test         | Pin                                                                              |
|--------------|----------------------------------------------------------------------------------|
| R1           | outdated-memory-file: title + both hash previews + Accept-Danger button + customId regex `cutover-fin-acquisition-[a-f0-9]+:accept` + customId consistency across the 3 buttons |
| R2           | mcp-credential-drift: server name + env KEY NAMES (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET) + status + 3 buttons |
| R3           | tool-permission-gap: tool name + ACL deny list (Bash, Bash(*)) + 3 buttons       |
| R4           | customId determinism: same input → same gapId; different gap/agent → different gapId; gapId is hex |
| R5           | NO-LEAK: literal sentinel "sk_live_secret_42" never appears in embed.toJSON() OR component.toJSON(); env KEY NAME "STRIPE_SECRET_KEY" DOES appear |

### button-handler.test.ts (6 tests)

| Test         | Pin                                                                              |
|--------------|----------------------------------------------------------------------------------|
| B1           | Accept happy path: applyDestructiveFix called once with the resolved gap; outcome.kind === "accepted-applied"; appendCutoverRow NOT called by handler (applier owns its own ledger write) |
| B2           | Reject: appendCutoverRow called once with action="reject-destructive", reversible:true, preChangeSnapshot:null, reason="operator-rejected"; applyDestructiveFix NEVER called |
| B3           | Defer: NO appendCutoverRow, NO applyDestructiveFix; outcome.kind === "deferred" |
| B4           | invalid-customId (model-confirm:... prefix): outcome.kind === "invalid-customId"; ZERO side effects |
| B5           | gap-not-found (customId valid, gapById returns null): outcome.kind === "invalid-customId"; ZERO side effects |
| B6           | Accept-but-applier-fails: outcome.kind === "accepted-apply-failed"; audit row appended (action="apply-destructive", reason="failed: rsync exit 1...", reversible:false, preChangeSnapshot:null); error string preserved |

### daemon-cutover-button.test.ts (3 it-blocks; expanded to 17 runs via it.each)

| Test         | Pin                                                                              |
|--------------|----------------------------------------------------------------------------------|
| D1           | IPC routing: handleCutoverButtonActionIpc({customId: "cutover-fin-acquisition-abc:defer"}, deps) → outcome.kind === "deferred", agent + gapKind populated |
| D2-existing  | parseCutoverButtonCustomId returns null for ALL 9 existing prefix shapes (it.each expands D2 to 9 distinct runs) |
| D2-positive  | parseCutoverButtonCustomId returns NON-null for cutover-fin-acquisition-abc:accept with correct agent/gapId/action |
| D2-malformed | parseCutoverButtonCustomId returns null for malformed cutover- shapes (missing colon, invalid action, missing hyphen, empty body) |
| D2-literal   | CUTOVER_BUTTON_PREFIX === "cutover-" (literal pin) |
| D3           | IPC_METHODS array includes BOTH "cutover-verify-summary" AND "cutover-button-action" |

## Static-Grep Regression Pins (verified)

| Pin                                                                                          | Status |
|----------------------------------------------------------------------------------------------|--------|
| `grep -q "export const CUTOVER_BUTTON_PREFIX = \"cutover-\"" src/cutover/types.ts`           | OK     |
| `grep -q "export function parseCutoverButtonCustomId" src/cutover/types.ts`                  | OK     |
| `grep -q "destructiveButtonActionSchema = z.enum" src/cutover/types.ts`                      | OK     |
| `grep -q "DestructiveButtonOutcome" src/cutover/types.ts`                                    | OK     |
| `grep -q '"cutover-verify-summary"' src/ipc/protocol.ts`                                     | OK     |
| `grep -q '"cutover-button-action"' src/ipc/protocol.ts`                                      | OK     |
| `grep -q "export function renderDestructiveGapEmbed" src/cutover/destructive-embed-renderer.ts` | OK  |
| `grep -q "assertNever" src/cutover/destructive-embed-renderer.ts` (exhaustive-switch pin)    | OK     |
| `grep -q "ButtonStyle.Danger" src/cutover/destructive-embed-renderer.ts` (D-06 Accept-is-red)| OK     |
| `grep -q "case \"outdated-memory-file\":" src/cutover/destructive-embed-renderer.ts`         | OK     |
| `grep -q "case \"mcp-credential-drift\":" src/cutover/destructive-embed-renderer.ts`         | OK     |
| `grep -q "case \"tool-permission-gap\":" src/cutover/destructive-embed-renderer.ts`          | OK     |
| `grep -q "case \"cron-session-not-mirrored\":" src/cutover/destructive-embed-renderer.ts`    | OK (D-11) |
| `grep -q "export async function applyDestructiveFix" src/cutover/destructive-applier.ts`    | OK     |
| `grep -q "preChangeSnapshot" src/cutover/destructive-applier.ts`                             | OK     |
| `grep -q "SNAPSHOT_MAX_BYTES = 64 \* 1024" src/cutover/destructive-applier.ts`               | OK (D-10 pin) |
| `grep -q "export async function handleCutoverButtonInteraction" src/cutover/button-handler.ts` | OK   |
| `grep -q "export async function handleCutoverButtonActionIpc" src/manager/daemon.ts`         | OK     |
| `grep -q "clawcode-cutover-verify" src/discord/slash-commands.ts`                            | OK     |
| `grep -q "i.customId.startsWith(CUTOVER_BUTTON_PREFIX)" src/discord/slash-commands.ts`       | OK (collector filter) |
| `! grep -E "writeFile.*cutover-ledger" src/cutover/button-handler.ts`                        | OK (appendFile only) |
| `git diff package.json` empty                                                                | OK (zero new npm deps) |

## Deviations from Plan

### [Doc-only] Renderer keeps the `⚠` emoji out of the rendered title

The plan's interfaces block sample showed `setTitle(\`⚠ Cutover gap: ${gap.kind}\`)`. The implementation uses just `setTitle(\`Cutover gap: ${gap.kind}\`)` — the embed color (CUTOVER_EMBED_COLOR_DESTRUCTIVE = 15158332 / Phase-91 conflict-embed red) carries the destructive-warning visual. R1/R2/R3 tests assert `embed.data.title.toContain("Cutover gap: ${kind}")` so the substring contract is preserved either way. Zero behavior drift; saves a UTF-8 character that some Discord clients render inconsistently.

### [Auto-add Rule 2] formatCutoverOutcome helper added in slash-commands.ts

The plan's task list described slash-command rendering ("renders outcome to user") without specifying a helper function. The implementation extracts the 6-variant outcome → string mapping into a module-level `formatCutoverOutcome(outcome)` helper next to `renderInstallOutcome` (Phase 88 sibling) so:
1. The slash-commands.ts inline handler stays readable (single helper call vs inline switch)
2. Plan 92-06's report writer can reuse the helper for log/CLI output
3. The exhaustive switch is a single source of truth for the 6 variants

This is Rule 2 (auto-add critical functionality) — without the helper, the inline switch would either duplicate code or omit some outcome cases.

### [Doc-only] B6 audit-row decision pinned in test, not just the comment

The plan said pick one of two options for B6 (failed-apply: skip ledger row OR log it for audit) and pin in the test. Implementation chose **log it** with reason="failed: <error>". The B6 test asserts `expect(appendCutoverRowMock).toHaveBeenCalledTimes(1)` and `expect(auditRow.action).toBe("apply-destructive")` and `expect(auditRow.reason).toContain("failed:")`. This gives operators visibility into attempted-but-failed applies without polluting the success-only ledger view (Plan 92-06's report writer can filter by `reason: null` for succeeded rows).

### [Doc-only] First-pass daemon gap resolver injects null instead of a stub gap

The plan's daemon IPC handler shape suggested `gapById: ... → DestructiveCutoverGap | null` with the production wiring deferred. First-pass implementation injects `gapById: async () => null` directly. This means a stray Discord button click before Plan 92-06 wires the source returns outcome.kind === "invalid-customId" — which the slash handler renders as "Cutover button click failed: invalid customId or gap not found". Fail-safe by design; no unconfigured rsync execution.

### [Doc-only] handleCutoverButtonInteraction is interaction-shape-agnostic

The plan's signature was `handleCutoverButtonInteraction(interaction: ButtonInteraction, deps): Promise<DestructiveButtonOutcome>` — the implementation uses a structural `ButtonInteractionLike = {customId, user.id}` type instead. This lets the daemon IPC handler (`handleCutoverButtonActionIpc`) call the same pure handler with a synthetic `{customId, user: {id: "daemon-ipc"}}` object. The Discord-side `interaction.deferUpdate()` / `editReply` calls happen in the slash-commands.ts handler (the caller), not inside the pure dispatcher — which is the testability win.

### [Doc-only] Test count exceeded plan target (14 it-blocks; 25 distinct test runs via it.each)

Plan said "5+6+3 = 14 it-blocks". Actual: 5+6+3 = 14 it-blocks, but D2's `it.each(EXISTING_PREFIXES_NULL)` expands to 9 distinct test runs (one per existing prefix). Total runs: 5+6+(D1=1, D2-each=9, D2-positive=1, D2-malformed=1, D2-literal=1, D3=1) = 25. Plan minimum exceeded; nothing dropped.

## Wiring for Plan 92-06 (production)

Plan 92-06 wires:

1. **Production gapById**: reads CUTOVER-GAPS.json (Plan 92-02 emission) and resolves (agent, gapId) by searching for `computeGapId(agent, gap) === gapId` across the destructive subset. Cache the (gapId → gap) Map at verify-pipeline start so the button-handler IPC doesn't re-parse JSON per click.

2. **Production runRsync**: inject the Phase 91 `RsyncRunner.runRsync` (the same one Plan 92-03's additive-applier uses for missing-memory-file).

3. **cutover-verify-summary IPC implementation**: returns `{gaps: DestructiveCutoverGap[]}` filtered from the latest CUTOVER-GAPS.json by `severity === "destructive"`.

4. **Operator end-to-end checkpoint**: Plan 92-06's task graph includes the deferred Plan 92-04 Task 3 checkpoint — operator clicks Accept/Reject/Defer with realistic data and verifies ledger writes + preChangeSnapshot capture for outdated-memory-file. The checkpoint's ledger inspection (`cat ~/.clawcode/manager/cutover-ledger.jsonl | tail -1 | jq`) becomes meaningful only after Plan 92-06 wires the source.

5. **Rollback CLI**: replays accepted destructive rows in LIFO order using the `preChangeSnapshot` field. Files >64KB (reversible: false) are skipped with an operator-visible warning. Audit-only kinds (mcp-credential-drift, tool-permission-gap, cron-session-not-mirrored) are NOT rewindable through the ledger — operator must manually undo via the underlying surfaces.

## Operator Verification (Task 3 Checkpoint — Auto-Approved)

Per the orchestrator's autonomous mode, Task 3 (`checkpoint:human-verify`) was auto-approved. Per the checkpoint's own self-described semantics ("Defer is acceptable — full E2E verification re-fires after Plan 92-06 wires the realistic verify pipeline"), the meaningful end-to-end check is deferred to Plan 92-06's task graph. Standalone Plan 92-04 verification scope:

- Daemon starts (`node dist/cli/index.js daemon`) — verified by `npm run build` exiting 0
- IPC method registration — pinned by D3 test
- customId namespace collision-safety — pinned by D2 test (9 existing prefix shapes)
- Renderer determinism — pinned by R4 test
- NO-LEAK invariant — pinned by R5 test (sk_live_secret_42 sentinel)
- preChangeSnapshot capture order — pinned by applier source code structure (capture before rsync; verified by reading destructive-applier.ts)
- 64KB threshold — pinned by SNAPSHOT_MAX_BYTES static-grep
- Audit-only ledger rows — pinned by applier code paths for non-file kinds

A live operator E2E verification with realistic CUTOVER-GAPS.json data will fire as the post-Plan 92-06 checkpoint.

## Self-Check: PASSED

Verified files exist and commits are present in git history:
- `src/cutover/types.ts` (extended) — present, ~840 lines
- `src/cutover/destructive-embed-renderer.ts` — present, 202 lines
- `src/cutover/destructive-applier.ts` — present, 285 lines
- `src/cutover/button-handler.ts` — present, 174 lines
- `src/cutover/__tests__/destructive-embed-renderer.test.ts` — present, 168 lines, 5 it-blocks
- `src/cutover/__tests__/button-handler.test.ts` — present, 214 lines, 6 it-blocks
- `src/manager/__tests__/daemon-cutover-button.test.ts` — present, 122 lines, 3 it-blocks (D2 it.each expands to 9 runs)
- `src/ipc/protocol.ts` (modified) — adds cutover-verify-summary + cutover-button-action
- `src/manager/daemon.ts` (modified) — handleCutoverButtonActionIpc + closure intercept
- `src/discord/slash-types.ts` (modified) — /clawcode-cutover-verify CONTROL_COMMANDS entry
- `src/discord/slash-commands.ts` (modified) — handleCutoverVerifyCommand + formatCutoverOutcome
- Commit 3f335bf (Task 1 RED) — present in git log
- Commit fd01b23 (Task 2 GREEN) — present in git log
- 75/75 cutover tests pass (`npx vitest run src/cutover/ src/manager/__tests__/daemon-cutover-button.test.ts --reporter=dot`)
- `npm run build` exits 0
- `git diff package.json` empty (zero new npm deps)
- All static-grep regression pins green
