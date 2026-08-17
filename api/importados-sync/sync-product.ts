import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSupabaseEnv } from '../_lib/importados-sync/env.js'
import { processOne } from '../_lib/importados-sync/runSync.js'
import { resolveInventoryTargetLocations } from '../_lib/importados-sync/shopify.js'
import { getSupabase, normalizeTrackedProduct } from '../_lib/importados-sync/supabase.js'

export const config = {
  maxDuration: 60,
}

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

async function loadTracked(opts: {
  id?: string
  shopifyProductId?: string
}): Promise<ReturnType<typeof normalizeTrackedProduct> | null> {
  const sb = getSupabase()
  const selects = [
    'id, provider, product_url, shopify_handle, notmid_shopify_variant_id, notmid_shopify_product_id, variant_map, current_price, in_stock, last_known_qty, peso_kg, oos_pending, last_checked, is_active',
    'id, provider, product_url, shopify_handle, notmid_shopify_variant_id, notmid_shopify_product_id, variant_map, current_price, in_stock, last_known_qty, last_checked, is_active',
    'id, provider, product_url, shopify_handle, notmid_shopify_variant_id, notmid_shopify_product_id, variant_map, current_price, in_stock, last_checked, is_active',
  ]

  async function query(column: 'id' | 'notmid_shopify_product_id', value: string) {
    let lastError: Error | null = null
    for (const select of selects) {
      const res = await sb.from('tracked_products').select(select).eq(column, value).maybeSingle()
      if (!res.error) {
        return res.data ? normalizeTrackedProduct(res.data as unknown as Record<string, unknown>) : null
      }
      lastError = new Error(res.error.message)
      if (!/column|peso_kg|last_known_qty|oos_pending|variant_map/i.test(res.error.message)) {
        throw lastError
      }
    }
    if (lastError) throw lastError
    return null
  }

  if (opts.id) {
    const byId = await query('id', opts.id)
    if (byId) return byId
    if (/^\d+$/.test(opts.id)) {
      const byShopify = await query('notmid_shopify_product_id', opts.id)
      if (byShopify) return byShopify
    }
  }

  if (opts.shopifyProductId) {
    return query('notmid_shopify_product_id', opts.shopifyProductId)
  }

  return null
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'method_not_allowed' })
    return
  }
  if (!(await requireHubUser(req, res))) return

  try {
    const id = asString(req.body?.id) || asString(req.query.id)
    const shopifyProductId =
      asString(req.body?.shopify_product_id) || asString(req.query.shopify_product_id)
    if (!id && !shopifyProductId) {
      sendJson(res, 400, { ok: false, error: 'missing_id' })
      return
    }

    const product = await loadTracked({ id: id || undefined, shopifyProductId: shopifyProductId || undefined })
    if (!product) {
      sendJson(res, 404, { ok: false, error: 'not_found' })
      return
    }

    const locations = await resolveInventoryTargetLocations()
    const result = await processOne(product)
    sendJson(res, result.error ? 500 : 200, {
      ok: !result.error,
      productId: product.id,
      handle: product.shopify_handle,
      shopifyProductId: product.notmid_shopify_product_id,
      locations: locations.map((l) => l.name),
      ...result,
    })
  } catch (err) {
    sendJson(res, 500, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
