import { fetchDolarMepQuote } from './dolarMep.js'
import {
  argentinaMonthKey,
  buildTrackedIndex,
  extractNumericId,
  fetchPaidOrdersSince,
  lineRevenueArs,
  resolveTrackedForLine,
  type ShopifyOrder,
} from './importadosOrders.js'
import { unitCostWithFrictionArs } from './importadosPricing.js'
import {
  fetchActiveTrackedProducts,
  getSupabase,
  pesoKgForNotmidVariant,
  type TrackedProduct,
} from './supabase.js'

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

export type ImportadosSalesPayload = {
  lines: ImportadosSaleLine[]
  ingestError: string | null
  tableMissing: boolean
}

function isMissingTable(message: string): boolean {
  return /does not exist|schema cache|could not find the table/i.test(message)
}

function saleQuantity(line: { quantity?: number }): number {
  return Math.max(0, Math.trunc(line.quantity ?? 0))
}

export function buildSaleRows(
  orders: ShopifyOrder[],
  tracked: TrackedProduct[],
  dolarArs: number,
): Array<Record<string, unknown>> {
  const index = buildTrackedIndex(tracked)
  const rows: Array<Record<string, unknown>> = []
  const seen = new Set<string>()

  for (const order of orders) {
    const orderId = extractNumericId(order.id)
    if (!orderId) continue
    const paidAt = order.created_at || new Date().toISOString()
    const month = argentinaMonthKey(paidAt)

    for (const line of order.line_items ?? []) {
      const quantity = saleQuantity(line)
      if (quantity <= 0) continue
      const matched = resolveTrackedForLine(line, index)
      if (!matched) continue

      const lineItemId =
        extractNumericId(line.id) || `${orderId}-${line.variant_id || line.title || 'line'}`
      if (seen.has(lineItemId)) continue
      seen.add(lineItemId)

      const notmidVariantId =
        matched.entry?.notmidVariantId ||
        extractNumericId(line.variant_id) ||
        matched.product.notmid_shopify_variant_id
      const pesoKg = pesoKgForNotmidVariant(matched.product, notmidVariantId)
      const costUsd = matched.product.current_price
      const unitCostArs = unitCostWithFrictionArs({
        costoProductoUsd: costUsd,
        pesoKg,
        dolarArs,
      })
      const revenueArs = lineRevenueArs(line)
      const costArs =
        unitCostArs == null ? null : Math.round(unitCostArs * quantity * 100) / 100
      const profitArs = costArs == null ? null : Math.round((revenueArs - costArs) * 100) / 100

      rows.push({
        shopify_order_id: orderId,
        shopify_line_item_id: lineItemId,
        shopify_order_name: (order.name || `#${orderId}`).trim(),
        shopify_variant_id: extractNumericId(line.variant_id),
        tracked_product_id: matched.product.id,
        supplier_variant_id: matched.entry?.supplierVariantId || null,
        provider: matched.product.provider,
        title: (line.title || line.name || 'Producto').trim(),
        variant_title: line.variant_title?.trim() || null,
        quantity,
        unit_price_ars: quantity > 0 ? Math.round((revenueArs / quantity) * 100) / 100 : 0,
        revenue_ars: Math.round(revenueArs * 100) / 100,
        cost_usd: costUsd,
        peso_kg: pesoKg,
        unit_cost_ars: unitCostArs == null ? null : Math.round(unitCostArs * 100) / 100,
        cost_ars: costArs,
        profit_ars: profitArs,
        dolar_mep: dolarArs,
        paid_at: paidAt,
        month: `${month}-01`,
      })
    }
  }

  return rows
}

function mapDbSale(row: Record<string, unknown>): ImportadosSaleLine {
  const monthRaw = String(row.month ?? '')
  const month = monthRaw.slice(0, 7)
  const costArs =
    row.cost_ars == null || row.cost_ars === undefined ? null : Number(row.cost_ars)
  const profitArs =
    row.profit_ars == null || row.profit_ars === undefined ? null : Number(row.profit_ars)
  return {
    lineItemId: String(row.shopify_line_item_id),
    orderId: String(row.shopify_order_id),
    orderName: String(row.shopify_order_name ?? ''),
    paidAt: String(row.paid_at ?? ''),
    month,
    title: String(row.title ?? 'Producto'),
    variantTitle: typeof row.variant_title === 'string' ? row.variant_title : null,
    provider:
      row.provider === 'lethal' || row.provider === 'mk'
        ? row.provider
        : null,
    quantity: Number(row.quantity) || 0,
    revenueArs: Number(row.revenue_ars) || 0,
    costUsd: row.cost_usd == null ? null : Number(row.cost_usd),
    pesoKg: row.peso_kg == null ? null : Number(row.peso_kg),
    costArs: Number.isFinite(costArs as number) ? costArs : null,
    profitArs: Number.isFinite(profitArs as number) ? profitArs : null,
  }
}

export async function ingestAndLoadImportadosSales(opts: {
  orders: ShopifyOrder[]
  tracked: TrackedProduct[]
}): Promise<ImportadosSalesPayload> {
  const supabase = getSupabase()
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - 90)

  try {
    const mep = await fetchDolarMepQuote()
    const rows = buildSaleRows(opts.orders, opts.tracked, mep.venta)
    if (rows.length) {
      const { error } = await supabase.from('importados_sales').upsert(rows, {
        onConflict: 'shopify_line_item_id',
        ignoreDuplicates: true,
      })
      if (error) {
        if (isMissingTable(error.message)) {
          return { lines: [], ingestError: null, tableMissing: true }
        }
        return { lines: [], ingestError: error.message, tableMissing: false }
      }
    }

    const { data, error: selectError } = await supabase
      .from('importados_sales')
      .select(
        'shopify_line_item_id, shopify_order_id, shopify_order_name, paid_at, month, title, variant_title, provider, quantity, revenue_ars, cost_usd, peso_kg, cost_ars, profit_ars',
      )
      .gte('paid_at', since.toISOString())
      .order('paid_at', { ascending: false })

    if (selectError) {
      if (isMissingTable(selectError.message)) {
        return { lines: [], ingestError: null, tableMissing: true }
      }
      return { lines: [], ingestError: selectError.message, tableMissing: false }
    }

    return {
      lines: (data ?? []).map((row) => mapDbSale(row as Record<string, unknown>)),
      ingestError: null,
      tableMissing: false,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (isMissingTable(message)) {
      return { lines: [], ingestError: null, tableMissing: true }
    }
    return { lines: [], ingestError: message, tableMissing: false }
  }
}

export async function syncAndLoadImportadosSales(): Promise<ImportadosSalesPayload> {
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - 90)
  const [paidWindow, tracked] = await Promise.all([
    fetchPaidOrdersSince(since.toISOString()),
    fetchActiveTrackedProducts(),
  ])
  return ingestAndLoadImportadosSales({ orders: paidWindow, tracked })
}
