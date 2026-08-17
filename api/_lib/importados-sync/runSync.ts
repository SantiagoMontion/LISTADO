import {
  fetchNotmidProductVariants,
  getProductIdFromVariant,
  getVariantInventoryAtPrimaryLocation,
  setVariantInventoryAvailable,
  updateVariantPrice,
  type NotmidVariantRow,
} from './shopify.js'
import {
  fetchActiveTrackedProducts,
  pesoKgForNotmidVariant,
  updateTrackedProduct,
  type TrackedProduct,
  type VariantMapEntry,
} from './supabase.js'
import { fetchLethalSnapshot } from './providers/lethal.js'
import { fetchMkSnapshot } from './providers/mk.js'
import type { ProviderResult, ProviderSnapshot } from './providers/types.js'
import { fetchSupplierCatalog, type SupplierCatalogProduct } from './supplierCatalog.js'
import { lethalSafeNotmidQty } from './lethalCartStock.js'
import {
  computeLastKnownQty,
  isGhostZeroSuspect,
  needsInitialStockSync,
  selectDueTrackedProducts,
} from './stockSchedule.js'
import { fetchDolarMepQuote } from './dolarMep.js'
import { pricesArsEqual, shopifyArsFromSupplierUsd } from './importadosPricing.js'
import {
  decideInventoryWrite,
  shouldAlertZeroWrite,
  type OosPendingMap,
} from './inventoryWritePolicy.js'

export type ProductSyncError = {
  id: string
  provider: string
  url: string
  error: string
}

export type SyncSummary = {
  ok: boolean
  checked: number
  updated: number
  shopifyZeroed: number
  shopifyRestocked: number
  shopifyPricesUpdated: number
  unchanged: number
  /** Activos no procesados (lote lleno o aún frescos por TTL). */
  skipped: number
  /** Activos con stock holgado / chequeo reciente — no due. */
  deferredFresh: number
  /** Activos due que no entraron en este lote. */
  deferredQueue: number
  errors: ProductSyncError[]
  warnings: Array<{ id: string; messages: string[] }>
  durationMs: number
}

const BATCH_SIZE = 1
/**
 * Tope por corrida (~60s Vercel). Lethal cart probes ~8–12s/producto.
 * Ghost zeros van primero → en pocas corridas se autocuran todos.
 */
const DEFAULT_MAX_PRODUCTS_PER_RUN = 5

function pricesEqual(a: number | null, b: number): boolean {
  if (a === null || a === undefined) return false
  return Math.abs(Number(a) - b) < 0.0001
}

function variantLabel(parts: Array<string | null | undefined>): string {
  return parts
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(' / ')
    .toLowerCase()
}

function findSupplierVariant(
  catalog: SupplierCatalogProduct,
  entry: VariantMapEntry,
) {
  if (entry.supplierVariantId) {
    const byId = catalog.variants.find((v) => v.id === String(entry.supplierVariantId))
    if (byId) return byId
  }
  const optionKey = (entry.option || '').trim().toLowerCase()
  if (!optionKey) return undefined

  const exact = catalog.variants.filter((v) => {
    const title = (v.title || '').trim().toLowerCase()
    const joined = variantLabel([v.option1, v.option2, v.option3])
    return title === optionKey || joined === optionKey
  })
  if (exact.length === 1) return exact[0]
  return undefined
}

