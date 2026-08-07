import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getCronSecret } from '../_lib/importados-sync/env.js'
import { runInventorySync } from '../_lib/importados-sync/runSync.js'

function sendJson(res: VercelResponse, status: number, payload: unknown): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.status(status).json(payload)
}

function verifyCronSecret(req: VercelRequest): boolean {
  let expected: string
  try {
    expected = getCronSecret()
  } catch {
    return false
  }

  const raw = req.headers.authorization ?? req.headers.Authorization
  const header = Array.isArray(raw) ? raw[0] : raw
  if (typeof header !== 'string') return false
  return header === `Bearer ${expected}`
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'method_not_allowed' })
    return
  }

  if (!verifyCronSecret(req)) {
    sendJson(res, 401, { ok: false, error: 'unauthorized' })
    return
  }

  try {
    const summary = await runInventorySync()
    sendJson(res, 200, {
      ...summary,
      source: 'cron',
      at: new Date().toISOString(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[sync-inventory] fatal', message)
    sendJson(res, 500, {
      ok: false,
      error: 'sync_failed',
      detail: message,
      at: new Date().toISOString(),
    })
  }
}
