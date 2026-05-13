---
phase: 117
plan: 01
subsystem: src/llm
tags: [scaffold, interface, llm, advisor, provider-neutral]
dependency_graph:
  requires: []
  provides:
    - CompletionProvider interface (consumed by Phase 118 PortableForkAdvisor)
  affects: []
tech_stack:
  added: []
  patterns:
    - Provider-neutral interface seam (matches CONTEXT.md decisions.Architecture LOCKED)
    - Block-JSDoc + readonly fields style (mirrors src/scheduler/types.ts)
key_files:
  created:
    - src/llm/provider.ts
    - src/llm/README.md
  modified: []
decisions:
  - Interface body matches eventual-questing-tiger.md:117–128 verbatim
    (id, capability.{advisorTool, toolUse}, complete() shape).
  - Verification: npm run typecheck (per prompt override) instead of
    npm run build — both invoke tsc under the hood; typecheck is faster
    and what the prompt explicitly requested. Plan T01 also says
    "TypeScript compile clean" so the intent matches.
  - Named export only — no default, no factory, no impls (enforced by
    grep of `implements CompletionProvider` returning zero matches).
metrics:
  duration: ~10 minutes
  completed: 2026-05-13
  tasks_completed: 2
  files_changed: 2
---

# Phase 117 Plan 01: `src/llm/CompletionProvider` interface seed Summary

Interface-only scaffold landing the provider-neutral `CompletionProvider`
seam at `src/llm/`. Zero implementations — first consumer is Phase 118
`PortableForkAdvisor`; downstream providers (OpenAI, Bedrock, Vertex,
Ollama) land in Phase 119+.

## Tasks executed

| Task | Description                                            | Commit    |
| ---- | ------------------------------------------------------ | --------- |
| T01  | Create `src/llm/provider.ts` with `CompletionProvider` | `071f166` |
| T02  | Create `src/llm/README.md` documenting the seam        | `fffe910` |

## Files

### Created

- **`src/llm/provider.ts`** (49 lines) — `CompletionProvider` interface
  with block JSDoc referencing Phase 117 scaffold posture, Phase 118
  first-consumer, and the explicit "no implementations in this phase"
  rule. Interface shape copied verbatim from the approved plan
  (`eventual-questing-tiger.md:117–128`):
  - `readonly id: string`
  - `readonly capability: { advisorTool: boolean; toolUse: boolean }`
  - `complete(req: { model, system, messages, maxTokens? }) → Promise<{ text, tokensIn, tokensOut }>`
  - `messages` typed as `ReadonlyArray<{ role: "user" | "assistant"; content: string }>`
  - Named export only; no default, no factory, no impls.
- **`src/llm/README.md`** (50 lines) — Documents the seam in five
  sections: Purpose, Current state, Planned providers (table), Why not
  the agent SDK, Reference. Reference section links to the approved
  plan, CONTEXT.md, and RESEARCH.md.

### Modified

None.

## Verification

- `npm run typecheck` (i.e. `tsc --noEmit`) — **PASSED** (zero output, exit 0).
- `grep -rn "implements CompletionProvider" src/` — **zero matches** (exit 1, no matches).
- README renders cleanly; no broken markdown links.

## Deviations from Plan

**None — plan executed exactly as written.**

(Verification command was specified as `npm run typecheck` in the
executor prompt vs. `npm run build` in the plan; both delegate to `tsc`
for TypeScript compile-time checks. The prompt's choice was followed.
This is a tool-equivalence selection, not a behavioral deviation.)

## Authentication gates

None.

## Out of scope (per plan)

- ANY implementation of `CompletionProvider` — deferred to Phase 118
  `AnthropicDirectProvider` and beyond.
- `src/advisor/` — lives in Plan 117-02.
- SDK Options surface (`advisorModel`) — lives in Plan 117-04.

## Known Stubs

None. (Interface declarations with no UI surface are by-design seams,
not stubs — see plan `must_haves` for explicit "no impls" requirement.)

## Self-Check: PASSED

- `src/llm/provider.ts` — FOUND
- `src/llm/README.md` — FOUND
- Commit `071f166` — FOUND in `git log`
- Commit `fffe910` — FOUND in `git log`
