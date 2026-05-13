// @vitest-environment jsdom
/**
 * dash-redesign — MissionFleetGrid component tests.
 *
 * Two halves:
 *   1. Pure-helper tests on `matchesFilter` — node-env friendly, no
 *      DOM, no hooks.
 *   2. Render smokes — mount <MissionFleetGrid> with a mocked
 *      useAgents() and assert filter-chip defaults + active-state
 *      data-attributes.
 *
 * Hook mocking note: vi.mock() hoists; the factory cannot reference
 * test-scope variables. We use vi.hoisted() for the shared agent
 * fixture so the mock factory + assertions stay in sync.
 *
 * MissionAgentTile is mocked inline to avoid mounting the per-tile
 * hook stack (useAgentCache + useAgentLatency + useAgentActivity)
 * — those have their own test coverage path.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// Globals are off in vitest.config.ts → RTL's auto-afterEach hook
// doesn't register. Call cleanup() explicitly so each test renders
// against a fresh DOM (otherwise getByTestId throws on duplicates).
afterEach(() => {
  cleanup()
})
import {
  matchesFilter,
  MissionFleetGrid,
  type FleetFilter,
} from './MissionFleetGrid'
import type { AgentStatusEntry } from '../../hooks/useApi'

// ---------------------------------------------------------------------------
// Pure helper: matchesFilter
// ---------------------------------------------------------------------------

const agent = (overrides: Partial<AgentStatusEntry> = {}): AgentStatusEntry =>
  ({ name: 'a', status: 'running', lastTurnAt: Date.now(), ...overrides }) as AgentStatusEntry

describe('matchesFilter', () => {
  it('returns true for every agent when filter is "all"', () => {
    expect(matchesFilter(agent({ status: 'running' }), 'all')).toBe(true)
    expect(matchesFilter(agent({ status: 'stopped' }), 'all')).toBe(true)
    expect(matchesFilter(agent({ status: 'errored' }), 'all')).toBe(true)
    expect(matchesFilter(agent({ status: undefined }), 'all')).toBe(true)
  })

  it('puts running/active agents in the "live" bucket', () => {
    expect(matchesFilter(agent({ status: 'running' }), 'live')).toBe(true)
    expect(matchesFilter(agent({ status: 'active' }), 'live')).toBe(true)
    expect(matchesFilter(agent({ status: 'stopped' }), 'live')).toBe(false)
    expect(matchesFilter(agent({ status: 'errored' }), 'live')).toBe(false)
  })

  it('puts errored/crashed agents in the "warn" bucket', () => {
    expect(matchesFilter(agent({ status: 'errored' }), 'warn')).toBe(true)
    expect(matchesFilter(agent({ status: 'crashed' }), 'warn')).toBe(true)
    expect(matchesFilter(agent({ status: 'running' }), 'warn')).toBe(false)
  })

  it('puts stopped/idle/starting/unknown agents in the "idle" bucket', () => {
    expect(matchesFilter(agent({ status: 'stopped' }), 'idle')).toBe(true)
    expect(matchesFilter(agent({ status: 'idle' }), 'idle')).toBe(true)
    expect(matchesFilter(agent({ status: 'starting' }), 'idle')).toBe(true)
    expect(matchesFilter(agent({ status: undefined }), 'idle')).toBe(true)
    // Running is NOT idle, even if it's been quiet for a while — the
    // recency-aware status lives on the tile, not the chip.
    expect(matchesFilter(agent({ status: 'running' }), 'idle')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Render smokes
// ---------------------------------------------------------------------------

const FIXTURE = vi.hoisted(() => ({
  agents: [
    { name: 'alpha', status: 'running', lastTurnAt: new Date().toISOString(), model: 'sonnet' },
    { name: 'bravo', status: 'errored', lastTurnAt: null, model: 'opus' },
    { name: 'charlie', status: 'stopped', lastTurnAt: null, model: 'haiku' },
  ],
}))

vi.mock('../../hooks/useApi', () => ({
  useAgents: () => ({
    data: { agents: FIXTURE.agents },
    isLoading: false,
    isError: false,
  }),
}))

vi.mock('./MissionAgentTile', () => ({
  MissionAgentTile: ({ agent }: { agent: { name: string } }) => (
    <div data-testid={`tile-${agent.name}`}>{agent.name}</div>
  ),
}))

describe('<MissionFleetGrid />', () => {
  it('defaults to the "all" filter — chip is active and every tile renders', () => {
    render(<MissionFleetGrid />)

    const allChip = screen.getByTestId('mission-filter-all')
    expect(allChip).toHaveAttribute('data-active', 'true')

    // All three fixture agents render.
    expect(screen.getByTestId('tile-alpha')).toBeInTheDocument()
    expect(screen.getByTestId('tile-bravo')).toBeInTheDocument()
    expect(screen.getByTestId('tile-charlie')).toBeInTheDocument()
  })

  it('filters down to the live cohort when the "live" chip is clicked', () => {
    render(<MissionFleetGrid />)

    fireEvent.click(screen.getByTestId('mission-filter-live'))

    expect(screen.getByTestId('mission-filter-live')).toHaveAttribute(
      'data-active',
      'true',
    )
    expect(screen.getByTestId('mission-filter-all')).toHaveAttribute(
      'data-active',
      'false',
    )

    // Only the running agent survives.
    expect(screen.getByTestId('tile-alpha')).toBeInTheDocument()
    expect(screen.queryByTestId('tile-bravo')).not.toBeInTheDocument()
    expect(screen.queryByTestId('tile-charlie')).not.toBeInTheDocument()
  })

  it('exposes "warn" filter that keeps only errored/crashed agents', () => {
    render(<MissionFleetGrid />)

    fireEvent.click(screen.getByTestId('mission-filter-warn'))

    expect(screen.queryByTestId('tile-alpha')).not.toBeInTheDocument()
    expect(screen.getByTestId('tile-bravo')).toBeInTheDocument()
    expect(screen.queryByTestId('tile-charlie')).not.toBeInTheDocument()
  })

  it('marks the grid root with data-filter reflecting current state', () => {
    const { rerender: _r } = render(<MissionFleetGrid />)
    expect(screen.getByTestId('mission-fleet-grid')).toHaveAttribute(
      'data-filter',
      'all',
    )
    fireEvent.click(screen.getByTestId('mission-filter-idle'))
    expect(screen.getByTestId('mission-fleet-grid')).toHaveAttribute(
      'data-filter',
      'idle',
    )
  })
})

// Type-narrow keeper — make sure the exported FleetFilter union still
// includes the four chips the UI exposes; if a future patch drops
// one, this fails to compile rather than silently breaking the test.
const _filters: ReadonlyArray<FleetFilter> = ['all', 'live', 'warn', 'idle']
void _filters
