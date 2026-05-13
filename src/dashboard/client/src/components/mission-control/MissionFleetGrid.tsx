/**
 * dash-redesign (Mission Control) — fleet grid + filter chips.
 *
 * Ported from the design-system kit's `FleetGrid`. Reads
 * `useAgents()` and renders one `<MissionAgentTile>` per agent.
 * Filter chips (all / live / warn / idle) gate the rendered set
 * using the per-tile status derivation in MissionAgentTile.
 *
 * The MissionAgentTile owns its own status derivation (it has access
 * to the per-agent latency hook). Filter at the grid level by
 * fetching the same hooks again would be a duplicate query; instead
 * we filter by `rawStatus` heuristically and let each tile mount
 * regardless. Operator-visible filter semantics:
 *   - all : every agent
 *   - live: rawStatus === 'running' OR 'active'
 *   - warn: rawStatus === 'errored' OR 'crashed'
 *   - idle: rawStatus === 'stopped' OR 'idle' OR unknown
 *
 * This is intentionally coarser than the per-tile status derivation
 * (which factors in SLO breach and recency). A tile filtered into
 * `live` may still render as `warn` if its p50 has breached — which
 * is fine: operators looking at the live cohort should see breached-
 * but-still-streaming agents to investigate. The status dot tells
 * the truth.
 */
import { useState } from 'react'
import type { JSX } from 'react'
import { useAgents, type AgentStatusEntry } from '@/hooks/useApi'
import { MissionAgentTile } from './MissionAgentTile'

export type FleetFilter = 'all' | 'live' | 'warn' | 'idle'
const FILTERS: ReadonlyArray<FleetFilter> = ['all', 'live', 'warn', 'idle']

export function matchesFilter(
  agent: AgentStatusEntry,
  filter: FleetFilter,
): boolean {
  if (filter === 'all') return true
  const status = agent.status
  if (filter === 'live') return status === 'running' || status === 'active'
  if (filter === 'warn') return status === 'errored' || status === 'crashed'
  // idle bucket — everything else falls here (stopped, idle, starting,
  // unknown). Starting is debatable but operators usually want it
  // visible in the calm bucket while it spins up.
  return (
    status === 'stopped' ||
    status === 'idle' ||
    status === 'starting' ||
    status === undefined ||
    status === null
  )
}

export type MissionFleetGridProps = {
  readonly onSelect?: (name: string) => void
}

export function MissionFleetGrid(
  props: MissionFleetGridProps,
): JSX.Element {
  const [filter, setFilter] = useState<FleetFilter>('all')
  const agentsQ = useAgents()
  const payload = agentsQ.data
  const agents: ReadonlyArray<AgentStatusEntry> = payload?.agents ?? []

  // Out of the box `/api/status` doesn't carry "24h activity" for an
  // ordering field; we leave the daemon-side ordering as authoritative
  // and only filter client-side. (FleetActivitySummary exists for
  // recency ordering but we keep this tile grid in step with the
  // existing AgentTileGrid behaviour — operator can sort via the
  // existing Fleet tab if they need it.)
  const filtered = agents.filter((a) => matchesFilter(a, filter))

  return (
    <div data-testid="mission-fleet-grid" data-filter={filter}>
      <div className="section-head">
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <h2>Agents</h2>
          <span className="sub">ordered by status</span>
        </div>
        <div className="filters">
          {FILTERS.map((f) => (
            <span
              key={f}
              role="button"
              tabIndex={0}
              className={`chip ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setFilter(f)
                }
              }}
              data-testid={`mission-filter-${f}`}
              data-active={filter === f ? 'true' : 'false'}
            >
              {f}
            </span>
          ))}
        </div>
      </div>

      {agentsQ.isLoading && (
        <div className="feed-empty">Loading fleet…</div>
      )}
      {agentsQ.isError && (
        <div className="feed-empty" style={{ color: 'hsl(var(--danger))' }}>
          Failed to load fleet — daemon unreachable.
        </div>
      )}
      {!agentsQ.isLoading && !agentsQ.isError && filtered.length === 0 && (
        <div className="feed-empty">
          No agents match the <strong>{filter}</strong> filter.
        </div>
      )}

      <div className="fleet-grid">
        {filtered.map((a) => (
          <MissionAgentTile
            key={a.name}
            agent={{
              name: a.name,
              status: a.status,
              lastTurnAt: a.lastTurnAt,
              model: a.model,
            }}
            onSelect={props.onSelect}
          />
        ))}
      </div>
    </div>
  )
}

export default MissionFleetGrid
