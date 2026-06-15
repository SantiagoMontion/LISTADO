import type { OperatorCutPlan } from '../lib/buildOperatorCutPlan'
import { formatOperatorPieceLine, formatRollMeters } from '../lib/buildOperatorCutPlan'

interface CutStripPlanViewProps {
  plan: OperatorCutPlan
  /** Total incl. molde; si no se pasa, usa solo el plan de planchas. */
  totalRollLengthCm?: number
}

function sheetCountLabel(count: number): string {
  if (count === 1) return '1 plancha'
  return `${count} planchas`
}

export function CutStripPlanView({ plan, totalRollLengthCm }: CutStripPlanViewProps) {
  const rollCm = totalRollLengthCm ?? plan.totalRollLengthCm

  return (
    <div className="cut-strip-plan">
      <p className="cut-strip-plan__total-meters">
        Metros de rollo (mts): {formatRollMeters(rollCm)}
      </p>

      <ol className="cut-strip-plan__list">
        {plan.strips.map((strip) => (
          <li key={strip.stripNumber} className="cut-strip-plan__card">
            <div className="cut-strip-plan__card-head">
              <span className="cut-strip-plan__badge">{strip.stripNumber}</span>
              <span className="cut-strip-plan__sheets">{sheetCountLabel(strip.sheetCount)}</span>
            </div>
            <p className="cut-strip-plan__cut-size">
              Cortar <strong>{strip.stripHeight}cm</strong> de largo
            </p>
            <p className="cut-strip-plan__width">
              Ancho usado: {strip.usedWidth} cm
              {strip.wasteWidth > 0 ? (
                <span className="cut-strip-plan__waste"> · sobra {strip.wasteWidth} cm</span>
              ) : null}
            </p>
            <div className="cut-strip-plan__pieces">
              <span className="cut-strip-plan__pieces-label">Salen</span>
              <p className="cut-strip-plan__pieces-inline">
                {strip.pieces.map((p) => formatOperatorPieceLine(p)).join('  +  ')}
              </p>
            </div>
          </li>
        ))}
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
