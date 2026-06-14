import type { OperatorCutPlan } from '../lib/buildOperatorCutPlan'
import { formatOperatorPieceLine } from '../lib/buildOperatorCutPlan'

interface CutStripPlanViewProps {
  plan: OperatorCutPlan
}

function sheetCountLabel(count: number): string {
  if (count === 1) return '1 plancha'
  return `${count} planchas iguales`
}

function formatMeters(cm: number): string {
  const m = cm / 100
  return m >= 10 ? `${m.toFixed(1)} m` : `${m.toFixed(2)} m`
}

export function CutStripPlanView({ plan }: CutStripPlanViewProps) {
  return (
    <div className="cut-strip-plan">
      <p className="cut-strip-plan__total-meters">
        Metros de rollo: {formatMeters(plan.totalRollLengthCm)}
      </p>

      <ol className="cut-strip-plan__list">
        {plan.strips.map((strip) => (
          <li key={strip.stripNumber} className="cut-strip-plan__card">
            <div className="cut-strip-plan__card-head">
              <span className="cut-strip-plan__badge">Plancha {strip.stripNumber}</span>
              <span className="cut-strip-plan__sheets">{sheetCountLabel(strip.sheetCount)}</span>
            </div>
            <p className="cut-strip-plan__cut-size">
              Corte en eje: <strong>{strip.stripHeight} cm</strong> de alto
            </p>
            <p className="cut-strip-plan__width">
              Ancho usado: {strip.usedWidth} cm
              {strip.wasteWidth > 0 ? (
                <span className="cut-strip-plan__waste"> · sobra {strip.wasteWidth} cm</span>
              ) : null}
            </p>
            <div className="cut-strip-plan__pieces">
              <span className="cut-strip-plan__pieces-label">Sale:</span>
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
