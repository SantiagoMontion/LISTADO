import type { OperatorCutPlan } from '../lib/buildOperatorCutPlan'
import { formatOperatorPieceLine, formatRollMeters } from '../lib/buildOperatorCutPlan'

interface CutStripPlanViewProps {
  plan: OperatorCutPlan
  /** Total incl. molde; si no se pasa, usa solo el plan de planchas. */
  totalRollLengthCm?: number
}

function sheetCountWord(count: number): string {
  return count === 1 ? 'plancha' : 'planchas'
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
