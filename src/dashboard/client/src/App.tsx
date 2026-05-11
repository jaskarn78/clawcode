/**
 * Phase 116 Plan 01 — App shell.
 *
 * Mounts the SSE singleton bridge once at the React root and delegates
 * everything else to <FleetLayout />. The shell is intentionally thin so
 * future routing (Tier 2 onwards) can wrap FleetLayout in a Router without
 * disturbing the data-bridge contract.
 *
 * Replaces the 116-00 T10 smoke component. The Tier 1 features (F01 SLO
 * breach banner, F03 tile grid, F04 budget meter, F05 cache gauge, F08
 * counters) all hang off FleetLayout — see src/layouts/FleetLayout.tsx.
 */
import { useSseBridge } from './hooks/useSse'
import { FleetLayout } from './layouts/FleetLayout'
import { CommandPalette } from './components/CommandPalette'

function App() {
  // Singleton SSE bridge — `/api/events` → TanStack Query cache fan-out.
  // Mount once at the root so every deep consumer of useAgents() etc. shares
  // the same push-driven invalidation surface.
  useSseBridge()

  return (
    <>
      <FleetLayout />
      {/* Phase 116-02 F06 — Cmd+K palette mounted at root so the global
          keyboard listener works regardless of view mode (Basic/Advanced)
          or sub-component focus state. */}
      <CommandPalette
        onSelectAgent={(name) => {
          // eslint-disable-next-line no-console
          console.info(
            `[clawcode-dashboard] command palette: jump-to-agent (${name}) — drawer wires in 116-04.`,
          )
        }}
      />
    </>
  )
}

export default App
