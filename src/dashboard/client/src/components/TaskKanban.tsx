/**
 * Phase 116-UI redesign (2026-05) — Task Kanban board.
 *
 * "Trello with point of view." Key moves vs 116-03:
 *
 *  - Collapsed 6 columns to 4 desktop columns:
 *    Backlog · Running · Waiting · Done. The minor states (Scheduled,
 *    Failed, Cancelled, Orphaned, Timed-out) become inline indicators
 *    within the relevant main column — Failed lives inside Done with a
 *    destructive pill; Scheduled lives inside Backlog. This collapses
 *    cognitive load: the operator's mental model is "what's queued, what's
 *    moving, what's stuck, what's finished".
 *  - Filter chips header (agent multi-select / status / search). Counts
 *    on the right ("12 active · N done").
 *  - Card design overhaul:
 *    - Display-font title (target agent, since no title is stored
 *      server-side). Task type as subtitle.
 *    - Priority shown as a colored left-edge bar (NO data today; falls
 *      back to a fg-3 muted rail when priority is absent — wired for the
 *      future when KanbanRow gains a priority field).
 *    - Hover lifts the card (-translate-y-px + shadow).
 *    - Drag scales 1.02 + becomes semi-transparent + drop-shadow grows.
 *  - Column headers: larger weight, status dot, count subscript, dashed-
 *    primary border when a drag is hovering.
 *  - Empty-state for each column: not "empty" plain text.
 *  - Mobile: still grid-cols-1; each column stacks vertically. Touch
 *    drag works via dnd-kit PointerSensor.
 *  - New-task modal got its visual love (display font header, status
 *    landing pill, "lands in Backlog" preview).
 */
