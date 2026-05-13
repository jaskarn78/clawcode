/**
 * Phase 116 App shell. Path↔view sync via pushState + popstate (no
 * react-router). 116-06 extends the view enum with `audit` (F23) and
 * `graph` (F24); heavy routes lazy-load.
 *
 * View enum (116-postdeploy):
 *   - 'dashboard'      → MissionControlLayout (dash-redesign; Hero +
 *                        Fleet grid + Right rail + MCP strip)
 *   - 'fleet'          → FleetComparisonTable (F16 — 116-05)
 *   - 'usage'          → UsageDashboard (116-postdeploy; was 'costs')
 *   - 'conversations'  → ConversationsView (F27 — 116-03)
 *   - 'tasks'          → TaskKanban (F28 — 116-03)
 *   - 'audit'          → AuditLogViewer (F23 — 116-06, lazy)
 *   - 'graph'          → GraphRoute (F24 — 116-06, lazy)
 *
 * Header (dash-redesign): <MissionHeader> renders once above the view
 * switch — brand + tab nav + heartbeat pill + TelemetryBadge +
 * NotificationFeed + ThemeToggle + settings gear + Cmd+K trigger.
 * FleetLayout is retained on-disk as the legacy safety-net layout
 * but no longer rendered.
 *
 * Path mapping (116-postdeploy):
 *   /dashboard/v2                → 'dashboard' (default)
 *   /dashboard/v2/fleet          → 'fleet'
 *   /dashboard/v2/usage          → 'usage'  (canonical)
 *   /dashboard/v2/costs          → 'usage'  (legacy alias — bookmarks)
 *   /dashboard/v2/conversations  → 'conversations'
 *   /dashboard/v2/tasks          → 'tasks'
 *   /dashboard/v2/audit          → 'audit'
 *   /dashboard/v2/graph          → 'graph'
 * Unknown paths fall back to 'dashboard'.
 *
 * 116-postdeploy: 'costs' → 'usage' rename. The route alias keeps any
 * historical bookmarks pointing at /costs working without a 301 (this is
 * a SPA route, not a server-side path — both paths resolve to the same
 * 'usage' view). Forward nav writes /usage; popstate from old bookmarks
 * back-navigates correctly because the SPA never re-writes the URL on
 * load, only on navigate().
 */
import { lazy, Suspense, useEffect, useState } from 'react'
import { useSseBridge } from './hooks/useSse'
import { MissionControlLayout } from './layouts/MissionControlLayout'
import { MissionHeader } from './components/mission-control/MissionHeader'
import { CommandPalette } from './components/CommandPalette'
import { ConfigEditor } from './components/ConfigEditor'
import { ConversationsView } from './components/ConversationsView'
import { TaskKanban } from './components/TaskKanban'
import { AgentDetailDrawer } from './components/AgentDetailDrawer'
import { SettingsView } from './components/SettingsView'
import { ActionToastHost } from './components/ActionToast'
import { FleetComparisonTable } from './components/FleetComparisonTable'
import { useDashboardPageViewEmit } from './components/TelemetryBadge'
import { DashboardErrorBoundary } from './components/DashboardErrorBoundary'
// dash-redesign — route-scoped stylesheet for the Mission Control layout
// AND header. Imported at the App level so the `.mc-header` styles reach
// MissionHeader (which lives outside MissionControlLayout — header is
// global across every route). Vite hoists this import to the entry
// chunk, so all routes inherit the styles.
import './layouts/mission-control.css'

