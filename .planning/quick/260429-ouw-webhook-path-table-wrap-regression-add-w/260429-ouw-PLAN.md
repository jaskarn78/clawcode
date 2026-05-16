---
phase: 260429-ouw-webhook-path-table-wrap-regression
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/discord/webhook-manager.ts
  - src/discord/__tests__/webhook-manager.test.ts
autonomous: false
requirements:
  - WEBHOOK-WRAP-01
must_haves:
  truths:
    - "All callers of webhookManager.send have raw markdown tables wrapped in ```text fences before posting to Discord (bridge.ts:917 sendDirect fallback, daemon.ts:3544, usage/daily-summary.ts:111)"
    - "wrapMarkdownTablesInCodeFence is idempotent — already-fenced tables are NOT double-wrapped"
    - "Existing webhookManager.send behavior preserved: chunking, multi-chunk dispatch, identity, structured log line"
    - "Production prod (clawdy host) restarts cleanly and Admin Clawdy's table responses render as monospace code fences"
  artifacts:
    - path: src/discord/webhook-manager.ts
      provides: "Webhook send with table wrapping baked in"
      contains: "wrapMarkdownTablesInCodeFence"
    - path: src/discord/__tests__/webhook-manager.test.ts
      provides: "Regression test asserting send wraps tables before posting"
      contains: "wraps markdown tables"
  key_links:
    - from: src/discord/webhook-manager.ts
      to: src/discord/markdown-table-wrap.ts
      via: "import wrapMarkdownTablesInCodeFence; called inside send() before splitMessage"
      pattern: "wrapMarkdownTablesInCodeFence\\(content\\)"
    - from: src/discord/__tests__/webhook-manager.test.ts
      to: src/discord/webhook-manager.ts
      via: "vitest assertion that mock WebhookClient.send receives fenced content for table input"
      pattern: "```text"
---

<objective>
Phase 100-fu wired wrapMarkdownTablesInCodeFence into bridge.ts:586 (bot direct send), slash-commands.ts (2 spots), and subagent-thread-spawner.ts (2 spots), but missed three webhook send paths: bridge.ts:917 (sendDirect fallback), daemon.ts:3544, and usage/daily-summary.ts:111. Operator confirmed Admin Clawdy (webhook display name "ClawdyV2") posted markdown tables that rendered as raw text in Discord — a regression visible to end users.

Single-point fix: call wrapMarkdownTablesInCodeFence inside webhookManager.send so all three callers get the wrap automatically. The wrap is pure + idempotent (line 41 of markdown-table-wrap.ts), so calling it on already-wrapped content is a no-op.

Purpose: Close the table-readability regression for every webhook path with one change rather than threading the wrap through three separate call sites.

Output:
- src/discord/webhook-manager.ts modified — send() wraps content before chunking
- src/discord/__tests__/webhook-manager.test.ts created — regression test asserting webhook delivery wraps tables
- Build green, prod deployed, Admin Clawdy table render verified
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md
@src/discord/webhook-manager.ts
@src/discord/markdown-table-wrap.ts
@src/discord/__tests__/markdown-table-wrap.test.ts

<interfaces>
<!-- Key contracts the executor needs. Extracted from the source files. -->

From src/discord/markdown-table-wrap.ts:
```typescript
// Pure, idempotent. Already-fenced tables pass through unchanged.
export function wrapMarkdownTablesInCodeFence(content: string): string;
```

From src/discord/webhook-manager.ts (current — to be modified):
```typescript
async send(agentName: string, content: string): Promise<void> {
  const identity = this.identities.get(agentName);
  if (!identity) {
    throw new Error(`No webhook identity configured for agent '${agentName}'`);
  }
  const client = this.getOrCreateClient(agentName, identity.webhookUrl);
  const chunks = splitMessage(content, MAX_MESSAGE_LENGTH);
  for (const chunk of chunks) {
    await client.send({
      content: chunk,
      username: identity.displayName,
      avatarURL: identity.avatarUrl ?? undefined,
    });
  }
  this.log.info(
    { agent: agentName, chunks: chunks.length },
    "webhook message sent",
  );
}
```