import { useMemo, useState } from 'react'
import {
  DndContext,
  useDraggable,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { useQueryClient } from '@tanstack/react-query'
import {
  useKanbanTasks,
  useAgents,
  transitionTask,
  createTask,
  type KanbanRow,
  type KanbanColumns,
} from '@/hooks/useApi'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

// Display columns (4) → which raw kanban columns they aggregate.
type DisplayColumn = 'Backlog' | 'Running' | 'Waiting' | 'Done'
const DISPLAY_COLUMNS: ReadonlyArray<DisplayColumn> = [
  'Backlog',
  'Running',
  'Waiting',
  'Done',
]
const DISPLAY_COLUMN_LABEL: Record<DisplayColumn, string> = {
  Backlog: 'Backlog',
  Running: 'Running',
  Waiting: 'Waiting',
  Done: 'Done',
}
const DISPLAY_COLUMN_SOURCES: Record<
  DisplayColumn,
  ReadonlyArray<keyof KanbanColumns>
> = {
  Backlog: ['Backlog', 'Scheduled'],
  Running: ['Running'],
  Waiting: ['Waiting'],
  Done: ['Done', 'Failed'],
}
const DISPLAY_COLUMN_TARGET_STATUS: Record<DisplayColumn, string> = {
  Backlog: 'pending',
  Running: 'running',
  Waiting: 'awaiting_input',
  Done: 'complete',
}

function relTime(ms: number): string {
  const d = Date.now() - ms
  if (d < 60_000) return `${Math.round(d / 1000)}s`
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m`
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)}h`
  return new Date(ms).toLocaleDateString()
}

function statusDotClass(col: DisplayColumn): string {
  switch (col) {
    case 'Running':
      return 'bg-primary animate-pulse'
    case 'Waiting':
      return 'bg-warn'
    case 'Done':
      return 'bg-fg-3'
    case 'Backlog':
    default:
      return 'bg-info'
  }
}

export function TaskKanban() {
  const queryClient = useQueryClient()
  const kanbanQ = useKanbanTasks()
  const [createOpen, setCreateOpen] = useState(false)
  const [transitionError, setTransitionError] = useState<string | null>(null)
  const [agentFilter, setAgentFilter] = useState<string>('')
  const [searchQ, setSearchQ] = useState<string>('')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )

  async function handleDragEnd(evt: DragEndEvent) {
    const { active, over } = evt
    if (!over) return
    const taskId = String(active.id)
    const column = String(over.id) as DisplayColumn
    const status = DISPLAY_COLUMN_TARGET_STATUS[column]
    if (!status) return
    setTransitionError(null)
    try {
      await transitionTask(taskId, status)
      void queryClient.invalidateQueries({ queryKey: ['tasks-kanban'] })
    } catch (err) {
      setTransitionError(
        (err as Error).message + ' — reverting via refetch.',
      )
      void queryClient.invalidateQueries({ queryKey: ['tasks-kanban'] })
    }
  }

  // Build display columns by merging raw columns and applying filters.
  const displayed = useMemo(() => {
    const raw = kanbanQ.data?.columns
    if (!raw) return null
    const q = searchQ.trim().toLowerCase()
    const apply = (rows: readonly KanbanRow[]) =>
      rows.filter((r) => {
        if (agentFilter && r.target_agent !== agentFilter) return false
        if (q) {
          const blob = `${r.target_agent} ${r.task_type} ${r.task_id}`.toLowerCase()
          if (!blob.includes(q)) return false
        }
        return true
      })
    const out: Record<DisplayColumn, readonly KanbanRow[]> = {
      Backlog: [],
      Running: [],
      Waiting: [],
      Done: [],
    }
    for (const dc of DISPLAY_COLUMNS) {
      const merged: KanbanRow[] = []
      for (const src of DISPLAY_COLUMN_SOURCES[dc]) {
        merged.push(...(raw[src] ?? []))
      }
      out[dc] = apply(merged)
    }
    return out
  }, [kanbanQ.data, agentFilter, searchQ])

  // Available target_agent values for the filter
  const allAgents = useMemo(() => {
    const raw = kanbanQ.data?.columns
    if (!raw) return []
    const set = new Set<string>()
    for (const col of Object.values(raw)) {
      for (const row of col) set.add(row.target_agent)
    }
    return [...set].sort()
  }, [kanbanQ.data])

  const totalActive = displayed
    ? displayed.Running.length + displayed.Waiting.length
    : 0
  const totalDone = displayed ? displayed.Done.length : 0

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 lg:px-6">
      {/* HEADER */}
      <header className="mb-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="font-display text-3xl font-bold tracking-tight text-fg-1">
              Tasks
            </h1>
            <span className="font-mono text-xs text-fg-3">
              {totalActive} active · {totalDone} done
            </span>
          </div>
          <Button
            size="sm"
            onClick={() => setCreateOpen(true)}
            className="font-medium"
          >
            <span className="mr-1.5" aria-hidden>
              +
            </span>
            New task
          </Button>
        </div>

        {/* Filter row */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Filter by id, agent, or type…"
            className="min-w-[200px] flex-1 rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-sm text-fg-1 placeholder:text-fg-3 focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Filter tasks"
          />
          <select
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            className="rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-sm text-fg-1"
            aria-label="Filter by target agent"
          >
            <option value="">Agent · any</option>
            {allAgents.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          {(searchQ || agentFilter) && (
            <button
              type="button"
              onClick={() => {
                setSearchQ('')
                setAgentFilter('')
              }}
              className="rounded-md px-2 py-1 text-xs text-fg-3 hover:text-fg-1"
            >
              Clear
            </button>
          )}
        </div>
      </header>

      {transitionError && (
        <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          {transitionError}
        </div>
      )}

      {kanbanQ.isLoading && <KanbanSkeleton />}
      {kanbanQ.error && (
        <p className="text-sm text-destructive">
          {(kanbanQ.error as Error).message}
        </p>
      )}

      {displayed && (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {DISPLAY_COLUMNS.map((name) => (
              <KanbanColumn
                key={name}
                name={name}
                rows={displayed[name]}
              />
            ))}
          </div>
        </DndContext>
      )}

      <CreateTaskModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          void queryClient.invalidateQueries({ queryKey: ['tasks-kanban'] })
        }}
      />
    </div>
  )
}

/* ====================================================================== */
/* COLUMN                                                                  */
/* ====================================================================== */