// Recharts is heavy (~70KB minified). Lazy-load the usage dashboard so the
// eager bundle for the default Tier 1 view stays inside the plan budget.
// (File path unchanged — 116-postdeploy reframed the export under a new
// `UsageDashboard` name but the lazy import target is the same module.)
const UsageDashboard = lazy(() =>
  import('./components/CostDashboard').then((m) => ({
    default: m.UsageDashboard,
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
// 116-postdeploy 2026-05-12 — operator-occasional surfaces. Both pages are
// configuration/observability surfaces hit rarely (per-session, not per-
// view-flip), so they live outside the eager bundle.
const OpenAiView = lazy(() =>
  import('./components/OpenAiView').then((m) => ({ default: m.OpenAiView })),
)
const MemoryView = lazy(() =>
  import('./components/MemoryView').then((m) => ({ default: m.MemoryView })),
)
// 116-postdeploy 2026-05-13 — operator-triggered per-agent benchmarks
// (tool latency rollup + ad-hoc bench run + cross-agent compare + memory-op
// rollup). Recharts is already a code-split chunk; lazy-loading the page
// keeps the cold-load SPA bundle within the 1MB raw / 320KB gzip budget.
const BenchmarksView = lazy(() =>
  import('./components/BenchmarksView').then((m) => ({
    default: m.BenchmarksView,
  })),
)

export type DashboardView =
  | 'dashboard'
  | 'fleet'
  | 'usage'
  | 'conversations'
  | 'tasks'
  | 'audit'
  | 'graph'
  | 'settings'
  | 'openai'
  | 'memory'
  | 'benchmarks'

const PATH_TO_VIEW: Record<string, DashboardView> = {
  '/dashboard/v2': 'dashboard',
  '/dashboard/v2/': 'dashboard',
  '/dashboard/v2/dashboard': 'dashboard',
  '/dashboard/v2/fleet': 'fleet',
  '/dashboard/v2/usage': 'usage',
  // Legacy alias — /costs bookmarks resolve to the Usage view without a
  // server-side 301 (this is SPA-only routing).
  '/dashboard/v2/costs': 'usage',
  '/dashboard/v2/conversations': 'conversations',
  '/dashboard/v2/tasks': 'tasks',
  '/dashboard/v2/audit': 'audit',
  '/dashboard/v2/graph': 'graph',
  '/dashboard/v2/settings': 'settings',
  '/dashboard/v2/openai': 'openai',
  '/dashboard/v2/memory': 'memory',
  '/dashboard/v2/benchmarks': 'benchmarks',
}

const VIEW_TO_PATH: Record<DashboardView, string> = {
  dashboard: '/dashboard/v2',
  fleet: '/dashboard/v2/fleet',
  usage: '/dashboard/v2/usage',
  conversations: '/dashboard/v2/conversations',
  tasks: '/dashboard/v2/tasks',
  audit: '/dashboard/v2/audit',
  graph: '/dashboard/v2/graph',
  settings: '/dashboard/v2/settings',
  openai: '/dashboard/v2/openai',
  memory: '/dashboard/v2/memory',
  benchmarks: '/dashboard/v2/benchmarks',
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
      {/* dash-redesign — top chrome lives in MissionHeader (brand cluster,
          tab nav, heartbeat pill, TelemetryBadge + NotificationFeed +
          ThemeToggle + settings gear). Mounted ONCE here above the view
          switch so every route inherits the new chrome. The previous
          Tailwind-styled chrome (`<div className="border-b …">`) was
          removed wholesale — MissionHeader's `.mc-header` styles (route-
          scoped CSS imported at the top of this file) own the layout. */}
      <MissionHeader active={view} onNavigate={(v) => navigate(v as DashboardView)} />

      {view === 'dashboard' && (
        <MissionControlLayout
          onSelectAgent={(name) => setDrawerAgent(name)}
        />
      )}
      {view === 'fleet' && <FleetComparisonTable />}
      {view === 'usage' && (
        <Suspense
          fallback={
            <div className="mx-auto max-w-7xl p-4 text-sm text-fg-3">
              Loading usage dashboard…
            </div>
          }
        >
          <UsageDashboard />
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
      {view === 'settings' && <SettingsView />}
      {view === 'openai' && (
        <Suspense
          fallback={
            <div className="mx-auto max-w-4xl p-4 text-sm text-fg-3">
              Loading OpenAI endpoint config…
            </div>
          }
        >
          <OpenAiView />
        </Suspense>
      )}
      {view === 'memory' && (
        <Suspense
          fallback={
            <div className="mx-auto max-w-[1400px] p-4 text-sm text-fg-3">
              Loading memory + dreams…
            </div>
          }
        >
          <MemoryView />
        </Suspense>
      )}
      {view === 'benchmarks' && (
        <Suspense
          fallback={
            <div className="mx-auto max-w-7xl p-4 text-sm text-fg-3">
              Loading benchmarks…
            </div>
          }
        >
          <BenchmarksView />
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
        onNavigate={navigate}
      />

      {/* 116-postdeploy 2026-05-12 — action toast host (Run health check,
          Restart Discord bot status banners). Singleton; any caller fires
          via showActionToast(). */}
      <ActionToastHost />
    </DashboardErrorBoundary>
  )
}

export default App
