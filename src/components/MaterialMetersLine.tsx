import { formatMaterialMeters } from '../lib/buildOperatorCutPlan'

interface MaterialMetersLineProps {
  cm: number
}

export function MaterialMetersLine({ cm }: MaterialMetersLineProps) {
  if (cm <= 0) return null
  return (
    <p className="cut-strip-plan__total-meters">
      Metros de material: {formatMaterialMeters(cm)}
    </p>
  )
}
