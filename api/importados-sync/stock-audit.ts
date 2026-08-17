import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSupabaseEnv } from '../_lib/importados-sync/env.js'
import { runStockAudit, auditOneProduct } from '../_lib/importados-sync/stockAudit.js'
import { getSupabase, type TrackedProduct } from '../_lib/importados-sync/supabase.js'
import { parseOosPending } from '../_lib/importados-sync/inventoryWritePolicy.js'

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

function asTracked(row: Record<string, unknown>): TrackedProduct {
  return {
    ...row,
    variant_map: Array.isArray(row.variant_map) ? row.variant_map : null,
    current_price:
      row.current_price === null || row.current_price === undefined
        ? null
        : Number(row.current_price),
    last_known_qty:
      row.last_known_qty === null || row.last_known_qty === undefined
        ? null
        : Number(row.last_known_qty),
    oos_pending: parseOosPending(row.oos_pending),
  } as TrackedProduct
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!(await requireHubUser(req, res))) return

  try {
    if (req.method === 'GET') {
      // Último reporte guardado (si existe la tabla)
      const sb = getSupabase()
      const { data, error } = await sb
        .from('importados_stock_audits')
        .select('id, created_at, report')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) {
        sendJson(res, 200, { ok: true, report: null, note: error.message })
        return
      }
      sendJson(res, 200, { ok: true, id: data?.id ?? null, created_at: data?.created_at ?? null, report: data?.report ?? null })
      return
    }

    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method_not_allowed' })
      return
    }

    const id = asString(req.body?.id)
    const repair = req.body?.repair !== false
    const offset = Number(req.body?.offset ?? 0) || 0
    const maxProducts = Number(req.body?.maxProducts ?? 6) || 6

    if (id) {
      const sb = getSupabase()
      let data: Record<string, unknown> | null = null
      {
        const full = await sb
          .from('tracked_products')
          .select(
            'id, provider, product_url, shopify_handle, notmid_shopify_variant_id, notmid_shopify_product_id, variant_map, current_price, in_stock, last_known_qty, last_checked, is_active',
          )
          .eq('id', id)
          .maybeSingle()
        if (full.error && /last_known_qty/i.test(full.error.message)) {
          const fallback = await sb
            .from('tracked_products')
            .select(
              'id, provider, product_url, shopify_handle, notmid_shopify_variant_id, notmid_shopify_product_id, variant_map, current_price, in_stock, last_checked, is_active',
            )
            .eq('id', id)
            .maybeSingle()
          if (fallback.error) throw new Error(fallback.error.message)
          data = fallback.data
            ? { ...fallback.data, last_known_qty: null }
            : null
        } else if (full.error) {
          throw new Error(full.error.message)
        } else {
          data = full.data
        }
      }
      if (!data) {
        sendJson(res, 404, { ok: false, error: 'not_found' })
        return
      }
      const row = await auditOneProduct(asTracked(data), { repair })
      sendJson(res, 200, { ok: true, product: row })
      return
    }

    const report = await runStockAudit({
      repair,
      maxProducts,
      offset,
      forceAll: true,
    })
    // Intentar persistir lote
    try {
      await getSupabase().from('importados_stock_audits').insert({ report })
    } catch {
      // ignore
    }
    sendJson(res, 200, { ...report, ok: true as const })
  } catch (err) {
    sendJson(res, 500, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
