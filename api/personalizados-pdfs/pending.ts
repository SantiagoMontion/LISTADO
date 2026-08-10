import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSupabaseEnv } from '../_lib/importados-sync/env.js'
import { listPendingPersonalizadosPdfs } from '../_lib/personalizados-pdfs/pendingPdfs.js'

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

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    sendJson(res, 405, { ok: false, error: 'method_not_allowed' })
    return
  }
  if (!(await requireHubUser(req, res))) return

  try {
    const result = await listPendingPersonalizadosPdfs()
    sendJson(res, 200, {
      ok: true,
      rows: result.rows,
      matched: result.matched,
      skipped: result.skipped,
      count: result.rows.length,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[personalizados-pdfs/pending]', message)
    sendJson(res, 500, { ok: false, error: message })
  }
}