function matchSupplierToNotmid(
  catalog: SupplierCatalogProduct,
  notmid: NotmidVariantRow,
  map: VariantMapEntry[] | null | undefined,
) {
  // 1) Mapa explícito por variant id NotMid → supplier id
  if (map?.length) {
    const entry = map.find((e) => e.notmidVariantId === notmid.id)
    if (entry) {
      const fromMap = findSupplierVariant(catalog, entry)
      if (fromMap) return fromMap
    }
  }

  // 2) SKU exacto
  const sku = (notmid.sku || '').trim().toLowerCase()
  if (sku) {
    const bySku = catalog.variants.find((v) => (v.sku || '').trim().toLowerCase() === sku)
    if (bySku) return bySku
  }

  const notmidLabel = variantLabel([notmid.option1, notmid.option2, notmid.option3])
  const notmidTitle = (notmid.title || '').trim().toLowerCase()

  // 3) Título / label completo exacto (nunca “Red” suelto si hay varios Red)
  const exact = catalog.variants.filter((v) => {
    const title = (v.title || '').trim().toLowerCase()
    const joined = variantLabel([v.option1, v.option2, v.option3])
    return (
      (notmidTitle && (title === notmidTitle || joined === notmidTitle)) ||
      (notmidLabel && (title === notmidLabel || joined === notmidLabel))
    )
  })
  if (exact.length === 1) return exact[0]

  // 4) Si NotMid solo trae un eje (ej. “Red”) y hay UNA sola variante available con ese color, úsala.
  const token = notmidTitle || notmidLabel
  if (token && !token.includes('/')) {
    const colorHits = catalog.variants.filter((v) => {
      const parts = [v.option1, v.option2, v.option3, v.title]
        .map((p) => (p || '').trim().toLowerCase())
        .filter(Boolean)
      return parts.some((p) => p === token || p.endsWith(` / ${token}`) || p.startsWith(`${token} /`))
    })
    const availableHits = colorHits.filter((v) => v.storefrontAvailable || v.inventoryQuantity > 0)
    if (availableHits.length === 1) return availableHits[0]
    if (colorHits.length === 1) return colorHits[0]
  }

  return null
}

async function resolveNotmidProductId(product: TrackedProduct): Promise<string | null> {
  const fromCol = (product.notmid_shopify_product_id || '').trim()
  if (fromCol) return fromCol
  const variantId = (product.notmid_shopify_variant_id || '').trim()
  if (!variantId) return null
  return getProductIdFromVariant(variantId)
}

async function scrapeProduct(product: TrackedProduct): Promise<ProviderResult> {
  if (product.provider === 'lethal') return fetchLethalSnapshot(product)
  if (product.provider === 'mk') return fetchMkSnapshot(product)
  return { ok: false, error: `Unknown provider: ${String(product.provider)}` }
}

function resolvePesoKgForPricing(
  product: TrackedProduct,
  notmidVariantId: string,
): number | null {
  return pesoKgForNotmidVariant(product, notmidVariantId)
}

