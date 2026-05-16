---
phase: 105-trigger-policy-default-allow-and-coalescer-storm-fix
plan: "03"
type: execute
status: complete
date: 2026-05-01
deployed-by: bundled into Phase 106 overnight deploy (autonomous, channel-silence gate satisfied 2026-05-01 23:20 PT)
requirements-completed: [POLICY-01, POLICY-02, POLICY-03, COAL-01, COAL-02, COAL-03, COAL-04]
---

# Phase 105 Wave 2: Deploy (retroactive record)

## Outcome

**Phase 105 code shipped as part of the Phase 106 overnight deploy on 2026-05-01.**

The 105-03 plan was never executed as a standalone step — both the POLICY fix (`fix(999.11-01)`, commit `a7a3564`, 2026-04-30) and the coalescer storm fix (`fix(999.11-02)`, commit `fb2a98e`, 2026-04-30) were on master before the Phase 106 Wave 2 deploy ran overnight. The 106 deploy (`rsync dist/ → clawdy:/opt/clawcode/dist/ + systemctl restart`) carried both fixes into production.

Confirmed in prod dist (`ba56faf5`, deployed 2026-05-06 PM session, built from the same master):
- `grep -c "default-allow evaluator" /opt/clawcode/dist/cli/index.js` → **1** ✅
- Coalescer drain-depth / idempotent-wrapper code present in minified bundle ✅

## Post-deploy smoke (from 106-04-SUMMARY.md, same deploy window)

| Check | Result |
|---|---|
| `npm test` suite GREEN | ✅ (verified in 106-04 deploy window) |
| `default-allow evaluator` boot log | ✅ (logged on daemon start when policies.yaml absent) |
| Coalescer storm — no nested `[Combined: …]` wrappers | ✅ (journalctl clean post-deploy) |
| Scheduled cron events dispatched to fin-acquisition | ✅ (09:00 standup cron delivered next day) |

## Notes

- 105-03-PLAN.md has a deploy gate instruction but it was never needed separately — the 106 gate was more stringent and subsumed it.
- Phase 105 is fully complete. ROADMAP checkbox updated to reflect shipped status.
