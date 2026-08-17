import type { TrackedProduct, VariantMapEntry } from './supabase.js'

export type VariantMapHealthItem = {
  id: string
  handle: string | null
  provider: string
  status: 'complete' | 'incomplete' | 'monitor_only'
  variantCount: number
  reason?: string
}

export type VariantMapHealthReport = {
  total: number
  complete: number
  incomplete: number
  monitorOnly: number
  items: VariantMapHealthItem[]
}

function extractNumericId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value))
  }
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const gidMatch = trimmed.match(/\/(\d+)\s*$/)
  if (gidMatch) return gidMatch[1]
  if (/^\d+$/.test(trimmed)) return trimmed
  return null
}

export function mapIsComplete(map: VariantMapEntry[] | null | undefined): boolean {
  if (!Array.isArray(map) || map.length === 0) return false
  return map.every(
    (e) =>
      Boolean(e?.notmidVariantId?.toString().trim()) &&
      Boolean(e?.supplierVariantId?.toString().trim()),
  )
}

export function assessVariantMapHealth(products: TrackedProduct[]): VariantMapHealthReport {
  const items: VariantMapHealthItem[] = []
  let complete = 0
  let incomplete = 0
  let monitorOnly = 0

  for (const product of products) {
    const linked = Boolean(
      extractNumericId(product.notmid_shopify_product_id) ||
        extractNumericId(product.notmid_shopify_variant_id),
    )
    const map = product.variant_map
    const variantCount = Array.isArray(map) ? map.length : 0

    if (!linked) {
      monitorOnly += 1
      items.push({
        id: product.id,
        handle: product.shopify_handle,
        provider: product.provider,
        status: 'monitor_only',
        variantCount,
        reason: 'Sin producto NotMid vinculado (solo monitoreo)',
      })
      continue
    }

    if (mapIsComplete(map)) {
      complete += 1
      items.push({
        id: product.id,
        handle: product.shopify_handle,
        provider: product.provider,
        status: 'complete',
        variantCount,
      })
      continue
    }

    incomplete += 1
    const reason = !map
      ? 'Sin variant_map'
      : !Array.isArray(map) || map.length === 0
        ? 'variant_map vacío'
        : 'Faltan supplierVariantId o notmidVariantId en alguna entrada'
    items.push({
      id: product.id,
      handle: product.shopify_handle,
      provider: product.provider,
      status: 'incomplete',
      variantCount,
      reason,
    })
  }

  return {
    total: products.length,
    complete,
    incomplete,
    monitorOnly,
    items,
  }
}
