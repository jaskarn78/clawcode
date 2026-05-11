/**
 * Phase 116-03 F27 — Conversations view.
 *
 * Three-column layout on desktop (single column on mobile via flex-wrap):
 *
 *  Left pane (sidebar)
 *    - Live activity tape: in-flight conversation-turn events from the SSE
 *      bus. Ring buffer of last 30, newest first. Each row shows agent +
 *      role + relative time.
 *    - Per-agent past sessions: fetched on-demand via
 *      /api/conversations/:agent/recent when an agent is selected.
 *      Clicking a session row pins its transcript in the right pane.
 *
 *  Center pane (workspace)
 *    - FTS5 search bar: q + optional agent filter
 *    - Results table: BM25-sorted hits with role + agent + timestamp +
 *      content snippet (first ~200 chars).
 *
 *  Right pane (transcript — 116-postdeploy Bug 2)
 *    - Full ordered turn list for the pinned session, fetched via
 *      /api/agents/:agent/recent-turns?sessionId=… (extended in the same
 *      fix; reuses the F11 list-recent-turns IPC handler with an optional
 *      session pin). Each turn shows role badge + content + timestamp +
 *      token count when present.
 *    - Live append: when a `conversation-turn` SSE event lands for the
 *      pinned session's agent, the query is invalidated and the latest
 *      turns are refetched. The SSE payload carries no sessionId today,
 *      so we refetch the whole session rather than try to match — fine
 *      because the open-transcript case is rare and a single-session
 *      query is cheap.
 *
 * The live tape uses subscribeConversationTurns from useSse.ts — NOT a
 * TanStack Query cache. The event volume can hit 50/s at peak; overwriting
 * a cache key would re-render every consumer per event. Component-owned
 * ring buffer is the right granularity.
 */
import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  subscribeConversationTurns,
  type ConversationTurnEvent,
} from '@/hooks/useSse'
import {
  useAgents,
  useConversationSearch,
  useRecentConversations,
  useSessionTurns,
  SESSION_TURNS_QUERY_KEY,
  type RecentTurnRow,
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

  // 116-postdeploy Bug 2 — pinned transcript pane state. Both ids must
  // be present together (set when the operator clicks a session row);
  // closing the pane resets both.
  const [pinnedAgent, setPinnedAgent] = useState<string | null>(null)
  const [pinnedSessionId, setPinnedSessionId] = useState<string | null>(null)
  const queryClient = useQueryClient()

  // Live tape — ring buffer of recent conversation-turn events.
  const [tape, setTape] = useState<ConversationTurnEvent[]>([])
  useEffect(() => {
    const unsub = subscribeConversationTurns((evt) => {
      setTape((curr) => [evt, ...curr].slice(0, TAPE_MAX))
      // 116-postdeploy Bug 2 — if the event's agent matches the pinned
      // transcript, invalidate the session-turns query so React Query
      // refetches and the new turn appears. The SSE payload doesn't
      // carry sessionId; we just match by agent. For a non-active pinned
      // session this triggers a wasted refetch but the result is
      // identical (no new turns) so the cache stays stable.
      if (pinnedAgent && evt.agent === pinnedAgent) {
        queryClient.invalidateQueries({
          queryKey: [SESSION_TURNS_QUERY_KEY, pinnedAgent, pinnedSessionId],
        })
      }
    })
    return unsub
  }, [pinnedAgent, pinnedSessionId, queryClient])

  const recentQ = useRecentConversations(selectedAgent)
  const searchQ = useConversationSearch(
    query,
    searchAgent === '' ? null : searchAgent,
    searchEnabled && query.length > 0,
  )
  const transcriptQ = useSessionTurns(pinnedAgent, pinnedSessionId)

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
                  {recentQ.data.sessions.map((s) => {
                    const isPinned =
                      pinnedAgent === selectedAgent && pinnedSessionId === s.id
                    return (
                      <li
                        key={s.id}
                        className={
                          'flex cursor-pointer items-center gap-2 rounded p-1 transition-colors ' +
                          (isPinned
                            ? 'bg-primary/20 text-foreground'
                            : 'hover:bg-muted/50')
                        }
                        onClick={() => {
                          // 116-postdeploy Bug 2 — pin the transcript pane
                          // to this session. Re-clicking the pinned session
                          // is a no-op; clicking a different one swaps the
                          // pane. The "close" button on the pane resets.
                          setPinnedAgent(selectedAgent)
                          setPinnedSessionId(s.id)
                        }}
                        title="Click to open transcript"
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
                    )
                  })}
                </ul>
              )}
            </div>
          )}
        </section>

        {/* Right pane — transcript (116-postdeploy Bug 2). Only mounts
            when a session is pinned, so the layout stays 2-column for
            search-only flows. */}
        {pinnedAgent && pinnedSessionId && (
          <TranscriptPane
            agent={pinnedAgent}
            sessionId={pinnedSessionId}
            isLoading={transcriptQ.isLoading}
            error={transcriptQ.error as Error | null | undefined}
            turns={transcriptQ.data?.turns ?? null}
            onClose={() => {
              setPinnedAgent(null)
              setPinnedSessionId(null)
            }}
          />
        )}
      </div>
    </div>
  )
}

