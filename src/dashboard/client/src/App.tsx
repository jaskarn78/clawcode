/**
 * Phase 116 Plan 01 — App shell.
 *
 * Mounts the SSE singleton bridge once at the React root and delegates
 * everything else to <FleetLayout />. The shell is intentionally thin so
 * future routing (Tier 2 onwards) can wrap FleetLayout in a Router without
 * disturbing the data-bridge contract.
 *
 * Phase 116-03 — adds top-level view-state navigation (no router yet):
 *   - 'fleet'         → FleetLayout (Tier 1 surface)
 *   - 'conversations' → ConversationsView (F27)
 *   - 'tasks'         → TaskKanban (F28)
 *
 * F26 ConfigEditor opens as a Dialog overlaid on whichever view is active —
 * no view-switch required. CommandPalette stays mounted at root so Cmd+K
 * works regardless of which view the operator is on.
 */
import { useState } from 'react'
import { useSseBridge } from './hooks/useSse'
import { FleetLayout } from './layouts/FleetLayout'
import { CommandPalette } from './components/CommandPalette'
import { ConfigEditor } from './components/ConfigEditor'
import { ConversationsView } from './components/ConversationsView'
import { TaskKanban } from './components/TaskKanban'
import { Button } from '@/components/ui/button'

export type DashboardView = 'fleet' | 'conversations' | 'tasks'

function App() {
  // Singleton SSE bridge — `/api/events` → TanStack Query cache fan-out.
  // Mount once at the root so every deep consumer of useAgents() etc. shares
  // the same push-driven invalidation surface.
  useSseBridge()

  const [view, setView] = useState<DashboardView>('fleet')
  const [editingAgent, setEditingAgent] = useState<string | null>(null)

  return (
    <>
      {/* Phase 116-03 view-mode tab strip. Lives above FleetLayout so the
          existing header (inside FleetLayout) doesn't have to reach up
          into App state. Router-free; minimal surface. 116-04 may replace
          this with react-router when the per-agent detail drawer ships. */}
      <div className="border-b bg-background/60 px-4 py-2">
        <div className="mx-auto flex max-w-7xl items-center gap-2 text-sm">
          <ViewButton active={view === 'fleet'} onClick={() => setView('fleet')}>
            Fleet
          </ViewButton>
          <ViewButton
            active={view === 'conversations'}
            onClick={() => setView('conversations')}
          >
            Conversations
          </ViewButton>
          <ViewButton active={view === 'tasks'} onClick={() => setView('tasks')}>
            Tasks
          </ViewButton>
        </div>
      </div>

      {view === 'fleet' && (
        <FleetLayout onEditAgent={(name) => setEditingAgent(name)} />
      )}
      {view === 'conversations' && <ConversationsView />}
      {view === 'tasks' && <TaskKanban />}

      {/* F26 ConfigEditor overlay — null agent = closed. */}
      <ConfigEditor
        agentName={editingAgent}
        open={editingAgent !== null}
        onOpenChange={(open) => {
          if (!open) setEditingAgent(null)
        }}
      />

      {/* Phase 116-02 F06 — Cmd+K palette mounted at root so the global
          keyboard listener works regardless of view mode (Basic/Advanced)
          or sub-component focus state. 116-03 also routes "Edit config <agent>"
          through here via the optional onOpenConfig prop. */}
      <CommandPalette
        onSelectAgent={(name) => {
          // eslint-disable-next-line no-console
          console.info(
            `[clawcode-dashboard] command palette: jump-to-agent (${name}) — drawer wires in 116-04.`,
          )
        }}
        onOpenConfig={(name) => setEditingAgent(name)}
      />
    </>
  )
}

function ViewButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      variant={active ? 'default' : 'ghost'}
      size="sm"
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

export default App
