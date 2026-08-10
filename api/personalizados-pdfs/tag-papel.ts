import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSupabaseEnv } from '../_lib/importados-sync/env.js'
import { tagOrdersWithPapel } from '../_lib/personalizados-pdfs/pendingPdfs.js'

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

function readOrderIds(body: unknown): string[] {
  if (!body || typeof body !== 'object') return []
  const raw = (body as { orderIds?: unknown }).orderIds
  if (!Array.isArray(raw)) return []
  return raw.map((id) => String(id ?? '').trim()).filter(Boolean)
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'method_not_allowed' })
    return
  }
  if (!(await requireHubUser(req, res))) return

  const orderIds = readOrderIds(req.body)
  if (!orderIds.length) {
    sendJson(res, 400, { ok: false, error: 'orderIds_required' })
    return
  }

  try {
    const result = await tagOrdersWithPapel(orderIds)
    const failures = result.tagged.filter((r) => !r.ok)
    sendJson(res, failures.length && !result.taggedCount ? 500 : 200, {
      ok: failures.length === 0,
      taggedCount: result.taggedCount,
      results: result.tagged,
      error: failures.length
        ? `No se pudo etiquetar ${failures.length} pedido(s)`
        : undefined,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[personalizados-pdfs/tag-papel]', message)
    sendJson(res, 500, { ok: false, error: message })
  }
}
