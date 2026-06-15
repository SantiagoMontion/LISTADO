import type { OperatorCutPlan } from '../lib/buildOperatorCutPlan'
import { formatOperatorPieceLine } from '../lib/buildOperatorCutPlan'
import {
  firstPendingTaskForLabel,
  lastCutTaskForLabel,
  remainingQtyForLabel,
} from '../lib/measureTaskMatch'
import type { NmProdTask } from '../lib/types'

interface CutStripPlanViewProps {
  plan: OperatorCutPlan
  planTasks: NmProdTask[]
  canEdit: boolean
  busy: boolean
  dismissedStripHeights: ReadonlySet<number>
  onToggleDismissStrip: (stripHeight: number) => void
  onIncrementTask: (task: NmProdTask) => void
  onDecrementTask: (task: NmProdTask) => void
}

function sheetCountWord(count: number): string {
  return count === 1 ? 'plancha' : 'planchas'
}

export function CutStripPlanView({
  plan,
  planTasks,
  canEdit,
  busy,
  dismissedStripHeights,
  onToggleDismissStrip,
  onIncrementTask,
  onDecrementTask,
}: CutStripPlanViewProps) {
  return (
    <div className="cut-strip-plan">
      <ol className="cut-strip-plan__list">
        {plan.strips.map((strip) => {
          const dismissed = dismissedStripHeights.has(strip.stripHeight)
          return (
            <li
              key={strip.stripNumber}
              className={`cut-strip-plan__card${dismissed ? ' cut-strip-plan__card--dismissed' : ''}`}
            >
              <div className="cut-strip-plan__card-head">
                <span className="cut-strip-plan__badge">{strip.stripNumber}</span>
                <button
                  type="button"
                  className={`cut-strip-plan__dismiss-btn btn-utility-rebel${dismissed ? ' cut-strip-plan__dismiss-btn--active' : ''}`}
                  aria-pressed={dismissed}
                  aria-label={dismissed ? 'Reactivar plancha' : 'Marcar plancha como hecha'}
                  title={dismissed ? 'Reactivar plancha' : 'Marcar plancha como hecha'}
                  onClick={() => onToggleDismissStrip(strip.stripHeight)}
                >
                  ✂
                </button>
              </div>
              <p className="cut-strip-plan__cut-size">
                Necesitas <strong>{strip.sheetCount}</strong> {sheetCountWord(strip.sheetCount)} de{' '}
                <strong>{strip.stripHeight}cm</strong> de largo
              </p>
              {!strip.mixedLayouts && strip.usedWidth > 0 ? (
                <p className="cut-strip-plan__width">
                  Ancho usado: {strip.usedWidth} cm
                  {strip.wasteWidth > 0 ? (
                    <span className="cut-strip-plan__waste"> · sobra {strip.wasteWidth} cm</span>
                  ) : null}
                </p>
              ) : null}
              <div className="cut-strip-plan__pieces">
                <span className="cut-strip-plan__pieces-label">Salen</span>
                <ul className="cut-strip-plan__pieces-lines">
                  {strip.pieces.map((p, i) => {
                    const remaining = remainingQtyForLabel(planTasks, p.label)
                    const allCut = remaining === 0
                    const lineLabel =
                      remaining > 0
                        ? formatOperatorPieceLine({ label: p.label, count: remaining })
                        : formatOperatorPieceLine(p)

                    return (
                      <li key={`${p.label}-${i}`} className="cut-strip-plan__piece-row">
                        <span className="cut-strip-plan__piece-label">{lineLabel}</span>
                        {canEdit ? (
                          <label className="cut-strip-plan__piece-check">
                            <input
                              type="checkbox"
                              className="cut-strip-plan__piece-check-input"
                              checked={allCut}
                              disabled={busy}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  const next = firstPendingTaskForLabel(planTasks, p.label)
                                  if (next) onIncrementTask(next)
                                } else {
                                  const prev = lastCutTaskForLabel(planTasks, p.label)
                                  if (prev) onDecrementTask(prev)
                                }
                              }}
                            />
                          </label>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              </div>
            </li>
          )
        })}
      </ol>

      {plan.unplaced.length > 0 ? (
        <section className="cut-strip-plan__unplaced" role="alert">
          <p className="cut-strip-plan__unplaced-title">No entran en el rollo (revisar a mano)</p>
          <ul>
            {plan.unplaced.map((u, i) => (
              <li key={`${u.label}-${i}`}>{u.label}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
