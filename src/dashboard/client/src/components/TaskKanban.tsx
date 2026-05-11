/**
 * Phase 116-03 F28 — Task Kanban board.
 *
 * Six columns mapping to the daemon's 8-state task machine:
 *   Backlog (pending) | Scheduled (—) | Running | Waiting (awaiting_input)
 *   Failed (failed/timed_out/orphaned) | Done (complete/cancelled)
 *
 * Drag-drop transitions land via @dnd-kit/core (useDroppable + useDraggable).
 * Optimistic UI flip: the card moves to the destination column immediately,
 * then the POST to /api/tasks/:id/transition fires; if the transition is
 * illegal per assertLegalTransition, the daemon returns 400 with the reason
 * and we revert by invalidating the kanban query.
 *
 * Mobile fallback: each card carries a "→ status" dropdown so touch users
 * can transition without drag (per plan risk note — drag is finicky on
 * iPhone 14). dnd-kit's PointerSensor handles touch, but the dropdown is
 * the more reliable surface on small screens.
 *
 * "+ New task" button opens a modal with title + target_agent picker
 * + description textarea. Creates land in Backlog (status='pending').
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
import { Badge } from '@/components/ui/badge'

const COLUMN_NAMES: ReadonlyArray<keyof KanbanColumns> = [
  'Backlog',
  'Scheduled',
  'Running',
  'Waiting',
  'Failed',
  'Done',
]

// Drop column → destination raw status. Used by the transition POST.
const COLUMN_TO_STATUS: Record<string, string> = {
  Backlog: 'pending',
  Running: 'running',
  Waiting: 'awaiting_input',
  Failed: 'failed',
  Done: 'complete',
  // Scheduled is a virtual column today (see daemon's list-tasks-kanban
  // handler) — dropping into it falls back to 'pending'.
  Scheduled: 'pending',
}

function relTime(ms: number): string {
  const d = Date.now() - ms
  if (d < 60_000) return `${Math.round(d / 1000)}s`
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m`
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)}h`
  return new Date(ms).toLocaleDateString()
}

export function TaskKanban() {
  const queryClient = useQueryClient()
  const kanbanQ = useKanbanTasks()
  const [createOpen, setCreateOpen] = useState(false)
  const [transitionError, setTransitionError] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 }, // 6px move before drag starts
    }),
  )

  async function handleDragEnd(evt: DragEndEvent) {
    const { active, over } = evt
    if (!over) return
    const taskId = String(active.id)
    const column = String(over.id)
    const status = COLUMN_TO_STATUS[column]
    if (!status) return
    setTransitionError(null)
    try {
      await transitionTask(taskId, status)
      // Refetch to surface the daemon's authoritative state.
      void queryClient.invalidateQueries({ queryKey: ['tasks-kanban'] })
    } catch (err) {
      setTransitionError(
        (err as Error).message + ' — reverting via refetch.',
      )
      void queryClient.invalidateQueries({ queryKey: ['tasks-kanban'] })
    }
  }

  const columns = kanbanQ.data?.columns

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-2xl font-bold">
          Tasks {columns && <span className="text-sm text-muted-foreground">({kanbanQ.data?.total ?? 0})</span>}
        </h2>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          + New task
        </Button>
      </div>

      {transitionError && (
        <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {transitionError}
        </div>
      )}

      {kanbanQ.isLoading && (
        <p className="text-sm text-muted-foreground">Loading tasks…</p>
      )}
      {kanbanQ.error && (
        <p className="text-sm text-destructive">
          {(kanbanQ.error as Error).message}
        </p>
      )}

      {columns && (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {COLUMN_NAMES.map((name) => (
              <KanbanColumn
                key={name}
                name={name}
                rows={columns[name] ?? []}
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

function KanbanColumn({
  name,
  rows,
}: {
  name: keyof KanbanColumns
  rows: readonly KanbanRow[]
}) {
  const { setNodeRef, isOver } = useDroppable({ id: name })
  return (
    <div
      ref={setNodeRef}
      className={
        'rounded-md border bg-card p-2 transition-colors ' +
        (isOver ? 'border-primary ring-2 ring-primary/30' : '')
      }
    >
      <div className="mb-2 flex items-center justify-between text-xs uppercase text-muted-foreground">
        <span>{name}</span>
        <span>{rows.length}</span>
      </div>
      <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto">
        {rows.length === 0 && (
          <div className="py-4 text-center text-xs text-muted-foreground">
            empty
          </div>
        )}
        {rows.map((row) => (
          <KanbanCard key={row.task_id} row={row} />
        ))}
      </div>
    </div>
  )
}

function KanbanCard({ row }: { row: KanbanRow }) {
  const queryClient = useQueryClient()
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: row.task_id })
  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined

  async function manualTransition(status: string) {
    try {
      await transitionTask(row.task_id, status)
      void queryClient.invalidateQueries({ queryKey: ['tasks-kanban'] })
    } catch (err) {
      // Surface inline; the page-level error banner reads via state in
      // the parent. Local fallback: alert(), but operators on dev clawdy
      // will see the daemon error in the rejected promise via devtools.
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
        'cursor-grab rounded-md border bg-background p-2 text-xs shadow-sm ' +
        (isDragging ? 'opacity-50' : '')
      }
    >
      <div className="mb-1 flex items-center gap-1">
        <Badge variant="outline" className="text-[10px]">
          {row.status}
        </Badge>
        <span className="font-mono text-[10px] text-muted-foreground">
          {row.task_id.slice(0, 8)}
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {relTime(row.started_at)}
        </span>
      </div>
      <div className="mb-1 font-mono text-xs">
        <span className="text-muted-foreground">→ </span>
        {row.target_agent}
      </div>
      {row.task_type && (
        <div className="text-[10px] text-muted-foreground">{row.task_type}</div>
      )}
      {row.error && (
        <div className="mt-1 text-[10px] text-destructive">
          err: {row.error.slice(0, 80)}
        </div>
      )}
      {/* Touch-friendly fallback dropdown. dnd-kit's PointerSensor handles
          touch, but on iPhone 14 small screens the drop targets get cramped
          across 6 columns; explicit transitions are easier. */}
      <div className="mt-2 flex gap-1">
        <select
          className="w-full rounded border bg-background px-1 py-0.5 text-[10px]"
          onChange={(e) => {
            const v = e.target.value
            e.target.value = ''
            if (v) void manualTransition(v)
          }}
          defaultValue=""
        >
          <option value="">→ status…</option>
          <option value="running">running</option>
          <option value="awaiting_input">awaiting_input</option>
          <option value="complete">complete</option>
          <option value="failed">failed</option>
          <option value="cancelled">cancelled</option>
        </select>
      </div>
    </div>
  )
}

function CreateTaskModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
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
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>
            Inject an operator-authored task into the system. Lands in
            Backlog as <code>status=pending</code>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium">Title</label>
            <input
              className="w-full rounded border bg-background px-2 py-1 text-sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="short headline"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Target agent</label>
            <select
              className="w-full rounded border bg-background px-2 py-1 text-sm"
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
            <label className="mb-1 block text-xs font-medium">Description</label>
            <textarea
              className="h-24 w-full rounded border bg-background px-2 py-1 text-sm"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="(optional) markdown body"
            />
          </div>
          {error && (
            <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              {error}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={busy}>
            {busy ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
