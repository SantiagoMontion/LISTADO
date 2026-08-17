/**
 * Política de escritura de stock NotMid.
 *
 * Regla de oro:
 * - Hay stock en proveedor (available / qty>0) → escribir ese stock (nunca 0).
 * - Sin stock REAL confirmado → escribir 0 (tras doble confirmación).
 * - Duda / rate-limit / probe fallido → no tocar NotMid.
 */

/** Mínimo entre la 1ª señal OOS y permitir escribir 0 (≈ 2 crons de 5 min). */
export const OOS_CONFIRM_MS = 8 * 60 * 1000

/** Si last_known era alto y cae a 0, log de alerta. */
export const HIGH_STOCK_ALERT_THRESHOLD = 5

export type OosPendingMap = Record<string, string>

export type InventoryWriteInput = {
  provider: 'lethal' | 'mk' | string
  storefrontAvailable: boolean
  reliable: boolean
  supplierQty: number
  shopifyQty: number
  /** Min qty conocido del producto (freno extra). */
  lastKnownQty: number | null
  notmidVariantId: string
  oosPending: OosPendingMap
  nowMs?: number
  dbInStock?: boolean | null
  lastCheckedMs?: number | null
  /**
   * Audit manual: permite 0 en el primer sighting confiable.
   * El cron NUNCA debe pasar true.
   */
  allowImmediateZero?: boolean
}

export type InventoryWriteDecision =
  | {
      action: 'write'
      writeQty: number
      oosPending: OosPendingMap
      reason: string
    }
  | {
      action: 'skip'
      oosPending: OosPendingMap
      reason: string
    }

function clonePending(map: OosPendingMap): OosPendingMap {
  return { ...map }
}

function clearPending(map: OosPendingMap, variantId: string): OosPendingMap {
  const next = clonePending(map)
  delete next[variantId]
  return next
}

function markPending(map: OosPendingMap, variantId: string, nowIso: string): OosPendingMap {
  const next = clonePending(map)
  if (!next[variantId]) next[variantId] = nowIso
  return next
}

export function parseOosPending(raw: unknown): OosPendingMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: OosPendingMap = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim() && Number.isFinite(Date.parse(v))) {
      out[k] = v
    }
  }
  return out
}

/**
 * Decide si escribir stock y cómo actualizar oos_pending.
 *
 * 1) storefront available → qty confiable o ≥1 (nunca 0)
 * 2) probe unreliable → no tocar
 * 3) qty > 0 → escribir y limpiar pending
 * 4) OOS confiable + shopify ya 0 → noop write 0
 * 5) OOS confiable + shopify > 0 → pending; 2ª vez (≥ OOS_CONFIRM_MS) → 0
 */
