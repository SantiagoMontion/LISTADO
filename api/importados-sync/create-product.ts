import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSupabaseEnv, type Provider } from '../_lib/importados-sync/env.js'

export const config = {
  maxDuration: 120,
}
import {
  quoteImportadosForSync,
  shopifyPriceFromQuote,
  syncImportadosQuoteInputs,
} from '../_lib/importados-sync/importadosPricing.js'
import { fetchDolarMepQuote } from '../_lib/importados-sync/dolarMep.js'
import { publicProductDescriptionHtml } from '../_lib/importados-sync/productDescription.js'
import { importadosProductTitle } from '../_lib/importados-sync/productTitle.js'
import {
  createNotmidProductFromCatalog,
  deleteNotmidProduct,
  bootstrapCreatedProductInventory,
} from '../_lib/importados-sync/shopify.js'
import { processOne } from '../_lib/importados-sync/runSync.js'
import { getSupabase, variantMapWithPesoKg, type TrackedProduct } from '../_lib/importados-sync/supabase.js'
import { fetchSupplierCatalog, CREATE_CART_PROBE_MAX_VARIANTS } from '../_lib/importados-sync/supplierCatalog.js'

function sendJson(res: VercelResponse, status: number, payload: unknown): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.status(status).json(payload)
}

function readBearer(req: VercelRequest): string | null {
  const raw = req.headers.authorization ?? req.headers.Authorization
  const header = Array.isArray(raw) ? raw[0] : raw
  if (typeof header !== 'string') return null
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

async function requireHubUser(req: VercelRequest, res: VercelResponse): Promise<boolean> {
  const token = readBearer(req)
  if (!token) {
    sendJson(res, 401, { ok: false, error: 'unauthorized' })
    return false
  }
  const { url, serviceRoleKey } = getSupabaseEnv()
  const authClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await authClient.auth.getUser(token)
  if (error || !data.user) {
    sendJson(res, 401, { ok: false, error: 'unauthorized' })
    return false
  }
  return true
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value.replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }
  return null
}

function parseProvider(value: unknown): Provider | null {
  const v = asString(value).toLowerCase()
  if (v === 'lethal' || v === 'mk') return v
  return null
}

function detectProviderFromUrl(url: string): Provider | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, '').toLowerCase()
    if (host === 'lethal.gg' || host.endsWith('.lethal.gg')) return 'lethal'
    if (
      host === 'mechanicalkeyboards.com' ||
      host.endsWith('.mechanicalkeyboards.com')
    ) {
      return 'mk'
    }
    return null
  } catch {
    return null
  }
}

type ExistingTracked = {
  id?: string
  product_url?: string
  shopify_handle?: string
  product_title?: string
  is_active?: boolean
}

/**
 * Busca un seguimiento ya cargado para el mismo producto. Lo importante es no
 * publicar dos veces el mismo artículo: matcheamos por link exacto, por
 * proveedor+handle (el link puede venir con ?_pos=…&_sid=…) y por nombre.
 * Los valores de variante repetidos entre productos distintos (Black, White…)
 * no tienen nada que ver acá.
 */
async function findExistingTracked(
  sb: ReturnType<typeof getSupabase>,
  params: {
    productUrl: string
    provider: Provider
    shopifyHandle: string | null
    titles: string[]
  },
): Promise<ExistingTracked | null> {
  const columns = 'id, product_url, shopify_handle, product_title, is_active'
  const fallbackColumns = 'id, product_url, shopify_handle, is_active'

  type Match =
    | { column: 'product_url' }
    | { column: 'shopify_handle'; handle: string }
    | { column: 'product_title'; title: string }

  const matches: Match[] = [{ column: 'product_url' }]
  if (params.shopifyHandle) {
    matches.push({ column: 'shopify_handle', handle: params.shopifyHandle })
  }
  for (const title of new Set(params.titles.map((t) => t.trim()).filter(Boolean))) {
    matches.push({ column: 'product_title', title })
  }

  async function run(select: string, match: Match): Promise<ExistingTracked | null | 'retry'> {
    let query = sb.from('tracked_products').select(select)
    if (match.column === 'product_url') {
      query = query.eq('product_url', params.productUrl)
    } else if (match.column === 'shopify_handle') {
      query = query.eq('provider', params.provider).eq('shopify_handle', match.handle)
    } else {
      query = query.eq('product_title', match.title)
    }

    const { data, error } = await query.limit(1)
    if (error) {
      if (/column|product_title/i.test(error.message)) return 'retry'
      // Si no podemos verificar, seguimos: el índice único + rollback nos cubren.
      console.error('[importados-sync/create-product] duplicate check failed', error.message)
      return null
    }
    return (data?.[0] as ExistingTracked | undefined) ?? null
  }

  for (const match of matches) {
    let found = await run(columns, match)
    if (found === 'retry') found = await run(fallbackColumns, match)
    if (found && found !== 'retry') return found
  }
  return null
}

