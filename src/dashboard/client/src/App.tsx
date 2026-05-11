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
 *
 * Phase 116-04 — adds the F11 AgentDetailDrawer at root. Three entry points
 * unify on `setDrawerAgent`:
 *   - AgentTile click       → FleetLayout → AgentTileGrid → AgentTile onSelect
 *   - SloBreachBanner link  → FleetLayout → openAgentDrawer
 *   - Cmd+K palette select  → CommandPalette → onSelectAgent
 */
import { useState } from 'react'
import { useSseBridge } from './hooks/useSse'
import { FleetLayout } from './layouts/FleetLayout'
import { CommandPalette } from './components/CommandPalette'
import { ConfigEditor } from './components/ConfigEditor'
import { ConversationsView } from './components/ConversationsView'
import { TaskKanban } from './components/TaskKanban'
import { AgentDetailDrawer } from './components/AgentDetailDrawer'
import { Button } from '@/components/ui/button'

export type DashboardView = 'fleet' | 'conversations' | 'tasks'

function App() {
  // Singleton SSE bridge — `/api/events` → TanStack Query cache fan-out.
  // Mount once at the root so every deep consumer of useAgents() etc. shares
  // the same push-driven invalidation surface.
  useSseBridge()

  const [view, setView] = useState<DashboardView>('fleet')
  const [editingAgent, setEditingAgent] = useState<string | null>(null)
  // Phase 116-04 — F11 drawer state. `null` = closed; non-null = open
  // for that agent.
  const [drawerAgent, setDrawerAgent] = useState<string | null>(null)

  return (
    <>
      {/* Phase 116-03 view-mode tab strip. Lives above FleetLayout so the
          existing header (inside FleetLayout) doesn't have to reach up
          into App state. Router-free; minimal surface. */}
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
        <FleetLayout
          onEditAgent={(name) => setEditingAgent(name)}
          onSelectAgent={(name) => setDrawerAgent(name)}
        />
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

      {/* Phase 116-04 F11 — agent detail drawer mounted at root so any
          entry point (tile click, SLO banner, Cmd+K) can open it. */}
      <AgentDetailDrawer
        agentName={drawerAgent}
        open={drawerAgent !== null}
        onOpenChange={(open) => {
          if (!open) setDrawerAgent(null)
        }}
        onEditConfig={(name) => setEditingAgent(name)}
      />

      {/* Phase 116-02 F06 — Cmd+K palette mounted at root so the global
          keyboard listener works regardless of view mode (Basic/Advanced)
          or sub-component focus state. 116-03 routes "Edit config <agent>"
          through the optional onOpenConfig prop. 116-04 routes the
          "jump-to-agent" target through the drawer. */}
      <CommandPalette
        onSelectAgent={(name) => setDrawerAgent(name)}
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
