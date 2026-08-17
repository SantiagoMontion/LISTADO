import type { TrackedProduct } from './supabase.js'

/** Por debajo de esto se rechequea en cada ventana de cron. */
export const LOW_STOCK_THRESHOLD = 5

/**
 * Stock holgado (>= threshold): rechequeo cada ~30 min.
 * Antes era 2h y si Shopify quedaba en 0 “por fuera”, no se auto-reparaba a tiempo.
 */
export const HIGH_STOCK_TTL_MS = 30 * 60 * 1000

/**
 * Stock bajo (>0): mínimo entre chequeos.
 * Con cron cada 5 min y lotes chicos, evita martillar el mismo SKU
 * si hay pocos due, y sigue siendo frecuente.
 */
export const LOW_STOCK_TTL_MS = 5 * 60 * 1000

/**
 * OOS confirmado (last_known 0): no saturar el lote.
 * Los ghost zeros / restock van primero.
 */
export const OOS_TTL_MS = 30 * 60 * 1000

/** Prioritarios (Zenitsu/Superglide/…): forzar rechequeo al menos cada 15 min. */
export const PRIORITY_TTL_MS = 15 * 60 * 1000

/**
 * Alta reciente: el Hub ya marcó in_stock pero nunca se escribió qty en Shopify.
 * El cron de 5 SKUs los salteaba si last_checked quedaba fresquito.
 */
export function needsInitialStockSync(product: TrackedProduct): boolean {
  if (product.in_stock === false) return false
  return product.last_known_qty === null || product.last_known_qty === undefined
}

/**
 * DB dice sin stock en NotMid pero recuerda qty>0 → casi seguro Shopify en 0
 * mientras el proveedor aún tiene (o había) unidades. Siempre rechequear.
 */
export function isGhostZeroSuspect(product: TrackedProduct): boolean {
  const known =
    product.last_known_qty === null || product.last_known_qty === undefined
      ? null
      : product.last_known_qty
  return product.in_stock === false && known !== null && known > 0
}

export function computeLastKnownQty(opts: {
  inStock: boolean
  quantities?: Array<{ qty: number }> | null
  /** No bajar de este piso si el sync no pudo escribir (skip/unreliable). */
  previousLastKnownQty?: number | null
  preservePreviousOnEmptyOrZero?: boolean
}): number {
  const qtys = (opts.quantities ?? [])
    .map((q) => Number(q.qty))
    .filter((n) => Number.isFinite(n))
  const prev =
    opts.previousLastKnownQty === null || opts.previousLastKnownQty === undefined
      ? null
      : Math.max(0, Math.trunc(Number(opts.previousLastKnownQty) || 0))

  if (qtys.length) {
    const min = Math.min(...qtys)
    if (
      opts.preservePreviousOnEmptyOrZero &&
      min <= 0 &&
      prev !== null &&
      prev > 0 &&
      opts.inStock
    ) {
      return prev
    }
    return min
  }

  if (opts.preservePreviousOnEmptyOrZero && prev !== null && prev > 0 && opts.inStock) {
    return prev
  }
  return opts.inStock ? 1 : 0
}

export function isProductDueForCheck(
  product: TrackedProduct,
  nowMs: number = Date.now(),
): boolean {
  // Ghost zero: Shopify/DB en OOS pero last_known>0 → curar YA.
  if (isGhostZeroSuspect(product)) return true
  if (needsInitialStockSync(product)) return true

  if (!product.last_checked) return true
  const checkedMs = Date.parse(product.last_checked)
  if (!Number.isFinite(checkedMs)) return true

  const age = nowMs - checkedMs
  const qty =
    product.last_known_qty === null || product.last_known_qty === undefined
      ? product.in_stock === false
        ? 0
        : null
      : product.last_known_qty

  // Sin snapshot: chequear (no sabemos si es holgado).
  if (qty === null) return age >= LOW_STOCK_TTL_MS

  if (qty <= 0) return age >= OOS_TTL_MS
  if (qty < LOW_STOCK_THRESHOLD) return age >= LOW_STOCK_TTL_MS
  return age >= HIGH_STOCK_TTL_MS
}

/**
 * Solo productos vencidos.
 * Orden: ghost zeros → nunca chequeados → stock bajo (>0) → holgado → OOS real.
 */
export function selectDueTrackedProducts(
  products: TrackedProduct[],
  nowMs: number = Date.now(),
): TrackedProduct[] {
  const due = products.filter((p) => isProductDueForCheck(p, nowMs))

  return [...due].sort((a, b) => {
    const scoreOf = (p: TrackedProduct): number => {
      if (isGhostZeroSuspect(p)) return -2
      if (needsInitialStockSync(p)) return -1.5
      if (!p.last_checked) return -1
      if (p.last_known_qty !== null && p.last_known_qty !== undefined) {
        const q = p.last_known_qty
        if (q > 0) return q
        return 1000
      }
      if (p.in_stock === false) return 1000
      return LOW_STOCK_THRESHOLD
    }

    const qa = scoreOf(a)
    const qb = scoreOf(b)
    if (qa !== qb) return qa - qb

    if (!a.last_checked && !b.last_checked) return 0
    if (!a.last_checked) return -1
    if (!b.last_checked) return 1
    return a.last_checked.localeCompare(b.last_checked)
  })
}

export function describeSchedule(product: TrackedProduct): {
  due: boolean
  ttlMs: number
  reason: string
} {
  if (isGhostZeroSuspect(product)) {
    return { due: true, ttlMs: 0, reason: 'ghost_zero' }
  }
  if (needsInitialStockSync(product)) {
    return { due: true, ttlMs: 0, reason: 'initial_stock' }
  }
  const qty =
    product.last_known_qty === null || product.last_known_qty === undefined
      ? null
      : product.last_known_qty
  const ttlMs =
    qty === null
      ? LOW_STOCK_TTL_MS
      : qty <= 0
        ? OOS_TTL_MS
        : qty < LOW_STOCK_THRESHOLD
          ? LOW_STOCK_TTL_MS
          : HIGH_STOCK_TTL_MS
  const reason =
    qty === null
      ? 'sin_snapshot'
      : qty <= 0
        ? 'oos'
        : qty < LOW_STOCK_THRESHOLD
          ? `stock_bajo_${qty}`
          : `stock_holgado_${qty}`
  return { due: isProductDueForCheck(product), ttlMs, reason }
}
