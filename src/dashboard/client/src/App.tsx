/**
 * Phase 116 Plan 01 — App shell.
 *
 * Mounts the SSE singleton bridge once at the React root and delegates
 * everything else to the active view component. Top-level navigation is
 * router-free (the SPA is a single Vite-served entry); 116-05 introduces
 * a thin path↔view sync layer so /dashboard/v2/{fleet,costs,...} URLs
 * map to view-state values via pushState + popstate.
 *
 * View enum (116-05):
 *   - 'dashboard'      → FleetLayout (Tier 1 — agent tile grid; default)
 *                        was previously 'fleet'; renamed to free the
 *                        'fleet' identifier for the comparison table.
 *   - 'fleet'          → FleetComparisonTable (F16 — 116-05)
 *   - 'costs'          → CostDashboard (F17 — 116-05, lazy-loaded)
 *   - 'conversations'  → ConversationsView (F27 — 116-03)
 *   - 'tasks'          → TaskKanban (F28 — 116-03)
 *
 * The F26 ConfigEditor + F11 AgentDetailDrawer + Cmd+K palette stay
 * mounted at root so they overlay any active view.
 *
 * Path mapping (116-05):
 *   /dashboard/v2          → 'dashboard' (default)
 *   /dashboard/v2/fleet    → 'fleet'
 *   /dashboard/v2/costs    → 'costs'
 *   /dashboard/v2/conversations → 'conversations'
 *   /dashboard/v2/tasks    → 'tasks'
 * Unknown paths fall back to 'dashboard' silently.
 */
import { lazy, Suspense, useEffect, useState } from 'react'
import { useSseBridge } from './hooks/useSse'
import { FleetLayout } from './layouts/FleetLayout'
import { CommandPalette } from './components/CommandPalette'
import { ConfigEditor } from './components/ConfigEditor'
import { ConversationsView } from './components/ConversationsView'
import { TaskKanban } from './components/TaskKanban'
import { AgentDetailDrawer } from './components/AgentDetailDrawer'
import { FleetComparisonTable } from './components/FleetComparisonTable'
import { Button } from '@/components/ui/button'

// Recharts is heavy (~70KB minified). Lazy-load the cost dashboard so the
// eager bundle for the default Tier 1 view stays inside the plan budget.
const CostDashboard = lazy(() =>
  import('./components/CostDashboard').then((m) => ({
    default: m.CostDashboard,
  })),
)

export type DashboardView =
  | 'dashboard'
  | 'fleet'
  | 'costs'
  | 'conversations'
  | 'tasks'

const PATH_TO_VIEW: Record<string, DashboardView> = {
  '/dashboard/v2': 'dashboard',
  '/dashboard/v2/': 'dashboard',
  '/dashboard/v2/dashboard': 'dashboard',
  '/dashboard/v2/fleet': 'fleet',
  '/dashboard/v2/costs': 'costs',
  '/dashboard/v2/conversations': 'conversations',
  '/dashboard/v2/tasks': 'tasks',
}

const VIEW_TO_PATH: Record<DashboardView, string> = {
  dashboard: '/dashboard/v2',
  fleet: '/dashboard/v2/fleet',
  costs: '/dashboard/v2/costs',
  conversations: '/dashboard/v2/conversations',
  tasks: '/dashboard/v2/tasks',
}

function pathToView(path: string): DashboardView {
  // Normalize trailing slash for direct map lookup, then fall back.
  return PATH_TO_VIEW[path] ?? PATH_TO_VIEW[path.replace(/\/$/, '')] ?? 'dashboard'
}

function App() {
  // Singleton SSE bridge — `/api/events` → TanStack Query cache fan-out.
  useSseBridge()

  const [view, setView] = useState<DashboardView>(() =>
    pathToView(window.location.pathname),
  )
  const [editingAgent, setEditingAgent] = useState<string | null>(null)
  const [drawerAgent, setDrawerAgent] = useState<string | null>(null)

  // Browser-back / browser-forward sync. The history entry holds the
  // view name; popstate flips state to whatever the new entry says.
  useEffect(() => {
    const onPop = (): void => {
      setView(pathToView(window.location.pathname))
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Centralized view-setter that also updates the URL via pushState. We
  // only pushState when the path is actually different so back-button
  // doesn't pick up a duplicate entry per nav click.
  const navigate = (next: DashboardView): void => {
    const targetPath = VIEW_TO_PATH[next]
    if (window.location.pathname !== targetPath) {
      window.history.pushState({ view: next }, '', targetPath)
    }
    setView(next)
  }

  return (
    <>
      <div className="border-b bg-background/60 px-4 py-2">
        <div className="mx-auto flex max-w-7xl items-center gap-2 text-sm">
          <ViewButton
            active={view === 'dashboard'}
            onClick={() => navigate('dashboard')}
          >
            Dashboard
          </ViewButton>
          <ViewButton
            active={view === 'fleet'}
            onClick={() => navigate('fleet')}
          >
            Fleet
          </ViewButton>
          <ViewButton
            active={view === 'costs'}
            onClick={() => navigate('costs')}
          >
            Costs
          </ViewButton>
          <ViewButton
            active={view === 'conversations'}
            onClick={() => navigate('conversations')}
          >
            Conversations
          </ViewButton>
          <ViewButton
            active={view === 'tasks'}
            onClick={() => navigate('tasks')}
          >
            Tasks
          </ViewButton>
        </div>
      </div>

      {view === 'dashboard' && (
        <FleetLayout
          onEditAgent={(name) => setEditingAgent(name)}
          onSelectAgent={(name) => setDrawerAgent(name)}
        />
      )}
      {view === 'fleet' && <FleetComparisonTable />}
      {view === 'costs' && (
        <Suspense
          fallback={
            <div className="mx-auto max-w-7xl p-4 text-sm text-fg-3">
              Loading cost dashboard…
            </div>
          }
        >
          <CostDashboard />
        </Suspense>
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

      {/* F11 AgentDetailDrawer mounted at root so any entry point
          (tile click, SLO banner, Cmd+K) can open it. */}
      <AgentDetailDrawer
        agentName={drawerAgent}
        open={drawerAgent !== null}
        onOpenChange={(open) => {
          if (!open) setDrawerAgent(null)
        }}
        onEditConfig={(name) => setEditingAgent(name)}
      />

      {/* Cmd+K palette mounted at root so the global keyboard listener
          works regardless of view. */}
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
