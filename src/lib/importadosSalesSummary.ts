export type ImportadosSaleLine = {
  lineItemId: string
  orderId: string
  orderName: string
  paidAt: string
  month: string
  title: string
  variantTitle: string | null
  provider: 'lethal' | 'mk' | null
  quantity: number
  revenueArs: number
  costUsd: number | null
  pesoKg: number | null
  costArs: number | null
  profitArs: number | null
}

export type ImportadosMonthSummary = {
  month: string
  units: number
  revenueArs: number
  costArs: number
  profitArs: number
  missingCost: number
  lines: ImportadosSaleLine[]
}

export function currentArgentinaMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now)
  const year = parts.find((p) => p.type === 'year')?.value ?? '1970'
  const month = parts.find((p) => p.type === 'month')?.value ?? '01'
  return `${year}-${month}`
}

export function summarizeImportadosSales(
  lines: ImportadosSaleLine[],
): ImportadosMonthSummary[] {
  const byMonth = new Map<string, ImportadosMonthSummary>()

  for (const line of lines) {
    const month = line.month || '1970-01'
    const existing = byMonth.get(month) ?? {
      month,
      units: 0,
      revenueArs: 0,
      costArs: 0,
      profitArs: 0,
      missingCost: 0,
      lines: [],
    }
    existing.units += line.quantity
    existing.revenueArs += line.revenueArs
    if (line.costArs == null) {
      existing.missingCost += line.quantity
    } else {
      existing.costArs += line.costArs
      existing.profitArs += line.profitArs ?? 0
    }
    existing.lines.push(line)
    byMonth.set(month, existing)
  }

  return [...byMonth.values()].sort((a, b) => (a.month < b.month ? 1 : -1))
}
