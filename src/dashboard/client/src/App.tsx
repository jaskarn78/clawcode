/**
 * Phase 116 App shell. Path↔view sync via pushState + popstate (no
 * react-router). 116-06 extends the view enum with `audit` (F23) and
 * `graph` (F24); heavy routes lazy-load.
 *
 * View enum (116-06):
 *   - 'dashboard'      → FleetLayout (Tier 1 — agent tile grid; default)
 *   - 'fleet'          → FleetComparisonTable (F16 — 116-05)
 *   - 'costs'          → CostDashboard (F17 — 116-05, lazy)
 *   - 'conversations'  → ConversationsView (F27 — 116-03)
 *   - 'tasks'          → TaskKanban (F28 — 116-03)
 *   - 'audit'          → AuditLogViewer (F23 — 116-06, lazy)
 *   - 'graph'          → GraphRoute (F24 — 116-06, lazy)
 *
 * Header (116-06):
 *   - Nav strip (left)
 *   - Telemetry badge + notification bell + theme toggle (right)
 *
 * Path mapping (116-06):
 *   /dashboard/v2                → 'dashboard' (default)
 *   /dashboard/v2/fleet          → 'fleet'
 *   /dashboard/v2/costs          → 'costs'
 *   /dashboard/v2/conversations  → 'conversations'
 *   /dashboard/v2/tasks          → 'tasks'
 *   /dashboard/v2/audit          → 'audit'
 *   /dashboard/v2/graph          → 'graph'
 * Unknown paths fall back to 'dashboard'.
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
import { NotificationFeed } from './components/NotificationFeed'
import { ThemeToggle } from './components/ThemeToggle'
import { TelemetryBadge, useDashboardPageViewEmit } from './components/TelemetryBadge'
import { DashboardErrorBoundary } from './components/DashboardErrorBoundary'
import { Button } from '@/components/ui/button'

// Recharts is heavy (~70KB minified). Lazy-load the cost dashboard so the
// eager bundle for the default Tier 1 view stays inside the plan budget.
const CostDashboard = lazy(() =>
  import('./components/CostDashboard').then((m) => ({
    default: m.CostDashboard,
  })),
)
// 116-06 — heavy lazy routes. AuditLogViewer pulls the audit list +
// filter UI; GraphRoute pulls the D3.js re-skin. Both kept off the
// cold-load bundle.
const AuditLogViewer = lazy(() =>
  import('./components/AuditLogViewer').then((m) => ({
    default: m.AuditLogViewer,
  })),
)
const GraphRoute = lazy(() =>
  import('./routes/graph').then((m) => ({ default: m.GraphRoute })),
)

export type DashboardView =
  | 'dashboard'
  | 'fleet'
  | 'costs'
  | 'conversations'
  | 'tasks'
  | 'audit'
  | 'graph'

const PATH_TO_VIEW: Record<string, DashboardView> = {
  '/dashboard/v2': 'dashboard',
  '/dashboard/v2/': 'dashboard',
  '/dashboard/v2/dashboard': 'dashboard',
  '/dashboard/v2/fleet': 'fleet',
  '/dashboard/v2/costs': 'costs',
  '/dashboard/v2/conversations': 'conversations',
  '/dashboard/v2/tasks': 'tasks',
  '/dashboard/v2/audit': 'audit',
  '/dashboard/v2/graph': 'graph',
}

const VIEW_TO_PATH: Record<DashboardView, string> = {
  dashboard: '/dashboard/v2',
  fleet: '/dashboard/v2/fleet',
  costs: '/dashboard/v2/costs',
  conversations: '/dashboard/v2/conversations',
  tasks: '/dashboard/v2/tasks',
  audit: '/dashboard/v2/audit',
  graph: '/dashboard/v2/graph',
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

  // 116-06 T07 — emit `dashboard_v2_page_view` once per view change.
  useDashboardPageViewEmit(view)

  // Centralized view-setter that also updates the URL via pushState.
  const navigate = (next: DashboardView): void => {
    const targetPath = VIEW_TO_PATH[next]
    if (window.location.pathname !== targetPath) {
      window.history.pushState({ view: next }, '', targetPath)
    }
    setView(next)
  }

  return (
    <DashboardErrorBoundary>
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
          <ViewButton
            active={view === 'audit'}
            onClick={() => navigate('audit')}
          >
            Audit
          </ViewButton>
          <ViewButton
            active={view === 'graph'}
            onClick={() => navigate('graph')}
          >
            Graph
          </ViewButton>
          {/* Right side — telemetry badge + notification bell + theme toggle. */}
          <div className="ml-auto flex items-center gap-1">
            <TelemetryBadge />
            <NotificationFeed />
            <ThemeToggle />
          </div>
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
      {view === 'audit' && (
        <Suspense
          fallback={
            <div className="mx-auto max-w-7xl p-4 text-sm text-fg-3">
              Loading audit log…
            </div>
          }
        >
          <AuditLogViewer />
        </Suspense>
      )}
      {view === 'graph' && (
        <Suspense
          fallback={
            <div className="mx-auto max-w-7xl p-4 text-sm text-fg-3">
              Loading knowledge graph…
            </div>
          }
        >
          <GraphRoute />
        </Suspense>
      )}

      {/* F26 ConfigEditor overlay — null agent = closed. */}
      <ConfigEditor
        agentName={editingAgent}
        open={editingAgent !== null}
        onOpenChange={(open) => {
          if (!open) setEditingAgent(null)
        }}
      />

      {/* F11 AgentDetailDrawer mounted at root so any entry point can open it. */}
      <AgentDetailDrawer
        agentName={drawerAgent}
        open={drawerAgent !== null}
        onOpenChange={(open) => {
          if (!open) setDrawerAgent(null)
        }}
        onEditConfig={(name) => setEditingAgent(name)}
      />

      {/* Cmd+K palette mounted at root. */}
      <CommandPalette
        onSelectAgent={(name) => setDrawerAgent(name)}
        onOpenConfig={(name) => setEditingAgent(name)}
      />
    </DashboardErrorBoundary>
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
