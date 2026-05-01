// src/heartbeat/check-registry.ts
//
// Phase 999.8 Plan 03 — static heartbeat-check registry.
//
// WHY: tsup builds the daemon with `splitting: false`, bundling only
// `src/cli/index.ts` into a single `dist/cli/index.js`. The pre-Plan-03
// `discoverChecks` did `readdirSync(dist/heartbeat/checks) + import(...)` at
// runtime — but `dist/heartbeat/checks/` never exists in the bundled output,
// so production silently logged `"checkCount":0` on every restart. None of
// the 11 health checks (tier-maintenance, consolidation, mcp-reconnect,
// fs-probe, attachment-cleanup, task-retention, trace-retention, thread-idle,
// context-fill, inbox heartbeat path, auto-linker safety net) ever fired.
//
// FIX: import every check statically. tsup follows the import graph, so each
// check ends up in the bundle. The registry is `Object.freeze`'d to make the
// "constant data" intent explicit and the `readonly CheckModule[]` type
// prevents accidental mutation.
//
// Pitfall 7 (RESEARCH): NO try/catch around the imports. If a check module is
// broken, ESM raises at module-load time and the daemon refuses to start —
// which is the correct, fail-fast behaviour. The pre-Plan-03 silent-skip is
// what enabled the regression to live in prod for so long.
//
// Pitfall 1 (RESEARCH): the registry consumes only the DEFAULT export. inbox.ts
// also exposes a NAMED export `setInboxSourceActive` that daemon.ts:2120
// imports dynamically — that contract is unrelated to the registry and must
// not be perturbed. inbox-named-export.test.ts is the regression guard.
import type { CheckModule } from "./types.js";
import attachmentCleanup from "./checks/attachment-cleanup.js";
import autoLinker from "./checks/auto-linker.js";
import consolidation from "./checks/consolidation.js";
import contextFill from "./checks/context-fill.js";
import fsProbe from "./checks/fs-probe.js";
import inbox from "./checks/inbox.js";
import mcpBroker from "./checks/mcp-broker.js";
import mcpReconnect from "./checks/mcp-reconnect.js";
import taskRetention from "./checks/task-retention.js";
import threadIdle from "./checks/thread-idle.js";
import tierMaintenance from "./checks/tier-maintenance.js";
import traceRetention from "./checks/trace-retention.js";

export const CHECK_REGISTRY: readonly CheckModule[] = Object.freeze([
  attachmentCleanup,
  autoLinker,
  consolidation,
  contextFill,
  fsProbe,
  inbox,
  // Phase 108 — pool liveness probe for the daemon-managed
  // OnePasswordMcpBroker. NEVER calls a tool dispatch path; only reads
  // `broker.getPoolStatus()`. See checks/mcp-broker.ts header.
  mcpBroker,
  mcpReconnect,
  taskRetention,
  threadIdle,
  tierMaintenance,
  traceRetention,
]);