/**
 * 116-postdeploy Bug 2 — transcript pane.
 *
 * Renders the full ordered turn list for one session in chronological
 * order (top→bottom). Designed to sit as a third flex child alongside
 * the existing sidebar + workspace; on mobile it wraps to a full-width
 * stacked card.
 */
function TranscriptPane(props: {
  readonly agent: string
  readonly sessionId: string
  readonly isLoading: boolean
  readonly error: Error | null | undefined
  readonly turns: readonly RecentTurnRow[] | null
  readonly onClose: () => void
}): JSX.Element {
  const { agent, sessionId, isLoading, error, turns, onClose } = props
  return (
    <aside className="w-full shrink-0 lg:w-96">
      <div className="rounded-md border bg-card">
        <header className="flex items-center justify-between border-b p-3">
          <div>
            <div className="text-sm font-semibold">Transcript</div>
            <div className="text-[10px] text-muted-foreground">
              <span className="font-mono">{agent}</span> ·{' '}
              <span className="font-mono">{sessionId.slice(0, 8)}</span>
              {turns && (
                <>
                  {' '}
                  · {turns.length} turn{turns.length === 1 ? '' : 's'}
                </>
              )}
            </div>
          </div>
          <button
            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted/50"
            onClick={onClose}
            aria-label="Close transcript"
          >
            ✕
          </button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto p-3">
          {isLoading && (
            <p className="text-xs text-muted-foreground">loading transcript…</p>
          )}
          {error && (
            <p className="text-xs text-destructive">{error.message}</p>
          )}
          {turns && turns.length === 0 && !isLoading && (
            <p className="text-xs text-muted-foreground">
              No turns recorded for this session.
            </p>
          )}
          {turns && turns.length > 0 && (
            <ol className="space-y-3">
              {turns.map((t) => (
                <li
                  key={t.turnId}
                  className="rounded border bg-background/40 p-2"
                  data-role={t.role}
                >
                  <div className="mb-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                    <Badge
                      variant={t.role === 'user' ? 'outline' : 'secondary'}
                      className="text-[10px]"
                    >
                      {t.role}
                    </Badge>
                    <span className="font-mono">#{t.turnIndex}</span>
                    {t.tokenCount !== null && (
                      <span className="font-mono" title="token count">
                        {t.tokenCount.toLocaleString()}t
                      </span>
                    )}
                    <span className="ml-auto" title={t.createdAt}>
                      {relativeTime(t.createdAt)}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-xs leading-relaxed">
                    {t.content}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </aside>
  )
}
