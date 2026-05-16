/**
 * dash-redesign (Mission Control) — top chrome / header.
 *
 * Replaces the App.tsx chrome at lines 178-283. Rendered ONCE at the
 * App level (above the view switch) so every route gets the new
 * header — Dashboard / Tasks / Conversations / Memory / Benchmarks /
 * Usage / Fleet / OpenAI / Audit / Graph.
 *
 * Composition (left-to-right):
 *   - Brand cluster : <img> mark + wordmark + version pill
 *   - Nav strip     : tab nav (existing navigate() prop from App.tsx)
 *   - Heartbeat pill: emerald pulse + "fleet · N live" — N from
 *                     useAgents() filtered to live status via the
 *                     same MissionAgentTile derivation
 *   - Icon cluster  : Cmd+K trigger button (synthesises a keyboard
 *                     event the existing CommandPalette listens for),
 *                     NotificationFeed bell, ThemeToggle, settings
 *                     gear (routes to /dashboard/v2/settings)
 *
 * The existing CommandPalette / NotificationFeed / ThemeToggle remain
 * untouched — they keep their own internal state. The header only
 * positions them.
 */
import type { JSX } from 'react'
import {
  useAgentCache,
  useAgentLatency,
  useAgents,
  type AgentStatusEntry,
} from '@/hooks/useApi'
import { deriveMissionStatus } from './MissionAgentTile'
import { Icon } from './icons'
import { NotificationFeed } from '@/components/NotificationFeed'
import { ThemeToggle } from '@/components/ThemeToggle'
import { TelemetryBadge } from '@/components/TelemetryBadge'
import { useState, useEffect } from 'react'

// Tab metadata — order mirrors the operator-usage-frequency lock in
// the current App.tsx chrome (Dashboard / Tasks / Conversations /
// Memory / Benchmarks / Usage / Fleet / OpenAI / Audit / Graph).
const TABS: ReadonlyArray<{
  readonly key: string
  readonly label: string
}> = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'conversations', label: 'Conversations' },
  { key: 'memory', label: 'Memory' },
  { key: 'benchmarks', label: 'Benchmarks' },
  { key: 'usage', label: 'Usage' },
  { key: 'fleet', label: 'Fleet' },
  { key: 'openai', label: 'OpenAI' },
  { key: 'audit', label: 'Audit' },
  { key: 'graph', label: 'Graph' },
]

// ---------------------------------------------------------------------------
// Live-count probe — same pattern as MissionHero: per-agent hidden
// component issues hooks; aggregates the live count.
// ---------------------------------------------------------------------------

type CachePayload = { readonly slos?: { readonly first_token_p50_ms?: number } }
type LatencyPayload = {
  readonly first_token_headline?: { readonly p50?: number | null; readonly count?: number }
}

type ProbeReport = {
  readonly name: string
  readonly live: boolean
}

function LiveProbe(props: {
  readonly agent: AgentStatusEntry
  readonly onReport: (r: ProbeReport) => void
}): null {
  const { agent, onReport } = props
  const cacheQ = useAgentCache(agent.name)
  const latencyQ = useAgentLatency(agent.name)
  const cache = cacheQ.data as CachePayload | undefined
  const latency = latencyQ.data as LatencyPayload | undefined

  const p50 = latency?.first_token_headline?.p50 ?? null
  const p50Count = latency?.first_token_headline?.count ?? 0
  const threshold = cache?.slos?.first_token_p50_ms ?? null

  const { live } = deriveMissionStatus({
    rawStatus: agent.status,
    lastTurnAt: agent.lastTurnAt,
    p50Ms: p50Count >= 5 ? p50 : null,
    p50Threshold: threshold,
  })

  useEffect(() => {
    onReport({ name: agent.name, live })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.name, live])

  return null
}

// ---------------------------------------------------------------------------
// Cmd+K synthesizer — fires a real keyboard event so the existing
// CommandPalette's window-level keydown listener opens. Synthesising
// avoids reaching into CommandPalette's internal state.
// ---------------------------------------------------------------------------

function triggerCommandPalette(): void {
  // Dispatch a Cmd+K keydown. The CommandPalette listens at the
  // window level for `metaKey || ctrlKey` plus `k`. We mimic the Mac
  // form (metaKey: true); CommandPalette's handler accepts both, so
  // this works cross-platform.
  const evt = new KeyboardEvent('keydown', {
    key: 'k',
    code: 'KeyK',
    metaKey: true,
    bubbles: true,
  })
  window.dispatchEvent(evt)
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export type MissionHeaderProps = {
  readonly active: string
  readonly onNavigate: (view: string) => void
}

export function MissionHeader(props: MissionHeaderProps): JSX.Element {
  const agentsQ = useAgents()
  const agents = agentsQ.data?.agents ?? []
  const [liveMap, setLiveMap] = useState<Record<string, boolean>>({})

  const handleReport = (r: ProbeReport): void => {
    setLiveMap((prev) => {
      if (prev[r.name] === r.live) return prev
      return { ...prev, [r.name]: r.live }
    })
  }

  const liveCount = agents.reduce(
    (n, a) => (liveMap[a.name] ? n + 1 : n),
    0,
  )

  return (
    <header className="mc-header" data-testid="mission-header">
      {/* Per-agent hidden probes — same dedupe pattern as the hero. */}
      {agents.map((a) => (
        <LiveProbe key={a.name} agent={a} onReport={handleReport} />
      ))}

      <div className="brand">
        <img
          className="mark"
          src="/dashboard/v2/assets/clawcode-mark.svg"
          alt="ClawCode"
          width={28}
          height={28}
        />
        <span className="wmark">clawcode</span>
        <span className="ver">v2</span>
      </div>

      <nav className="mc-nav" aria-label="Dashboard sections">
        {TABS.map((t) => (
          <a
            key={t.key}
            className={props.active === t.key ? 'active' : ''}
            onClick={() => props.onNavigate(t.key)}
            tabIndex={0}
            role="button"
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                props.onNavigate(t.key)
              }
            }}
            data-testid={`mission-tab-${t.key}`}
            data-active={props.active === t.key ? 'true' : 'false'}
          >
            {t.label}
          </a>
        ))}
      </nav>

      <div className="header-right">
        <div
          className="heartbeat"
          title="Daemon connected — fleet heartbeat"
          data-testid="mission-heartbeat"
        >
          <span className="pulse-dot" />
          <span>fleet · {liveCount} live</span>
        </div>
        <button
          className="mc-icon-btn"
          aria-label="Search (Cmd+K)"
          title="Cmd+K"
          onClick={triggerCommandPalette}
          data-testid="mission-cmdk-trigger"
        >
          <Icon name="search" />
        </button>
        {/* Existing chrome controls — keep their internal state. The
            TelemetryBadge surfaces 24h dashboard page-view + error
            counts (orthogonal signal to the heartbeat — heartbeat is
            "fleet liveness"; telemetry is "operator usage"). */}
        <TelemetryBadge />
        <NotificationFeed />
        <ThemeToggle />
        <button
          className="mc-icon-btn"
          aria-label="Settings"
          onClick={() => props.onNavigate('settings')}
          data-testid="mission-settings"
        >
          <Icon name="settings" />
        </button>
      </div>
    </header>
  )
}

export default MissionHeader
