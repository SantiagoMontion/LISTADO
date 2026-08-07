import { setVariantInventoryAvailable, setVariantInventoryToZero } from './shopify.js'
import {
  fetchActiveTrackedProducts,
  updateTrackedProduct,
  type TrackedProduct,
} from './supabase.js'
import { fetchLethalSnapshot } from './providers/lethal.js'
import { fetchMkSnapshot } from './providers/mk.js'
import type { ProviderResult, ProviderSnapshot } from './providers/types.js'
import { fetchSupplierCatalog } from './supplierCatalog.js'

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
  unchanged: number
  errors: ProductSyncError[]
  warnings: Array<{ id: string; messages: string[] }>
  durationMs: number
}

const BATCH_SIZE = 2

function pricesEqual(a: number | null, b: number): boolean {
  if (a === null || a === undefined) return false
  return Math.abs(Number(a) - b) < 0.0001
}

async function scrapeProduct(product: TrackedProduct): Promise<ProviderResult> {
  if (product.provider === 'lethal') return fetchLethalSnapshot(product)
  if (product.provider === 'mk') return fetchMkSnapshot(product)
  return { ok: false, error: `Unknown provider: ${String(product.provider)}` }
}

async function applyVariantInventories(
  product: TrackedProduct,
  catalog: Awaited<ReturnType<typeof fetchSupplierCatalog>>,
): Promise<{ zeroed: number; warnings: string[] }> {
  const warnings: string[] = []
  let zeroed = 0
  const map = product.variant_map
  if (!map?.length) return { zeroed, warnings }

  for (const entry of map) {
    if (!entry.notmidVariantId) continue
    const supplier = catalog.variants.find(
      (v) =>
        v.id === entry.supplierVariantId ||
        (entry.option && (v.option1 === entry.option || v.title === entry.option)),
    )
    const qty = supplier?.inventoryQuantity ?? 0
    try {
      await setVariantInventoryAvailable(entry.notmidVariantId, qty)
      if (qty <= 0) zeroed += 1
    } catch (err) {
      warnings.push(
        `Inventario ${entry.option}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  return { zeroed, warnings }
}

async function processOne(product: TrackedProduct): Promise<{
  updated: boolean
  shopifyZeroed: boolean
  warnings?: string[]
  error?: string
}> {
  try {
    const now = new Date().toISOString()
    let snapshot: ProviderSnapshot
    let warnings: string[] = []
    let shopifyZeroed = false

    // Con variant_map: un solo scrape de catálogo (Lethal incluye prueba de carrito qty≥2)
    if (product.variant_map?.length) {
      try {
        const catalog = await fetchSupplierCatalog(product.provider, product.product_url)
        snapshot = { price: catalog.price, inStock: catalog.inStock }
        const inv = await applyVariantInventories(product, catalog)
        warnings.push(...inv.warnings)
        if (inv.zeroed > 0) shopifyZeroed = true
      } catch (err) {
        return {
          updated: false,
          shopifyZeroed: false,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    } else {
      const scraped = await scrapeProduct(product)
      if (!scraped.ok) {
        return { updated: false, shopifyZeroed: false, error: scraped.error }
      }
      snapshot = scraped.data
      warnings = [...(scraped.warnings ?? [])]

      const becameOutOfStock = product.in_stock !== false && snapshot.inStock === false
      if (becameOutOfStock && product.notmid_shopify_variant_id) {
        try {
          await setVariantInventoryToZero(product.notmid_shopify_variant_id)
          shopifyZeroed = true
        } catch (shopifyError) {
          const message =
            shopifyError instanceof Error ? shopifyError.message : String(shopifyError)
          await updateTrackedProduct(product.id, {
            current_price: snapshot.price,
            in_stock: snapshot.inStock,
            last_checked: now,
          })
          return {
            updated: true,
            shopifyZeroed: false,
            warnings,
            error: `Shopify zero-stock failed after DB update: ${message}`,
          }
        }
      }
    }

    const priceChanged = !pricesEqual(product.current_price, snapshot.price)
    const stockChanged = product.in_stock !== snapshot.inStock

    if (priceChanged || stockChanged || product.last_checked === null) {
      await updateTrackedProduct(product.id, {
        current_price: snapshot.price,
        in_stock: snapshot.inStock,
        last_checked: now,
      })
      return { updated: true, shopifyZeroed, warnings: warnings.length ? warnings : undefined }
    }

    await updateTrackedProduct(product.id, { last_checked: now })
    return { updated: false, shopifyZeroed, warnings: warnings.length ? warnings : undefined }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { updated: false, shopifyZeroed: false, error: message }
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
          error: entry.reason instanceof Error ? entry.reason.message : String(entry.reason),
        } as R)
      }
    }
  }
  return results
}

export async function runInventorySync(): Promise<SyncSummary> {
  const started = Date.now()
  const products = await fetchActiveTrackedProducts()

  type RowResult = {
    product: TrackedProduct
    updated: boolean
    shopifyZeroed: boolean
    warnings?: string[]
    error?: string
  }

  const rows = await mapInBatches(products, BATCH_SIZE, async (product) => {
    const result = await processOne(product)
    return { product, ...result } satisfies RowResult
  })

  const errors: ProductSyncError[] = []
  const warnings: Array<{ id: string; messages: string[] }> = []
  let updated = 0
  let shopifyZeroed = 0
  let unchanged = 0

  for (const row of rows) {
    if (row.warnings?.length) {
      warnings.push({ id: row.product.id, messages: row.warnings })
    }
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
  }

  return {
    ok: errors.length === 0,
    checked: products.length,
    updated,
    shopifyZeroed,
    unchanged,
    errors,
    warnings,
    durationMs: Date.now() - started,
  }
}