function KanbanColumn(props: {
  readonly name: DisplayColumn
  readonly rows: readonly KanbanRow[]
}) {
  const { name, rows } = props
  const { setNodeRef, isOver } = useDroppable({ id: name })
  return (
    <div
      ref={setNodeRef}
      className={
        'flex flex-col rounded-lg border bg-bg-elevated transition-all ' +
        (isOver
          ? 'border-primary border-dashed ring-2 ring-primary/20'
          : 'border-border')
      }
    >
      <header className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span
            className={'h-2 w-2 rounded-full ' + statusDotClass(name)}
            aria-hidden
          />
          <h2 className="font-display text-sm font-medium uppercase tracking-wider text-fg-1">
            {DISPLAY_COLUMN_LABEL[name]}
          </h2>
          <span className="font-mono text-[10px] text-fg-3">{rows.length}</span>
        </div>
      </header>

      <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto p-2">
        {rows.length === 0 ? (
          <EmptyColumn name={name} />
        ) : (
          rows.map((row) => <KanbanCard key={row.task_id} row={row} />)
        )}
      </div>
    </div>
  )
}

function EmptyColumn(props: { readonly name: DisplayColumn }) {
  const messages: Record<DisplayColumn, string> = {
    Backlog: 'Backlog is empty — create a task',
    Running: 'Nothing running',
    Waiting: 'Nothing awaiting input',
    Done: 'No completed tasks yet',
  }
  return (
    <div className="flex h-32 items-center justify-center rounded-md border border-dashed border-border/60 px-3 text-center">
      <p className="text-xs text-fg-3">{messages[props.name]}</p>
    </div>
  )
}

/* ====================================================================== */
/* CARD                                                                    */
/* ====================================================================== */

