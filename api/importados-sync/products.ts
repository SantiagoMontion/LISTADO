import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSupabaseEnv, type Provider } from '../_lib/importados-sync/env.js'
import {
  getProductIdFromVariant,
  shopifyAdminProductUrl,
} from '../_lib/importados-sync/shopify.js'
import { getSupabase } from '../_lib/importados-sync/supabase.js'

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

function parseProvider(value: unknown): Provider | null {
  const v = asString(value).toLowerCase()
  if (v === 'lethal' || v === 'mk') return v
  return null
}

function extractLethalHandle(url: string): string | null {
  try {
    const parsed = new URL(url)
    const match = parsed.pathname.match(/\/products\/([^/?#]+)/i)
    return match?.[1] ? decodeURIComponent(match[1]) : null
  } catch {
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!(await requireHubUser(req, res))) return

  try {
    const sb = getSupabase()

    if (req.method === 'GET') {
      const adminForVariant = asString(req.query.admin_for_variant)
      if (adminForVariant) {
        const productId = await getProductIdFromVariant(adminForVariant)
        sendJson(res, 200, {
          ok: true,
          productId,
          url: shopifyAdminProductUrl(productId),
        })
        return
      }

      const selectWithTitle =
        'id, provider, product_url, shopify_handle, product_title, notmid_shopify_variant_id, notmid_shopify_product_id, current_price, in_stock, last_checked, is_active'
      const selectFull =
        'id, provider, product_url, shopify_handle, notmid_shopify_variant_id, notmid_shopify_product_id, current_price, in_stock, last_checked, is_active'
      const selectBasic =
        'id, provider, product_url, shopify_handle, notmid_shopify_variant_id, current_price, in_stock, last_checked, is_active'

      let data = null as unknown[] | null
      let error = null as { message: string } | null
      {
        const withTitle = await sb
          .from('tracked_products')
          .select(selectWithTitle)
          .order('created_at', { ascending: false })
        data = withTitle.data
        error = withTitle.error
      }
      if (error && /product_title|column/i.test(error.message)) {
        const full = await sb.from('tracked_products').select(selectFull).order('created_at', {
          ascending: false,
        })
        data = full.data
        error = full.error
      }
      if (error && /notmid_shopify_product_id|column/i.test(error.message)) {
        const basic = await sb.from('tracked_products').select(selectBasic).order('created_at', {
          ascending: false,
        })
        data = (basic.data ?? []).map((row) => ({
          ...row,
          notmid_shopify_product_id: null,
          product_title: null,
        }))
        error = basic.error
      }
      if (error) throw new Error(error.message)
      sendJson(res, 200, { ok: true, products: data ?? [] })
      return
    }

    if (req.method === 'POST') {
      const body = (req.body ?? {}) as Record<string, unknown>
      const provider = parseProvider(body.provider)
      const productUrl = asString(body.product_url)
      if (!provider) {
        sendJson(res, 400, { ok: false, error: 'provider debe ser lethal o mk' })
        return
      }
      if (!productUrl || !/^https?:\/\//i.test(productUrl)) {
        sendJson(res, 400, { ok: false, error: 'product_url inválida' })
        return
      }

      let handle = asString(body.shopify_handle) || null
      if (provider === 'lethal' && !handle) handle = extractLethalHandle(productUrl)

      const { data, error } = await sb
        .from('tracked_products')
        .insert({
          provider,
          product_url: productUrl,
          shopify_handle: handle,
          notmid_shopify_variant_id: asString(body.notmid_shopify_variant_id) || null,
          is_active: body.is_active === false ? false : true,
        })
        .select(
          'id, provider, product_url, shopify_handle, notmid_shopify_variant_id, current_price, in_stock, last_checked, is_active',
        )
        .single()

      if (error) {
        if (error.code === '23505') {
          sendJson(res, 409, { ok: false, error: 'Ya existe un producto con esa URL' })
          return
        }
        throw new Error(error.message)
      }
      sendJson(res, 201, { ok: true, product: data })
      return
    }

    if (req.method === 'PATCH') {
      const body = (req.body ?? {}) as Record<string, unknown>
      const id = asString(body.id) || asString(req.query.id)
      if (!id) {
        sendJson(res, 400, { ok: false, error: 'falta id' })
        return
      }

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (body.provider !== undefined) {
        const provider = parseProvider(body.provider)
        if (!provider) {
          sendJson(res, 400, { ok: false, error: 'provider inválido' })
          return
        }
        patch.provider = provider
      }
      if (body.product_url !== undefined) patch.product_url = asString(body.product_url)
      if (body.shopify_handle !== undefined) {
        patch.shopify_handle = asString(body.shopify_handle) || null
      }
      if (body.notmid_shopify_variant_id !== undefined) {
        patch.notmid_shopify_variant_id = asString(body.notmid_shopify_variant_id) || null
      }
      if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active)

      const { error } = await sb.from('tracked_products').update(patch).eq('id', id)
      if (error) throw new Error(error.message)
      sendJson(res, 200, { ok: true, id })
      return
    }

    if (req.method === 'DELETE') {
      const id = asString(req.query.id) || asString((req.body as { id?: string } | undefined)?.id)
      if (!id) {
        sendJson(res, 400, { ok: false, error: 'falta id' })
        return
      }
      const { error } = await sb.from('tracked_products').delete().eq('id', id)
      if (error) throw new Error(error.message)
      sendJson(res, 200, { ok: true, id })
      return
    }

    sendJson(res, 405, { ok: false, error: 'method_not_allowed' })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[importados-sync/products]', message)
    sendJson(res, 500, { ok: false, error: message })
  }
}