Test pattern from src/discord/__tests__/markdown-table-wrap.test.ts (mirror structure for the new test):
- vitest, describe/it/expect
- Use a real markdown table fixture (header row + `|---|---|` separator + rows)
- Assert `result.includes("```text")` and that headers/rows survive
</interfaces>

<callers>
The three webhook callers that benefit automatically — DO NOT modify these, just verify the fix flows through:
- src/discord/bridge.ts:917 — sendDirect fallback when agent has webhook
- src/manager/daemon.ts:3544 — daemon-side webhook dispatch
- src/usage/daily-summary.ts:111 — daily-summary webhook post (most likely culprit for the operator's screenshot since it emits tables)
</callers>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: RED — failing regression test, then GREEN — wrap inside webhookManager.send</name>
  <files>src/discord/__tests__/webhook-manager.test.ts, src/discord/webhook-manager.ts</files>
  <behavior>
    - Test WHM-WRAP-1: when send() is called with content containing a raw markdown table (`| Col | Col |\n| --- | --- |\n| A | B |`), the chunk passed to the underlying WebhookClient.send MUST contain ```text``` fence markers AND the original table rows.
    - Test WHM-WRAP-2: when send() is called with content already wrapped in ```text``` fences, the wrap is idempotent — content reaches WebhookClient.send unchanged (no double-wrap, no nested fences).
    - Test WHM-WRAP-3: when send() is called with pure prose (no tables), the content reaches WebhookClient.send unchanged byte-for-byte.
    - Existing chunking + identity + log behavior preserved (verify identity.displayName + identity.avatarUrl reach WebhookClient.send).
  </behavior>
  <action>
    Step 1 (RED) — write the test FIRST:
    Create `src/discord/__tests__/webhook-manager.test.ts` mirroring the vitest structure of `markdown-table-wrap.test.ts`. Mock the discord.js `WebhookClient` constructor so its `send` method is a vi.fn() that captures the `{ content, username, avatarURL }` payload. Build a `WebhookManager` with a one-entry identities map (e.g. `{ name: "test-agent", displayName: "TestBot", avatarUrl: "https://x/y.png", webhookUrl: "https://discord.com/api/webhooks/0/abc" }`). Run the three behaviors above. Run `npm test -- webhook-manager` (or `npx vitest run src/discord/__tests__/webhook-manager.test.ts`) and CONFIRM the wrap test fails (red).

    Step 2 (GREEN) — modify src/discord/webhook-manager.ts:
    1. Add import at top alongside existing imports:
       `import { wrapMarkdownTablesInCodeFence } from "./markdown-table-wrap.js";`
    2. Inside `async send(agentName, content)`, after the identity lookup but BEFORE `splitMessage(content, MAX_MESSAGE_LENGTH)`, replace the chunking line with:
       ```typescript
       const wrapped = wrapMarkdownTablesInCodeFence(content);
       const chunks = splitMessage(wrapped, MAX_MESSAGE_LENGTH);
       ```
    3. Do NOT modify `sendAsAgent` (it sends embeds, not raw markdown content — embeds render their own structure). Out of scope.
    4. Re-run the test suite. All three new tests pass; existing tests stay green.

    Per the operator-verified failure mode (Admin Clawdy / ClawdyV2 webhook posted raw `| col | col |` tables), this addresses WEBHOOK-WRAP-01 by closing the gap left by Phase 100-fu (commit 3fde435). The wrap is documented idempotent, so the three downstream callers (bridge.ts:917, daemon.ts:3544, daily-summary.ts:111) need zero changes — the fix flows through the single mutation point.

    Mocking note: `discord.js` exports `WebhookClient` as a class. Use `vi.mock("discord.js", () => ({ WebhookClient: vi.fn().mockImplementation(() => ({ send: vi.fn().mockResolvedValue({ id: "msg-id" }), destroy: vi.fn() })) }))` and assert against the captured `send` calls.
  </action>
  <verify>
    <automated>npx vitest run src/discord/__tests__/webhook-manager.test.ts src/discord/__tests__/markdown-table-wrap.test.ts</automated>
  </verify>
  <done>
    - `src/discord/__tests__/webhook-manager.test.ts` exists with 3+ tests covering wrap, idempotency, prose pass-through.
    - `src/discord/webhook-manager.ts` imports wrapMarkdownTablesInCodeFence and calls it inside send() before chunking.
    - vitest run is fully green for both test files.
    - `npm run build` (or equivalent tsc) reports zero TypeScript errors.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 2: Build, push, deploy on prod, verify Admin Clawdy table render</name>
  <what-built>
    Single-point fix: webhookManager.send now wraps raw markdown tables in ```text``` code fences. All three webhook callers (bridge.ts:917 sendDirect fallback, daemon.ts:3544, usage/daily-summary.ts:111) automatically benefit. New regression test locks the behavior in.
  </what-built>
  <how-to-verify>
    Claude will autonomously perform the build + commit + push + deploy steps below, then pause for the operator to confirm Discord render. Operator only needs to look at Discord after the daemon restarts.

    Claude executes:
    1. Local build: `npm run build` — must exit 0.
    2. Stage + commit:
       ```
       git add src/discord/webhook-manager.ts src/discord/__tests__/webhook-manager.test.ts
       git commit -m "fix(webhook): wrap markdown tables in code fences for webhook sends

       Phase 100-fu wired wrapMarkdownTablesInCodeFence into bot direct
       send (bridge.ts:586), slash-commands, and subagent-thread-spawner,
       but missed three webhook paths: bridge.ts:917 sendDirect fallback,
       daemon.ts:3544, and usage/daily-summary.ts:111. Admin Clawdy
       (webhook ClawdyV2) posted raw \`| col | col |\` tables that rendered
       as literal pipes in Discord.

       Single-point fix inside webhookManager.send — the wrap is pure +
       idempotent so all three downstream callers benefit automatically
       and already-fenced content is preserved.

       Adds regression test asserting send() wraps tables before posting."
       ```
    3. Push: `git push`
    4. Deploy on prod (host jjagpal@100.98.211.108, sudo password 686Shanghai):
       - SSH and `cd /opt/clawcode`
       - `sudo -u clawcode git pull`
       - `sudo -u clawcode npm install` (in case of lockfile drift; skip if package.json untouched)
       - `sudo -u clawcode npm run build`
       - Graceful drain: `sudo -u clawcode /usr/bin/clawcode stop-all`
       - Service restart: `sudo systemctl restart clawcode`
       - Confirm: `sudo systemctl status clawcode --no-pager` (active running)
       - Tail logs briefly: `sudo journalctl -u clawcode -n 50 --no-pager`

    Then OPERATOR verifies in Discord:
    - In Admin Clawdy's channel, ask Admin to produce a markdown table (e.g. "show me a table of agent names and their models").
    - Confirm the response renders as a monospace code block with aligned pipes (NOT raw `| col | col |` text with bold rendering inside cells).
    - Optional spot-check: trigger a daily-summary post (or wait for its cron) and confirm any tables are fenced.
  </how-to-verify>
  <resume-signal>Type "approved" once Discord shows fenced table render. If still raw, paste the new screenshot + Admin Clawdy's response so we can diagnose (likely candidate: response routed through a fourth send path we haven't found yet).</resume-signal>
</task>

</tasks>

<verification>
- vitest: webhook-manager.test.ts and markdown-table-wrap.test.ts both green
- TypeScript build: zero errors
- Production: `systemctl status clawcode` reports active (running)
- Discord: Admin Clawdy table response renders inside ```text``` fence (operator visual confirm)
</verification>

<success_criteria>
1. webhookManager.send wraps raw markdown tables in ```text``` fences before chunking — verified by passing vitest regression suite.
2. Idempotent — calling on already-fenced content is a no-op (no double wrap).
3. All three downstream webhook callers (bridge.ts:917, daemon.ts:3544, daily-summary.ts:111) inherit the fix without modification.
4. Production daemon restarted cleanly with the fix, Admin Clawdy table responses render as monospace code blocks in Discord.
5. Commit landed on master (single commit, single-point change + test).
</success_criteria>

<output>
After completion, create `.planning/quick/260429-ouw-webhook-path-table-wrap-regression-add-w/260429-ouw-SUMMARY.md`
</output>