export function decideInventoryWrite(input: InventoryWriteInput): InventoryWriteDecision {
  const nowMs = input.nowMs ?? Date.now()
  const nowIso = new Date(nowMs).toISOString()
  let pending = clonePending(input.oosPending)
  const qty = Math.max(0, Math.trunc(Number(input.supplierQty) || 0))
  const shopifyQty = Math.max(0, Math.trunc(Number(input.shopifyQty) || 0))
  const lastKnown =
    input.lastKnownQty === null || input.lastKnownQty === undefined
      ? null
      : Math.max(0, Math.trunc(Number(input.lastKnownQty) || 0))

  // Con stock en vitrina: siempre reflejar stock (nunca 0).
  if (input.storefrontAvailable) {
    const writeQty = input.reliable && qty > 0 ? qty : Math.max(qty, lastKnown ?? 0, 1)
    pending = clearPending(pending, input.notmidVariantId)
    return {
      action: 'write',
      writeQty,
      oosPending: pending,
      reason:
        input.reliable && qty > 0
          ? 'available_reliable_qty'
          : lastKnown && lastKnown > 0
            ? 'available_restore_last_known'
            : 'available_floor_1',
    }
  }

  // Shopify en 0 + última qty conocida: ghost zero. Reponer; no dejar 0
  // porque un probe fallido (Cloudflare en Vercel) apagaba productos con stock.
  if (shopifyQty <= 0 && lastKnown !== null && lastKnown > 0) {
    if (qty > 0) {
      pending = clearPending(pending, input.notmidVariantId)
      return {
        action: 'write',
        writeQty: qty,
        oosPending: pending,
        reason: 'ghost_zero_live_qty',
      }
    }
    if (!input.reliable || String(input.provider).toLowerCase() === 'lethal') {
      pending = clearPending(pending, input.notmidVariantId)
      return {
        action: 'write',
        writeQty: lastKnown,
        oosPending: pending,
        reason: 'ghost_zero_restore_last_known',
      }
    }
  }

  // Sin evidencia confiable: no tocar (tampoco apagar).
  if (!input.reliable) {
    return {
      action: 'skip',
      oosPending: pending,
      reason: 'unreliable_probe',
    }
  }

  // Qty positiva aunque el flag available venga raro.
  if (qty > 0) {
    pending = clearPending(pending, input.notmidVariantId)
    return {
      action: 'write',
      writeQty: qty,
      oosPending: pending,
      reason: 'positive_qty',
    }
  }

  // --- OOS confiable (qty 0 + reliable) ---
  // Lethal: NUNCA escribir 0. Si Shopify ya está en 0, no pisar; si tiene
  // unidades, dejarlas. El cero fantasma se cura más arriba con last_known.
  if (String(input.provider).toLowerCase() === 'lethal') {
    pending = clearPending(pending, input.notmidVariantId)
    if (shopifyQty <= 0) {
      return {
        action: 'skip',
        oosPending: pending,
        reason: 'lethal_oos_leave_zero',
      }
    }
    return {
      action: 'skip',
      oosPending: pending,
      reason: 'lethal_restock_only',
    }
  }

  if (shopifyQty <= 0) {
    pending = clearPending(pending, input.notmidVariantId)
    return {
      action: 'write',
      writeQty: 0,
      oosPending: pending,
      reason: 'oos_already_zero',
    }
  }

  if (input.allowImmediateZero) {
    pending = clearPending(pending, input.notmidVariantId)
    return {
      action: 'write',
      writeQty: 0,
      oosPending: pending,
      reason: 'oos_force_immediate',
    }
  }

  // MK: doble confirmación.
  const pendingAt = pending[input.notmidVariantId]
  if (!pendingAt) {
    pending = markPending(pending, input.notmidVariantId, nowIso)
    return {
      action: 'skip',
      oosPending: pending,
      reason: 'oos_pending_first_sight',
    }
  }

  const pendingMs = Date.parse(pendingAt)
  if (!Number.isFinite(pendingMs) || nowMs - pendingMs < OOS_CONFIRM_MS) {
    return {
      action: 'skip',
      oosPending: pending,
      reason: 'oos_pending_waiting_confirm',
    }
  }

  pending = clearPending(pending, input.notmidVariantId)
  const fromHigh =
    (lastKnown !== null && lastKnown >= HIGH_STOCK_ALERT_THRESHOLD) ||
    shopifyQty >= HIGH_STOCK_ALERT_THRESHOLD
  return {
    action: 'write',
    writeQty: 0,
    oosPending: pending,
    reason: fromHigh ? 'oos_confirmed_from_high' : 'oos_confirmed',
  }
}

export function shouldAlertZeroWrite(opts: {
  reason: string
  shopifyQty: number
  lastKnownQty: number | null
}): boolean {
  if (!opts.reason.startsWith('oos_')) return false
  if (opts.reason === 'oos_already_zero') return false
  const last =
    opts.lastKnownQty === null || opts.lastKnownQty === undefined
      ? 0
      : opts.lastKnownQty
  return (
    opts.shopifyQty >= HIGH_STOCK_ALERT_THRESHOLD ||
    last >= HIGH_STOCK_ALERT_THRESHOLD ||
    opts.reason === 'oos_confirmed_from_high'
  )
}
