import type { NmProdTask } from '../lib/types'

interface TaskCardProps {
  task: NmProdTask
  busy: boolean
  canEdit: boolean
  onIncrement?: (task: NmProdTask) => void
  onDecrement?: (task: NmProdTask) => void
  onTogglePriority?: (task: NmProdTask) => void
  onToggleCompleted?: (task: NmProdTask) => void
  showOnlyDecrement?: boolean
}

export function TaskCard({
  task,
  busy,
  canEdit,
  onIncrement,
  onDecrement,
  onTogglePriority,
  onToggleCompleted,
  showOnlyDecrement = false,
}: TaskCardProps) {
  const done = task.is_completed || task.current_qty >= task.total_qty
  const showBulkCut = task.total_qty > 1
  const remainingQty = Math.max(task.total_qty - task.current_qty, 0)
  const displayedQty = showOnlyDecrement ? task.current_qty : remainingQty
  const cardClass = [
    'nm-prod-task-card',
    task.is_priority ? 'nm-prod-task-card--priority' : '',
    done ? 'nm-prod-task-card--completed' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <article className={cardClass} data-task-id={task.id}>
      <div className="nm-prod-task-row">
        <div className="nm-prod-task-left" aria-live="polite">
          <h3 className="nm-prod-task-dimensions">
            <span className="nm-prod-task-measure">{task.dimensions}</span>
            <span className="nm-prod-task-separator"> - </span>
            <span className="nm-prod-task-qty">
              ({displayedQty})
            </span>
          </h3>
        </div>
        <div className="nm-prod-task-actions">
          {canEdit ? (
            showOnlyDecrement ? (
              <button
                type="button"
                className="nm-prod-btn nm-prod-btn-icon"
                disabled={busy || task.current_qty === 0}
                onClick={() => onDecrement?.(task)}
                aria-label="Restar una unidad"
                title="Restar una unidad"
              >
                -
              </button>
            ) : (
              <>
                {showBulkCut && (
                  <button
                    type="button"
                    className={`nm-prod-btn nm-prod-btn-icon ${task.is_completed ? 'nm-prod-btn-icon--active' : ''}`}
                    disabled={busy}
                    onClick={() => onToggleCompleted?.(task)}
                    aria-pressed={task.is_completed}
                    aria-label={task.is_completed ? 'Desmarcar corte total' : 'Marcar corte total'}
                    title={task.is_completed ? 'Desmarcar corte total' : 'Marcar corte total'}
                  >
                    ✂
                  </button>
                )}
                <button
                  type="button"
                  className={`nm-prod-btn nm-prod-btn-icon ${task.is_priority ? 'nm-prod-btn-icon--active' : ''}`}
                  disabled={busy}
                  onClick={() => onTogglePriority?.(task)}
                  aria-pressed={task.is_priority}
                  aria-label={task.is_priority ? 'Quitar prioridad' : 'Marcar prioridad'}
                  title={task.is_priority ? 'Quitar prioridad' : 'Marcar prioridad'}
                >
                  ★
                </button>
                <button
                  type="button"
                  className="nm-prod-btn nm-prod-btn-icon nm-prod-btn-accent"
                  disabled={busy || done}
                  onClick={() => onIncrement?.(task)}
                  aria-label="Sumar una unidad"
                  title="Sumar una unidad"
                >
                  +
                </button>
              </>
            )
          ) : (
            <p className="nm-prod-task-meta">Solo lectura</p>
          )}
        </div>
      </div>
      {task.notes && (
        <p className="nm-prod-task-meta">
          {task.notes}
        </p>
      )}
    </article>
  )
}
