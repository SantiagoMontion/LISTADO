import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSupabaseEnv } from '../_lib/importados-sync/env.js'
import {
  assessVariantMapHealth,
  fetchTrackedProductsForHealth,
  repairIncompleteVariantMaps,
} from '../_lib/importados-sync/variantMapHealth.js'

export const config = {
  maxDuration: 120,
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

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!(await requireHubUser(req, res))) return

  try {
    if (req.method === 'GET') {
      const products = await fetchTrackedProductsForHealth()
      const report = assessVariantMapHealth(products)
      sendJson(res, 200, { ok: true, report })
      return
    }

    if (req.method === 'POST') {
      const result = await repairIncompleteVariantMaps()
      sendJson(res, 200, { ok: true, ...result })
      return
    }

    sendJson(res, 405, { ok: false, error: 'method_not_allowed' })
  } catch (err) {
    sendJson(res, 500, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