function duplicateMessage(existing: ExistingTracked): string {
  const name = existing.product_title?.trim()
  const who = name ? `«${name}»` : 'Ese producto'
  if (existing.is_active === false) {
    return `${who} ya está en la lista de seguimiento (pausado). No se creó nada en Shopify: reactivalo desde la lista.`
  }
  return `${who} ya está en seguimiento. No se creó nada en Shopify.`
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'method_not_allowed' })
    return
  }
  if (!(await requireHubUser(req, res))) return

  try {
    const body = (req.body ?? {}) as Record<string, unknown>
    const productUrl = asString(body.product_url)
    const provider = parseProvider(body.provider) || detectProviderFromUrl(productUrl)
    const pesoKg = asNumber(body.peso_kg ?? body.pesoKg)

    if (!productUrl || !/^https?:\/\//i.test(productUrl)) {
      sendJson(res, 400, { ok: false, error: 'Pegá el link completo del producto' })
      return
    }
    if (!provider) {
      sendJson(res, 400, {
        ok: false,
        error: 'El link tiene que ser de lethal.gg o mechanicalkeyboards.com',
      })
      return
    }
    if (pesoKg === null || pesoKg <= 0) {
      sendJson(res, 400, {
        ok: false,
        error: 'Ingresá el peso del paquete en kg (ejemplo: 0.8)',
      })
      return
    }

    const [catalogFast, dolarMep] = await Promise.all([
      // Fotos/título sin sondear el carrito (21 variantes × ~1.5s = timeout).
      fetchSupplierCatalog(provider, productUrl, {
        mode: 'full',
        skipStockProbe: true,
      }),
      fetchDolarMepQuote(),
    ])

    let catalog = catalogFast
    if (catalog.variants.length <= CREATE_CART_PROBE_MAX_VARIANTS) {
      const stock = await fetchSupplierCatalog(provider, productUrl, {
        mode: 'inventory',
        skipStockProbe: false,
      })
      const qtyById = new Map(stock.variants.map((v) => [v.id, v]))
      catalog = {
        ...catalog,
        inStock: stock.inStock,
        variants: catalog.variants.map((v) => {
          const live = qtyById.get(v.id)
          if (!live) return v
          return {
            ...v,
            inventoryQuantity: live.inventoryQuantity,
            inventoryReliable: live.inventoryReliable,
            available: live.available,
            storefrontAvailable: live.storefrontAvailable,
          }
        }),
      }
    }

    const sb = getSupabase()
    const productTitle = importadosProductTitle(catalog.title)

    // Nada de crear en Shopify si ya publicamos este artículo (mismo link o nombre).
    const duplicate = await findExistingTracked(sb, {
      productUrl,
      provider,
      shopifyHandle: catalog.shopifyHandle,
      // El título viejo cubre las filas guardadas antes del sufijo «| Importados».
      titles: [productTitle, catalog.title],
    })
    if (duplicate) {
      sendJson(res, 409, {
        ok: false,
        error: duplicateMessage(duplicate),
        existing: duplicate,
      })
      return
    }

    const quote = quoteImportadosForSync(
      syncImportadosQuoteInputs({
        costoProductoUsd: catalog.price,
        pesoKg,
        dolarArs: dolarMep.venta,
        handle: catalog.shopifyHandle ?? undefined,
        title: catalog.title ?? undefined,
      }),
    )
    const shopifyPriceArs = shopifyPriceFromQuote(quote)
    const bodyHtml = await publicProductDescriptionHtml(catalog.bodyHtml)

    const variantRows = catalog.variants.map((v) => {
      const variantArs = shopifyPriceFromQuote(
        quoteImportadosForSync(
          syncImportadosQuoteInputs({
            costoProductoUsd: v.priceUsd,
            pesoKg,
            dolarArs: dolarMep.venta,
            handle: catalog.shopifyHandle ?? undefined,
            title: catalog.title ?? undefined,
          }),
        ),
      )
      return {
        option1: v.option1 || v.title,
        option2: v.option2,
        option3: v.option3,
        sku: v.sku,
        price: variantArs,
        inventoryQuantity: v.inventoryQuantity,
        supplierVariantId: v.id,
      }
    })

    const created = await createNotmidProductFromCatalog({
      title: productTitle,
      bodyHtml,
      vendor: catalog.vendor,
      price: shopifyPriceArs,
      options: catalog.options,
      variants: variantRows,
      imageUrls: catalog.imageUrls,
      variantFeaturedImageByOption: catalog.variantFeaturedImageByOption,
      imageOptionByUrl: catalog.imageOptionByUrl,
      sourceUrl: catalog.sourceUrl,
      provider: catalog.provider,
      skipInventorySetup: true,
      skipVariantFeaturedImages: catalog.variants.length > 8,
    })

    const variantMap = variantMapWithPesoKg(created.variantMap, pesoKg)

    const rowBase = {
      provider,
      product_url: productUrl,
      shopify_handle: catalog.shopifyHandle,
      product_title: productTitle,
      notmid_shopify_variant_id: created.variantId,
      current_price: catalog.price,
      peso_kg: pesoKg,
      in_stock: catalog.inStock,
      last_checked: null,
      is_active: true,
    }

    let data = null as Record<string, unknown> | null
    let error = null as { message: string; code?: string } | null

    {
      const full = await sb
        .from('tracked_products')
        .insert({
          ...rowBase,
          notmid_shopify_product_id: created.productId,
          variant_map: variantMap,
        })
        .select(
          'id, provider, product_url, shopify_handle, product_title, notmid_shopify_variant_id, current_price, in_stock, last_checked, is_active',
        )
        .single()
      data = full.data
      error = full.error
    }

    if (error && /peso_kg|column/i.test(error.message)) {
      const { peso_kg: _drop, ...withoutPeso } = rowBase
      const noPeso = await sb
        .from('tracked_products')
        .insert({
          ...withoutPeso,
          notmid_shopify_product_id: created.productId,
          variant_map: variantMap,
        })
        .select(
          'id, provider, product_url, shopify_handle, product_title, notmid_shopify_variant_id, current_price, in_stock, last_checked, is_active',
        )
        .single()
      data = noPeso.data
      error = noPeso.error
    }

    if (error && /variant_map|notmid_shopify_product_id|product_title|column/i.test(error.message)) {
      const withoutTitle = { ...rowBase } as Record<string, unknown>
      delete withoutTitle.product_title
      const mid = await sb
        .from('tracked_products')
        .insert({
          ...withoutTitle,
          notmid_shopify_product_id: created.productId,
          variant_map: variantMap,
        })
        .select(
          'id, provider, product_url, shopify_handle, notmid_shopify_variant_id, current_price, in_stock, last_checked, is_active',
        )
        .single()
      data = mid.data
      error = mid.error
    }

    if (error && /variant_map|notmid_shopify_product_id|column/i.test(error.message)) {
      const basic = await sb
        .from('tracked_products')
        .insert({
          provider,
          product_url: productUrl,
          shopify_handle: catalog.shopifyHandle,
          notmid_shopify_variant_id: created.variantId,
          current_price: catalog.price,
          in_stock: catalog.inStock,
          last_checked: new Date().toISOString(),
          is_active: true,
        })
        .select(
          'id, provider, product_url, shopify_handle, notmid_shopify_variant_id, current_price, in_stock, last_checked, is_active',
        )
        .single()
      data = basic.data
      error = basic.error
    }

    if (error) {
      // Alguien lo cargó entre nuestro chequeo y el insert: deshacemos el borrador.
      const removed = await deleteNotmidProduct(created.productId)
      if (error.code === '23505') {
        sendJson(res, 409, {
          ok: false,
          error: removed
            ? 'Ese link ya está en seguimiento. No se creó nada en Shopify.'
            : 'Ese link ya está en seguimiento. Quedó un borrador en Shopify que hay que borrar a mano.',
          shopify: removed ? undefined : created,
        })
        return
      }
      throw new Error(
        removed ? error.message : `${error.message} · quedó un borrador en Shopify sin seguimiento`,
      )
    }

    const productId = String((data as { id?: string })?.id ?? '')
    let stockNote = 'Stock en camino: el cron lo ajusta si esta corrida no llega a sondear Lethal.'

    if (productId && created.variantMap?.length) {
      let rowsForBootstrap = variantRows
      const anyPositive = variantRows.some((r) => r.inventoryQuantity > 0)
      if (!anyPositive && catalog.inStock) {
        // .js del proveedor a veces marca todo OOS; piso 1 hasta el sondeo de carrito.
        rowsForBootstrap = variantRows.map((r) => ({ ...r, inventoryQuantity: 1 }))
      }

      const bootstrapped = await bootstrapCreatedProductInventory(
        created.variantMap,
        rowsForBootstrap,
      )
      if (bootstrapped > 0) {
        stockNote = `Stock inicial en ${bootstrapped} variante${bootstrapped === 1 ? '' : 's'}.`
      }

      const tracked: TrackedProduct = {
        id: productId,
        provider,
        product_url: productUrl,
        shopify_handle: catalog.shopifyHandle,
        notmid_shopify_variant_id: created.variantId,
        notmid_shopify_product_id: created.productId,
        variant_map: variantMap,
        current_price: catalog.price,
        in_stock: catalog.inStock,
        last_known_qty: null,
        peso_kg: pesoKg,
        oos_pending: {},
        last_checked: null,
        is_active: true,
      }
      try {
        const sync = await processOne(tracked, { dolarArs: dolarMep.venta })
        const qtys = sync.detail?.quantities ?? []
        const live = qtys.filter((q) => q.qty > 0)
        if (sync.error) {
          stockNote =
            bootstrapped > 0
              ? `${stockNote} El cron termina de ajustar.`
              : 'No se pudo sondear stock ahora; el cron lo toma en los próximos minutos.'
        } else if (live.length) {
          const preview = live
            .slice(0, 6)
            .map((q) => `${q.option} × ${q.qty}`)
            .join(', ')
          const extra = live.length > 6 ? ` +${live.length - 6}` : ''
          stockNote = `Stock listo: ${preview}${extra}.`
        } else if (sync.shopifyRestocked) {
          stockNote = 'Stock escrito en Shopify.'
        } else if (catalog.inStock) {
          stockNote =
            'El proveedor figura en stock, pero el sondeo no escribió qty. Usá Sincronizar ahora.'
        } else {
          stockNote = 'El proveedor figura sin stock en este momento.'
        }
      } catch (syncErr) {
        console.warn(
          '[importados-sync/create-product] initial stock sync failed',
          syncErr instanceof Error ? syncErr.message : String(syncErr),
        )
      }
    }

    sendJson(res, 201, {
      ok: true,
      product: data,
      shopify: created,
      quote: {
        precio_contado_ars: quote.precioContadoArs,
        precio_cuotas_ars: quote.precioCuotasArs,
      },
      message: `Producto en borrador · precio cuotas ARS ${shopifyPriceArs.toLocaleString('es-AR')}. ${stockNote}`,
    })
  } catch (error) {
    const message = formatCaughtError(error)
    console.error('[importados-sync/create-product]', message)
    const rateLimited = /\b429\b|limitando las consultas|too many requests/i.test(message)
    sendJson(res, rateLimited ? 429 : 500, { ok: false, error: message })
  }
}

function formatCaughtError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  if (error && typeof error === 'object') {
    const o = error as { message?: unknown; error?: unknown; detail?: unknown }
    if (typeof o.message === 'string' && o.message.trim()) return o.message
    if (typeof o.detail === 'string' && o.detail.trim()) return o.detail
    if (typeof o.error === 'string' && o.error.trim()) return o.error
    try {
      return JSON.stringify(error)
    } catch {
      return 'Error desconocido al crear el producto'
    }
  }
  return 'Error desconocido al crear el producto'
}
