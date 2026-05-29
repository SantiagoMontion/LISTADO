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
  variant?: 'legacy' | 'rebel'
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
  variant = 'legacy',
}: TaskCardProps) {
  const done = task.is_completed || task.current_qty >= task.total_qty
  const materialTypeNorm = task.material_type.trim().toLowerCase()
  const isRectos = materialTypeNorm === 'bordes_rectos'
  const isMayorista = materialTypeNorm === 'mayorista'
  const showMeasureQtyLikeRectos = isRectos || isMayorista
  const showBulkCut = task.total_qty > 1
  const remainingQty = Math.max(task.total_qty - task.current_qty, 0)
  const displayedQty = showOnlyDecrement ? task.current_qty : remainingQty
  const isAlert = task.from_faltas || task.is_priority

  if (variant === 'rebel') {
    const rowClass = [
      'cut-item-row',
      isAlert ? 'alert-state' : 'normal-state',
      done ? 'cut-item-row--completed' : '',
    ]
      .filter(Boolean)
      .join(' ')

    return (
      <article className={rowClass} data-task-id={task.id}>
        <div className="cut-item-row__body">
        <div className="cut-info-block" aria-live="polite">
          <h3 className="cut-measurements">
            <span>{task.dimensions}</span>
            {!showMeasureQtyLikeRectos ? (
              <>
                <span className="cut-qty-sep"> · </span>
                <span className="cut-qty" title={done ? 'Cortado' : `Falta cortar: ${displayedQty}`}>
                  ({displayedQty})
                </span>
              </>
            ) : (
              <span className="cut-qty" title={done ? 'Cortado' : `Falta cortar: ${displayedQty}`}>
                {' '}
                ({displayedQty})
              </span>
            )}
          </h3>
          {task.from_faltas ? (
            <span className="cut-alert-text" title="Cargado desde LISTA FALTAS">
              Faltas
            </span>
          ) : null}
        </div>
        <div className="cut-actions-group">
          {canEdit ? (
            showOnlyDecrement ? (
              <button
                type="button"
                className="btn-utility-rebel"
                disabled={busy || task.current_qty === 0}
                onClick={() => onDecrement?.(task)}
                aria-label={done ? 'Deshacer una unidad cortada' : 'Restar una unidad'}
                title={done ? 'Deshacer una unidad cortada' : 'Restar una unidad'}
              >
                −
              </button>
            ) : (
              <>
                {showBulkCut ? (
                  <button
                    type="button"
                    className={`btn-utility-rebel${task.is_completed ? ' btn-utility-rebel--active' : ''}`}
                    disabled={busy}
                    onClick={() => onToggleCompleted?.(task)}
                    aria-pressed={task.is_completed}
                    aria-label={task.is_completed ? 'Desmarcar corte total' : 'Marcar corte total'}
                    title={task.is_completed ? 'Desmarcar corte total' : 'Marcar corte total'}
                  >
                    ✂
                  </button>
                ) : null}
                <button
                  type="button"
                  className={`btn-utility-rebel${task.is_priority ? ' btn-utility-rebel--priority' : ''}`}
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
                  className="btn-action-complete-rebel"
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
            <span className="cut-readonly-label">Solo lectura</span>
          )}
        </div>
        </div>
        {task.notes ? <p className="cut-item-notes">{task.notes}</p> : null}
      </article>
    )
  }

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
            {task.from_faltas ? (
              <span className="nm-prod-task-faltas-tag" title="Cargado desde LISTA FALTAS">
                {' '}
                · Faltas
              </span>
            ) : null}
            <span className="nm-prod-task-separator">{showMeasureQtyLikeRectos ? ' ' : ' - '}</span>
            <span
              className="nm-prod-task-qty"
              title={
                done
                  ? 'Cortado'
                  : showOnlyDecrement
                    ? `Cortadas: ${displayedQty}`
                    : `Falta cortar: ${displayedQty}`
              }
            >
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
                aria-label={done ? 'Deshacer una unidad cortada' : 'Restar una unidad'}
                title={done ? 'Deshacer una unidad cortada' : 'Restar una unidad'}
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
      {task.notes && <p className="nm-prod-task-meta">{task.notes}</p>}
    </article>
  )
}
