---
phase: 28-security-execution-approval
plan: 01
subsystem: security
tags: [allowlist, glob-matching, acl, audit-log, jsonl, zod]

requires: []
provides:
  - Security type definitions (AllowlistEntry, ApprovalDecision, ApprovalAuditEntry, ChannelAcl, SecurityPolicy, CommandCheckResult)
  - Pattern-based command allowlist matcher with glob support
  - SECURITY.md ACL parser for channel access control
  - JSONL approval audit log with allow-always persistence
  - Config schema extension for per-agent security.allowlist
affects: [28-02, execution-approval, agent-security]

tech-stack:
  added: []
  patterns: [glob-to-regex command matching, line-based markdown parsing, JSONL audit log per AuditTrail pattern]

key-files:
  created:
    - src/security/types.ts
    - src/security/allowlist-matcher.ts
    - src/security/allowlist-matcher.test.ts
    - src/security/acl-parser.ts
    - src/security/acl-parser.test.ts
    - src/security/approval-log.ts
    - src/security/approval-log.test.ts
  modified:
    - src/config/schema.ts
    - src/shared/types.ts

key-decisions:
  - "Glob patterns converted to RegExp by escaping special chars then replacing * with .* -- simple and sufficient for command matching"
  - "ACL parser uses line-based parsing instead of full YAML parser -- lightweight and avoids dependency"
  - "Channels with no ACL entry are open by default -- secure by allowing explicit restriction only"
  - "Allow-always entries stored as regular audit entries with decision=allow-always in command field"

patterns-established:
  - "Security module pattern: types.ts defines all types, functional matchers, class wrappers for stateful operations"
  - "Line-based markdown parsing for structured data in .md files"

requirements-completed: [EXEC-01, EXEC-03, EXEC-04, SECR-01]

duration: 3min
completed: 2026-04-09
---

# Phase 28 Plan 01: Security Foundation Summary

**Glob-based command allowlist matcher, SECURITY.md channel ACL parser, and JSONL approval audit log with allow-always persistence**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-09T20:54:48Z
- **Completed:** 2026-04-09T20:57:31Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Security type system with AllowlistEntry, ApprovalDecision, ApprovalAuditEntry, ChannelAcl, SecurityPolicy, and CommandCheckResult
- Glob-style command matching (matchCommand + AllowlistMatcher class with allow-always support)
- SECURITY.md parser extracting channel ACLs with open-by-default policy
- JSONL approval audit log following existing AuditTrail pattern
- Config schema extended with optional per-agent security.allowlist field
- 31 tests passing across 3 test files

## Task Commits

Each task was committed atomically:

1. **Task 1: Security types, config schema extension, and allowlist matcher** - `bf507f5` (feat)
2. **Task 2: SECURITY.md ACL parser and approval audit log** - `8a1a2ff` (feat)

## Files Created/Modified
- `src/security/types.ts` - Security type definitions (AllowlistEntry, ApprovalDecision, etc.)
- `src/security/allowlist-matcher.ts` - Pattern-based command matching with glob support
- `src/security/allowlist-matcher.test.ts` - 13 tests for allowlist matcher
- `src/security/acl-parser.ts` - SECURITY.md parser for channel ACLs
- `src/security/acl-parser.test.ts` - 12 tests for ACL parser and checkChannelAccess
- `src/security/approval-log.ts` - JSONL approval audit log with allow-always persistence
- `src/security/approval-log.test.ts` - 6 tests for approval log
- `src/config/schema.ts` - Added allowlistEntrySchema, securityConfigSchema, security field on agentSchema
- `src/shared/types.ts` - Added optional security field to ResolvedAgentConfig

## Decisions Made
- Glob patterns converted to RegExp by escaping special chars then replacing * with .* -- simple and sufficient for command matching
- ACL parser uses line-based parsing instead of full YAML parser -- lightweight and avoids dependency
- Channels with no ACL entry are open by default -- secure by allowing explicit restriction only
- Allow-always entries stored as regular audit entries with decision=allow-always in command field

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed ACL parser regex for multi-line channel blocks**
- **Found during:** Task 2 (ACL parser implementation)
- **Issue:** Original regex-based block matching failed to capture users/roles on lines following the channel declaration
- **Fix:** Rewrote to line-based state machine parser that flushes channel blocks on encountering next channel or end of section
- **Files modified:** src/security/acl-parser.ts
- **Verification:** All 12 ACL parser tests pass including multi-field channel entries
- **Committed in:** 8a1a2ff (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Bug fix necessary for correctness. No scope creep.

## Issues Encountered
None beyond the auto-fixed regex issue above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All security primitives ready for Plan 02 integration into daemon, bridge, and CLI
- Types, matcher, parser, and audit log are fully tested and exported
- Config schema accepts per-agent security.allowlist arrays

---
*Phase: 28-security-execution-approval*
*Completed: 2026-04-09*