async function applyVariantInventories(
  product: TrackedProduct,
  catalog: SupplierCatalogProduct,
  opts: { dolarArs: number },
): Promise<{
  zeroed: number
  restocked: number
  pricesUpdated: number
  warnings: string[]
  quantities: Array<{ option: string; qty: number; notmidVariantId: string }>
  oosPending: OosPendingMap
  /** Shopify en 0 con señal de stock en proveedor, sin poder escribir aún. */
  needsRestock: boolean
  unmatchedVariants: number
}> {
  const warnings: string[] = []
  let zeroed = 0
  let restocked = 0
  let pricesUpdated = 0
  let needsRestock = false
  let unmatchedVariants = 0
  const quantities: Array<{ option: string; qty: number; notmidVariantId: string }> = []
  let oosPending: OosPendingMap = { ...(product.oos_pending ?? {}) }

  const productId = await resolveNotmidProductId(product)
  if (!productId) {
    return {
      zeroed,
      restocked,
      pricesUpdated,
      warnings,
      quantities,
      oosPending,
      needsRestock,
      unmatchedVariants,
    }
  }

  const notmidVariants = await fetchNotmidProductVariants(productId)
  if (!notmidVariants.length) {
    return {
      zeroed,
      restocked,
      pricesUpdated,
      warnings,
      quantities,
      oosPending,
      needsRestock,
      unmatchedVariants,
    }
  }

  const usedSupplier = new Set<string>()
  for (let i = 0; i < notmidVariants.length; i += 1) {
    const notmid = notmidVariants[i]
    let supplier = matchSupplierToNotmid(catalog, notmid, product.variant_map)
    // Fallback posicional si misma cantidad de variantes
    if (!supplier && notmidVariants.length === catalog.variants.length) {
      supplier = catalog.variants[i] ?? null
    }
    // Si el mapa apunta a OOS pero hay otra variante exacta en stock, preferir stock.
    if (
      supplier &&
      !supplier.storefrontAvailable &&
      supplier.inventoryQuantity <= 0 &&
      supplier.inventoryReliable !== false
    ) {
      const alt = matchSupplierToNotmid(catalog, notmid, null)
      if (
        alt &&
        alt.id !== supplier.id &&
        (alt.storefrontAvailable || alt.inventoryQuantity > 0)
      ) {
        console.warn(
          '[stock-map-override]',
          JSON.stringify({
            handle: product.shopify_handle,
            notmid: notmid.title,
            from: supplier.id,
            to: alt.id,
          }),
        )
        supplier = alt
      }
    }
    if (!supplier || usedSupplier.has(supplier.id)) {
      unmatchedVariants += 1
      warnings.push(`missing_supplier:${notmid.title || notmid.id}`)
      console.warn(
        '[stock-unmatched]',
        JSON.stringify({
          handle: product.shopify_handle,
          notmidVariantId: notmid.id,
          title: notmid.title,
          reason: !supplier ? 'no_match' : 'duplicate_supplier',
        }),
      )
      continue
    }
    usedSupplier.add(supplier.id)
    const qty = supplier.inventoryQuantity
    const reliable = supplier.inventoryReliable !== false
    const supplierHasSignal =
      supplier.storefrontAvailable || qty > 0 || Boolean(supplier.available)

    // Precio solo con el kg tipeado en el Hub. Shopify no guarda este número.
    const pesoKg = resolvePesoKgForPricing(product, notmid.id)
    if (pesoKg && supplier.priceUsd > 0) {
      try {
        const targetArs = shopifyArsFromSupplierUsd({
          costoProductoUsd: supplier.priceUsd,
          pesoKg,
          dolarArs: opts.dolarArs,
        })
        if (!pricesArsEqual(notmid.price, targetArs)) {
          await updateVariantPrice(notmid.id, targetArs)
          pricesUpdated += 1
        }
      } catch {
        // silencio
      }
    }

    try {
      const current = await getVariantInventoryAtPrimaryLocation(notmid.id)
      const decision = decideInventoryWrite({
        provider: product.provider,
        storefrontAvailable: supplier.storefrontAvailable,
        reliable,
        supplierQty: qty,
        shopifyQty: current.available,
        lastKnownQty: product.last_known_qty,
        notmidVariantId: notmid.id,
        oosPending,
        dbInStock: product.in_stock,
        lastCheckedMs: product.last_checked ? Date.parse(product.last_checked) : null,
      })
      oosPending = decision.oosPending

      if (decision.action === 'skip') {
        if (decision.reason.startsWith('oos_pending')) {
          console.warn(
            '[stock-guard]',
            JSON.stringify({
              handle: product.shopify_handle,
              variant: notmid.title || supplier.title,
              shopifyQty: current.available,
              supplierQty: qty,
              reason: decision.reason,
            }),
          )
          warnings.push(`pending_oos:${notmid.title || supplier.title}`)
        }
        // Shopify 0 + señal de stock / last_known: no dejar ghost zero.
        if (current.available <= 0 && supplierHasSignal) {
          const floor = Math.max(
            qty > 0 ? qty : 0,
            product.last_known_qty && product.last_known_qty > 0 ? product.last_known_qty : 0,
            supplier.storefrontAvailable ? 1 : 0,
          )
          if (floor > 0) {
            await setVariantInventoryAvailable(notmid.id, floor)
            restocked += 1
            quantities.push({
              option: notmid.title || supplier.title,
              qty: floor,
              notmidVariantId: notmid.id,
            })
            console.warn(
              '[stock-ghost-restock]',
              JSON.stringify({
                handle: product.shopify_handle,
                variant: notmid.title || supplier.title,
                from: current.available,
                to: floor,
                reason: decision.reason,
              }),
            )
            continue
          }
          needsRestock = true
          warnings.push(`needs_restock:${notmid.title || supplier.title}`)
          console.warn(
            '[stock-needs-restock]',
            JSON.stringify({
              handle: product.shopify_handle,
              variant: notmid.title || supplier.title,
              reason: decision.reason,
              supplierQty: qty,
              storefrontAvailable: supplier.storefrontAvailable,
              reliable,
            }),
          )
          continue
        }
        quantities.push({
          option: notmid.title || supplier.title,
          qty: current.available,
          notmidVariantId: notmid.id,
        })
        continue
      }

      const writeQty = decision.writeQty
      if (current.available === writeQty) {
        quantities.push({
          option: notmid.title || supplier.title,
          qty: writeQty,
          notmidVariantId: notmid.id,
        })
        continue
      }

      if (writeQty <= 0) {
        console.warn(
          '[stock-zero]',
          JSON.stringify({
            handle: product.shopify_handle,
            provider: product.provider,
            variant: notmid.title || supplier.title,
            notmidVariantId: notmid.id,
            from: current.available,
            to: 0,
            supplierQty: qty,
            reliable,
            storefrontAvailable: supplier.storefrontAvailable,
            lastKnownQty: product.last_known_qty,
            reason: decision.reason,
          }),
        )
        if (
          shouldAlertZeroWrite({
            reason: decision.reason,
            shopifyQty: current.available,
            lastKnownQty: product.last_known_qty,
          })
        ) {
          console.error(
            '[stock-alert] HIGH_TO_ZERO',
            JSON.stringify({
              handle: product.shopify_handle,
              from: current.available,
              lastKnownQty: product.last_known_qty,
              reason: decision.reason,
            }),
          )
        }
      }

      await setVariantInventoryAvailable(notmid.id, writeQty)
      quantities.push({
        option: notmid.title || supplier.title,
        qty: writeQty,
        notmidVariantId: notmid.id,
      })
      if (writeQty <= 0) zeroed += 1
      else restocked += 1
    } catch (err) {
      if (supplierHasSignal) needsRestock = true
      console.warn(
        '[stock-write-fail]',
        JSON.stringify({
          handle: product.shopify_handle,
          notmidVariantId: notmid.id,
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    }
  }

  if (catalog.inStock && restocked === 0) {
    const wrotePositive = quantities.some((q) => q.qty > 0)
    if (!wrotePositive) needsRestock = true
  }

  return {
    zeroed,
    restocked,
    pricesUpdated,
    warnings,
    quantities,
    oosPending,
    needsRestock,
    unmatchedVariants,
  }
}

/** Sin variant_map: al menos reponer/apagar la variante principal vinculada. */
async function applyLegacySingleVariantInventory(
  product: TrackedProduct,
  inStock: boolean,
): Promise<{ zeroed: boolean; restocked: boolean; warnings: string[] }> {
  const warnings: string[] = []
  const variantId = (product.notmid_shopify_variant_id || '').trim()
  if (!variantId) return { zeroed: false, restocked: false, warnings }

  try {
    if (!inStock) {
      // Sin confirmación por variante: no apagar a ciegas.
      return { zeroed: false, restocked: false, warnings }
    }

    let qty = 1
    if (product.provider === 'lethal') {
      try {
        const url = new URL(product.product_url)
        const supplierVariant =
          url.searchParams.get('variant') ||
          product.variant_map?.[0]?.supplierVariantId ||
          ''
        if (supplierVariant) {
          const origin = url.origin
          qty = await lethalSafeNotmidQty(origin, supplierVariant, true)
          if (qty <= 0) qty = 1
        }
      } catch {
        qty = 1
      }
    }
    await setVariantInventoryAvailable(variantId, qty)
    return { zeroed: false, restocked: true, warnings }
  } catch {
    return { zeroed: false, restocked: false, warnings }
  }
}

export async function processOne(
  product: TrackedProduct,
  opts?: { dolarArs?: number },
): Promise<{
  updated: boolean
  shopifyZeroed: boolean
  shopifyRestocked: boolean
  shopifyPricesUpdated: number
  warnings?: string[]
  error?: string
  detail?: {
    inStock: boolean
    price: number
    quantities?: Array<{ option: string; qty: number; notmidVariantId: string }>
  }
}> {
  try {
    const now = new Date().toISOString()
    let snapshot: ProviderSnapshot
    let shopifyZeroed = false
    let shopifyRestocked = false
    let shopifyPricesUpdated = 0
    let quantities:
      | Array<{ option: string; qty: number; notmidVariantId: string }>
      | undefined
    let oosPending: OosPendingMap = { ...(product.oos_pending ?? {}) }
    const syncWarnings: string[] = []

    const linked = Boolean(
      product.notmid_shopify_product_id || product.notmid_shopify_variant_id,
    )

    if (linked) {
      try {
        const probeVariantIds = (product.variant_map ?? [])
          .map((e) => e.supplierVariantId)
          .filter((id): id is string => Boolean(id && String(id).trim()))
        const mapIncomplete =
          !product.variant_map?.length ||
          product.variant_map.some(
            (e) => !e.supplierVariantId || !String(e.supplierVariantId).trim(),
          )

        const catalog = await fetchSupplierCatalog(product.provider, product.product_url, {
          mode: 'inventory',
          probeVariantIds:
            !mapIncomplete && probeVariantIds.length ? probeVariantIds : undefined,
        })
        snapshot = { price: catalog.price, inStock: catalog.inStock }
        let dolarArs = opts?.dolarArs
        if (dolarArs === undefined || !Number.isFinite(dolarArs) || dolarArs <= 0) {
          const mep = await fetchDolarMepQuote()
          dolarArs = mep.venta
        }
        const inv = await applyVariantInventories(product, catalog, { dolarArs })
        quantities = inv.quantities
        oosPending = inv.oosPending
        shopifyPricesUpdated = inv.pricesUpdated
        if (inv.zeroed > 0) shopifyZeroed = true
        if (inv.restocked > 0) shopifyRestocked = true
        if (inv.warnings.length) syncWarnings.push(...inv.warnings)
        if (inv.needsRestock) syncWarnings.push('needs_restock')
        if (inv.unmatchedVariants > 0) {
          syncWarnings.push(`unmatched_variants:${inv.unmatchedVariants}`)
        }

        // Si el mapa falló y no repusimos nada pero el proveedor tiene stock, legacy
        if (!inv.restocked && catalog.inStock && product.notmid_shopify_variant_id) {
          const legacy = await applyLegacySingleVariantInventory(product, true)
          if (legacy.restocked) shopifyRestocked = true
        }

        // Respiro extra tras Lethal para no martillar Cloudflare en el siguiente producto.
        if (product.provider === 'lethal') {
          await new Promise((r) => setTimeout(r, 1200))
        }

        // Snapshot de stock: no envenenar last_known si falló el restock.
        const healFailed =
          inv.needsRestock && !shopifyRestocked && catalog.inStock
        const lastKnownQty = computeLastKnownQty({
          inStock: catalog.inStock || Boolean(quantities?.some((q) => q.qty > 0)),
          quantities,
          previousLastKnownQty: product.last_known_qty,
          preservePreviousOnEmptyOrZero: healFailed || inv.needsRestock,
        })
        const inStockEffective =
          quantities && quantities.length > 0
            ? quantities.some((q) => q.qty > 0)
            : shopifyRestocked
              ? true
              : healFailed
                ? false
                : catalog.inStock

        const priceChanged = !pricesEqual(product.current_price, catalog.price)
        const stockChanged = product.in_stock !== inStockEffective
        const qtyChanged = product.last_known_qty !== lastKnownQty
        const pendingChanged =
          JSON.stringify(product.oos_pending ?? {}) !== JSON.stringify(oosPending)

        // Si sigue needing restock, NO avanzar last_checked → queda due el próximo cron.
        const bumpChecked = !healFailed

        if (
          priceChanged ||
          stockChanged ||
          qtyChanged ||
          pendingChanged ||
          product.last_checked === null ||
          bumpChecked
        ) {
          await updateTrackedProduct(product.id, {
            current_price: catalog.price,
            in_stock: inStockEffective,
            last_known_qty: lastKnownQty,
            oos_pending: oosPending,
            ...(bumpChecked ? { last_checked: now } : {}),
          })
          return {
            updated: true,
            shopifyZeroed,
            shopifyRestocked,
            shopifyPricesUpdated,
            warnings: syncWarnings.length ? syncWarnings : undefined,
            detail: { inStock: inStockEffective, price: catalog.price, quantities },
          }
        }

        return {
          updated: false,
          shopifyZeroed,
          shopifyRestocked,
          shopifyPricesUpdated,
          warnings: syncWarnings.length ? syncWarnings : undefined,
          detail: { inStock: inStockEffective, price: catalog.price, quantities },
        }
      } catch (err) {
        return {
          updated: false,
          shopifyZeroed: false,
          shopifyRestocked: false,
          shopifyPricesUpdated: 0,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    } else {
      const scraped = await scrapeProduct(product)
      if (!scraped.ok) {
        return {
          updated: false,
          shopifyZeroed: false,
          shopifyRestocked: false,
          shopifyPricesUpdated: 0,
          error: scraped.error,
        }
      }
      snapshot = scraped.data
    }

    const lastKnownQty = computeLastKnownQty({
      inStock: snapshot.inStock,
      quantities,
      previousLastKnownQty: product.last_known_qty,
    })
    // Si NotMid conserva unidades (p.ej. Lethal never-auto-zero), no marcar OOS en DB.
    const inStockEffective =
      quantities && quantities.length > 0
        ? quantities.some((q) => q.qty > 0)
        : snapshot.inStock
    const priceChanged = !pricesEqual(product.current_price, snapshot.price)
    const stockChanged = product.in_stock !== inStockEffective
    const qtyChanged = product.last_known_qty !== lastKnownQty
    const pendingChanged =
      JSON.stringify(product.oos_pending ?? {}) !== JSON.stringify(oosPending)

    if (
      priceChanged ||
      stockChanged ||
      qtyChanged ||
      pendingChanged ||
      product.last_checked === null
    ) {
      await updateTrackedProduct(product.id, {
        current_price: snapshot.price,
        in_stock: inStockEffective,
        last_known_qty: lastKnownQty,
        oos_pending: oosPending,
        last_checked: now,
      })
      return {
        updated: true,
        shopifyZeroed,
        shopifyRestocked,
        shopifyPricesUpdated,
        warnings: syncWarnings.length ? syncWarnings : undefined,
        detail: { inStock: inStockEffective, price: snapshot.price, quantities },
      }
    }

    await updateTrackedProduct(product.id, {
      last_known_qty: lastKnownQty,
      oos_pending: oosPending,
      last_checked: now,
    })
    return {
      updated: false,
      shopifyZeroed,
      shopifyRestocked,
      shopifyPricesUpdated,
      warnings: syncWarnings.length ? syncWarnings : undefined,
      detail: { inStock: inStockEffective, price: snapshot.price, quantities },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      updated: false,
      shopifyZeroed: false,
      shopifyRestocked: false,
      shopifyPricesUpdated: 0,
      error: message,
    }
  }
}

async function mapInBatches<T, R>(
  items: T[],
  batchSize: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    const settled = await Promise.allSettled(batch.map((item) => worker(item)))
    for (const entry of settled) {
      if (entry.status === 'fulfilled') {
        results.push(entry.value)
      } else {
        results.push({
          updated: false,
          shopifyZeroed: false,
          shopifyRestocked: false,
          shopifyPricesUpdated: 0,
          error: entry.reason instanceof Error ? entry.reason.message : String(entry.reason),
        } as R)
      }
    }
  }
  return results
}

export async function runInventorySync(opts?: {
  onlyProductId?: string
  onlyHandle?: string
  /** Override del tope por corrida (default 10). `0` = todos. */
  maxProducts?: number
}): Promise<SyncSummary> {
  const started = Date.now()
  let products = await fetchActiveTrackedProducts()

  if (opts?.onlyProductId) {
    products = products.filter((p) => p.id === opts.onlyProductId)
  }
  if (opts?.onlyHandle) {
    const needle = opts.onlyHandle.toLowerCase()
    products = products.filter(
      (p) =>
        (p.shopify_handle || '').toLowerCase().includes(needle) ||
        p.product_url.toLowerCase().includes(needle),
    )
  }

  const forceAll = Boolean(opts?.onlyProductId || opts?.onlyHandle)
  const maxProducts =
    opts?.maxProducts === undefined
      ? forceAll
        ? 0
        : DEFAULT_MAX_PRODUCTS_PER_RUN
      : opts.maxProducts

  // Cron: solo due (TTL por stock). Manual/focus: todos los filtrados.
  let due = forceAll || maxProducts === 0 ? products : selectDueTrackedProducts(products)
  // Ghost zeros SIEMPRE al frente (DB OOS + last_known>0).
  // Altas nuevas (sin last_known_qty) también: si no, quedan 0 en Shopify esperando cola.
  if (!forceAll && maxProducts !== 0) {
    const dueIds = new Set(due.map((p) => p.id))
    for (const p of products) {
      if ((isGhostZeroSuspect(p) || needsInitialStockSync(p)) && !dueIds.has(p.id)) {
        due.push(p)
        dueIds.add(p.id)
      }
    }
  }
  // Prioritarios: SIEMPRE en cada cron (auto-cura ceros fantasma en ≤5 min).
  const priorityNeedles = [
    'superglide-glass-mousepad',
    'pulsar-es2-zenitsu',
    'pulsar-x2h-v3-es-wireless-mouse',
  ]
  const isPriority = (p: TrackedProduct) =>
    isGhostZeroSuspect(p) ||
    priorityNeedles.some(
      (n) =>
        p.product_url.toLowerCase().includes(n) ||
        (p.shopify_handle || '').toLowerCase().includes(n),
    )
  if (!forceAll && maxProducts !== 0) {
    const dueIds = new Set(due.map((p) => p.id))
    for (const p of products) {
      if (isPriority(p) && !dueIds.has(p.id)) {
        due.push(p)
        dueIds.add(p.id)
      }
    }
  }
  due = [...due.filter(isPriority), ...due.filter((p) => !isPriority(p))]
  // Dentro de prioritarios, ghost zeros primero.
  due = [
    ...due.filter((p) => isGhostZeroSuspect(p)),
    ...due.filter((p) => !isGhostZeroSuspect(p) && needsInitialStockSync(p)),
    ...due.filter((p) => !isGhostZeroSuspect(p) && !needsInitialStockSync(p) && isPriority(p)),
    ...due.filter((p) => !isPriority(p) && !needsInitialStockSync(p) && !isGhostZeroSuspect(p)),
  ]
  const deferredFresh = forceAll || maxProducts === 0 ? 0 : Math.max(0, products.length - due.length)
  const queue = maxProducts > 0 ? due.slice(0, maxProducts) : due
  const deferredQueue = Math.max(0, due.length - queue.length)
  const skipped = deferredFresh + deferredQueue

  const mep = await fetchDolarMepQuote()
  const dolarArs = mep.venta

  type RowResult = {
    product: TrackedProduct
    updated: boolean
    shopifyZeroed: boolean
    shopifyRestocked: boolean
    shopifyPricesUpdated: number
    error?: string
  }

  const rows = await mapInBatches(queue, BATCH_SIZE, async (product) => {
    const result = await processOne(product, { dolarArs })
    return { product, ...result } satisfies RowResult
  })

  const errors: ProductSyncError[] = []
  let updated = 0
  let shopifyZeroed = 0
  let shopifyRestocked = 0
  let shopifyPricesUpdated = 0
  let unchanged = 0

  for (const row of rows) {
    if (row.error) {
      errors.push({
        id: row.product.id,
        provider: row.product.provider,
        url: row.product.product_url,
        error: row.error,
      })
    }
    if (row.updated) updated += 1
    else if (!row.error) unchanged += 1
    if (row.shopifyZeroed) shopifyZeroed += 1
    if (row.shopifyRestocked) shopifyRestocked += 1
    shopifyPricesUpdated += row.shopifyPricesUpdated || 0
  }

  return {
    ok: errors.length === 0,
    checked: queue.length,
    updated,
    shopifyZeroed,
    shopifyRestocked,
    shopifyPricesUpdated,
    unchanged,
    skipped,
    deferredFresh,
    deferredQueue,
    errors,
    warnings: [],
    durationMs: Date.now() - started,
  }
}
