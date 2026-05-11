/**
 * Phase 116-03 F27 — Conversations view.
 *
 * Two-column layout (single column on mobile via flex-wrap):
 *
 *  Left pane (sidebar)
 *    - Live activity tape: in-flight conversation-turn events from the SSE
 *      bus. Ring buffer of last 30, newest first. Each row shows agent +
 *      role + relative time.
 *    - Per-agent past sessions: fetched on-demand via
 *      /api/conversations/:agent/recent when an agent is selected.
 *
 *  Right pane (workspace)
 *    - FTS5 search bar: q + optional agent filter
 *    - Results table: BM25-sorted hits with role + agent + timestamp +
 *      content snippet (first ~200 chars). Click jumps the operator into
 *      the Discord cross-reference (deep link via `discord_message_id` is
 *      NOT carried by searchTurns today — left as a forward-pointer for
 *      a future cross-link plan).
 *
 * The live tape uses subscribeConversationTurns from useSse.ts — NOT a
 * TanStack Query cache. The event volume can hit 50/s at peak; overwriting
 * a cache key would re-render every consumer per event. Component-owned
 * ring buffer is the right granularity.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  subscribeConversationTurns,
  type ConversationTurnEvent,
} from '@/hooks/useSse'
import {
  useAgents,
  useConversationSearch,
  useRecentConversations,
} from '@/hooks/useApi'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

const TAPE_MAX = 30

function relativeTime(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso
  const dms = Date.now() - t
  if (dms < 0) return 'now'
  if (dms < 60_000) return `${Math.round(dms / 1000)}s ago`
  if (dms < 3_600_000) return `${Math.round(dms / 60_000)}m ago`
  if (dms < 86_400_000) return `${Math.round(dms / 3_600_000)}h ago`
  return new Date(t).toLocaleString()
}

export function ConversationsView() {
  const agentsQ = useAgents()
  const allAgents = useMemo(() => {
    const payload = agentsQ.data as
      | { agents?: ReadonlyArray<{ name: string }> }
      | undefined
    return (payload?.agents ?? []).map((a) => a.name).sort()
  }, [agentsQ.data])

  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [searchAgent, setSearchAgent] = useState<string>('') // '' = all
  const [searchEnabled, setSearchEnabled] = useState(false)

  // Live tape — ring buffer of recent conversation-turn events.
  const [tape, setTape] = useState<ConversationTurnEvent[]>([])
  useEffect(() => {
    const unsub = subscribeConversationTurns((evt) => {
      setTape((curr) => [evt, ...curr].slice(0, TAPE_MAX))
    })
    return unsub
  }, [])

  const recentQ = useRecentConversations(selectedAgent)
  const searchQ = useConversationSearch(
    query,
    searchAgent === '' ? null : searchAgent,
    searchEnabled && query.length > 0,
  )

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <h2 className="mb-4 text-2xl font-bold">Conversations</h2>

      <div className="flex flex-wrap gap-6">
        {/* Sidebar */}
        <aside className="w-full shrink-0 space-y-4 lg:w-72">
          {/* Live tape */}
          <div className="rounded-md border bg-card p-3">
            <div className="mb-2 flex items-center justify-between text-xs uppercase text-muted-foreground">
              <span>Live ({tape.length})</span>
              {tape.length > 0 && (
                <button
                  className="text-[10px] underline"
                  onClick={() => setTape([])}
                >
                  clear
                </button>
              )}
            </div>
            {tape.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Waiting for a conversation-turn SSE event…
              </p>
            )}
            <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
              {tape.map((evt) => (
                <li
                  key={evt.turnId}
                  className="flex cursor-pointer items-center gap-2 rounded p-1 hover:bg-muted/50"
                  onClick={() => setSelectedAgent(evt.agent)}
                >
                  <Badge
                    variant={evt.role === 'user' ? 'outline' : 'secondary'}
                    className="text-[10px]"
                  >
                    {evt.role}
                  </Badge>
                  <span className="font-mono">{evt.agent}</span>
                  <span className="ml-auto text-muted-foreground">
                    {relativeTime(evt.ts)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Agent list */}
          <div className="rounded-md border bg-card p-3">
            <div className="mb-2 text-xs uppercase text-muted-foreground">
              Agents
            </div>
            <ul className="space-y-1 text-sm">
              {allAgents.map((name) => (
                <li key={name}>
                  <button
                    className={
                      'w-full rounded px-2 py-1 text-left transition-colors ' +
                      (selectedAgent === name
                        ? 'bg-primary/20 text-foreground'
                        : 'hover:bg-muted')
                    }
                    onClick={() => setSelectedAgent(name)}
                  >
                    <span className="font-mono">{name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* Workspace */}
        <section className="min-w-0 flex-1 space-y-4">
          {/* Search bar */}
          <div className="rounded-md border bg-card p-3">
            <div className="flex flex-wrap gap-2">
              <input
                className="min-w-0 flex-1 rounded border bg-background px-3 py-1.5 text-sm"
                placeholder="FTS5 search across conversation turns…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setSearchEnabled(true)
                }}
              />
              <select
                className="rounded border bg-background px-2 py-1 text-sm"
                value={searchAgent}
                onChange={(e) => setSearchAgent(e.target.value)}
              >
                <option value="">all agents</option>
                {allAgents.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                onClick={() => setSearchEnabled(true)}
                disabled={query.length === 0}
              >
                Search
              </Button>
            </div>
            {searchQ.isLoading && (
              <p className="mt-2 text-xs text-muted-foreground">searching…</p>
            )}
            {searchQ.error && (
              <p className="mt-2 text-xs text-destructive">
                {(searchQ.error as Error).message}
              </p>
            )}
            {searchQ.data && (
              <p className="mt-2 text-xs text-muted-foreground">
                {searchQ.data.hits.length} hits / {searchQ.data.totalMatches}{' '}
                total across {searchQ.data.agentsQueried.length} agent
                {searchQ.data.agentsQueried.length === 1 ? '' : 's'}
              </p>
            )}
          </div>

          {/* Search results */}
          {searchQ.data && searchQ.data.hits.length > 0 && (
            <div className="rounded-md border bg-card">
              <ul className="divide-y">
                {searchQ.data.hits.map((hit) => (
                  <li key={hit.turnId} className="p-3 text-sm">
                    <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge
                        variant={hit.role === 'user' ? 'outline' : 'secondary'}
                        className="text-[10px]"
                      >
                        {hit.role}
                      </Badge>
                      <span className="font-mono">{hit.agent}</span>
                      <span>{relativeTime(hit.createdAt)}</span>
                      <span className="ml-auto font-mono">
                        bm25 {hit.bm25Score.toFixed(2)}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-sm">
                      {hit.content.length > 400
                        ? hit.content.slice(0, 400) + '…'
                        : hit.content}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Selected agent's recent sessions */}
          {selectedAgent && (
            <div className="rounded-md border bg-card p-3">
              <div className="mb-2 text-sm font-semibold">
                Recent sessions — <span className="font-mono">{selectedAgent}</span>
              </div>
              {recentQ.isLoading && (
                <p className="text-xs text-muted-foreground">loading…</p>
              )}
              {recentQ.data && recentQ.data.sessions.length === 0 && (
                <p className="text-xs text-muted-foreground">No sessions recorded.</p>
              )}
              {recentQ.data && (
                <ul className="space-y-1 text-xs">
                  {recentQ.data.sessions.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center gap-2 rounded p-1 hover:bg-muted/50"
                    >
                      <Badge variant="outline" className="text-[10px]">
                        {s.status}
                      </Badge>
                      <span className="font-mono">{s.id.slice(0, 8)}</span>
                      <span className="text-muted-foreground">
                        {s.turnCount} turn{s.turnCount === 1 ? '' : 's'}
                      </span>
                      <span className="ml-auto text-muted-foreground">
                        {relativeTime(s.startedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
