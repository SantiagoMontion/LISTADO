import type { OperatorCutPlan } from '../lib/buildOperatorCutPlan'

interface CutStripPlanViewProps {
  plan: OperatorCutPlan
  materialLabel: string
}

function sheetCountLabel(count: number): string {
  if (count === 1) return '1 plancha'
  return `${count} planchas iguales`
}

export function CutStripPlanView({ plan, materialLabel }: CutStripPlanViewProps) {
  return (
    <div className="cut-strip-plan">
      <header className="cut-strip-plan__summary">
        <p className="cut-strip-plan__summary-title">Plan de corte — {materialLabel}</p>
        <p className="cut-strip-plan__summary-meta">
          Rollo {plan.rollWidth} cm · {plan.stripCount}{' '}
          {plan.stripCount === 1 ? 'tira' : 'tiras'} · {plan.totalRollLengthCm} cm de largo total
        </p>
        <p className="cut-strip-plan__summary-hint">
          Cortá en orden. Cada tira = un corte horizontal; las medidas salen una al lado de la otra.
        </p>
      </header>

      <ol className="cut-strip-plan__list">
        {plan.strips.map((strip) => (
          <li key={strip.stripNumber} className="cut-strip-plan__card">
            <div className="cut-strip-plan__card-head">
              <span className="cut-strip-plan__badge">Tira {strip.stripNumber}</span>
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
                {strip.pieces.map((p) => p.label).join('  +  ')}
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