function KanbanCard(props: { readonly row: KanbanRow }) {
  const { row } = props
  const queryClient = useQueryClient()
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: row.task_id })

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(1.02)`,
      }
    : undefined

  // Status-derived priority rail color. Since the daemon doesn't expose
  // priority today, we encode urgency via the task's status: failed/errored
  // = danger; waiting (blocked) = warn; running = primary; otherwise muted.
  // When KanbanRow gains a `priority` field, swap to that.
  const railCls =
    row.status === 'failed' ||
    row.status === 'timed_out' ||
    row.status === 'orphaned'
      ? 'bg-destructive'
      : row.status === 'awaiting_input'
      ? 'bg-warn'
      : row.status === 'running'
      ? 'bg-primary'
      : 'bg-fg-3/30'

  const statusPillCls =
    row.status === 'failed' ||
    row.status === 'timed_out' ||
    row.status === 'orphaned'
      ? 'bg-destructive/15 text-destructive'
      : row.status === 'awaiting_input'
      ? 'bg-warn/15 text-warn'
      : row.status === 'running'
      ? 'bg-primary/15 text-primary'
      : row.status === 'complete'
      ? 'bg-fg-3/15 text-fg-2'
      : 'bg-info/15 text-info'

  async function manualTransition(status: string) {
    try {
      await transitionTask(row.task_id, status)
      void queryClient.invalidateQueries({ queryKey: ['tasks-kanban'] })
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('transition failed', err)
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={
        'group relative cursor-grab overflow-hidden rounded-md border bg-bg-base px-3 py-2.5 text-xs transition-all active:cursor-grabbing ' +
        (isDragging
          ? 'border-primary/60 opacity-70 shadow-lg'
          : 'border-border hover:-translate-y-px hover:border-primary/30 hover:shadow-md')
      }
    >
      {/* Left rail (priority/urgency) */}
      <span
        aria-hidden
        className={'absolute inset-y-0 left-0 w-1 ' + railCls}
      />

      <div className="ml-1.5">
        <div className="mb-1 flex items-center gap-1.5">
          <span
            className={
              'rounded-full px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-wider ' +
              statusPillCls
            }
          >
            {row.status}
          </span>
          <span className="font-mono text-[10px] text-fg-3">
            {row.task_id.slice(0, 8)}
          </span>
          <span className="ml-auto font-mono text-[10px] text-fg-3">
            {relTime(row.started_at)}
          </span>
        </div>

        <div className="mb-0.5 font-display text-sm font-medium text-fg-1">
          {row.target_agent}
        </div>
        {row.task_type && (
          <div className="font-mono text-[10px] text-fg-3">{row.task_type}</div>
        )}
        {row.chain_token_cost > 0 && (
          <div className="mt-1 font-mono text-[10px] text-fg-3">
            {row.chain_token_cost.toLocaleString()} chain tokens
          </div>
        )}
        {row.error && (
          <div className="mt-1.5 rounded border border-destructive/30 bg-destructive/5 p-1.5 text-[10px] text-destructive">
            <span className="font-medium uppercase tracking-wider">err </span>
            {row.error.length > 100
              ? row.error.slice(0, 100) + '…'
              : row.error}
          </div>
        )}

        {/* Touch-friendly transition dropdown (hidden until hover on
            desktop; always visible on touch). dnd-kit's listeners are
            still attached but `onPointerDown` stopped at the select so
            it doesn't initiate a drag. */}
        <div
          className="mt-2 sm:opacity-0 sm:group-hover:opacity-100 sm:transition-opacity"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <select
            className="w-full rounded border border-border bg-bg-elevated px-1.5 py-1 font-mono text-[10px] text-fg-2 hover:text-fg-1"
            onChange={(e) => {
              const v = e.target.value
              e.target.value = ''
              if (v) void manualTransition(v)
            }}
            defaultValue=""
            aria-label="Transition task status"
          >
            <option value="">→ move to…</option>
            <option value="running">running</option>
            <option value="awaiting_input">awaiting_input</option>
            <option value="complete">complete</option>
            <option value="failed">failed</option>
            <option value="cancelled">cancelled</option>
          </select>
        </div>
      </div>
    </div>
  )
}

function KanbanSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="rounded-lg border border-border bg-bg-elevated"
        >
          <div className="h-10 border-b border-border bg-bg-muted/40" />
          <div className="space-y-2 p-2">
            {[0, 1, 2].map((j) => (
              <div
                key={j}
                className="h-20 animate-pulse rounded-md border border-border bg-bg-base/60"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ====================================================================== */
/* CREATE TASK MODAL                                                       */
/* ====================================================================== */

function CreateTaskModal(props: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onCreated: () => void
}) {
  const { open, onOpenChange, onCreated } = props
  const agentsQ = useAgents()
  const agents = useMemo(() => {
    const payload = agentsQ.data as
      | { agents?: ReadonlyArray<{ name: string }> }
      | undefined
    return (payload?.agents ?? []).map((a) => a.name).sort()
  }, [agentsQ.data])

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [targetAgent, setTargetAgent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate() {
    if (!title || !targetAgent) {
      setError('Title and target agent are required')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await createTask({ title, description, target_agent: targetAgent })
      setTitle('')
      setDescription('')
      setTargetAgent('')
      onCreated()
      onOpenChange(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-xl">New task</DialogTitle>
          <DialogDescription className="text-fg-3">
            Inject an operator-authored task. Lands in{' '}
            <span className="inline-flex items-center gap-1 rounded-full bg-info/15 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-info">
              <span className="h-1.5 w-1.5 rounded-full bg-info" />
              Backlog
            </span>{' '}
            as <code className="font-mono text-fg-2">status=pending</code>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label
              htmlFor="task-title"
              className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-wider text-fg-3"
            >
              Title
            </label>
            <input
              id="task-title"
              className="w-full rounded-md border border-border bg-bg-base px-3 py-2 text-sm text-fg-1 placeholder:text-fg-3 focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short headline"
            />
          </div>
          <div>
            <label
              htmlFor="task-target"
              className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-wider text-fg-3"
            >
              Target agent
            </label>
            <select
              id="task-target"
              className="w-full rounded-md border border-border bg-bg-base px-3 py-2 text-sm text-fg-1 focus:border-primary focus:outline-none"
              value={targetAgent}
              onChange={(e) => setTargetAgent(e.target.value)}
            >
              <option value="">— select —</option>
              {agents.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="task-description"
              className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-wider text-fg-3"
            >
              Description
            </label>
            <textarea
              id="task-description"
              className="h-24 w-full resize-none rounded-md border border-border bg-bg-base px-3 py-2 text-sm text-fg-1 placeholder:text-fg-3 focus:border-primary focus:outline-none"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="(optional) markdown body"
            />
          </div>
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
              {error}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={busy}>
            {busy ? 'Creating…' : 'Create task'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
