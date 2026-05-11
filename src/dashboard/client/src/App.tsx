/**
 * Phase 116 T10 — full-stack smoke component.
 *
 * Proves: build → serve → SSE → TanStack Query → React → render works.
 *
 * Renders one Card per agent reported by useAgents() (REST + SSE). Header
 * shows the view-mode toggle (T09) and the SSE connection status dot (T08).
 * Plan 116-01 replaces this body with real Tier 1 feature components; the
 * shell stays.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAgents } from './hooks/useApi'
import { useSseBridge, useSseStatus } from './hooks/useSse'
import { useViewMode } from './hooks/useViewMode'

function statusDotClass(status: string): string {
  switch (status) {
    case 'open':
      return 'bg-primary'
    case 'connecting':
      return 'bg-warn'
    case 'error':
    case 'closed':
      return 'bg-danger'
    default:
      return 'bg-fg-3'
  }
}

function App() {
  // Mount the SSE singleton bridge once at app root.
  useSseBridge()

  const sseStatus = useSseStatus()
  const { mode, toggle } = useViewMode()
  const agentsQuery = useAgents()

  // useAgents() returns a payload shaped { agents: [...] }; if the daemon
  // surface differs we render whatever object came back rather than crashing.
  const payload = agentsQuery.data as
    | { agents?: ReadonlyArray<{ name: string; model?: string; status?: string }> }
    | undefined
  const agents = payload?.agents ?? []

  return (
    <div className="min-h-screen bg-bg-base text-fg-1 font-sans">
      {/* Header — connection dot + branding + view-mode toggle. Visually
          unstyled; Plan 116-01 lays this out properly. */}
      <header className="border-b border-bg-s3 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className={`inline-block w-2.5 h-2.5 rounded-full ${statusDotClass(sseStatus)}`}
            aria-label={`SSE ${sseStatus}`}
            title={`SSE: ${sseStatus}`}
          />
          <h1 className="font-display text-xl font-bold tracking-tight">
            ClawCode <span className="text-primary">v2</span>
          </h1>
          <span className="font-mono text-xs text-fg-3 data">
            {agents.length} agent{agents.length === 1 ? '' : 's'}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={toggle}
          aria-pressed={mode === 'advanced'}
          className="font-mono uppercase text-xs"
        >
          {mode}
        </Button>
      </header>

      <main className="p-6">
        {agentsQuery.isLoading && (
          <p className="text-fg-2 font-sans">Loading fleet…</p>
        )}
        {agentsQuery.isError && (
          <p className="text-danger font-sans">
            Failed to load fleet — daemon unreachable.
          </p>
        )}
        {!agentsQuery.isLoading && !agentsQuery.isError && agents.length === 0 && (
          <p className="text-fg-2 font-sans">
            No agents reported. Confirm <code className="data">/api/state</code>{' '}
            returns <code className="data">{'{ agents: [...] }'}</code>.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {agents.map((a) => (
            <Card
              key={a.name}
              className="bg-bg-elevated border-bg-s3 text-fg-1"
            >
              <CardHeader className="pb-2">
                <CardTitle className="font-display text-base flex items-center justify-between gap-2">
                  <span>{a.name}</span>
                  {a.model && (
                    <Badge
                      variant="outline"
                      className="font-mono uppercase text-[10px] border-bg-s3 text-fg-2"
                    >
                      {a.model}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-fg-2 font-sans">
                <span className="data">{a.status ?? 'unknown'}</span>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  )
}

export default App
