import type { OperatorCutPlan } from '../lib/buildOperatorCutPlan'
import { formatOperatorPieceLine } from '../lib/buildOperatorCutPlan'
import { MaterialMetersLine } from './MaterialMetersLine'

interface CutStripPlanViewProps {
  plan: OperatorCutPlan
  /** Metros de material solo de esta sección (personalizados). */
  materialMetersCm?: number
}

function sheetCountWord(count: number): string {
  return count === 1 ? 'plancha' : 'planchas'
}

export function CutStripPlanView({ plan, materialMetersCm }: CutStripPlanViewProps) {
  const rollCm = materialMetersCm ?? plan.totalRollLengthCm

  return (
    <div className="cut-strip-plan">
      <MaterialMetersLine cm={rollCm} />

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
              <ul className="cut-strip-plan__pieces-lines">
                {strip.pieces.map((p, i) => (
                  <li key={`${p.label}-${i}`}>{formatOperatorPieceLine(p)}</li>
                ))}
              </ul>
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
