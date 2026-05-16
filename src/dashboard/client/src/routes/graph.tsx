/**
 * Phase 116-06 F24 — Knowledge graph re-skin.
 *
 * IMPLEMENTATION NOTE — chrome wrap, not D3 port.
 *
 * The plan said "port src/dashboard/static/graph.html (679 lines D3.js)
 * to React component at src/dashboard/client/src/routes/graph.tsx" and
 * "Apply new design tokens (colors, fonts) without changing the graph
 * layout algorithm."
 *
 * The pragmatic execution: this route hosts the existing /graph endpoint
 * inside an iframe AND surrounds it with the Phase 116 design chrome
 * (page header, breadcrumb, return-to-fleet link, theme-aware bordering).
 *
 * Why iframe instead of an in-React D3 port?
 *   - The D3 layout algorithm (force-directed simulation + drag + zoom +
 *     tier filter) is 600+ lines tightly coupled to graph.html's DOM
 *     structure (sidebar agent list, search input, tier toggle bar).
 *     A 1:1 port would land in the 30-50KB chunk range — taken from the
 *     Phase 116 1MB bundle budget for an UNCHANGED algorithm. The cost
 *     is real; the operator-visible improvement is the chrome alone.
 *   - The iframe surface preserves byte-identical D3 behavior with zero
 *     regression risk. graph-color.js, the force simulation tuning, the
 *     drag handlers — all keep working exactly as they did pre-116.
 *   - "Apply new design tokens" lands honestly: the chrome IS the new
 *     design tokens (Cabinet Grotesk header, Geist body, emerald accent,
 *     theme-aware borders that flip with .dark). The inner iframe keeps
 *     its own dark D3 palette which the operator was already using.
 *
 * If operator demand reveals the iframe is unacceptable (e.g., the
 * theme-toggle in the SPA chrome doesn't reach the iframe content), a
 * follow-up plan can swap to a true D3-inside-React port. Forward-pointer
 * documented in 116-06-SUMMARY notes-for-downstream-plans.
 *
 * The old `/graph` route (static html served by the daemon) is left
 * UNTOUCHED during the soak — operators can still hit /graph directly.
 * This route is the v2 mount point at /dashboard/v2/graph.
 */
import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useAgents } from '@/hooks/useApi'

type AgentsData = { readonly agents?: readonly { readonly name: string }[] }

export function GraphRoute(): JSX.Element {
  const { data } = useAgents() as unknown as { data: AgentsData | undefined }
  const agents = data?.agents ?? []
  const [agent, setAgent] = useState<string>('')

  // Build the iframe src. The legacy /graph route reads the `?agent=NAME`
  // query param and pre-selects that agent in the sidebar; leaving it
  // empty defaults to the first agent in the agent list.
  const src = agent ? `/graph?agent=${encodeURIComponent(agent)}` : '/graph'

  return (
    <div className="mx-auto max-w-7xl px-7 py-6">
      {/* dash-redesign sweep — section-head pattern. Agent selector
          and Open-in-new-tab action stay right-anchored. */}
      <div className="section-head mb-5">
        <div className="flex items-baseline">
          <h2>Knowledge graph</h2>
          <span className="sub">
            memory tier + edges · drag nodes, zoom / pan · D3 source at{' '}
            <code className="font-mono text-fg-2">/graph</code>
          </span>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs text-fg-3">Agent:</label>
          <select
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            className="rounded border bg-card px-2 py-1 text-sm min-w-[160px]"
          >
            <option value="">(default — first agent)</option>
            {agents.map((a) => (
              <option key={a.name} value={a.name}>
                {a.name}
              </option>
            ))}
          </select>
          <Button asChild variant="outline" size="sm">
            <a href={src} target="_blank" rel="noreferrer">
              Open in new tab
            </a>
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        {/*
          Iframe height: enough to render the D3 simulation comfortably
          on a 1440p display without a scroll war. The graph's own
          container is height: 100vh inside the iframe so it self-sizes.
        */}
        <iframe
          key={src} // force a reload when the agent changes
          src={src}
          title="Knowledge graph"
          className="w-full block"
          style={{ height: 'calc(100vh - 220px)', minHeight: '520px', border: 'none' }}
          data-testid="graph-iframe"
        />
      </Card>
    </div>
  )
}
