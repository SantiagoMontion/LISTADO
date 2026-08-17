import {
  fetchNotmidProductVariants,
  getProductIdFromVariant,
  getVariantInventoryAtPrimaryLocation,
  setVariantInventoryAvailable,
} from './shopify.js'
import {
  fetchActiveTrackedProducts,
  updateTrackedProduct,
  type TrackedProduct,
} from './supabase.js'
import { fetchSupplierCatalog, type SupplierCatalogProduct } from './supplierCatalog.js'
import { computeLastKnownQty, selectDueTrackedProducts } from './stockSchedule.js'
import {
  decideInventoryWrite,
  shouldAlertZeroWrite,
  type OosPendingMap,
} from './inventoryWritePolicy.js'

export type StockAuditVariantRow = {
  notmidVariantId: string
  label: string
  sku: string | null
  supplierQty: number | null
  shopifyQty: number
  status: 'ok' | 'mismatch' | 'missing_supplier' | 'repaired' | 'error'
  detail?: string
}

export type StockAuditProductRow = {
  id: string
  provider: string
  handle: string | null
  title: string
  url: string
  linked: boolean
  monitorOnly: boolean
  dbInStock: boolean | null
  catalogInStock: boolean | null
  locationName: string | null
  status: 'ok' | 'mismatch' | 'monitor_only' | 'unlinked' | 'error' | 'repaired'
  variants: StockAuditVariantRow[]
  error?: string
  warnings?: string[]
}

export type StockAuditReport = {
  at: string
  locationName: string | null
  total: number
  ok: number
  mismatch: number
  repaired: number
  monitorOnly: number
  errors: number
  products: StockAuditProductRow[]
  durationMs: number
}

function variantLabel(parts: Array<string | null | undefined>): string {
  return parts
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(' / ')
}

function matchSupplier(
  catalog: SupplierCatalogProduct,
  notmid: { id: string; title: string; sku: string | null; option1: string | null; option2: string | null; option3: string | null },
  map: TrackedProduct['variant_map'],
  index: number,
  totalNotmid: number,
) {
  if (map?.length) {
    const entry = map.find((e) => e.notmidVariantId === notmid.id)
    if (entry?.supplierVariantId) {
      const byId = catalog.variants.find((v) => v.id === String(entry.supplierVariantId))
      if (byId) return byId
    }
  }

  const sku = (notmid.sku || '').trim().toLowerCase()
  if (sku) {
    const bySku = catalog.variants.find((v) => (v.sku || '').trim().toLowerCase() === sku)
    if (bySku) return bySku
  }

  const label = variantLabel([notmid.option1, notmid.option2, notmid.option3]).toLowerCase()
  const title = (notmid.title || '').trim().toLowerCase()
  const exact = catalog.variants.filter((v) => {
    const t = (v.title || '').trim().toLowerCase()
    const j = variantLabel([v.option1, v.option2, v.option3]).toLowerCase()
    return (
      (title && (t === title || j === title)) ||
      (label && (t === label || j === label))
    )
  })
  if (exact.length === 1) return exact[0]

  const token = title || label
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

  if (totalNotmid === catalog.variants.length) {
    return catalog.variants[index] ?? null
  }
  return null
}

async function resolveProductId(product: TrackedProduct): Promise<string | null> {
  const fromCol = (product.notmid_shopify_product_id || '').trim()
  if (fromCol) return fromCol
  const variantId = (product.notmid_shopify_variant_id || '').trim()
  if (!variantId) return null
  return getProductIdFromVariant(variantId)
}

