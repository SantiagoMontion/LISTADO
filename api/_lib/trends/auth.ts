import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getCronSecret, getSupabaseEnv } from '../importados-sync/env.js'

export function sendJson(res: VercelResponse, status: number, payload: unknown): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.status(status).json(payload)
}

export function readBearer(req: VercelRequest): string | null {
  const raw = req.headers.authorization ?? req.headers.Authorization
  const header = Array.isArray(raw) ? raw[0] : raw
  if (typeof header !== 'string') return null
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

export function verifyCronSecret(req: VercelRequest): boolean {
  let expected: string
  try {
    expected = getCronSecret()
  } catch {
    return false
  }

  const header = readBearer(req)
  if (header && header === expected) return true

  const cronHeader = req.headers['x-vercel-cron']
  const isVercelCron = cronHeader === '1' || (Array.isArray(cronHeader) && cronHeader[0] === '1')
  return Boolean(isVercelCron && expected)
}

export async function requireTrendsAdmin(
  req: VercelRequest,
  res: VercelResponse,
): Promise<{ userId: string } | null> {
  const token = readBearer(req)
  if (!token) {
    sendJson(res, 401, { ok: false, error: 'unauthorized' })
    return null
  }

  const { url, serviceRoleKey } = getSupabaseEnv()
  const authClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await authClient.auth.getUser(token)
  if (error || !data.user) {
    sendJson(res, 401, { ok: false, error: 'unauthorized' })
    return null
  }

  // Cualquier usuario autenticado del hub (sin exigir admin)
  return { userId: data.user.id }
}