function productTitle(product: TrackedProduct): string {
  return (
    (product.shopify_handle || '').trim() ||
    product.product_url.replace(/^https?:\/\//, '').slice(0, 80)
  )
}

export async function auditOneProduct(
  product: TrackedProduct,
  opts?: { repair?: boolean },
): Promise<StockAuditProductRow> {
  const repair = opts?.repair !== false
  const linked = Boolean(
    product.notmid_shopify_product_id || product.notmid_shopify_variant_id,
  )

  if (!linked) {
    return {
      id: product.id,
      provider: product.provider,
      handle: product.shopify_handle,
      title: productTitle(product),
      url: product.product_url,
      linked: false,
      monitorOnly: true,
      dbInStock: product.in_stock,
      catalogInStock: null,
      locationName: null,
      status: 'monitor_only',
      variants: [],
    }
  }

  try {
    const catalog = await fetchSupplierCatalog(product.provider, product.product_url, {
      mode: 'inventory',
    })
    const productId = await resolveProductId(product)
    if (!productId) {
      return {
        id: product.id,
        provider: product.provider,
        handle: product.shopify_handle,
        title: productTitle(product),
        url: product.product_url,
        linked: false,
        monitorOnly: false,
        dbInStock: product.in_stock,
        catalogInStock: catalog.inStock,
        locationName: null,
        status: 'unlinked',
        variants: [],
        error: 'Sin product_id NotMid',
      }
    }

    const notmidVariants = await fetchNotmidProductVariants(productId)
    const variants: StockAuditVariantRow[] = []
    let locationName: string | null = null
    let anyMismatch = false
    let anyRepaired = false
    let oosPending: OosPendingMap = { ...(product.oos_pending ?? {}) }

    for (let i = 0; i < notmidVariants.length; i += 1) {
      const notmid = notmidVariants[i]
      const supplier = matchSupplier(
        catalog,
        notmid,
        product.variant_map,
        i,
        notmidVariants.length,
      )
      const shopifyInv = await getVariantInventoryAtPrimaryLocation(notmid.id)
      locationName = shopifyInv.locationName
      const shopifyQty = shopifyInv.available
      const label = notmid.title || variantLabel([notmid.option1, notmid.option2, notmid.option3])

      if (!supplier) {
        anyMismatch = true
        variants.push({
          notmidVariantId: notmid.id,
          label,
          sku: notmid.sku,
          supplierQty: null,
          shopifyQty,
          status: 'missing_supplier',
          detail: 'Sin match en catálogo proveedor',
        })
        await new Promise((r) => setTimeout(r, 400))
        continue
      }

      const supplierQty = supplier.inventoryQuantity
      const reliable = supplier.inventoryReliable !== false
      const decision = decideInventoryWrite({
        provider: product.provider,
        storefrontAvailable: supplier.storefrontAvailable,
        reliable,
        supplierQty,
        shopifyQty,
        lastKnownQty: product.last_known_qty,
        notmidVariantId: notmid.id,
        oosPending,
        dbInStock: product.in_stock,
        lastCheckedMs: product.last_checked ? Date.parse(product.last_checked) : null,
      })
      oosPending = decision.oosPending

      if (decision.action === 'skip') {
        variants.push({
          notmidVariantId: notmid.id,
          label,
          sku: notmid.sku,
          supplierQty,
          shopifyQty,
          status: 'ok',
          detail: decision.reason,
        })
        await new Promise((r) => setTimeout(r, 500))
        continue
      }

      const targetQty = decision.writeQty
      if (targetQty === shopifyQty) {
        variants.push({
          notmidVariantId: notmid.id,
          label,
          sku: notmid.sku,
          supplierQty: targetQty,
          shopifyQty,
          status: 'ok',
          detail: decision.reason,
        })
        await new Promise((r) => setTimeout(r, 500))
        continue
      }

      anyMismatch = true
      if (repair) {
        // Lethal: jamás escribir 0 desde audit (solo restock / alinear positivo).
        if (
          String(product.provider).toLowerCase() === 'lethal' &&
          targetQty <= 0
        ) {
          variants.push({
            notmidVariantId: notmid.id,
            label,
            sku: notmid.sku,
            supplierQty: targetQty,
            shopifyQty,
            status: shopifyQty <= 0 ? 'ok' : 'mismatch',
            detail: 'audit_skip_lethal_zero',
          })
          await new Promise((r) => setTimeout(r, 500))
          continue
        }
        try {
          if (targetQty <= 0) {
            console.warn(
              '[stock-zero-audit]',
              JSON.stringify({
                handle: product.shopify_handle,
                variant: label,
                from: shopifyQty,
                reason: decision.reason,
              }),
            )
            if (
              shouldAlertZeroWrite({
                reason: decision.reason,
                shopifyQty,
                lastKnownQty: product.last_known_qty,
              })
            ) {
              console.error(
                '[stock-alert] HIGH_TO_ZERO',
                JSON.stringify({
                  handle: product.shopify_handle,
                  from: shopifyQty,
                  reason: decision.reason,
                }),
              )
            }
          }
          await setVariantInventoryAvailable(notmid.id, targetQty)
          const after = await getVariantInventoryAtPrimaryLocation(notmid.id)
          const okNow = after.available === targetQty
          if (okNow) anyRepaired = true
          variants.push({
            notmidVariantId: notmid.id,
            label,
            sku: notmid.sku,
            supplierQty: targetQty,
            shopifyQty: after.available,
            status: okNow ? 'repaired' : 'mismatch',
            detail: decision.reason,
          })
        } catch (err) {
          variants.push({
            notmidVariantId: notmid.id,
            label,
            sku: notmid.sku,
            supplierQty: targetQty,
            shopifyQty,
            status: 'error',
            detail: err instanceof Error ? err.message : String(err),
          })
        }
      } else {
        variants.push({
          notmidVariantId: notmid.id,
          label,
          sku: notmid.sku,
          supplierQty: targetQty,
          shopifyQty,
          status: 'mismatch',
          detail: decision.reason,
        })
      }
      await new Promise((r) => setTimeout(r, 500))
    }

    // Alinear flag DB + snapshot qty (TTL)
    const knownQtys = variants
      .map((v) => (typeof v.shopifyQty === 'number' ? v.shopifyQty : v.supplierQty))
      .filter((q): q is number => typeof q === 'number' && Number.isFinite(q))
    const lastKnownQty = computeLastKnownQty({
      inStock: catalog.inStock,
      quantities: knownQtys.map((qty) => ({ qty })),
    })

    if (repair) {
      try {
        await updateTrackedProduct(product.id, {
          ...(product.in_stock !== catalog.inStock
            ? { in_stock: catalog.inStock, current_price: catalog.price }
            : {}),
          last_known_qty: lastKnownQty,
          oos_pending: oosPending,
          last_checked: new Date().toISOString(),
        })
      } catch {
        // silencio
      }
    }

    const status: StockAuditProductRow['status'] = anyRepaired
      ? 'repaired'
      : anyMismatch
        ? 'mismatch'
        : 'ok'

    return {
      id: product.id,
      provider: product.provider,
      handle: product.shopify_handle,
      title: catalog.title || productTitle(product),
      url: product.product_url,
      linked: true,
      monitorOnly: false,
      dbInStock: product.in_stock,
      catalogInStock: catalog.inStock,
      locationName,
      status,
      variants,
    }
  } catch (err) {
    return {
      id: product.id,
      provider: product.provider,
      handle: product.shopify_handle,
      title: productTitle(product),
      url: product.product_url,
      linked: true,
      monitorOnly: false,
      dbInStock: product.in_stock,
      catalogInStock: null,
      locationName: null,
      status: 'error',
      variants: [],
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function runStockAudit(opts?: {
  repair?: boolean
  maxProducts?: number
  offset?: number
  /** Hub / force: ignora TTL y recorre todos. */
  forceAll?: boolean
  /** Lista fija de ids (orden estable; evita que el offset se desordene al actualizar last_checked). */
  productIds?: string[]
}): Promise<StockAuditReport> {
  const started = Date.now()
  const repair = opts?.repair !== false
  const all = await fetchActiveTrackedProducts()
  const byId = new Map(all.map((p) => [p.id, p]))
  let pool: TrackedProduct[]
  if (opts?.productIds?.length) {
    pool = opts.productIds.map((id) => byId.get(id)).filter(Boolean) as TrackedProduct[]
  } else {
    const forceAll = opts?.forceAll === true || !(opts?.maxProducts && opts.maxProducts > 0)
    pool = forceAll ? all : selectDueTrackedProducts(all)
    // Orden estable para paginar sin saltar/repetir entre lotes.
    pool = [...pool].sort((a, b) => a.id.localeCompare(b.id))
  }
  const offset = Math.max(0, opts?.offset ?? 0)
  const max = opts?.maxProducts && opts.maxProducts > 0 ? opts.maxProducts : pool.length
  const slice = pool.slice(offset, offset + max)

  const products: StockAuditProductRow[] = []
  for (const product of slice) {
    const row = await auditOneProduct(product, { repair })
    products.push(row)
    console.log(
      '[stock-audit-row]',
      JSON.stringify({
        handle: row.handle,
        title: row.title,
        provider: row.provider,
        status: row.status,
        variants: row.variants.map((v) => ({
          label: v.label,
          supplierQty: v.supplierQty,
          shopifyQty: v.shopifyQty,
          status: v.status,
        })),
        error: row.error,
      }),
    )
    // Evitar 429 de Shopify Admin (2 req/s)
    await new Promise((r) => setTimeout(r, 700))
  }

  const locationName = products.find((p) => p.locationName)?.locationName ?? null
  let ok = 0
  let mismatch = 0
  let repaired = 0
  let monitorOnly = 0
  let errors = 0
  for (const p of products) {
    if (p.status === 'ok') ok += 1
    else if (p.status === 'repaired') repaired += 1
    else if (p.status === 'mismatch') mismatch += 1
    else if (p.status === 'monitor_only') monitorOnly += 1
    else errors += 1
  }

  return {
    at: new Date().toISOString(),
    locationName,
    total: products.length,
    ok,
    mismatch,
    repaired,
    monitorOnly,
    errors,
    products,
    durationMs: Date.now() - started,
  }
}
